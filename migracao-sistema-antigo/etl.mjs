// =====================================================================
// ETL — sistema antigo (Postgres na Render) -> Supabase
//
// Uso:  node etl.mjs <fase> [--commit]
//       fases: referencias | pedidos | estoque | patrimonio | catalogo | cotacoes
//       sem --commit é SIMULAÇÃO: faz tudo e dá ROLLBACK no fim.
//
// A origem é lida em REPEATABLE READ: o sistema antigo continua em uso e as
// contagens mudam durante a execução (pedidos foram de 1.226 a 1.230 durante
// o levantamento). Todas as fases precisam enxergar o mesmo instante.
//
// A carga é idempotente por (legado_origem, legado_id): rodar de novo não
// duplica. Onde não existe id de origem (item e posto nascem de texto livre),
// a chave é o nome normalizado dentro da empresa/contrato.
// =====================================================================
import pg from 'pg';
import fs from 'node:fs';

const FASE = process.argv[2];
const COMMIT = process.argv.includes('--commit');
const BASE = 'c:/Users/Eduardo Monteiro/Desktop/Projeto_ERP_LOVABLE/migracao-sistema-antigo';

const FASES = ['referencias', 'pedidos', 'estoque', 'patrimonio', 'catalogo', 'cotacoes'];
if (!FASES.includes(FASE)) {
  console.error(`fase invalida. use uma de: ${FASES.join(' | ')}`);
  process.exit(1);
}

// ── conexões ─────────────────────────────────────────────────────────
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

// ── utilidades de texto ──────────────────────────────────────────────
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const norm = (s) => semAcento(s).toUpperCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const frouxa = (s) => norm(s).replace(/[^A-Z0-9]/g, '');
const vazio = (s) => !s || !String(s).trim();

// tipo_item do legado é texto livre e sujo (25 valores para ~5 categorias,
// com duplicata por espaço à direita e lixo tipo "eeeeeeeeeee", "u", "1").
function tipoItem(bruto) {
  const t = norm(bruto);
  if (/^UNIFORM|^UNI$|^U$/.test(t)) return 'uniforme';
  if (/^EPI/.test(t)) return 'epi';
  if (/^INSUM|^INS$|CONSUMIVEL|LIMPEZA/.test(t)) return 'insumo';
  return 'equipamento';
}
const tipoDoPedido = { uniforme: 'uniforme', insumos: 'insumo', ambos: 'uniforme' };

