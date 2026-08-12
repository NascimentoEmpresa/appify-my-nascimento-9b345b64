import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type GradeFase =
  | "À Iniciar"
  | "Iniciado"
  | "Em Andamento"
  | "Finalizada"
  | "Não Participado"
  | "Suspenso"
  | "Revogado";

export interface HistoricoEntry {
  ts: string;
  usuario?: string;
  campo: string;
  de: string;
  para: string;
}

export interface GradeItem {
  id: string;
  empresa_id: string;
  edital: string | null;
  fase: GradeFase;
  responsavel: string | null;
  cidade: string | null;
  uf: string | null;
  data: string | null;
  horario: string | null;
  objeto: string | null;
  qtd_pessoas: number | null;
  valor_global: string | null;
  posicao: number | null;
  status_obs: string | null;
  data_captacao: string | null;
  capa_id: string | null;
  historico: HistoricoEntry[];
  created_at: string;
  updated_at: string;
}

export type GradeInsert = Omit<GradeItem, "id" | "created_at" | "updated_at" | "historico" | "capa_id">;
export type GradeUpdate = Partial<Omit<GradeItem, "id" | "empresa_id" | "created_at">>;

const QK = (empresaId: string) => ["grade", empresaId];

export function useGrade(empresaId: string | null) {
  return useQuery({
    queryKey: QK(empresaId ?? ""),
    enabled: !!empresaId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(empresaId ?? ""),
    // Evita refetch enquanto o usuário está editando o formulário
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade")
        .select("*")
        .eq("empresa_id", empresaId!)
        .order("data", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as GradeItem[];
    },
  });
}

export function useGradeInsert(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: GradeInsert) => {
      const { data, error } = await supabase
        .from("grade")
        .insert({ ...payload, empresa_id: empresaId, historico: [] })
        .select()
        .single();
      if (error) throw error;
      return data as GradeItem;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      toast({ title: "Entrada cadastrada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useGradeUpdate(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes, current }: { id: string; changes: GradeUpdate; current: GradeItem }) => {
      const now = new Date().toLocaleString("pt-BR");
      const historico = [...(current.historico ?? [])];

      const { data: authData } = await supabase.auth.getUser();
      const { data: profile } = authData?.user
        ? await supabase.from("profiles").select("display_name, email").eq("id", authData.user.id).maybeSingle()
        : { data: null };
      const usuario = (profile as any)?.display_name || (profile as any)?.email || authData?.user?.email || "—";

      for (const [field, label] of [
        ["fase", "Fase"],
        ["data", "Data de Abertura"],
        ["posicao", "Posição"],
        ["responsavel", "Responsável"],
      ] as const) {
        const prev = String(current[field as keyof GradeItem] ?? "");
        const next = String((changes as Record<string, unknown>)[field] ?? "");
        if (field in changes && prev !== next) {
          const paraLabel = field === "posicao" && next && next !== "null"
            ? `${next}º`
            : next || "—";
          const deLabel = field === "posicao" && prev && prev !== "null"
            ? `${prev}º`
            : prev || "—";
          historico.push({ ts: now, usuario, campo: label, de: deLabel, para: paraLabel });
        }
      }

      const { data, error } = await supabase
        .from("grade")
        .update({ ...changes, historico })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      const updated = data as GradeItem;

      // Item 8: auto-atualiza status da capa quando grade finalizada ou não participada
      if (updated.capa_id && (changes.fase === "Finalizada" || changes.fase === "Não Participado")) {
        const novoStatus =
          changes.fase === "Não Participado" ? "Não Participado" :
          updated.posicao === 1 ? "Ganhamos" : "Perdemos";
        await supabase
          .from("capa_edital")
          .update({ status: novoStatus })
          .eq("id", updated.capa_id);
        qc.invalidateQueries({ queryKey: ["capa-edital", empresaId] });
      }

      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      toast({ title: "Entrada atualizada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useGradeDelete(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("grade").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      toast({ title: "Excluído." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useGradePromover(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: GradeItem) => {
      if (item.capa_id) throw new Error("Já possui capa vinculada.");

      const abertura = [item.data, item.horario].filter(Boolean).join(" ").trim();

      const { data: capa, error: capaErr } = await supabase
        .from("capa_edital")
        .insert({
          empresa_id: empresaId,
          grade_id: item.id,
          cidade: item.cidade,
          uf: item.uf,
          objeto: item.objeto,
          abertura: abertura || null,
          qtd_postos: item.qtd_pessoas,
          valor_estimado: item.valor_global,
          responsavel: item.responsavel,
          data_captacao: item.data_captacao,
          observacoes: item.status_obs,
          status: "Em andamento",
          historico: [],
          preenchido_em: new Date().toISOString().slice(0, 10),
        })
        .select()
        .single();
      if (capaErr) throw capaErr;

      const { error: gradeErr } = await supabase
        .from("grade")
        .update({ capa_id: capa.id })
        .eq("id", item.id);
      if (gradeErr) throw gradeErr;

      return capa;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      qc.invalidateQueries({ queryKey: ["capa-edital", empresaId] });
      toast({ title: "Capa de Edital criada!", description: "Acesse o módulo Capa para completar." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
