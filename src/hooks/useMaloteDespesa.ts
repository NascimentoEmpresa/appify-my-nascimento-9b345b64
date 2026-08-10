import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OrigemDespesa = "solicitacao" | "despesa_unica" | "despesa_multi_classificacao";
export type StatusDespesa = "rascunho" | "pendente_aprovacao";
export type TipoMovimento = "entrada" | "saida";

export interface RateioLinha {
  id?: string;
  classificacao_id?: string | null;
  empresa_id: string | null;
  contrato_id: string | null;
  fornecedor_id: string | null;
  integrante_empregado_id: number | null;
  percentual: number | null;
  valor: number;
  ordem: number;
}

export interface Parcela {
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
}

export interface MaloteDespesaRow {
  id: string;
  empresa_id: string;
  classificacao_id: string | null;
  origem: OrigemDespesa;
  status: StatusDespesa;
  nome: string;
  valor_total: number;
  motivo: string | null;
  descricao: string | null;
  links: string | null;
  tipo_movimento: TipoMovimento | null;
  data_pagamento: string | null;
  competencia: string | null;
  forma_pagamento: string | null;
  informacoes_pagamento: string | null;
  parcelado: boolean;
  numero_parcelas: number | null;
  dia_desconto: number | null;
  arquivos: string[];
  created_at: string;
  created_by: string;
  classificacao?: { id: string; nome: string } | null;
}

const DESPESA_KEY = "malote_despesa";

const DESPESA_COLUMNS =
  "id, empresa_id, classificacao_id, origem, status, nome, valor_total, motivo, descricao, links, tipo_movimento, " +
  "data_pagamento, competencia, forma_pagamento, informacoes_pagamento, parcelado, numero_parcelas, dia_desconto, " +
  "arquivos, created_at, created_by, classificacao:classificacao_id(id, nome)";

// ── Catálogos usados no rateio ──────────────────────────────────────────
export function useEmpresasGrupo() {
  return useQuery({
    queryKey: ["malote_empresas_grupo"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, razao_social, nome_fantasia").eq("ativa", true).order("razao_social");
      if (error) throw error;
      return (data ?? []).map((e) => ({ id: e.id, nome: e.nome_fantasia || e.razao_social }));
    },
  });
}

export function useContratosAtivos() {
  return useQuery({
    queryKey: ["malote_contratos_ativos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("contratos").select("id, nome, empresa_id").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; empresa_id: string }[];
    },
  });
}

export function useFornecedoresAtivos() {
  return useQuery({
    queryKey: ["malote_fornecedores_ativos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("fornecedor").select("id, razao_social, nome_fantasia").order("razao_social");
      if (error) throw error;
      return (data ?? []).map((f: any) => ({ id: f.id, nome: f.nome_fantasia || f.razao_social }));
    },
  });
}

export function useIntegrantes() {
  return useQuery({
    queryKey: ["malote_integrantes"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("EMPREGADOS")
        .select('"ID", "Nome", "Situação"')
        .eq("Situação", "Trabalhando")
        .order("Nome")
        .limit(2000);
      if (error) throw error;
      return (data ?? []).map((e: any) => ({ id: e.ID as number, nome: e.Nome as string }));
    },
  });
}

// ── Despesas ──────────────────────────────────────────────────────────
export function useMinhasDespesas() {
  return useQuery({
    queryKey: [DESPESA_KEY, "minhas"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data, error } = await (supabase as any)
        .from("malote_despesa")
        .select(DESPESA_COLUMNS)
        .eq("created_by", u.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MaloteDespesaRow[];
    },
  });
}

