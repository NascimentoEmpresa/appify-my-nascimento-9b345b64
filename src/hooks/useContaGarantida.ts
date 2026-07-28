import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { MovimentoInput } from "@/pages/financeiro/conta-garantida/calculos";

const BANCOS_KEY = "fin_conta_garantida_banco";
const MOVIMENTOS_KEY = "fin_conta_garantida_movimento";
const CDI_KEY = "fin_cdi_historico";

export interface BancoContaGarantida {
  id: string;
  nome: string;
  limite: number;
  taxa_mensal: number;
  perc_cdi: number;
  vencimento: string | null;
  ativo: boolean;
}

export function useBancosContaGarantida() {
  return useQuery({
    queryKey: [BANCOS_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fin_conta_garantida_banco")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as BancoContaGarantida[];
    },
  });
}

interface SalvarBancoInput extends Omit<BancoContaGarantida, "id"> {
  id?: string;
}

export function useSalvarBancoContaGarantida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarBancoInput) => {
      const { error } = await (supabase as any)
        .from("fin_conta_garantida_banco")
        .upsert(input, { onConflict: "nome" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [BANCOS_KEY] }),
  });
}

export function useToggleBancoAtivo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase as any)
        .from("fin_conta_garantida_banco")
        .update({ ativo })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [BANCOS_KEY] }),
  });
}

export function useMovimentosContaGarantida() {
  return useQuery({
    queryKey: [MOVIMENTOS_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fin_conta_garantida_movimento")
        .select("data, banco, tipo, classificacao, valor")
        .order("data");
      if (error) throw error;
      return (data ?? []) as MovimentoInput[];
    },
  });
}

// Mesmos termos de classificação usados no motor legado (_calcular_financeiro)
// pra decidir quais linhas do Fluxo de Caixa importar.
const TERMOS_RELEVANTES = ["CHEQUE ESPECIAL", "APLICAÇÃO", "APLICACAO", "JUROS", "JURO", "RENDIMENTO"];
const TERMOS_EXCLUIR = ["RESGATE CONTA VINCULADA"];

function excelParaData(valor: unknown): Date | null {
  if (valor instanceof Date) return valor;
  if (typeof valor === "number") {
    return new Date(Math.round((valor - 25569) * 86400 * 1000));
  }
  if (typeof valor === "string" && valor.trim()) {
    const d = new Date(valor);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function limparValor(valor: unknown): number {
  if (typeof valor === "number") return valor;
  if (typeof valor === "string") {
    const limpo = valor.replace("R$", "").replace(/\./g, "").replace(",", ".").trim();
    const n = parseFloat(limpo);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function parseFluxoCaixaXlsx(buf: ArrayBuffer): MovimentoInput[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhasBrutas: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  let headerIdx = -1;
  let colData = -1, colTipo = -1, colBanco = -1, colValor = -1, colClass = -1;
  for (let i = 0; i < Math.min(15, linhasBrutas.length); i++) {
    const linha = (linhasBrutas[i] ?? []).map((x) => String(x ?? "").toUpperCase().trim());
    const iData = linha.indexOf("DATA");
    const iBanco = linha.indexOf("BANCO");
    const iValor = linha.indexOf("VALOR");
    if (iData >= 0 && (iBanco >= 0 || iValor >= 0)) {
      headerIdx = i;
      colData = iData;
      colTipo = linha.indexOf("TIPO");
      colBanco = iBanco;
      colValor = iValor;
      colClass = linha.findIndex((c) => c.includes("CLASSIF") || c.includes("HIST"));
      break;
    }
  }
  if (headerIdx === -1) throw new Error("Cabeçalho não encontrado na planilha.");

  const movimentos: MovimentoInput[] = [];
  for (let i = headerIdx + 1; i < linhasBrutas.length; i++) {
    const row = linhasBrutas[i];
    if (!row || row.length === 0) continue;

    const banco = String(row[colBanco] ?? "").trim();
    const dt = excelParaData(row[colData]);
    if (!banco || !dt) continue;

    const classificacao = String(colClass >= 0 ? row[colClass] ?? "" : "").toUpperCase().trim();
    const relevante = TERMOS_RELEVANTES.some((t) => classificacao.includes(t)) && !TERMOS_EXCLUIR.some((t) => classificacao.includes(t));
    if (!relevante) continue;

    movimentos.push({
      data: dt.toISOString().slice(0, 10),
      banco,
      tipo: String(row[colTipo] ?? "").toUpperCase().trim(),
      classificacao,
      valor: limparValor(row[colValor]),
    });
  }
  return movimentos;
}

export function useImportarMovimentosContaGarantida() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arquivo: File) => {
      const buf = await arquivo.arrayBuffer();
      const movimentos = parseFluxoCaixaXlsx(buf);
      if (movimentos.length === 0) throw new Error("Nenhum movimento relevante encontrado na planilha.");

      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error: delError } = await (supabase as any).from("fin_conta_garantida_movimento").delete().not("id", "is", null);
      if (delError) throw delError;

      const payload = movimentos.map((m) => ({ ...m, importado_por: userId }));
      const { error: insError } = await (supabase as any).from("fin_conta_garantida_movimento").insert(payload);
      if (insError) throw insError;

      return movimentos.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [MOVIMENTOS_KEY] }),
  });
}

export function useCdiHistorico() {
  return useQuery({
    queryKey: [CDI_KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("fin_cdi_historico")
        .select("data, valor_pct")
        .order("data", { ascending: false });
      if (error) throw error;
      // valor_pct guarda a fração diária já decimal (ex: 0.00038), não %.
      return Object.fromEntries((data ?? []).map((r: any) => [r.data, Number(r.valor_pct)])) as Record<string, number>;
    },
  });
}

export function useAtualizarCdi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const resp = await fetch("https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/20?formato=json");
      if (!resp.ok) throw new Error("Não foi possível consultar o CDI no Bacen.");
      const dados: { data: string; valor: string }[] = await resp.json();

      const payload = dados.map((d) => {
        const [dia, mes, ano] = d.data.split("/");
        return { data: `${ano}-${mes}-${dia}`, valor_pct: Number(d.valor) / 100 };
      });
      const { error } = await (supabase as any).from("fin_cdi_historico").upsert(payload, { onConflict: "data" });
      if (error) throw error;
      return payload.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CDI_KEY] }),
  });
}
