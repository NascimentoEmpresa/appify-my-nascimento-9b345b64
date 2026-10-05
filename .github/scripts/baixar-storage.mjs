// ============================================================================
//  Baixa os arquivos do Storage da Supabase, de forma incremental
// ============================================================================
//
//  POR QUE ISTO EXISTE
//  O backup do banco guarda os REGISTROS dos arquivos, nao os arquivos. Medido
//  em 02/10/2026: 7.735 objetos, ~4,4 GB, existindo em UM lugar so - a conta da
//  Supabase. Perder a conta significava perder anexo de patrimonio, foto de
//  cracha e XML de nota, sem copia em lugar nenhum.
//
//  POR QUE LISTAR PELO BANCO E NAO PELA API DE STORAGE
//  A API lista por pasta, com paginacao, e exige uma chamada por nivel - para
//  7.735 arquivos espalhados em buckets com subpastas isso vira centenas de
//  requisicoes. A tabela storage.objects ja tem tudo: bucket, caminho, tamanho
//  e updated_at, numa consulta so. E o updated_at e exatamente o que torna a
//  copia incremental possivel.
//
//  O INVENTARIO
//  Um arquivo texto com "bucket/caminho<TAB>updated_at" por linha. Na execucao
//  seguinte, baixa-se so o que nao esta nele ou cuja data mudou. Sem ele a
//  copia e completa - correta, so demorada.
// ============================================================================
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { execFileSync, execFile } from 'node:child_process';

const CHAVE = process.env.SERVICE_ROLE_KEY;
const CREDENCIAIS = process.env.CREDENCIAIS;

if (!CHAVE || !CREDENCIAIS) {
  console.error('FALTAM SUPABASE_SERVICE_ROLE_KEY ou ESPELHO_CREDENCIAIS');
  process.exit(1);
}

// A URL do projeto NAO vem de um secret proprio: nao existe SUPABASE_URL neste
// repositorio (conferido em 02/10/2026 - a primeira execucao falhou com
// "FALTAM SUPABASE_URL" porque o secret estava vazio). Ela e derivada do host
// do banco, que ja esta no ESPELHO_CREDENCIAIS:
//     aws-1-sa-east-1.pooler.supabase.com  +  usuario postgres.<ref>
//  -> https://<ref>.supabase.co
// Assim nao se cria segredo novo para guardar uma informacao que ja esta ali.
const cfg = JSON.parse(CREDENCIAIS).supabase;
const REF = String(cfg.usuario).includes('.')
  ? String(cfg.usuario).split('.').pop()
  : null;
if (!REF) {
  console.error(`::error::nao consegui extrair a referencia do projeto do usuario "${cfg.usuario}"`);
  process.exit(1);
}
const URL_SUPABASE = `https://${REF}.supabase.co`;
console.log('  projeto:', URL_SUPABASE);

const log = (...a) => console.log('  ', ...a);

// --- 1. listar o que existe, direto do banco --------------------------------
// Por psql e nao pela biblioteca `pg`: ela nao esta nas dependencias do projeto
// (este e um app de frontend), e o runner ja instala o cliente Postgres 17 para
// o backup do banco. Uma dependencia a menos para manter.
// O separador e TAB porque nome de arquivo pode conter virgula e ponto-virgula,
// mas nao TAB.
const consulta = `
  select bucket_id || E'\\t' || name || E'\\t' ||
         coalesce(to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') || E'\\t' ||
         coalesce((metadata->>'size')::bigint, 0) || E'\\t' ||
         coalesce(version::text, '')
    from storage.objects
   where bucket_id is not null and name is not null
   order by bucket_id, name
`;

const saida = execFileSync('psql', ['-At', '-c', consulta], {
  env: {
    ...process.env,
    PGHOST: cfg.host, PGPORT: String(cfg.porta), PGUSER: cfg.usuario,
    PGDATABASE: cfg.banco, PGPASSWORD: cfg.senha, PGSSLMODE: 'require',
  },
  maxBuffer: 256 * 1024 * 1024,
  encoding: 'utf8',
});

const rows = saida.split('\n').filter(Boolean).map((linha) => {
  const [bucket_id, name, updated_at, tamanho, version] = linha.split('\t');
  return { bucket_id, name, updated_at, tamanho: Number(tamanho || 0), version: version || '' };
});

