// =====================================================================
// Data em que o colaborador começa a trabalhar (mig 20261028001800).
//
// Chamado (28/10/2026): "para que o compras tenha ideia do início no posto
// para liberar com mais agilidade o uniforme". O Recrutamento informa a data
// ao enviar para SST + Compras (obrigatória) e ela aparece no kanban, no
// ASO — Candidatos (SST), no EPIs — Admissões (Compras) e no pedido de
// materiais.
// =====================================================================

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "2026-11-03" → Date ao meio-dia local (sem escorregar de dia por fuso). */
const paraData = (iso: string | null | undefined): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
};
const meioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
const p2 = (n: number) => String(n).padStart(2, "0");

/** yyyy-mm-dd de hoje (valor mínimo do campo). */
export const hojeIso = (hoje: Date = new Date()) => `${hoje.getFullYear()}-${p2(hoje.getMonth() + 1)}-${p2(hoje.getDate())}`;

/** Erro do campo, ou null se dá para enviar. Data no passado não vale. */
export function erroDataInicio(iso: string | null | undefined, hoje: Date = new Date()): string | null {
  const d = paraData(iso);
  if (!d) return "Informe a data em que o colaborador começa a trabalhar.";
  if (d.getTime() < meioDia(hoje).getTime()) return "A data de início não pode ser no passado.";
  return null;
}

/** Sugestão ao abrir o envio: a prevista da vaga, se ainda não passou. */
export function sugestaoDataInicio(previstaVaga: string | null | undefined, hoje: Date = new Date()): string {
  return previstaVaga && !erroDataInicio(previstaVaga, hoje) ? String(previstaVaga).slice(0, 10) : "";
}

export type TomInicio = "passou" | "proximo" | "normal";

export interface InicioTrabalho {
  /** "03/11/2026 (ter)" */
  data: string;
  /** "03/11 (ter)" — para o card do kanban. */
  curta: string;
  /** "faltam 6 dias" / "amanhã" / "hoje" / "começou há 2 dias" */
  prazo: string;
  dias: number;
  /** passou = já devia estar trabalhando; proximo = até 3 dias. */
  tom: TomInicio;
}

export function inicioTrabalho(iso: string | null | undefined, hoje: Date = new Date()): InicioTrabalho | null {
  const d = paraData(iso);
  if (!d) return null;
  const dias = Math.round((d.getTime() - meioDia(hoje).getTime()) / 86_400_000);
  const ds = DIAS[d.getDay()];
  const prazo = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : dias > 1 ? `faltam ${dias} dias`
    : dias === -1 ? "começou ontem" : `começou há ${-dias} dias`;
  return {
    data: `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} (${ds})`,
    curta: `${p2(d.getDate())}/${p2(d.getMonth() + 1)} (${ds})`,
    prazo, dias,
    tom: dias < 0 ? "passou" : dias <= 3 ? "proximo" : "normal",
  };
}

/** Linha que vai na observação do pedido de materiais. */
export const linhaInicioPedido = (iso: string) => {
  const i = inicioTrabalho(iso);
  return i ? `Início no posto: ${i.data}` : "";
};

export const COR_INICIO: Record<TomInicio, { cor: string; fundo: string; borda: string }> = {
  passou: { cor: "#b91c1c", fundo: "#fef2f2", borda: "#fecaca" },
  proximo: { cor: "#b45309", fundo: "#fffbeb", borda: "#fde68a" },
  normal: { cor: "#0f3171", fundo: "#eff6ff", borda: "#bfdbfe" },
};
