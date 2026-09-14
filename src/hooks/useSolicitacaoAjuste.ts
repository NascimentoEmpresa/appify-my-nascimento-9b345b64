import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0305 (Carol): "SOLICITO MIGRAÇÃO PARA O SISTEMA DE ERP" — migra o
// módulo "Ajustes" (prefixo aju_*) do mesmo app legado Python/eel (Sistema
// Financeiro Nascimento) que já teve o Checklist de Faturamento migrado
// (SIS-2026-0304, useChecklistFaturamento.ts). Fluxo: pedido de documentos/
// comprovantes de RH por contrato+competência, com itens individuais
// respondidos/anexados, reabertura (importa itens da rodada anterior),
// prazos e unificação de PDF pro envio final.
//
// Fase 1 confirmada com o usuário: só a estrutura funcional — migração do
// dado histórico do legado é uma fase separada e posterior. Catálogo de
// tipos é próprio (não reaproveita doc_tipos — conceito diferente, ver
// comentário da migration 20260930000090).

export const BUCKET_SOLICITACAO_AJUSTE_ANEXOS = "solicitacoes-ajuste-anexos";

export type StatusSolicitacaoAjuste =
  | "em_conferencia"
  | "aguardando_rh"
  | "em_conferencia_rh"
  | "concluido_rh"
  | "enviado"
  | "arquivada";

export const STATUS_LABEL_SOLICITACAO_AJUSTE: Record<StatusSolicitacaoAjuste, string> = {
  em_conferencia: "Em Conferência",
  aguardando_rh: "Aguardando RH",
  em_conferencia_rh: "Em Conf. RH",
  concluido_rh: "Concluído RH",
  enviado: "Enviado",
  arquivada: "Arquivada",
};

// Espelha a régua validada no servidor (trigger solicitacao_ajuste_valida_transicao)
// — só usado aqui pra decidir quais botões de transição mostrar na tela.
// SIS-2026-0305 (achado do usuário testando): mesma lista fixa de 8
// setores já usada nos filtros da tela do legado — um item pode ser
// respondido por qualquer um desses setores, não só RH.
export const SETORES_SOLICITACAO_AJUSTE = [
  "RH",
  "Financeiro",
  "Operacional",
  "Jurídico",
  "Segurança",
  "Controladoria",
  "Compras",
  "Recrutamento e Seleção",
] as const;
export type SetorSolicitacaoAjuste = (typeof SETORES_SOLICITACAO_AJUSTE)[number];

// Estilo denso/colorido do legado (achado nos prints do usuário testando) —
// cada setor com sua própria cor, reaproveitado no badge do item.
export const SETOR_BADGE_CLASSE: Record<string, string> = {
  RH: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  Financeiro: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  Operacional: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  "Jurídico": "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  "Segurança": "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  Controladoria: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
  Compras: "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-900",
  "Recrutamento e Seleção": "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:border-fuchsia-900",
};

export const STATUS_BADGE_CLASSE_SOLICITACAO_AJUSTE: Record<StatusSolicitacaoAjuste, string> = {
  em_conferencia: "bg-muted text-muted-foreground border-border",
  aguardando_rh: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  em_conferencia_rh: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  concluido_rh: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  enviado: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  arquivada: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
};

export const TRANSICOES_STATUS_SOLICITACAO_AJUSTE: Record<StatusSolicitacaoAjuste, StatusSolicitacaoAjuste[]> = {
  em_conferencia: ["aguardando_rh"],
  aguardando_rh: ["em_conferencia_rh"],
  em_conferencia_rh: ["aguardando_rh", "concluido_rh"],
  concluido_rh: ["em_conferencia_rh", "enviado"],
  enviado: ["em_conferencia"],
  arquivada: [],
};

export interface ContratoSolicitacaoAjuste {
  id: string;
  nome: string;
  empresa_id: string;
  status: string;
}

// SIS-2026-0305 (achado do usuário testando): traz TODOS os contratos, não
// só ativos — pode ser preciso reabrir uma solicitação de uma competência
// em que o contrato ainda estava ativo. Quem renderiza a lista (ex.
// SearchableSelect) decide como distinguir visualmente o encerrado (opacity,
// nunca esconder) — mesmo padrão do ContratosERP.tsx.
export function useContratosSolicitacaoAjuste() {
  return useQuery({
    queryKey: ["sol_ajuste_contratos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contratos")
        .select("id, nome, empresa_id, status")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ContratoSolicitacaoAjuste[];
    },
  });
}

