/**
 * Gera a migration de carga do patrimônio a partir do dump das tabelas
 * `veiculos` e `equipamentos` do banco legado.
 *
 *   node scripts/gerar-migration-patrimonio.mjs
 *
 * Produz:
 *   supabase/migrations/20260824000003_supply_patrimonio_completo.sql
 *   docs/patrimonio-import-revisao.md
 *
 * Substitui a carga anterior (20260824000002), que vinha do export do Painel
 * de Manutenções e só tinha os 26 itens parados. Os CSVs trazem o patrimônio
 * inteiro — os 26 estão contidos neles.
 *
 * IDEMPOTENTE: casa por identificador quando há, e por
 * (categoria, nome, contrato, posto) quando não há. Rodar com a 002 já
 * aplicada apenas COMPLETA o que falta.
 *
 * No schema legado a coluna `descricao` é o IDENTIFICADOR do bem — é o que
 * os modais "Adicionar Veículo/Máquina" chamavam de "Identificador desse
 * veículo". Não é uma descrição livre.
 */
import XLSX from "xlsx";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAIDA_SQL = resolve(RAIZ, "supabase/migrations/20260824000003_supply_patrimonio_completo.sql");
const SAIDA_DOC = resolve(RAIZ, "docs/patrimonio-import-revisao.md");

/**
 * De-para de contrato. Os dois primeiros são os mesmos já confirmados na
 * carga do catálogo; a Manutenção só escrevia o nome de outro jeito.
 * "ADMINISTRATIVO ESCRITÓRIO" NÃO é contrato — é a frota da sede, e vira
 * lotação (decisão do dono do produto).
 */
const DE_PARA_CONTRATO = {
  "CANOINHAS - EMBRAPA": "EMBRAPA - CANOINHA - 47/2024",
  "UFRGS - ASB - 033 2021": "UFRGS - AUXILIAR DE SAÚDE BUCAL - 033/2021",
};
const SEM_CONTRATO = new Set(["ADMINISTRATIVO ESCRITÓRIO"]);

/** De-para de posto: a Manutenção colava o número do contrato no campus. */
const DE_PARA_POSTO = {
  "UFRGS-LITORAL-062": "CAMPUS LITORAL",
  "UFRGS-CENTRO-062": "CAMPUS CENTRO",
  "UFRGS-AGRONOMIA-062": "CAMPUS AGRONOMIA",
  "UFRGS - AUXILIAR DE SAUDE BUCAL": "AUXILIAR DE SAUDE BUCAL",
};

/**
 * Valores que NÃO são identificador.
 *
 * Além dos "sem número de série", entram aqui os textos de EXEMPLO dos
 * próprios modais do legado — o campo de veículo sugeria "Ex: Caminhonete,
 * Carro" e o de máquina "Ex: Almoxarifado, Manutenção", e várias pessoas
 * digitaram o exemplo. Guardar isso como identificador não distingue nada e
 * ainda colide no índice único.
 */
const NAO_E_IDENTIFICADOR = [
  /^\s*$/,
  /^\s*(sem|n[ãa]o\s*tem)\b.*(n[úu]mero|nserie|n\.?\s*serie)/i,
  /^(ve[íi]culo|carro|caminhonete|equipamento|m[áa]quina|almoxarifado|manuten[çc][ãa]o)$/i,
];

const lerCsv = (arquivo) => XLSX.utils.sheet_to_json(
  XLSX.read(readFileSync(resolve(RAIZ, "supabase/migrations", arquivo), "utf8"),
    { type: "string" }).Sheets.Sheet1, { defval: "" });

