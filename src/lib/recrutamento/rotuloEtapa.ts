// =====================================================================
// Rótulo EXIBIDO de cada etapa do kanban de candidatos (21/10/2026)
//
// Pedido do Pablo: "APROVADO" passa a se chamar "EM ADMISSÃO" e "ADMISSÃO"
// vira "ADMISSÃO CONCLUÍDA". Só o nome na tela muda — o valor gravado em
// WA_CURRICULOS.etapa_processo continua 'APROVADO' / 'ADMISSÃO' (gatilhos,
// sr_sync_status_solicitacao, SISTEMA_RECRUTAMENTO_ETAPA e as mensagens
// automáticas comparam por ele). Todo lugar que MOSTRA a etapa passa por
// aqui, para o nome mudar num lugar só.
// =====================================================================

const ROTULO_ETAPA_CANDIDATO: Record<string, string> = {
  APROVADO: "EM ADMISSÃO",
  "ADMISSÃO": "ADMISSÃO CONCLUÍDA",
  Reprovado: "Reprovado / Desistência",
};

/** Nome da etapa para exibir (coluna, filtro, relatório, exportação). */
export const rotuloEtapaCandidato = (etapa: string | null | undefined): string => {
  const e = String(etapa ?? "");
  return ROTULO_ETAPA_CANDIDATO[e] ?? e;
};
