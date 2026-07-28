import { supabase } from "@/integrations/supabase/client";

/** Grava uma entrada no histórico da NF. Silencioso em erro — nunca deve travar a ação principal que já aconteceu. */
export async function registrarLogNf(nfEmissaoId: string, acao: string, detalhe: string) {
  try {
    await (supabase as any).from("nf_emissao_historico").insert({ nf_emissao_id: nfEmissaoId, acao, detalhe });
  } catch {
    // best-effort
  }
}
