import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { ChecklistVeiculo, TipoChecklist } from "@/lib/checklistVeiculo";

/**
 * Checklist de saída/chegada do Agendamento de Veículos (04/11/2026).
 * Regras e textos em src/lib/checklistVeiculo.ts; banco em
 * supabase/migrations/20261105009300_veiculos_checklist_saida_chegada.sql.
 */

// Tabela e RPC novas ainda não estão no types.ts gerado (mesmo atalho do useAgendamentoVeiculos).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** Bucket privado das fotos: só quem agendou e quem gerencia a frota (Patrimônio). */
export const BUCKET_CHECKLIST = "cs-veiculos-checklist";

/**
 * Todos os checklists que a RLS deixa ver: os meus e, para quem gerencia a
 * frota, os de todo mundo. Falha (migration ainda não aplicada) vira lista
 * vazia — o resto da tela de agendamento não pode cair por causa disto.
 */
export function useChecklists() {
  return useQuery({
    queryKey: ["cs_veiculo_checklist"],
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<ChecklistVeiculo[]> => {
      const { data, error } = await sb.from("CS_VEICULO_CHECKLIST").select("*");
      if (error) {
        console.warn("[checklist veículo] não carregou:", error.message);
        return [];
      }
      return (data ?? []) as ChecklistVeiculo[];
    },
  });
}

