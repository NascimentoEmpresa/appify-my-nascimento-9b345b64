import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type {
  ChecklistItem, DadosChecklist, Historico, Severidade, StatusBug, StatusDevTelas,
} from "@/lib/sistemas/checklistModulos";

// Sistemas › Checklist de Módulos (mig 20260930000291). O painel inteiro vem
// de uma RPC só (sis_checklist_dados); uso por pessoa, uso por dia e chamados
// do módulo têm RPC própria; bugs, treinamentos e histórico são tabelas com
// RLS da tela sistemas_checklist_modulos.

const sb = supabase as unknown as SupabaseClient;
const CHAVE = ["sis-checklist"] as const;

export function useChecklistDados() {
  return useQuery({
    queryKey: [...CHAVE, "dados"],
    queryFn: async (): Promise<DadosChecklist> => {
      const { data, error } = await sb.rpc("sis_checklist_dados");
      if (error) throw error;
      return data as DadosChecklist;
    },
    staleTime: 30_000,
  });
}

export interface UsoPessoa {
  user_id: string; nome: string | null; tem_acesso: boolean; acessos: number; dias: number;
  ultimo: string | null; telas: string[]; treinado_em: string | null;
}
export function useUsoModulo(moduloId: string | null, dias = 30) {
  return useQuery({
    queryKey: [...CHAVE, "uso-modulo", moduloId, dias],
    enabled: !!moduloId,
    queryFn: async (): Promise<UsoPessoa[]> => {
      const { data, error } = await sb.rpc("sis_uso_modulo", { _modulo: moduloId, _dias: dias });
      if (error) throw error;
      return (data ?? []) as UsoPessoa[];
    },
  });
}

export function useUsoPorDia(moduloId: string | null, dias = 30) {
  return useQuery({
    queryKey: [...CHAVE, "uso-dia", moduloId, dias],
    queryFn: async (): Promise<{ dia: string; acessos: number; usuarios: number }[]> => {
      const { data, error } = await sb.rpc("sis_uso_por_dia", { _modulo: moduloId, _dias: dias });
      if (error) throw error;
      return (data ?? []) as { dia: string; acessos: number; usuarios: number }[];
    },
    staleTime: 60_000,
  });
}

export interface ChamadoModulo {
  id: string; numero: string | null; assunto: string; status: string; prioridade: string | null;
  tipo: string | null; solicitante: string | null; created_at: string; concluido_em: string | null;
}
export function useChamadosModulo(codigo: string | null) {
  return useQuery({
    queryKey: [...CHAVE, "chamados", codigo],
    enabled: !!codigo,
    queryFn: async (): Promise<ChamadoModulo[]> => {
      const { data, error } = await sb.rpc("sis_chamados_modulo", { _modulo_codigo: codigo });
      if (error) throw error;
      return (data ?? []) as ChamadoModulo[];
    },
  });
}

export interface Bug {
  id: number; modulo_id: string; menu_id: string | null; titulo: string; descricao: string; como_reproduzir: string | null;
  severidade: Severidade; status: StatusBug; reportado_por_id: string | null; reportado_por_nome: string | null;
  responsavel_id: string | null; chamado_id: string | null; chamado_numero: string | null; resolucao: string | null;
  resolvido_em: string | null; created_at: string; atualizado_em: string;
}
export function useBugs() {
  return useQuery({
    queryKey: [...CHAVE, "bugs"],
    queryFn: async (): Promise<Bug[]> => {
      const { data, error } = await sb.from("SIS_BUG").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as Bug[];
    },
  });
}

export function useHistorico(moduloId: string | null, limite = 300, enabled = true) {
  return useQuery({
    queryKey: [...CHAVE, "historico", moduloId, limite],
    enabled,
    queryFn: async (): Promise<Historico[]> => {
      let q = sb.from("SIS_CHECKLIST_HIST").select("*").order("created_at", { ascending: false }).limit(limite);
      if (moduloId) q = q.eq("modulo_id", moduloId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Historico[];
    },
  });
}

export interface Treinamento {
  id: string; modulo_id: string; menu_id: string | null; user_id: string; treinado_em: string;
  instrutor: string | null; observacao: string | null; registrado_por: string | null; created_at: string;
}
export function useTreinamentosModulo(moduloId: string | null) {
  return useQuery({
    queryKey: [...CHAVE, "treinamentos", moduloId],
    enabled: !!moduloId,
    queryFn: async (): Promise<Treinamento[]> => {
      const { data, error } = await sb.from("SIS_TREINAMENTO_USUARIO").select("*").eq("modulo_id", moduloId).order("treinado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Treinamento[];
    },
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CHAVE });
}
const msg = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Não foi possível salvar.");

export type CamposChecklist = Partial<Omit<ChecklistItem, "id" | "modulo_id" | "menu_id" | "atualizado_por" | "atualizado_em">>;

/** Grava o checklist de uma tela (menuId) ou do módulo (menuId nulo). O índice único é por expressão, então nada de upsert: atualiza pelo id ou insere. */
export function useSalvarChecklist() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string | null; moduloId: string; menuId: string | null; campos: CamposChecklist }) => {
      if (v.id) {
        const { error } = await sb.from("SIS_CHECKLIST").update(v.campos).eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("SIS_CHECKLIST").insert({ modulo_id: v.moduloId, menu_id: v.menuId, ...v.campos });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidar(); toast.success("Checklist atualizado."); },
    onError: (e) => toast.error(msg(e)),
  });
}

