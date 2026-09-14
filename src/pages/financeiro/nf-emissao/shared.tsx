export const fmtMoney = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
export const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "-");
// "2026-07" -> "07/2026" (competência já vem truncada em YYYY-MM em vários lugares)
export const fmtCompetenciaCurta = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;
// "2026-07" -> "2026-08" (mês seguinte, ainda em YYYY-MM)
export function proximaCompetencia(c: string): string {
  const ano = Number(c.slice(0, 4));
  const mes = Number(c.slice(5, 7));
  const proxMes = mes === 12 ? 1 : mes + 1;
  const proxAno = mes === 12 ? ano + 1 : ano;
  return `${proxAno}-${String(proxMes).padStart(2, "0")}`;
}
// "2026-07" -> "2026-06" (mês anterior, ainda em YYYY-MM)
export function competenciaAnterior(c: string): string {
  const ano = Number(c.slice(0, 4));
  const mes = Number(c.slice(5, 7));
  const antMes = mes === 1 ? 12 : mes - 1;
  const antAno = mes === 1 ? ano - 1 : ano;
  return `${antAno}-${String(antMes).padStart(2, "0")}`;
}

export const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  concluida: "Concluída",
  cancelada: "Cancelada",
};
export const STATUS_CLASS: Record<string, string> = {
  rascunho: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  enviada: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  concluida: "bg-sky-100 text-sky-800 hover:bg-sky-100",
  cancelada: "bg-slate-200 text-slate-600 hover:bg-slate-200",
};

// "Situação site P.M.T."/"Situa Domínio" vêm da planilha legada com um desses
// 3 valores — NORMAL é o caso comum; SUBSTITUIDA/CANCELADA são notas que
// nunca vão ter pagamento (foram trocadas/anuladas por fora do fluxo do app),
// mas ainda ficam com status='concluida' no banco (o import não tem outro
// status pra elas), então quem exibe a nota precisa checar isso à parte.
export function situacaoEspecial(n: {
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
}): "SUBSTITUIDA" | "CANCELADA" | null {
  const valores = [n.situacao_site_pmt?.toUpperCase(), n.situacao_dominio?.toUpperCase()];
  if (valores.includes("CANCELADA")) return "CANCELADA";
  if (valores.includes("SUBSTITUIDA")) return "SUBSTITUIDA";
  return null;
}

// SIS-2026-0323: movida de NotasConcluidasTab.tsx pra cá — Relatório Geral
// e Dashboard também precisam classificar o status de cada NF.
export type StatusNota = "pendente" | "pago" | "substituida" | "cancelada";

export function statusDaNota(n: {
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  data_pagamento?: string | null;
}): StatusNota {
  const esp = situacaoEspecial(n);
  if (esp === "CANCELADA") return "cancelada";
  if (esp === "SUBSTITUIDA") return "substituida";
  return n.data_pagamento ? "pago" : "pendente";
}

// SIS-2026-0323 (mockup do Ruan/Discord): descontos aplicados DEPOIS da
// emissão da NF (multas/glosas/outros) só existem a nível de item — soma
// todos os itens de uma NF.
export function somaDescontosPosEmissao(itens: { multas_pos_emissao: number; glosas_pos_emissao: number; outros_descontos_pos_emissao: number }[]): number {
  return itens.reduce((s, it) => s + (it.multas_pos_emissao || 0) + (it.glosas_pos_emissao || 0) + (it.outros_descontos_pos_emissao || 0), 0);
}

// Fórmula do protótipo de referência, confirmada com o usuário: valor
// pendente de recebimento NÃO incorpora os campos de reconciliação manual
// (Falta receber/Pago a mais/Recebimento extra) — só líquido, valor pago,
// desconto de conta vinculada e descontos pós-emissão dos itens.
// SIS-2026-0323: filtro "Pendência > 30 dias" do mockup — dias corridos
// desde a data de emissão até hoje.
export function diasDesdeEmissao(dataEmissao: string | null | undefined): number | null {
  if (!dataEmissao) return null;
  const emissao = new Date(dataEmissao + "T00:00:00");
  if (isNaN(emissao.getTime())) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.floor((hoje.getTime() - emissao.getTime()) / 86_400_000);
}

// SIS-2026-0323 (mockup do Ruan/Discord): filtro por cabeçalho de coluna
// pra campos monetários faz "contém" no texto formatado em BRL (mesma
// lógica do protótipo — busca solta, não faixa numérica).
export function moneyTextContains(valor: number, termo: string): boolean {
  if (!termo.trim()) return true;
  return fmtMoney(valor).toLowerCase().includes(termo.trim().toLowerCase());
}

export function pendenteHaMaisDe30Dias(n: { situacao_site_pmt?: string | null; situacao_dominio?: string | null; data_pagamento?: string | null; data_emissao?: string | null }): boolean {
  if (statusDaNota(n) !== "pendente") return false;
  const dias = diasDesdeEmissao(n.data_emissao);
  return dias !== null && dias > 30;
}

export function valorPendenteNf(
  nf: { vlr_liquido_total: number; valor_pago: number | null; desconto_conta_vinculada: number },
  itens: { multas_pos_emissao: number; glosas_pos_emissao: number; outros_descontos_pos_emissao: number }[],
): number {
  const pos = somaDescontosPosEmissao(itens);
  return Math.max(0, nf.vlr_liquido_total - (nf.valor_pago ?? 0) - nf.desconto_conta_vinculada - pos);
}

export function itemVazio(ordem: number) {
  return {
    identificacao: `Item ${ordem}`,
    valor_contrato_exec: 0,
    vlr_va: 0,
    vlr_vt: 0,
    vlr_materiais: 0,
    faltas: 0,
    posto_nao_implementado: 0,
    multas: 0,
    glosas: 0,
    outros_descontos: 0,
    multas_pos_emissao: 0,
    glosas_pos_emissao: 0,
    outros_descontos_pos_emissao: 0,
    qtd_colaboradores: 0,
    inss_categoria: "normais" as const,
    issqn_pct: null,
    ir_pct: null,
    cofins_pct: null,
    pis_pct: null,
    csll_pct: null,
  };
}

export function Linha({ label, valor, destaque }: { label: string; valor: number; destaque?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${destaque ? "font-semibold" : ""}`}>
      <span className={destaque ? "" : "text-muted-foreground"}>{label}</span>
      <span>{fmtMoney(valor)}</span>
    </div>
  );
}
