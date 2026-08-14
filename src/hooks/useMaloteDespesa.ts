import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { novoUuid } from "@/lib/utils";

export type OrigemDespesa = "solicitacao" | "despesa_unica" | "despesa_multi_classificacao";
export type StatusDespesa =
  | "rascunho"
  | "aguardando_cotacao"
  | "cotacao_realizada"
  | "cotacao_aprovada"
  | "solicitacao_reprovada"
  | "pendente_aprovacao"
  | "necessidade_de_ajuste"
  | "aguardando_pagamento"
  | "despesa_paga"
  | "despesa_reprovada"
  | "cancelada";
export type TipoMovimento = "entrada" | "saida";
export type TipoSolicitacao = "administrativo" | "contrato" | "dispensa_cotacao";
export type TipoEvento =
  | "criacao"
  | "edicao"
  | "aguardando_cotacao"
  | "cotacao_realizada"
  | "cotacao_aprovada"
  | "solicitacao_aprovada"
  | "solicitacao_reprovada"
  | "despesa_criada"
  | "aprovacao_nivel"
  | "necessidade_de_ajuste"
  | "reenvio_aprovacao"
  | "aguardando_pagamento"
  | "despesa_paga"
  | "despesa_reprovada"
  | "cancelamento";

// Status ainda dentro da fase "Solicitação" — item abre em modal.
// A partir daqui em diante (pendente_aprovacao em diante) o item já é
// tratado como Despesa e abre na tela cheia de visualização.
export const STATUS_FASE_SOLICITACAO: StatusDespesa[] = ["rascunho", "aguardando_cotacao", "cotacao_realizada", "solicitacao_reprovada"];

// Solicitação já cotada e aprovada (evento que vem de fora, do módulo de
// Suprimentos, que escreve direto na malote_despesa) — fica parada aqui até
// o usuário clicar e ir converter em despesa na tela Criar Despesa.
export const STATUS_COTACAO_APROVADA: StatusDespesa[] = ["cotacao_aprovada"];

export const STATUS_TERMINAIS: StatusDespesa[] = ["despesa_paga", "despesa_reprovada", "solicitacao_reprovada", "cancelada"];

export const STATUS_LABEL: Record<StatusDespesa, string> = {
  rascunho: "Rascunho",
  aguardando_cotacao: "Aguardando cotação",
  cotacao_realizada: "Cotação realizada",
  cotacao_aprovada: "Cotação aprovada",
  solicitacao_reprovada: "Solicitação reprovada",
  pendente_aprovacao: "Pendente aprovação",
  necessidade_de_ajuste: "Necessita de ajuste",
  aguardando_pagamento: "Aguardando pagamento",
  despesa_paga: "Despesa paga",
  despesa_reprovada: "Despesa reprovada",
  cancelada: "Cancelada",
};

export const STATUS_BADGE_CLASS: Record<StatusDespesa, string> = {
  rascunho: "bg-muted text-muted-foreground",
  aguardando_cotacao: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  cotacao_realizada: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  cotacao_aprovada: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  solicitacao_reprovada: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  pendente_aprovacao: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  necessidade_de_ajuste: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  aguardando_pagamento: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  despesa_paga: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  despesa_reprovada: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  cancelada: "bg-muted text-muted-foreground",
};

export interface RateioLinha {
  id?: string;
  classificacao_id?: string | null;
  empresa_id: string | null;
  contrato_id: string | null;
  fornecedor_id: string | null;
  integrante_empregado_id: number | null;
  percentual: number | null;
  valor: number;
  ordem: number;
}

export interface Parcela {
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
}