const limpar = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const dataISO = (v) => {
  const s = limpar(v);
  if (!s || s.toUpperCase() === "NULL") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

// ── Leitura ──────────────────────────────────────────────────────────
const bruto = [
  ...lerCsv("veiculos-bd-legado").map((r) => ({ ...r, categoria: "veiculo" })),
  ...lerCsv("equipamentos-bd-legado").map((r) => ({ ...r, categoria: "equipamento" })),
];

const zerados = [];
const linhas = bruto.map((r) => {
  const contratoLegado = limpar(r.contrato);
  const postoLegado = limpar(r.posto);
  const semContrato = SEM_CONTRATO.has(contratoLegado);
  const bruta = limpar(r.descricao);
  let identificador = NAO_E_IDENTIFICADOR.some((re) => re.test(bruta)) ? null : bruta;
  if (!identificador && bruta) zerados.push({ nome: limpar(r.nome), era: bruta });

  return {
    categoria: r.categoria,
    nome: limpar(r.nome),
    identificador,
    identificadorBruto: bruta,
    contratoLegado,
    postoLegado,
    contratoAlvo: semContrato ? null : (DE_PARA_CONTRATO[contratoLegado] ?? contratoLegado),
    postoAlvo: semContrato ? null : (DE_PARA_POSTO[postoLegado] ?? postoLegado),
    lotacao: semContrato ? postoLegado : null,
    emManutencao: String(r.em_manutencao).toLowerCase() === "true",
    inicio: dataISO(r.data_inicio_manutencao),
    fim: dataISO(r.data_previsao_fim_manutencao),
  };
}).filter((l) => l.nome);

// Identificador repetido não identifica nada — mantém o primeiro e zera os
// demais, para não quebrar o índice único e para o dado não mentir.
const vistos = new Set();
const duplicados = [];
for (const l of linhas) {
  if (!l.identificador) continue;
  const k = l.identificador.toUpperCase();
  if (vistos.has(k)) {
    duplicados.push({ nome: l.nome, era: l.identificador });
    l.identificador = null;
  } else vistos.add(k);
}

// ── SQL ──────────────────────────────────────────────────────────────
const valores = linhas.map((l) =>
  `  (${q(l.categoria)}, ${q(l.nome)}, ${q(l.identificador)}, ${q(l.contratoAlvo)}, ` +
  `${q(l.postoAlvo)}, ${q(l.lotacao)}, ${l.emManutencao}, ${q(l.inicio)}::date, ${q(l.fim)}::date)`
).join(",\n");

const porCat = linhas.reduce((a, l) => ({ ...a, [l.categoria]: (a[l.categoria] ?? 0) + 1 }), {});
const emManut = linhas.filter((l) => l.emManutencao).length;
const semCtr = linhas.filter((l) => !l.contratoAlvo).length;

const sql = `-- =====================================================================
-- PATRIMÔNIO — carga completa, vinda do banco do legado
--
-- GERADO por scripts/gerar-migration-patrimonio.mjs a partir do dump das
-- tabelas \`veiculos\` e \`equipamentos\`. NÃO EDITE À MÃO.
--
--   ${linhas.length} itens · ${Object.entries(porCat).map(([k, v]) => `${v} ${k}`).join(" · ")}
--   ${emManut} em manutenção · ${semCtr} sem contrato (frota da sede)
--
-- Substitui a 20260824000002, que vinha do export do Painel e só tinha os 26
-- parados. Rodar esta com aquela já aplicada apenas COMPLETA o que falta —
-- o casamento é por identificador, e por (categoria, nome, contrato, posto)
-- para quem não tem identificador.
--
-- NO LEGADO A COLUNA \`descricao\` É O IDENTIFICADOR. Não é descrição livre:
-- é o que os modais "Adicionar Veículo/Máquina" chamavam de "Identificador".
--
-- DE-PARA DE CONTRATO
${Object.entries(DE_PARA_CONTRATO).map(([k, v]) => `--   ${k} → ${v}`).join("\n")}
--   ADMINISTRATIVO ESCRITÓRIO → sem contrato; o posto vira lotação
--
-- DE-PARA DE POSTO
${Object.entries(DE_PARA_POSTO).map(([k, v]) => `--   ${k} → ${v}`).join("\n")}
--
-- ROLLBACK: DELETE FROM public.sup_patrimonio
--            WHERE observacoes LIKE 'Importado do%legado';
-- =====================================================================

DROP TABLE IF EXISTS public.sup_imp_patrimonio;
CREATE TABLE public.sup_imp_patrimonio (
  categoria     text,
  nome          text,
  identificador text,
  contrato_nome text,
  posto_nome    text,
  lotacao       text,
  em_manutencao boolean,
  data_inicio   date,
  data_fim      date
);

INSERT INTO public.sup_imp_patrimonio
  (categoria, nome, identificador, contrato_nome, posto_nome, lotacao,
   em_manutencao, data_inicio, data_fim)
VALUES
${valores};

-- ── Higiene do que já entrou ─────────────────────────────────────────
-- A carga anterior (20260824000002) gravou como identificador textos que não
-- identificam nada — "ALMOXARIFADO" no SOPRADOR, por exemplo, que é o texto
-- de EXEMPLO do modal do legado. Zerar aqui faz duas coisas: corrige o dado e
-- permite o casamento abaixo reconhecer a linha, em vez de inserir de novo.
UPDATE public.sup_patrimonio p
   SET identificador = NULL
 WHERE p.identificador IS NOT NULL
   AND (
     trim(p.identificador) = ''
     OR upper(trim(p.identificador)) IN
        ('VEICULO','VEÍCULO','CARRO','CAMINHONETE','EQUIPAMENTO','MAQUINA','MÁQUINA',
         'ALMOXARIFADO','MANUTENCAO','MANUTENÇÃO')
     OR upper(trim(p.identificador)) ~ '^(SEM|NAO TEM|NÃO TEM).*(NUMERO|NÚMERO|NSERIE)'
   );

-- ── Carga ────────────────────────────────────────────────────────────
-- A empresa vem do contrato quando há; sem contrato, cai na empresa do
-- almoxarifado matriz (a frota da sede pertence à empresa, não a um contrato).
WITH resolvido AS (
  SELECT i.*,
         c.id  AS contrato_id,
         sp.id AS posto_id,
         COALESCE(c.empresa_id,
                  (SELECT a.empresa_id FROM public.almoxarifado a
                    WHERE a.is_matriz ORDER BY a.created_at LIMIT 1)) AS empresa_id
    FROM public.sup_imp_patrimonio i
    LEFT JOIN public.contratos c
      ON i.contrato_nome IS NOT NULL
     AND public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome)
    LEFT JOIN public.sup_posto sp
      ON sp.contrato_id = c.id
     AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(i.posto_nome)
)
INSERT INTO public.sup_patrimonio
  (empresa_id, categoria, nome, identificador, contrato_id, posto_id, lotacao,
   em_manutencao, data_inicio_manutencao, data_previsao_fim, observacoes)
SELECT r.empresa_id, r.categoria, r.nome, r.identificador, r.contrato_id, r.posto_id, r.lotacao,
       r.em_manutencao, r.data_inicio, r.data_fim,
       'Importado do banco do legado'
  FROM resolvido r
 WHERE r.empresa_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.sup_patrimonio p
      WHERE p.empresa_id = r.empresa_id
        AND (
          (r.identificador IS NOT NULL
           AND upper(trim(p.identificador)) = upper(trim(r.identificador)))
          OR (r.identificador IS NULL AND p.identificador IS NULL
              AND p.categoria = r.categoria
              AND upper(trim(p.nome)) = upper(trim(r.nome))
              AND p.contrato_id IS NOT DISTINCT FROM r.contrato_id
              AND p.posto_id    IS NOT DISTINCT FROM r.posto_id)
        )
   );

-- ── Conferência ──────────────────────────────────────────────────────
-- 1) Contratos do legado sem correspondente (fora os que viram lotação).
SELECT DISTINCT i.contrato_nome AS contrato_sem_correspondente
  FROM public.sup_imp_patrimonio i
 WHERE i.contrato_nome IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.contratos c
                    WHERE public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome))
 ORDER BY 1;

-- 2) Postos que não casaram (o item entra, mas sem posto).
SELECT DISTINCT i.contrato_nome, i.posto_nome AS posto_sem_correspondente
  FROM public.sup_imp_patrimonio i
  JOIN public.contratos c ON public.sup_norm_nome(c.nome) = public.sup_norm_nome(i.contrato_nome)
 WHERE NOT EXISTS (SELECT 1 FROM public.sup_posto sp
                    WHERE sp.contrato_id = c.id
                      AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(i.posto_nome))
 ORDER BY 1, 2;

-- 3) O que existe agora.
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE categoria = 'veiculo')::int      AS veiculos,
       count(*) FILTER (WHERE categoria = 'equipamento')::int  AS equipamentos,
       count(*) FILTER (WHERE em_manutencao)::int              AS em_manutencao,
       count(*) FILTER (WHERE contrato_id IS NULL)::int        AS sem_contrato,
       count(*) FILTER (WHERE contrato_id IS NOT NULL
                          AND posto_id IS NULL)::int           AS sem_posto
  FROM public.sup_patrimonio;

DROP TABLE IF EXISTS public.sup_imp_patrimonio;

NOTIFY pgrst, 'reload schema';
`;

writeFileSync(SAIDA_SQL, sql, "utf8");

// ── Relatório ────────────────────────────────────────────────────────
const porContrato = linhas.reduce((a, l) => {
  const k = l.contratoAlvo ?? `(sem contrato — lotação ${l.lotacao})`;
  return { ...a, [k]: (a[k] ?? 0) + 1 };
}, {});

const doc = `# Revisão da carga do patrimônio

Gerado por \`scripts/gerar-migration-patrimonio.mjs\` a partir do dump das tabelas
\`veiculos\` e \`equipamentos\` do banco legado.

| | |
|---|---|
| Itens | **${linhas.length}** |
| Veículos | ${porCat.veiculo ?? 0} |
| Máquinas/Equipamentos | ${porCat.equipamento ?? 0} |
| Em manutenção | ${emManut} |
| Sem contrato (frota da sede) | ${semCtr} |

## De-para aplicado

**Contrato** — os dois primeiros são os mesmos já confirmados na carga do catálogo; a Manutenção
escrevia o nome de outro jeito.

| Legado | ERP |
|---|---|
${Object.entries(DE_PARA_CONTRATO).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}
| ADMINISTRATIVO ESCRITÓRIO | *(sem contrato — o posto vira lotação)* |

**Posto**

| Legado | Catálogo |
|---|---|
${Object.entries(DE_PARA_POSTO).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}

## Identificadores zerados (${zerados.length})

No legado a coluna \`descricao\` guarda o identificador. Estes vieram com texto que **não
identifica nada** — em vários casos é o texto de EXEMPLO do próprio modal do legado
("Ex: Caminhonete, Carro" no veículo; "Ex: Almoxarifado, Manutenção" na máquina), que várias
pessoas digitaram literalmente. Entram com identificador nulo e podem ser preenchidos pela tela.

| Bem | Vinha como |
|---|---|
${zerados.map((z) => `| ${z.nome} | \`${z.era}\` |`).join("\n") || "| — | — |"}

## Identificadores duplicados, zerados a partir da 2ª ocorrência (${duplicados.length})

Um identificador repetido não distingue as unidades — que é a única função dele. Mantive na
primeira ocorrência e zerei nas demais, para o dado não mentir e para não quebrar o índice único.

| Bem | Valor repetido |
|---|---|
${duplicados.map((d) => `| ${d.nome} | \`${d.era}\` |`).join("\n") || "| — | — |"}

## Itens por contrato

| Contrato | Itens |
|---|---|
${Object.entries(porContrato).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}
`;

writeFileSync(SAIDA_DOC, doc, "utf8");

console.log(`itens ................ ${linhas.length}`);
console.log(`  veículos ........... ${porCat.veiculo ?? 0}`);
console.log(`  equipamentos ....... ${porCat.equipamento ?? 0}`);
console.log(`em manutenção ........ ${emManut}`);
console.log(`sem contrato (sede) .. ${semCtr}`);
console.log(`ident. zerados ....... ${zerados.length}  (+${duplicados.length} por duplicidade)`);
console.log(`SQL .................. ${(Buffer.byteLength(sql, "utf8") / 1024).toFixed(0)} KB -> ${SAIDA_SQL}`);
console.log(`relatorio ............ ${SAIDA_DOC}`);
