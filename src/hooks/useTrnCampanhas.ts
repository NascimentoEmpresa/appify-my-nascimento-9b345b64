import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Campanha, CampanhaItem, CampanhaResposta, ProvaConfig, TipoItemCampanha } from "@/pages/treinamentos/plataforma/tipos";

// =====================================================================
// TREINAMENTOS › Campanhas — dados (mig 20260930000268).
//
// Gestão: tabelas TRN_CAMPANHA* direto, RLS pelo menu
// `treinamentos_campanhas`. Página pública (/campanhas/<slug>): só as RPCs
// trn_campanha_publica / trn_campanha_responder, que o anon pode chamar —
// o gabarito da provinha nunca vem para o navegador.
// =====================================================================

// As tabelas TRN_* não estão no types.ts gerado (ver tipos.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** Endereço público da campanha — é o que vai no QR Code. */
export const urlPublicaCampanha = (slug: string, itemId?: string) =>
  `${window.location.origin}/campanhas/${slug}${itemId ? `#item-${itemId}` : ""}`;

export interface CampanhaLista extends Campanha { itens: number; respostas: number; acessos: number }

export function useTrnCampanhas() {
  return useQuery({
    queryKey: ["trn-campanhas"],
    queryFn: async (): Promise<CampanhaLista[]> => {
      const { data, error } = await sb.from("TRN_CAMPANHA")
        .select("*, itens:TRN_CAMPANHA_ITEM(count), respostas:TRN_CAMPANHA_RESPOSTA(count), acessos:TRN_CAMPANHA_ACESSO(acessos)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({
        ...c,
        itens: c.itens?.[0]?.count ?? 0,
        respostas: c.respostas?.[0]?.count ?? 0,
        acessos: (c.acessos ?? []).reduce((s: number, a: { acessos: number }) => s + a.acessos, 0),
      }));
    },
  });
}

export function useTrnCampanha(id: string | null | undefined) {
  return useQuery({
    queryKey: ["trn-campanha", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: c, error }, { data: itens, error: e2 }] = await Promise.all([
        sb.from("TRN_CAMPANHA").select("*").eq("id", id).single(),
        sb.from("TRN_CAMPANHA_ITEM").select("*").eq("campanha_id", id).order("posicao").order("created_at"),
      ]);
      if (error) throw error;
      if (e2) throw e2;
      return { campanha: c as Campanha, itens: (itens ?? []) as CampanhaItem[] };
    },
  });
}

export type CampanhaInput = Omit<Campanha, "id" | "slug" | "criado_por" | "created_at" | "updated_at"> & { id?: string; slug?: string | null };
export type ItemInput = Omit<CampanhaItem, "campanha_id" | "posicao">;

/**
 * Salva a campanha e o conteúdo inteiro de uma vez: upsert dos itens na
 * ordem da tela (posicao = índice) e remoção dos que saíram. Os ids dos
 * itens nascem no navegador (crypto.randomUUID) para o QR de um vídeo
 * poder ser gerado antes mesmo do primeiro salvar.
 */
export function useTrnSalvarCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ campanha, itens }: { campanha: CampanhaInput; itens: ItemInput[] }): Promise<Campanha> => {
      const { id, slug, ...resto } = campanha;
      const linha = { ...resto, ...(slug ? { slug } : {}) };
      const q = id ? sb.from("TRN_CAMPANHA").update(linha).eq("id", id) : sb.from("TRN_CAMPANHA").insert({ ...linha, slug: slug ?? "" });
      const { data: salva, error } = await q.select("*").single();
      if (error) throw error;

      const { data: atuais, error: e1 } = await sb.from("TRN_CAMPANHA_ITEM").select("id").eq("campanha_id", salva.id);
      if (e1) throw e1;
      const manter = new Set(itens.map((i) => i.id));
      const sair = (atuais ?? []).map((a: { id: string }) => a.id).filter((x: string) => !manter.has(x));
      if (sair.length) {
        const { error: e2 } = await sb.from("TRN_CAMPANHA_ITEM").delete().in("id", sair);
        if (e2) throw e2;
      }
      if (itens.length) {
        const { error: e3 } = await sb.from("TRN_CAMPANHA_ITEM")
          .upsert(itens.map((i, posicao) => ({ ...i, campanha_id: salva.id, posicao })), { onConflict: "id" });
        if (e3) throw e3;
      }
      return salva as Campanha;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["trn-campanhas"] });
      qc.invalidateQueries({ queryKey: ["trn-campanha", c.id] });
    },
  });
}

