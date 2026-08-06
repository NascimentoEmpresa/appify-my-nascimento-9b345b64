/**
 * Gera a migration de carga do catálogo de materiais a partir do export do
 * sistema legado (Catalogo-Completo-Site-Externo.xlsx).
 *
 *   node scripts/gerar-migration-catalogo.mjs
 *
 * Produz:
 *   supabase/migrations/20260819000004_supply_catalogo_import.sql
 *   docs/catalogo-import-revisao.md
 *
 * É determinístico e idempotente: rodar de novo com a mesma planilha gera o
 * mesmo arquivo. Se a planilha for reexportada, é só rodar de novo.
 *
 * O que ele resolve, e por quê (tudo herdado do legado — ver a análise em
 * docs/catalogo-import-revisao.md, gerado junto):
 *
 *   1. NOMES DUPLICADOS — "BABUCHE PRETO" e "BABUCHE - PRETO" são o mesmo
 *      material. Manter os dois parte o saldo do estoque em dois na Fase 2.
 *   2. TIPO DIVERGENTE — o mesmo item aparece como 'epi' num contrato e
 *      'uniforme' noutro, e o tipo decide em que seção do wizard ele cai.
 *   3. OPÇÕES FORA DE ORDEM — o legado guardava a união, sem ordenar.
 */
import XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLANILHA = resolve(RAIZ, "Catalogo-Completo-Site-Externo.xlsx");
const SAIDA_SQL = resolve(RAIZ, "supabase/migrations/20260819000004_supply_catalogo_import.sql");
const SAIDA_DOC = resolve(RAIZ, "docs/catalogo-import-revisao.md");

const PLACEHOLDER = "(sem itens cadastrados)";

/**
 * De-para contrato da planilha → contrato em public.contratos.
 *
 * 32 dos 46 casam sozinhos por nome normalizado; os 14 abaixo não, e foram
 * conferidos um a um contra o banco (quase todos pelo número do contrato,
 * que é mais confiável que o nome). Só entram aqui os que precisam de
 * tradução — o resto usa o próprio nome da planilha.
 *
 * VERANOPOLIS RECEPÇÃO aponta de propósito para o MESMO contrato do 001/2021:
 * decisão do dono do produto, e os 6 postos dele não colidem com os 42 do
 * outro (verificado), então a fusão soma sem sobrescrever nada.
 */
const DE_PARA = {
  "BENTO GONÇALVES A.ADM 002 2021": "BENTO GONÇALVES - AUX ADM - 002/2021",
  "C.RIO GRANDE-LIMPEZA 001 2023": "CAMARA DE RIO GRANDE - LIMPEZA 001/2023",
  "CAXIAS DO SUL - 095.2026": "CAXIAS DO SUL - 2026/95",
  "CANOINHAS - EMBRAPA": "EMBRAPA - CANOINHA - 47/2024",
  "DMAE 895": "DMAE - 895/0",
  "EMBRAPA - 93 2021": "EMBRAPA - 2021/93",
  "HUSM - LAVANDERIA - 20 2021": "HUSM SANTA MARIA - LAVANDERIA   -  020/2021",
  "SEC CULT POA - PORT-88123 2024": "SECRETARIA DA CULTURA POA - PORTARIA - 88123/2024",
  "TRIUNFO COLETA DE LIXO - 89.2026": "TRIUNFO COLETA DE LIXO - 089.2026",
  "TRIUNFO OP.MÁQUINAS 19 2026": "TRIUNFO OP. MÁQUINA - 19.2026",
  "UFRGS ASB - 033.2021": "UFRGS - AUXILIAR DE SAÚDE BUCAL - 033/2021",
  "UFRGS DIGITADORES - 014.2026": "UFRGS DIGITADORES - XXX/2026",
  "UFRGS INTERPRETES - 009.2026": "UFRGS INTERPRETE DE LIBRAS C. 009.2026",
  "VERANOPOLIS RECEPÇÃO-011.2026": "VERANOPOLIS   -  001/2021",
};

/**
 * Itens que são EPI por natureza, usada só para DESEMPATAR os que aparecem
 * com tipo divergente entre contratos. Existe porque a maioria simples erra
 * em casos óbvios: "LUVA DE LATEX AZUL" está 165× como uniforme e 78× como
 * epi — e luva de látex não é uniforme.
 *
 * Itens com tipo consistente em todos os contratos NÃO passam por aqui.
 */
