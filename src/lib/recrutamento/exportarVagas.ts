// =====================================================================
// Gestão Recrutamento — Exportar Excel (14/10/2026).
//
// Pedido do Pablo: "um botão no Gestão Recrutamento pra exportar Excel, e
// exportar no filtro que quiser". A tela busca as vagas (com os filtros dela
// ou todas) e entrega aqui; este arquivo só monta a planilha — não toca no
// banco, para dar para testar (src/test/exportarVagas.test.ts).
//
// Abas: "Vagas" (uma linha por vaga, filtro no cabeçalho), "Candidatos"
// (opcional, uma linha por candidato no processo) e "Resumo" (filtros usados
// + contagem por status e por contrato). Salário vira número quando dá, para
// somar e filtrar no Excel; datas saem como data.
// =====================================================================

import * as XLSX from "xlsx";

export interface VagaExport {
  id: number;
  created_at?: string | null;
  status?: string | null;
  status_changed_at?: string | null;
  contrato?: string | null;
  cargo?: string | null;
  cidade?: string | null;
  setor?: string | null;
  administrativa?: boolean | null;
  quantidade_vagas?: number | string | null;
  motivo_vaga?: string | null;
  nome_substituido?: string | null;
  grau_urgencia?: string | null;
  data_inicio_prevista?: string | null;
  escala?: string | null;
  horario?: string | null;
  salario?: string | number | null;
  beneficios?: string | null;
  insalubridade_recebe?: string | boolean | null;
  insalubridade_quanto?: string | number | null;
  local_exato?: string | null;
  solicitante_nome?: string | null;
  aprovado_por_nome?: string | null;
  analista_nome?: string | null;
  contratado_nome?: string | null;
  motivo_reprovacao?: string | null;
  etiquetas?: string[] | null;
}

export interface CandidatoExport {
  vaga_id: number;
  nome?: string | null;
  cpf?: string | null;
  telefone?: string | null;
  etapa_processo?: string | null;
  desistiu?: boolean | null;
  motivo_reprovacao?: string | null;
  desistencia_motivo?: string | null;
  enviado_admissao_em?: string | null;
}

export interface OpcoesExport {
  /** Texto do status como a tela mostra ("Pendente Analista" → "Pendente Operacional"). */
  rotuloStatus?: (s: string) => string;
  /** Texto do motivo como a tela mostra. */
  rotuloMotivo?: (m: string | null | undefined) => string;
  /** Responsável de cada vaga (SISTEMA_RECRUTAMENTO_RESPONSAVEL). */
  responsaveis?: Record<number, string>;
  /** Candidatos do processo; sem isto as colunas de contagem saem vazias e não há a aba. */
  candidatos?: CandidatoExport[];
  /** Linhas "Filtro | Valor" para a aba Resumo. */
  filtros?: [string, string][];
  /** Momento da exportação (teste fixa). */
  agora?: Date;
}

// A ordem do funil, para dizer qual é a etapa mais adiantada da vaga.
const ORDEM_ETAPA = ["ENTRADA", "TRIAGEM", "JURÍDICO", "ENTREVISTA", "ENTREVISTA GESTOR", "APROVADO",
  "DOCUMENTAÇÃO", "SST + COMPRAS", "EXAME SST", "COMPRAS", "ADMISSÃO"];
const rankEtapa = (e?: string | null) => {
  const s = String(e ?? "");
  if (s === "EXAME SST" || s === "COMPRAS") return ORDEM_ETAPA.indexOf("SST + COMPRAS");
  return ORDEM_ETAPA.indexOf(s);
};

/** "R$ 1.605,33" / "1605,33" / 1605.33 → 1605.33; texto que não é valor fica texto. */
export function salarioNumero(v: unknown): number | string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  const limpo = s.replace(/r\$\s*/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$|^\d+\.\d{1,2}$/.test(limpo)) return s;
  const n = /,/.test(limpo) ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
  return Number.isFinite(n) ? n : s;
}

