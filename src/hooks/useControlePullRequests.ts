import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  LOTE_CSV_CONTROLE_PR, parametrosRpc,
  type FiltroControlePr, type PaginaControlePr, type PrControle,
} from "@/lib/sistemas/controlePullRequests";

// =====================================================================
// SIS-2026-0786 — Controle de Pull Requests (migs 20261029004900 e 005000).
// Uma página por chamada: filtro e paginação rodam no banco (RPC
// dev_github_controle_pr). Quem preenche é o workflow pr_registrar_painel.yml
// no merge — a tela só lê.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

async function buscarPagina(f: FiltroControlePr, pagina: number, porPagina?: number): Promise<PaginaControlePr> {
  const { data, error } = await sb.rpc("dev_github_controle_pr", parametrosRpc(f, pagina, porPagina));
  if (error) throw error;
  const r = data as Partial<PaginaControlePr> | null;
  return {
    total: r?.total ?? 0, pagina: r?.pagina ?? 1, por_pagina: r?.por_pagina ?? 0,
    desenvolvedores: r?.desenvolvedores ?? [], prs: r?.prs ?? [],
  };
}

/** A página atual. Enquanto a próxima carrega, a anterior continua na tela. */
export const useControlePullRequests = (f: FiltroControlePr, pagina: number) => useQuery({
  queryKey: ["dev-github-controle-pr", f, pagina],
  queryFn: () => buscarPagina(f, pagina),
  placeholderData: keepPreviousData,
  staleTime: 60_000,
});

/** Para o Exportar CSV: todas as PRs do filtro atual, em lotes de 500. */
export async function buscarTudoParaCsv(f: FiltroControlePr): Promise<PrControle[]> {
  const todas: PrControle[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await buscarPagina(f, pagina, LOTE_CSV_CONTROLE_PR);
    // A RPC devolve a última página quando se pede além do fim: já foi lida.
    if (r.pagina !== pagina) return todas;
    todas.push(...r.prs);
    if (todas.length >= r.total || r.prs.length < LOTE_CSV_CONTROLE_PR) return todas;
  }
}
