// =====================================================================
// ESPELHO — MySQL do cliente (via túnel SSH) -> Supabase
//
// Uso:  node espelho.mjs testar                 -> só testa as 3 conexões
//       node espelho.mjs descobrir              -> lista as tabelas do MySQL
//       node espelho.mjs sincronizar            -> SIMULAÇÃO (dá ROLLBACK no fim)
//       node espelho.mjs sincronizar --commit   -> vale de verdade
//       node espelho.mjs sincronizar --commit --limite 100
//                                               -> teste de ponta a ponta:
//                                                  só as 100 primeiras linhas
//
// O DBeaver não entra no caminho. Ele é só um cliente gráfico: quem tem os
// dados é o MySQL do cliente, e o DBeaver chega lá por um túnel SSH. Host,
// usuário e senha ficam todos em credenciais.json (fora do repositório).
// Este script faz exatamente o mesmo túnel, sem depender do DBeaver estar
// aberto ou instalado.
//
// Semântica de ESPELHO (não é migração): cada tabela é recarregada inteira
// dentro de uma transação. Se a carga falhar no meio, o Supabase continua
// com os dados de ontem — nunca fica pela metade. Rodar duas vezes seguidas
// dá o mesmo resultado.
//
// As tabelas espelhadas ficam num schema separado (`espelho`, configurável).
// Nada aqui escreve em tabela do ERP.
// =====================================================================
import { Client as SshClient } from 'ssh2';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { csv } from './csv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const COMANDO = process.argv[2];
const COMMIT = process.argv.includes('--commit');
// --completo: recarrega inteiras também as tabelas incrementais (ver "incremental" em tabelas.json).
const COMPLETO = process.argv.includes('--completo');

// --limite N: traz só as N primeiras linhas de cada tabela. É para o teste de
// ponta a ponta — provar que o caminho inteiro funciona sem esperar uma tabela
// grande copiar inteira. NUNCA use na execução diária: como a carga apaga e
// recarrega, sincronizar com limite deixaria o espelho truncado.
const argLimite = process.argv.find((a) => a.startsWith('--limite'));
const LIMITE = argLimite
  ? Number(argLimite.includes('=') ? argLimite.split('=')[1] : process.argv[process.argv.indexOf(argLimite) + 1])
  : null;
if (argLimite && (!Number.isInteger(LIMITE) || LIMITE <= 0)) {
  console.error('--limite precisa de um número inteiro positivo. Ex.: --limite 100');
  process.exit(1);
}

const COMANDOS = ['testar', 'descobrir', 'perfilar', 'sincronizar', 'conferir'];
if (!COMANDOS.includes(COMANDO)) {
  console.error(`comando inválido. use um de: ${COMANDOS.join(' | ')}`);
  process.exit(1);
}

// ── credenciais ──────────────────────────────────────────────────────
// Ficam em credenciais.json, que o .gitignore barra. NUNCA no .env do
// projeto: aquele .env é versionado e vai parar no GitHub e no Lovable.
const ARQ_CRED = process.env.ESPELHO_CREDENCIAIS || path.join(AQUI, 'credenciais.json');
if (!fs.existsSync(ARQ_CRED)) {
  console.error(`não achei ${ARQ_CRED}`);
  console.error('copie credenciais.exemplo.json para credenciais.json e preencha as senhas.');
  process.exit(1);
}
const cred = JSON.parse(fs.readFileSync(ARQ_CRED, 'utf8'));

// Em CI, as senhas vêm de secret e sobrescrevem o arquivo.
if (process.env.SSH_SENHA) cred.ssh.senha = process.env.SSH_SENHA;
if (process.env.MYSQL_SENHA) cred.mysql.senha = process.env.MYSQL_SENHA;
if (process.env.SUPABASE_SENHA) cred.supabase.senha = process.env.SUPABASE_SENHA;

const SCHEMA = cred.supabase.schema || 'espelho';

