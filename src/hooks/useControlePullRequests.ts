import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ControlePrBruto, PrControle } from "@/lib/sistemas/controlePullRequests";

// =====================================================================
// SIS-2026-0786 — Controle de Pull Requests (mig 20261029004900).
// Uma chamada só (RPC dev_github_controle_pr): já passam de 1.000 PRs e o
// PostgREST corta select nesse número. Quem preenche é o workflow
// pr_registrar_painel.yml no merge — a tela só lê.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export const useControlePullRequests = () => useQuery({
  queryKey: ["dev-github-controle-pr"], staleTime: 60_000,
  queryFn: async (): Promise<PrControle[]> => {
    const { data, error } = await sb.rpc("dev_github_controle_pr");
    if (error) throw error;
    return (data as ControlePrBruto)?.prs ?? [];
  },
});
