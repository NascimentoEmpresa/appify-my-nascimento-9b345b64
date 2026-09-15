import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Reuniao, ReuniaoAssuntoForaPauta, ReuniaoDecisaoAcao, ReuniaoPauta } from "./types";

/** Dados brutos pro Painel Gerencial — só as reuniões do usuário logado (mesma regra de interação do resto do módulo), com pauta/decisões-ações/assuntos fora da pauta relacionados. Os indicadores são calculados no componente a partir daqui. */
export function usePainelGerencialDados() {
  const { data: reunioes = [], isLoading: carregandoReunioes } = useQuery({
    queryKey: ["painel-gerencial-reunioes"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_minhas_reunioes");
      if (error) throw error;
      return (data ?? []) as Reuniao[];
    },
  });

  const reuniaoIds = reunioes.map((r) => r.id);

  const { data: pauta = [], isLoading: carregandoPauta } = useQuery({
    queryKey: ["painel-gerencial-pauta", reuniaoIds],
    enabled: reuniaoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_pauta")
        .select("id, reuniao_id, ordem, titulo_topico, descricao, responsavel_user_id, prazo, tempo_previsto_minutos, status, natureza, fora_pauta, created_at")
        .in("reuniao_id", reuniaoIds);
      if (error) throw error;
      return (data ?? []) as ReuniaoPauta[];
    },
  });

  const pautaIds = pauta.map((p) => p.id);

  const { data: decisoesAcoes = [], isLoading: carregandoDecisoes } = useQuery({
    queryKey: ["painel-gerencial-decisoes", pautaIds],
    enabled: pautaIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_decisao_acao")
        .select("id, pauta_id, tipo, texto, responsavel_user_id, prazo, prioridade, status, necessita_comprovacao, setor_impactado, anexo_storage_path, plano_acao_id, criado_por, created_at")
        .in("pauta_id", pautaIds);
      if (error) throw error;
      return (data ?? []) as ReuniaoDecisaoAcao[];
    },
  });

  const { data: assuntosForaPauta = [], isLoading: carregandoAssuntos } = useQuery({
    queryKey: ["painel-gerencial-assuntos", reuniaoIds],
    enabled: reuniaoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_assunto_fora_pauta")
        .select("id, reuniao_id, classificacao, tratativa, assunto_estacionado, responsavel_tratativa_user_id, data_prevista, reuniao_futura_necessaria, observacoes, concluido, pauta_id, criado_por, created_at")
        .in("reuniao_id", reuniaoIds);
      if (error) throw error;
      return (data ?? []) as ReuniaoAssuntoForaPauta[];
    },
  });

  return {
    reunioes, pauta, decisoesAcoes, assuntosForaPauta,
    isLoading: carregandoReunioes || carregandoPauta || carregandoDecisoes || carregandoAssuntos,
  };
}
