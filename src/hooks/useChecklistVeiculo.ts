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
}

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
      const { data, error } = await sb.rpc("cs_veiculo_checklist_salvar", {
        p_agendamento: v.agendamentoId,
        p_tipo: v.tipo,
        p_realizado_em: v.realizadoEm ? new Date(v.realizadoEm).toISOString() : null,
        p_km: v.km,
        p_fotos: fotos,
        p_observacao: v.observacao,
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
      toast.success(c?.completo ? "Checklist preenchido." : "Checklist salvo — ainda faltam fotos.");
    },
    onError: (e: { message?: string }) => toast.error(e?.message || "Não foi possível salvar o checklist."),
  });
}
