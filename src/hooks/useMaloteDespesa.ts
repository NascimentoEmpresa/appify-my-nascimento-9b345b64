import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { novoUuid } from "@/lib/utils";

export type OrigemDespesa = "solicitacao" | "despesa_unica" | "despesa_multi_classificacao";
export type StatusDespesa =
  | "rascunho"
  | "aguardando_aprovacao_inicial"
  | "aguardando_cotacao"
  | "cotacao_realizada"
  | "cotacao_aprovada"
  | "solicitacao_reprovada"
  | "pendente_aprovacao"
  | "necessidade_de_ajuste"
  | "aguardando_pagamento"
  | "pronto_para_pagar"
  | "ajuste_pagamento"
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
  | "conferido_pagamento"
  | "ajuste_pagamento_solicitado"
  | "despesa_paga"
  | "despesa_reprovada"
  | "cancelamento";

// Status ainda dentro da fase "Solicitação" — item abre em modal.
// A partir daqui em diante (pendente_aprovacao em diante) o item já é
// tratado como Despesa e abre na tela cheia de visualização.
export const STATUS_FASE_SOLICITACAO: StatusDespesa[] = [
  "rascunho",
  "aguardando_aprovacao_inicial",
  "aguardando_cotacao",
  "cotacao_realizada",
  "solicitacao_reprovada",
];

// Solicitação já cotada e aprovada (evento que vem de fora, do módulo de
// Suprimentos, que escreve direto na malote_despesa) — fica parada aqui até
// o usuário clicar e ir converter em despesa na tela Criar Despesa.
export const STATUS_COTACAO_APROVADA: StatusDespesa[] = ["cotacao_aprovada"];

export const STATUS_TERMINAIS: StatusDespesa[] = ["despesa_paga", "despesa_reprovada", "solicitacao_reprovada", "cancelada"];

export const STATUS_LABEL: Record<StatusDespesa, string> = {
  rascunho: "Rascunho",
  aguardando_aprovacao_inicial: "Aguardando aprovação inicial",
  aguardando_cotacao: "Aguardando cotação",
  cotacao_realizada: "Cotação realizada",
  cotacao_aprovada: "Cotação aprovada",
  solicitacao_reprovada: "Solicitação reprovada",
  pendente_aprovacao: "Pendente aprovação",
  necessidade_de_ajuste: "Necessita de ajuste",
  aguardando_pagamento: "Aguardando pagamento",
  pronto_para_pagar: "Pronto para pagar (conferido)",
  ajuste_pagamento: "Necessita de ajuste (pagamento)",
  despesa_paga: "Despesa paga",
  despesa_reprovada: "Despesa reprovada",
  cancelada: "Cancelada",
};