/** ISO → Date (para o Excel tratar como data); vazio/ inválido → null. */
function data(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(+d) ? null : d;
}

const simNao = (v: unknown) => (v === true || v === "Sim" || v === "sim" ? "Sim" : v === false || v === "Não" || v === "nao" || v === "não" ? "Não" : (v == null || v === "" ? "" : String(v)));

/** Resumo de candidatos de uma vaga. */
export function resumoCandidatos(cands: CandidatoExport[]) {
  const noProcesso = cands.filter(c => c.etapa_processo);
  const fora = noProcesso.filter(c => c.etapa_processo === "Reprovado");
  const ativos = noProcesso.filter(c => c.etapa_processo !== "Reprovado");
  const maisAdiantado = ativos.reduce<CandidatoExport | null>((m, c) => (!m || rankEtapa(c.etapa_processo) > rankEtapa(m.etapa_processo) ? c : m), null);
  return {
    total: noProcesso.length,
    ativos: ativos.length,
    reprovados: fora.filter(c => !c.desistiu).length,
    desistencias: fora.filter(c => c.desistiu).length,
    etapaMaisAdiantada: maisAdiantado?.etapa_processo ?? "",
  };
}

/** Monta o workbook. Separado de `baixar` para o teste ler as abas. */
export function montarPlanilhaVagas(vagas: VagaExport[], op: OpcoesExport = {}): XLSX.WorkBook {
  const st = op.rotuloStatus ?? ((s: string) => s);
  const mot = op.rotuloMotivo ?? ((m: string | null | undefined) => m ?? "");
  const porVaga = new Map<number, CandidatoExport[]>();
  for (const c of op.candidatos ?? []) {
    const l = porVaga.get(c.vaga_id) ?? [];
    l.push(c); porVaga.set(c.vaga_id, l);
  }
  const comCandidatos = !!op.candidatos;

  const cab = [
    "Nº", "Data solicitação", "Status", "Status desde", "Contrato", "Cargo", "Cidade", "Setor", "Administrativa",
    "Qtd. vagas", "Motivo", "Substituído", "Urgência", "Início previsto", "Escala", "Horário", "Salário", "Benefícios",
    "Insalubridade", "Insalubridade (%)", "Posto / local", "Solicitado por", "Aprovado por", "Analista", "Responsável",
    "Contratado", "Motivo reprovação", "Etiquetas",
    ...(comCandidatos ? ["Candidatos no processo", "Em andamento", "Reprovados", "Desistências", "Etapa mais adiantada"] : []),
  ];
  const linhas: unknown[][] = vagas.map(v => {
    const r = resumoCandidatos(porVaga.get(v.id) ?? []);
    const qtd = v.quantidade_vagas == null || v.quantidade_vagas === "" ? null : Number(v.quantidade_vagas);
    return [
      v.id, data(v.created_at), st(String(v.status ?? "")), data(v.status_changed_at), v.contrato ?? "", v.cargo ?? "",
      v.cidade ?? "", v.setor ?? "", v.administrativa ? "Sim" : "Não",
      qtd != null && Number.isFinite(qtd) ? qtd : (v.quantidade_vagas ?? ""), mot(v.motivo_vaga), v.nome_substituido ?? "",
      v.grau_urgencia ?? "", v.data_inicio_prevista ?? "", v.escala ?? "", v.horario ?? "", salarioNumero(v.salario),
      v.beneficios ?? "", simNao(v.insalubridade_recebe), v.insalubridade_quanto ?? "", v.local_exato ?? "",
      v.solicitante_nome ?? "", v.aprovado_por_nome ?? "", v.analista_nome ?? "", op.responsaveis?.[v.id] ?? "",
      v.contratado_nome ?? "", v.motivo_reprovacao ?? "", (v.etiquetas ?? []).join(", "),
      ...(comCandidatos ? [r.total, r.ativos, r.reprovados, r.desistencias, r.etapaMaisAdiantada] : []),
    ];
  });

  const wb = XLSX.utils.book_new();
  const wsVagas = XLSX.utils.aoa_to_sheet([cab, ...linhas], { cellDates: true, dateNF: "dd/mm/yyyy" });
  wsVagas["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(linhas.length, 1), c: cab.length - 1 } }) };
  wsVagas["!cols"] = cab.map((h, i) => {
    const maior = Math.max(h.length, ...linhas.slice(0, 500).map(l => {
      const x = l[i];
      return x instanceof Date ? 10 : String(x ?? "").length;
    }));
    return { wch: Math.min(Math.max(maior + 2, 8), 50) };
  });
  // Salário em moeda.
  const colSal = cab.indexOf("Salário");
  for (let r = 1; r <= linhas.length; r++) {
    const cel = wsVagas[XLSX.utils.encode_cell({ r, c: colSal })];
    if (cel && cel.t === "n") cel.z = '"R$" #,##0.00';
  }
  XLSX.utils.book_append_sheet(wb, wsVagas, "Vagas");

  if (comCandidatos) {
    const vagaPorId = new Map(vagas.map(v => [v.id, v]));
    const cabC = ["Nº vaga", "Cargo", "Contrato", "Cidade", "Candidato", "CPF", "Telefone", "Etapa", "Situação", "Motivo", "Enviado à Admissão em"];
    const linC = (op.candidatos ?? []).filter(c => c.etapa_processo && vagaPorId.has(c.vaga_id)).map(c => {
      const v = vagaPorId.get(c.vaga_id)!;
      const situacao = c.etapa_processo === "Reprovado" ? (c.desistiu ? "Desistiu" : "Reprovado")
        : c.etapa_processo === "ADMISSÃO" && c.enviado_admissao_em ? "Contratado" : "Em andamento";
      return [c.vaga_id, v.cargo ?? "", v.contrato ?? "", v.cidade ?? "", c.nome ?? "", c.cpf ?? "", c.telefone ?? "",
        c.etapa_processo ?? "", situacao, (c.desistiu ? c.desistencia_motivo : c.motivo_reprovacao) ?? "", data(c.enviado_admissao_em)];
    });
    const wsC = XLSX.utils.aoa_to_sheet([cabC, ...linC], { cellDates: true, dateNF: "dd/mm/yyyy" });
    wsC["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(linC.length, 1), c: cabC.length - 1 } }) };
    wsC["!cols"] = [8, 28, 28, 18, 34, 15, 16, 18, 14, 40, 14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsC, "Candidatos");
  }

  // Resumo: filtros usados + contagem por status e por contrato.
  const conta = (f: (v: VagaExport) => string) => {
    const m = new Map<string, number>();
    for (const v of vagas) { const k = f(v) || "(vazio)"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  };
  const agora = op.agora ?? new Date();
  const res: unknown[][] = [
    ["Gestão Recrutamento — exportação de vagas"],
    ["Gerado em", agora.toLocaleString("pt-BR")],
    ["Vagas exportadas", vagas.length],
    [],
    ["Filtros aplicados"],
    ...((op.filtros ?? []).length ? op.filtros! : [["—", "Todas as vagas (sem filtro)"]]),
    [],
    ["Por status", "Vagas"],
    ...conta(v => st(String(v.status ?? ""))),
    [],
    ["Por contrato", "Vagas"],
    ...conta(v => String(v.contrato ?? "").trim()),
  ];
  const wsR = XLSX.utils.aoa_to_sheet(res);
  wsR["!cols"] = [{ wch: 42 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsR, "Resumo");
  return wb;
}

/** Nome do arquivo: vagas-recrutamento-AAAA-MM-DD.xlsx */
export function nomeArquivoVagas(agora = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `vagas-recrutamento-${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}.xlsx`;
}

export function baixarPlanilhaVagas(vagas: VagaExport[], op: OpcoesExport = {}) {
  XLSX.writeFile(montarPlanilhaVagas(vagas, op), nomeArquivoVagas(op.agora));
}
