// =====================================================================
// Vagas do sistema antigo (bot do Discord) -> SISTEMA_RECRUTAMENTO.
//
// Pedido de 23/09/2026: migrar TODAS as solicitações de vaga do
// export-vagas-completo.xlsx para a Gestão Recrutamento, encerradas:
//   • Contratado / Aprovado Operação / Buscando Colaborador -> "Concluído"
//   • Reprovado                                              -> "Reprovada"
// (a tela conta todo "Concluído…" como contratação — reprovada lá dentro
// inflaria esse número; decisão do Pablo no mesmo dia).
//
// Gera UM ARQUIVO SQL POR MÊS da solicitação, para colar no SQL Editor do
// banco do app, na ordem, DEPOIS da migration 20260930000221 (que cria a
// coluna legado_chave). Cada arquivo:
//   • desliga, só dentro da transação, os gatilhos que recusariam vaga
//     antiga (7 dias úteis até o início, demissão obrigatória em
//     Substituição, substituído único) ou reescreveriam o status;
//   • insere as vagas com a data ORIGINAL da solicitação (created_at),
//     então elas caem no mês certo do filtro por período;
//   • traz a aba Historico do xlsx para o RECRUTAMENTO_HISTORICO (a régua
//     de status da vaga) + um evento "Importada do sistema antigo";
//   • é reexecutável: ON CONFLICT (legado_chave) DO NOTHING.
//
// Os .sql gerados têm nome e telefone de contratados: NÃO vão para o git.
// Por padrão saem numa pasta ao lado do xlsx.
//
// Uso (da raiz do repositório, que já tem o pacote xlsx):
//   node migracao-sistema-antigo/vagas-discord/gerar-sql-vagas.mjs <xlsx> [pasta-saida]
// =====================================================================
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const [arquivo, saidaArg] = process.argv.slice(2);
if (!arquivo) {
  console.error("Uso: node gerar-sql-vagas.mjs <export-vagas-completo.xlsx> [pasta-saida]");
  process.exit(1);
}
const saida = saidaArg ?? path.join(path.dirname(arquivo), "vagas-sistema-antigo-sql");
mkdirSync(saida, { recursive: true });

const wb = XLSX.readFile(arquivo);
const ler = (aba) => XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: null, raw: false });
const vagas = ler("Vagas");
const historico = ler("Historico");