export const STATUS_BADGE_CLASS: Record<StatusDespesa, string> = {
  rascunho: "bg-muted text-muted-foreground",
  aguardando_aprovacao_inicial: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  aguardando_cotacao: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  cotacao_realizada: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  cotacao_aprovada: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  solicitacao_reprovada: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  pendente_aprovacao: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  necessidade_de_ajuste: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  aguardando_pagamento: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  pronto_para_pagar: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  ajuste_pagamento: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
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
  // SIS-2026-0192: justificativa por linha, quando o % dela sobre o
  // Orçado passa do limite_justificativa_pct da Classificação.
  justificativa_texto?: string | null;
  justificativa_por?: string | null;
  justificativa_em?: string | null;
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
  // ── Cotação (SIS-2026-0112, Suprimentos escreve via RPCs sup_malote_*) ──
  cot1_fornecedor: string | null;
  cot1_valor: number | null;
  cot1_prazo: string | null;
  cot1_link: string | null;
  cot1_anexo_path: string | null;
  cot1_anexo_nome: string | null;
  cot2_fornecedor: string | null;
  cot2_valor: number | null;
  cot2_prazo: string | null;
  cot2_link: string | null;
  cot2_anexo_path: string | null;
  cot2_anexo_nome: string | null;
  cot3_fornecedor: string | null;
  cot3_valor: number | null;
  cot3_prazo: string | null;
  cot3_link: string | null;
  cot3_anexo_path: string | null;
  cot3_anexo_nome: string | null;
  cotacao_enviada_em: string | null;
  cotacao_enviada_por: string | null;
  cotacao_enviada_por_nome: string | null;
  cotacao_decidida_em: string | null;
  cotacao_decidida_por: string | null;
  cotacao_decidida_por_nome: string | null;
  cotacao_reprovada_motivo: string | null;
  cotacao_observacoes: string | null;
  cotacao_vencedor_num: 1 | 2 | 3 | null;
  // ── Pagamento Malote (SIS-2026-0160) ──
  comprovante_pagamento_path: string | null;
  observacao_pagamento: string | null;
  pago_em: string | null;
  pago_por: string | null;
  conferido_em: string | null;
  conferido_por: string | null;
  arquivos: string[];
  created_at: string;
  created_by: string;
  updated_at: string;
  classificacao?: {
    id: string;
    nome: string;
    aprovador1_nome?: string | null;
    aprovador2_nome?: string | null;
    aprovador3_nome?: string | null;
    aprovador1_user_id?: string | null;
    aprovador2_user_id?: string | null;
    aprovador3_user_id?: string | null;
    // Alçada por nível (SIS-2026-0132, antes cadastrada mas nunca
    // consumida) — sem_limite=true dispensa a checagem de %; limite_pct
    // null (e sem_limite=false) é tratado como "sem trava configurada"
    // pra não quebrar classificações que nunca preencheram esse campo.
    aprovador1_limite_pct?: number | null;
    aprovador1_sem_limite?: boolean;
    aprovador2_limite_pct?: number | null;
    aprovador2_sem_limite?: boolean;
    aprovador3_limite_pct?: number | null;
    aprovador3_sem_limite?: boolean;
    // Aprovador da Solicitação (SIS-2026-0106) é um cargo diferente do
    // aprovador1/2/3 da Despesa — gate único da fase de Solicitação
    // (aguardando_aprovacao_inicial/aguardando_cotacao/cotacao_realizada).
    aprovador_solicitacao_user_id?: string | null;
    aprovador_solicitacao_nome?: string | null;
    // SIS-2026-0192: % acima do qual uma linha de rateio precisa de
    // justificativa (cadastrado desde SIS-2026-0106, só passa a ser
    // exibido aqui — sem null tratado como "nunca pede justificativa").
    limite_justificativa_pct?: number | null;
  } | null;
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
  "cot1_fornecedor, cot1_valor, cot1_prazo, cot1_link, cot1_anexo_path, cot1_anexo_nome, " +
  "cot2_fornecedor, cot2_valor, cot2_prazo, cot2_link, cot2_anexo_path, cot2_anexo_nome, " +
  "cot3_fornecedor, cot3_valor, cot3_prazo, cot3_link, cot3_anexo_path, cot3_anexo_nome, " +
  "cotacao_enviada_em, cotacao_enviada_por, cotacao_enviada_por_nome, cotacao_decidida_em, cotacao_decidida_por, cotacao_decidida_por_nome, " +
  "cotacao_reprovada_motivo, cotacao_observacoes, cotacao_vencedor_num, " +
  "comprovante_pagamento_path, observacao_pagamento, pago_em, pago_por, conferido_em, conferido_por, " +
  "arquivos, created_at, created_by, updated_at, " +
  "classificacao:classificacao_id(id, nome, aprovador1_nome, aprovador2_nome, aprovador3_nome, aprovador1_user_id, aprovador2_user_id, aprovador3_user_id, " +
  "aprovador1_limite_pct, aprovador1_sem_limite, aprovador2_limite_pct, aprovador2_sem_limite, aprovador3_limite_pct, aprovador3_sem_limite, " +
  "aprovador_solicitacao_user_id, aprovador_solicitacao_nome, limite_justificativa_pct)";

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
  nivel_aprovacao_atual?: 1 | 2 | 3 | null;
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

// SIS-2026-0194: exclusão PERMANENTE (não é cancelamento) — usada só pra
// limpar dados de teste, restrita ao Administrador Geral via
// gerenciamento de acesso (ação "excluir" em malote_despesa_visualizar/
// malote_solicitacao_visualizar). RPC valida a permissão de novo no
// banco — a checagem de `can()` no client é só heurística de UI.
export function useExcluirPermanentemente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("malote_excluir_permanentemente", { _id: id });
      if (error) throw error;
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

// ── Fluxo de aprovação da despesa (N1/N2/N3, ajuste, reprovação) ────────
// SIS-2026-0132 Fase 1.
export function aprovadorDoNivel(despesa: MaloteDespesaRow, nivel: 1 | 2 | 3): string | null {
  const c = despesa.classificacao;
  if (!c) return null;
  if (nivel === 1) return c.aprovador1_user_id ?? null;
  if (nivel === 2) return c.aprovador2_user_id ?? null;
  return c.aprovador3_user_id ?? null;
}

export function souAprovadorConfigurado(despesa: MaloteDespesaRow, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return ([1, 2, 3] as const).some((n) => aprovadorDoNivel(despesa, n) === userId);
}

// SIS-2026-0189: fase de Solicitação (aguardando_aprovacao_inicial/
// aguardando_cotacao/cotacao_realizada) é gate do "Aprovador da
// solicitação" (aprovador_solicitacao_user_id) — um cargo à parte do
// aprovador1/2/3 da Despesa, cadastrado desde SIS-2026-0106 mas nunca
// consumido: a UI/RPC estavam checando souAprovadorConfigurado (despesa)
// por engano, então só funcionava quando a mesma pessoa também era
// aprovador1.
export function souAprovadorSolicitacao(despesa: MaloteDespesaRow, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return despesa.classificacao?.aprovador_solicitacao_user_id === userId;
}

// Reaproveita a função Postgres já usada pelo RLS do Malote (piloto por
// cargo, SIS-2026-0117-ish) em vez de duplicar a regra de cargo em JS.
export function useSouSupervisorMalote() {
  return useQuery({
    queryKey: ["malote_supervisor_por_cargo"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data, error } = await (supabase as any).rpc("malote_supervisor_por_cargo", { _user_id: u.user.id });
      if (error) throw error;
      return !!data;
    },
  });
}