const PREFIXOS_EPI = [
  "LUVA", "LUVAS", "OCULOS", "MASCARA", "PROTETOR", "PERNEIRA",
  "TOUCA", "MANGOTE", "ABAFADOR",
];
const CONTEM_EPI = ["RASPA", "DEFENSIVOS", "BOTINA"];

/** Ordem canônica de tamanhos por letra; o resto é ordenado numericamente. */
const ORDEM_LETRA = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EGG", "EXGG"];

// ── Helpers ──────────────────────────────────────────────────────────

const semAcento = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Mesma regra da função sup_norm_nome() criada na migration. */
const norm = (s) => semAcento(s).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (lista) => (lista.length ? `ARRAY[${lista.map(q).join(",")}]::text[]` : "NULL");

function ordenarOpcoes(lista) {
  const num = lista.filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(a) - Number(b));
  const letra = lista.filter((v) => !/^\d+$/.test(v));
  letra.sort((a, b) => {
    const ia = ORDEM_LETRA.indexOf(semAcento(a).toUpperCase());
    const ib = ORDEM_LETRA.indexOf(semAcento(b).toUpperCase());
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b, "pt-BR");
  });
  return [...letra, ...num];
}

const partirOpcoes = (v) =>
  String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function tipoPorRegra(nome) {
  const n = norm(nome);
  if (PREFIXOS_EPI.some((p) => n.startsWith(p))) return "epi";
  if (CONTEM_EPI.some((p) => n.includes(p))) return "epi";
  return null;
}

// ── 1. Ler a planilha ────────────────────────────────────────────────

const wb = XLSX.readFile(PLANILHA);
const linhas = XLSX.utils
  .sheet_to_json(wb.Sheets["Catalogo"], { defval: "" })
  .map((r) => ({
    contrato: String(r["Contrato"]).trim(),
    posto: String(r["Posto"]).trim(),
    funcao: String(r["Função"]).trim(),
    item: String(r["EPI / Insumo / Material"]).trim(),
    tipo: String(r["Tipo"]).trim() || "uniforme",
    tamanhos: partirOpcoes(r["Tamanhos disponíveis"]),
    quantidades: partirOpcoes(r["Quantidades disponíveis"]),
    litros: partirOpcoes(r["Litros disponíveis"]),
  }));

// A planilha traz uma linha marcadora para função sem enxoval. A função
// existe e deve ser criada; o "item" é que não.
const comItem = linhas.filter((l) => l.item !== PLACEHOLDER);

// ── 2. Unificar nomes de item ────────────────────────────────────────

/** grupo normalizado → { grafia: nº de vínculos } */
const grafias = {};
for (const l of comItem) {
  const g = (grafias[norm(l.item)] ||= {});
  g[l.item] = (g[l.item] ?? 0) + 1;
}

const nomeCanonico = {};       // grafia original → grafia vencedora
const gruposUnificados = [];   // para o relatório
const opcoesDivergentes = [];  // grupos em que unir acrescentou opções
const opcoesDoGrupo = {};      // grafia vencedora → { tamanhos, quantidades, litros }

/** Opções de uma grafia (são consistentes dentro da mesma grafia). */
const opcoesDe = (nome) => {
  const l = comItem.find((x) => x.item === nome);
  return { tamanhos: l.tamanhos, quantidades: l.quantidades, litros: l.litros };
};