export function useDespesa(id: string | undefined) {
  return useQuery({
    queryKey: [DESPESA_KEY, id],
    enabled: !!id,
    queryFn: async () => {
      const [despesaRes, rateioRes, parcelasRes] = await Promise.all([
        (supabase as any).from("malote_despesa").select(DESPESA_COLUMNS).eq("id", id).single(),
        (supabase as any).from("malote_despesa_rateio_linha").select("*").eq("despesa_id", id).order("ordem"),
        (supabase as any).from("malote_despesa_parcela").select("*").eq("despesa_id", id).order("numero_parcela"),
      ]);
      if (despesaRes.error) throw despesaRes.error;
      if (rateioRes.error) throw rateioRes.error;
      if (parcelasRes.error) throw parcelasRes.error;
      return {
        despesa: despesaRes.data as MaloteDespesaRow,
        rateio: (rateioRes.data ?? []) as RateioLinha[],
        parcelas: (parcelasRes.data ?? []) as Parcela[],
      };
    },
  });
}

interface SalvarDespesaInput {
  id?: string;
  empresa_id: string;
  classificacao_id: string | null;
  origem: OrigemDespesa;
  status: StatusDespesa;
  nome: string;
  valor_total: number;
  motivo?: string | null;
  descricao?: string | null;
  links?: string | null;
  tipo_movimento?: TipoMovimento | null;
  data_pagamento?: string | null;
  competencia?: string | null;
  forma_pagamento?: string | null;
  informacoes_pagamento?: string | null;
  parcelado?: boolean;
  numero_parcelas?: number | null;
  dia_desconto?: number | null;
  arquivos?: string[];
  rateio?: RateioLinha[];
  parcelas?: Parcela[];
}

export function useSalvarDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarDespesaInput) => {
      const { rateio, parcelas, ...despesaInput } = input;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sessão expirada.");

      const payload = { ...despesaInput, created_by: input.id ? undefined : u.user.id };
      const { data: despesa, error } = await (supabase as any)
        .from("malote_despesa")
        .upsert(payload)
        .select("id")
        .single();
      if (error) throw error;
      const despesaId = despesa.id as string;

      if (rateio) {
        await (supabase as any).from("malote_despesa_rateio_linha").delete().eq("despesa_id", despesaId);
        if (rateio.length > 0) {
          const rows = rateio.map((r, i) => ({ ...r, id: undefined, despesa_id: despesaId, ordem: i }));
          const { error: rErr } = await (supabase as any).from("malote_despesa_rateio_linha").insert(rows);
          if (rErr) throw rErr;
        }
      }

      if (parcelas) {
        await (supabase as any).from("malote_despesa_parcela").delete().eq("despesa_id", despesaId);
        if (parcelas.length > 0) {
          const rows = parcelas.map((p) => ({ ...p, despesa_id: despesaId }));
          const { error: pErr } = await (supabase as any).from("malote_despesa_parcela").insert(rows);
          if (pErr) throw pErr;
        }
      }

      return despesaId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

export function useExcluirDespesa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("malote_despesa").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [DESPESA_KEY] }),
  });
}

// ── Upload de anexos ─────────────────────────────────────────────────
export async function uploadAnexoMalote(file: File, despesaFolderId: string): Promise<string> {
  const ext = file.name.split(".").pop();
  const path = `${despesaFolderId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("malote-anexos").upload(path, file);
  if (error) throw error;
  return path;
}

/** Gera N parcelas iguais (a última absorve o resto de arredondamento). */
export function gerarParcelas(valorTotal: number, numeroParcelas: number, dataPagamento: string, diaDesconto: number | null): Parcela[] {
  if (numeroParcelas <= 0) return [];
  const valorParcela = Math.floor((valorTotal / numeroParcelas) * 100) / 100;
  const somaParcelas = valorParcela * (numeroParcelas - 1);
  const ultimaParcela = Math.round((valorTotal - somaParcelas) * 100) / 100;

  const base = new Date(dataPagamento + "T00:00:00");
  const parcelas: Parcela[] = [];
  for (let i = 0; i < numeroParcelas; i++) {
    const venc = new Date(base.getFullYear(), base.getMonth() + i, diaDesconto ?? base.getDate());
    parcelas.push({
      numero_parcela: i + 1,
      valor: i === numeroParcelas - 1 ? ultimaParcela : valorParcela,
      data_vencimento: venc.toISOString().slice(0, 10),
    });
  }
  return parcelas;
}