function lerPipe(arquivo) {
  return fs.readFileSync(`${BASE}/${arquivo}`, 'utf8').split(/\r?\n/).slice(1)
    .filter((l) => l && !/^\(\d+ linha/.test(l)).map((l) => l.split('|'));
}

// ── de-para de contrato, já conferido ────────────────────────────────
// Os três de baixo não saíram do algoritmo: foram confirmados por evidência.
//   0672019 -> 048/2026 : os 24 postos batem um a um
//   CANOINHAS - EMBRAPA -> 47/2024 : o posto de destino tem esse nome exato
//   VERANOPOLIS RECEPÇÃO-011.2026 -> 151/2026 : decisão do Eduardo (17/08/2026)
const CONTRATO_MANUAL = {
  'BENTO GONÇALVES LIMPEZA 0672019': 'e30b03a4-9ecc-4cd1-8e71-8e68c93ab202',
  'CANOINHAS - EMBRAPA': 'f372953a-9a98-43ef-978d-0d63fb930d4d',
  'VERANOPOLIS RECEPÇÃO-011.2026': '5ad2d171-6855-470a-ab22-747e2a6e18f8',
};
const POSTO_MANUAL = { // origem "CAT (Centro de Atenção ao Turista) Praça Dante Alighieri"
  'CAT (Centro de Atenção ao Turista) Praça Dante Alighieri': 'CAT PRAÇAS',
};

function deparaContratos() {
  const m = new Map();
  for (const [origemNome, , , , id] of lerPipe('depara_contratos_pedidos.txt')) if (id) m.set(origemNome, id);
  for (const [k, v] of Object.entries(CONTRATO_MANUAL)) m.set(k, v);
  return m;
}

// ── estado compartilhado, carregado do destino ───────────────────────
const D = {};
async function carregarDestino() {
  const q = async (sql, p) => (await destino.query(sql, p)).rows;
  D.empresas = await q('select id, nome_fantasia from public.empresas');
  D.contratos = await q('select id, nome, empresa_id from public.contratos');
  D.postos = await q('select id, nome, contrato_id from public.sup_posto');
  D.funcoes = await q('select f.id, f.nome, f.posto_id, p.contrato_id from public.sup_funcao f join public.sup_posto p on p.id=f.posto_id');
  D.itens = await q('select id, nome, tipo, empresa_id from public.sup_item');
  D.almox = await q('select id, nome, empresa_id from public.almoxarifado');

  D.empresaDoContrato = new Map(D.contratos.map((c) => [c.id, c.empresa_id]));
  D.postoPorContrato = new Map();
  for (const p of D.postos) {
    if (!D.postoPorContrato.has(p.contrato_id)) D.postoPorContrato.set(p.contrato_id, new Map());
    D.postoPorContrato.get(p.contrato_id).set(frouxa(p.nome), p);
  }
  D.funcaoPorPosto = new Map();
  for (const f of D.funcoes) {
    if (!D.funcaoPorPosto.has(f.posto_id)) D.funcaoPorPosto.set(f.posto_id, new Map());
    D.funcaoPorPosto.get(f.posto_id).set(frouxa(f.nome), f);
  }
  D.itemPorEmpresa = new Map();
  for (const i of D.itens) {
    if (!D.itemPorEmpresa.has(i.empresa_id)) D.itemPorEmpresa.set(i.empresa_id, new Map());
    D.itemPorEmpresa.get(i.empresa_id).set(frouxa(i.nome), i);
  }
  D.HAGG = D.empresas.find((e) => e.nome_fantasia === 'HAGG')?.id;
  D.almoxHAGG = D.almox.find((a) => a.empresa_id === D.HAGG)?.id;
}

// tokens, para casar posto quando a importação anterior renomeou
// ("UFRGS-CAMPUS SAUDE-047" virou "CAMPUS SAUDE")
const RUIDO = new Set(['CAMPUS','UFRGS','UFFS','FURG','SEMAE','DMAE','IPASEM','IPAM','DE','DA','DO','DOS','DAS','E','A','O','POSTO','UNIDADE','SETOR']);
const toks = (s, num) => new Set(norm(s).split(/[^A-Z0-9']+/).filter(Boolean)
  .filter((t) => !RUIDO.has(t)).filter((t) => !(num && +t === +num)));
const mesmoConj = (a, b) => a.size === b.size && [...a].every((t) => b.has(t));
const numeroContrato = (s) => {
  const m = norm(s).match(/(\d{2,5})[.\/ ](?:19|20)\d{2}/) || norm(s).match(/\b(\d{3})(?:19|20)\d{2}\b/);
  return m ? String(+m[1]) : null;
};

function acharPosto(contratoId, nomePosto, contratoNomeAntigo) {
  const m = D.postoPorContrato.get(contratoId);
  if (!m) return null;
  const alvo = POSTO_MANUAL[nomePosto] ?? nomePosto;
  const exato = m.get(frouxa(alvo));
  if (exato) return exato;
  const num = numeroContrato(contratoNomeAntigo || '');
  const tA = toks(alvo, num);
  for (const p of m.values()) if (mesmoConj(tA, toks(p.nome, num))) return p;
  const sub = [...m.values()].filter((p) => { const tB = toks(p.nome, num);
    return tB.size && ([...tB].every((t) => tA.has(t)) || [...tA].every((t) => tB.has(t))); });
  return sub.length === 1 ? sub[0] : null;
}

// ── execução ─────────────────────────────────────────────────────────
const resumo = [];
const conta = (rotulo, n) => resumo.push([rotulo, n]);

async function main() {
  await origem.connect();
  await destino.connect();
  await origem.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await destino.query('BEGIN');
  try {
    await carregarDestino();
    const fn = { referencias, pedidos, estoque, patrimonio, catalogo, cotacoes }[FASE];
    await fn();

    console.log(`\n=== ${FASE.toUpperCase()} ===`);
    for (const [r, n] of resumo) console.log(`  ${String(n).padStart(6)}  ${r}`);

    if (COMMIT) { await destino.query('COMMIT'); console.log('\n>>> GRAVADO (COMMIT)'); }
    else { await destino.query('ROLLBACK'); console.log('\n>>> SIMULACAO (ROLLBACK) — rode com --commit para gravar'); }
  } catch (e) {
    await destino.query('ROLLBACK');
    console.error('\nERRO, nada foi gravado:', e.message);
    process.exitCode = 1;
  } finally {
    await origem.query('ROLLBACK');
    await origem.end(); await destino.end();
  }
}

// =====================================================================
// FASE 1 — referências: itens e postos que o legado usa e o catálogo não tem
// =====================================================================
async function referencias() {
  const dc = deparaContratos();

  // ── postos ─────────────────────────────────────────────────────────
  const pares = (await origem.query(
    'select contrato, posto, count(*) n from pedidos_site_externo group by 1,2')).rows;
  let postosCriados = 0, postosJaTinha = 0, postosSemContrato = 0;
  for (const par of pares) {
    const cid = dc.get(par.contrato);
    if (!cid) { postosSemContrato++; continue; }
    if (acharPosto(cid, par.posto, par.contrato)) { postosJaTinha++; continue; }
    const r = await destino.query(
      `insert into public.sup_posto (empresa_id, contrato_id, nome, ativo, aprovado, legado_origem)
       values ($1,$2,$3,true,false,'pedidos_site_externo.posto') returning id, nome, contrato_id`,
      [D.empresaDoContrato.get(cid), cid, par.posto.trim()]);
    const novo = r.rows[0];
    if (!D.postoPorContrato.has(cid)) D.postoPorContrato.set(cid, new Map());
    D.postoPorContrato.get(cid).set(frouxa(novo.nome), novo);
    postosCriados++;
  }
  conta('postos que já existiam', postosJaTinha);
  conta('postos CRIADOS (aprovado=false)', postosCriados);
  conta('pares ignorados por contrato sem correspondência', postosSemContrato);

  // ── funções ────────────────────────────────────────────────────────
  const paresF = (await origem.query(
    'select contrato, posto, funcao, count(*) n from pedidos_site_externo group by 1,2,3')).rows;
  let fCriadas = 0, fJaTinha = 0;
  for (const par of paresF) {
    const cid = dc.get(par.contrato);
    if (!cid || vazio(par.funcao)) continue;
    const posto = acharPosto(cid, par.posto, par.contrato);
    if (!posto) continue;
    const m = D.funcaoPorPosto.get(posto.id);
    if (m && m.get(frouxa(par.funcao))) { fJaTinha++; continue; }
    const r = await destino.query(
      `insert into public.sup_funcao (posto_id, nome, ativo, aprovado, legado_origem)
       values ($1,$2,true,false,'pedidos_site_externo.funcao') returning id, nome`,
      [posto.id, par.funcao.trim()]);
    if (!D.funcaoPorPosto.has(posto.id)) D.funcaoPorPosto.set(posto.id, new Map());
    D.funcaoPorPosto.get(posto.id).set(frouxa(r.rows[0].nome), r.rows[0]);
    fCriadas++;
  }
  conta('funções que já existiam', fJaTinha);
  conta('funções CRIADAS (aprovado=false)', fCriadas);

  // ── itens ──────────────────────────────────────────────────────────
  // O tipo vem da ficha de estoque quando o nome existe lá; senão, do
  // tipo do pedido. Nunca fica sem tipo: o CHECK do destino exige um dos
  // quatro (uniforme, epi, insumo, equipamento).
  const tipoPorNome = new Map();
  for (const r of (await origem.query('select nome, tipo_item from estoque_items')).rows) {
    if (!vazio(r.nome)) tipoPorNome.set(frouxa(r.nome), tipoItem(r.tipo_item));
  }

  // nome do item -> empresas que precisam dele
  const precisa = new Map(); // frouxa -> {nome, tipo, empresas:Set}
  const anota = (nome, tipo, empresaId) => {
    if (vazio(nome)) return;
    const k = frouxa(nome);
    if (!k) return;
    if (!precisa.has(k)) precisa.set(k, { nome: nome.trim(), tipo, empresas: new Set() });
    precisa.get(k).empresas.add(empresaId);
  };

  for (const p of (await origem.query(
    `select contrato, tipo_pedido, equipamentos from pedidos_site_externo`)).rows) {
    const cid = dc.get(p.contrato);
    const empresaId = (cid && D.empresaDoContrato.get(cid)) || D.HAGG;
    for (const e of (Array.isArray(p.equipamentos) ? p.equipamentos : [])) {
      const nome = e?.nome;
      anota(nome, tipoPorNome.get(frouxa(nome)) || tipoDoPedido[p.tipo_pedido] || 'uniforme', empresaId);
    }
  }
  // estoque vive todo no único almoxarifado que existe, o da HAGG
  for (const r of (await origem.query('select nome, tipo_item from estoque_items')).rows) {
    anota(r.nome, tipoItem(r.tipo_item), D.HAGG);
  }

  let itensCriados = 0, itensJaTinha = 0, itensLixo = 0;
  for (const [k, info] of precisa) {
    // nomes de 1 caractere ou só dígitos são lixo de digitação do legado
    if (/^[0-9]*$/.test(k) || k.length < 2) { itensLixo++; continue; }
    for (const empresaId of info.empresas) {
      const m = D.itemPorEmpresa.get(empresaId);
      if (m && m.get(k)) { itensJaTinha++; continue; }
      const r = await destino.query(
        `insert into public.sup_item (empresa_id, nome, tipo, ativo, aprovado, legado_origem)
         values ($1,$2,$3,true,false,'legado') returning id, nome`,
        [empresaId, info.nome, info.tipo]);
      if (!D.itemPorEmpresa.has(empresaId)) D.itemPorEmpresa.set(empresaId, new Map());
      D.itemPorEmpresa.get(empresaId).set(k, r.rows[0]);
      itensCriados++;
    }
  }
  conta('itens que já existiam (por empresa)', itensJaTinha);
  conta('itens CRIADOS (aprovado=false)', itensCriados);
  conta('nomes descartados por serem lixo de digitação', itensLixo);
}

// =====================================================================
// FASE 2 — pedidos e seus itens
//
// `pedidos_site_externo.equipamentos` é um array JSONB de
// {nome, quantidade, tamanho, litros?} e vira linha em sup_pedido_item.
// `tags` é ignorada de propósito: NULL nas 1.230 linhas, coluna morta.
// =====================================================================
async function pedidos() {
  const dc = deparaContratos();
  const rows = (await origem.query(`
    select id, pedido_id, nome_solicitante, nome_colaborador, matricula_colaborador,
           admissao, data_admissao, data_solicitacao, contrato, posto, funcao,
           equipamentos, status, observacao, data_criacao, data_atualizacao,
           tipo_pedido, observacoes_solicitante, imagem_cracha_url, tipo_admissao,
           data_despachado
      from pedidos_site_externo order by id`)).rows;

  let novos = 0, jaExistia = 0, itens = 0, semContrato = 0, semPosto = 0, semFuncao = 0, semNome = 0;
  for (const p of rows) {
    const cid = dc.get(p.contrato) || null;
    const empresaId = (cid && D.empresaDoContrato.get(cid)) || D.HAGG;
    const posto = cid ? acharPosto(cid, p.posto, p.contrato) : null;
    const funcao = posto ? D.funcaoPorPosto.get(posto.id)?.get(frouxa(p.funcao)) : null;
    if (!cid) semContrato++;
    if (!posto) semPosto++;
    if (!funcao) semFuncao++;

    const r = await destino.query(`
      insert into public.sup_pedido (
        empresa_id, pedido_id, contrato_id, posto_id, funcao_id,
        contrato_nome, posto_nome, funcao_nome,
        solicitante_login, solicitante_nome, origem,
        nome_colaborador, matricula_colaborador, admissao, tipo_admissao, data_admissao,
        imagem_cracha_path, data_solicitacao, tipo_pedido,
        observacoes_solicitante, observacao, status, data_despachado,
        created_at, updated_at, legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'externo',$11,$12,$13,$14,$15,$16,$17,$18,
              $19,$20,$21,$22,$23,$24,'pedidos_site_externo',$25)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      empresaId, p.pedido_id, cid, posto?.id ?? null, funcao?.id ?? null,
      vazio(p.contrato) ? '(não informado)' : p.contrato,
      vazio(p.posto) ? '(não informado)' : p.posto,
      vazio(p.funcao) ? '(não informado)' : p.funcao,
      vazio(p.nome_solicitante) ? '(não informado)' : p.nome_solicitante,
      p.nome_solicitante ?? null,
      p.nome_colaborador ?? '', p.matricula_colaborador ?? '',
      p.admissao ?? false, p.tipo_admissao ?? null, p.data_admissao ?? null,
      p.imagem_cracha_url ?? null, p.data_solicitacao, p.tipo_pedido ?? 'uniforme',
      p.observacoes_solicitante ?? null, p.observacao ?? null,
      p.status ?? 'EM PREPARACAO', p.data_despachado ?? null,
      p.data_criacao ?? new Date(), p.data_atualizacao ?? new Date(), p.id,
    ]);

    if (!r.rows.length) { jaExistia++; continue; }
    novos++;
    const pedidoUuid = r.rows[0].id;

    const lista = Array.isArray(p.equipamentos) ? p.equipamentos : [];
    for (let i = 0; i < lista.length; i++) {
      const e = lista[i] ?? {};
      const nome = vazio(e.nome) ? null : String(e.nome).trim();
      if (!nome) semNome++;
      const item = nome ? D.itemPorEmpresa.get(empresaId)?.get(frouxa(nome)) : null;
      const qtd = Number.parseInt(e.quantidade, 10);
      await destino.query(`
        insert into public.sup_pedido_item
          (pedido_id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem, legado_origem)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'pedidos_site_externo.equipamentos')`, [
        pedidoUuid, item?.id ?? null,
        nome ?? '(sem nome no legado)',
        item?.tipo ?? (tipoDoPedido[p.tipo_pedido] || 'uniforme'),
        vazio(e.tamanho) ? null : String(e.tamanho).trim(),
        Number.isFinite(qtd) && qtd > 0 ? qtd : 1,
        vazio(e.litros) ? null : String(e.litros).trim(),
        i,
      ]);
      itens++;
    }
  }
  conta('pedidos inseridos', novos);
  conta('pedidos que já estavam lá (rodada repetida)', jaExistia);
  conta('itens de pedido inseridos', itens);
  conta('  — pedidos sem contrato ligado', semContrato);
  conta('  — pedidos sem posto ligado', semPosto);
  conta('  — pedidos sem função ligada', semFuncao);
  conta('  — itens sem nome na origem', semNome);
}
// =====================================================================
// FASE 3 — estoque: ficha -> material, e o detalhe desce para a etiqueta
//
// No legado a ficha é (nome, tipo, TAMANHO, estado, valor, fornecedor,
// prateleira) — o tamanho nem coluna tem, só se descobre pelas etiquetas.
// Aqui `sup_estoque_item` é UNIQUE (almoxarifado, material), então as 890
// fichas colapsam em ~346 materiais e o que as diferenciava desce para a
// etiqueta, que já tem tamanho, estado e valor.
//
// Ficha sem nenhuma etiqueta (29 delas) não tem para onde descer: se o
// material já veio de outra ficha, o que ela tinha de próprio é registrado
// em `observacoes` em vez de sumir.
// =====================================================================
async function estoque() {
  const pedidoPorProtocolo = new Map(
    (await destino.query('select id, pedido_id from public.sup_pedido')).rows.map((r) => [r.pedido_id, r.id]));
  const itensHAGG = D.itemPorEmpresa.get(D.HAGG) ?? new Map();

  const fichas = (await origem.query(`
    select id, nome, tipo_item, localizacao, valor_unitario, estoque_minimo,
           validade, fornecedor, estado, devolucao
      from estoque_items order by id`)).rows;
  const comTag = new Set((await origem.query(
    'select distinct item_id from estoque_tags')).rows.map((r) => r.item_id));

  // ── materiais ──────────────────────────────────────────────────────
  const fichaParaEstoque = new Map(); // id da ficha antiga -> uuid de sup_estoque_item
  const fichaInfo = new Map();        // id da ficha antiga -> dados que descem para a etiqueta
  let criados = 0, reusados = 0, semItem = 0, notasDeColapso = 0;

  for (const f of fichas) {
    const item = itensHAGG.get(frouxa(f.nome));
    if (!item) { semItem++; continue; }
    fichaInfo.set(f.id, {
      localizacao: vazio(f.localizacao) ? null : f.localizacao.trim(),
      fornecedor: vazio(f.fornecedor) ? null : f.fornecedor.trim(),
      estado: norm(f.estado) === 'HIGIENIZADO' ? 'higienizado' : 'novo',
      valor: f.valor_unitario,
    });

    const ins = await destino.query(`
      insert into public.sup_estoque_item
        (empresa_id, almoxarifado_id, sup_item_id, valor_unitario, estoque_minimo,
         fornecedor, validade, localizacao, legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,'estoque_items',$9)
      on conflict (almoxarifado_id, sup_item_id) do nothing
      returning id`, [
      D.HAGG, D.almoxHAGG, item.id, f.valor_unitario ?? 0, f.estoque_minimo ?? 0,
      vazio(f.fornecedor) ? null : f.fornecedor.trim(),
      f.validade ?? null,
      vazio(f.localizacao) ? null : f.localizacao.trim(), f.id]);

    if (ins.rows.length) { fichaParaEstoque.set(f.id, ins.rows[0].id); criados++; continue; }

    // já existia: pega o id e, se esta ficha não tem etiqueta, registra o que
    // ela trazia de próprio para não desaparecer no colapso
    const achado = (await destino.query(
      'select id from public.sup_estoque_item where almoxarifado_id=$1 and sup_item_id=$2',
      [D.almoxHAGG, item.id])).rows[0];
    fichaParaEstoque.set(f.id, achado.id);
    reusados++;

    // Sempre: o mínimo do material é o maior entre as fichas que colapsaram.
    // `greatest` é idempotente, então repetir a carga não muda o resultado.
    await destino.query(
      'update public.sup_estoque_item set estoque_minimo = greatest(estoque_minimo, coalesce($2,0)) where id=$1',
      [achado.id, f.estoque_minimo]);

    if (!comTag.has(f.id)) {
      // Ficha sem nenhuma etiqueta não tem para onde descer o que ela trazia de
      // próprio (prateleira, valor, fornecedor): fica registrado em observacoes.
      //
      // O `position(... ) = 0` é o que torna isto repetível. Sem ele, cada nova
      // execução do ETL anexaria a MESMA nota outra vez, e depois de algumas
      // cargas o campo viraria um paredão de linhas repetidas. A marca
      // "[legado ficha N]" é única por ficha e serve de chave.
      const marca = `[legado ficha ${f.id}]`;
      const r = await destino.query(`
        update public.sup_estoque_item
           set observacoes = concat_ws(E'\\n', observacoes,
                 format('%s prateleira=%s valor=%s fornecedor=%s estado=%s min=%s',
                        $2::text, coalesce($3,'-'), coalesce($4::text,'-'), coalesce($5,'-'), coalesce($6,'-'), coalesce($7,'-')))
         where id = $1
           and (observacoes is null or position($2 in observacoes) = 0)
         returning id`,
        [achado.id, marca, fichaInfo.get(f.id).localizacao, f.valor_unitario,
         fichaInfo.get(f.id).fornecedor, fichaInfo.get(f.id).estado,
         f.estoque_minimo === null ? null : String(f.estoque_minimo)]);
      if (r.rows.length) notasDeColapso++;
    }
  }
  conta('materiais de estoque criados', criados);
  conta('fichas que colapsaram em material já existente', reusados);
  conta('  — dessas, sem etiqueta: registradas em observacoes', notasDeColapso);
  conta('fichas puladas (nome não virou item)', semItem);

  // ── etiquetas ──────────────────────────────────────────────────────
  const tags = (await origem.query(`
    select id, item_id, tag_id, tamanho, sequencia, usado, pedido_id, usado_em,
           usado_por, tipo_tag, quantidade_massa, quantidade_original_massa, valor_unitario
      from estoque_tags order by id`)).rows;
  // CÓDIGO REAPROVEITADO
  // `sup_estoque_tag.codigo` é único global. O sistema antigo APAGA etiqueta e
  // depois recria outra com o MESMO código impresso e id novo — foi o que
  // aconteceu com 24391 e 36000 em 18/08. Nesse caso o destino guarda uma linha
  // órfã (o id de origem dela não existe mais) segurando o código, e o INSERT da
  // etiqueta nova estoura o índice único.
  //
  // Quem manda é a origem: a linha órfã é repontada para a etiqueta nova em vez
  // de a carga parar. Só vale quando o dono antigo REALMENTE sumiu de lá — se os
  // dois existirem na origem, é conflito de verdade e tem que aparecer.
  const idsNaOrigem = new Set(tags.map((t) => t.id));
  const donoDoCodigo = new Map(
    (await destino.query(
      'select codigo, legado_id from public.sup_estoque_tag where legado_id is not null')).rows
      .map((r) => [r.codigo, r.legado_id]));

  let tOk = 0, tPulada = 0, tComPedido = 0, tSemPedido = 0, tRepontada = 0, tConflito = 0;
  for (const t of tags) {
    const estoqueId = fichaParaEstoque.get(t.item_id);
    if (!estoqueId) { tPulada++; continue; }
    const info = fichaInfo.get(t.item_id) ?? {};
    const massa = norm(t.tipo_tag) === 'MASSA';
    const pedidoUuid = t.pedido_id ? pedidoPorProtocolo.get(t.pedido_id) ?? null : null;
    if (t.pedido_id) { if (pedidoUuid) tComPedido++; else tSemPedido++; }

    const dono = donoDoCodigo.get(t.tag_id);
    if (dono != null && dono !== t.id) {
      if (idsNaOrigem.has(dono)) {
        // Os dois vivos com o mesmo código: não invento desempate.
        console.warn(`  ! codigo ${t.tag_id} disputado pelas etiquetas ${dono} e ${t.id} — pulada`);
        tConflito++; continue;
      }
      await destino.query(`
        update public.sup_estoque_tag
           set item_estoque_id=$1, tamanho=$3, sequencia=$4, tipo=$5, quantidade_massa=$6,
               quantidade_original_massa=$7, valor_unitario=$8, estado=$9, usado=$10,
               pedido_id=$11, pedido_id_legado=$12, usado_em=$13, usado_por_nome=$14,
               localizacao=$15, fornecedor=$16, legado_id=$17
         where codigo=$2`, [
        estoqueId, t.tag_id, vazio(t.tamanho) ? null : t.tamanho.trim(),
        t.sequencia ?? 1, massa ? 'massa' : 'unico',
        massa ? (t.quantidade_massa ?? 0) : null,
        massa ? t.quantidade_original_massa ?? null : null,
        t.valor_unitario ?? info.valor ?? null,
        info.estado ?? 'novo', t.usado ?? false, pedidoUuid, t.pedido_id ?? null,
        t.usado_em ?? null, vazio(t.usado_por) ? null : t.usado_por.trim(),
        info.localizacao ?? null, info.fornecedor ?? null, t.id]);
      donoDoCodigo.set(t.tag_id, t.id);
      tRepontada++; continue;
    }

    const r = await destino.query(`
      insert into public.sup_estoque_tag
        (item_estoque_id, codigo, tamanho, sequencia, tipo, quantidade_massa,
         quantidade_original_massa, valor_unitario, estado, usado, pedido_id,
         pedido_id_legado, usado_em, usado_por_nome, localizacao, fornecedor,
         legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'estoque_tags',$17)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      estoqueId, t.tag_id, vazio(t.tamanho) ? null : t.tamanho.trim(),
      t.sequencia ?? 1, massa ? 'massa' : 'unico',
      massa ? (t.quantidade_massa ?? 0) : null,
      massa ? t.quantidade_original_massa ?? null : null,
      t.valor_unitario ?? info.valor ?? null,
      info.estado ?? 'novo', t.usado ?? false, pedidoUuid, t.pedido_id ?? null,
      t.usado_em ?? null, vazio(t.usado_por) ? null : t.usado_por.trim(),
      info.localizacao ?? null, info.fornecedor ?? null, t.id]);
    if (r.rows.length) tOk++;
  }
  conta('etiquetas inseridas', tOk);
  conta('  — código reaproveitado: linha órfã repontada', tRepontada);
  conta('  — código disputado por duas vivas (pulada)', tConflito);
  conta('etiquetas puladas (ficha sem material)', tPulada);
  conta('  — com pedido religado', tComPedido);
  conta('  — com pedido só no texto (apagado na origem)', tSemPedido);

  // ── consumo das etiquetas em massa ─────────────────────────────────
  const cons = (await origem.query(`
    select id, tag_id, item_id, pedido_id, quantidade, consumido_em, consumido_por
      from estoque_tags_consumo order by id`)).rows;
  let cOk = 0, cComPedido = 0, cSemPedido = 0, cSemItem = 0;
  for (const c of cons) {
    const estoqueId = c.item_id ? fichaParaEstoque.get(c.item_id) ?? null : null;
    if (!estoqueId) cSemItem++;
    const pedidoUuid = c.pedido_id ? pedidoPorProtocolo.get(c.pedido_id) ?? null : null;
    if (pedidoUuid) cComPedido++; else cSemPedido++;
    const r = await destino.query(`
      insert into public.sup_estoque_consumo
        (codigo, item_estoque_id, pedido_id, pedido_item_id, quantidade,
         consumido_em, consumido_por_nome, pedido_id_legado, legado_origem, legado_id)
      values ($1,$2,$3,null,$4,$5,$6,$7,'estoque_tags_consumo',$8)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      c.tag_id, estoqueId, pedidoUuid, c.quantidade ?? 1,
      c.consumido_em ?? null, vazio(c.consumido_por) ? null : c.consumido_por.trim(),
      c.pedido_id ?? null, c.id]);
    if (r.rows.length) cOk++;
  }
  conta('linhas de consumo inseridas', cOk);
  conta('  — com pedido religado', cComPedido);
  conta('  — com pedido só no texto', cSemPedido);
  conta('  — sem material (item apagado na origem)', cSemItem);
}
// =====================================================================
// FASE 4 — patrimônio: só o que falta, mais anexos e logs
//
// 129 bens já vieram numa importação por planilha anterior e NÃO são
// recriados. O casamento é por (categoria, nome, identificador), porque
// nome sozinho não distingue: há 12 "ROÇADEIRA STHIL FS 220" e 8 "FS 221".
// O `identificador` do destino saiu da `descricao` da origem, que guarda
// placa ou número de série — quando ela é o texto genérico "veiculo"/
// "equipamento", não identifica nada e vale como vazio.
// =====================================================================
async function patrimonio() {
  const dc = deparaContratos();
  for (const [nomeAntigo, , , , id] of lerPipe('depara_contratos_js.txt')) if (id) dc.set(nomeAntigo, id);

  // `descricao` na origem é campo livre: às vezes é placa/série de verdade,
  // às vezes é texto de preenchimento. Estes não identificam nada e se
  // repetem — "SEM NUMERO DE SERIE" em 4 bens, "ALMOXARIFADO" em 2,
  // "1234567" em 2 — e o destino tem índice único de identificador.
  const NAO_E_IDENT = new Set(['', 'VEICULO', 'EQUIPAMENTO', 'ALMOXARIFADO', '1234567',
    'SEM NUMERO DE SERIE', 'SEM NUMERO DE SERIE.', 'SEM NUMERO', 'S/N', 'N/A']);
  const identDe = (descricao) => {
    const d = norm(descricao);
    return NAO_E_IDENT.has(d) ? null : String(descricao).trim();
  };
  const chaveBem = (cat, nome, ident) => `${cat}|${frouxa(nome)}|${frouxa(ident ?? '')}`;

  // índice do destino, com contador de uso para nomes repetidos
  const jaLa = new Map();      // (cat|nome|ident) -> [id]
  const porNome = new Map();   // (cat|nome)       -> [id]
  const identTomado = new Set();
  for (const r of (await destino.query(
    'select id, categoria, nome, identificador from public.sup_patrimonio')).rows) {
    const k = chaveBem(r.categoria, r.nome, r.identificador);
    if (!jaLa.has(k)) jaLa.set(k, []);
    jaLa.get(k).push(r.id);
    const kn = `${r.categoria}|${frouxa(r.nome)}`;
    if (!porNome.has(kn)) porNome.set(kn, []);
    porNome.get(kn).push(r.id);
    if (r.identificador && r.identificador.trim()) identTomado.add(frouxa(r.identificador));
  }
  const usados = new Set();
  function acharBem(cat, nome, ident) {
    for (const id of jaLa.get(chaveBem(cat, nome, ident)) ?? []) if (!usados.has(id)) { usados.add(id); return id; }
    // 2ª chance: o identificador divergiu (a importação anterior largou vazio o
    // que aqui é placa). Só vale quando sobra um único candidato com esse nome.
    const livres = (porNome.get(`${cat}|${frouxa(nome)}`) ?? []).filter((id) => !usados.has(id));
    if (livres.length === 1) { usados.add(livres[0]); return livres[0]; }
    return null;
  }

  const fonte = [
    ...(await origem.query('select * from veiculos order by id')).rows.map((r) => ({ ...r, cat: 'veiculo', tab: 'veiculos' })),
    ...(await origem.query('select * from equipamentos order by id')).rows.map((r) => ({ ...r, cat: 'equipamento', tab: 'equipamentos' })),
  ];

  const bemPorOrigem = new Map(); // "veiculos:15" -> uuid
  let criados = 0, reconhecidos = 0;
  for (const b of fonte) {
    const ident = identDe(b.descricao);
    const existente = acharBem(b.cat, b.nome, ident);
    if (existente) {
      bemPorOrigem.set(`${b.tab}:${b.id}`, existente);
      reconhecidos++;
      // marca a procedência sem mexer em mais nada do que já estava lá
      await destino.query(
        `update public.sup_patrimonio set legado_origem=$2, legado_id=$3
          where id=$1 and legado_id is null`, [existente, b.tab, b.id]);
      continue;
    }
    const cid = dc.get(b.contrato) ?? null;
    const posto = cid ? acharPosto(cid, b.posto ?? '', b.contrato) : null;
    // se a placa/série já pertence a outro bem, ela não pode virar identificador
    // aqui — mas o texto original não se perde: cai em `descricao`.
    const identLivre = ident && !identTomado.has(frouxa(ident)) ? ident : null;
    if (identLivre) identTomado.add(frouxa(identLivre));
    const r = await destino.query(`
      insert into public.sup_patrimonio
        (empresa_id, categoria, nome, identificador, descricao, contrato_id, posto_id,
         lotacao, em_manutencao, data_inicio_manutencao, data_previsao_fim,
         motivo_indisponivel, ativo, created_at, updated_at, legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15,$16)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      D.HAGG, b.cat, b.nome, identLivre,
      identLivre ? null : (vazio(b.descricao) ? null : String(b.descricao).trim()),
      cid, posto?.id ?? null,
      cid ? null : (vazio(b.posto) ? null : b.posto.trim()),
      b.em_manutencao ?? false,
      b.em_manutencao ? b.data_inicio_manutencao ?? null : null,
      b.em_manutencao ? b.data_previsao_fim_manutencao ?? null : null,
      b.em_manutencao ? 'manutencao' : null,
      b.created_at ?? new Date(), b.updated_at ?? new Date(), b.tab, b.id]);
    if (r.rows.length) { bemPorOrigem.set(`${b.tab}:${b.id}`, r.rows[0].id); criados++; }
  }
  conta('bens já existentes, marcados com a origem', reconhecidos);
  conta('bens CRIADOS (só os que faltavam)', criados);

  // ── anexos ─────────────────────────────────────────────────────────
  // `tamanho` na origem está em BYTES (de 9 KB a 2,1 MB); o destino guarda KB.
  const anexos = [
    ...(await origem.query('select *, veiculo_id as pai from veiculos_arquivos order by id')).rows.map((r) => ({ ...r, tab: 'veiculos_arquivos', paiTab: 'veiculos' })),
    ...(await origem.query('select *, equipamento_id as pai from equipamentos_arquivos order by id')).rows.map((r) => ({ ...r, tab: 'equipamentos_arquivos', paiTab: 'equipamentos' })),
  ];
  let aOk = 0, aOrfao = 0;
  for (const a of anexos) {
    const bem = bemPorOrigem.get(`${a.paiTab}:${a.pai}`);
    if (!bem) { aOrfao++; continue; }
    const r = await destino.query(`
      insert into public.sup_patrimonio_arquivo
        (patrimonio_id, nome_arquivo, caminho, tipo_mime, tamanho_kb, comentario, valor,
         created_at, legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      bem, a.nome_original ?? a.nome_arquivo ?? '(sem nome)', a.url ?? a.nome_arquivo ?? '',
      vazio(a.tipo) ? null : a.tipo,
      a.tamanho == null ? null : Math.max(1, Math.round(a.tamanho / 1024)),
      vazio(a.comentario) ? null : a.comentario, a.valor ?? null,
      a.created_at ?? new Date(), a.tab, a.id]);
    if (r.rows.length) aOk++;
  }
  conta('anexos de patrimônio inseridos', aOk);
  conta('  — anexos órfãos (bem não existe)', aOrfao);

  // ── logs de manutenção ─────────────────────────────────────────────
  const logs = (await origem.query('select * from manutencao_logs order by id')).rows;
  let lOk = 0, lOrfao = 0;
  for (const l of logs) {
    const bem = bemPorOrigem.get(`${l.tipo_item === 'veiculo' ? 'veiculos' : 'equipamentos'}:${l.item_id}`);
    if (!bem) { lOrfao++; continue; }  // bem apagado na origem: o log não tem dono
    const r = await destino.query(`
      insert into public.sup_patrimonio_log
        (patrimonio_id, patrimonio_nome, acao, campo, valor_anterior, valor_novo,
         usuario_nome, created_at, legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,'manutencao_logs',$9)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      bem, l.item_nome ?? null, l.acao, l.campo ?? null,
      l.valor_anterior ?? null, l.valor_novo ?? null,
      vazio(l.usuario_nome) ? null : l.usuario_nome.trim(),
      l.created_at ?? new Date(), l.id]);
    if (r.rows.length) lOk++;
  }
  conta('logs de manutenção inseridos', lOk);
  conta('  — logs de bem já apagado na origem (pulados)', lOrfao);
}
// =====================================================================
// FASE 5 — aprovação de catálogo: lotes e suas alterações
//
// O legado chama de "equipamento" o que aqui se chama "item"; o resto do
// vocabulário coincide. "contrato" como alvo só existe no legado — foi por
// isso que a migration 20260903000002 ampliou o CHECK.
// =====================================================================
async function catalogo() {
  const ENTIDADE = { equipamento: 'item', opcoes: 'opcoes', funcao: 'funcao', posto: 'posto', contrato: 'contrato' };

  const lotes = (await origem.query('select * from lotes_alteracoes_catalogo order by id')).rows;
  const loteUuid = new Map(); // lote_id textual -> uuid
  let lOk = 0, lJa = 0;
  for (const l of lotes) {
    const r = await destino.query(`
      insert into public.sup_cat_lote
        (empresa_id, codigo, status, total_alteracoes, decidido_por_nome, comentario,
         data_envio, data_resposta, created_at, updated_at, legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'lotes_alteracoes_catalogo',$11)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      D.HAGG, l.lote_id, norm(l.status) || 'PENDENTE', l.total_alteracoes ?? 0,
      vazio(l.usuario_erp) ? null : l.usuario_erp.trim(),
      vazio(l.comentario_erp) ? null : l.comentario_erp,
      l.data_envio ?? l.created_at ?? new Date(), l.data_resposta ?? null,
      l.created_at ?? new Date(), l.updated_at ?? new Date(), l.id]);
    if (r.rows.length) { loteUuid.set(l.lote_id, r.rows[0].id); lOk++; }
    else {
      const j = (await destino.query(
        `select id from public.sup_cat_lote where legado_origem='lotes_alteracoes_catalogo' and legado_id=$1`, [l.id])).rows[0];
      if (j) loteUuid.set(l.lote_id, j.id);
      lJa++;
    }
  }
  conta('lotes de catálogo inseridos', lOk);
  conta('lotes que já estavam lá', lJa);

  const alt = (await origem.query('select * from alteracoes_catalogo_site_externo order by id')).rows;
  let aOk = 0, aSemLote = 0;
  const porTipo = {};
  for (const a of alt) {
    const lu = loteUuid.get(a.lote_id) ?? null;
    if (!lu) aSemLote++;
    const d = a.dados ?? {};
    // contexto é NOT NULL e é o que dá para ler a alteração sem abrir o lote
    const contexto = {
      contrato_nome: d.contrato_nome ?? null,
      posto_nome: d.posto_nome ?? null,
      funcao_nome: d.funcao_nome ?? null,
      origem: 'sistema antigo (Render)',
    };
    const te = ENTIDADE[a.tipo_entidade] ?? 'item';
    porTipo[te] = (porTipo[te] ?? 0) + 1;
    const r = await destino.query(`
      insert into public.sup_cat_alteracao
        (empresa_id, lote_id, tipo_entidade, tipo_acao, alvo_id, alvo_legado_id,
         dados, contexto, descricao, status, created_at, legado_origem, legado_id)
      values ($1,$2,$3,$4,null,$5,$6,$7,$8,$9,$10,'alteracoes_catalogo_site_externo',$11)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      D.HAGG, lu, te, a.tipo_acao, a.alteracao_id ?? null,
      JSON.stringify(d), JSON.stringify(contexto),
      vazio(a.descricao) ? '(sem descrição no legado)' : a.descricao,
      norm(a.status) || 'PENDENTE',
      a.data_criacao ?? a.created_at ?? new Date(), a.id]);
    if (r.rows.length) aOk++;
  }
  conta('alterações de catálogo inseridas', aOk);
  conta('  — sem lote correspondente', aSemLote);
  for (const [k, v] of Object.entries(porTipo)) conta(`  — tipo "${k}"`, v);
}