for (const [chave, mapa] of Object.entries(grafias)) {
  const ordenadas = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  const vencedora = ordenadas[0][0];
  for (const [grafia] of ordenadas) nomeCanonico[grafia] = vencedora;

  // As opções do grupo são a UNIÃO das grafias, não as da vencedora.
  // Ficar só com a vencedora removeria opção que algum contrato oferece de
  // verdade: SAPATO SOCIAL FEMININO perderia os tamanhos 47–50, e
  // CALÇA SOCIAL FEMININA perderia o sistema de numeração por letra inteiro,
  // deixando 5 vínculos sem como pedir o tamanho deles. Unir, no pior caso,
  // oferece uma opção a mais; descartar impede um pedido legítimo.
  const uniao = { tamanhos: new Set(), quantidades: new Set(), litros: new Set() };
  for (const [grafia] of ordenadas) {
    const o = opcoesDe(grafia);
    o.tamanhos.forEach((v) => uniao.tamanhos.add(v));
    o.quantidades.forEach((v) => uniao.quantidades.add(v));
    o.litros.forEach((v) => uniao.litros.add(v));
  }
  opcoesDoGrupo[vencedora] = {
    tamanhos: ordenarOpcoes([...uniao.tamanhos]),
    quantidades: ordenarOpcoes([...uniao.quantidades]),
    litros: ordenarOpcoes([...uniao.litros]),
  };

  if (ordenadas.length === 1) continue;
  gruposUnificados.push({ chave, vencedora, grafias: ordenadas });

  // Só reporta quando unir MUDOU o conjunto de alguma grafia — comparando
  // conjuntos, não a ordem crua (o legado guardava a união sem ordenar, então
  // "P, M, G" e "G, P, M" são a mesma coisa e não interessam a ninguém).
  const mesmoConjunto = (a, b) =>
    a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
  const mudou = ordenadas.some(([g]) => {
    const o = opcoesDe(g);
    return !mesmoConjunto(o.tamanhos, opcoesDoGrupo[vencedora].tamanhos)
      || !mesmoConjunto(o.quantidades, opcoesDoGrupo[vencedora].quantidades)
      || !mesmoConjunto(o.litros, opcoesDoGrupo[vencedora].litros);
  });
  if (mudou) {
    opcoesDivergentes.push({
      vencedora,
      uniao: opcoesDoGrupo[vencedora],
      detalhe: ordenadas.map(([n, c]) => ({ grafia: n, vinculos: c, ...opcoesDe(n) })),
    });
  }
}

// ── 3. Resolver o tipo (DEPOIS de unificar — unificar pode criar empate) ──

const tiposPorItem = {};
for (const l of comItem) {
  const nome = nomeCanonico[l.item];
  (tiposPorItem[nome] ||= {})[l.tipo] = (tiposPorItem[nome]?.[l.tipo] ?? 0) + 1;
}

const tipoFinal = {};
const tiposResolvidos = []; // para o relatório
for (const [nome, contagem] of Object.entries(tiposPorItem)) {
  const entradas = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  if (entradas.length === 1) {
    tipoFinal[nome] = entradas[0][0];
    continue;
  }
  const porRegra = tipoPorRegra(nome);
  const maioria = entradas[0][0];
  const escolhido = porRegra ?? maioria;
  tipoFinal[nome] = escolhido;
  tiposResolvidos.push({
    nome, contagem: Object.fromEntries(entradas), maioria, escolhido,
    criterio: porRegra ? "regra de negócio" : "maioria",
    // Vira ↑ quando a regra contraria a maioria: é o que você precisa olhar.
    viradaContraMaioria: !!porRegra && porRegra !== maioria,
    vinculosAfetados: contagem[maioria] ?? 0,
  });
}

// ── 4. Montar as tabelas de staging ──────────────────────────────────

const itens = [];          // { idx, nome, tipo, tamanhos, quantidades, litros }
const idxItem = new Map();
for (const l of comItem) {
  const nome = nomeCanonico[l.item];
  if (idxItem.has(nome)) continue;
  // Opções já vêm unidas e ordenadas do passo de unificação.
  const o = opcoesDoGrupo[nome];
  idxItem.set(nome, itens.length + 1);
  itens.push({
    idx: itens.length + 1,
    nome,
    tipo: tipoFinal[nome],
    tamanhos: o.tamanhos,
    quantidades: o.quantidades,
    litros: o.litros,
  });
}

const contratos = [];      // { idx, planilha, erp }
const idxContrato = new Map();
const postos = [];         // { idx, contratoIdx, nome }
const idxPosto = new Map();
const funcoes = [];        // { idx, postoIdx, nome }
const idxFuncao = new Map();
const vinculos = [];       // { funcaoIdx, itemIdx, ordem }
const ordemPorFuncao = new Map();

