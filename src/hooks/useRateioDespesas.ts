import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadAnexosMalote } from "@/hooks/useMaloteDespesa";
import type { CriterioRateio, ItemRateio, ParteGuia, TipoRateio } from "@/lib/rh/rateioDespesas";

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
  /** Guia do FGTS: "fgts" ou "consignado" (cada parte rateia o seu valor). */
  parte?: ParteGuia | null;
  /** Relação de Eventos sem CPF: a matrícula (Cadastro) lida do PDF. */
  cadastro?: string | null;
  /**
   * Documento de um contrato só, sem lista (boleto do sindicato, BSF
   * escaneado): a linha leva 100% do valor da despesa, seja qual for — o
   * contrato veio do nome do arquivo.
   */
  inteiro?: boolean;
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
  // Envio ao Malote (mig 20261016000020).
  malote_despesa_id: string | null;
  enviado_malote_em: string | null;
  enviado_malote_por_nome: string | null;
}

/** A despesa do Malote ligada ao rateio (rh_rateio_malote_info). */
export interface MaloteDoRateio {
  rateio_id: string;
  malote_despesa_id: string;
  numero: string;
  status: string;
  /** false = excluída/reprovada/cancelada no Malote: o rateio pode ser editado e reenviado. */
  ativo: boolean;
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
        .select("id,tipo,competencia,valor,descricao,criterio,status,anexo_path,anexo_nome,criado_por_nome,alterado_por_nome,created_at,updated_at,malote_despesa_id,enviado_malote_em,enviado_malote_por_nome")
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

/** Matrícula da Relação de Eventos (sem CPF) → colaborador e contrato (mig 20261021000070). */
export interface CadastroCasado {
  chave: string;
  nome: string | null;
  cadastro: string | null;
  situacao: string | null;
  contrato_id: string | null;
  casou_por: "matricula_nome" | "matricula" | "nome";
}

export async function casarCadastros(itens: { chave: string; empresa: number | null; cadastro: string | null; nome: string | null }[]): Promise<CadastroCasado[]> {
  if (!itens.length) return [];
  const { data, error } = await sb.rpc<CadastroCasado[]>("rh_rateio_casar_cadastros", { _itens: itens });
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

/** O que a Edge rh-rateio-ia devolve — cada valor já conferido contra o PDF. */
export interface LeituraIaRateio {
  total_despesa: number | null;
  origem_total: string;
  base: string;
  linhas: { n: number; texto: string; valor: number; contrato_id: string | null; cpf: string | null; contrato_texto: string }[];
  soma: number;
  ignorado: string[];
  explicacao: string;
  alertas: string[];
}

/** Lê o texto do PDF com a I.A (o arquivo não sai do navegador: vão as linhas). */
export async function lerRateioComIa(linhas: string[], tipo: string): Promise<LeituraIaRateio> {
  const { data, error } = await supabase.functions.invoke("rh-rateio-ia", { body: { linhas, tipo } });
  if (error) {
    // A mensagem útil vem no corpo ({ error }), não no FunctionsHttpError.
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(corpo?.error ?? error.message);
  }
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as LeituraIaRateio;
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

/** Número/status no Malote dos rateios enviados (quem só tem o RH não lê malote_despesa). */
export function useMaloteDosRateios(ids: string[]) {
  return useQuery({
    queryKey: ["rh_rateio_malote_info", [...ids].sort().join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await sb.rpc<MaloteDoRateio[]>("rh_rateio_malote_info", { p_ids: ids });
      if (error) throw error;
      return new Map((data ?? []).map((m) => [m.rateio_id, m]));
    },
  });
}

/**
 * Envia o rateio conferido ao Malote como despesa nova (mig 20261016000020).
 * O id da despesa nasce aqui para os anexos subirem ANTES em
 * malote-anexos/<id>/ e entrarem no mesmo INSERT da RPC; se a RPC recusar,
 * os arquivos que subiram são apagados.
 */
export function useEnviarRateioMalote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { rateioId: string; despesa: Record<string, unknown> & { nome: string }; arquivos: File[] }) => {
      const despesaId = crypto.randomUUID();
      const paths = await uploadAnexosMalote(input.arquivos, despesaId, input.despesa.nome);
      const { error } = await sb.rpc("rh_rateio_enviar_malote", {
        p_rateio_id: input.rateioId,
        p_despesa_id: despesaId,
        p_despesa: { ...input.despesa, arquivos: paths },
      });
      if (error) {
        if (paths.length) await supabase.storage.from("malote-anexos").remove(paths).catch(() => undefined);
        throw error;
      }
      // Número pela RPC do RH: quem só tem o RH não lê malote_despesa (RLS).
      const { data: info } = await sb.rpc<MaloteDoRateio[]>("rh_rateio_malote_info", { p_ids: [input.rateioId] });
      return { despesaId, numero: info?.[0]?.numero ?? null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh_rateio_despesas"] });
      qc.invalidateQueries({ queryKey: ["rh_rateio_malote_info"] });
    },
  });
}

/** Rateio conferido e livre, como o Malote › Criar Despesa lista para importar. */
export interface RateioParaImportar {
  id: string;
  tipo: TipoRateio;
  competencia: string;
  valor: number;
  descricao: string | null;
  criterio: CriterioRateio;
  anexo_path: string | null;
  anexo_nome: string | null;
  conferido_por: string | null;
  atualizado_em: string;
  itens: { contrato_id: string | null; contrato_nome: string; valor: number; percentual: number }[];
}

/**
 * Rateios que o Malote pode importar (mig 20261019000003): conferidos e
 * ainda não usados em despesa. RPC porque quem lança no Malote pode não ter
 * a tela do RH. O vínculo e a trava acontecem no INSERT da despesa
 * (malote_despesa.rh_rateio_id + gatilho).
 */
export function useRateiosParaImportarMalote(habilitado: boolean) {
  return useQuery({
    queryKey: ["malote_rateios_rh_para_importar"],
    enabled: habilitado,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await sb.rpc<RateioParaImportar[]>("malote_rateios_rh_para_importar");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        valor: Number(r.valor),
        itens: (r.itens ?? []).map((i) => ({ ...i, valor: Number(i.valor), percentual: Number(i.percentual) })),
      }));
    },
  });
}

/** O anexo do rateio (bucket rh-rateio) como File, para seguir junto para o Malote. */
export async function baixarAnexoRateio(path: string, nome: string): Promise<File> {
  const { data, error } = await supabase.storage.from(BUCKET_RATEIO).download(path);
  if (error) throw error;
  return new File([data], nome, { type: data.type || undefined });
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