// =====================================================================
// FASE 6 — cotações/impugnações da Licitação
//
// Praticamente 1:1 com `cotacoes_licitacao`, que foi construída nesta sprint
// espelhando justamente esta tela do sistema antigo. Os campos de "quem" são
// texto no legado e aqui existem em dois formatos (id + nome): só o nome tem
// origem, os ids ficam nulos.
// =====================================================================
async function cotacoes() {
  const rows = (await origem.query('select * from cotacoes_impugnacoes order by id')).rows;
  let ok = 0, ja = 0;
  for (const c of rows) {
    const r = await destino.query(`
      insert into public.cotacoes_licitacao
        (empresa_id, tipo, comentario, arquivo_url, arquivo_nome, remetente_nome, status,
         visualizado_por_nome, visualizado_em, resposta_comentario, resposta_arquivo_url,
         resposta_arquivo_nome, respondente_nome, data_resposta,
         resposta_visualizada_por_nome, resposta_visualizada_em,
         editado_por_nome, editado_em, created_at, updated_at, legado_origem, legado_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
              'cotacoes_impugnacoes',$21)
      on conflict (legado_origem, legado_id) where legado_id is not null do nothing
      returning id`, [
      D.HAGG, c.tipo, vazio(c.comentario) ? '(sem comentário)' : c.comentario,
      c.arquivo_url ?? null, c.arquivo_nome ?? null,
      vazio(c.remetente) ? null : c.remetente.trim(), c.status ?? 'pendente',
      vazio(c.visualizado_por) ? null : c.visualizado_por.trim(), c.visualizado_em ?? null,
      c.resposta_comentario ?? null, c.resposta_arquivo_url ?? null, c.resposta_arquivo_nome ?? null,
      vazio(c.respondente) ? null : c.respondente.trim(), c.data_resposta ?? null,
      vazio(c.resposta_visualizada_por) ? null : c.resposta_visualizada_por.trim(),
      c.resposta_visualizada_em ?? null,
      vazio(c.editado_por) ? null : c.editado_por.trim(), c.editado_em ?? null,
      c.data_envio ?? c.created_at ?? new Date(), c.updated_at ?? new Date(), c.id]);
    if (r.rows.length) ok++; else ja++;
  }
  conta('cotações/impugnações inseridas', ok);
  conta('as que já estavam lá', ja);
}

main();
