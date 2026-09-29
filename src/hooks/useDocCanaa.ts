import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// DOC CANAA — Gestão de Documentos da Escola Canaã (Financeiro → Ferramentas).
// Migrado do blueprint Flask legado `sistema_canaa` (rota /canaa). Regras de
// status/orçamento/permissão vivem no servidor (migration
// 20260930000257_doc_canaa.sql); este hook só lê e chama as RPCs.

export const BUCKET_DOC_CANAA = "doc-canaa";

export const MENU_DOC_CANAA = "financeiro-doc-canaa";
export const MENU_DOC_CANAA_OPERACIONAL = "financeiro-doc-canaa-operacional";
export const MENU_DOC_CANAA_FINANCEIRO = "financeiro-doc-canaa-financeiro";
export const MENU_DOC_CANAA_ORCAMENTO = "financeiro-doc-canaa-orcamento";

export type StatusDocCanaa =
  | "aguardando_operacional"
  | "conferido"
  | "enviado_malote"
  | "enviado_financeiro"
  | "pago"
  | "devolvido_operacao"
  | "devolvido_financeiro"
  | "excluido";

export const STATUS_LABEL_DOC_CANAA: Record<StatusDocCanaa, string> = {
  aguardando_operacional: "Aguardando Operacional",
  conferido: "Conferido",
  enviado_malote: "Enviado ao Malote",
  enviado_financeiro: "Enviado ao Financeiro",
  pago: "Pago",
  devolvido_operacao: "Devolvido p/ Base",
  devolvido_financeiro: "Devolvido p/ Operação",
  excluido: "Excluído",
};

export const STATUS_BADGE_CLASSE_DOC_CANAA: Record<StatusDocCanaa, string> = {
  aguardando_operacional: "bg-muted text-muted-foreground border-border",
  conferido: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  enviado_malote: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
  enviado_financeiro: "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
  pago: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  devolvido_operacao: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  devolvido_financeiro: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  excluido: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
};

// Espelha doc_canaa_menu_transicao() — só decide quais botões habilitar.
// O servidor valida de novo.
export const TRANSICOES_DOC_CANAA: Record<StatusDocCanaa, StatusDocCanaa[]> = {
  aguardando_operacional: ["conferido", "devolvido_operacao"],
  conferido: ["enviado_malote", "devolvido_operacao", "aguardando_operacional"],
  enviado_malote: ["enviado_financeiro", "devolvido_operacao", "conferido"],
  devolvido_financeiro: ["conferido", "enviado_malote", "devolvido_operacao"],
  enviado_financeiro: ["devolvido_financeiro"],
  pago: ["enviado_financeiro"],
  devolvido_operacao: ["aguardando_operacional"],
  excluido: [],
};

// ── Utilitários ───────────────────────────────────────────────────────────
export const formatarBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// "1.500,00" / "R$ 1500" / "1500.5" → número
export function parseValorBRL(txt: string): number | null {
  const limpo = txt.replace(/R\$/g, "").replace(/\s/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// Competência no formato do banco (1º dia do mês, "AAAA-MM-01")
export const competenciaAtual = () => {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
};

export const labelCompetencia = (comp: string) => `${comp.slice(5, 7)}/${comp.slice(0, 4)}`;

// Prazo operacional do legado: último dia útil (seg-sex) do mês corrente.
export function ultimoDiaUtil(ano: number, mesIndex0: number): Date {
  const d = new Date(ano, mesIndex0 + 1, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function nomeSeguro(nome: string) {
  return nome
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(-80);
}

async function uploadArquivo(prefixo: string, arquivo: File) {
  const path = `${prefixo}/${Date.now()}_${nomeSeguro(arquivo.name)}`;
  const { error } = await supabase.storage.from(BUCKET_DOC_CANAA).upload(path, arquivo, {
    contentType: arquivo.type || undefined,
  });
  if (error) throw error;
  return { path, nome: arquivo.name };
}

export async function abrirArquivoDocCanaa(path: string) {
  // Abre a aba antes do await pra não cair no bloqueador de pop-up.
  const aba = window.open("", "_blank");
  const { data, error } = await supabase.storage.from(BUCKET_DOC_CANAA).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    aba?.close();
    throw error ?? new Error("Arquivo não encontrado.");
  }
  if (aba) aba.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}

export async function baixarArquivoDocCanaa(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET_DOC_CANAA).download(path);
  if (error || !data) throw error ?? new Error("Falha no download.");
  return data;
}

// ── Planos de aplicação ─────────────────────────────────────────────────────
export interface PlanoDocCanaa {
  id: string;
  nome: string;
  limite_mensal: number | null;
  ordem: number;
  ativo: boolean;
}

const PLANOS_KEY = "doc_canaa_planos";

export function usePlanosDocCanaa() {
  return useQuery({
    queryKey: [PLANOS_KEY],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("DOC_CANAA_PLANO")
        .select("id, nome, limite_mensal, ordem, ativo")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as PlanoDocCanaa[]).map((p) => ({
        ...p,
        limite_mensal: p.limite_mensal === null ? null : Number(p.limite_mensal),
      }));
    },
  });
}