for (const l of linhas) {
  if (!idxContrato.has(l.contrato)) {
    idxContrato.set(l.contrato, contratos.length + 1);
    contratos.push({
      idx: contratos.length + 1,
      planilha: l.contrato,
      erp: DE_PARA[l.contrato] ?? l.contrato,
    });
  }
  const cIdx = idxContrato.get(l.contrato);

  // Postos e funções são chaveados pelo contrato do ERP, não pelo da
  // planilha: é isso que funde os dois Veranópolis num só sem duplicar.
  const erp = DE_PARA[l.contrato] ?? l.contrato;
  const kPosto = `${norm(erp)}||${l.posto}`;
  if (!idxPosto.has(kPosto)) {
    idxPosto.set(kPosto, postos.length + 1);
    postos.push({ idx: postos.length + 1, contratoIdx: cIdx, nome: l.posto });
  }
  const pIdx = idxPosto.get(kPosto);

  const kFuncao = `${kPosto}||${l.funcao}`;
  if (!idxFuncao.has(kFuncao)) {
    idxFuncao.set(kFuncao, funcoes.length + 1);
    funcoes.push({ idx: funcoes.length + 1, postoIdx: pIdx, nome: l.funcao });
  }
  const fIdx = idxFuncao.get(kFuncao);

  if (l.item === PLACEHOLDER) continue;
  const iIdx = idxItem.get(nomeCanonico[l.item]);
  const ordem = (ordemPorFuncao.get(fIdx) ?? 0) + 1;
  ordemPorFuncao.set(fIdx, ordem);
  vinculos.push({ funcaoIdx: fIdx, itemIdx: iIdx, ordem });
}

// ── 5. Emitir o SQL ──────────────────────────────────────────────────

/** VALUES em lotes, para não gerar um único statement gigante. */
function inserirEmLotes(tabela, colunas, linhasSql, tamanho = 1000) {
  const out = [];
  for (let i = 0; i < linhasSql.length; i += tamanho) {
    out.push(
      `INSERT INTO ${tabela} (${colunas}) VALUES\n` +
      linhasSql.slice(i, i + tamanho).join(",\n") + ";",
    );
  }
  return out.join("\n\n");
}