// O log do GitHub Actions em repositório público é público. O secret mascara
// as SENHAS sozinho, mas host e usuário sairiam em texto limpo — e host +
// usuário + porta é meio caminho para quem quiser tentar força bruta. Rodando
// no Actions, some com eles; rodando na sua máquina, mostra tudo normalmente.
const NO_CI = !!process.env.GITHUB_ACTIONS;
const oculto = (v) => (NO_CI ? '«oculto»' : String(v));

// ── conexões ─────────────────────────────────────────────────────────
function abrirSsh() {
  return new Promise((resolve, reject) => {
    const ssh = new SshClient();
    const falhar = (e) => reject(new Error(`túnel SSH falhou: ${e.message}`));
    ssh.once('ready', () => resolve(ssh));
    ssh.once('error', falhar);
    ssh.connect({
      host: cred.ssh.host,
      port: cred.ssh.porta ?? 22,
      username: cred.ssh.usuario,
      password: cred.ssh.senha,
      readyTimeout: 30_000,
    });
  });
}

// O MySQL escuta em localhost:3306 DENTRO do servidor — por isso o host aqui
// é 127.0.0.1: é o ponto de vista de quem já atravessou o túnel.
function abrirMysql(ssh) {
  return new Promise((resolve, reject) => {
    ssh.forwardOut('127.0.0.1', 0, cred.mysql.host ?? '127.0.0.1', cred.mysql.porta ?? 3306, async (err, stream) => {
      if (err) return reject(new Error(`túnel abriu mas o MySQL não respondeu: ${err.message}`));
      try {
        resolve(await mysql.createConnection({
          user: cred.mysql.usuario,
          password: cred.mysql.senha,
          database: cred.mysql.banco || undefined,
          stream,
          // datas como texto: evita o Node reinterpretar fuso e deslocar o dia.
          dateStrings: true,
          supportBigNumbers: true,
          bigNumberStrings: true,
        }));
      } catch (e) { reject(new Error(`login no MySQL falhou: ${e.message}`)); }
    });
  });
}

async function abrirSupabase() {
  // Porta 5432 (session pooler), não 6543: o pooler de transação não aguarda
  // transação longa com DDL, que é exatamente o que a carga faz.
  const cliente = new pg.Client({
    host: cred.supabase.host,
    port: cred.supabase.porta ?? 5432,
    user: cred.supabase.usuario,
    database: cred.supabase.banco ?? 'postgres',
    password: cred.supabase.senha,
    ssl: { rejectUnauthorized: false },
  });
  await cliente.connect();
  return cliente;
}

// ── tradução de tipos MySQL -> Postgres ──────────────────────────────
function tipoPg(col) {
  const t = String(col.DATA_TYPE || '').toLowerCase();
  if (t === 'tinyint' || t === 'smallint' || t === 'mediumint' || t === 'int' || t === 'integer') return 'integer';
  if (t === 'bigint') return 'bigint';
  if (t === 'decimal' || t === 'numeric') return 'numeric';
  if (t === 'float') return 'real';
  if (t === 'double') return 'double precision';
  if (t === 'date') return 'date';
  // datetime/timestamp do MySQL não carregam fuso. `timestamp` (sem tz)
  // guarda o valor exatamente como está lá, sem conversão.
  if (t === 'datetime' || t === 'timestamp') return 'timestamp';
  if (t === 'year') return 'integer';
  if (t === 'json') return 'jsonb';
  if (t.includes('blob') || t === 'binary' || t === 'varbinary') return 'bytea';
  return 'text'; // char, varchar, text, enum, set, time, bit e o que sobrar
}

// csv() vive em csv.mjs para ser testável sozinho — ver csv.teste.mjs.

