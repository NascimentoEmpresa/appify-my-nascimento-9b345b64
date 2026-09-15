import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  ChamadoDisponivel,
  ColaboradorHoraExtra,
  SolicitacaoHoraExtra,
  StatsHoraExtra,
} from "@/pages/sistemas/hora-extra/types";

// Os tipos gerados serão atualizados somente depois da aplicação da migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useSolicitacoesHoraExtra(inicio: string, fim: string) {
  return useQuery({
    queryKey: ["hora-extra", "lista", inicio, fim],
    queryFn: async () => {
      const { data, error } = await db
        .from("HORA_EXTRA_SOLICITACAO")
        .select("*, chamados:HORA_EXTRA_CHAMADO(*), anexos:HORA_EXTRA_ANEXO(*)")
        .gte("data_he", inicio)
        .lte("data_he", fim)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SolicitacaoHoraExtra[];
    },
  });
}

export function useDetalheHoraExtra(id?: string | null) {
  return useQuery({
    queryKey: ["hora-extra", "detalhe", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db
        .from("HORA_EXTRA_SOLICITACAO")
        .select("*, chamados:HORA_EXTRA_CHAMADO(*), anexos:HORA_EXTRA_ANEXO(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as SolicitacaoHoraExtra;
    },
  });
}

export function useStatsHoraExtra(inicio: string, fim: string) {
  return useQuery({
    queryKey: ["hora-extra", "stats", inicio, fim],
    queryFn: async () => {
      const { data, error } = await db.rpc("hora_extra_stats", { p_inicio: inicio, p_fim: fim });
      if (error) throw error;
      return data as StatsHoraExtra;
    },
  });
}

export function useColaboradoresHoraExtra() {
  return useQuery({
    queryKey: ["hora-extra", "colaboradores"],
    queryFn: async () => {
      const { data, error } = await db.rpc("hora_extra_colaboradores");
      if (error) throw error;
      return (data ?? []) as ColaboradorHoraExtra[];
    },
  });
}

export function useChamadosDisponiveisHoraExtra(colaboradorId?: string | null, concluidosDesde?: string | null) {
  return useQuery({
    queryKey: ["hora-extra", "chamados-disponiveis", colaboradorId, concluidosDesde],
    enabled: !!colaboradorId,
    queryFn: async () => {
      const { data, error } = await db.rpc("hora_extra_chamados_disponiveis", {
        p_colaborador: colaboradorId,
        p_concluidos_desde: concluidosDesde ?? null,
      });
      if (error) throw error;
      return (data ?? []) as ChamadoDisponivel[];
    },
  });
}

function useRpcHoraExtra(nome: string) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: async (args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(nome, args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: ["hora-extra"] }),
  });
}

export const useSalvarHoraExtra = () => useRpcHoraExtra("hora_extra_salvar");
export const useLiberarHoraExtra = () => useRpcHoraExtra("hora_extra_liberar");
export const useConcluirHoraExtra = () => useRpcHoraExtra("hora_extra_concluir");
export const useValidarHoraExtra = () => useRpcHoraExtra("hora_extra_validar");
export const useExcluirHoraExtra = () => useRpcHoraExtra("hora_extra_excluir");

export async function enviarAnexosHoraExtra(
  solicitacaoId: string,
  fase: "solicitacao" | "conclusao",
  arquivos: File[],
) {
  const falhas: string[] = [];
  for (const arquivo of arquivos) {
    const nomeSeguro = arquivo.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-");
    const caminho = `${solicitacaoId}/${Date.now()}-${nomeSeguro}`;
    const upload = await supabase.storage.from("hora-extra").upload(caminho, arquivo, { contentType: arquivo.type });
    if (upload.error) {
      falhas.push(arquivo.name);
      continue;
    }
    const { error } = await db.from("HORA_EXTRA_ANEXO").insert({
      solicitacao_id: solicitacaoId,
      fase,
      storage_path: caminho,
      nome_arquivo: arquivo.name,
      mime_type: arquivo.type || null,
      tamanho_bytes: arquivo.size,
    });
    if (error) falhas.push(arquivo.name);
  }
  return falhas;
}

export async function urlAssinadaHoraExtra(caminho: string) {
  const { data, error } = await supabase.storage.from("hora-extra").createSignedUrl(caminho, 3600);
  if (error) throw error;
  return data.signedUrl;
}
