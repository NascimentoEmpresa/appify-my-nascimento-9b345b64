import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { feriadosNacionais } from "@/lib/feriadosNacionais";

export type PrazoPagamentoModo = "hoje" | "dias_uteis";
export type PrazoPagamentoUnidade = "util" | "corrido";
export type BloqueioRegra = "antecipar" | "proximo_dia_util" | "manter_original";

export interface MaloteConfig {
  inclusao_setor_horario: string;
  inclusao_setor_pagamento_modo: PrazoPagamentoModo;
  inclusao_setor_pagamento_dias: number;
  inclusao_setor_pagamento_unidade: PrazoPagamentoUnidade;
  conferencia_aprovacao_horario: string;
  conferencia_aprovacao_pagamento_modo: PrazoPagamentoModo;
  conferencia_aprovacao_pagamento_dias: number;
  conferencia_aprovacao_pagamento_unidade: PrazoPagamentoUnidade;
  bloqueio_regra: BloqueioRegra;
  bloqueio_impedir_lancamento: boolean;
  bloqueio_fins_de_semana: boolean;
  excecao_limite_inclusao_horario: string;
  excecao_limite_aprovacao_horario: string;
  excecao_exigir_justificativa_solicitante: boolean;
  excecao_exigir_justificativa_aprovador: boolean;
  updated_at: string;
}

export interface MaloteDiaBloqueado {
  id: string;
  data: string;
  tipo: string;
  descricao: string | null;
  // SIS-2026-0211: liberado=true LIBERA essa data específica mesmo que
  // caia num fim de semana bloqueado por padrão — é a exceção pontual.
  liberado: boolean;
}

const CONFIG_KEY = "malote_config";
const TIPOS_KEY = "malote_tipo_bloqueio";
const DIAS_KEY = "malote_dia_bloqueado";

const CONFIG_COLUMNS =
  "inclusao_setor_horario, inclusao_setor_pagamento_modo, inclusao_setor_pagamento_dias, inclusao_setor_pagamento_unidade, " +
  "conferencia_aprovacao_horario, conferencia_aprovacao_pagamento_modo, conferencia_aprovacao_pagamento_dias, conferencia_aprovacao_pagamento_unidade, " +
  "bloqueio_regra, bloqueio_impedir_lancamento, bloqueio_fins_de_semana, " +
  "excecao_limite_inclusao_horario, excecao_limite_aprovacao_horario, " +
  "excecao_exigir_justificativa_solicitante, excecao_exigir_justificativa_aprovador, updated_at";

// SIS-2026-0250: hora atual já passou de um horário-limite (formato
// "HH:MM"). Genérico — usado pro corte 2.1 (inclusão de exceção pro mesmo
// dia) e pros avisos de 1.2/2.2 na tela de aprovação.
export function horaAtualPassouDe(horario: string | undefined | null): boolean {
  if (!horario) return false;
  const [h, m] = horario.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const agora = new Date();
  const limite = new Date(agora);
  limite.setHours(h, m, 0, 0);
  return agora > limite;
}

// SIS-2026-0250: 1.1 ("Prazo para inclusão e aprovação pelo setor") define
// a "data normal" de pagamento pra quem lança agora — hoje só conta como
// base do cálculo se ainda não passou do horário 1.1; depois disso desloca
// +1 dia útil, e a partir daí soma o modo/dias/unidade configurados,
// pulando dia bloqueado quando a unidade é "útil". Pedir uma data mais
// cedo que essa exige marcar Exceção. O cálculo mora no banco
// (malote_prazo_normal_inclusao, mesma função que o trigger de
// malote_despesa usa pra validar de verdade) pra não duplicar a lógica de
// dia útil/bloqueado em TS — aqui só busca o resultado já pronto.
export function usePrazoNormalInclusao() {
  return useQuery({
    queryKey: [CONFIG_KEY, "prazo_normal_inclusao"],
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("malote_prazo_normal_inclusao");
      if (error) throw error;
      return data as string; // "YYYY-MM-DD"
    },
  });
}

// SIS-2026-0250: cargo "GERENTE FINANCEIRO" (Carol) pode aprovar/reprovar
// qualquer despesa de Exceção como reforço, mesmo sem estar configurada
// como Aprovadora Nível 2 daquela Classificação — reaproveita o mesmo
// padrão de useSouSupervisorMalote (RPC de cargo já usada pela RLS).
export function useSouGerenteFinanceiroMalote() {
  return useQuery({
    queryKey: ["malote_gerente_financeiro"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data, error } = await (supabase as any).rpc("malote_gerente_financeiro", { _user_id: u.user.id });
      if (error) throw error;
      return !!data;
    },
  });
}

export function useMaloteConfig() {
  return useQuery({
    queryKey: [CONFIG_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_config")
        .select(CONFIG_COLUMNS)
        .eq("id", true)
        .single();
      if (error) throw error;
      return data as MaloteConfig;
    },
  });
}

export function useSalvarMaloteConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MaloteConfig) => {
      const { error } = await (supabase as any).from("malote_config").update(input).eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CONFIG_KEY] }),
  });
}

export function useMaloteTiposBloqueio() {
  return useQuery({
    queryKey: [TIPOS_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("malote_tipo_bloqueio").select("nome").order("nome");
      if (error) throw error;
      return (data ?? []).map((r: any) => r.nome as string);
    },
  });
}

export function useCriarTipoBloqueio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { error } = await (supabase as any).from("malote_tipo_bloqueio").insert({ nome: nome.trim() });
      if (error) throw error;
      return nome.trim();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIPOS_KEY] }),
  });
}

export function useMaloteDiasBloqueados() {
  return useQuery({
    queryKey: [DIAS_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_dia_bloqueado")
        .select("id, data, tipo, descricao, liberado")
        .order("data", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaloteDiaBloqueado[];
    },
  });
}

interface SalvarDiaBloqueadoInput {
  id?: string;
  data: string;
  tipo: string;
  descricao: string | null;
  liberado?: boolean;
}

export function useSalvarDiaBloqueado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarDiaBloqueadoInput) => {
      const { error } = await (supabase as any).from("malote_dia_bloqueado").upsert(input);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DIAS_KEY] }),
  });
}

export function useExcluirDiaBloqueado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_dia_bloqueado").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DIAS_KEY] }),
  });
}

// Importa os feriados nacionais fixos + móveis (Páscoa) de um ano. Datas já
// cadastradas (manual ou de outro import) NÃO são sobrescritas —
// ignoreDuplicates pula quem já existe em vez de substituir.
export function useImportarFeriadosNacionais() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ano: number) => {
      const rows = feriadosNacionais(ano);
      const { data, error } = await (supabase as any)
        .from("malote_dia_bloqueado")
        .upsert(rows, { onConflict: "data", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      return { total: rows.length, importados: (data ?? []).length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DIAS_KEY] }),
  });
}
