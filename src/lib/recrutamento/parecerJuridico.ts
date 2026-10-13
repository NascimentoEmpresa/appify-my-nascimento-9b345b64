// =====================================================================
// Recrutamento › kanban — o PARECER do Jurídico (14/10/2026, mig 20261014000004).
// Com teste em src/test/recrutamento-parecer-juridico.test.ts.
//
// Pedido do Pablo: "na etapa do jurídico, o jurídico não vai mais aprovar ou
// reprovar, ele só vai colocar observações no candidato, podendo descrever o
// nível da observação, escrever e selecionar status como: Tudo certo, Alguns
// processos mas OK, Alto risco, Muito processo… Pode só dar um OK e passar."
// O parecer passa o candidato para a Entrevista; quem decide é o Recrutamento.
// =====================================================================

export type NivelJuridico = "tudo_certo" | "alguns_processos_ok" | "muitos_processos" | "alto_risco";

export const NIVEIS_JURIDICO: { valor: NivelJuridico; rotulo: string; dica: string; cor: string; fundo: string; borda: string }[] = [
  { valor: "tudo_certo", rotulo: "Tudo certo", dica: "Nada que pese contra o candidato", cor: "#15803d", fundo: "#f0fdf4", borda: "#bbf7d0" },
  { valor: "alguns_processos_ok", rotulo: "Alguns processos, mas OK", dica: "Tem processos, mas nada que impeça", cor: "#a16207", fundo: "#fefce8", borda: "#fde68a" },
  { valor: "muitos_processos", rotulo: "Muitos processos", dica: "Histórico pesado — o Recrutamento avalia com atenção", cor: "#c2410c", fundo: "#fff7ed", borda: "#fed7aa" },
  { valor: "alto_risco", rotulo: "Alto risco", dica: "Risco jurídico alto para a empresa", cor: "#b91c1c", fundo: "#fef2f2", borda: "#fecaca" },
];

export const nivelJuridico = (v: string | null | undefined) => NIVEIS_JURIDICO.find((n) => n.valor === v) ?? null;

/** O "OK e passar" do Jurídico: tudo certo, sem observação. */
export const NIVEL_OK: NivelJuridico = "tudo_certo";

/** Evento do histórico quando o Jurídico dá o parecer. */
export const eventoParecerJuridico = (nivel: string | null | undefined) =>
  `Parecer do Jurídico: ${nivelJuridico(nivel)?.rotulo ?? "OK"} → Entrevista`;

/** Selo do card: o nível do parecer; parecer antigo (antes do nível) aparece como "Jurídico OK". */
export function seloJuridico(c: { juridico_nivel?: string | null; juridico_ok?: boolean | null }): { texto: string; cor: string; fundo: string; borda: string } | null {
  const n = nivelJuridico(c.juridico_nivel);
  if (n) return { texto: `Jurídico: ${n.rotulo}`, cor: n.cor, fundo: n.fundo, borda: n.borda };
  if (c.juridico_ok === true) return { texto: "Jurídico: OK", cor: "#15803d", fundo: "#f0fdf4", borda: "#bbf7d0" };
  if (c.juridico_ok === false) return { texto: "Restrição do Jurídico", cor: "#b91c1c", fundo: "#fef2f2", borda: "#fecaca" };
  return null;
}
