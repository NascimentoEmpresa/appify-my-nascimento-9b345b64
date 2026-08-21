import { supabase } from "@/integrations/supabase/client";

/**
 * Vínculo entre a conta do Patrimônio e a despesa do Malote.
 *
 * "Pagar" no Patrimônio não paga nada: abre a despesa no Malote, que é por
 * onde o dinheiro sai. O que faltava era a volta — a conta ficava "Pendente"
 * para sempre, mesmo com a despesa criada e paga do outro lado.
 *
 * Mora aqui, e não na tela do Malote, para o módulo do Malote não precisar
 * conhecer as tabelas do Jurídico: lá é uma linha de import e uma chamada.
 *
 * O "pago" NÃO é gravado por aqui de propósito. Quem sabe se o dinheiro saiu
 * é o Malote; o Patrimônio lê o status da despesa na hora de desenhar o selo
 * (RPC `jur_patrimonio_status_malote`). Estado duplicado nas duas tabelas é
 * estado que uma hora diverge.
 */
export const PARAM_ORIGEM = "origem_obrigacao";

export interface ResultadoVinculo { ok: boolean; erro?: string }

export async function vincularContaAoMalote(
  obrigacaoId: string | number | null | undefined,
  despesaId: string,
): Promise<ResultadoVinculo> {
  const id = Number(obrigacaoId);
  if (!obrigacaoId || !Number.isFinite(id) || !despesaId) return { ok: false };
  const { error } = await (supabase as any)
    .from("JUR_PATRIMONIO_OBRIGACOES")
    .update({ malote_despesa_id: despesaId, enviado_malote_em: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** A despesa do Malote quitou? É isto que vira "Pago" na conta do Patrimônio. */
export const despesaEstaPaga = (d?: { status?: string | null; pago_em?: string | null } | null): boolean =>
  !!d && (d.status === "despesa_paga" || !!d.pago_em);

// =====================================================================
// O selo da conta, e o que ela ainda aceita fazer.
//
// Mora aqui, junto do vínculo, porque é derivado dele: o que decide o selo
// é justamente a existência (e o pagamento) da despesa do Malote. E porque
// a MESMA regra é desenhada em três lugares da tela de Patrimônios — foi
// tendo três cópias que ela divergiu, e uma delas passou meses oferecendo
// "Enviar ao Malote" para conta que já estava lá.
// =====================================================================

export type StatusConta = "Pago" | "Enviado ao Malote" | "Vencido" | "Pendente";

/** Só o que o selo precisa saber da conta. */
export interface ContaParaSelo {
  status?: string | null;
  vencimento?: string | null;
  malote_despesa_id?: string | null;
}

/**
 * Status efetivo da conta.
 *
 * "Pago" NÃO é digitado no Patrimônio quando a conta foi pelo Malote: quem
 * sabe se o dinheiro saiu é o Malote, e `malotePaga` chega de lá.
 *
 * A ordem importa: uma conta já paga não deve voltar a "Vencido" só porque
 * a data passou, e uma conta que está no Malote não é "Pendente" — está
 * andando.
 */
export function statusDaConta(
  o: ContaParaSelo,
  malotePaga?: (id?: string | null) => boolean,
  hoje: string = new Date().toISOString().slice(0, 10),
): StatusConta {
  if (o.status === "Pago") return "Pago";                       // baixa manual, com comprovante
  if (o.malote_despesa_id) return malotePaga?.(o.malote_despesa_id) ? "Pago" : "Enviado ao Malote";
  if (o.vencimento && o.vencimento < hoje) return "Vencido";
  return "Pendente";
}

export const corDaConta = (st: StatusConta): string =>
  st === "Pago" ? "#16a34a" : st === "Enviado ao Malote" ? "#2563eb" : st === "Vencido" ? "#dc2626" : "#ea580c";

/**
 * A conta ainda pode ser enviada ao Malote?
 *
 * Não, se já foi: enviar de novo cria uma SEGUNDA despesa para o mesmo
 * boleto, e o financeiro paga duas vezes. Não, se já está paga.
 */
export const podeEnviarAoMalote = (st: StatusConta) => st !== "Pago" && st !== "Enviado ao Malote";

/**
 * A baixa manual ("já paguei por fora") ainda faz sentido?
 *
 * Mesma resposta, e pelo mesmo motivo do avesso: dar baixa no Patrimônio
 * numa conta que está no Malote cria duas verdades sobre o mesmo pagamento —
 * e o Patrimônio não é quem sabe se o dinheiro saiu.
 */
export const podeBaixarManualmente = (st: StatusConta) => podeEnviarAoMalote(st);
