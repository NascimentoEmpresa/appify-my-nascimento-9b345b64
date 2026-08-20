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
