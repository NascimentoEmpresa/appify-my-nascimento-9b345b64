import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { HistoricoEntry } from "./useGrade";

export type CapaStatus = "Em andamento" | "Ganhamos" | "Perdemos";

export interface CapaEdital {
  id: string;
  empresa_id: string;
  grade_id: string | null;
  licitacao_id: string | null;

  cidade: string | null;
  uf: string | null;
  cliente: string | null;
  objeto: string | null;
  modalidade: string | null;
  local: string | null;
  forma_julgamento: string | null;
  atestado_cap_tecnica: string | null;
  escritorio: string | null;

  abertura: string | null;
  prazo_impugnacao: string | null;
  prazo_recurso: string | null;
  validade_proposta: string | null;
  prazo_contrato: string | null;
  visita_tecnica: string | null;
  data_inicio: string | null;

  qtd_postos: number | null;
  carga_horaria: string | null;

  valor_estimado: string | null;
  issqn: string | null;
  vale_transporte_valor: string | null;
  garantia: string | null;
  garantia_proposta: string | null;
  garantia_contratual: string | null;
  material: string | null;
  material_tipo: string | null;
  reajuste: string[] | null;

  responsavel: string | null;
  trabalho_escolar: boolean | null;
  emergencial: boolean | null;
  diluicao_meses: number | null;
  diluir_verbas: string | null;
  conta_vinculada: string | null;
  conta_vinculada_quem_abre: string | null;
  ponto_eletronico: string[] | null;

  observacoes: string | null;

  status: CapaStatus;
  data_homologacao: string | null;
  reuniao_alinhamento: string | null;
  contrato_id: string | null;

  historico: HistoricoEntry[];
  preenchido_em: string | null;
  created_at: string;
  updated_at: string;
}

const QK = (empresaId: string) => ["capa-edital", empresaId];

export function useCapaEdital(empresaId: string | null) {
  return useQuery({
    queryKey: QK(empresaId ?? ""),
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("capa_edital")
        .select("*")
        .eq("empresa_id", empresaId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CapaEdital[];
    },
  });
}

export function useCapaInsert(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<CapaEdital>) => {
      const { data, error } = await supabase
        .from("capa_edital")
        .insert({
          ...payload,
          empresa_id: empresaId,
          status: "Em andamento",
          historico: [],
          preenchido_em: new Date().toISOString().slice(0, 10),
        })
        .select()
        .single();
      if (error) throw error;
      return data as CapaEdital;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      toast({ title: "Licitação cadastrada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useCapaUpdate(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      changes,
      current,
    }: {
      id: string;
      changes: Partial<CapaEdital>;
      current: CapaEdital;
    }) => {
      const now = new Date().toLocaleString("pt-BR");
      const historico = [...(current.historico ?? [])];

      for (const [field, label] of [
        ["status", "Status"],
        ["abertura", "Abertura"],
        ["data_inicio", "Data de início"],
        ["reuniao_alinhamento", "Reunião de alinhamento"],
      ] as const) {
        const prev = String(current[field as keyof CapaEdital] ?? "");
        const next = String((changes as Record<string, unknown>)[field] ?? "");
        if (field in changes && prev !== next) {
          historico.push({ ts: now, campo: label, de: prev || "—", para: next || "—" });
        }
      }

      // Auto-stamp data_homologacao ao ganhar pela primeira vez
      if (changes.status === "Ganhamos" && !current.data_homologacao) {
        const today = new Date().toISOString().slice(0, 10);
        changes.data_homologacao = today;
        historico.push({ ts: now, campo: "Homologação", de: "—", para: today });
      }

      // Sincroniza grade: Ganhamos → posicao=1 + Finalizada; Perdemos → posicao=2 + Finalizada
      if (changes.status && changes.status !== current.status && current.grade_id) {
        const gradeChanges =
          changes.status === "Ganhamos"
            ? { posicao: 1, fase: "Finalizada" }
            : changes.status === "Perdemos"
            ? { posicao: 2, fase: "Finalizada" }
            : null;
        if (gradeChanges) {
          await supabase.from("grade").update(gradeChanges).eq("id", current.grade_id);
        }
      }

      // Stamp preenchido_em quando campos do formulário são salvos
      const formFields = new Set([
        "cidade","objeto","modalidade","abertura","local","prazo_contrato",
        "qtd_postos","valor_estimado","observacoes","data_inicio","escritorio",
      ]);
      if (Object.keys(changes).some((k) => formFields.has(k))) {
        changes.preenchido_em = new Date().toISOString().slice(0, 10);
      }

      const { data, error } = await supabase
        .from("capa_edital")
        .update({ ...changes, historico })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as CapaEdital;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      toast({ title: "Licitação atualizada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useCapaDelete(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("capa_edital").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      toast({ title: "Excluído." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useCapaPromover(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      capa,
      reuniaoAlinhamento,
    }: {
      capa: CapaEdital;
      reuniaoAlinhamento: string;
    }) => {
      if (capa.status !== "Ganhamos") throw new Error("Apenas licitações ganhas podem ser promovidas.");
      if (capa.contrato_id) throw new Error("Já possui contrato vinculado.");
      if (!capa.cliente?.trim()) throw new Error("Preencha o campo Cliente / Órgão na Capa antes de promover.");

      const nome = [capa.cidade, capa.objeto].filter(Boolean).join(" — ").trim() || "Contrato sem nome";

      const { data: contrato, error: cErr } = await supabase
        .from("implantacao_contrato")
        .insert({
          empresa_id: empresaId,
          nome,
          capa_id: capa.id,
          status: "ativo",
          data_inicio: capa.data_inicio,
          abertura: capa.abertura,
          reuniao_alinhamento: reuniaoAlinhamento,
          data_homologacao: capa.data_homologacao,
        })
        .select()
        .single();
      if (cErr) throw cErr;

      // Cria também o contrato oficial (public.contratos, plural) — é o que
      // Financeiro/NF/Cobrança usam. Aditivo: não altera nada do fluxo de
      // Implantação acima, só acrescenta esse insert.
      const { error: pcErr } = await (supabase as any).from("contratos").insert({
        empresa_id: empresaId,
        nome,
        cliente: capa.cliente.trim(),
        data_inicio: capa.data_inicio,
        status: "ativo",
        capa_id: capa.id,
        grade_id: capa.grade_id,
      });
      if (pcErr) throw pcErr;

      const now = new Date().toLocaleString("pt-BR");
      const historico = [...(capa.historico ?? [])];
      historico.push({ ts: now, campo: "Reunião de alinhamento", de: "—", para: reuniaoAlinhamento });

      const { error: capaErr } = await supabase
        .from("capa_edital")
        .update({ contrato_id: contrato.id, reuniao_alinhamento: reuniaoAlinhamento, historico })
        .eq("id", capa.id);
      if (capaErr) throw capaErr;

      return contrato;
    },
    onSuccess: (contrato) => {
      qc.invalidateQueries({ queryKey: QK(empresaId) });
      qc.invalidateQueries({ queryKey: ["implantacao", empresaId] });
      qc.invalidateQueries({ queryKey: ["contratos_erp", empresaId] });
      toast({ title: `Contrato "${contrato.nome}" criado no módulo de Implantação e em Contratos!` });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
