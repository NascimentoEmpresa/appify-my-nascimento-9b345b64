import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AgendaContato {
  id: string;
  display_name: string | null;
  email: string | null;
  telefone: string | null;
  avatar_url: string | null;
  cargo: string | null;
  setores: string[];
}

// Dataset pequeno (~50 pessoas): busca tudo de uma vez via RPC (contorna a
// RLS de profiles, que só deixa cada um ver a própria linha) e filtra no
// cliente — sem necessidade de busca no servidor.
export function useAgendaCorporativa(enabled: boolean) {
  return useQuery({
    queryKey: ["agenda-corporativa"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_agenda_corporativa");
      if (error) throw error;
      return (data ?? []) as AgendaContato[];
    },
  });
}

export function useAgendaFavoritos(userId?: string) {
  const qc = useQueryClient();
  const queryKey = ["agenda-favoritos", userId];

  const query = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_favoritos" as any)
        .select("contato_id")
        .eq("user_id", userId);
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.contato_id as string));
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ contatoId, favoritar }: { contatoId: string; favoritar: boolean }) => {
      if (favoritar) {
        const { error } = await supabase
          .from("agenda_favoritos" as any)
          .insert({ user_id: userId, contato_id: contatoId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("agenda_favoritos" as any)
          .delete()
          .eq("user_id", userId)
          .eq("contato_id", contatoId);
        if (error) throw error;
      }
    },
    onMutate: async ({ contatoId, favoritar }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Set<string>>(queryKey);
      qc.setQueryData<Set<string>>(queryKey, (old) => {
        const next = new Set(old ?? []);
        if (favoritar) next.add(contatoId); else next.delete(contatoId);
        return next;
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  return { favoritosSet: query.data ?? new Set<string>(), isLoading: query.isLoading, toggle };
}