export function useSalvarBug() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: number | null; campos: Partial<Bug> }) => {
      if (v.id) {
        const { error } = await sb.from("SIS_BUG").update(v.campos).eq("id", v.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("SIS_BUG").insert(v.campos);
        if (error) throw error;
      }
    },
    onSuccess: (_d, v) => { invalidar(); toast.success(v.id ? "Bug atualizado." : "Bug registrado."); },
    onError: (e) => toast.error(msg(e)),
  });
}

export function useExcluirBug() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from("SIS_BUG").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Bug excluído."); },
    onError: (e) => toast.error(msg(e)),
  });
}

/** Abre o chamado de sistemas a partir do bug (RPC) e avisa o time pelo WhatsApp, como a abertura normal. */
export function useEncaminharBug() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: number): Promise<{ chamado_id: string; numero: string }> => {
      const { data, error } = await sb.rpc("sis_bug_encaminhar", { _bug: id });
      if (error) throw error;
      const r = data as { chamado_id: string; numero: string };
      supabase.functions.invoke("notificar-chamado-whatsapp", { body: { chamado_id: r.chamado_id, evento: "criado" } }).catch(() => {});
      return r;
    },
    onSuccess: (r) => { invalidar(); toast.success(`Chamado ${r.numero} aberto a partir do bug.`); },
    onError: (e) => toast.error(msg(e)),
  });
}

export function useMarcarTreinado() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { moduloId: string; userIds: string[]; data: string; instrutor?: string; observacao?: string }) => {
      const linhas = v.userIds.map((u) => ({
        modulo_id: v.moduloId, menu_id: null, user_id: u, treinado_em: v.data,
        instrutor: v.instrutor?.trim() || null, observacao: v.observacao?.trim() || null,
      }));
      const { error } = await sb.from("SIS_TREINAMENTO_USUARIO").insert(linhas);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { invalidar(); toast.success(v.userIds.length === 1 ? "Treinamento registrado." : `${v.userIds.length} treinamentos registrados.`); },
    onError: (e) => toast.error(/duplicate|unique/i.test(msg(e)) ? "Essa pessoa já está registrada como treinada neste módulo." : msg(e)),
  });
}

export function useDesmarcarTreinado() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("SIS_TREINAMENTO_USUARIO").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Treinamento removido."); },
    onError: (e) => toast.error(msg(e)),
  });
}

// ── Medição de uso (RouteGuard) ──────────────────────────────────────────
// Cada tela aberta COM acesso conta um acesso (usuário × tela × dia). A mesma
// tela reaberta em menos de 10 min não conta de novo — navegar entre abas da
// própria tela não infla o número. Falha calada: medir não pode atrapalhar.
const ultimoRegistro = new Map<string, number>();
export function registrarUsoTela(menuCodigo: string, rota: string) {
  const agora = Date.now();
  const chave = menuCodigo;
  if ((ultimoRegistro.get(chave) ?? 0) > agora - 10 * 60_000) return;
  ultimoRegistro.set(chave, agora);
  sb.rpc("sis_registrar_uso", { _menu: menuCodigo, _rota: rota }).then(({ error }) => {
    if (error) ultimoRegistro.delete(chave);
  });
}

/**
 * Status de desenvolvimento de cada tela/módulo para o selo do canto de TODA
 * tela (mig 20261002000003). Qualquer usuário logado lê. Se a RPC ainda não
 * existir no banco, devolve null e o selo simplesmente não aparece — nunca
 * derruba a tela. Mesma chave-mãe do checklist: salvar status já atualiza.
 */
export function useStatusDevTelas(enabled = true) {
  return useQuery({
    queryKey: [...CHAVE, "status-dev"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<StatusDevTelas | null> => {
      const { data, error } = await sb.rpc("sis_status_dev_telas");
      if (error || !data) return null;
      return data as StatusDevTelas;
    },
  });
}
