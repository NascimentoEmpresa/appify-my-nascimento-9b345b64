import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DevGithub, PrGithub, SemanaCommits } from "@/lib/sistemas/githubPainel";

// =====================================================================
// Painel do Desenvolvedor › GitHub (mig 20261007000015). Lê do banco (abre na
// hora); a Edge github-painel-sync atualiza a partir do GitHub (no máximo a
// cada 15 min, ou na hora com "forcar").
// =====================================================================

// Tabelas novas ainda não estão nos tipos gerados.
const sb = supabase as any;
const K = "github-painel";

export interface SyncGithub { id: string; sincronizado_em: string | null; info: Record<string, unknown> | null }

export const useGithubDados = () => useQuery({
  queryKey: [K, "dados"],
  staleTime: 5 * 60_000, gcTime: 30 * 60_000,
  queryFn: async () => {
    // PRs paginadas: o PostgREST corta em 1.000 linhas por resposta.
    const prs: PrGithub[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from("GITHUB_PR")
        .select("numero, titulo, estado, autor, branch, criado_em, mergeado_em, fechado_em, adicoes, remocoes, arquivos, commits")
        .order("numero", { ascending: false }).range(de, de + 999);
      if (error) throw error;
      prs.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const [sem, sync, devs] = await Promise.all([
      sb.from("GITHUB_COMMITS_SEMANA").select("autor, semana, commits, adicoes, remocoes").order("semana").then((r: any) => r),
      sb.from("GITHUB_SYNC").select("*").then((r: any) => r),
      sb.from("GITHUB_DEV").select("login, nome, ativo").order("nome").then((r: any) => r),
    ]);
    for (const r of [sem, sync, devs]) if (r.error) throw r.error;
    return {
      prs, semanas: (sem.data ?? []) as SemanaCommits[], sync: (sync.data ?? []) as SyncGithub[], devs: (devs.data ?? []) as DevGithub[],
    };
  },
});

export function useSincronizarGithub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (forcar: boolean) => {
      const { data, error } = await supabase.functions.invoke("github-painel-sync", { body: { forcar } });
      if (error) {
        let msg = error.message;
        try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) msg = corpo.error; } catch { /* sem corpo */ }
        throw new Error(msg);
      }
      return data as Record<string, string>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}

export function useSalvarNomeDev() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { login: string; nome: string }) => {
      const { error } = await sb.from("GITHUB_DEV").update({ nome: p.nome }).eq("login", p.login);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
}
