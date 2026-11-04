import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nomeArquivoSeguro } from "@/lib/treinamentos/contratoTreinamento";

// =====================================================================
// Treinamentos por Contrato (mig 20261104006000). Tabelas fora do types.ts
// gerado, por isso o `as any` — mesmo padrão de useSolicitacoesTreinamento.
// Quem pode o quê é decidido pela RLS (menu treinamentos_contratos).
// =====================================================================

const sb = supabase as any;
export const BUCKET_TRN_CONTRATO = "trn-contrato";

export interface ContratoResumo {
  empresa: number; filial: number; nome: string; ativo: boolean;
  treinamentos: number; participantes: number; ultimo: string | null;
}
export interface TreinamentoContrato {
  id: number; empresa: number; filial: number; contrato_nome: string;
  nome: string; tema: string | null; data: string; horario_inicio: string | null; horario_fim: string | null;
  carga_horaria: number | null; responsavel: string | null; local: string | null; observacoes: string | null;
  solicitacao_id: number | null; created_at: string; updated_at: string;
}
export type TreinamentoContratoInput = Omit<TreinamentoContrato, "id" | "created_at" | "updated_at"> & { id?: number };
export interface ParticipanteContrato {
  id: number; treinamento_id: number; empregado_id: number | null; nome: string; cpf: string | null; cargo: string | null; presente: boolean;
}
export interface ArquivoContrato {
  id: number; treinamento_id: number; tipo: "foto" | "lista_presenca"; storage_path: string; nome_arquivo: string | null;
  mime: string | null; tamanho: number | null; data_foto: string | null; legenda: string | null; created_at: string;
}
export interface AvaliacaoContrato {
  id: number; treinamento_id: number; nome: string; cpf: string | null; nota: number | null; acertos: number | null; total: number | null;
  aprovado: boolean | null; respostas: Record<string, string>; respondido_em: string | null; origem: "planilha" | "digitacao";
}
export interface SatisfacaoContrato {
  id: number; treinamento_id: number; nome: string | null; nota: number | null; respostas: Record<string, string>;
  comentario: string | null; respondido_em: string | null; origem: "planilha" | "digitacao";
}
export interface ColaboradorOpcao { id: number; nome: string; cpf: string | null; cargo: string | null; contrato: string | null; situacao: string | null }
export interface SolicitacaoOpcao {
  id: number; protocolo: string; treinamento: string; assuntos: string | null; local_treinamento: string | null;
  data: string | null; horario_inicio: string | null; horario_fim: string | null; instrutor: string | null; status: string;
}

const numerico = <T extends Record<string, any>>(r: T, campos: string[]): T => {
  const o: any = { ...r };
  for (const c of campos) if (o[c] != null) o[c] = Number(o[c]);
  return o;
};

