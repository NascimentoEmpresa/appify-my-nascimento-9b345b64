import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TipoClassificacaoOrcamento = "contrato" | "administrativo";

const CLASSIFICACAO_COLUMNS =
  "id, nome, ativo, tipo, setor_responsavel, requer_solicitacao, " +
  "aprovador_solicitacao_user_id, aprovador_solicitacao_nome, " +
  "aprovador1_user_id, aprovador1_nome, aprovador1_limite_pct, aprovador1_sem_limite, " +
  "aprovador2_user_id, aprovador2_nome, aprovador2_limite_pct, aprovador2_sem_limite, " +
  "aprovador3_user_id, aprovador3_nome, aprovador3_limite_pct, aprovador3_sem_limite, " +
  "limite_justificativa_pct";

export interface ClassificacaoOrcamento {
  id: string;
  nome: string;
  ativo: boolean;
  tipo: TipoClassificacaoOrcamento | null;
  setor_responsavel: string | null;
  requer_solicitacao: boolean;
  aprovador_solicitacao_user_id: string | null;
  aprovador_solicitacao_nome: string | null;
  aprovador1_user_id: string | null;
  aprovador1_nome: string | null;
  aprovador1_limite_pct: number | null;
  aprovador1_sem_limite: boolean;
  aprovador2_user_id: string | null;
  aprovador2_nome: string | null;
  aprovador2_limite_pct: number | null;
  aprovador2_sem_limite: boolean;
  aprovador3_user_id: string | null;
  aprovador3_nome: string | null;
  aprovador3_limite_pct: number | null;
  aprovador3_sem_limite: boolean;
  limite_justificativa_pct: number | null;
}

export interface AprovadorDisponivel {
  id: string;
  nome: string;
  cargo: string | null;
  email: string | null;
}

// profiles.cargo é texto livre curado manualmente (ex.: "GERENTE LICITACAO",
// "SUPERVISOR FINANCEIRO", "DIRETORA ADMINISTRATIVA", "PRESIDENTE") — não
// existe um campo de "nível hierárquico" separado, então o filtro por slot
// de aprovador é por substring no cargo. "DIRETOR" casa com "DIRETORA" de
// propósito (substring), cobrindo a variação de gênero do cargo.
const CARGO_SLOT_REGEX: Record<1 | 2 | 3, RegExp> = {
  1: /gerente|supervisor/i,
  2: /diretor/i,
  3: /presidente|ceo/i,
};

// Lista de usuários ativos pra escolher como aprovador (Aprovador 1/2/3 da
// classificação) — mesmo critério (profiles.ativo) já usado em outros
// pickers de aprovador do ERP (ex: AlcadasTab). `slot` filtra por cargo
// compatível com o nível esperado daquele aprovador (1=gerente/supervisor,
// 2=diretor, 3=presidente); omitido, devolve todo mundo.
export function useAprovadoresDisponiveis(slot?: 1 | 2 | 3) {
  return useQuery({
    queryKey: ["planejamento_orcamentario_aprovadores", slot ?? "todos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("id, display_name, email, cargo")
        .eq("ativo", true)
        .order("display_name");
      if (error) throw error;
      const todos = (data ?? []).map((u: any) => ({
        id: u.id,
        nome: u.display_name || u.email || u.id,
        cargo: u.cargo,
        email: u.email,
      })) as AprovadorDisponivel[];
      if (!slot) return todos;
      return todos.filter((u) => u.cargo && CARGO_SLOT_REGEX[slot].test(u.cargo));
    },
  });
}

// Catálogo de setores (mesma tabela usada em Administração → Setores) pra
// escolher o Setor responsável pela classificação.
export function useSetoresCatalogo() {
  return useQuery({
    queryKey: ["setor_catalogo_planejamento_orcamentario"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("setor_catalogo").select("nome").order("nome");
      if (error) throw error;
      return (data ?? []).map((r) => r.nome as string);
    },
  });
}

export interface ClassificacaoAdministrativoRef {
  id: string;
  nome: string;
  ativo: boolean;
}

