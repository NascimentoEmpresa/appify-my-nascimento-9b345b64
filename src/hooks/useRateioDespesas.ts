import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { CriterioRateio, ItemRateio, TipoRateio } from "@/lib/rh/rateioDespesas";

// =====================================================================
// RH › Rateio de Despesas — acesso a dados (mig 20261016000010).
// Leitura direta das tabelas (RLS: rh_rateio_pode('visualizar')); escrita
// só pelas RPCs rh_rateio_salvar/excluir. CPF → contrato pela RPC
// rh_rateio_casar_cpfs (nunca .from("EMPREGADOS"): a linha carrega salário
// e conta bancária).
// =====================================================================

type ChamadaRpc = <T>(
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: T | null; error: { message: string } | null }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { rpc: ChamadaRpc; from: (t: string) => any };

export const BUCKET_RATEIO = "rh-rateio";

export interface ContratoRateio {
  contrato_id: string | null;
  nome: string | null;
  status: string | null;
  colaboradores: number;
}

export interface LinhaDetalhePdf {
  n: number;
  texto: string;
  cpf: string | null;
  nome: string | null;
  situacao: string | null;
  valor: number;
  contrato_id: string | null;
}

export interface DespesaRateio {
  id: string;
  tipo: TipoRateio;
  competencia: string;
  valor: number;
  descricao: string | null;
  criterio: CriterioRateio;
  status: "rascunho" | "conferido";
  anexo_path: string | null;
  anexo_nome: string | null;
  detalhe: LinhaDetalhePdf[] | null;
  criado_por_nome: string | null;
  alterado_por_nome: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemRateioGravado extends ItemRateio {
  id: string;
  despesa_id: string;
  qtd: number | null;
  ordem: number;
}

export interface CpfCasado {
  cpf: string;
  nome: string | null;
  cadastro: string | null;
  situacao: string | null;
  contrato_id: string | null;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

export function useContratosRateio() {
  return useQuery({
    queryKey: ["rh_rateio_contratos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc<ContratoRateio[]>("rh_rateio_contratos");
      if (error) throw error;
      return (data ?? []).map((c) => ({ ...c, colaboradores: num(c.colaboradores) }));
    },
  });
}

export function useDespesasRateio() {
  return useQuery({
    queryKey: ["rh_rateio_despesas"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("RH_RATEIO_DESPESA")
        .select("id,tipo,competencia,valor,descricao,criterio,status,anexo_path,anexo_nome,criado_por_nome,alterado_por_nome,created_at,updated_at")
        .order("competencia", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return ((data ?? []) as DespesaRateio[]).map((d) => ({ ...d, valor: num(d.valor), detalhe: null }));
    },
  });
}

export async function carregarDespesaRateio(id: string) {
  const [d, i] = await Promise.all([
    sb.from("RH_RATEIO_DESPESA").select("*").eq("id", id).single(),
    sb.from("RH_RATEIO_ITEM").select("*").eq("despesa_id", id).order("ordem"),
  ]);
  if (d.error) throw d.error;
  if (i.error) throw i.error;
  const despesa = { ...(d.data as DespesaRateio), valor: num(d.data.valor) };
  const itens = ((i.data ?? []) as ItemRateioGravado[]).map((x) => ({
    ...x, base: num(x.base), percentual: num(x.percentual), valor: num(x.valor),
  }));
  return { despesa, itens };
}

/** Último rateio do mesmo tipo (para reaproveitar o faturamento por contrato). */
export async function carregarUltimoDoTipo(tipo: TipoRateio, excetoId?: string | null) {
  let q = sb.from("RH_RATEIO_DESPESA").select("id").eq("tipo", tipo).order("competencia", { ascending: false })
    .order("created_at", { ascending: false }).limit(1);
  if (excetoId) q = q.neq("id", excetoId);
  const { data, error } = await q;
  if (error) throw error;
  return data?.[0]?.id ? carregarDespesaRateio(data[0].id as string) : null;
}

export async function casarCpfs(cpfs: string[]): Promise<CpfCasado[]> {
  if (!cpfs.length) return [];
  const { data, error } = await sb.rpc<CpfCasado[]>("rh_rateio_casar_cpfs", { _cpfs: cpfs });
  if (error) throw error;
  return data ?? [];
}

export async function subirAnexoRateio(file: File) {
  const seguro = file.name.normalize("NFD").replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}_${seguro}`;
  const { error } = await supabase.storage.from(BUCKET_RATEIO).upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

export async function linkAnexoRateio(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET_RATEIO).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export interface SalvarRateio {
  id?: string | null;
  tipo: TipoRateio;
  competencia: string;
  valor: number;
  descricao: string | null;
  criterio: CriterioRateio;
  status: "rascunho" | "conferido";
  anexo_path: string | null;
  anexo_nome: string | null;
  detalhe: LinhaDetalhePdf[] | null;
  itens: (ItemRateio & { qtd?: number | null })[];
}

export function useSalvarRateio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: SalvarRateio) => {
      const { data, error } = await sb.rpc<string>("rh_rateio_salvar", { p });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh_rateio_despesas"] }),
  });
}

export function useExcluirRateio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: Pick<DespesaRateio, "id" | "anexo_path">) => {
      const { error } = await sb.rpc("rh_rateio_excluir", { p_id: d.id });
      if (error) throw error;
      if (d.anexo_path) await supabase.storage.from(BUCKET_RATEIO).remove([d.anexo_path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh_rateio_despesas"] }),
  });
}
