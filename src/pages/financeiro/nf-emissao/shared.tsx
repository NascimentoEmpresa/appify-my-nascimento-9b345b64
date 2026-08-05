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