export interface MaloteDespesaRow {
  id: string;
  numero: string;
  empresa_id: string;
  classificacao_id: string | null;
  origem: OrigemDespesa;
  status: StatusDespesa;
  nome: string;
  valor_total: number;
  motivo: string | null;
  descricao: string | null;
  links: string | null;
  tipo_movimento: TipoMovimento | null;
  tipo: TipoSolicitacao | null;
  contrato_id: string | null;
  data_pagamento: string | null;
  competencia: string | null;
  forma_pagamento: string | null;
  informacoes_pagamento: string | null;
  parcelado: boolean;
  numero_parcelas: number | null;
  dia_desconto: number | null;
  nivel_aprovacao_atual: 1 | 2 | 3 | null;
  valor_aprovado_cotacao: number | null;
  valor_aprovado: number | null;
  justificativa_aprovacao: string | null;
  motivo_ajuste: string | null;
  excecao: boolean;
  arquivos: string[];
  created_at: string;
  created_by: string;
  updated_at: string;
  // ── Cotação por Suprimentos (SIS-2026-0112, migration 20260831000001) ──
  // Até 3 cotações em colunas, sem tabela filha. Escritas só pelas RPCs
  // sup_malote_* — a RLS desta tabela não deixa Suprimentos alterar
  // solicitação de outra pessoa.
  cot1_fornecedor: string | null; cot1_valor: number | null; cot1_prazo: string | null;
  cot1_link: string | null; cot1_anexo_path: string | null; cot1_anexo_nome: string | null;
  cot2_fornecedor: string | null; cot2_valor: number | null; cot2_prazo: string | null;
  cot2_link: string | null; cot2_anexo_path: string | null; cot2_anexo_nome: string | null;
  cot3_fornecedor: string | null; cot3_valor: number | null; cot3_prazo: string | null;
  cot3_link: string | null; cot3_anexo_path: string | null; cot3_anexo_nome: string | null;
  cotacao_enviada_em: string | null;
  cotacao_enviada_por_nome: string | null;
  cotacao_decidida_em: string | null;
  cotacao_decidida_por_nome: string | null;
  cotacao_reprovada_motivo: string | null;
  cotacao_observacoes: string | null;
  cotacao_vencedor_num: 1 | 2 | 3 | null;
  classificacao?: { id: string; nome: string; aprovador1_nome?: string | null; aprovador2_nome?: string | null; aprovador3_nome?: string | null } | null;
}

export interface DespesaEvento {
  id: string;
  despesa_id: string;
  tipo_evento: TipoEvento;
  nivel: 1 | 2 | 3 | null;
  ator_user_id: string | null;
  descricao: string | null;
  created_at: string;
}

const DESPESA_KEY = "malote_despesa";

const DESPESA_COLUMNS =
  "id, numero, empresa_id, classificacao_id, origem, status, nome, valor_total, motivo, descricao, links, tipo_movimento, tipo, contrato_id, " +
  "data_pagamento, competencia, forma_pagamento, informacoes_pagamento, parcelado, numero_parcelas, dia_desconto, " +
  "nivel_aprovacao_atual, valor_aprovado_cotacao, valor_aprovado, justificativa_aprovacao, motivo_ajuste, excecao, " +
  "arquivos, created_at, created_by, updated_at, " +
  "cot1_fornecedor, cot1_valor, cot1_prazo, cot1_link, cot1_anexo_path, cot1_anexo_nome, " +
  "cot2_fornecedor, cot2_valor, cot2_prazo, cot2_link, cot2_anexo_path, cot2_anexo_nome, " +
  "cot3_fornecedor, cot3_valor, cot3_prazo, cot3_link, cot3_anexo_path, cot3_anexo_nome, " +
  "cotacao_enviada_em, cotacao_enviada_por_nome, cotacao_decidida_em, cotacao_decidida_por_nome, " +
  "cotacao_reprovada_motivo, cotacao_observacoes, cotacao_vencedor_num, " +
  "classificacao:classificacao_id(id, nome, aprovador1_nome, aprovador2_nome, aprovador3_nome)";

// ── Catálogos usados no rateio ──────────────────────────────────────────
export function useEmpresasGrupo() {
  return useQuery({
    queryKey: ["malote_empresas_grupo"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("ativa", true).order("razao_social");
      if (error) throw error;
      return (data ?? []).map((e) => ({ id: e.id, nome: e.nome_fantasia || e.razao_social }));
    },
  });
}

export function useContratosAtivos() {
  return useQuery({
    queryKey: ["malote_contratos_ativos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("contratos").select("id, nome, empresa_id").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; empresa_id: string }[];
    },
  });
}

export function useFornecedoresAtivos() {
  return useQuery({
    queryKey: ["malote_fornecedores_ativos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("fornecedor").select("id, razao_social, nome_fantasia").order("razao_social");
      if (error) throw error;
      return (data ?? []).map((f: any) => ({ id: f.id, nome: f.nome_fantasia || f.razao_social }));
    },
  });
}

export function useIntegrantes() {
  return useQuery({
    queryKey: ["malote_integrantes"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("EMPREGADOS")
        .select('"ID", "Nome", "Situação"')
        .eq("Situação", "Trabalhando")
        .order("Nome")
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((e: any) => ({ id: e.ID as number, nome: e.Nome as string }));
    },
  });
}

// Nome de exibição de um usuário (usado pro "Solicitante" no cabeçalho da
// Despesa e pra resolver o ator de cada evento da timeline).
export function useNomeUsuario(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["profiles_nome", userId],
    enabled: !!userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("profiles").select("display_name, email").eq("id", userId).single();
      if (error) return null;
      return (data?.display_name || data?.email || null) as string | null;
    },
  });
}