// POR QUE O BACKUP GRAVA <balde>/<nome>/<versao>, E NAO <balde>/<nome>
//
// Porque e esse o formato que o storage-api espera em disco: <nome> e um
// DIRETORIO e o arquivo real se chama com o UUID de storage.objects.version.
//
// A versao anterior gravava <balde>/<nome> como arquivo comum, e a replica
// convertia depois da extracao. Essa conversao era justamente o que fazia a
// carga SEGUINTE colidir: o tar tentava gravar um arquivo onde a conversao
// havia criado um diretorio, e recusava (medido em 05/10/2026):
//
//     tar: whatsapp-midia/wa/1480519754175453: Cannot open: File exists
//
// O efeito pratico era grave: objeto ATUALIZADO nunca chegava na replica.
//
// A tentacao e resolver no restauro, mandando o tar apagar o que estorva.
// Tentei, com --recursive-unlink, e o tar apagou diretorio inteiro de forma
// recursiva: o acervo caiu de 8.936 para 1.936 arquivos. Gravando no formato
// certo na ORIGEM, nao ha conversao, e sem conversao nao ha colisao.
//
// Objeto sem versao (ha 1 na producao) continua no formato antigo - a replica
// ainda sabe converter esse caso.
// O nome vem do BANCO, nao de mim. Hoje nenhum dos ~8.900 objetos tem "../"
// (conferido em 05/10/2026 nos quatro padroes: ../, inicio com .., barra
// inicial e barra dupla), mas se um aparecer o arquivo seria gravado FORA de
// arquivos/ e sumiria do artefato EM SILENCIO - o backup pareceria completo
// sem estar, que e a pior falha possivel num backup.
//
// Devolve null nesse caso, e quem chama trata como falha, para o objeto NAO
// entrar no inventario como coberto - assim a proxima execucao tenta de novo
// em vez de considera-lo salvo para sempre.
const RAIZ_ARQUIVOS = resolve('arquivos');

function caminhoEmDisco(obj) {
  const alvo = obj.version
    ? join('arquivos', obj.bucket_id, obj.name, obj.version)
    : join('arquivos', obj.bucket_id, obj.name);
  const absoluto = resolve(alvo);
  if (absoluto !== RAIZ_ARQUIVOS && !absoluto.startsWith(RAIZ_ARQUIVOS + sep)) return null;
  return alvo;
}

const totalBytes = rows.reduce((s, r) => s + Number(r.tamanho), 0);
log(`${rows.length} objetos na producao, ${(totalBytes / 1073741824).toFixed(2)} GB`);

if (rows.length === 0) {
  console.error('::error::storage.objects veio vazio - isso nao deveria acontecer');
  process.exit(1);
}

// --- 2. o que ja foi copiado antes ------------------------------------------
const conhecidos = new Map();
if (existsSync('inventario.txt')) {
  for (const linha of readFileSync('inventario.txt', 'utf8').split('\n')) {
    const [chave, quando] = linha.split('\t');
    if (chave) conhecidos.set(chave, quando);
  }
  log(`${conhecidos.size} arquivos ja conhecidos do inventario`);
}

const paraBaixar = rows.filter((r) => {
  const chave = `${r.bucket_id}/${r.name}`;
  // Ja vem como ISO do psql. Converter de novo seria redundante e, pior:
  // `new Date('').toISOString()` LANCA excecao, e updated_at pode vir vazio.
  const quando = r.updated_at || '';
  return conhecidos.get(chave) !== quando;
});
log(`${paraBaixar.length} arquivos novos ou alterados`);

// --- 3. baixar -------------------------------------------------------------
// Em paralelo moderado: a Supabase e uma instancia Small e este job nao pode
// ser o motivo de ela caber menos requisicao do ERP. 6 por vez termina rapido
// sem sufocar ninguem - medido: 8.522 arquivos em 27 minutos, com a latencia
// da producao entre 0,09s e 0,14s (linha de base 0,10s).
const SIMULTANEOS = 6;

// POR QUE curl E NAO O fetch DO NODE
// A primeira versao usava fetch + stream. Ela morreu no meio da segunda
// execucao real com
//     AssertionError [ERR_ASSERTION]: assert(!this.paused)
//       at Parser.finish (node:internal/deps/undici/undici)
// que e o undici quebrando quando a conexao cai no meio de um stream. O erro
// e lancado FORA da pilha do await: nenhum try/catch pega, e o processo
// inteiro cai levando junto os milhares de arquivos ja baixados.
//
// curl nao tem esse problema, ja traz --retry com espera progressiva, respeita
// --max-time por arquivo e escreve direto no destino sem passar pela memoria
// do Node. Um processo por arquivo custa alguns milissegundos - irrelevante
// perto de um download de rede.
const TENTATIVAS = 3;