/** Sobe uma foto na pasta do agendamento (a policy do bucket exige esse prefixo). */
async function subirFoto(agendamentoId: string, tipo: TipoChecklist, campo: string, file: File): Promise<string> {
  const limpo = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${agendamentoId}/${tipo}/${campo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${limpo}`;
  const { error } = await supabase.storage.from(BUCKET_CHECKLIST).upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(`Não deu para enviar "${file.name}": ${error.message}`);
  return path;
}

/** Link temporário (1 h) de uma foto do checklist. */
export async function linkFotoChecklist(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET_CHECKLIST).createSignedUrl(path, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function abrirFotoChecklist(path: string): Promise<void> {
  const url = await linkFotoChecklist(path);
  if (!url) { toast.error("Não consegui abrir a foto."); return; }
  window.open(url, "_blank", "noopener");
}

export interface SalvarChecklist {
  agendamentoId: string;
  tipo: TipoChecklist;
  /** datetime-local ("2026-11-04T08:15"). */
  realizadoEm: string;
  km: number | null;
  observacao: string;
  /** Foto única nova por campo (foto_lateral_direita, …, foto_km). */
  novasUnicas: Partial<Record<string, File>>;
  /** Interior: as que já estavam e ficaram + arquivos novos. */
  interiorMantidas: string[];
  interiorNovas: File[];
  defeitoMantidas: string[];
  defeitoNovas: File[];
  /** Prestação da viagem (chegada, mig 20261110220000). */
  videoNovo?: File | null;
  extra?: { agua_verificada?: boolean; oleo_verificado?: boolean; avaria?: boolean | null; avaria_descricao?: string; sem_abastecimento?: boolean };
}

/** Vídeo do veículo: até 200 MB (limite do bucket). */
export const VIDEO_MAX_MB = 200;

export function useSalvarChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: SalvarChecklist): Promise<ChecklistVeiculo> => {
      if (v.km != null && !(v.km >= 0)) throw new Error("KM inválido.");
      const fotos: Record<string, unknown> = {};
      for (const [campo, file] of Object.entries(v.novasUnicas)) {
        if (file) fotos[campo] = await subirFoto(v.agendamentoId, v.tipo, campo, file);
      }
      // As listas vão sempre inteiras (mantidas + novas): é assim que tirar uma
      // foto do interior/defeito chega ao banco.
      const interior: string[] = [];
      for (const f of v.interiorNovas) interior.push(await subirFoto(v.agendamentoId, v.tipo, "interior", f));
      fotos.fotos_interior = [...v.interiorMantidas, ...interior];
      const defeito: string[] = [];
      for (const f of v.defeitoNovas) defeito.push(await subirFoto(v.agendamentoId, v.tipo, "defeito", f));
      fotos.fotos_defeito = [...v.defeitoMantidas, ...defeito];
      if (v.videoNovo) {
        if (v.videoNovo.size > VIDEO_MAX_MB * 1024 * 1024) throw new Error(`O vídeo tem mais de ${VIDEO_MAX_MB} MB. Grave em resolução menor (720p) e tente de novo.`);
        fotos.video_veiculo = await subirFoto(v.agendamentoId, v.tipo, "video", v.videoNovo);
      }
      // avaria null = não respondido: não manda a chave (não apaga o que já estava).
      const extra: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v.extra ?? {})) if (val !== undefined && val !== null) extra[k] = val;
      const { data, error } = await sb.rpc("cs_veiculo_checklist_salvar", {
        p_agendamento: v.agendamentoId,
        p_tipo: v.tipo,
        p_realizado_em: v.realizadoEm ? new Date(v.realizadoEm).toISOString() : null,
        p_km: v.km,
        p_fotos: fotos,
        p_observacao: v.observacao,
        p_extra: Object.keys(extra).length ? extra : null,
      });
      if (error) throw error;
      return data as ChecklistVeiculo;
    },
    onSuccess: (c, v) => {
      qc.invalidateQueries({ queryKey: ["cs_veiculo_checklist"] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_agendamento"] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_viagem", v.agendamentoId] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_agendamento_log", v.agendamentoId] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_km_pendentes"] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_minhas_pendencias"] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_prestacoes"] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_ultimo_km"] });
      qc.invalidateQueries({ queryKey: ["cs_veiculo_dashboard"] });
      toast.success(c?.completo ? "Checklist preenchido." : "Checklist salvo — ainda faltam fotos.");
    },
    onError: (e: { message?: string }) => toast.error(e?.message || "Não foi possível salvar o checklist."),
  });
}

// ── Prestação da viagem e último KM (mig 20261110220000) ─────────────────

export interface PrestacaoPendente {
  agendamento_id: string; numero: number; veiculo: string; placa: string | null;
  data_inicio: string; data_fim: string; iniciada: boolean; faltando: string[];
}

/**
 * Viagens de quem agendou (ou de `solicitanteId`, para o gestor) que ainda não
 * têm a prestação completa. Enquanto houver, o banco não deixa iniciar outra.
 */
export function usePrestacoesPendentes(solicitanteId?: string | null, excetoId?: string | null, ativo = true) {
  return useQuery({
    queryKey: ["cs_veiculo_prestacoes", solicitanteId ?? "eu", excetoId ?? null],
    enabled: ativo,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<PrestacaoPendente[]> => {
      const { data, error } = await sb.rpc("cs_veiculo_prestacoes_pendentes", { p_solicitante: solicitanteId ?? null, p_exceto: excetoId ?? null });
      if (error) { console.warn("[prestação veículo]", error.message); return []; }
      return (data ?? []) as PrestacaoPendente[];
    },
  });
}

export interface UltimoKm { km: number; em: string; numero: number; condutor: string | null; momento: "saida" | "retorno"; patrimonio_id?: string }

/** O último KM informado deste veículo (de outra viagem). */
export function useUltimoKm(patrimonioId: string | null | undefined, excetoId?: string | null) {
  return useQuery({
    queryKey: ["cs_veiculo_ultimo_km", patrimonioId, excetoId ?? null],
    enabled: !!patrimonioId,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<UltimoKm | null> => {
      const { data, error } = await sb.rpc("cs_veiculo_ultimo_km", { p_patrimonio: patrimonioId, p_exceto: excetoId ?? null });
      if (error) { console.warn("[último km]", error.message); return null; }
      return (data ?? null) as UltimoKm | null;
    },
  });
}

/** O último KM de todos os veículos (cards da frota). */
export function useUltimosKm() {
  return useQuery({
    queryKey: ["cs_veiculo_ultimo_km", "todos"],
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, UltimoKm>> => {
      const { data, error } = await sb.rpc("cs_veiculo_ultimos_km");
      if (error) { console.warn("[últimos km]", error.message); return new Map(); }
      return new Map(((data ?? []) as UltimoKm[]).map((u) => [u.patrimonio_id!, u]));
    },
  });
}