// ── Despesas ──────────────────────────────────────────────────────────
export function useMinhasDespesas() {
  return useQuery({
    queryKey: [DESPESA_KEY, "minhas"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await (supabase as any)
        .from("malote_despesa")
        .select(DESPESA_COLUMNS)
        .eq("created_by", u.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaloteDespesaRow[];
    },
  });
}

export function useDespesa(id: string | undefined) {
  return useQuery({
    queryKey: [DESPESA_KEY, id],
    enabled: !!id,
    queryFn: async () => {
      const [despesaRes, rateioRes, parcelasRes] = await Promise.all([
        (supabase as any).from("malote_despesa").select(DESPESA_COLUMNS).eq("id", id).single(),
        (supabase as any).from("malote_despesa_rateio_linha").select("*").eq("despesa_id", id).order("ordem"),
        (supabase as any).from("malote_despesa_parcela").select("*").eq("despesa_id", id).order("numero_parcela"),
      ]);
      if (despesaRes.error) throw despesaRes.error;
      if (rateioRes.error) throw rateioRes.error;
      if (parcelasRes.error) throw parcelasRes.error;
      return {
        despesa: despesaRes.data as MaloteDespesaRow,
        rateio: (rateioRes.data ?? []) as RateioLinha[],
        parcelas: (parcelasRes.data ?? []) as Parcela[],
      };
    },
  });
}

export interface SalvarDespesaInput {
  id?: string;
  empresa_id: string;
  classificacao_id: string | null;
  origem: OrigemDespesa;
  status: StatusDespesa;
  nome: string;
  valor_total: number;
  motivo?: string | null;
  descricao?: string | null;
  links?: string | null;
  tipo_movimento?: TipoMovimento | null;
  tipo?: TipoSolicitacao | null;
  contrato_id?: string | null;
  data_pagamento?: string | null;
  competencia?: string | null;
  forma_pagamento?: string | null;
  informacoes_pagamento?: string | null;
  valor_aprovado?: number | null;
  justificativa_aprovacao?: string | null;
  parcelado?: boolean;
  numero_parcelas?: number | null;
  dia_desconto?: number | null;
  arquivos?: string[];
  rateio?: RateioLinha[];
  parcelas?: Parcela[];
}

export function useSalvarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarDespesaInput) => {
      const { rateio, parcelas, id: despesaIdInput, ...despesaFields } = input;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sessão expirada.");

      // Insert e update em caminhos separados: um upsert() aqui cairia na
      // pegadinha do Postgres com INSERT ... ON CONFLICT DO UPDATE — mesmo
      // no caminho de update, a política de INSERT (WITH CHECK created_by =
      // auth.uid()) é reavaliada contra a linha "seria inserida", que no
      // segundo salvamento (depois do upload de anexos) não manda
      // created_by, virando NULL = auth.uid() e barrando pelo RLS.
      let despesaId: string;
      if (despesaIdInput) {
        const { data: despesa, error } = await (supabase as any)
          .from("malote_despesa")
          .update(despesaFields)
          .eq("id", despesaIdInput)
          .select("id")
          .single();
        if (error) throw error;
        despesaId = despesa.id as string;
      } else {
        const { data: despesa, error } = await (supabase as any)
          .from("malote_despesa")
          .insert({ ...despesaFields, created_by: u.user.id })
          .select("id")
          .single();
        if (error) throw error;
        despesaId = despesa.id as string;
      }

      if (rateio) {
        await (supabase as any).from("malote_despesa_rateio_linha").delete().eq("despesa_id", despesaId);
        if (rateio.length > 0) {
          const rows = rateio.map(({ id: _id, ...r }, i) => ({ ...r, despesa_id: despesaId, ordem: i }));
          const { error: rErr } = await (supabase as any).from("malote_despesa_rateio_linha").insert(rows);
          if (rErr) throw rErr;
        }
      }

      if (parcelas) {
        await (supabase as any).from("malote_despesa_parcela").delete().eq("despesa_id", despesaId);
        if (parcelas.length > 0) {
          const rows = parcelas.map((p) => ({ ...p, despesa_id: despesaId }));
          const { error: pErr } = await (supabase as any).from("malote_despesa_parcela").insert(rows);
          if (pErr) throw pErr;
        }
      }

      return despesaId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export function useExcluirDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_despesa").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// ── Histórico / timeline ("Fluxo de Aprovação") ─────────────────────────
export function useDespesaEventos(despesaId: string | undefined) {
  return useQuery({
    queryKey: [DESPESA_KEY, despesaId, "eventos"],
    enabled: !!despesaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_despesa_evento")
        .select("*")
        .eq("despesa_id", despesaId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as DespesaEvento[];
    },
  });
}

// Exportada pra qualquer tela poder logar uma edição no histórico (ex:
// SolicitacaoModal salvando alterações da solicitação) — "toda alteração
// deve ficar registrada em histórico", SIS-2026-0104.
export async function registrarEventoDespesa(despesaId: string, tipo_evento: TipoEvento, descricao?: string | null, nivel?: 1 | 2 | 3 | null) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await (supabase as any)
    .from("malote_despesa_evento")
    .insert({ despesa_id: despesaId, tipo_evento, descricao: descricao ?? null, nivel: nivel ?? null, ator_user_id: u.user?.id ?? null });
  if (error) throw error;
}