export function useSalvarPlanoDocCanaa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plano: Partial<PlanoDocCanaa> & { nome: string }) => {
      const payload = {
        nome: plano.nome.trim().toUpperCase(),
        limite_mensal: plano.limite_mensal ?? null,
        ordem: plano.ordem ?? 0,
        ativo: plano.ativo ?? true,
      };
      const q = plano.id
        ? (supabase as any).from("DOC_CANAA_PLANO").update(payload).eq("id", plano.id)
        : (supabase as any).from("DOC_CANAA_PLANO").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [PLANOS_KEY] }),
  });
}

// ── Protocolos ─────────────────────────────────────────────────────────────
export interface ProtocoloDocCanaa {
  id: string;
  numero: number;
  data_competencia: string;
  competencia: string;
  favorecido: string;
  despesa: string;
  plano_id: string;
  documento: string;
  valor: number;
  doc_path: string;
  doc_nome: string;
  comprovante_malote_path: string | null;
  comprovante_malote_nome: string | null;
  comprovante_pagamento_path: string | null;
  comprovante_pagamento_nome: string | null;
  status: StatusDocCanaa;
  observacao: string | null;
  acima_orcamento: boolean;
  saldo_orcamento: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  plano: { id: string; nome: string } | null;
}

const PROTOCOLOS_KEY = "doc_canaa_protocolos";

export function useProtocolosDocCanaa(competencia: string | null) {
  return useQuery({
    queryKey: [PROTOCOLOS_KEY, competencia],
    queryFn: async () => {
      let q = (supabase as any)
        .from("DOC_CANAA_PROTOCOLO")
        .select("*, plano:plano_id(id, nome)")
        .neq("status", "excluido")
        .order("numero", { ascending: false });
      if (competencia) q = q.eq("competencia", competencia);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as ProtocoloDocCanaa[]).map((p) => ({
        ...p,
        valor: Number(p.valor),
        saldo_orcamento: p.saldo_orcamento === null ? null : Number(p.saldo_orcamento),
      }));
    },
  });
}

// Competências com algum documento (o /api/periodos_zip do legado)
export function useCompetenciasDocCanaa() {
  return useQuery({
    queryKey: [PROTOCOLOS_KEY, "competencias"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("DOC_CANAA_PROTOCOLO")
        .select("competencia")
        .neq("status", "excluido");
      if (error) throw error;
      const set = new Set<string>(((data ?? []) as { competencia: string }[]).map((r) => r.competencia));
      set.add(competenciaAtual());
      return Array.from(set).sort().reverse();
    },
  });
}

export interface HistoricoDocCanaa {
  id: string;
  acao: string;
  detalhes: string | null;
  usuario_nome: string | null;
  created_at: string;
}

export function useHistoricoDocCanaa(protocoloId: string | null) {
  return useQuery({
    queryKey: ["doc_canaa_historico", protocoloId],
    enabled: !!protocoloId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("DOC_CANAA_HISTORICO")
        .select("id, acao, detalhes, usuario_nome, created_at")
        .eq("protocolo_id", protocoloId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as HistoricoDocCanaa[];
    },
  });
}