async function tudo<T>(montar: (de: number, ate: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar(de, de + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// ── Leitura ───────────────────────────────────────────────────────────────
export function useContratosTreinamento(empresa: number | null) {
  return useQuery({
    queryKey: ["trn-ct-contratos", empresa],
    staleTime: 60_000,
    queryFn: async (): Promise<ContratoResumo[]> => {
      const { data, error } = await sb.rpc("trn_ct_contratos", { _empresa: empresa });
      if (error) throw error;
      return (data ?? []).map((r: any) => numerico(r, ["empresa", "filial", "treinamentos", "participantes"]));
    },
  });
}

export interface FiltroTreinamentos { empresa?: number | null; filial?: number | null; de?: string | null; ate?: string | null }

export function useTreinamentosContrato(f: FiltroTreinamentos, enabled = true) {
  return useQuery({
    queryKey: ["trn-ct-treinamentos", f],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<TreinamentoContrato[]> => {
      const rows = await tudo<any>((de, ate) => {
        let q = sb.from("TRN_CONTRATO_TREINAMENTO").select("*").order("data", { ascending: false }).order("id", { ascending: false });
        if (f.empresa != null) q = q.eq("empresa", f.empresa);
        if (f.filial != null) q = q.eq("filial", f.filial);
        if (f.de) q = q.gte("data", f.de);
        if (f.ate) q = q.lte("data", f.ate);
        return q.range(de, ate);
      });
      return rows.map((r) => numerico(r, ["empresa", "filial", "carga_horaria"]));
    },
  });
}

export function useTreinamentoContrato(id: number | null) {
  return useQuery({
    queryKey: ["trn-ct-treinamento", id],
    enabled: !!id,
    queryFn: async (): Promise<TreinamentoContrato | null> => {
      const { data, error } = await sb.from("TRN_CONTRATO_TREINAMENTO").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? numerico(data, ["empresa", "filial", "carga_horaria"]) : null;
    },
  });
}

/** Filhos de vários treinamentos de uma vez (relatórios). ids vazio = nada. */
async function filhos<T>(tabela: string, ids: number[], ordem: string): Promise<T[]> {
  if (!ids.length) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const fatia = ids.slice(i, i + 200);
    out.push(...await tudo<T>((de, ate) => sb.from(tabela).select("*").in("treinamento_id", fatia).order(ordem).range(de, ate)));
  }
  return out;
}

export interface DadosTreinamentos {
  participantes: ParticipanteContrato[];
  arquivos: ArquivoContrato[];
  avaliacoes: AvaliacaoContrato[];
  satisfacao: SatisfacaoContrato[];
}

export function useDadosTreinamentos(ids: number[], enabled = true) {
  return useQuery({
    queryKey: ["trn-ct-dados", ids],
    enabled: enabled && ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<DadosTreinamentos> => {
      const [participantes, arquivos, avaliacoes, satisfacao] = await Promise.all([
        filhos<any>("TRN_CONTRATO_PARTICIPANTE", ids, "nome"),
        filhos<any>("TRN_CONTRATO_ARQUIVO", ids, "created_at"),
        filhos<any>("TRN_CONTRATO_AVALIACAO", ids, "nome"),
        filhos<any>("TRN_CONTRATO_SATISFACAO", ids, "created_at"),
      ]);
      return {
        participantes,
        arquivos,
        avaliacoes: avaliacoes.map((a) => numerico(a, ["nota"])),
        satisfacao: satisfacao.map((s) => numerico(s, ["nota"])),
      };
    },
  });
}

export function useColaboradoresContrato(empresa: number | null, filial: number | null, busca: string, enabled: boolean) {
  return useQuery({
    queryKey: ["trn-ct-colaboradores", empresa, filial, busca],
    enabled: enabled && empresa != null && filial != null,
    staleTime: 60_000,
    queryFn: async (): Promise<ColaboradorOpcao[]> => {
      const { data, error } = await sb.rpc("trn_ct_colaboradores", { _empresa: empresa, _filial: filial, _busca: busca.trim() || null });
      if (error) throw error;
      return (data ?? []).map((r: any) => numerico(r, ["id"]));
    },
  });
}

export function useSolicitacoesDoContrato(empresa: number | null, filial: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["trn-ct-solicitacoes", empresa, filial],
    enabled: enabled && empresa != null && filial != null,
    queryFn: async (): Promise<SolicitacaoOpcao[]> => {
      const { data, error } = await sb.rpc("trn_ct_solicitacoes", { _empresa: empresa, _filial: filial });
      if (error) throw error;
      return (data ?? []).map((r: any) => numerico(r, ["id"]));
    },
  });
}

/** URL assinada (1 h) de um arquivo do bucket privado. */
export async function urlArquivo(path: string, segundos = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_TRN_CONTRATO).createSignedUrl(path, segundos);
  if (error) throw error;
  return data.signedUrl;
}

export function useUrlsArquivos(arquivos: ArquivoContrato[]) {
  const paths = arquivos.map((a) => a.storage_path);
  return useQuery({
    queryKey: ["trn-ct-urls", paths],
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from(BUCKET_TRN_CONTRATO).createSignedUrls(paths, 3600);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
      return out;
    },
  });
}

