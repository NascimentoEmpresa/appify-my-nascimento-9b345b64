import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { BloqueioAgenda, MotivoBloqueioAgenda, TipoBloqueioAgenda } from "./types";

const BLOQUEIO_COLUNAS = "id, user_id, tipo, data_inicio, data_fim, dia_inteiro, hora_inicio, hora_fim, motivo, motivo_outro, created_at, serie_bloqueio_id";
const MAX_OCORRENCIAS_BLOQUEIO_RECORRENTE = 60;

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

/** A partir de hoje, acha a próxima ocorrência do dia da semana escolhido e repete de 7 em 7 dias até repetirAte (inclusive), com teto de segurança. */
function gerarDatasRecorrenciaSemanal(diaSemana: number, repetirAte: string): string[] {
  const datas: string[] = [];
  const fim = new Date(`${repetirAte}T23:59:59`);
  const atual = new Date();
  atual.setHours(0, 0, 0, 0);
  while (atual.getDay() !== diaSemana) atual.setDate(atual.getDate() + 1);
  while (atual <= fim && datas.length < MAX_OCORRENCIAS_BLOQUEIO_RECORRENTE) {
    datas.push(atual.toISOString().slice(0, 10));
    atual.setDate(atual.getDate() + 7);
  }
  return datas;
}

/** Desloca uma data (yyyy-mm-dd) pro novo dia da semana dentro da mesma semana — mesma lógica de aplicarNovoDiaHorario em useReunioes.ts, adaptada pra data sem horário. */
function aplicarNovoDiaSemanaData(dataIso: string, novoDiaSemana: number): string {
  const d = new Date(`${dataIso}T00:00:00`);
  const delta = novoDiaSemana - d.getDay();
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

interface NovoBloqueioRecorrente {
  diaSemana: number;
  repetirAte: string;
  dia_inteiro: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  motivo: MotivoBloqueioAgenda;
  motivo_outro: string | null;
}

/** Cria uma série de bloqueios semanais (mesmo dia da semana, mesmo horário/motivo, uma linha por ocorrência) — todas marcadas com a mesma serie_bloqueio_id, pra dar pra editar/excluir em massa depois. */
export function useCriarBloqueiosRecorrentes() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (novo: NovoBloqueioRecorrente) => {
      const datas = gerarDatasRecorrenciaSemanal(novo.diaSemana, novo.repetirAte);
      if (datas.length === 0) throw new Error("Nenhuma ocorrência encontrada até a data informada.");
      const serieId = crypto.randomUUID();
      const linhas = datas.map((data) => ({
        tipo: "data_especifica" as const,
        data_inicio: data,
        data_fim: data,
        dia_inteiro: novo.dia_inteiro,
        hora_inicio: novo.dia_inteiro ? null : novo.hora_inicio,
        hora_fim: novo.dia_inteiro ? null : novo.hora_fim,
        motivo: novo.motivo,
        motivo_outro: novo.motivo_outro,
        serie_bloqueio_id: serieId,
      }));
      const { error } = await (supabase as any).from("reuniao_bloqueio_agenda").insert(linhas);
      if (error) throw error;
      return linhas.length;
    },
    onSuccess: (quantidade) => {
      qc.invalidateQueries({ queryKey: ["reuniao_bloqueio_agenda"] });
      toast({ title: `${quantidade} ocorrências bloqueadas` });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao bloquear agenda recorrente", description: error.message, variant: "destructive" });
    },
  });
}

interface EdicaoSerieBloqueio {
  serieId: string;
  novoDiaSemana: number;
  dia_inteiro: boolean;
  hora_inicio: string | null;
  hora_fim: string | null;
  motivo: MotivoBloqueioAgenda;
  motivo_outro: string | null;
}

/** Edita as ocorrências futuras de uma série de bloqueios — desloca a data pro novo dia da semana e aplica o novo horário/motivo. Passadas ficam intocadas. */
export function useEditarSerieBloqueio() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (edicao: EdicaoSerieBloqueio) => {
      const hoje = new Date().toISOString().slice(0, 10);
      const { data: itens, error } = await (supabase as any)
        .from("reuniao_bloqueio_agenda")
        .select("id, data_inicio")
        .eq("serie_bloqueio_id", edicao.serieId)
        .gte("data_inicio", hoje);
      if (error) throw error;

      for (const item of (itens ?? []) as { id: string; data_inicio: string }[]) {
        const novaData = aplicarNovoDiaSemanaData(item.data_inicio, edicao.novoDiaSemana);
        const { error: updErr } = await (supabase as any)
          .from("reuniao_bloqueio_agenda")
          .update({
            data_inicio: novaData,
            data_fim: novaData,
            dia_inteiro: edicao.dia_inteiro,
            hora_inicio: edicao.dia_inteiro ? null : edicao.hora_inicio,
            hora_fim: edicao.dia_inteiro ? null : edicao.hora_fim,
            motivo: edicao.motivo,
            motivo_outro: edicao.motivo_outro,
          })
          .eq("id", item.id);
        if (updErr) throw updErr;
      }
      return (itens ?? []).length;
    },
    onSuccess: (quantidade) => {
      qc.invalidateQueries({ queryKey: ["reuniao_bloqueio_agenda"] });
      toast({ title: `${quantidade} ocorrências atualizadas` });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao editar série de bloqueios", description: error.message, variant: "destructive" });
    },
  });
}

/** Exclui as ocorrências futuras de uma série de bloqueios. Passadas ficam intocadas. */
export function useExcluirSerieBloqueio() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (serieId: string) => {
      const hoje = new Date().toISOString().slice(0, 10);
      const { error } = await (supabase as any)
        .from("reuniao_bloqueio_agenda")
        .delete()
        .eq("serie_bloqueio_id", serieId)
        .gte("data_inicio", hoje);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reuniao_bloqueio_agenda"] });
      toast({ title: "Série de bloqueios excluída" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao excluir série de bloqueios", description: error.message, variant: "destructive" });
    },
  });
}