// ── Conversões ───────────────────────────────────────────────────────
const txt = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};
/** "27/01/2026, 14:05:09" (horário de Brasília) -> "2026-01-27 14:05:09-03". */
const quando = (v) => {
  const m = String(v ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}-03` : null;
};
/** "29/01/2026" -> "2026-01-29" (o formato do <input type=date> da tela). Texto livre fica como veio. */
const dataCampo = (v) => {
  const s = txt(v);
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
const inteiro = (v) => {
  const n = parseInt(String(v ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};
const MOTIVO = { "Aumento de quadro": "Expansão (Aumento de Quadro)" };
const statusNovo = (s) => (String(s ?? "").trim() === "Reprovado" ? "Reprovada" : "Concluído");

/** Literal SQL. */
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const chaveDe = (userId, date) => `${String(userId ?? "").trim()}|${String(date ?? "").trim()}`;

// ── Histórico por vaga ───────────────────────────────────────────────
const histPorChave = new Map();
for (const h of historico) {
  const k = chaveDe(h.userId, h.date);
  const em = quando(h.data);
  if (!em) continue;
  const acao = txt(h.acao) ?? "";
  const ev = {
    em,
    evento: acao || "Movimentação no sistema antigo",
    para: acao.startsWith("Status:") ? acao.replace(/^Status:\s*/, "") : null,
    ator: txt(h.ator),
  };
  (histPorChave.get(k) ?? histPorChave.set(k, []).get(k)).push(ev);
}

// ── Vagas ────────────────────────────────────────────────────────────
const porMes = new Map();
const semData = [];
const colunas = [
  "legado_chave", "created_at", "status_changed_at", "status",
  "motivo_vaga", "nome_substituido", "contrato", "cargo", "cidade",
  "quantidade_vagas", "data_inicio_prevista", "escala", "horario", "salario",
  "insalubridade_recebe", "insalubridade_quanto", "beneficios", "local_exato",
  "grau_urgencia", "alta_rotatividade", "req_obrigatorios", "req_desejaveis",
  "exp_minima", "exp_minima_qual", "motivos_saida", "recomendacao",
  "observacao_importante", "solicitante_nome", "aprovado_por_nome",
  "motivo_reprovacao", "funcionario_selecionado", "contratado_nome",
  "contratado_contato", "contratado_data_inicio", "reposicao_tecnica",
  "status_antigo",
];

for (const v of vagas) {
  const criada = quando(v.date);
  const chave = chaveDe(v.userId, v.date);
  if (!criada) { semData.push(chave); continue; }
  const eventos = (histPorChave.get(chave) ?? []).sort((a, b) => a.em.localeCompare(b.em));
  const motivoAntigo = txt(v["cadmanual.motivoVaga"]);
  const linha = {
    legado_chave: chave,
    created_at: criada,
    status_changed_at: eventos.at(-1)?.em ?? criada,
    status: statusNovo(v.status),
    motivo_vaga: MOTIVO[motivoAntigo] ?? motivoAntigo,
    nome_substituido: txt(v["cadmanual.nomeColaboradorSubstituido"]),
    contrato: txt(v["cadmanual.contratoUnidade"]) ?? txt(v.contratoExcelLabel),
    cargo: txt(v["cadmanual.cargo"]) ?? txt(v.tipoServico),
    cidade: txt(v["cadmanual.cidade"]) ?? txt(v.tipoPosto),
    quantidade_vagas: inteiro(v["cadmanual.quantidadeVagas"] ?? v.quantidadeVagas),
    data_inicio_prevista: dataCampo(v["cadmanual.dataInicio"]),
    escala: txt(v["cadmanual.escala"]) ?? txt(v.escalaPrevista),
    horario: txt(v["cadmanual.horario"]),
    salario: txt(v["cadmanual.salario"]) ?? txt(v["cadmanual.salarioTotal"]) ?? txt(v.salarioTotal),
    insalubridade_recebe: txt(v["cadmanual.insalubridadeRecebe"]),
    insalubridade_quanto: txt(v["cadmanual.insalubridadeQuanto"]) ?? txt(v["cadmanual.insalubridadeValor"]) ?? txt(v["cadmanual.insalubridadePercent"]),
    beneficios: txt(v["cadmanual.beneficios"]),
    local_exato: txt(v["cadmanual.localExato"]),
    grau_urgencia: txt(v["cadmanual.grauUrgencia"]),
    alta_rotatividade: txt(v["cadmanual.altaRotatividadeSimNao"]),
    req_obrigatorios: txt(v["cadmanual.reqObrigatorios"]),
    req_desejaveis: txt(v["cadmanual.reqDesejaveis"]),
    exp_minima: txt(v["cadmanual.expMinimaSimNao"]),
    exp_minima_qual: txt(v["cadmanual.expMinimaQual"]),
    motivos_saida: txt(v["cadmanual.motivosSaida"]),
    recomendacao: txt(v["cadmanual.recomendacao"]),
    observacao_importante: txt(v["cadmanual.observacaoImportante"]),
    solicitante_nome: txt(v.solicitanteAssinatura) ?? txt(v.userName) ?? txt(v.nick),
    aprovado_por_nome: txt(v["_locks.operacaoApprovedByUserTag"]),
    motivo_reprovacao: txt(v.motivoReprovacao),
    funcionario_selecionado: txt(v["funcionarioSelecionado.nome"]),
    contratado_nome: txt(v["contratado.nomeCompleto"]),
    contratado_contato: txt(v["contratado.contato"]),
    contratado_data_inicio: dataCampo(v["contratado.dataInicio"]),
    reposicao_tecnica: motivoAntigo === "Reserva técnica",
    status_antigo: txt(v.status) ?? "(sem status)",
    eventos,
  };
  const mes = criada.slice(0, 7);
  (porMes.get(mes) ?? porMes.set(mes, []).get(mes)).push(linha);
}

// ── SQL ──────────────────────────────────────────────────────────────
const GATILHOS = [
  "trg_sistema_recrutamento_guard",
  "trg_rec_status_inicial_pela_flag",
  "trg_rec_vaga_exige_demissao",
  "trg_rec_substituido_unico",
];
const liga = (acao) => `DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[${GATILHOS.map(q).join(", ")}] LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND tgrelid = 'public."SISTEMA_RECRUTAMENTO"'::regclass) THEN
      EXECUTE format('ALTER TABLE public."SISTEMA_RECRUTAMENTO" ${acao} TRIGGER %I', t);
    END IF;
  END LOOP;