// ── Catálogo de tipos (autocomplete) ─────────────────────────────────────
export interface TipoSolicitacaoAjuste {
  id: string;
  nome: string;
  ativo: boolean;
}

const TIPOS_KEY = "sol_ajuste_tipos";

export function useTiposSolicitacaoAjuste() {
  return useQuery({
    queryKey: [TIPOS_KEY],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE_TIPO")
        .select("id, nome, ativo")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as TipoSolicitacaoAjuste[];
    },
  });
}

export function useCriarTipoSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE_TIPO").insert({ nome: nome.trim() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIPOS_KEY] }),
  });
}

export function useRenomearTipoSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE_TIPO").update({ nome: nome.trim() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIPOS_KEY] }),
  });
}

export function useExcluirTipoSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE_TIPO").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIPOS_KEY] }),
  });
}

// ── Solicitações (lista + detalhe) ───────────────────────────────────────
export interface SolicitacaoAjuste {
  id: string;
  contrato_id: string;
  competencia: string;
  iteracao: number;
  sol_anterior_id: string | null;
  status: StatusSolicitacaoAjuste;
  quem_recebeu: string | null;
  data_recebimento: string | null;
  data_reenvio: string | null;
  prazo_resposta: string | null;
  data_despacho: string | null;
  prazo_despacho: string | null;
  doc_pedido_path: string | null;
  doc_pedido_nome: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  contrato: { id: string; nome: string; empresa_id: string } | null;
}

const SOLICITACOES_KEY = "sol_ajuste_lista";

// Só as ativas (fora arquivada) — Histórico da Competência busca as
// arquivadas separadamente, por contrato+competência.
export function useSolicitacoesAjuste() {
  return useQuery({
    queryKey: [SOLICITACOES_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE")
        .select("*, contrato:contrato_id(id, nome, empresa_id)")
        .neq("status", "arquivada")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SolicitacaoAjuste[];
    },
  });
}

export function useHistoricoCompetenciaSolicitacaoAjuste(contratoId: string | null, competencia: string | null) {
  return useQuery({
    queryKey: ["sol_ajuste_historico_comp", contratoId, competencia],
    enabled: !!contratoId && !!competencia,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE")
        .select("*, contrato:contrato_id(id, nome, empresa_id)")
        .eq("contrato_id", contratoId)
        .eq("competencia", competencia)
        .eq("status", "arquivada")
        .order("iteracao", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SolicitacaoAjuste[];
    },
  });
}

// Pré-checagem pro front decidir entre "Nova Solicitação" e "Reabertura"
// antes de chamar o RPC (que valida tudo de novo server-side).
export function useSolicitacaoAtivaPorCompetencia(contratoId: string | null, competencia: string | null) {
  return useQuery({
    queryKey: ["sol_ajuste_ativa_comp", contratoId, competencia],
    enabled: !!contratoId && !!competencia,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE")
        .select("id, status, iteracao")
        .eq("contrato_id", contratoId)
        .eq("competencia", competencia)
        .neq("status", "arquivada")
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; status: StatusSolicitacaoAjuste; iteracao: number } | null;
    },
  });
}

// ── Itens ─────────────────────────────────────────────────────────────────
export interface ItemSolicitacaoAjuste {
  id: string;
  solicitacao_id: string;
  numero_item: number;
  descricao: string;
  setor: string;
  data_resposta: string | null;
  respondido_por: string | null;
}

export function useItensSolicitacaoAjuste(solicitacaoId: string | null) {
  return useQuery({
    queryKey: ["sol_ajuste_itens", solicitacaoId],
    enabled: !!solicitacaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE_ITEM")
        .select("*")
        .eq("solicitacao_id", solicitacaoId)
        .order("numero_item");
      if (error) throw error;
      return (data ?? []) as ItemSolicitacaoAjuste[];
    },
  });
}

export function useAdicionarItemSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ solicitacaoId, descricao, setor }: { solicitacaoId: string; descricao: string; setor: string }) => {
      const { error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE_ITEM")
        .insert({ solicitacao_id: solicitacaoId, descricao: descricao.trim(), setor });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["sol_ajuste_itens", vars.solicitacaoId] }),
  });
}