export interface PlanejamentoOrcamentarioRow {
  id: string;
  empresa_id: string;
  classificacao_id: string;
  detalhe: string;
  inicio_vigencia: string;
  fim_vigencia: string;
  valor: number;
  created_at: string;
  updated_at: string;
  // Orçamento Administrativo (SIS-2026-0125): classificacao_id referencia a
  // Classificação Administrativo (catálogo simples), não a Classificação
  // Malote — aprovadores/alçadas ficam no Orçamento Geral, via ligação.
  classificacao: ClassificacaoAdministrativoRef | null;
}

const LIST_KEY = "planejamento_orcamentario";
const CLASSIFICACOES_KEY = "planejamento_orcamentario_classificacao";

// Lista de classificações ativas, pra uso no dropdown do cadastro de
// orçamento — é global (compartilhada entre todas as empresas), não filtra
// por empresa_id.
export function useClassificacoesOrcamento() {
  return useQuery({
    queryKey: [CLASSIFICACOES_KEY, "ativas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("planejamento_orcamentario_classificacao")
        .select(CLASSIFICACAO_COLUMNS)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ClassificacaoOrcamento[];
    },
  });
}

// Lista completa (ativas + inativas), pra tela de administração das
// classificações.
export function useClassificacoesOrcamentoAdmin() {
  return useQuery({
    queryKey: [CLASSIFICACOES_KEY, "todas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("planejamento_orcamentario_classificacao")
        .select(CLASSIFICACAO_COLUMNS)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ClassificacaoOrcamento[];
    },
  });
}

interface SalvarClassificacaoInput {
  id?: string;
  nome: string;
  ativo: boolean;
  tipo: TipoClassificacaoOrcamento;
  setor_responsavel: string;
  requer_solicitacao: boolean;
  aprovador_solicitacao_user_id: string | null;
  aprovador_solicitacao_nome: string | null;
  aprovador1_user_id: string;
  aprovador1_nome: string;
  aprovador1_limite_pct: number | null;
  aprovador1_sem_limite: boolean;
  aprovador2_user_id: string | null;
  aprovador2_nome: string | null;
  aprovador2_limite_pct: number | null;
  aprovador2_sem_limite: boolean;
  aprovador3_user_id: string | null;
  aprovador3_nome: string | null;
  aprovador3_limite_pct: number | null;
  aprovador3_sem_limite: boolean;
  limite_justificativa_pct: number | null;
}

export function useSalvarClassificacaoOrcamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarClassificacaoInput) => {
      const payload = { ...input, nome: input.nome.trim() };
      const { data, error } = await (supabase as any)
        .from("planejamento_orcamentario_classificacao")
        .upsert(payload)
        .select(CLASSIFICACAO_COLUMNS)
        .single();
      if (error) throw error;
      return data as ClassificacaoOrcamento;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CLASSIFICACOES_KEY] }),
  });
}

export function usePlanejamentosOrcamento(empresaId: string | null | undefined) {
  return useQuery({
    queryKey: [LIST_KEY, empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("planejamento_orcamentario")
        .select("*, classificacao:classificacao_id(id, nome, ativo)")
        .eq("empresa_id", empresaId)
        .order("inicio_vigencia", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PlanejamentoOrcamentarioRow[];
    },
  });
}

interface SalvarPlanejamentoInput {
  empresa_id: string;
  classificacao_id: string;
  detalhe: string;
  inicio_vigencia: string;
  fim_vigencia: string;
  valor: number;
}

export function useSalvarPlanejamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarPlanejamentoInput) => {
      const { data, error } = await (supabase as any).rpc("salvar_planejamento_orcamentario", {
        _empresa_id: input.empresa_id,
        _classificacao_id: input.classificacao_id,
        _detalhe: input.detalhe,
        _inicio: input.inicio_vigencia,
        _fim: input.fim_vigencia,
        _valor: input.valor,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIST_KEY] }),
  });
}

interface EditarPlanejamentoInput {
  id: string;
  detalhe: string;
  inicio_vigencia: string;
  fim_vigencia: string;
  valor: number;
}

export function useEditarPlanejamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EditarPlanejamentoInput) => {
      const { error } = await (supabase as any).rpc("editar_planejamento_orcamentario", {
        _id: input.id,
        _detalhe: input.detalhe,
        _inicio: input.inicio_vigencia,
        _fim: input.fim_vigencia,
        _valor: input.valor,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [LIST_KEY] }),
  });
}