const sql = `-- =====================================================================
-- SUPPLY / COMPRAS — carga do catálogo real vindo do sistema legado
--
-- GERADO AUTOMATICAMENTE por scripts/gerar-migration-catalogo.mjs a partir de
-- Catalogo-Completo-Site-Externo.xlsx. NÃO EDITE À MÃO — ajuste o script e
-- gere de novo.
--
-- Origem: export da API de produção do legado (api.mustaches.com.br) em
-- 04/08/2026, contendo apenas ativo = true AND aprovado_erp = true, ou seja,
-- exatamente o que o encarregado enxerga hoje.
--
--   ${contratos.length} contratos da planilha  ·  ${postos.length} postos  ·  ${funcoes.length} funções
--   ${vinculos.length} vínculos função→item  ·  ${itens.length} materiais distintos
--
-- IDEMPOTENTE: tudo é ON CONFLICT DO NOTHING. Rodar duas vezes não duplica.
-- Se um contrato ainda não existir em public.contratos, o catálogo dele
-- simplesmente não entra — e a query de conferência no fim aponta qual foi.
-- Basta cadastrar em Licitações e rodar esta migration de novo.
--
-- Entra com aprovado = true, SEM passar pelo fluxo de lote: é catálogo que já
-- está em produção no legado, e um lote com ${vinculos.length} alterações não teria
-- como ser revisado por ninguém. O fluxo de aprovação segue valendo para tudo
-- que for cadastrado pela tela daqui em diante.
--
-- ROLLBACK (apaga TODO o catálogo, inclusive o que for cadastrado depois):
--   DELETE FROM public.sup_funcao_item;
--   DELETE FROM public.sup_item_opcao;
--   DELETE FROM public.sup_item;
--   DELETE FROM public.sup_funcao;
--   DELETE FROM public.sup_posto;
-- =====================================================================

-- Normalização de nome usada no de-para com public.contratos: ignora acento,
-- hífen, espaço e pontuação. É o que faz "TJRS - 023.2025" casar com
-- "TJRS - 023/2025". Fica no banco porque é útil em qualquer comparação
-- futura de nome de contrato.
CREATE OR REPLACE FUNCTION public.sup_norm_nome(t text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $fn$
  SELECT upper(regexp_replace(
    translate(t,
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'),
    '[^A-Za-z0-9]', '', 'g'));
$fn$;

-- ── Staging ──────────────────────────────────────────────────────────
-- Tabelas normais (não TEMP) para o script poder ser colado em pedaços no
-- SQL Editor sem perder estado entre execuções. São dropadas no fim.

DROP TABLE IF EXISTS public.sup_imp_vinculo;
DROP TABLE IF EXISTS public.sup_imp_funcao;
DROP TABLE IF EXISTS public.sup_imp_posto;
DROP TABLE IF EXISTS public.sup_imp_contrato;
DROP TABLE IF EXISTS public.sup_imp_item;

CREATE TABLE public.sup_imp_contrato (idx int PRIMARY KEY, nome_planilha text, nome_erp text);
CREATE TABLE public.sup_imp_posto    (idx int PRIMARY KEY, contrato_idx int, nome text);
CREATE TABLE public.sup_imp_funcao   (idx int PRIMARY KEY, posto_idx int, nome text);
CREATE TABLE public.sup_imp_item     (idx int PRIMARY KEY, nome text, tipo text,
                                      tamanhos text[], quantidades text[], litros text[]);
CREATE TABLE public.sup_imp_vinculo  (funcao_idx int, item_idx int, ordem int);

${inserirEmLotes(
  "public.sup_imp_contrato", "idx, nome_planilha, nome_erp",
  contratos.map((c) => `(${c.idx},${q(c.planilha)},${q(c.erp)})`),
)}

${inserirEmLotes(
  "public.sup_imp_item", "idx, nome, tipo, tamanhos, quantidades, litros",
  itens.map((i) =>
    `(${i.idx},${q(i.nome)},${q(i.tipo)},${arr(i.tamanhos)},${arr(i.quantidades)},${arr(i.litros)})`),
)}

${inserirEmLotes(
  "public.sup_imp_posto", "idx, contrato_idx, nome",
  postos.map((p) => `(${p.idx},${p.contratoIdx},${q(p.nome)})`),
)}

${inserirEmLotes(
  "public.sup_imp_funcao", "idx, posto_idx, nome",
  funcoes.map((f) => `(${f.idx},${f.postoIdx},${q(f.nome)})`),
)}

${inserirEmLotes(
  "public.sup_imp_vinculo", "funcao_idx, item_idx, ordem",
  vinculos.map((v) => `(${v.funcaoIdx},${v.itemIdx},${v.ordem})`),
)}

CREATE INDEX ON public.sup_imp_posto(contrato_idx);
CREATE INDEX ON public.sup_imp_funcao(posto_idx);
CREATE INDEX ON public.sup_imp_vinculo(funcao_idx);
ANALYZE public.sup_imp_contrato;
ANALYZE public.sup_imp_posto;
ANALYZE public.sup_imp_funcao;
ANALYZE public.sup_imp_item;
ANALYZE public.sup_imp_vinculo;

-- ── Carga ────────────────────────────────────────────────────────────

-- Empresas que têm ao menos um contrato do catálogo. O item mestre é por
-- empresa (UNIQUE (empresa_id, nome)) para manter o isolamento multi-CNPJ:
-- na Fase 2 o estoque e as etiquetas de cada CNPJ não podem se misturar.
CREATE OR REPLACE VIEW public.sup_imp_empresas AS
  SELECT DISTINCT c.empresa_id
    FROM public.sup_imp_contrato ic
    JOIN public.contratos c ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(ic.nome_erp);

INSERT INTO public.sup_item (empresa_id, nome, tipo, ativo, aprovado)
SELECT e.empresa_id, i.nome, i.tipo, true, true
  FROM public.sup_imp_item i
 CROSS JOIN public.sup_imp_empresas e
ON CONFLICT (empresa_id, nome) DO NOTHING;

INSERT INTO public.sup_item_opcao (item_id, tipo, opcoes)
SELECT si.id, o.tipo, o.opcoes
  FROM public.sup_imp_item i
  JOIN public.sup_item si ON si.nome = i.nome
 CROSS JOIN LATERAL (VALUES
    ('tamanho',    i.tamanhos),
    ('quantidade', i.quantidades),
    ('litros',     i.litros)
 ) AS o(tipo, opcoes)
 WHERE o.opcoes IS NOT NULL AND array_length(o.opcoes, 1) > 0
ON CONFLICT (item_id, tipo) DO UPDATE SET opcoes = excluded.opcoes;

-- empresa_id de sup_posto é preenchido pelo trigger a partir do contrato.
INSERT INTO public.sup_posto (contrato_id, nome, ativo, aprovado, empresa_id)
SELECT c.id, p.nome, true, true, c.empresa_id
  FROM public.sup_imp_posto p
  JOIN public.sup_imp_contrato ic ON ic.idx = p.contrato_idx
  JOIN public.contratos c ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(ic.nome_erp)
ON CONFLICT (contrato_id, nome) DO NOTHING;

INSERT INTO public.sup_funcao (posto_id, nome, ativo, aprovado)
SELECT sp.id, f.nome, true, true
  FROM public.sup_imp_funcao f
  JOIN public.sup_imp_posto p ON p.idx = f.posto_idx
  JOIN public.sup_imp_contrato ic ON ic.idx = p.contrato_idx
  JOIN public.contratos c ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(ic.nome_erp)
  JOIN public.sup_posto sp ON sp.contrato_id = c.id AND sp.nome = p.nome
ON CONFLICT (posto_id, nome) DO NOTHING;

INSERT INTO public.sup_funcao_item (funcao_id, item_id, ordem, ativo, aprovado)
SELECT sf.id, si.id, min(v.ordem), true, true
  FROM public.sup_imp_vinculo v
  JOIN public.sup_imp_funcao f ON f.idx = v.funcao_idx
  JOIN public.sup_imp_posto p ON p.idx = f.posto_idx
  JOIN public.sup_imp_contrato ic ON ic.idx = p.contrato_idx
  JOIN public.contratos c ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(ic.nome_erp)
  JOIN public.sup_posto sp ON sp.contrato_id = c.id AND sp.nome = p.nome
  JOIN public.sup_funcao sf ON sf.posto_id = sp.id AND sf.nome = f.nome
  JOIN public.sup_imp_item ii ON ii.idx = v.item_idx
  JOIN public.sup_item si ON si.empresa_id = c.empresa_id AND si.nome = ii.nome
 GROUP BY sf.id, si.id
ON CONFLICT (funcao_id, item_id) DO NOTHING;

-- ── Conferência ──────────────────────────────────────────────────────
-- Rode estes dois SELECT e confira antes de dar a carga por encerrada.

-- 1) Contratos da planilha que não existem em public.contratos.
--    Cadastre em Licitações e rode esta migration de novo.
SELECT ic.nome_planilha AS contrato_sem_correspondente_no_erp
  FROM public.sup_imp_contrato ic
 WHERE NOT EXISTS (
   SELECT 1 FROM public.contratos c
    WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(ic.nome_erp))
 ORDER BY 1;

-- 2) O que entrou.
SELECT (SELECT count(*) FROM public.sup_posto)       AS postos,
       (SELECT count(*) FROM public.sup_funcao)      AS funcoes,
       (SELECT count(*) FROM public.sup_item)        AS itens,
       (SELECT count(*) FROM public.sup_item_opcao)  AS opcoes,
       (SELECT count(*) FROM public.sup_funcao_item) AS vinculos;

-- ── Limpeza ──────────────────────────────────────────────────────────
DROP VIEW  IF EXISTS public.sup_imp_empresas;
DROP TABLE IF EXISTS public.sup_imp_vinculo;
DROP TABLE IF EXISTS public.sup_imp_funcao;
DROP TABLE IF EXISTS public.sup_imp_posto;
DROP TABLE IF EXISTS public.sup_imp_contrato;
DROP TABLE IF EXISTS public.sup_imp_item;

NOTIFY pgrst, 'reload schema';
`;

