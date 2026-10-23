// =====================================================================
// RH › Gestão de Férias — filtro de período (23/10/2026, pedido do Pablo:
// filtrar por mês e por data de/até).
//
//   · "ferias": o período de gozo CRUZA o intervalo — saída ou retorno caindo
//     dentro dele, ou as férias cobrindo-o inteiro. Quem sai em 20/01 e volta
//     em 19/02 aparece tanto em janeiro quanto em fevereiro.
//   · "criado": a data em que a solicitação entrou no sistema.
//
// Venda de dias (tipo "venda") não tem saída/retorno: no modo "ferias" ela sai
// da lista enquanto houver período escolhido; no modo "criado" entra normal.
// =====================================================================

export type BasePeriodo = "ferias" | "criado";

export interface LinhaPeriodo {
  data_saida?: string | null;
  data_retorno?: string | null;
  criado_em?: string | null;
}

/** "AAAA-MM-DD" no fuso local — `criado_em` é timestamptz; saída/retorno já são date. */
export function diaLocal(s?: string | null): string {
  if (!s) return "";
  if (s.length <= 10) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("sv-SE");
}

/** "2026-02" → "2026-02-28" (ano bissexto incluso). */
export function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
}

/** `de`/`ate` em "AAAA-MM-DD"; vazio = sem limite daquele lado. */
export function passaNoPeriodo(r: LinhaPeriodo, base: BasePeriodo, de: string, ate: string): boolean {
  if (!de && !ate) return true;
  if (base === "criado") {
    const c = diaLocal(r.criado_em);
    return !!c && (!de || c >= de) && (!ate || c <= ate);
  }
  const ini = diaLocal(r.data_saida);
  if (!ini) return false;
  const fim = diaLocal(r.data_retorno) || ini;
  return (!ate || ini <= ate) && (!de || fim >= de);
}