// Os dois bancos citam identificador de jeito diferente, e misturar dá erro de
// sintaxe: Postgres usa aspas duplas, MySQL usa crase. Aspas duplas no MySQL
// só funcionariam com ANSI_QUOTES ligado, que não é o padrão.
const aspas = (nome) => `"${String(nome).replace(/"/g, '""')}"`;        // Postgres
const crase = (nome) => '`' + String(nome).replace(/`/g, '``') + '`';   // MySQL

// ── leitura do schema de origem ──────────────────────────────────────
// A origem muda o tipo de coluna sem avisar: em 15/10/2026 a Flex passou
// BiMarcacoes.numcra para bigint (crachá 5000000115) e a carga quebrou com
// "out of range for type integer" — o CREATE TABLE IF NOT EXISTS daqui não
// revisita o tipo. Alarga o que a origem alargou (nunca estreita).
async function alargarColunas(pgc, tabela, cols) {
  const { rows } = await pgc.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [SCHEMA, tabela]
  );
  const atual = new Map(rows.map((r) => [r.column_name, r.data_type]));
  for (const c of cols) {
    const quer = tipoPg(c);
    const tem = atual.get(c.COLUMN_NAME);
    if (tem === 'integer' && (quer === 'bigint' || quer === 'numeric')) {
      await pgc.query(`ALTER TABLE ${aspas(SCHEMA)}.${aspas(tabela)} ALTER COLUMN ${aspas(c.COLUMN_NAME)} TYPE ${quer}`);
      console.log(`  (${tabela}.${c.COLUMN_NAME}: integer -> ${quer}, como na origem)`);
    }
  }
}

// Data de corte (AAAA-MM-DD, horário de Brasília) para a carga incremental.
// Calculada UMA vez aqui e usada como literal nos dois bancos: CURDATE() do
// MySQL e current_date do Postgres podem estar em fusos diferentes, e a
// diferença viraria um buraco ou uma duplicata na virada do dia.
function dataDeCorte(dias) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - dias * 86_400_000));
}

async function colunasDe(my, tabela) {
  const [linhas] = await my.query(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [cred.mysql.banco, tabela]
  );
  if (!linhas.length) throw new Error(`tabela "${tabela}" não existe no banco ${cred.mysql.banco}`);
  return linhas;
}

// ── comandos ─────────────────────────────────────────────────────────
async function cmdTestar() {
  console.log(`1/3  SSH  ${oculto(`${cred.ssh.usuario}@${cred.ssh.host}:${cred.ssh.porta ?? 22}`)} ...`);
  const ssh = await abrirSsh();
  console.log('     ok\n');

  console.log(`2/3  MySQL  banco ${oculto(`"${cred.mysql.banco}"`)} pelo túnel ...`);
  const my = await abrirMysql(ssh);
  const [[v]] = await my.query('SELECT VERSION() AS versao, DATABASE() AS banco');
  console.log(`     ok — MySQL ${v.versao}, banco ${v.banco}\n`);

  console.log(`3/3  Supabase  ${oculto(cred.supabase.host)} ...`);
  const pgc = await abrirSupabase();
  const { rows: [d] } = await pgc.query('SELECT current_database() AS banco, version() AS versao');
  console.log(`     ok — ${d.banco}\n`);

  await my.end(); ssh.end(); await pgc.end();
  console.log('As três conexões funcionam. Pode rodar "descobrir".');
}

