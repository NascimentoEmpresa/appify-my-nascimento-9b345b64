// BASE MESTRE DE INÍCIO DE CONTRATO — SIS-2026-0599.
//
// Seis telas (a base mestre, o hub e os quatro recortes setoriais) leem daqui.
// Nenhuma delas calcula nada no cliente: os números vêm das RPCs criadas na
// migration 20261015000001, que já aplicam o gate de acesso por menu.
//
// POR QUE NÃO É "AO VIVO": a tela abre lendo o que está gravado em
// IMPLANTACAO_BASE_*, e só o botão "Atualizar da base" (semear) repuxa de
// contratos / planilha_custo / sup_posto / sup_funcao_item. A instância do
// Supabase é Small e já caiu três vezes por CPU, conexão e memória
// (23/09/2026) — recalcular agregado a cada abertura de tela era custo
// recorrente sem ninguém pedindo. Decidido com o Eduardo em 15/10/2026.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// As RPCs e as tabelas "IMPLANTACAO_BASE_*" não estão no types.ts gerado pelo
// Lovable — mesmo caminho já usado em useContratoQuadro.ts.
const sb = supabase as unknown as {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (t: string) => any;
};

export interface ResumoBase {
  base_id: string;
  contrato_nome: string | null;
  cliente: string | null;
  cnpj_contratante: string | null;
  objeto: string | null;
  valor_mensal: number | null;
  qt_postos: number;
  qt_colaboradores: number;
  qt_locais: number;
  qt_cidades: number;
  qt_tipos_servico: number;
  qt_itens_uniforme: number;
  qt_itens_material: number;
  qt_prazos: number;
  qt_documentos: number;
  qt_reunioes: number;
  situacao: string;
  sincronizado_em: string | null;
}

/**
 * Reunião de implantação ligada ao contrato. O vínculo é escolhido por gente:
 * as reuniões não guardam contrato_id — o que as amarra hoje é o nome do
 * contrato escrito no título, e casar por texto erraria calado.
 */
export interface ReuniaoDaBase {
  vinculo_id: string;
  reuniao_id: string;
  numero: string | null;
  titulo: string | null;
  data_hora: string | null;
  etapa: string | null;
  tipo_reuniao: string | null;
  duracao_minutos: number | null;
  qt_pauta: number;
  qt_decisoes: number;
  qt_acoes: number;
  qt_acoes_pendentes: number;
  qt_participantes: number;
  tem_ata: boolean;
  observacao: string | null;
}

export interface ReuniaoCandidata {
  reuniao_id: string;
  numero: string | null;
  titulo: string | null;
  data_hora: string | null;
  etapa: string | null;
  sugerida: boolean;
}

export interface LinhaFinanceiro {
  posto: string;
  valor_posto: number | null;
  qt_postos: number;
  valor_mensal_postos: number | null;
  faixa_custo: "alta" | "media" | "baixa";
  participacao: number | null;
  cidade: string | null;
}

export interface LinhaRh {
  tipo_servico: string;
  cbo: string | null;
  carga_horaria: string | null;
  escala: string | null;
  salario_base: number | null;
  total_remuneracao: number | null;
  qt_postos: number;
  qt_funcionarios: number;
  sindicato: string | null;
  vt_dia: number | null;
  va_dia: string | null;
}

export interface LinhaOperacional {
  local_nome: string;
  cidade: string | null;
  endereco: string | null;
  posto: string | null;
  qt_postos: number;
  qt_funcionarios: number;
}

export interface LinhaCompras {
  cargo: string;
  descricao: string;
  tipo: string;
  categoria: string | null;
  quantidade: number;
  prioridade: "alta" | "media" | "baixa";
  status: string;
  no_catalogo: boolean;
}

export interface ContratoOpcao {
  id: string;
  nome: string;
  cliente: string | null;
}

/** Contratos que podem receber uma base mestre (o seletor do topo das telas). */
export function useContratosDaBase() {
  return useQuery({
    queryKey: ["implantacao-base", "contratos"],
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<ContratoOpcao[]> => {
      const { data, error } = await sb
        .from("contratos")
        .select("id, nome, cliente")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ContratoOpcao[];
    },
  });
}

function useRecorte<T>(rpc: string, contratoId: string | null, chave: string) {
  return useQuery({
    queryKey: ["implantacao-base", chave, contratoId],
    enabled: !!contratoId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await sb.rpc(rpc, { p_contrato_id: contratoId });
      if (error) throw new Error(error.message);
      return (data ?? []) as T[];
    },
  });
}

/**
 * Resumo do contrato. Lista vazia aqui não é erro de tela: ou a base ainda
 * não foi semeada, ou a RLS negou — RLS negada devolve vazio, não erro.
 */
export function useResumoBase(contratoId: string | null) {
  const q = useRecorte<ResumoBase>("implantacao_base_resumo", contratoId, "resumo");
  return { ...q, data: q.data?.[0] ?? null };
}

export const useFinanceiroBase   = (id: string | null) => useRecorte<LinhaFinanceiro>("implantacao_base_financeiro", id, "financeiro");
export const useRhBase           = (id: string | null) => useRecorte<LinhaRh>("implantacao_base_rh", id, "rh");
export const useOperacionalBase  = (id: string | null) => useRecorte<LinhaOperacional>("implantacao_base_operacional", id, "operacional");
export const useComprasBase      = (id: string | null) => useRecorte<LinhaCompras>("implantacao_base_compras", id, "compras");