export function useTrnPublicarCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, publicada }: { id: string; publicada: boolean }) => {
      const { error } = await sb.from("TRN_CAMPANHA").update({ publicada }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["trn-campanhas"] });
      qc.invalidateQueries({ queryKey: ["trn-campanha", v.id] });
    },
  });
}

export function useTrnExcluirCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("TRN_CAMPANHA").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trn-campanhas"] }),
  });
}

export function useTrnDuplicarCampanha() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data, error } = await sb.rpc("trn_campanha_duplicar", { _id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trn-campanhas"] }),
  });
}

export function useTrnCampanhaRespostas(campanhaId: string | null | undefined) {
  return useQuery({
    queryKey: ["trn-campanha-respostas", campanhaId],
    enabled: !!campanhaId,
    queryFn: async () => {
      const { data, error } = await sb.from("TRN_CAMPANHA_RESPOSTA")
        .select("id, campanha_id, item_id, item_titulo, nome, documento, acertos, total, pontos, pontos_total, nota, aprovado, created_at")
        .eq("campanha_id", campanhaId).order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as CampanhaResposta[];
    },
  });
}

export function useTrnCampanhaAcessos(campanhaId: string | null | undefined) {
  return useQuery({
    queryKey: ["trn-campanha-acessos", campanhaId],
    enabled: !!campanhaId,
    queryFn: async () => {
      const { data, error } = await sb.from("TRN_CAMPANHA_ACESSO").select("dia, acessos").eq("campanha_id", campanhaId).order("dia");
      if (error) throw error;
      return (data ?? []) as { dia: string; acessos: number }[];
    },
  });
}

export function useTrnExcluirRespostaCampanha(campanhaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("TRN_CAMPANHA_RESPOSTA").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trn-campanha-respostas", campanhaId] });
      qc.invalidateQueries({ queryKey: ["trn-campanhas"] });
    },
  });
}

// ── Página pública ───────────────────────────────────────────────────

export interface PerguntaPublica { id: string; tipo: "unica" | "multipla" | "vf"; enunciado: string; opcoes: string[]; pontos: number }
export interface ItemPublico {
  id: string; tipo: TipoItemCampanha; titulo: string | null; texto: string | null;
  video_url: string | null; video_path: string | null; imagem_path: string | null;
  arquivo_path: string | null; arquivo_nome: string | null; link_url: string | null; link_rotulo: string | null;
  nota_minima: number;
  prova: { titulo: string; instrucoes: string | null; perguntas: PerguntaPublica[] } | null;
}
export interface CampanhaPublica {
  id: string; titulo: string; slug: string; resumo: string | null; capa_path: string | null; cor: string; fim_em: string | null;
  pedir_identificacao: boolean; pedir_documento: boolean; itens: ItemPublico[];
}
export interface ResultadoCampanha {
  nota: number; aprovado: boolean; nota_minima: number; pontos: number; pontos_total: number; acertos: number; total: number;
  itens: { id: string; ok: boolean; pontos: number; max: number; marcadas: number[]; corretas?: number[]; explicacao?: string | null }[] | null;
}

/** `contar = false` na prévia do editor, para não inflar os acessos. */
export function useCampanhaPublica(slug: string | undefined, contar = true) {
  return useQuery({
    queryKey: ["campanha-publica", slug, contar],
    enabled: !!slug,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await sb.rpc("trn_campanha_publica", { _slug: slug, _contar: contar });
      if (error) throw error;
      return (data ?? null) as CampanhaPublica | null;
    },
  });
}

export function useResponderCampanha(slug: string) {
  return useMutation({
    mutationFn: async (a: { item: string; nome: string; documento: string; respostas: Record<string, number[]> }) => {
      const { data, error } = await sb.rpc("trn_campanha_responder", {
        _slug: slug, _item: a.item, _nome: a.nome, _documento: a.documento, _respostas: a.respostas,
      });
      if (error) throw error;
      return data as ResultadoCampanha;
    },
  });
}

/** Item novo do editor, já com id (o QR do vídeo depende dele). */
export function novoItemCampanha(tipo: TipoItemCampanha): ItemInput {
  return {
    id: crypto.randomUUID(), tipo, titulo: "", texto: "", video_url: null, video_path: null, imagem_path: null,
    arquivo_path: null, arquivo_nome: null, link_url: null, link_rotulo: null,
    quiz: tipo === "prova" ? [] : null, nota_minima: 70,
    prova_config: (tipo === "prova" ? { titulo: "Provinha", gabarito: "sempre" } : {}) as ProvaConfig,
  };
}
