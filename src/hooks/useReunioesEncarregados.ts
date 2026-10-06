import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RegistroSugerido, TipoRegistro, Vinculo } from "@/lib/controladoria/reunioes";

// =====================================================================
// Controladoria › Reuniões com Encarregados — dados (mig 20261006000005).
// Leitura direta nas tabelas CTRL_REUNIAO* (RLS cobra o menu
// ctrl_reunioes_encarregados); a importação vai pela RPC
// ctrl_reuniao_importar, que grava reunião + registros + vínculos juntos.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = { reunioes: "ctrl-reunioes", registros: "ctrl-reuniao-registros", acoes: "ctrl-reuniao-acoes", vinculos: "ctrl-reuniao-vinculos" };

export interface Reuniao {
  id: string; titulo: string; data_reuniao: string | null; supervisor: string | null; contrato: string | null; equipe: string | null;
  participantes: string[]; arquivo_nome: string | null; created_at: string;
}
export type StatusRegistro = "pendente" | "validado" | "excluido";
export interface Registro {
  id: string; reuniao_id: string; ordem: number; falante: string | null; encarregado: string | null; contrato: string | null;
  trecho: string; tema: string; tipo: TipoRegistro; status: StatusRegistro; revisado_em: string | null;
}
export type SituacaoAcao = "aberta" | "andamento" | "concluida";
export interface Acao {
  id: string; registro_id: string | null; reuniao_id: string | null; descricao: string; responsavel: string | null;
  prazo: string | null; situacao: SituacaoAcao; contrato: string | null; tema: string | null; created_at: string;
}
export interface VinculoSalvo extends Vinculo { id: string }

/** PostgREST corta em 1.000 linhas sem avisar — pagina até acabar. */
async function buscarTodos<T>(tabela: string, colunas: string, ordem: string): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from(tabela).select(colunas).order(ordem).order("id").range(de, de + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export const useCtrlReunioes = () => useQuery({
  queryKey: [K.reunioes], staleTime: 60_000,
  queryFn: () => buscarTodos<Reuniao>("CTRL_REUNIAO", "id,titulo,data_reuniao,supervisor,contrato,equipe,participantes,arquivo_nome,created_at", "data_reuniao"),
});
export const useCtrlRegistros = () => useQuery({
  queryKey: [K.registros], staleTime: 60_000,
  queryFn: () => buscarTodos<Registro>("CTRL_REUNIAO_REGISTRO", "id,reuniao_id,ordem,falante,encarregado,contrato,trecho,tema,tipo,status,revisado_em", "created_at"),
});
export const useCtrlAcoes = () => useQuery({
  queryKey: [K.acoes], staleTime: 60_000,
  queryFn: () => buscarTodos<Acao>("CTRL_REUNIAO_ACAO", "*", "created_at"),
});
export const useCtrlVinculos = () => useQuery({
  queryKey: [K.vinculos], staleTime: 5 * 60_000,
  queryFn: () => buscarTodos<VinculoSalvo>("CTRL_REUNIAO_VINCULO", "id,nome_transcricao,encarregado,contrato", "encarregado"),
});

/** O texto integral só quando abre a reunião (pode ser grande). */
export const useCtrlTextoReuniao = (id: string | null) => useQuery({
  queryKey: [K.reunioes, "texto", id], enabled: !!id,
  queryFn: async () => {
    const { data, error } = await sb.from("CTRL_REUNIAO").select("texto").eq("id", id).single();
    if (error) throw error;
    return data.texto as string;
  },
});

function useInvalidar() {
  const qc = useQueryClient();
  return (...chaves: string[]) => chaves.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export interface ReuniaoParaImportar {
  titulo: string; data_reuniao: string | null; supervisor: string; contrato: string; equipe: string;
  participantes: string[]; arquivo_nome: string | null; texto: string; registros: RegistroSugerido[];
}

export function useCtrlImportar() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ reunioes, vinculos }: { reunioes: ReuniaoParaImportar[]; vinculos: Vinculo[] }) => {
      const ids: string[] = [];
      // Uma reunião por chamada: se uma falhar, as anteriores já ficaram salvas e a tela diz qual parou.
      for (const r of reunioes) {
        const { registros, ...reuniao } = r;
        const { data, error } = await sb.rpc("ctrl_reuniao_importar", { p_reuniao: reuniao, p_registros: registros, p_vinculos: ids.length ? [] : vinculos });
        if (error) throw new Error(`"${r.titulo}": ${error.message}`);
        ids.push(data as string);
      }
      return ids;
    },
    onSuccess: () => inv(K.reunioes, K.registros, K.vinculos),
  });
}

export function useCtrlAtualizarRegistros() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async ({ ids, campos }: { ids: string[]; campos: Partial<Pick<Registro, "tema" | "tipo" | "status" | "trecho" | "encarregado" | "contrato">> }) => {
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await sb.from("CTRL_REUNIAO_REGISTRO").update(campos).in("id", ids.slice(i, i + 200));
        if (error) throw error;
      }
    },
    onSuccess: () => inv(K.registros),
  });
}

export function useCtrlExcluirReuniao() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("CTRL_REUNIAO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => inv(K.reunioes, K.registros, K.acoes),
  });
}

export function useCtrlSalvarAcao() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async (a: Partial<Acao> & { descricao: string }) => {
      const { id, created_at, ...linha } = a as Acao;
      const { error } = id ? await sb.from("CTRL_REUNIAO_ACAO").update(linha).eq("id", id) : await sb.from("CTRL_REUNIAO_ACAO").insert(linha);
      if (error) throw error;
    },
    onSuccess: () => inv(K.acoes),
  });
}

export function useCtrlExcluirAcao() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("CTRL_REUNIAO_ACAO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => inv(K.acoes),
  });
}

export function useCtrlSalvarVinculo() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async (v: Partial<VinculoSalvo> & Vinculo) => {
      const { id, ...linha } = v;
      const { error } = id ? await sb.from("CTRL_REUNIAO_VINCULO").update(linha).eq("id", id) : await sb.from("CTRL_REUNIAO_VINCULO").insert(linha);
      if (error) throw error.code === "23505" ? new Error("Já existe um vínculo para esse nome na transcrição.") : error;
    },
    onSuccess: () => inv(K.vinculos),
  });
}

export function useCtrlExcluirVinculo() {
  const inv = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("CTRL_REUNIAO_VINCULO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => inv(K.vinculos),
  });
}
