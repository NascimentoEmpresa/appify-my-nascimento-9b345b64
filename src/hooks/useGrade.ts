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

// SIS-2026-0359: `todasEmpresas: true` lê a grade de TODAS as empresas do grupo
// (Lucas/gerente quer as ganhas unificadas). A RLS da grade já é só
// can_access('pipeline','visualizar') — sem filtro de empresa no banco —,
// então dropar o `.eq empresa_id` é seguro. Só p/ LEITURA; escrita continua
// por empresa ativa (ver Pipeline.tsx).
export function useGrade(empresaId: string | null, opts?: { todasEmpresas?: boolean }) {
  const todasEmpresas = opts?.todasEmpresas ?? false;
  return useQuery({
    queryKey: todasEmpresas ? ["grade", "todas"] : QK(empresaId ?? ""),
    enabled: todasEmpresas || (!!empresaId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(empresaId ?? "")),
    // Evita refetch enquanto o usuário está editando o formulário
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from("grade")
        .select("*")
        .order("data", { ascending: true, nullsFirst: false });
      if (!todasEmpresas) q = q.eq("empresa_id", empresaId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as GradeItem[];
    },
  });
}

// SIS-2026-0309: `empresa_id` vem do próprio payload (campo explícito do
// formulário — GradeSheet), não mais de um parâmetro externo sourced da
// empresa "ativa" do seletor. É o ponto de entrada real da cadeia de
// licitação (Grade → Capa → Implantação → Contrato); acertar aqui evita a
// classe inteira de erro do bug real do contrato CEITEC.
export function useGradeInsert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: GradeInsert) => {
      const { data, error } = await supabase
        .from("grade")
        .insert({ ...payload, historico: [] })
        .select()
        .single();
      if (error) throw error;
      return data as GradeItem;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grade"] });
      toast({ title: "Entrada cadastrada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useGradeUpdate() {
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
        qc.invalidateQueries({ queryKey: ["capa-edital"] });
      }

      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grade"] });
      toast({ title: "Entrada atualizada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useGradeDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("grade").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grade"] });
      toast({ title: "Excluído." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

// SIS-2026-0309 (mesma classe do bug real do CEITEC): a empresa da Capa
// criada vem da PRÓPRIA grade (item.empresa_id) — origem da cadeia —, não
// mais de um parâmetro externo sourced da empresa "ativa" do seletor.
export function useGradePromover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: GradeItem) => {
      if (item.capa_id) throw new Error("Já possui capa vinculada.");

      const abertura = [item.data, item.horario].filter(Boolean).join(" ").trim();

      const { data: capa, error: capaErr } = await supabase
        .from("capa_edital")
        .insert({
          empresa_id: item.empresa_id,
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
      qc.invalidateQueries({ queryKey: ["grade"] });
      qc.invalidateQueries({ queryKey: ["capa-edital"] });
      toast({ title: "Capa de Edital criada!", description: "Acesse o módulo Capa para completar." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
