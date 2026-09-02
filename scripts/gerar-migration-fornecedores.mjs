/**
 * Gera a migration de carga dos fornecedores ativos da planilha consolidada.
 *
 *   node scripts/gerar-migration-fornecedores.mjs
 *
 * Para atualizar a carga, corrija a planilha e execute este script novamente.
 * Não edite a migration gerada à mão.
 */
import XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLANILHA = resolve(
  RAIZ,
  "docs/planilhas/fornecedores_consolidados_duas_bases_sem_duplicidades (1) (1).xlsx",
);
const ABA = "Planilha1";
const SAIDA_SQL = resolve(
  RAIZ,
  "supabase/migrations/20260927000002_carga_fornecedores_ativos.sql",
);
const EMPRESA_ID = "5a61c769-21d8-4e61-b9bb-506b8db0bce8";

const limpar = (valor) => String(valor ?? "").trim();
const somenteDigitos = (valor) => limpar(valor).replace(/\D/g, "");
const escaparSql = (valor) => limpar(valor).replace(/'/g, "''");

function abortar(mensagem) {
  console.error(`Erro ao gerar migration de fornecedores: ${mensagem}`);
  process.exit(1);
}

function inferirTipo(tipoBruto, documento, linha) {
  const tipo = limpar(tipoBruto).toUpperCase();
  if (tipo === "CNPJ") return "pj";
  if (tipo === "CPF") return "pf";
  if (tipo) abortar(`linha ${linha}: TIPO inválido "${tipoBruto}"; use CNPJ ou CPF.`);

  return documento.length === 11 ? "pf" : "pj";
}

const planilha = XLSX.readFile(PLANILHA, { cellText: true });
if (!planilha.SheetNames.includes(ABA)) {
  abortar(`a aba "${ABA}" não existe em ${PLANILHA}.`);
}

// raw: false usa o texto exibido no Excel, preservando a máscara do CNPJ/CPF.
const linhas = XLSX.utils.sheet_to_json(planilha.Sheets[ABA], {
  defval: "",
  raw: false,
});

const fornecedores = [];
const documentosAtivos = new Set();
let ignoradosPorStatus = 0;

linhas.forEach((row, indice) => {
  const linha = indice + 2;
  const status = limpar(row.STATUS).toUpperCase();
  if (status !== "ATIVO") {
    ignoradosPorStatus += 1;
    return;
  }

  const nome = limpar(row.NOME);
  const cnpjCpf = limpar(row.CNPJ);
  if (!nome) abortar(`linha ${linha}: NOME é obrigatório para fornecedor ativo.`);
  if (!cnpjCpf) abortar(`linha ${linha}: CNPJ é obrigatório para fornecedor ativo.`);

  const documento = somenteDigitos(cnpjCpf);
  if (documento.length !== 11 && documento.length !== 14) {
    abortar(`linha ${linha}: CNPJ/CPF "${cnpjCpf}" deve ter 11 ou 14 dígitos.`);
  }
  if (documentosAtivos.has(documento)) {
    abortar(`linha ${linha}: CNPJ/CPF duplicado entre ativos: "${cnpjCpf}".`);
  }
  documentosAtivos.add(documento);

  fornecedores.push({
    cnpjCpf,
    documento,
    nome,
    tipo: inferirTipo(row.TIPO, documento, linha),
  });
});

const valores = fornecedores
  .map((fornecedor) =>
    `  ('${escaparSql(fornecedor.cnpjCpf)}', '${escaparSql(fornecedor.nome)}', '${fornecedor.tipo}')`,
  )
  .join(",\n");

const documentosRollback = fornecedores
  .map((fornecedor, indice) =>
    `--        '${fornecedor.documento}'${indice === fornecedores.length - 1 ? "" : ","}`,
  )
  .join("\n");

const sql = `-- =====================================================================
-- SIS-2026-0242 — carga dos fornecedores ATIVOS da planilha consolidada
--
-- Origem: docs/planilhas/fornecedores_consolidados_duas_bases_sem_duplicidades (1) (1).xlsx,
-- aba "Planilha1" (NOME, CNPJ, TIPO, STATUS) — só STATUS = ATIVO.
-- Gerado por scripts/gerar-migration-fornecedores.mjs — não editar à mão.
--
-- Campos por decisão do gerente: nome (razão social = nome fantasia), CNPJ,
-- tipo e ativo. O resto do cadastro é preenchido depois pelo próprio
-- fornecedor, pelo fluxo do SIS-2026-0209.
--
-- empresa_id = HAGG + is_global = true, seguindo a carga de 20260520205927.
-- Idempotente: reexecutar não duplica (casa por CNPJ/CPF só-dígitos).
--
-- ROLLBACK:
--   DELETE FROM public.fornecedor
--    WHERE is_global = true
--      AND regexp_replace(coalesce(cnpj_cpf,''), '\\D', '', 'g') IN (
${documentosRollback}
--      );
-- =====================================================================

SELECT count(*)::int AS fornecedores_antes FROM public.fornecedor;

WITH novos (cnpj_cpf, razao_social, tipo) AS (VALUES
${valores}
)
INSERT INTO public.fornecedor
  (empresa_id, tipo, cnpj_cpf, razao_social, nome_fantasia, ativo, is_global)
SELECT '${EMPRESA_ID}',
       n.tipo::public.fornecedor_tipo,
       n.cnpj_cpf, n.razao_social, n.razao_social, true, true
  FROM novos n
 WHERE NOT EXISTS (
   SELECT 1 FROM public.fornecedor f
    WHERE regexp_replace(coalesce(f.cnpj_cpf,''), '\\D', '', 'g')
        = regexp_replace(n.cnpj_cpf, '\\D', '', 'g')
 );

SELECT count(*)::int AS total,
       count(*) FILTER (WHERE tipo = 'pj')::int AS pj,
       count(*) FILTER (WHERE tipo = 'pf')::int AS pf,
       count(*) FILTER (WHERE is_global)::int  AS globais
  FROM public.fornecedor;

NOTIFY pgrst, 'reload schema';
`;

writeFileSync(SAIDA_SQL, sql, "utf8");

console.log(`lidos ................ ${linhas.length}`);
console.log(`ativos ............... ${fornecedores.length}`);
console.log(`ignorados por status . ${ignoradosPorStatus}`);
console.log(`gravados ............. ${fornecedores.length}`);
console.log(`SQL .................. ${SAIDA_SQL}`);
