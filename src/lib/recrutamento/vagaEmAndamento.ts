// "Vaga em andamento" — UMA régua para a Gestão Recrutamento e a TV (22/10/2026).
//
// Pablo: a TV RH (Recrutamento e Seleção) mostrava 91 "em aberto agora" e a
// Gestão Recrutamento 42 "em processo", as duas olhando a mesma tabela
// (SISTEMA_RECRUTAMENTO). A TV contava tudo que não fechou, inclusive o que
// ainda espera aprovação; a Gestão contava só as etapas do candidato e, para
// quem vê o atalho "Pendente Seleção", tirava essas também. Regra pedida,
// valendo para as duas: em andamento = TODAS as solicitações, menos as que
// estão pendentes do Operacional (etapa 1 — inclusive a Diretoria, que é a
// etapa 1 da vaga administrativa) e do RH (Pendente Recrutamento: o
// Recrutamento ainda não conferiu/abriu), as concluídas e as
// reprovadas/canceladas. Status desconhecido ou legado ENTRA (está no meio do
// caminho até alguém fechar).
//
// A função da TV (tvg_espelho_vagas, mig 20261022000510) repete esta lista —
// mudou aqui, muda lá.

/** Pendentes de aprovação (Operacional/Analista/Diretoria) e do RH (conferência do Recrutamento). */
export const STATUS_VAGA_PENDENTE_APROVACAO = [
  "Pendente Analista", // na tela: "Pendente Operacional"
  "Pendente Operacional", // legado, antes da mig 287
  "Pendente Diretoria",
  "Pendente Recrutamento",
] as const;

/** Fechadas: reprovada/cancelada (Contratado e Concluído… vão por vagaConcluida). */
export const STATUS_VAGA_ENCERRADA_SEM_CONTRATO = ["Reprovada", "Cancelada"] as const;

export const vagaConcluida = (status: string | null | undefined): boolean => {
  const s = String(status ?? "").trim();
  return s === "Contratado" || s.startsWith("Concluído");
};

/** A vaga está em andamento? (mesma régua da TV) */
export function vagaEmAndamento(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim();
  if (vagaConcluida(s)) return false;
  if ((STATUS_VAGA_ENCERRADA_SEM_CONTRATO as readonly string[]).includes(s)) return false;
  if ((STATUS_VAGA_PENDENTE_APROVACAO as readonly string[]).includes(s)) return false;
  return true;
}

/** Status que ficam FORA da conta — para o filtro do PostgREST (not in + not like Concluído%). */
export const STATUS_FORA_DO_ANDAMENTO: readonly string[] = [
  ...STATUS_VAGA_PENDENTE_APROVACAO, ...STATUS_VAGA_ENCERRADA_SEM_CONTRATO, "Contratado",
];

/** Filtro equivalente a vagaEmAndamento num builder do PostgREST. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do PostgREST; o tipo exato muda a cada .select()
export function filtrarEmAndamento<Q extends { not: (...a: any[]) => Q }>(q: Q): Q {
  const lista = STATUS_FORA_DO_ANDAMENTO.map((s) => `"${s}"`).join(",");
  return q.not("status", "in", `(${lista})`).not("status", "like", "Concluído%");
}
