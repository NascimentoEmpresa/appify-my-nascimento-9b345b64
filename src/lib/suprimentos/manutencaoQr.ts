export const STATUS_MANUTENCAO = {
  aberta: "Aguardando Almoxarifado",
  peca_disponivel: "Peça disponível",
  compra_solicitada: "Compra interna solicitada",
  aguardando_orcamento: "Aguardando orçamento",
  aguardando_autorizacao: "Aguardando autorização",
  manutencao_autorizada: "Manutenção autorizada",
  manutencao_reprovada: "Orçamento não autorizado",
  em_execucao: "Conserto em execução",
  pronta_retirada: "Pronta para retirada",
  encerrada: "Encerrada",
} as const;

export type StatusManutencao = keyof typeof STATUS_MANUTENCAO;

export function manutencaoEmAberto(status: StatusManutencao) {
  return status !== "encerrada" && !["peca_disponivel", "compra_solicitada"].includes(status);
}

export function acaoPublicaManutencao(status: StatusManutencao): "orcamento" | "iniciar" | "concluir" | null {
  if (status === "aguardando_orcamento" || status === "manutencao_reprovada") return "orcamento";
  if (status === "manutencao_autorizada") return "iniciar";
  if (status === "em_execucao") return "concluir";
  return null;
}

export function urlPublicaManutencao(token: string, origem = window.location.origin) {
  return `${origem}/manutencao/equipamento/${token}`;
}