async function cmdDescobrir() {
  const ssh = await abrirSsh();
  const my = await abrirMysql(ssh);

  // No DBeaver o campo "Banco de dados" está em branco (com "Show all
  // databases"), então o nome pode não ser conhecido ainda. Sem ele não dá
  // para consultar information_schema: primeiro mostramos quais existem.
  if (!cred.mysql.banco) {
    const [bancos] = await my.query('SHOW DATABASES');
    const sistema = ['information_schema', 'mysql', 'performance_schema', 'sys'];
    console.log(`\nBancos visíveis para o usuário ${oculto(cred.mysql.usuario)}:\n`);
    for (const b of bancos) {
      const nome = Object.values(b)[0];
      console.log(`  ${nome}${sistema.includes(nome) ? '   (do próprio MySQL, ignore)' : ''}`);
    }
    console.log('\nPreencha "banco" em credenciais.json com o nome do banco do cliente');
    console.log('e rode "node espelho.mjs descobrir" de novo.');
    await my.end(); ssh.end();
    return;
  }

  const [tabelas] = await my.query(
    `SELECT TABLE_NAME, TABLE_ROWS
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
    [cred.mysql.banco]
  );

  console.log(`\n${tabelas.length} tabelas em ${oculto(cred.mysql.banco)}:\n`);
  for (const t of tabelas) {
    console.log(`  ${t.TABLE_NAME.padEnd(45)} ~${t.TABLE_ROWS ?? '?'} linhas`);
  }

  const destino = path.join(AQUI, 'tabelas.descobertas.json');
  fs.writeFileSync(destino, JSON.stringify({ tabelas: tabelas.map((t) => t.TABLE_NAME) }, null, 2));
  console.log(`\nLista completa salva em ${destino}`);
  console.log('Copie para tabelas.json SÓ as que você quer espelhar.');

  await my.end(); ssh.end();
}

// Mede o que é preciso saber ANTES de decidir se uma tabela cabe em recarga
// total: quantas linhas de verdade (TABLE_ROWS do information_schema é
// estimativa e erra feio no InnoDB), quais colunas serviriam de corte para
// carga incremental, e quanto tempo custa ler pelo túnel.
async function cmdPerfilar() {
  const pedidas = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const ssh = await abrirSsh();
  const my = await abrirMysql(ssh);

  let alvo = pedidas;
  if (!alvo.length) {
    const arq = path.join(AQUI, 'tabelas.json');
    alvo = fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')).tabelas : [];
  }
  if (!alvo.length) {
    console.error('diga quais tabelas perfilar. Ex.: node espelho.mjs perfilar BiMarcacoes');
    await my.end(); ssh.end();
    process.exit(1);
  }

  const AMOSTRA = 50_000;
  for (const tabela of alvo) {
    console.log(`\n=== ${tabela} ===`);
    const cols = await colunasDe(my, tabela);

    const [[{ n }]] = await my.query(`SELECT COUNT(*) AS n FROM ${crase(tabela)}`);
    console.log(`linhas (exato): ${Number(n).toLocaleString('pt-BR')}`);

    const pk = cols.filter((c) => c.COLUMN_KEY === 'PRI').map((c) => c.COLUMN_NAME);
    console.log(`chave primária: ${pk.join(' + ') || '(nenhuma)'}`);

    // Candidata a corte incremental: coluna de data/hora, ou chave numérica
    // que só cresce. Sem uma dessas, só resta recarga total.
    const datas = cols.filter((c) => /^(date|datetime|timestamp)$/i.test(c.DATA_TYPE)).map((c) => c.COLUMN_NAME);
    console.log(`colunas de data: ${datas.join(', ') || '(nenhuma)'}`);

    console.log(`colunas (${cols.length}): ${cols.map((c) => `${c.COLUMN_NAME}:${c.DATA_TYPE}`).join(', ')}`);

    const nomes = cols.map((c) => c.COLUMN_NAME);
    const t0 = Date.now();
    await my.query(`SELECT ${nomes.map(crase).join(', ')} FROM ${crase(tabela)} LIMIT ${AMOSTRA}`);
    const seg = (Date.now() - t0) / 1000;
    const lidas = Math.min(AMOSTRA, Number(n));
    console.log(`leitura: ${lidas.toLocaleString('pt-BR')} linhas em ${seg.toFixed(1)}s`);
    if (Number(n) > lidas && seg > 0) {
      const estimado = (seg / lidas) * Number(n) / 60;
      console.log(`estimativa da tabela inteira: ~${estimado.toFixed(1)} min só de leitura`);
    }

    for (const d of datas.slice(0, 3)) {
      const [[mm]] = await my.query(`SELECT MIN(${crase(d)}) AS ini, MAX(${crase(d)}) AS fim FROM ${crase(tabela)}`);
      console.log(`  intervalo de ${d}: ${mm.ini} .. ${mm.fim}`);
    }
  }

  await my.end(); ssh.end();
}

// Deixa em espelho.sincronizacoes uma linha por execução.
//
// Sem isto não dá para responder "atualizou hoje?": as contagens mudam pouco
// de um dia para o outro, então olhar a tabela de dados não distingue carga de
// hoje de sobra de ontem — e uma falha silenciosa só apareceria semanas depois.
async function registrar(pgc, { ok, inicio, resumo, erro = null }) {
  await pgc.query(`CREATE TABLE IF NOT EXISTS ${aspas(SCHEMA)}.sincronizacoes (
    id            bigserial PRIMARY KEY,
    iniciada_em   timestamptz NOT NULL,
    terminada_em  timestamptz NOT NULL DEFAULT now(),
    disparo       text NOT NULL,
    ok            boolean NOT NULL,
    completa      boolean NOT NULL,
    tabelas       integer NOT NULL,
    linhas        bigint  NOT NULL,
    segundos      numeric(10,1) NOT NULL,
    erro          text
  )`);

  // GITHUB_EVENT_NAME distingue o que interessa: "schedule" é o robô rodando
  // sozinho; qualquer outra coisa foi gente apertando o botão.
  const evento = process.env.GITHUB_EVENT_NAME;
  const disparo = evento === 'schedule' ? 'agendado'
    : evento ? 'manual (Actions)'
    : 'manual (máquina local)';

  await pgc.query(
    `INSERT INTO ${aspas(SCHEMA)}.sincronizacoes
       (iniciada_em, disparo, ok, completa, tabelas, linhas, segundos, erro)
     VALUES (to_timestamp($1/1000.0), $2, $3, $4, $5, $6, $7, $8)`,
    [inicio, disparo, ok, !LIMITE, resumo.length,
     resumo.reduce((s, r) => s + r.linhas, 0), (Date.now() - inicio) / 1000, erro]
  );
}

// ── conferir (15/10/2026) ─────────────────────────────────────────────
// "A Flex diz que os pontos entram a cada 15 minutos — entram mesmo?"
// Só LÊ a origem: batidas por dia (primeira e última hora), duplicadas
// exatas, a última modificação da tabela segundo o MySQL. Cada conferência
// fica em espelho.conferencias, e a saída compara com a anterior — rodando
// de 15 em 15 minutos, mostra se chegaram batidas novas e de quando.
const hhmm = (min) => (min == null ? '—' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`);

async function cmdConferir() {
  const argDias = process.argv.find((a) => a.startsWith('--dias'));
  const dias = argDias ? Number(argDias.includes('=') ? argDias.split('=')[1] : process.argv[process.argv.indexOf(argDias) + 1]) || 10 : 10;
  const ssh = await abrirSsh();
  const my = await abrirMysql(ssh);
  const todas = ['institution_id', 'empresa', 'matricula', 'numcra', 'data_hora', 'situacao', 'hora'].map(crase).join(', ');
  try {
    const [[relogio]] = await my.query('SELECT NOW() AS agora, CURDATE() AS hoje, @@system_time_zone AS fuso');
    const [[tab]] = await my.query(
      `SELECT UPDATE_TIME AS modificada, CREATE_TIME AS criada, TABLE_ROWS AS estimadas
         FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'BiMarcacoes'`, [cred.mysql.banco]);
    const [[tot]] = await my.query(`SELECT COUNT(*) AS total, MAX(data_hora) AS ultimo_dia FROM BiMarcacoes`);
    const [porDia] = await my.query(
      `SELECT DATE_FORMAT(data_hora, '%Y-%m-%d') AS dia, COUNT(*) AS batidas,
              COUNT(*) - COUNT(DISTINCT ${todas}) AS duplicadas, MIN(hora) AS primeira, MAX(hora) AS ultima
         FROM BiMarcacoes WHERE data_hora >= CURDATE() - INTERVAL ? DAY
        GROUP BY 1 ORDER BY 1`, [dias]);
    // Duplicada exata = mesma linha inteira repetida (a tabela não tem chave).
    const [[dup]] = await my.query(`SELECT COUNT(*) - COUNT(DISTINCT ${todas}) AS duplicadas FROM BiMarcacoes`);

    const foto = {
      agora_origem: relogio.agora, hoje_origem: relogio.hoje, fuso_origem: relogio.fuso,
      tabela_modificada: tab?.modificada ?? null, tabela_criada: tab?.criada ?? null,
      total: Number(tot.total), ultimo_dia: tot.ultimo_dia, duplicadas_total: Number(dup.duplicadas),
      por_dia: porDia.map((d) => ({ dia: d.dia, batidas: Number(d.batidas), duplicadas: Number(d.duplicadas), primeira: d.primeira == null ? null : Number(d.primeira), ultima: d.ultima == null ? null : Number(d.ultima) })),
    };

    console.log(`relógio da origem: ${foto.agora_origem} (${foto.fuso_origem})`);
    console.log(`tabela modificada pela última vez: ${foto.tabela_modificada ?? '(o MySQL não informa)'} · criada em ${foto.tabela_criada ?? '—'}`);
    console.log(`total: ${foto.total.toLocaleString('pt-BR')} batidas · duplicadas exatas: ${foto.duplicadas_total.toLocaleString('pt-BR')} · último dia com batida: ${foto.ultimo_dia}`);
    console.log(`\nbatidas por dia (últimos ${dias} dias):`);
    console.log('  dia          batidas  duplicadas  primeira  última');
    for (const d of foto.por_dia) {
      console.log(`  ${d.dia}  ${String(d.batidas).padStart(8)}  ${String(d.duplicadas).padStart(10)}  ${hhmm(d.primeira).padStart(8)}  ${hhmm(d.ultima).padStart(6)}`);
    }

    // Guarda e compara com a conferência anterior (fora de transação; não mexe em dado do espelho).
    const pgc = await abrirSupabase();
    try {
      await pgc.query(`CREATE TABLE IF NOT EXISTS ${aspas(SCHEMA)}.conferencias (
        id bigserial PRIMARY KEY, conferida_em timestamptz NOT NULL DEFAULT now(), tabela text NOT NULL, foto jsonb NOT NULL)`);
      const { rows: [ant] } = await pgc.query(
        `SELECT conferida_em, foto FROM ${aspas(SCHEMA)}.conferencias WHERE tabela = 'BiMarcacoes' ORDER BY id DESC LIMIT 1`);
      await pgc.query(`INSERT INTO ${aspas(SCHEMA)}.conferencias (tabela, foto) VALUES ('BiMarcacoes', $1)`, [foto]);
      if (ant) {
        const min = Math.round((Date.now() - new Date(ant.conferida_em).getTime()) / 60000);
        const antDia = new Map((ant.foto.por_dia || []).map((d) => [d.dia, d]));
        console.log(`\ndesde a conferência anterior (há ${min} min):`);
        console.log(`  total: ${(foto.total - ant.foto.total >= 0 ? '+' : '') + (foto.total - ant.foto.total).toLocaleString('pt-BR')} batidas`);
        for (const d of foto.por_dia) {
          const a = antDia.get(d.dia);
          const delta = d.batidas - (a?.batidas ?? 0);
          if (delta || (a && a.ultima !== d.ultima)) {
            console.log(`  ${d.dia}: ${delta >= 0 ? '+' : ''}${delta} batidas · última batida ${hhmm(a?.ultima ?? null)} -> ${hhmm(d.ultima)}`);
          }
        }
        if (foto.total === ant.foto.total) console.log('  nenhuma batida nova chegou nesse intervalo.');
      } else {
        console.log('\n(primeira conferência — rode de novo daqui a 15 minutos para comparar)');
      }
    } finally { await pgc.end(); }
  } finally {
    await my.end(); ssh.end();
  }
}

async function cmdSincronizar() {
  const inicio = Date.now();
  const arqTabelas = path.join(AQUI, 'tabelas.json');
  if (!fs.existsSync(arqTabelas)) {
    console.error('não achei tabelas.json — rode "node espelho.mjs descobrir" primeiro.');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(arqTabelas, 'utf8'));
  const alvo = config.tabelas;
  const incrementais = config.incremental || {};
  if (!Array.isArray(alvo) || !alvo.length) {
    console.error('tabelas.json está vazio. Liste ao menos uma tabela.');
    process.exit(1);
  }

  if (!COMMIT) console.log('=== SIMULAÇÃO — nada será gravado (use --commit para valer) ===\n');
  if (LIMITE) {
    console.log(`=== TESTE — só as ${LIMITE} primeiras linhas de cada tabela ===`);
    console.log('    O espelho fica PARCIAL. Para valer, rode depois sem --limite.\n');
  }
  if (alvo.length > 1 && LIMITE) {
    console.log(`(${alvo.length} tabelas listadas; para o teste de ponta a ponta, deixe só uma em tabelas.json)\n`);
  }

  const ssh = await abrirSsh();
  const my = await abrirMysql(ssh);
  const pgc = await abrirSupabase();

  await pgc.query('BEGIN');
  // A carga leva minutos; o statement_timeout padrão do papel derrubava a
  // rodada no meio ("canceling statement due to statement timeout").
  await pgc.query(`SET LOCAL statement_timeout = '20min'`);
  await pgc.query(`CREATE SCHEMA IF NOT EXISTS ${aspas(SCHEMA)}`);
  if (COMPLETO) console.log('=== COMPLETA — as tabelas incrementais também serão recarregadas inteiras ===\n');

  const resumo = [];
  try {
    for (const tabela of alvo) {
      const t0 = Date.now();
      const cols = await colunasDe(my, tabela);
      const nomes = cols.map((c) => c.COLUMN_NAME);
      const pk = cols.filter((c) => c.COLUMN_KEY === 'PRI').map((c) => c.COLUMN_NAME);

      const defs = cols.map((c) => `${aspas(c.COLUMN_NAME)} ${tipoPg(c)}`).join(', ');
      await pgc.query(`CREATE TABLE IF NOT EXISTS ${aspas(SCHEMA)}.${aspas(tabela)} (${defs})`);
      await alargarColunas(pgc, tabela, cols);

      // INCREMENTAL (15/10/2026): BiMarcacoes passou de 6 milhões de linhas e
      // a recarga inteira dentro da transação precisava do dobro do espaço
      // (a versão velha só sai no COMMIT) — encheu o disco do Supabase, que é
      // o mesmo do ERP. Para as tabelas em "incremental" (tabelas.json) só os
      // últimos N dias são apagados e trazidos de novo; o resto fica. Tabela
      // vazia (primeira carga) e --completo recarregam inteira.
      const regra = incrementais[tabela];
      let filtro = '';
      if (regra && !COMPLETO && !LIMITE) {
        if (!nomes.includes(regra.coluna)) throw new Error(`incremental de ${tabela}: coluna "${regra.coluna}" não existe na origem`);
        const { rows: [{ tem }] } = await pgc.query(`SELECT EXISTS (SELECT 1 FROM ${aspas(SCHEMA)}.${aspas(tabela)}) AS tem`);
        if (tem) {
          const corte = dataDeCorte(Number(regra.dias) || 45);
          await pgc.query(`DELETE FROM ${aspas(SCHEMA)}.${aspas(tabela)} WHERE ${aspas(regra.coluna)} >= $1`, [corte]);
          filtro = ` WHERE ${crase(regra.coluna)} >= '${corte}'`;
          console.log(`  ${tabela}: incremental desde ${corte} (${regra.coluna})`);
        }
      }
      // Recarga inteira dentro da transação: some qualquer linha que o
      // cliente apagou na origem, sem precisar rastrear exclusão.
      if (!filtro) await pgc.query(`TRUNCATE ${aspas(SCHEMA)}.${aspas(tabela)}`);

      // Origem é MySQL: crase, não aspas.
      const sql = `SELECT ${nomes.map(crase).join(', ')} FROM ${crase(tabela)}` + filtro +
                  (LIMITE ? ` LIMIT ${LIMITE}` : '');

      // Streaming + COPY, e não "carrega tudo e insere em lotes". Com 3,5
      // milhões de linhas, o jeito antigo faria ~7.100 idas e voltas até o
      // Supabase e ainda seguraria a tabela inteira na memória do runner.
      // O COPY é o carregador em massa do Postgres: uma conexão só, fluxo
      // contínuo, memória constante.
      const colsSql = nomes.map(aspas).join(', ');
      const destino = pgc.query(copyFrom(
        `COPY ${aspas(SCHEMA)}.${aspas(tabela)} (${colsSql}) FROM STDIN WITH (FORMAT csv, NULL '\\N')`
      ));

      let linhas = 0;
      const origem = my.connection.query(sql).stream();
      const paraCsv = new Transform({
        objectMode: true,
        transform(linha, _cod, pronto) {
          linhas++;
          pronto(null, nomes.map((n) => csv(linha[n])).join(',') + '\n');
        },
      });

      await pipeline(origem, paraCsv, destino);

      // A PK da origem vira índice único aqui — o espelho fica consultável
      // com a mesma chave, e uma origem duplicada estoura em vez de passar.
      if (pk.length) {
        const nomeIdx = `${tabela}_pk_espelho`.slice(0, 63);
        await pgc.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${aspas(nomeIdx)}
             ON ${aspas(SCHEMA)}.${aspas(tabela)} (${pk.map(aspas).join(', ')})`
        );
      }

      resumo.push({ tabela, linhas, pk: pk.join('+') || '(sem PK)' });
      const seg = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${tabela.padEnd(34)} ${String(linhas).padStart(9)} linhas  ${seg.padStart(6)}s`);
    }

    await pgc.query(COMMIT ? 'COMMIT' : 'ROLLBACK');
    if (COMMIT) await registrar(pgc, { ok: true, inicio, resumo });
  } catch (e) {
    await pgc.query('ROLLBACK');
    // Registra a falha FORA da transação — se fosse dentro, o próprio rollback
    // apagaria o registro justamente no caso em que o histórico importa.
    if (COMMIT) await registrar(pgc, { ok: false, inicio, resumo, erro: e.message }).catch(() => {});
    throw e;
  } finally {
    await my.end(); ssh.end(); await pgc.end();
  }

  const total = resumo.reduce((s, r) => s + r.linhas, 0);
  console.log(`\n${resumo.length} tabelas, ${total} linhas — ${COMMIT ? 'GRAVADO' : 'simulado (rollback)'}`);
}

// ── execução ─────────────────────────────────────────────────────────
try {
  if (COMANDO === 'testar') await cmdTestar();
  else if (COMANDO === 'descobrir') await cmdDescobrir();
  else if (COMANDO === 'perfilar') await cmdPerfilar();
  else if (COMANDO === 'conferir') await cmdConferir();
  else await cmdSincronizar();
  process.exit(0);
} catch (e) {
  console.error(`\nFALHOU: ${e.message}`);
  if (/ETIMEDOUT|ECONNREFUSED|timed out/i.test(e.message)) {
    console.error('\nTimeout no túnel tem duas causas comuns:');
    console.error('  1. a SUA rede bloqueia a porta 22 na saída — teste com:');
    console.error('     Test-NetConnection github.com -Port 22');
    console.error('     se der False, o bloqueio é local e vale para qualquer destino;');
    console.error('  2. o servidor de destino só aceita SSH de IPs autorizados.');
    console.error('Veja o README para os caminhos de cada caso.');
  }
  process.exit(1);
}
