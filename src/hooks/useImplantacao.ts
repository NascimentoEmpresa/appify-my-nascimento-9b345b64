import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface ChecklistItem {
  id: string;
  row_index: number;
  setor: string;
  categoria: string | null;
  momento: string | null;
  item: string;
  tipo_resposta: string;
  prazo_limite: string | null;
  obs_default: string | null;
  resp_questionamento: string | null;
  plano_acao: string | null;
  responsavel_acao: string | null;
  onde: string | null;
  anotacoes: string | null;
  ordem: number;
}

export interface HistoricoEntry {
  resposta: string | null;
  obs: string | null;
  por: string | null;
  ts: string;
}

export interface Resposta {
  id: string;
  empresa_id: string;
  contrato_id: string;
  row_index: number;
  resposta: string | null;
  obs: string | null;
  historico: HistoricoEntry[];
  updated_by: string | null;
}

export interface ImplantacaoContrato {
  id: string;
  empresa_id: string;
  nome: string;
  capa_id: string | null;
  status: "ativo" | "encerrado";
  data_inicio: string | null;
  abertura: string | null;
  reuniao_alinhamento: string | null;
  data_homologacao: string | null;
  created_at: string;
  updated_at: string;
}

// Balizadores por Momento (conforme planilha Base de dados)
const BALIZADORES: Record<string, { base: keyof ImplantacaoContrato; dias: number; sufixo?: string }[]> = {
  "Captação":               [{ base: "abertura",          dias: -4 }],
  "Grade de licitações":    [{ base: "abertura",          dias: -4 }],
  "Capa de edital":         [{ base: "abertura",          dias: -4 }],
  "Cadastro de edital":     [{ base: "data_homologacao",  dias:  2, sufixo: "após homologação" }],
  "Reunião de alinhamento": [
    { base: "data_homologacao", dias:  2, sufixo: "após homologação" },
    { base: "data_inicio",      dias: -40, sufixo: "antes do contrato" },
  ],
  "Reunião de implantação": [{ base: "data_inicio", dias: -10 }],
};

