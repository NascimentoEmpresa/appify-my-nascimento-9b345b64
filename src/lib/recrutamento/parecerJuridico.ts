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

// Etapas que vêm DEPOIS do Jurídico: ali o card sempre diz o que houve com ele.
const DEPOIS_DO_JURIDICO = ["ENTREVISTA", "ENTREVISTA GESTOR", "APROVADO", "DOCUMENTAÇÃO", "SST + COMPRAS", "EXAME SST", "ADMISSÃO"];

/**
 * Linha fixa "Jurídico" do card (16/10/2026). Pablo: "pode ficar sempre o
 * status ali, pra mostrar se foi pulada essa etapa ou se foi respondida pelo
 * jurídico mesmo". Antes de chegar ao Jurídico não aparece; na coluna do
 * Jurídico é "aguardando parecer"; depois, o parecer, o "pulado" ou — cadastro
 * antigo, de antes de registrar o pulo — "sem parecer registrado".
 * Em Reprovado só aparece se houve parecer/pulo (ele pode ter saído antes).
 */
export function statusJuridicoCard(
  c: { juridico_nivel?: string | null; juridico_ok?: boolean | null; juridico_pulado?: boolean | null },
  etapa: string,
): { texto: string; cor: string; fundo: string; borda: string } | null {
  const selo = seloJuridico(c);
  if (etapa === "JURÍDICO") return selo ?? { texto: "Jurídico: aguardando parecer", cor: "#6d28d9", fundo: "#faf5ff", borda: "#ddd6fe" };
  if (DEPOIS_DO_JURIDICO.includes(etapa)) return selo ?? { texto: "Jurídico: sem parecer registrado", cor: "#64748b", fundo: "#f8fafc", borda: "#e2e8f0" };
  return etapa === "Reprovado" ? selo : null;
}

/** Selo do card: o nível do parecer; parecer antigo (antes do nível) aparece como "Jurídico OK". */
export function seloJuridico(c: { juridico_nivel?: string | null; juridico_ok?: boolean | null; juridico_pulado?: boolean | null }): { texto: string; cor: string; fundo: string; borda: string } | null {
  const n = nivelJuridico(c.juridico_nivel);
  if (n) return { texto: `Jurídico: ${n.rotulo}`, cor: n.cor, fundo: n.fundo, borda: n.borda };
  // 14/10/2026 (mig 20261014000016): seguiu sem o parecer do Jurídico — pulado
  // na Triagem ou retirado da coluna pelo Recrutamento. Antes saía "OK".
  if (c.juridico_pulado) return { texto: "Jurídico pulado", cor: "#92400e", fundo: "#fffbeb", borda: "#fde68a" };
  if (c.juridico_ok === true) return { texto: "Jurídico: OK", cor: "#15803d", fundo: "#f0fdf4", borda: "#bbf7d0" };
  if (c.juridico_ok === false) return { texto: "Restrição do Jurídico", cor: "#b91c1c", fundo: "#fef2f2", borda: "#fecaca" };
  return null;
}