export function useResponderItemSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId, solicitacaoId, descricao, setor, dataResposta,
    }: { itemId: string; solicitacaoId: string; descricao?: string; setor?: string; dataResposta?: string | null }) => {
      const { data: userData } = await supabase.auth.getUser();
      const patch: Record<string, unknown> = {};
      if (descricao !== undefined) patch.descricao = descricao.trim();
      if (setor !== undefined) patch.setor = setor;
      if (dataResposta !== undefined) {
        patch.data_resposta = dataResposta;
        patch.respondido_por = dataResposta ? userData.user?.id ?? null : null;
      }
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE_ITEM").update(patch).eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["sol_ajuste_itens", vars.solicitacaoId] }),
  });
}

export function useExcluirItemSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId }: { itemId: string; solicitacaoId: string }) => {
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE_ITEM").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["sol_ajuste_itens", vars.solicitacaoId] }),
  });
}

// ── Anexos ────────────────────────────────────────────────────────────────
export interface AnexoSolicitacaoAjuste {
  id: string;
  item_id: string;
  storage_path: string;
  nome_original: string;
  tamanho_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

export function useAnexosItemSolicitacaoAjuste(itemId: string | null) {
  return useQuery({
    queryKey: ["sol_ajuste_anexos", itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE_ANEXO")
        .select("*")
        .eq("item_id", itemId)
        .order("uploaded_at");
      if (error) throw error;
      return (data ?? []) as AnexoSolicitacaoAjuste[];
    },
  });
}

export function useAnexarItemSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, arquivo }: { itemId: string; arquivo: File }) => {
      const { data: userData } = await supabase.auth.getUser();
      const ext = arquivo.name.split(".").pop() ?? "dat";
      const path = `itens/${itemId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET_SOLICITACAO_AJUSTE_ANEXOS).upload(path, arquivo);
      if (uploadError) throw uploadError;

      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE_ANEXO").insert({
        item_id: itemId, storage_path: path, nome_original: arquivo.name,
        tamanho_bytes: arquivo.size, uploaded_by: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["sol_ajuste_anexos", vars.itemId] }),
  });
}

export function useExcluirAnexoSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (anexo: AnexoSolicitacaoAjuste) => {
      await supabase.storage.from(BUCKET_SOLICITACAO_AJUSTE_ANEXOS).remove([anexo.storage_path]);
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE_ANEXO").delete().eq("id", anexo.id);
      if (error) throw error;
    },
    onSuccess: (_d, anexo) => qc.invalidateQueries({ queryKey: ["sol_ajuste_anexos", anexo.item_id] }),
  });
}

// ── Criar (com reabertura) — RPC atômica ──────────────────────────────────
export interface NovoItemSolicitacaoAjuste {
  descricao: string;
  setor: string;
}

export function useCriarSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contratoId: string;
      competencia: string;
      quemRecebeu: string | null;
      dataRecebimento?: string | null;
      prazoResposta: string | null;
      docPedidoPath: string | null;
      docPedidoNome: string | null;
      itens: NovoItemSolicitacaoAjuste[];
      itensImportarIds?: string[];
    }) => {
      const { data, error } = await (supabase as any).rpc("solicitacao_ajuste_criar", {
        _contrato_id: input.contratoId,
        _competencia: input.competencia,
        _quem_recebeu: input.quemRecebeu,
        _prazo_resposta: input.prazoResposta,
        _doc_pedido_path: input.docPedidoPath,
        _doc_pedido_nome: input.docPedidoNome,
        _itens: input.itens,
        _itens_importar_ids: input.itensImportarIds ?? null,
        _data_recebimento: input.dataRecebimento ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [SOLICITACOES_KEY] }),
  });
}

export function useUploadDocPedidoSolicitacaoAjuste() {
  return useMutation({
    mutationFn: async (arquivo: File) => {
      const ext = arquivo.name.split(".").pop() ?? "dat";
      const path = `pedidos/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET_SOLICITACAO_AJUSTE_ANEXOS).upload(path, arquivo);
      if (error) throw error;
      return { path, nome: arquivo.name };
    },
  });
}

// ── Transições de status e despacho ──────────────────────────────────────
export function useMudarStatusSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: StatusSolicitacaoAjuste }) => {
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [SOLICITACOES_KEY] }),
  });
}

export function useRegistrarDespachoSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("SOLICITACAO_AJUSTE")
        .update({ data_despacho: new Date().toLocaleDateString("sv-SE") })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [SOLICITACOES_KEY] }),
  });
}

export function useExcluirSolicitacaoAjuste() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("SOLICITACAO_AJUSTE").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [SOLICITACOES_KEY] }),
  });
}