function parsePTDate(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

function addDays(base: string, days: number): Date | null {
  const d = parsePTDate(base) ?? new Date(base + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
}

function fmtPT(d: Date) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// Calcula prazo dinâmico baseado no prazo_limite do item e nas datas do contrato
export function calcPrazo(item: ChecklistItem, contrato: ImplantacaoContrato): string | null {
  const prazo = (item.prazo_limite ?? "").trim();
  if (!prazo) return null;

  // "Momento =" → usa balizadores
  if (/^momento\s*=/i.test(prazo) && item.momento) {
    const bals = BALIZADORES[item.momento];
    if (!bals) return item.momento in BALIZADORES ? null : prazo;
    const parts: string[] = [];
    for (const bal of bals) {
      const baseVal = contrato[bal.base] as string | null;
      if (!baseVal) continue;
      const d = addDays(baseVal, bal.dias);
      if (!d) continue;
      parts.push(fmtPT(d) + (bal.sufixo ? ` (${Math.abs(bal.dias)} dias ${bal.sufixo})` : ` (${Math.abs(bal.dias)} dias)`));
    }
    return parts.length ? parts.join(" · ") : null;
  }

  // Prazo numérico explícito, ex: "15 dias antes do inicio do contrato"
  const antesInicio = prazo.match(/(\d+)\s*dias?\s*antes\s*do\s*inicio\s*do\s*contrato/i);
  if (antesInicio && contrato.data_inicio) {
    const d = addDays(contrato.data_inicio, -parseInt(antesInicio[1]));
    if (d) return `${fmtPT(d)} (${prazo})`;
  }

  const aposInicio = prazo.match(/(\d+)\s*dias?\s*ap[oó]s\s*do?\s*inicio\s*do\s*contrato/i);
  if (aposInicio && contrato.data_inicio) {
    const d = addDays(contrato.data_inicio, +parseInt(aposInicio[1]));
    if (d) return `${fmtPT(d)} (${prazo})`;
  }

  const antesAbertura = prazo.match(/(\d+)\s*dias?\s*antes\s*da\s*abertura/i);
  if (antesAbertura && contrato.abertura) {
    const d = addDays(contrato.abertura, -parseInt(antesAbertura[1]));
    if (d) return `${fmtPT(d)} (${prazo})`;
  }

  const aposHomol = prazo.match(/(\d+)\s*(?:h|hs|horas?|dias?)\s*ap[oó]s\s*(?:a\s*)?homologa[çc][aã]o/i);
  if (aposHomol && contrato.data_homologacao) {
    const d = addDays(contrato.data_homologacao, +parseInt(aposHomol[1]));
    if (d) return `${fmtPT(d)} (${prazo})`;
  }

  const antesCurt = prazo.match(/(\d+)\s*dias?\s*antes\s*do\s*contrato/i);
  if (antesCurt && contrato.data_inicio) {
    const d = addDays(contrato.data_inicio, -parseInt(antesCurt[1]));
    if (d) return `${fmtPT(d)} (${prazo})`;
  }

  // Prazo livre (texto fixo)
  return prazo;
}

// ── Contratos ──────────────────────────────────────────────────────────────

// SIS-2026-0309: `todasEmpresas` lê a Implantação de TODAS as empresas do
// grupo, mesmo padrão já usado em useGrade/useCapaEdital/useContratosERP.
export function useImplantacaoContratos(empresaId: string | null, opts?: { todasEmpresas?: boolean }) {
  const todasEmpresas = opts?.todasEmpresas ?? false;
  return useQuery({
    queryKey: todasEmpresas ? ["implantacao", "todas"] : ["implantacao", empresaId],
    enabled: todasEmpresas || !!empresaId,
    queryFn: async () => {
      let q = (supabase as any).from("implantacao_contrato").select("*").order("created_at", { ascending: false });
      if (!todasEmpresas) q = q.eq("empresa_id", empresaId!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ImplantacaoContrato[];
    },
  });
}

// ── Checklist items (estáticos) ─────────────────────────────────────────────

export function useChecklistItems() {
  return useQuery({
    queryKey: ["checklist-items"],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("checklist_items")
        .select("*")
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as ChecklistItem[];
    },
  });
}

// ── Respostas por contrato ─────────────────────────────────────────────────

export function useRespostas(contratoId: string | null, empresaId: string | null) {
  return useQuery({
    queryKey: ["respostas", contratoId],
    enabled: !!contratoId && !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("checklist_respostas")
        .select("*")
        .eq("contrato_id", contratoId!)
        .eq("empresa_id", empresaId!);
      if (error) throw error;
      return (data ?? []) as Resposta[];
    },
  });
}

export function useRespostaUpsert(empresaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contratoId,
      rowIndex,
      resposta,
      obs,
    }: {
      contratoId: string;
      rowIndex: number;
      resposta: string;
      obs?: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();

      // Busca resposta atual para empurrar no histórico
      const { data: atual } = await (supabase as any)
        .from("checklist_respostas")
        .select("resposta, obs, historico, updated_by")
        .eq("contrato_id", contratoId)
        .eq("row_index", rowIndex)
        .maybeSingle();

      const historicoAtual: HistoricoEntry[] = (atual?.historico as HistoricoEntry[]) ?? [];
      const novoHistorico: HistoricoEntry[] = atual?.resposta
        ? [
            ...historicoAtual,
            {
              resposta: atual.resposta,
              obs: atual.obs ?? null,
              por: atual.updated_by ?? null,
              ts: new Date().toISOString(),
            },
          ]
        : historicoAtual;

      const { error } = await (supabase as any).from("checklist_respostas").upsert(
        {
          empresa_id: empresaId,
          contrato_id: contratoId,
          row_index: rowIndex,
          resposta,
          obs: obs ?? null,
          historico: novoHistorico,
          updated_by: user?.id ?? null,
        },
        { onConflict: "contrato_id,row_index" }
      );
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["respostas", vars.contratoId] });
    },
    onError: (e: Error) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });
}
