import { supabase } from "@/integrations/supabase/client";

/** Grava uma entrada no histórico da NF. Silencioso em erro — nunca deve travar a ação principal que já aconteceu.
 *
 * `dados` (opcional, jsonb — migration 20261006000003) guarda o detalhe estruturado que a tela de Histórico
 * monta em tabela. Se a coluna ainda não existe no banco, regrava só com o texto (`detalhe`) em vez de
 * perder a entrada. */
export async function registrarLogNf(nfEmissaoId: string, acao: string, detalhe: string, dados?: unknown) {
  try {
    const base = { nf_emissao_id: nfEmissaoId, acao, detalhe };
    if (dados === undefined) {
      await (supabase as any).from("nf_emissao_historico").insert(base);
      return;
    }
    const { error } = await (supabase as any).from("nf_emissao_historico").insert({ ...base, dados });
    if (error) await (supabase as any).from("nf_emissao_historico").insert(base);
  } catch {
    // best-effort
  }
}
