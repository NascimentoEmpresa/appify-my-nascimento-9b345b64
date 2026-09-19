// Comprovantes de pagamento do processo (18/09/2026, mig 193).
//
// A regra de vínculo AUTOMÁTICO mora no banco (jur_processo_pagamentos): a
// despesa do Malote que cita o número CNJ do processo no nome/descrição é
// dele. Aqui ficam os tipos, o regex do CNJ (o mesmo do banco, pra tela
// reconhecer o que vai casar) e os resumos que a tela mostra.

export const CNJ_REGEX = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;

/** Todos os números CNJ que aparecem num texto (sem repetir). */
export const numerosCnjDe = (texto: string | null | undefined): string[] =>
  [...new Set(String(texto ?? "").match(CNJ_REGEX) ?? [])];

export interface ParcelaMalote {
  numero_parcela: number;
  valor: number | string | null;
  data_vencimento: string | null;
  status: string | null;
  comprovante_path: string | null;
  pago_em: string | null;
  data_pagamento_real: string | null;
}

export interface PagamentoMalote {
  despesa_id: string;
  numero: string | null;
  nome: string | null;
  status: string | null;
  valor_total: number | string | null;
  valor_aprovado: number | string | null;
  data_pagamento: string | null;
  pago_em: string | null;
  forma_pagamento: string | null;
  comprovante_path: string | null;
  observacao_pagamento: string | null;
  /** malote_auto = casou pelo número CNJ; malote_manual = vinculado à mão. */
  origem: "malote_auto" | "malote_manual";
  vinculo_id: number | null;
  parcelas: ParcelaMalote[];
}

export interface ComprovanteAvulso {
  id: number;
  processo_id: number;
  nome: string;
  storage_path: string;
  tipo: string | null;
  tamanho: number | null;
  descricao: string | null;
  valor: number | string | null;
  data_pagamento: string | null;
  criado_por_nome: string | null;
  created_at: string;
}

export interface PagamentosDoProcesso {
  numero_processo: string;
  malote: PagamentoMalote[];
  anexos: ComprovanteAvulso[];
}

export const BUCKET_MALOTE = "malote-anexos";
export const BUCKET_COMPROVANTES = "juridico-comprovantes";

/** Comprovantes (arquivos) que uma despesa tem: o dela e os das parcelas. */
export const comprovantesDaDespesa = (d: PagamentoMalote): { rotulo: string; path: string }[] => {
  const out: { rotulo: string; path: string }[] = [];
  if (d.comprovante_path) out.push({ rotulo: "Comprovante", path: d.comprovante_path });
  for (const p of d.parcelas ?? []) if (p.comprovante_path) out.push({ rotulo: `Parcela ${p.numero_parcela}`, path: p.comprovante_path });
  return out;
};

/** Status do Malote em português de tela. */
export const rotuloStatusMalote = (s?: string | null): { texto: string; cor: string; bg: string } => {
  const k = String(s ?? "");
  if (k === "despesa_paga") return { texto: "Pago", cor: "#15803d", bg: "#dcfce7" };
  if (k === "aguardando_pagamento") return { texto: "Aguardando pagamento", cor: "#b45309", bg: "#fef3c7" };
  if (k === "pendente_aprovacao") return { texto: "Pendente de aprovação", cor: "#7c3aed", bg: "#ede9fe" };
  if (k === "despesa_reprovada" || k === "solicitacao_reprovada") return { texto: "Reprovada", cor: "#b91c1c", bg: "#fee2e2" };
  if (k === "cancelada") return { texto: "Cancelada", cor: "#64748b", bg: "#f1f5f9" };
  if (k === "rascunho") return { texto: "Rascunho", cor: "#64748b", bg: "#f1f5f9" };
  return { texto: k.replace(/_/g, " ") || "—", cor: "#334155", bg: "#f1f5f9" };
};

/** Resumo pro cabeçalho: quantos pagamentos, quantos com comprovante, total pago. */
export function resumoPagamentos(p: PagamentosDoProcesso | null | undefined) {
  const malote = p?.malote ?? [];
  const anexos = p?.anexos ?? [];
  const pagos = malote.filter(d => d.status === "despesa_paga");
  const totalPago = pagos.reduce((s, d) => s + Number(d.valor_aprovado ?? d.valor_total ?? 0), 0);
  const comComprovante = malote.filter(d => comprovantesDaDespesa(d).length > 0).length + anexos.length;
  return { despesas: malote.length, pagos: pagos.length, totalPago, comComprovante, anexos: anexos.length, total: malote.length + anexos.length };
}

/** Caminho no bucket juridico-comprovantes: <processo>/<carimbo>_<nome seguro>. */
export const caminhoComprovante = (processoId: number, nome: string, agora = Date.now()): string =>
  `${processoId}/${agora}_${nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-120) || "arquivo"}`;
