// Chamado sem retorno do solicitante (14/11/2026, mig 20261114130000).
//
// "Solicitar mais informações" dá ao solicitante até o fim do 3º DIA ÚTIL
// para responder (o banco calcula, com feriados: aguardando_retorno_ate).
// Passou disso, a madrugada conclui o chamado por falta de retorno
// (concluido_sem_retorno = true). Aqui só o texto do prazo para as telas.

const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "sexta, 20/11" — no fuso de Brasília. null se a data não vier (migration ainda não no banco). */
export function prazoRetornoTexto(ate: string | null | undefined): string | null {
  if (!ate) return null;
  const d = new Date(ate);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit",
  }).formatToParts(d);
  const dia = partes.find((p) => p.type === "day")?.value ?? "";
  const mes = partes.find((p) => p.type === "month")?.value ?? "";
  const semana = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d) + "T12:00:00Z").getUTCDay();
  return `${DIAS[semana]}, ${dia}/${mes}`;
}