writeFileSync(SAIDA_SQL, sql, "utf8");

// ── 6. Relatório de revisão ──────────────────────────────────────────

const viradas = tiposResolvidos.filter((t) => t.viradaContraMaioria)
  .sort((a, b) => b.vinculosAfetados - a.vinculosAfetados);

const doc = `# Revisão da carga do catálogo

Gerado por \`scripts/gerar-migration-catalogo.mjs\` a partir de
\`Catalogo-Completo-Site-Externo.xlsx\`. Confira antes de rodar
\`supabase/migrations/20260819000004_supply_catalogo_import.sql\`.

| | |
|---|---|
| Contratos na planilha | ${contratos.length} |
| Postos | ${postos.length} |
| Funções | ${funcoes.length} |
| Vínculos função→item | ${vinculos.length} |
| Materiais distintos (após unificar) | ${itens.length} |
| Materiais por tipo | ${Object.entries(itens.reduce((a, i) => ({ ...a, [i.tipo]: (a[i.tipo] ?? 0) + 1 }), {})).map(([t, n]) => `${t}: ${n}`).join(" · ")} |

## 1. Tipo resolvido (${tiposResolvidos.length} itens divergentes)

O tipo decide se o material aparece na seção **Uniformes** ou **EPIs e Insumos**
do wizard. Estes itens vinham classificados de formas diferentes conforme o
contrato. Itens com tipo consistente não foram tocados.

${viradas.length ? `### ⚠️ Onde a regra contrariou a maioria — olhe estes primeiro

