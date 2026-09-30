/**
 * QR code da etiqueta térmica do pedido → comprovação de entrega.
 *
 * Até 30/09/2026 o QR da etiqueta abria a RETIRADA (o supervisor lia ao
 * levar o volume). Com os romaneios, a retirada passou a ser lida uma vez só,
 * no QR do romaneio, para vários pedidos de uma vez — e o QR de cada etiqueta
 * ficou livre para a outra ponta: quem RECEBE o pedido no destino lê o código
 * e cai direto no formulário de comprovação (nome de quem recebeu + fotos).
 *
 * O formulário é o mesmo de "Meus Pedidos" (ModalComprovacaoEntrega), com as
 * mesmas regras no banco (sup_ext_comprovacao_enviar): só o solicitante do
 * pedido envia, e só depois do despacho. O QR é só um atalho até ele.
 *
 * Etiquetas impressas antes da mudança continuam abrindo a retirada — a rota
 * /app/suprimentos/retirada/:ref não mudou.
 */

import type { StatusComprovacao } from "@/hooks/useSupPedidos";

/** Nome do parâmetro de "Meus Pedidos" que o QR preenche com o uuid do pedido. */
export const PARAM_COMPROVAR = "comprovar";

/**
 * Endereço que o QR da etiqueta abre. Leva o id (uuid) do pedido, e não o
 * protocolo, pelo mesmo motivo da retirada: é inequívoco e não depende do
 * formato do protocolo, que mudou entre o legado e o sistema novo.
 */
export function urlComprovacao(pedidoUuid: string, origem: string) {
  return `${origem}/app/encarregados/meus-pedidos?${PARAM_COMPROVAR}=${encodeURIComponent(pedidoUuid)}`;
}

export type SituacaoComprovacaoQr =
  | "PREENCHER"
  | "JA_ENVIADA"
  | "AGUARDANDO_DESPACHO"
  | "DISPENSADA"
  | "NAO_ENCONTRADO";

/**
 * O que a tela faz com o pedido lido no QR. Espelha as recusas da RPC de
 * envio, para a pessoa ler o motivo ANTES de tirar as fotos — e não depois,
 * num toast de erro.
 *
 * NAO_ENCONTRADO cobre o pedido que não é de quem está logado: a lista de
 * "Meus Pedidos" só traz os pedidos do próprio solicitante.
 */
export function situacaoComprovacaoQr(
  pedido: { status: string; comprovacao_status: StatusComprovacao } | undefined,
): SituacaoComprovacaoQr {
  if (!pedido) return "NAO_ENCONTRADO";
  if (pedido.comprovacao_status === "ENVIADO") return "JA_ENVIADA";
  if (pedido.comprovacao_status === "DISPENSADO") return "DISPENSADA";
  if (pedido.status === "DESPACHADO" && pedido.comprovacao_status === "PENDENTE") return "PREENCHER";
  return "AGUARDANDO_DESPACHO";
}
