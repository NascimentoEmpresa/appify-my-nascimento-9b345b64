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

// Texto EXATO do selo e da linha de status quando a madrugada conclui o
// chamado sem retorno (18/11/2026, Pablo, no SIS-2026-0771). O mesmo texto
// vai na conversa e no sino (mig 20261119030000). Não é entrega: nada para o
// Gestor de Sistemas concluir/finalizar nem para o solicitante confirmar.
export const ROTULO_CONCLUIDO_SEM_RETORNO = "Concluído automaticamente por falta de retorno";

/** Concluído pela rotina de falta de retorno? (coluna não lida = false). */
export const concluidoSemRetorno = (c: { status: string; concluido_sem_retorno?: boolean | null }) =>
  c.status === "concluido" && c.concluido_sem_retorno === true;
