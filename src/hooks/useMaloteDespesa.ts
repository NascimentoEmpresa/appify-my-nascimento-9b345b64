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
  // SIS-2026-0212 (complemento): "congela" Orçado/Utilizado no momento do
  // pagamento (malote_pagar_despesa) — sem isso, o Orçado/Utilizado exibido
  // recalculava pra sempre contra despesas lançadas depois, e uma despesa
  // já paga passava a aparecer "fora do orçado" por causa de lançamentos
  // que nem existiam quando ela foi paga. congelado_em != null decide se a
  // tela usa o snapshot em vez de recalcular ao vivo.
  orcado_snapshot?: number | null;
  utilizado_com_lancamento_snapshot?: number | null;
  congelado_em?: string | null;
}

export type StatusParcela = "pendente" | "paga";

export interface Parcela {
  id: string;
  despesa_id: string;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  // SIS-2026-0223: pagamento passou a ser por parcela — cada uma tem seu
  // próprio comprovante/data real, independente das demais.
  status: StatusParcela;
  comprovante_pagamento_path: string | null;
  observacao_pagamento: string | null;
  data_pagamento_real: string | null;
  pago_em: string | null;
  pago_por: string | null;
}

// O que gerarParcelas monta na criação/edição, antes de existir linha no
// banco (sem id/despesa_id/campos de pagamento, que só existem depois do
// insert e do fluxo de pagamento por parcela).
export type NovaParcela = Pick<Parcela, "numero_parcela" | "valor" | "data_vencimento">;

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
  justificativa_excecao: string | null;
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

// SIS-2026-0223: item de UI em Aprovações/Meus Itens/Pagamento do Malote —
// despesa parcelada "explode" em N linhas (1 por parcela); despesa normal
// (ou parcelada ainda em aprovação, sem parcela pra decidir) é 1 linha só.
export interface ItemLinhaMalote {
  despesa: MaloteDespesaRow;
  parcela: Parcela | null;
}

// Só a partir daqui a despesa tem pagamento de verdade pra rastrear por
// parcela — antes disso (ainda em aprovação) continua sendo 1 despesa só,
// porque aprovar é sempre uma decisão única sobre a despesa inteira.
export const STATUS_COM_PARCELA_VISIVEL: StatusDespesa[] = [
  "aguardando_pagamento",
  "pronto_para_pagar",
  "ajuste_pagamento",
  "despesa_paga",
];

export function explodirParcelas(despesas: MaloteDespesaRow[], parcelasPorDespesa: Map<string, Parcela[]>): ItemLinhaMalote[] {
  const linhas: ItemLinhaMalote[] = [];
  for (const d of despesas) {
    const parcelas = d.parcelado ? parcelasPorDespesa.get(d.id) ?? [] : [];
    if (d.parcelado && parcelas.length > 0 && STATUS_COM_PARCELA_VISIVEL.includes(d.status)) {
      for (const p of parcelas) linhas.push({ despesa: d, parcela: p });
    } else {
      linhas.push({ despesa: d, parcela: null });
    }
  }
  return linhas;
}

async function buscarParcelasPorDespesa(despesas: MaloteDespesaRow[]): Promise<Map<string, Parcela[]>> {
  const ids = despesas.filter((d) => d.parcelado).map((d) => d.id);
  const mapa = new Map<string, Parcela[]>();
  if (ids.length === 0) return mapa;
  const { data, error } = await (supabase as any)
    .from("malote_despesa_parcela")
    .select("*")
    .in("despesa_id", ids)
    .order("numero_parcela");
  if (error) throw error;
  for (const p of (data ?? []) as Parcela[]) {
    const lst = mapa.get(p.despesa_id) ?? [];
    lst.push(p);
    mapa.set(p.despesa_id, lst);
  }
  return mapa;
}

const DESPESA_COLUMNS =
  "id, numero, empresa_id, classificacao_id, origem, status, nome, valor_total, motivo, descricao, links, tipo_movimento, tipo, contrato_id, " +
  "data_pagamento, competencia, forma_pagamento, informacoes_pagamento, parcelado, numero_parcelas, dia_desconto, " +
  "nivel_aprovacao_atual, valor_aprovado_cotacao, valor_aprovado, justificativa_aprovacao, motivo_ajuste, excecao, justificativa_excecao, " +
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

// Setores liberados para um usuário em Aprovações/Meus Itens do Malote
// (SIS-2026-0216, Gerenciamento de Acesso). Lista vazia = sem recorte = vê
// tudo da empresa (default, mesmo comportamento de antes desta feature).
export function useMaloteSetoresVisiveis(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["malote_setor_visivel_usuario", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_setor_visivel_usuario")
        .select("setor")
        .eq("user_id", userId)
        .order("setor");
      if (error) throw error;
      return (data ?? []).map((r: any) => r.setor as string);
    },
  });
}

