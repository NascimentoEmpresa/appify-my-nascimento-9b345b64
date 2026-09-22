import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  ChamadoDisponivel,
  ColaboradorHoraExtra,
  DadosDashboardHoraExtra,
  EscalaHoraExtra,
  FiltrosDashboardHoraExtra,
  SolicitacaoHoraExtra,
  StatsHoraExtra,
} from "@/pages/sistemas/hora-extra/types";

export interface InformacoesPrHoraExtra {
  pr: {
    numero: number;
    url: string;
    titulo: string;
    linhas_adicionadas: number;
    commits: number;
    arquivos_adicionados: number;
  };
  chamado: ChamadoDisponivel;
}

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

/**
 * Dashboard de HE: os oito recortes da tela saem de UMA chamada. São todos
 * cortes do mesmo conjunto de solicitações, e oito consultas separadas
 * fariam o banco reavaliar a mesma RLS oito vezes por filtro mexido.
 */
export function useDashboardHoraExtra(filtros: FiltrosDashboardHoraExtra) {
  return useQuery({
    queryKey: ["hora-extra", "dashboard", filtros],
    queryFn: async () => {
      const { data, error } = await db.rpc("hora_extra_dashboard", {
        p_inicio: filtros.inicio,
        p_fim: filtros.fim,
        p_empresa: filtros.empresa === "todos" ? null : filtros.empresa,
        p_setor: filtros.setor === "todos" ? null : filtros.setor,
        p_colaborador: filtros.colaborador === "todos" ? null : filtros.colaborador,
        p_meses: filtros.meses,
      });
      if (error) throw error;
      return data as DadosDashboardHoraExtra;
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

/** Escalas de trabalho: a jornada que define a partir de quando é HE. */
export function useEscalasHoraExtra() {
  return useQuery({
    queryKey: ["hora-extra", "escalas"],
    queryFn: async () => {
      const { data, error } = await db
        .from("HORA_EXTRA_ESCALA")
        .select("*")
        .eq("ativo", true)
        .order("padrao", { ascending: false })
        .order("nome");
      if (error) throw error;
      return (data ?? []) as EscalaHoraExtra[];
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
export const useLiberarHoraExtraComHorarios = () => useRpcHoraExtra("hora_extra_liberar_com_horarios");
export const useConcluirHoraExtra = () => useRpcHoraExtra("hora_extra_concluir");
export const useValidarHoraExtra = () => useRpcHoraExtra("hora_extra_validar");
export const useValidarHoraExtraComHorarios = () => useRpcHoraExtra("hora_extra_validar_com_horarios");
export const useExcluirHoraExtra = () => useRpcHoraExtra("hora_extra_excluir");
export const useSalvarEscalaHoraExtra = () => useRpcHoraExtra("hora_extra_escala_salvar");
export const useExcluirEscalaHoraExtra = () => useRpcHoraExtra("hora_extra_escala_excluir");

/**
 * Consulta a PR pelo servidor para que o token do GitHub nunca vá para o
 * navegador. A Edge Function também valida se o chamado que aparece no título
 * pode ser usado na solicitação de HE que está sendo concluída.
 */
export async function buscarInformacoesPrHoraExtra(
  solicitacaoId: string,
  numeroPr: number,
): Promise<InformacoesPrHoraExtra> {
  const { data, error } = await supabase.functions.invoke("hora-extra-pr-info", {
    body: { solicitacao_id: solicitacaoId, pr_numero: numeroPr },
  });
  if (error) {
    const resposta = (error as { context?: Response }).context;
    const corpo = resposta ? await resposta.json().catch(() => null) : null;
    throw new Error(corpo?.error || error.message);
  }
  if (!data?.pr || !data?.chamado) throw new Error("A consulta da PR retornou dados incompletos.");
  return data as InformacoesPrHoraExtra;
}

/**
 * Sobe cada arquivo e grava a linha em HORA_EXTRA_ANEXO. Devolve as falhas já
 * com o motivo: antes o aviso dizia só o nome do arquivo e não dava para saber
 * se quem recusou foi o storage ou a RLS da tabela.
 */
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
      falhas.push(`${arquivo.name} (${upload.error.message})`);
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
    if (error) falhas.push(`${arquivo.name} (${error.message})`);
  }
  return falhas;
}

/**
 * O upload roda DEPOIS da RPC, então o invalidateQueries da mutation já passou
 * quando o anexo entra no banco: a lista em cache continuava sem ele e o modal
 * abria sem nenhum arquivo, mesmo com a linha gravada (incidente de 17/09/2026,
 * HE-2026-0004). Por isso a recarga acontece aqui, no fim do envio.
 */
export function useEnviarAnexosHoraExtra() {
  const cliente = useQueryClient();
  return async (solicitacaoId: string, fase: "solicitacao" | "conclusao", arquivos: File[]) => {
    if (!arquivos.length) return [];
    const falhas = await enviarAnexosHoraExtra(solicitacaoId, fase, arquivos);
    await cliente.invalidateQueries({ queryKey: ["hora-extra"] });
    return falhas;
  };
}

export async function urlAssinadaHoraExtra(caminho: string) {
  const { data, error } = await supabase.storage.from("hora-extra").createSignedUrl(caminho, 3600);
  if (error) throw error;
  return data.signedUrl;
}
