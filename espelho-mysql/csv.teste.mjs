// Testa csv() contra um Postgres DE VERDADE, não contra a minha ideia de como
// o COPY se comporta. Escreve valores maldosos, lê de volta e compara.
//
// Roda num schema próprio, que é derrubado no fim. Não toca em nada do ERP.
//
// Uso: node csv.teste.mjs
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csv } from './csv.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARQ = process.env.ESPELHO_CREDENCIAIS || path.join(AQUI, 'credenciais.json');
const c = JSON.parse(fs.readFileSync(ARQ, 'utf8')).supabase;
if (process.env.SUPABASE_SENHA) c.senha = process.env.SUPABASE_SENHA;

const SCHEMA = 'espelho_teste_csv';

// [valor de texto, número, bytea, descrição do que está sendo provado]
const CASOS = [
  ['texto simples', 1, Buffer.from('abc'), 'caso comum'],
  [null, 2, null, 'nulo continua nulo'],
  ['', 3, null, 'texto vazio NÃO vira nulo'],
  ['tem, vírgula', 4, null, 'vírgula não desloca coluna'],
  ['tem " aspas', 5, null, 'aspa dobrada'],
  ['tem\nquebra de linha', 6, null, 'quebra de linha dentro do valor'],
  ['barra \\ invertida', 7, null, 'barra invertida é literal em modo CSV'],
  ['\\N', 8, null, 'o texto "\\N" não pode virar nulo'],
  ['acento çãé 日本 🙂', 9, null, 'unicode'],
  ['   espaços   ', 10, null, 'espaços das pontas preservados'],
];

const cli = new pg.Client({
  host: c.host, port: c.porta ?? 5432, user: c.usuario,
  database: c.banco ?? 'postgres', password: c.senha,
  ssl: { rejectUnauthorized: false },
});

let falhas = 0;
await cli.connect();
try {
  await cli.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await cli.query(`CREATE SCHEMA ${SCHEMA}`);
  await cli.query(`CREATE TABLE ${SCHEMA}.t (a text, n integer, d bytea)`);

  const linhas = CASOS.map((caso) => caso.slice(0, 3).map(csv).join(',') + '\n');
  await pipeline(
    Readable.from(linhas),
    cli.query(copyFrom(`COPY ${SCHEMA}.t (a, n, d) FROM STDIN WITH (FORMAT csv, NULL '\\N')`))
  );

  const { rows } = await cli.query(`SELECT a, n, d FROM ${SCHEMA}.t ORDER BY n`);
  if (rows.length !== CASOS.length) {
    console.log(`FALHA: gravou ${rows.length} linhas, esperava ${CASOS.length}`);
    falhas++;
  }

  for (let i = 0; i < CASOS.length; i++) {
    const [esperado, , bytea, descricao] = CASOS[i];
    const obtido = rows[i]?.a;
    const ok = esperado === obtido;
    if (!ok) falhas++;
    console.log(`${ok ? '  ok  ' : 'FALHA'} | ${descricao}`);
    if (!ok) console.log(`         esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);

    if (bytea) {
      const voltou = rows[i]?.d;
      const okB = Buffer.isBuffer(voltou) && voltou.equals(bytea);
      if (!okB) falhas++;
      console.log(`${okB ? '  ok  ' : 'FALHA'} | bytea preservado`);
    }
  }
} finally {
  await cli.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await cli.end();
}

console.log(falhas === 0 ? '\nTODOS OS CASOS PASSARAM' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