// ── Escrita ───────────────────────────────────────────────────────────────
function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["trn-ct-contratos", "trn-ct-treinamentos", "trn-ct-treinamento", "trn-ct-dados", "trn-ct-solicitacoes"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

export function useSalvarTreinamento() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (t: TreinamentoContratoInput): Promise<number> => {
      const { id, ...campos } = t;
      if (id) {
        const { error } = await sb.from("TRN_CONTRATO_TREINAMENTO").update(campos).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await sb.from("TRN_CONTRATO_TREINAMENTO").insert(campos).select("id").single();
      if (error) throw error;
      return Number(data.id);
    },
    onSuccess: invalidar,
  });
}

export function useExcluirTreinamento() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data: arqs, error: e1 } = await sb.from("TRN_CONTRATO_ARQUIVO").select("storage_path").eq("treinamento_id", id);
      if (e1) throw e1;
      const { error } = await sb.from("TRN_CONTRATO_TREINAMENTO").delete().eq("id", id);
      if (error) throw error;
      const paths = (arqs ?? []).map((a: any) => a.storage_path);
      if (paths.length) await supabase.storage.from(BUCKET_TRN_CONTRATO).remove(paths);
    },
    onSuccess: invalidar,
  });
}

export function useParticipantesMutacoes() {
  const invalidar = useInvalidar();
  const adicionar = useMutation({
    mutationFn: async (linhas: Omit<ParticipanteContrato, "id">[]) => {
      if (!linhas.length) return;
      const { error } = await sb.from("TRN_CONTRATO_PARTICIPANTE").insert(linhas);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
  const marcarPresenca = useMutation({
    mutationFn: async ({ ids, presente }: { ids: number[]; presente: boolean }) => {
      const { error } = await sb.from("TRN_CONTRATO_PARTICIPANTE").update({ presente }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
  const remover = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from("TRN_CONTRATO_PARTICIPANTE").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
  return { adicionar, marcarPresenca, remover };
}

export function useArquivosMutacoes() {
  const invalidar = useInvalidar();
  const enviar = useMutation({
    mutationFn: async ({ treinamento, tipo, arquivos, data_foto, legenda }: {
      treinamento: TreinamentoContrato; tipo: ArquivoContrato["tipo"]; arquivos: File[]; data_foto?: string | null; legenda?: string | null;
    }) => {
      for (const f of arquivos) {
        const path = `${treinamento.empresa}/${treinamento.filial}/${treinamento.id}/${tipo}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${nomeArquivoSeguro(f.name)}`;
        const up = await supabase.storage.from(BUCKET_TRN_CONTRATO).upload(path, f, { contentType: f.type || undefined, upsert: false });
        if (up.error) throw up.error;
        const { error } = await sb.from("TRN_CONTRATO_ARQUIVO").insert({
          treinamento_id: treinamento.id, tipo, storage_path: path, nome_arquivo: f.name, mime: f.type || null,
          tamanho: f.size, data_foto: tipo === "foto" ? (data_foto || treinamento.data) : null, legenda: legenda?.trim() || null,
        });
        if (error) { await supabase.storage.from(BUCKET_TRN_CONTRATO).remove([path]); throw error; }
      }
    },
    onSuccess: invalidar,
  });
  const remover = useMutation({
    mutationFn: async (a: ArquivoContrato) => {
      const { error } = await sb.from("TRN_CONTRATO_ARQUIVO").delete().eq("id", a.id);
      if (error) throw error;
      await supabase.storage.from(BUCKET_TRN_CONTRATO).remove([a.storage_path]);
    },
    onSuccess: invalidar,
  });
  return { enviar, remover };
}

type Tabela = "TRN_CONTRATO_AVALIACAO" | "TRN_CONTRATO_SATISFACAO";
export function useRespostasMutacoes(tabela: Tabela) {
  const invalidar = useInvalidar();
  const inserir = useMutation({
    mutationFn: async (linhas: Record<string, unknown>[]) => {
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await sb.from(tabela).insert(linhas.slice(i, i + 500));
        if (error) throw error;
      }
    },
    onSuccess: invalidar,
  });
  const remover = useMutation({
    mutationFn: async (ids: number[]) => {
      const { error } = await sb.from(tabela).delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
  return { inserir, remover };
}