function baixarUm(obj) {
  return new Promise((pronto) => {
    const caminho = `${obj.bucket_id}/${obj.name}`;
    const destino = caminhoEmDisco(obj);
    if (!destino) {
      log(`  RECUSADO: o nome sairia de arquivos/ -> ${caminho}`);
      pronto(false);
      return;
    }
    const endereco = `${URL_SUPABASE}/storage/v1/object/${encodeURI(caminho)}`;
    mkdirSync(dirname(destino), { recursive: true });
    execFile(
      'curl',
      [
        '-sS', '--fail',              // --fail: 4xx/5xx viram codigo de saida
        // Sem --retry-all-errors de proposito: testado em 02/10/2026, ele
        // repete ate um 401, que nunca vai funcionar - quatro tentativas
        // inuteis por arquivo, castigando a producao. O padrao do --retry ja
        // cobre exatamente o que interessa: tempo esgotado, 408, 429 e 5xx,
        // que sao os 504 de arquivo grande vistos na primeira execucao.
        '--retry', String(TENTATIVAS),
        '--retry-delay', '2',
        '--max-time', '180',
        '-o', destino,
        '-H', `Authorization: Bearer ${CHAVE}`,
        '-H', `apikey: ${CHAVE}`,
        endereco,
      ],
      { maxBuffer: 1024 * 1024 },
      (erro, _saida, errSaida) => {
        if (erro) {
          falhas++;
          // O codigo do curl diz mais que a mensagem: 22 = HTTP >= 400,
          // 28 = tempo esgotado, 56 = conexao cortada no meio.
          const t = `curl ${erro.code ?? '?'}${/HTTP (\d+)/.exec(errSaida || '')?.[1] ? ` HTTP ${/HTTP (\d+)/.exec(errSaida)[1]}` : ''}`;
          errosPorTipo.set(t, (errosPorTipo.get(t) || 0) + 1);
          // Meio arquivo e pior que nenhum: ele entraria no inventario como
          // copiado e nunca mais seria tentado.
          try { if (existsSync(destino)) rmSync(destino); } catch { /* nada a fazer */ }
        } else {
          baixados++;
          bytes += Number(obj.tamanho);
          if (baixados % 250 === 0) log(`${baixados}/${paraBaixar.length} baixados...`);
        }
        pronto();
      },
    );
  });
}

let baixados = 0, falhas = 0, bytes = 0;
const errosPorTipo = new Map();

const fila = [...paraBaixar];
await Promise.all(
  Array.from({ length: SIMULTANEOS }, async () => {
    while (fila.length) await baixarUm(fila.shift());
  }),
);

log(`baixados: ${baixados}   falhas: ${falhas}   ${(bytes / 1048576).toFixed(0)} MB`);
if (falhas) {
  log('falhas por tipo:');
  for (const [tipo, n] of [...errosPorTipo].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    log(`  ${n}x  ${tipo}`);
  }
}

// --- 4. o inventario reflete o que REALMENTE esta copiado -------------------
// So entra no inventario o que baixou agora ou ja estava la de antes. Um
// arquivo que falhou NAO entra - assim a proxima execucao tenta de novo, em
// vez de considera-lo copiado para sempre.
const novoInventario = [];
for (const r of rows) {
  const chave = `${r.bucket_id}/${r.name}`;
  // Ja vem como ISO do psql. Converter de novo seria redundante e, pior:
  // `new Date('').toISOString()` LANCA excecao, e updated_at pode vir vazio.
  const quando = r.updated_at || '';
  const jaEstava = conhecidos.get(chave) === quando;
  const emDisco = caminhoEmDisco(r);
  const baixouAgora = emDisco ? existsSync(emDisco) : false;
  if (jaEstava || baixouAgora) novoInventario.push(`${chave}\t${quando}`);
}
writeFileSync('inventario.txt', novoInventario.join('\n'));
log(`inventario: ${novoInventario.length} de ${rows.length} arquivos cobertos`);

// Falhar aqui e melhor que publicar um backup que parece completo e nao e.
const cobertura = novoInventario.length / rows.length;
if (cobertura < 0.95) {
  console.error(`::error::so ${(cobertura * 100).toFixed(1)}% dos arquivos estao cobertos`);
  process.exit(1);
}
