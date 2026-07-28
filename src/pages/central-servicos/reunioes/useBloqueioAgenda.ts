import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { BloqueioAgenda, MotivoBloqueioAgenda, TipoBloqueioAgenda } from "./types";

const BLOQUEIO_COLUNAS = "id, user_id, tipo, data_inicio, data_fim, dia_inteiro, hora_inicio, hora_fim, motivo, motivo_outro, created_at";

/** Bloqueios do próprio usuário logado — usado só pra gerenciar (criar/remover) os seus. Filtra explícito por user_id: a RLS de leitura agora é aberta pra todo mundo (ver useBloqueiosAgendaPorUsuarios), então sem esse filtro isso listaria o bloqueio de todo mundo. */
export function useMeusBloqueiosAgenda() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reuniao_bloqueio_agenda", "meus", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_bloqueio_agenda")
        .select(BLOQUEIO_COLUNAS)
        .eq("user_id", user!.id)
        .order("data_inicio", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BloqueioAgenda[];
    },
  });
}

/** Bloqueios de uma lista de pessoas — pra mostrar "ocupado" de outros usuários (formulário de criação, calendário filtrado por pessoa). Motivo é visível pra qualquer um com acesso à Agenda de Reunião (decisão do usuário). */
export function useBloqueiosAgendaPorUsuarios(userIds: string[]) {
  const idsUnicos = [...new Set(userIds)].filter(Boolean).sort();
  return useQuery({
    queryKey: ["reuniao_bloqueio_agenda", "por_usuarios", idsUnicos],
    enabled: idsUnicos.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_bloqueio_agenda")
        .select(BLOQUEIO_COLUNAS)
        .in("user_id", idsUnicos)
        .order("data_inicio", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BloqueioAgenda[];
    },
  });
}

interface NovoBloqueio {
  tipo: TipoBloqueioAgenda;
  data_inicio: string;
  data_fim: string;
  dia_inteiro: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  motivo: MotivoBloqueioAgenda;
  motivo_outro: string | null;
}

export function useCriarBloqueioAgenda() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (novo: NovoBloqueio) => {
      const { error } = await (supabase as any).from("reuniao_bloqueio_agenda").insert(novo);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reuniao_bloqueio_agenda"] });
      toast({ title: "Agenda bloqueada" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao bloquear agenda", description: error.message, variant: "destructive" });
    },
  });
}

export function useRemoverBloqueioAgenda() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("reuniao_bloqueio_agenda").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reuniao_bloqueio_agenda"] });
      toast({ title: "Bloqueio removido" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao remover bloqueio", description: error.message, variant: "destructive" });
    },
  });
}