// Cancelar despesa/solicitação — disponível em qualquer status ativo,
// conforme parecer do chefe (SIS-2026-0104).
export function useCancelarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo?: string }) => {
      const { error } = await (supabase as any).from("malote_despesa").update({ status: "cancelada" }).eq("id", id);
      if (error) throw error;
      await registrarEventoDespesa(id, "cancelamento", motivo ?? null);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// "Mandar para aprovação novamente" — salva as edições e reinicia o
// fluxo em N1, disponível em qualquer status ativo (não existe "salvar
// sem reenviar" — parecer do chefe, SIS-2026-0104).
export function useMandarParaAprovacaoNovamente() {
  const qc = useQueryClient();
  const salvar = useSalvarDespesa();
  return useMutation({
    mutationFn: async (input: SalvarDespesaInput) => {
      const despesaId = await salvar.mutateAsync({
        ...input,
        status: "pendente_aprovacao",
      });
      await (supabase as any).from("malote_despesa").update({ nivel_aprovacao_atual: 1, motivo_ajuste: null }).eq("id", despesaId);
      await registrarEventoDespesa(despesaId, "reenvio_aprovacao", null, 1);
      return despesaId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// Converte uma solicitação já cotada e aprovada (status='cotacao_aprovada',
// escrito pelo módulo de Suprimentos direto na malote_despesa) numa Despesa
// de verdade: preenche os campos de despesa (pagamento/rateio/parcelas) na
// MESMA linha (origem continua 'solicitacao') e entra no fluxo de
// aprovação N1/N2/N3, que é 100% nosso a partir daqui — SIS-2026-0104.
export function useConverterSolicitacaoEmDespesa() {
  const qc = useQueryClient();
  const salvar = useSalvarDespesa();
  return useMutation({
    mutationFn: async (input: SalvarDespesaInput) => {
      const despesaId = await salvar.mutateAsync({
        ...input,
        status: "pendente_aprovacao",
      });
      await (supabase as any).from("malote_despesa").update({ nivel_aprovacao_atual: 1 }).eq("id", despesaId);
      await registrarEventoDespesa(despesaId, "despesa_criada", "Despesa criada a partir da solicitação aprovada.");
      return despesaId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// ── Upload de anexos ─────────────────────────────────────────────────
export async function uploadAnexoMalote(file: File, despesaFolderId: string): Promise<string> {
  const ext = file.name.split(".").pop();
  const path = `${despesaFolderId}/${novoUuid()}.${ext}`;
  const { error } = await supabase.storage.from("malote-anexos").upload(path, file);
  if (error) throw error;
  return path;
}

/** Gera N parcelas iguais (a última absorve o resto de arredondamento). */
export function gerarParcelas(valorTotal: number, numeroParcelas: number, dataPagamento: string, diaDesconto: number | null): Parcela[] {
  if (numeroParcelas <= 0) return [];
  const valorParcela = Math.floor((valorTotal / numeroParcelas) * 100) / 100;
  const somaParcelas = valorParcela * (numeroParcelas - 1);
  const ultimaParcela = Math.round((valorTotal - somaParcelas) * 100) / 100;

  const base = new Date(dataPagamento + "T00:00:00");
  const parcelas: Parcela[] = [];
  for (let i = 0; i < numeroParcelas; i++) {
    const venc = new Date(base.getFullYear(), base.getMonth() + i, diaDesconto ?? base.getDate());
    parcelas.push({
      numero_parcela: i + 1,
      valor: i === numeroParcelas - 1 ? ultimaParcela : valorParcela,
      data_vencimento: venc.toISOString().slice(0, 10),
    });
  }
  return parcelas;
}
