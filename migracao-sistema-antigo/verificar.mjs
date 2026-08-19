// =====================================================================
// CONFERÊNCIA origem × destino, por diferença de conjunto de ids.
//
// Contar linha dos dois lados não prova nada: o sistema antigo continua vivo,
// então os totais se movem entre uma consulta e outra, e um total igual pode
// esconder uma linha faltando de um lado e uma sobrando do outro.
//
// Aqui a pergunta é outra: QUAIS ids da origem não estão no destino, e quais
// ids do destino não existem mais na origem. É isso que responde "a migração
// deixou dado para trás?".
//
// Uso: node verificar.mjs
// =====================================================================
import pg from 'pg';
import fs from 'node:fs';

const origem = new pg.Client({
  host: 'dpg-d5kjj3ggjchc73cop0c0-a.oregon-postgres.render.com',
  port: 5432, user: 'erp_nascimento_user', database: 'erp_nascimento',
  password: fs.readFileSync(process.env.RENDER_PW_FILE, 'utf8').trim(),
  ssl: { rejectUnauthorized: false },
});
const destino = new pg.Client({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 5432, user: 'postgres.fwmzeaztjxrxxzxzxmgc', database: 'postgres',
  password: process.env.SUPABASE_PW,
  ssl: { rejectUnauthorized: false },
});

const CASOS = [
  { nome: 'pedidos',         sqlO: 'select id from pedidos_site_externo',
    sqlD: `select legado_id id from public.sup_pedido where legado_origem='pedidos_site_externo'` },
  { nome: 'etiquetas',       sqlO: 'select id from estoque_tags',
    sqlD: `select legado_id id from public.sup_estoque_tag where legado_origem='estoque_tags'` },
  { nome: 'consumo',         sqlO: 'select id from estoque_tags_consumo',
    sqlD: `select legado_id id from public.sup_estoque_consumo where legado_origem='estoque_tags_consumo'` },
  { nome: 'logs manutencao', sqlO: 'select id from manutencao_logs',
    sqlD: `select legado_id id from public.sup_patrimonio_log where legado_origem='manutencao_logs'` },
  { nome: 'anexos veiculo',  sqlO: 'select id from veiculos_arquivos',
    sqlD: `select legado_id id from public.sup_patrimonio_arquivo where legado_origem='veiculos_arquivos'` },
  { nome: 'anexos equip',    sqlO: 'select id from equipamentos_arquivos',
    sqlD: `select legado_id id from public.sup_patrimonio_arquivo where legado_origem='equipamentos_arquivos'` },
  { nome: 'cat lotes',       sqlO: 'select id from lotes_alteracoes_catalogo',
    sqlD: `select legado_id id from public.sup_cat_lote where legado_origem='lotes_alteracoes_catalogo'` },
  { nome: 'cat alteracoes',  sqlO: 'select id from alteracoes_catalogo_site_externo',
    sqlD: `select legado_id id from public.sup_cat_alteracao where legado_origem='alteracoes_catalogo_site_externo'` },
  { nome: 'cotacoes',        sqlO: 'select id from cotacoes_impugnacoes',
    sqlD: `select legado_id id from public.cotacoes_licitacao where legado_origem='cotacoes_impugnacoes'` },
];

const rel = [];
await origem.connect(); await destino.connect();
// Um instante só para todas as consultas da origem, senão cada tabela é lida
// num momento diferente e a comparação mistura estados.
await origem.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');

for (const c of CASOS) {
  const o = new Set((await origem.query(c.sqlO)).rows.map((r) => r.id));
  const d = new Set((await destino.query(c.sqlD)).rows.map((r) => r.id));
  const faltando = [...o].filter((x) => !d.has(x));
  const sobrando = [...d].filter((x) => !o.has(x));
  rel.push({ nome: c.nome, origem: o.size, destino: d.size, faltando, sobrando });
}

await origem.query('ROLLBACK');
await origem.end(); await destino.end();

console.log('tabela             origem  destino   FALTA  sobra(apagado na origem)');
console.log('─'.repeat(72));
for (const r of rel) {
  console.log(
    r.nome.padEnd(18) +
    String(r.origem).padStart(6) + String(r.destino).padStart(9) +
    String(r.faltando.length).padStart(8) + String(r.sobrando.length).padStart(8));
}
console.log('\nIds que FALTAM no destino (o que importa):');
let algo = false;
for (const r of rel) {
  if (!r.faltando.length) continue;
  algo = true;
  const amostra = r.faltando.slice(0, 30).join(', ');
  console.log(`  ${r.nome}: ${r.faltando.length} → ${amostra}${r.faltando.length > 30 ? ' …' : ''}`);
}
if (!algo) console.log('  nenhum.');
