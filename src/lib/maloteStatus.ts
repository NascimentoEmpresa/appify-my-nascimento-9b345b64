export type StatusDespesa =
  | "rascunho"
  | "aguardando_aprovacao_inicial"
  | "aguardando_cotacao"
  | "cotacao_realizada"
  | "cotacao_aprovada"
  | "solicitacao_reprovada"
  | "pendente_aprovacao"
  | "necessidade_de_ajuste"
  | "aguardando_pagamento"
  | "pronto_para_pagar"
  | "ajuste_pagamento"
  | "despesa_paga"
  | "despesa_reprovada"
  | "cancelada";

export const STATUS_LABEL: Record<StatusDespesa, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao_inicial: "Aguardando aprovação inicial",
  aguardando_cotacao: "Aguardando cotação",
  cotacao_realizada: "Cotação realizada",
  cotacao_aprovada: "Cotação aprovada",
  solicitacao_reprovada: "Solicitação reprovada",
  pendente_aprovacao: "Pendente aprovação",
  necessidade_de_ajuste: "Necessita de ajuste",
  aguardando_pagamento: "Aguardando pagamento",
  pronto_para_pagar: "Pronto para pagar (conferido)",
  ajuste_pagamento: "Necessita de ajuste (pagamento)",
  despesa_paga: "Despesa paga",
  despesa_reprovada: "Despesa reprovada",
  cancelada: "Cancelada",
};

export const STATUS_BADGE_CLASS: Record<StatusDespesa, string> = {
  rascunho: "bg-muted text-muted-foreground",
  aguardando_aprovacao_inicial: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  aguardando_cotacao: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  cotacao_realizada: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  cotacao_aprovada: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  solicitacao_reprovada: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  pendente_aprovacao: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  necessidade_de_ajuste: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  aguardando_pagamento: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  pronto_para_pagar: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  ajuste_pagamento: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  despesa_paga: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  despesa_reprovada: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  cancelada: "bg-muted text-muted-foreground",
};