function useInvalidarProtocolos() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [PROTOCOLOS_KEY] });
    qc.invalidateQueries({ queryKey: ["doc_canaa_historico"] });
  };
}

export interface NovoProtocoloDocCanaa {
  arquivo: File;
  favorecido: string;
  despesa: string;
  planoId: string;
  documento: string;
  valor: number;
  dataCompetencia: string; // AAAA-MM-DD
}

export function useCriarProtocoloDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async (input: NovoProtocoloDocCanaa) => {
      const [ano, mes] = input.dataCompetencia.split("-");
      const { path, nome } = await uploadArquivo(`documentos/${ano}/${mes}`, input.arquivo);
      const { data, error } = await (supabase as any)
        .from("DOC_CANAA_PROTOCOLO")
        .insert({
          data_competencia: input.dataCompetencia,
          favorecido: input.favorecido,
          despesa: input.despesa,
          plano_id: input.planoId,
          documento: input.documento,
          valor: input.valor,
          doc_path: path,
          doc_nome: nome,
        })
        .select("numero, acima_orcamento, saldo_orcamento")
        .single();
      if (error) {
        await supabase.storage.from(BUCKET_DOC_CANAA).remove([path]);
        throw error;
      }
      return data as { numero: number; acima_orcamento: boolean; saldo_orcamento: number | null };
    },
    onSuccess: invalidar,
  });
}

export function useEditarProtocoloDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async (input: Omit<NovoProtocoloDocCanaa, "arquivo"> & { id: string; arquivo?: File | null }) => {
      let novo: { path: string; nome: string } | null = null;
      if (input.arquivo) {
        const [ano, mes] = input.dataCompetencia.split("-");
        novo = await uploadArquivo(`documentos/${ano}/${mes}`, input.arquivo);
      }
      const { error } = await (supabase as any).rpc("doc_canaa_editar", {
        _id: input.id,
        _favorecido: input.favorecido,
        _despesa: input.despesa,
        _plano_id: input.planoId,
        _documento: input.documento,
        _valor: input.valor,
        _data_competencia: input.dataCompetencia,
        _doc_path: novo?.path ?? null,
        _doc_nome: novo?.nome ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useMudarStatusDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async ({ ids, status, obs }: { ids: string[]; status: StatusDocCanaa; obs?: string | null }) => {
      const { data, error } = await (supabase as any).rpc("doc_canaa_mudar_status", {
        _ids: ids,
        _status: status,
        _obs: obs ?? null,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: invalidar,
  });
}

export function useAnexarComprovanteMaloteDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async ({ id, arquivo }: { id: string; arquivo: File }) => {
      const hoje = new Date();
      const { path, nome } = await uploadArquivo(
        `comprovantes/malote/${hoje.getFullYear()}/${String(hoje.getMonth() + 1).padStart(2, "0")}`,
        arquivo,
      );
      const { error } = await (supabase as any).rpc("doc_canaa_anexar_comprovante_malote", {
        _id: id, _path: path, _nome: nome,
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useConcluirPagamentoDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async ({ id, arquivo, obs }: { id: string; arquivo: File; obs?: string | null }) => {
      const hoje = new Date();
      const { path, nome } = await uploadArquivo(
        `comprovantes/pagamento/${hoje.getFullYear()}/${String(hoje.getMonth() + 1).padStart(2, "0")}`,
        arquivo,
      );
      const { error } = await (supabase as any).rpc("doc_canaa_concluir_pagamento", {
        _id: id, _path: path, _nome: nome, _obs: obs ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useAlterarPlanoDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async ({ id, planoId }: { id: string; planoId: string }) => {
      const { error } = await (supabase as any).rpc("doc_canaa_alterar_plano", { _id: id, _plano_id: planoId });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useAdicionarObsDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async ({ id, obs }: { id: string; obs: string }) => {
      const { error } = await (supabase as any).rpc("doc_canaa_adicionar_obs", { _id: id, _obs: obs });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useExcluirProtocoloDocCanaa() {
  const invalidar = useInvalidarProtocolos();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo?: string | null }) => {
      const { error } = await (supabase as any).rpc("doc_canaa_excluir", { _id: id, _motivo: motivo ?? null });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}