export interface AprovarDespesaInput {
  id: string;
  nivelAtual: 1 | 2 | 3;
  // Se o próximo nível tem aprovador cadastrado na Classificação — decide se
  // avança pra N+1 (continua pendente_aprovacao) ou fecha o ciclo de
  // aprovação (vira aguardando_pagamento). Calculado pelo chamador, que já
  // tem a classificação carregada via useDespesa.
  proximoNivelConfigurado: boolean;
  valor_aprovado: number;
  justificativa_aprovacao: string | null;
  forma_pagamento: string;
  informacoes_pagamento: string;
  data_pagamento: string;
  competencia: string; // "YYYY-MM"
}

// Todas as mutations abaixo (aprovar/ajustar/reprovar despesa, aprovação
// inicial da solicitação) passam por RPC SECURITY DEFINER
// (20260906000002_malote_permissoes_aprovacao.sql) em vez de UPDATE direto
// — a RLS de malote_despesa só libera pro criador (e só em rascunho) ou
// admin/supervisor por cargo, então um aprovador comum configurado na
// Classificação nunca conseguia agir de fato. A RPC checa malote_pode()
// (elegibilidade geral, vem do gerenciamento de acesso) E o aprovador da
// linha específica, e já registra o evento por dentro.
export function useAprovarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AprovarDespesaInput) => {
      const { error } = await (supabase as any).rpc("malote_aprovar_despesa", {
        _id: input.id,
        _proximo_nivel_configurado: input.proximoNivelConfigurado,
        _valor_aprovado: input.valor_aprovado,
        _justificativa: input.justificativa_aprovacao,
        _forma_pagamento: input.forma_pagamento,
        _informacoes_pagamento: input.informacoes_pagamento,
        _data_pagamento: input.data_pagamento,
        _competencia: input.competencia + "-01",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export function useSolicitarAjusteDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await (supabase as any).rpc("malote_solicitar_ajuste_despesa", { _id: id, _motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export function useReprovarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await (supabase as any).rpc("malote_reprovar_despesa", { _id: id, _motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// SIS-2026-0192: justificativa por linha de Rateio, quando o % dela sobre
// o Orçado passa do limite_justificativa_pct da Classificação.
export function useJustificarRateioLinha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ linhaId, texto }: { linhaId: string; texto: string }) => {
      const { error } = await (supabase as any).rpc("malote_justificar_rateio_linha", { _linha_id: linhaId, _texto: texto });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// ── Pagamento Malote (SIS-2026-0160) ─────────────────────────────────────
// Elegibilidade geral pra agir no Pagamento Malote — resolvida só pelo
// gerenciamento de acesso central (menu 'malote_pagamento'), nunca por
// cargo hardcoded. Usada só pra gating de UI (defesa em profundidade
// continua nas RPCs, que checam de novo).
export function usePodePagarMalote() {
  return useQuery({
    queryKey: [DESPESA_KEY, "pode_pagar_malote"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("malote_pode_pagar");
      if (error) throw error;
      return data === true;
    },
  });
}

export function useMarcarConferidoDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("malote_marcar_conferido_despesa", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export function useSolicitarAjustePagamentoDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await (supabase as any).rpc("malote_solicitar_ajuste_pagamento_despesa", { _id: id, _motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export interface PagarDespesaInput {
  id: string;
  data_pagamento: string;
  comprovante_path: string;
  observacao: string | null;
}

export function usePagarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PagarDespesaInput) => {
      const { error } = await (supabase as any).rpc("malote_pagar_despesa", {
        _id: input.id,
        _data_pagamento: input.data_pagamento,
        _comprovante_path: input.comprovante_path,
        _observacao: input.observacao,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// ── Aprovação Inicial da Solicitação (SIS-2026-0132 Fase 2) ─────────────
// Gate único (não sequencial como N1/N2/N3 da despesa): qualquer um dos 3
// aprovadores configurados na Classificação Malote pode aprovar/reprovar.
export function useAprovarSolicitacaoInicial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("malote_aprovar_solicitacao_inicial", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export function useReprovarSolicitacaoInicial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await (supabase as any).rpc("malote_reprovar_solicitacao_inicial", { _id: id, _motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// ── Cotações de fornecedor — decisão do Malote (SIS-2026-0132) ──────────
// Digitar/enviar as cotações é do Suprimentos (SIS-2026-0112, RPCs
// sup_malote_* em useMaloteCotacao.ts). Escolher a vencedora / reprovar a
// solicitação continua sendo do Malote, por isso essas duas mutations
// seguem aqui.
export function useAprovarCotacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, numero, valor }: { id: string; numero: 1 | 2 | 3; valor: number }) => {
      const { error } = await (supabase as any).rpc("malote_aprovar_cotacao", { _id: id, _numero: numero, _valor: valor });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export function useReprovarCotacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await (supabase as any).rpc("malote_reprovar_cotacao", { _id: id, _motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export interface ItemAguardandoAprovacao {
  despesa: MaloteDespesaRow;
  tela: "solicitacao" | "despesa";
}

// Lista mínima pra qualquer aprovador achar o que precisa agir — sem os
// filtros/contadores do dashboard completo (Fase 3). Busca os status
// relevantes e filtra em JS por aprovador (volume baixo nesta base).
export function useItensAguardandoMinhaAprovacao() {
  return useQuery({
    queryKey: [DESPESA_KEY, "aguardando_minha_aprovacao"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await (supabase as any)
        .from("malote_despesa")
        .select(DESPESA_COLUMNS)
        .in("status", ["aguardando_aprovacao_inicial", "aguardando_cotacao", "cotacao_realizada", "pendente_aprovacao"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      const despesas = (data ?? []) as MaloteDespesaRow[];
      const resultado: ItemAguardandoAprovacao[] = [];
      for (const despesa of despesas) {
        if (despesa.status === "aguardando_aprovacao_inicial" || despesa.status === "aguardando_cotacao" || despesa.status === "cotacao_realizada") {
          // aguardando_cotacao: nada pra aprovar ainda (esperando o
          // Suprimentos cotar), mas o aprovador continua com a opção de
          // reprovar — por isso o item precisa continuar visível aqui.
          // cotacao_realizada: aprovador precisa escolher qual cotação.
          if (souAprovadorSolicitacao(despesa, u.user.id)) resultado.push({ despesa, tela: "solicitacao" });
        } else if (despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual != null) {
          if (aprovadorDoNivel(despesa, despesa.nivel_aprovacao_atual) === u.user.id) resultado.push({ despesa, tela: "despesa" });
        }
      }
      return resultado;
    },
  });
}

// Lista ampla pro dashboard "Aprovações do Malote" (Fase 3, aproximada) —
// sem filtro por created_by, a RLS de malote_despesa já restringe ao que
// o usuário pode ver (dono, mesma empresa, supervisor por cargo, admin).
export function useItensAprovacoesMalote() {
  return useQuery({
    queryKey: [DESPESA_KEY, "aprovacoes_malote"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_despesa")
        .select(DESPESA_COLUMNS)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaloteDespesaRow[];
    },
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