/** "Atualizar da base": repuxa de contratos, planilha_custo, sup_posto e o enxoval. */
export function useAtualizarDaBase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contratoId: string) => {
      const { data, error } = await sb.rpc("implantacao_base_semear", { p_contrato_id: contratoId });
      if (error) throw new Error(error.message);
      return (data as { postos: number; locais: number; itens: number }[])?.[0];
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["implantacao-base"] });
      toast({
        title: "Base atualizada",
        description: r
          ? `${r.postos} posto(s), ${r.locais} local(is) e ${r.itens} item(ns) vieram das tabelas do ERP.`
          : "Nada novo para trazer.",
      });
    },
    onError: (e: Error) => toast({ title: "Não deu para atualizar", description: e.message, variant: "destructive" }),
  });
}

export const useReunioesDaBase = (id: string | null) =>
  useRecorte<ReuniaoDaBase>("implantacao_base_reunioes", id, "reunioes");

/** Candidatas a vincular; `sugerida` marca a que parece ser deste contrato. */
export function useReunioesDisponiveis(contratoId: string | null, busca: string) {
  return useQuery({
    queryKey: ["implantacao-base", "reunioes-disponiveis", contratoId, busca],
    enabled: !!contratoId,
    queryFn: async (): Promise<ReuniaoCandidata[]> => {
      const { data, error } = await sb.rpc("implantacao_base_reunioes_disponiveis", {
        p_contrato_id: contratoId,
        p_busca: busca || null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as ReuniaoCandidata[];
    },
  });
}

export function useVincularReuniao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, reuniaoId, observacao }: { contratoId: string; reuniaoId: string; observacao?: string }) => {
      const { error } = await sb.rpc("implantacao_base_reuniao_vincular", {
        p_contrato_id: contratoId,
        p_reuniao_id: reuniaoId,
        p_observacao: observacao ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["implantacao-base"] });
      toast({ title: "Reunião vinculada", description: "Ela passa a aparecer no resumo da implantação." });
    },
    onError: (e: Error) => toast({ title: "Não deu para vincular", description: e.message, variant: "destructive" }),
  });
}

export function useDesvincularReuniao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vinculoId: string) => {
      const { error } = await sb.rpc("implantacao_base_reuniao_desvincular", { p_vinculo_id: vinculoId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["implantacao-base"] });
      toast({ title: "Reunião desvinculada" });
    },
    onError: (e: Error) => toast({ title: "Não deu para desvincular", description: e.message, variant: "destructive" }),
  });
}

export interface BaseCadastrada {
  id: string;
  contrato_id: string;
  cnpj_contratante: string | null;
  valor_mensal: number | null;
  qt_postos: number;
  qt_colaboradores: number;
  situacao: string;
  sincronizado_em: string | null;
  contratos: { nome: string; cliente: string | null; data_inicio: string | null; quant_func_estipulado: number | null } | null;
}

/** Todas as bases já cadastradas — a tabela da tela de cadastro. */
export function useBasesCadastradas() {
  return useQuery({
    queryKey: ["implantacao-base", "lista"],
    queryFn: async (): Promise<BaseCadastrada[]> => {
      const { data, error } = await sb
        .from("IMPLANTACAO_BASE")
        .select("id, contrato_id, cnpj_contratante, valor_mensal, qt_postos, qt_colaboradores, situacao, sincronizado_em, contratos(nome, cliente, data_inicio, quant_func_estipulado)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BaseCadastrada[];
    },
  });
}

export interface PayloadImportacao {
  postos?: unknown[];
  locais?: unknown[];
  itens?: unknown[];
}

/**
 * Importa o que o parser leu das planilhas. O casamento com o catálogo e a
 * criação de item pendente acontecem no banco (RPC), não aqui: casar 127
 * itens no cliente seriam 127 idas ao PostgREST.
 */
export function useImportarPlanilha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, payload }: { contratoId: string; payload: PayloadImportacao }) => {
      const { data, error } = await sb.rpc("implantacao_base_importar", { p_contrato_id: contratoId, p_payload: payload });
      if (error) throw new Error(error.message);
      return (data as { postos: number; locais: number; itens: number; itens_novos: number }[])?.[0];
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["implantacao-base"] });
      toast({
        title: "Planilha importada",
        description: r
          ? `${r.postos} posto(s), ${r.locais} local(is), ${r.itens} item(ns). ${r.itens_novos} item(ns) novo(s) foram criados no catálogo aguardando aprovação do Suprimentos.`
          : "Nada foi importado.",
      });
    },
    onError: (e: Error) => toast({ title: "Não deu para importar", description: e.message, variant: "destructive" }),
  });
}

/** Linhas da base mestre, para a tela de cadastro editar. */
export function useLinhasDaBase<T>(tabela: string, baseId: string | null) {
  return useQuery({
    queryKey: ["implantacao-base", "linhas", tabela, baseId],
    enabled: !!baseId,
    queryFn: async (): Promise<T[]> => {
      const { data, error } = await sb.from(tabela).select("*").eq("base_id", baseId).order("ordem");
      if (error) throw error;
      return (data ?? []) as T[];
    },
  });
}

export function useSalvarLinha(tabela: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (linha: Record<string, unknown>) => {
      const { id, ...campos } = linha;
      const q = id
        ? sb.from(tabela).update(campos).eq("id", id)
        : sb.from(tabela).insert(campos);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["implantacao-base"] }),
    onError: (e: Error) => toast({ title: "Não deu para salvar", description: e.message, variant: "destructive" }),
  });
}

export function useExcluirLinha(tabela: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from(tabela).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["implantacao-base"] }),
    onError: (e: Error) => toast({ title: "Não deu para excluir", description: e.message, variant: "destructive" }),
  });
}

export const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const num = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR");
