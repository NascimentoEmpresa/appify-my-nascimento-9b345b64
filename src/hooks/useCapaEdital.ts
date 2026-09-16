import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { HistoricoEntry } from "./useGrade";

export type CapaStatus = "Em andamento" | "Ganhamos" | "Perdemos" | "Não Participado";

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

// SIS-2026-0309: `todasEmpresas` (mesmo padrão de useGrade/useContratosERP)
// lê a Capa de Edital de TODAS as empresas do grupo — usuário já tem acesso
// a todas, o filtro por empresa ativa só limitava a visão.
export function useCapaEdital(empresaId: string | null, opts?: { todasEmpresas?: boolean }) {
  const todasEmpresas = opts?.todasEmpresas ?? false;
  return useQuery({
    queryKey: todasEmpresas ? ["capa-edital", "todas"] : QK(empresaId ?? ""),
    enabled: todasEmpresas || !!empresaId,
    queryFn: async () => {
      let q = (supabase as any).from("capa_edital").select("*").order("created_at", { ascending: false });
      if (!todasEmpresas) q = q.eq("empresa_id", empresaId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CapaEdital[];
    },
  });
}

// SIS-2026-0309: `empresa_id` passa a ser campo explícito do payload
// (obrigatório na criação), não mais herdado da empresa "ativa" do
// seletor global.
export function useCapaInsert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<CapaEdital>) => {
      if (!payload.empresa_id) throw new Error("Empresa é obrigatória.");
      const { data, error } = await (supabase as any)
        .from("capa_edital")
        .insert({
          ...payload,
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
      qc.invalidateQueries({ queryKey: ["capa-edital"] });
      toast({ title: "Licitação cadastrada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useCapaUpdate() {
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

      // Sincroniza grade: Ganhamos → posicao=1 + Finalizada; Perdemos → só Finalizada;
      // Não Participado → fase Não Participado (posicao não é alterada).
      if (changes.status && changes.status !== current.status && current.grade_id) {
        const novaFaseGrade =
          changes.status === "Ganhamos" ? "Finalizada" :
          changes.status === "Perdemos" ? "Finalizada" :
          changes.status === "Não Participado" ? "Não Participado" :
          null;
        const gradeChanges =
          changes.status === "Ganhamos"
            ? { posicao: 1, fase: "Finalizada" as const }
            : changes.status === "Perdemos"
            ? { fase: "Finalizada" as const }
            : changes.status === "Não Participado"
            ? { fase: "Não Participado" as const }
            : null;
        if (gradeChanges && novaFaseGrade) {
          // Busca estado atual da grade e usuário para registrar no histórico
          const [{ data: gradeAtual }, { data: authData }] = await Promise.all([
            (supabase as any).from("grade").select("fase, posicao, historico").eq("id", current.grade_id).single(),
            supabase.auth.getUser(),
          ]);
          const { data: profile } = authData?.user
            ? await supabase.from("profiles").select("display_name, email").eq("id", authData.user.id).maybeSingle()
            : { data: null };
          const usuario = (profile as any)?.display_name || (profile as any)?.email || authData?.user?.email || "—";

          const gradeHistorico = [...((gradeAtual as any)?.historico ?? [])];
          gradeHistorico.push({ ts: now, usuario, campo: "Fase", de: (gradeAtual as any)?.fase ?? "—", para: novaFaseGrade });
          if (changes.status === "Ganhamos") {
            const posAnterior = (gradeAtual as any)?.posicao;
            gradeHistorico.push({ ts: now, usuario, campo: "Posição", de: posAnterior ? `${posAnterior}º` : "—", para: "1º" });
          }

          await (supabase as any).from("grade").update({ ...gradeChanges, historico: gradeHistorico }).eq("id", current.grade_id);
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

      const { data, error } = await (supabase as any)
        .from("capa_edital")
        .update({ ...changes, historico })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as CapaEdital;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capa-edital"] });
      toast({ title: "Licitação atualizada!" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

export function useCapaDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("capa_edital").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["capa-edital"] });
      toast({ title: "Excluído." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}

// SIS-2026-0309 (raiz do bug real do contrato CEITEC, que nasceu na
// empresa errada): a empresa do contrato/implantação promovido vem da
// PRÓPRIA Capa (capa.empresa_id) — origem da cadeia — nunca mais de um
// parâmetro externo sourced da empresa "ativa" do seletor. Sem isso, promover
// uma Capa enquanto a empresa ativa era outra criava tudo na empresa errada.
export function useCapaPromover() {
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

      const { data: contrato, error: cErr } = await (supabase as any)
        .from("implantacao_contrato")
        .insert({
          empresa_id: capa.empresa_id,
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
        empresa_id: capa.empresa_id,
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

      const { error: capaErr } = await (supabase as any)
        .from("capa_edital")
        .update({ contrato_id: contrato.id, reuniao_alinhamento: reuniaoAlinhamento, historico })
        .eq("id", capa.id);
      if (capaErr) throw capaErr;

      return contrato;
    },
    onSuccess: (contrato) => {
      qc.invalidateQueries({ queryKey: ["capa-edital"] });
      qc.invalidateQueries({ queryKey: ["implantacao"] });
      qc.invalidateQueries({ queryKey: ["contratos_erp"] });
      toast({ title: `Contrato "${contrato.nome}" criado no módulo de Implantação e em Contratos!` });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
