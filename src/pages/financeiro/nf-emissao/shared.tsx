export const fmtMoney = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
export const fmtPct = (n: number) => `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("pt-BR") : "-");

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
