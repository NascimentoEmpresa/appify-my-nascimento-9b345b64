import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface PlanoAcaoRow {
  id: string;
  empresa_id: string;
  id_importacao: string | null;
  ordem: number | null;
  tipo_acao: string;
  titulo: string | null;
  comite: string | null;
  area: string | null;
  setor: string | null;
  prioridade_normalizada: string | null;
  prioridade_original: string | null;
  problema: string | null;
  acao: string | null;
  responsavel_profile_id: string | null;
  responsavel_nome_origem: string | null;
  criado_por: string | null;
  lider_comite_nome_origem: string | null;
  lider_setor_nome_origem: string | null;
  data_inicio_planejado_original: string | null;
  data_fim_planejado_original: string | null;
  data_inicio_real_original: string | null;
  data_fim_real_original: string | null;
  status_original: string | null;
  status_normalizado: string;
  comentarios: string | null;
  pendencias_iniciais: string[];
  pendencia_responsavel: boolean;
  pendencia_datas: boolean;
  pendencia_evidencia: boolean;
  custo_previsto: number;
  custo_realizado: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function usePlanoAcoes() {
  const { user, loading } = useAuth();
  return useQuery({
    queryKey: ["plano_acoes"],
    enabled: !loading && !!user,
    queryFn: async (): Promise<PlanoAcaoRow[]> => {
      // Empresa ativa não filtra mais o Plano de Ações — traz as ações de
      // todas as empresas do usuário de uma vez (RLS decide o que ele pode
      // ver, não o seletor de empresa do topo).
      // Sem embed de empresas: plano_acao.empresa_id não tem FK declarada
      // para empresas(id), então o PostgREST não resolve
      // "empresas:empresa_id(...)" e retorna 400 em toda a query.
      const { data, error } = await supabase
        .from("plano_acao")
        .select("*")
        .is("deleted_at", null)
        .order("ordem", { ascending: true, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as PlanoAcaoRow[];
    },
  });
}
