import type { ComprovanteEpiImpressao, ItemEntregaEpi } from "@/lib/suprimentos/entregaEpi";

export interface FichaDigitalPedido {
  id: string;
  pedido_id: string;
  protocolo: string;
  colaborador_nome: string;
  matricula: string | null;
  empresa_nome: string | null;
  contrato_nome: string;
  posto_nome: string;
  funcao_nome: string;
  entregador_nome: string;
  itens: ItemEntregaEpi[];
  registrado_em: string;
  confirmado_em: string | null;
  confirmacao_hash: string | null;
  declaracao_versao: number;
}

export function comprovanteDaFichaDigital(ficha: FichaDigitalPedido): ComprovanteEpiImpressao {
  return {
    protocolo: ficha.protocolo,
    colaborador: ficha.colaborador_nome,
    matricula: ficha.matricula,
    empresa: ficha.empresa_nome,
    contrato: ficha.contrato_nome,
    posto: ficha.posto_nome,
    responsavel: ficha.entregador_nome,
    itens: ficha.itens,
    confirmadoEm: ficha.confirmado_em,
    hash: ficha.confirmacao_hash,
  };
}

export type LinhaHistoricoComFicha<TEvento> =
  | { tipo: "pedido"; id: string; data: string; evento: TEvento }
  | { tipo: "ficha_epi"; id: string; data: string; ficha: FichaDigitalPedido };

/** Usa o registro imutável da confirmação; fichas pendentes ainda não são prova de recebimento. */
export function historicoComFichasConfirmadas<TEvento extends { id: string; data_alteracao: string }>(
  eventos: TEvento[],
  fichas: FichaDigitalPedido[],
): LinhaHistoricoComFicha<TEvento>[] {
  return [
    ...eventos.map((evento) => ({
      tipo: "pedido" as const, id: evento.id, data: evento.data_alteracao, evento,
    })),
    ...fichas.flatMap((ficha) => ficha.confirmado_em ? [{
      tipo: "ficha_epi" as const, id: ficha.id, data: ficha.confirmado_em, ficha,
    }] : []),
  ].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime() || a.id.localeCompare(b.id));
}
