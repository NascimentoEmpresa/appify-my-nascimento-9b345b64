import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { NumerosVideo } from "@/components/treinamentos/ReacoesVideo";

// =====================================================================
// Treinamentos ERP — visualizações e curtidas por vídeo (mig 20261005000004).
// A visualização continua sendo registrada pelo visor (trn_registrar_
// visualizacao, mig 063); aqui só se lê os números e se curte.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const CHAVE = "trn-video-numeros";

/** Números de vários treinamentos de uma vez (a grade de cards e o visor). */
export function useNumerosTreinamentos(ids: string[]) {
  const ordenados = [...ids].sort();
  return useQuery({
    queryKey: [CHAVE, ordenados],
    enabled: ordenados.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, NumerosVideo>> => {
      const { data, error } = await sb.rpc("trn_video_numeros", { _ids: ordenados });
      if (error) throw error;
      const m: Record<string, NumerosVideo> = {};
      for (const r of (data ?? []) as { treinamento_id: string; visualizacoes: number; curtidas: number; curti: boolean }[]) {
        m[r.treinamento_id] = { visualizacoes: Number(r.visualizacoes), curtidas: Number(r.curtidas), curti: r.curti };
      }
      return m;
    },
  });
}

/** Recarrega os números (depois que o visor registra a abertura). */
export function useRecarregarNumeros() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [CHAVE] });
}

/** Curtir / descurtir — a tela muda na hora e confirma com o banco. */
export function useCurtirTreinamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const { data, error } = await sb.rpc("trn_video_curtir", { _treinamento: id });
      if (error) throw error;
      return !!data;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: [CHAVE] });
      qc.setQueriesData<Record<string, NumerosVideo>>({ queryKey: [CHAVE] }, (m) => {
        if (!m?.[id]) return m;
        const n = m[id];
        return { ...m, [id]: { ...n, curti: !n.curti, curtidas: n.curtidas + (n.curti ? -1 : 1) } };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [CHAVE] }),
  });
}