Aqui o material muda de seção para a maior parte dos vínculos:

| Material | Era (maioria) | Passa a ser | Vínculos que mudam de seção |
|---|---|---|---|
${viradas.map((t) => `| ${t.nome} | ${t.maioria} | **${t.escolhido}** | ${t.vinculosAfetados} |`).join("\n")}
` : ""}
### Todos os ${tiposResolvidos.length}

| Material | Contagem na planilha | Escolhido | Critério |
|---|---|---|---|
${tiposResolvidos
  .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
  .map((t) => `| ${t.nome} | ${Object.entries(t.contagem).map(([k, v]) => `${k}: ${v}`).join(" / ")} | **${t.escolhido}** | ${t.criterio} |`)
  .join("\n")}

## 2. Nomes unificados (${gruposUnificados.length} grupos)

O mesmo material estava cadastrado com grafias diferentes. Manter os dois
partiria o saldo do estoque em dois na Fase 2. Vence a grafia com mais vínculos.

| Fica | Absorve |
|---|---|
${gruposUnificados
  .sort((a, b) => a.vencedora.localeCompare(b.vencedora, "pt-BR"))
  .map((g) => `| **${g.vencedora}** (${g.grafias[0][1]}) | ${g.grafias.slice(1).map(([n, c]) => `${n} (${c})`).join(" · ")} |`)
  .join("\n")}

## 3. Grupos em que unir mudou as opções (${opcoesDivergentes.length})

${opcoesDivergentes.length === 0
  ? "Nenhum. Todas as grafias unificadas ofereciam exatamente o mesmo conjunto de opções."
  : `As grafias do mesmo material ofereciam conjuntos diferentes. O item final
recebe a **união** — descartar o conjunto de uma delas deixaria os vínculos
daquela grafia sem como pedir o tamanho que usam. No pior caso sobra uma opção
que aquele contrato não estoca; o inverso impediria um pedido legítimo.

${opcoesDivergentes.map((d) => `### ${d.vencedora}

| Grafia | Vínculos | Tamanhos | Quantidades | Litros |
|---|---|---|---|---|
${d.detalhe.map((x) => `| ${x.grafia} | ${x.vinculos} | ${x.tamanhos.join(", ") || "—"} | ${x.quantidades.join(", ") || "—"} | ${x.litros.join(", ") || "—"} |`).join("\n")}
| **→ fica** | — | **${d.uniao.tamanhos.join(", ") || "—"}** | **${d.uniao.quantidades.join(", ") || "—"}** | **${d.uniao.litros.join(", ") || "—"}** |
`).join("\n")}`}

## 4. De-para dos contratos

${contratos.filter((c) => DE_PARA[c.planilha]).length} contratos precisaram de tradução manual; os outros
${contratos.length - contratos.filter((c) => DE_PARA[c.planilha]).length} casam sozinhos por nome normalizado.

| Planilha | public.contratos |
|---|---|
${contratos.filter((c) => DE_PARA[c.planilha]).map((c) => `| ${c.planilha} | ${c.erp} |`).join("\n")}
`;

writeFileSync(SAIDA_DOC, doc, "utf8");

// ── Resumo no console ────────────────────────────────────────────────
const kb = (Buffer.byteLength(sql, "utf8") / 1024).toFixed(0);
console.log(`contratos ......... ${contratos.length}`);
console.log(`postos ............ ${postos.length}`);
console.log(`funcoes ........... ${funcoes.length}`);
console.log(`vinculos .......... ${vinculos.length}`);
console.log(`itens ............. ${itens.length}  (de ${Object.keys(nomeCanonico).length} grafias)`);
console.log(`grupos unificados . ${gruposUnificados.length}`);
console.log(`opcoes divergentes  ${opcoesDivergentes.length}`);
console.log(`tipos resolvidos .. ${tiposResolvidos.length}  (${viradas.length} contra a maioria)`);
console.log(`SQL ............... ${kb} KB -> ${SAIDA_SQL}`);
console.log(`relatorio ......... ${SAIDA_DOC}`);