END $$;`;

const valorLinha = (l) => "(" + colunas.map((c) => (typeof l[c] === "number" || typeof l[c] === "boolean" ? String(l[c]) : q(l[c]))).join(", ") + ")";

const arquivos = [];
for (const [mes, linhas] of [...porMes].sort(([a], [b]) => a.localeCompare(b))) {
  const eventos = linhas.flatMap((l) => l.eventos.map((e) => `(${q(l.legado_chave)}, ${q(e.em)}, ${q(e.evento)}, ${q(e.para)}, ${q(e.ator)})`));
  const conc = linhas.filter((l) => l.status === "Concluído").length;
  const sql = `-- Vagas do sistema antigo (Discord) — solicitações de ${mes}
-- ${linhas.length} vaga(s): ${conc} Concluído, ${linhas.length - conc} Reprovada. ${eventos.length} evento(s) de histórico.
-- Gerado por migracao-sistema-antigo/vagas-discord/gerar-sql-vagas.mjs.
-- Pré-requisito: migration 20260930000221 (coluna legado_chave). Reexecutável.
BEGIN;

${liga("DISABLE")}

WITH dados (${colunas.join(", ")}) AS (
  VALUES
  ${linhas.map(valorLinha).join(",\n  ")}
),
ins AS (
  INSERT INTO public."SISTEMA_RECRUTAMENTO" (${colunas.filter((c) => c !== "status_antigo").join(", ")})
  SELECT ${colunas.filter((c) => c !== "status_antigo").map((c) =>
    c === "created_at" || c === "status_changed_at" ? `${c}::timestamptz`
    : c === "quantidade_vagas" ? `${c}::integer`
    : c === "reposicao_tecnica" ? `${c}::boolean`
    : c).join(", ")}
    FROM dados
  ON CONFLICT (legado_chave) DO NOTHING
  RETURNING id, legado_chave
)${eventos.length ? `,
hist (chave, em, evento, para_status, ator) AS (
  VALUES
  ${eventos.join(",\n  ")}
)` : ""}
INSERT INTO public."RECRUTAMENTO_HISTORICO" (solicitacao_id, created_at, evento, de_status, para_status, papel, usuario_nome, detalhe)
${eventos.length ? `SELECT ins.id, hist.em::timestamptz, hist.evento, NULL, hist.para_status, 'Sistema antigo', hist.ator, NULL
  FROM ins JOIN hist ON hist.chave = ins.legado_chave
UNION ALL
` : ""}SELECT ins.id, now(), 'Importada do sistema antigo (Discord)', d.status_antigo, d.status, 'Sistema', 'Migração',
       'Status no sistema antigo: ' || d.status_antigo
  FROM ins JOIN dados d ON d.legado_chave = ins.legado_chave;

${liga("ENABLE")}

COMMIT;

-- Conferência: ${linhas.length} vaga(s) de ${mes}.
-- SELECT status, count(*) FROM public."SISTEMA_RECRUTAMENTO"
--  WHERE legado_chave IS NOT NULL AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = '${mes}'
--  GROUP BY status;
`;
  const nome = `vagas-sistema-antigo-${mes}.sql`;
  writeFileSync(path.join(saida, nome), sql, "utf8");
  arquivos.push({ nome, vagas: linhas.length, concluido: conc, eventos: eventos.length });
}

console.log(`Vagas lidas: ${vagas.length} | histórico: ${historico.length} | sem data válida (ignoradas): ${semData.length}`);
if (semData.length) console.log("  sem data:", semData.join(", "));
console.table(arquivos);
console.log(`Arquivos em: ${saida}`);
