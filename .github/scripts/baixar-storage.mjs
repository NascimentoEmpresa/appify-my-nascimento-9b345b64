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
import { writeFileSync, readFileSync, existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const URL_SUPABASE = process.env.SUPABASE_URL?.replace(/\/$/, '');
const CHAVE = process.env.SERVICE_ROLE_KEY;
const CREDENCIAIS = process.env.CREDENCIAIS;

if (!URL_SUPABASE || !CHAVE) {
  console.error('FALTAM SUPABASE_URL ou SERVICE_ROLE_KEY');
  process.exit(1);
}

const log = (...a) => console.log('  ', ...a);

// --- 1. listar o que existe, direto do banco --------------------------------
// Por psql e nao pela biblioteca `pg`: ela nao esta nas dependencias do projeto
// (este e um app de frontend), e o runner ja instala o cliente Postgres 17 para
// o backup do banco. Uma dependencia a menos para manter.
// O separador e TAB porque nome de arquivo pode conter virgula e ponto-virgula,
// mas nao TAB.
const cfg = JSON.parse(CREDENCIAIS).supabase;
const consulta = `
  select bucket_id || E'\\t' || name || E'\\t' ||
         coalesce(to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') || E'\\t' ||
         coalesce((metadata->>'size')::bigint, 0)
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
  const [bucket_id, name, updated_at, tamanho] = linha.split('\t');
  return { bucket_id, name, updated_at, tamanho: Number(tamanho || 0) };
});

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
// ser o motivo de ela caber menos requisicao do ERP. 6 por vez e suficiente
// para terminar rapido sem sufocar ninguem.
const SIMULTANEOS = 6;
let baixados = 0, falhas = 0, bytes = 0;
const errosPorTipo = new Map();

async function baixarUm(obj) {
  const caminho = `${obj.bucket_id}/${obj.name}`;
  const destino = join('arquivos', caminho);
  const endereco = `${URL_SUPABASE}/storage/v1/object/${encodeURI(caminho)}`;
  try {
    const resp = await fetch(endereco, { headers: { Authorization: `Bearer ${CHAVE}`, apikey: CHAVE } });
    if (!resp.ok) {
      falhas++;
      const t = `HTTP ${resp.status}`;
      errosPorTipo.set(t, (errosPorTipo.get(t) || 0) + 1);
      return;
    }
    mkdirSync(dirname(destino), { recursive: true });
    await pipeline(Readable.fromWeb(resp.body), createWriteStream(destino));
    baixados++;
    bytes += Number(obj.tamanho);
    if (baixados % 250 === 0) log(`${baixados}/${paraBaixar.length} baixados...`);
  } catch (e) {
    falhas++;
    const t = e.message.slice(0, 40);
    errosPorTipo.set(t, (errosPorTipo.get(t) || 0) + 1);
  }
}

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
  const baixouAgora = existsSync(join('arquivos', chave));
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