export function useMinhasDespesas() {
  return useQuery({
    queryKey: [DESPESA_KEY, "minhas"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];

      // SIS-2026-0216: além do que a pessoa criou, ela pode ter setores
      // liberados em Gerenciamento de Acesso (mesma lista usada em
      // Aprovações do Malote — malote_setor_visivel_usuario). Sem nenhum
      // setor configurado, mantém o comportamento anterior (só o que ela
      // criou); a RLS de malote_despesa já impõe o resto da regra (mesma
      // empresa) — aqui é só montar o filtro pra ele aparecer.
      const { data: setoresRows, error: setoresErr } = await (supabase as any)
        .from("malote_setor_visivel_usuario")
        .select("setor")
        .eq("user_id", u.user.id);
      if (setoresErr) throw setoresErr;
      const setores = (setoresRows ?? []).map((r: any) => r.setor as string);

      let query = (supabase as any)
        .from("malote_despesa")
        .select(DESPESA_COLUMNS)
        .order("created_at", { ascending: false });

      if (setores.length === 0) {
        query = query.eq("created_by", u.user.id);
      } else {
        const { data: classRows, error: classErr } = await (supabase as any)
          .from("planejamento_orcamentario_classificacao")
          .select("id")
          .in("setor_responsavel", setores);
        if (classErr) throw classErr;
        const classIds = (classRows ?? []).map((r: any) => r.id as string);

        const orParts = [`created_by.eq.${u.user.id}`];
        if (classIds.length > 0) orParts.push(`classificacao_id.in.(${classIds.join(",")})`);
        query = query.or(orParts.join(","));
      }

      const { data, error } = await query;
      if (error) throw error;
      const despesas = (data ?? []) as MaloteDespesaRow[];
      const parcelasPorDespesa = await buscarParcelasPorDespesa(despesas);
      return explodirParcelas(despesas, parcelasPorDespesa);
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

/**
 * Um item pedido na solicitação de compra (SIS-2026-0207).
 *
 * `sup_item_id` nulo é item FORA do catálogo — acontece e é previsto:
 * "sei lá, surgiu um tapete lá na licitação, nunca comprei um tapete".
 * `nome_item` é o que a tela mostra nos dois casos, e é snapshot: o catálogo
 * pode ser renomeado, a solicitação não muda.
 */
export interface ItemSolicitacao {
  id?: string;
  sup_item_id?: string | null;
  nome_item: string;
  tipo_item?: string | null;
  quantidade: number;
  unidade: string;
  tamanho?: string | null;
  observacao?: string | null;
  valor_unitario?: number | null;
  ordem?: number;
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
  // NovaParcela veio do SIS-2026-0223 (pagamento por parcela); itens, do
  // SIS-2026-0207. As duas coisas convivem.
  parcelas?: NovaParcela[];
  /** Itens pedidos na solicitação (SIS-2026-0207). */
  itens?: ItemSolicitacao[];
  nivel_aprovacao_atual?: 1 | 2 | 3 | null;
  // SIS-2026-0211: marca a despesa como exceção — passa por cima do
  // bloqueio de dia (data_pagamento em dia bloqueado), só pra ela.
  excecao?: boolean;
  justificativa_excecao?: string | null;
}

export function useSalvarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarDespesaInput) => {
      const { rateio, parcelas, itens, id: despesaIdInput, ...despesaFields } = input;
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

      // Mesma estratégia do rateio: apaga e regrava. A lista é pequena e
      // pertence inteira à solicitação, então reconciliar linha a linha só
      // traria complexidade sem ganho (SIS-2026-0207).
      if (itens) {
        await (supabase as any).from("malote_despesa_item").delete().eq("despesa_id", despesaId);
        if (itens.length > 0) {
          const rows = itens.map(({ id: _id, ...i }, ordem) => ({ ...i, despesa_id: despesaId, ordem }));
          const { error: iErr } = await (supabase as any).from("malote_despesa_item").insert(rows);
          if (iErr) throw iErr;
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

/**
 * Itens de uma solicitação (SIS-2026-0207).
 *
 * Usado dos dois lados: pelo solicitante, que monta a lista, e pelo comprador,
 * que precisa vê-la para cotar. A policy de SELECT inclui `sup_cotacoes_malote`
 * justamente por causa do segundo caso.
 */
export function useItensDaDespesa(despesaId: string | undefined) {
  return useQuery({
    queryKey: [DESPESA_KEY, despesaId, "itens"],
    enabled: !!despesaId,
    queryFn: async (): Promise<ItemSolicitacao[]> => {
      const { data, error } = await (supabase as any)
        .from("malote_despesa_item")
        .select("id, sup_item_id, nome_item, tipo_item, quantidade, unidade, tamanho, observacao, valor_unitario, ordem")
        .eq("despesa_id", despesaId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, quantidade: Number(r.quantidade ?? 0) }));
    },
  });
}

/** Soma dos itens precificados — o total sugerido para a cotação. */
export function totalDosItens(itens: ItemSolicitacao[]): number {
  return itens.reduce((s, i) => s + Number(i.valor_unitario ?? 0) * Number(i.quantidade ?? 0), 0);
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
    // SIS-2026-0211 (complemento, pedido do Iury): "descricaoEvento" é um
    // resumo do que mudou (rateio, forma de pagamento, etc.), calculado pelo
    // chamador antes de reenviar — vai só pro histórico, nunca pra
    // malote_despesa (por isso é destructured fora do resto do input, que
    // vira despesaFields no useSalvarDespesa).
    mutationFn: async (input: SalvarDespesaInput & { descricaoEvento?: string | null }) => {
      const { descricaoEvento, ...resto } = input;
      const despesaId = await salvar.mutateAsync({
        ...resto,
        status: "pendente_aprovacao",
      });
      await (supabase as any).from("malote_despesa").update({ nivel_aprovacao_atual: 1, motivo_ajuste: null }).eq("id", despesaId);
      await registrarEventoDespesa(despesaId, "reenvio_aprovacao", descricaoEvento ?? null, 1);
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
/**
 * Nº legível da despesa (DM-2026-0026). É o banco que gera no insert, e o
 * `useSalvarDespesa` devolve só o id — mudar o retorno dele mexeria em todos
 * os chamadores, então quem precisa do número o busca por aqui.
 */
export async function buscarNumeroDespesa(id: string): Promise<string | null> {
  if (!id) return null;
  const { data } = await (supabase as any)
    .from("malote_despesa").select("numero").eq("id", id).maybeSingle();
  return (data?.numero as string | undefined) ?? null;
}

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
  // SIS-2026-0212 (complemento): Orçado/Utilizado calculados no client no
  // momento da aprovação — o RPC só congela quando a despesa realmente sai
  // do fluxo (não escala pro próximo nível).
  rateio_snapshot?: { linha_id: string; orcado: number | null; utilizado_com_lancamento: number | null }[];
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
        _rateio_snapshot: input.rateio_snapshot ?? [],
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
  // SIS-2026-0212 (complemento): Orçado/Utilizado calculados no client no
  // momento do pagamento (mesma lógica de useOrcadoClassificacao/
  // RateioAprovadorTable), gravados por linha via malote_pagar_despesa —
  // só registro histórico, não é dado de segurança.
  rateio_snapshot?: { linha_id: string; orcado: number | null; utilizado_com_lancamento: number | null }[];
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
        _rateio_snapshot: input.rateio_snapshot ?? [],
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// SIS-2026-0223: despesa parcelada é paga parcela por parcela, cada uma com
// seu próprio comprovante/data — malote_pagar_despesa (acima) continua
// servindo só despesa não-parcelada.
export interface PagarParcelaInput {
  despesaId: string;
  parcelaId: string;
  data_pagamento: string;
  comprovante_path: string;
  observacao: string | null;
  rateio_snapshot?: { linha_id: string; orcado: number | null; utilizado_com_lancamento: number | null }[];
}

export function usePagarParcela() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PagarParcelaInput) => {
      const { error } = await (supabase as any).rpc("malote_pagar_parcela", {
        _despesa_id: input.despesaId,
        _parcela_id: input.parcelaId,
        _data_pagamento: input.data_pagamento,
        _comprovante_path: input.comprovante_path,
        _observacao: input.observacao,
        _rateio_snapshot: input.rateio_snapshot ?? [],
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
      const despesas = (data ?? []) as MaloteDespesaRow[];
      const parcelasPorDespesa = await buscarParcelasPorDespesa(despesas);
      return explodirParcelas(despesas, parcelasPorDespesa);
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
export function gerarParcelas(valorTotal: number, numeroParcelas: number, dataPagamento: string, diaDesconto: number | null): NovaParcela[] {
  if (numeroParcelas <= 0) return [];
  const valorParcela = Math.floor((valorTotal / numeroParcelas) * 100) / 100;
  const somaParcelas = valorParcela * (numeroParcelas - 1);
  const ultimaParcela = Math.round((valorTotal - somaParcelas) * 100) / 100;

  const base = new Date(dataPagamento + "T00:00:00");
  const parcelas: NovaParcela[] = [];
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
