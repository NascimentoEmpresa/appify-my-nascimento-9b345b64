import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizarPainel, type PainelGithub, type PainelGithubBruto } from "@/lib/sistemas/githubPainel";

// =====================================================================
// Painel do Desenvolvedor › GitHub (mig 20261007000022 + Edge dev-github-sync).
// A leitura vem do cache no banco (RPC dev_github_painel); "Sincronizar"
// chama a Edge em lotes até não sobrar PR pendente de detalhe.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = ["dev-github-painel"];

export const useGithubPainel = () => useQuery({
  queryKey: K, staleTime: 5 * 60_000,
  queryFn: async (): Promise<PainelGithub> => {
    const { data, error } = await sb.rpc("dev_github_painel");
    if (error) throw error;
    return normalizarPainel(data as PainelGithubBruto);
  },
});

export interface ProgressoSync { lote: number; detalhadas: number; pendentes: number }

async function chamarSync(): Promise<{ novas: number; detalhadas: number; pendentes: number }> {
  const { data, error } = await supabase.functions.invoke("dev-github-sync", { body: {} });
  if (error) {
    let msg = error.message;
    try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) msg = corpo.error; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Sincroniza até zerar (ou até `maxLotes`, para não prender a tela). */
export function useSincronizarGithub(onProgresso?: (p: ProgressoSync) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (maxLotes: number = 60) => {
      let detalhadas = 0, pendentes = 0, novas = 0;
      for (let lote = 1; lote <= maxLotes; lote++) {
        const r = await chamarSync();
        if (lote === 1) novas = r.novas;
        detalhadas += r.detalhadas; pendentes = r.pendentes;
        onProgresso?.({ lote, detalhadas, pendentes });
        if (lote % 3 === 0) qc.invalidateQueries({ queryKey: K });   // mostra chegando
        if (!pendentes || !r.detalhadas) break;
      }
      return { novas, detalhadas, pendentes };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: K }),
  });
}
