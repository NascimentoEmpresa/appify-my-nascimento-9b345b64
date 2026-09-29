export interface PedidoSelecionavelRomaneio {
  id: string;
  contrato_id: string | null;
  status: string;
  romaneio_id: string | null;
  /** Vem do embed da fila. Ausente = trata como aberto (o lado seguro). */
  sup_romaneio?: { status: string } | null;
}

/**
 * Só romaneio ABERTO prende o pedido. Um pedido que saiu num romaneio já
 * RETIRADO e voltou para Aguardando envio continua apontando para ele, mas
 * precisa poder entrar num romaneio novo — mesma regra de sup_romaneio_criar.
 */
export function pedidoEmRomaneioAberto(pedido: Pick<PedidoSelecionavelRomaneio, "romaneio_id" | "sup_romaneio">) {
  if (!pedido.romaneio_id) return false;
  return (pedido.sup_romaneio?.status ?? "ABERTO") === "ABERTO";
}

/** Volumes é opcional; se informado, só inteiro positivo (a coluna é integer). */
export function volumesValidos(texto: string) {
  if (!texto.trim()) return true;
  const n = Number(texto);
  return Number.isInteger(n) && n > 0;
}

export interface ValidacaoSelecaoRomaneio {
  valida: boolean;
  motivo: string | null;
}

export type RespostaDocumentosRomaneio = "" | "TODOS" | "NENHUM" | "ALGUNS";

export interface PedidoConferenciaRomaneio {
  id: string;
}

export interface PedidoRetiradaPayload {
  pedido_id: string;
  retirado: boolean;
  ficha_epi_fisica: boolean;
  cracha_fisico: boolean;
}

/**
 * A mesma guarda existe no banco, mas a validação pura dá retorno imediato
 * ao operador antes de ele abrir o modal ou fazer uma chamada que será
 * recusada pela RPC.
 */
export function validarSelecaoRomaneio(
  pedidos: PedidoSelecionavelRomaneio[],
): ValidacaoSelecaoRomaneio {
  if (pedidos.length === 0) {
    return { valida: false, motivo: "Selecione pelo menos um pedido." };
  }
  if (pedidos.some((pedido) => pedido.status !== "AGUARDANDO ENVIO")) {
    return { valida: false, motivo: "Selecione somente pedidos em Aguardando envio." };
  }
  if (pedidos.some(pedidoEmRomaneioAberto)) {
    return { valida: false, motivo: "Um dos pedidos já pertence a um romaneio." };
  }

  const contratos = new Set(pedidos.map((pedido) => pedido.contrato_id).filter(Boolean));
  if (contratos.size !== 1 || pedidos.some((pedido) => !pedido.contrato_id)) {
    return { valida: false, motivo: "O romaneio só pode reunir pedidos do mesmo contrato." };
  }

  return { valida: true, motivo: null };
}

export function respostasRomaneioCompletas(
  fichaEpi: RespostaDocumentosRomaneio,
  cracha: RespostaDocumentosRomaneio,
) {
  return fichaEpi !== "" && cracha !== "";
}

function respostaDoPedido(
  resposta: Exclude<RespostaDocumentosRomaneio, "">,
  pedidoId: string,
  marcados: ReadonlySet<string>,
) {
  if (resposta === "TODOS") return true;
  if (resposta === "NENHUM") return false;
  return marcados.has(pedidoId);
}

/**
 * Monta exatamente o contrato JSON da RPC. Pedidos desmarcados seguem no
 * payload para o banco soltá-los do romaneio de forma explícita e auditável.
 */
export function montarPedidosRetiradaRomaneio(
  pedidos: PedidoConferenciaRomaneio[],
  retirados: ReadonlySet<string>,
  fichaEpi: Exclude<RespostaDocumentosRomaneio, "">,
  fichaEpiAlguns: ReadonlySet<string>,
  cracha: Exclude<RespostaDocumentosRomaneio, "">,
  crachaAlguns: ReadonlySet<string>,
): PedidoRetiradaPayload[] {
  return pedidos.map((pedido) => ({
    pedido_id: pedido.id,
    retirado: retirados.has(pedido.id),
    ficha_epi_fisica: respostaDoPedido(fichaEpi, pedido.id, fichaEpiAlguns),
    cracha_fisico: respostaDoPedido(cracha, pedido.id, crachaAlguns),
  }));
}
