import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { mesesDoMural, type StatusMural } from "@/lib/formularios/muralReconhecimento";
import type { TriagemItem } from "@/lib/formularios/muralTriagem";

// RPCs fora do types.ts gerado: mesmo padrão de FormularioRespostas.
const sb = supabase as unknown as SupabaseClient;

/**
 * Mural de Reconhecimento (migration 20261030003200).
 *
 * Tudo por RPC: CS_FORM_MURAL_RECONHECIMENTO é fechada a anon/authenticated e
 * as respostas do formulário são anônimas — quem decide o que sai (positivo,
 * liberado, mês anterior em Brasília) é o banco. O front só repete o filtro
 * de `lib/formularios/muralReconhecimento` como segunda checagem.
 */

export interface ItemMuralInicio {
  chave: string;
  /** "AAAA-MM" do envio, em Brasília (mig 20261112210000). */
  mes?: string;
  colaborador: string;
  setor: string | null;
  cargo: string | null;
  avatar_url: string | null;
  nota: string | null;
  escala: number;
  comentario: string;
  formulario: string;
  enviado_em: string;
  status: StatusMural;
}

export interface ItemModeracao {
  resposta_id: string;
  pergunta_id: string;
  linha: number;
  colaborador: string;
  setor: string | null;
  nota: string | null;
  escala: number;
  comentario: string;
  enviado_em: string;
  status: StatusMural;
  decidido_em: string | null;
  decidido_por: string | null;
}

// "-meses": o formato mudou (lista de meses) — chave nova para nenhum cache velho servir o formato antigo.
const CHAVE_INICIO = "mural-reconhecimento-inicio-meses";
const CHAVE_MODERACAO = "mural-reconhecimento-moderacao";

/**
 * O que o cartão do Início mostra: um bloco por mês publicado, do mais novo
 * ao mais velho (12/11/2026 — antes era só o mês anterior, e por isso o
 * setembro liberado em novembro não aparecia). Erro = cartão some.
 */
export function useMuralInicio() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CHAVE_INICIO, user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ mes: string; itens: ItemMuralInicio[] }[]> => {
      const { data, error } = await sb.rpc("cs_form_mural_inicio");
      if (error) throw error;
      return mesesDoMural((data?.itens ?? []) as ItemMuralInicio[]);
    },
  });
}

/** Fila de moderação de um formulário num mês ("AAAA-MM"). */
export function useMuralModeracao(formId: string | undefined, mes: string, ativo: boolean) {
  return useQuery({
    queryKey: [CHAVE_MODERACAO, formId, mes],
    enabled: !!formId && ativo,
    queryFn: async (): Promise<ItemModeracao[]> => {
      const { data, error } = await sb.rpc("cs_form_mural_moderacao", { _form_id: formId, _mes: `${mes}-01` });
      if (error) throw error;
      return (data ?? []) as ItemModeracao[];
    },
  });
}

/** Liberar / recusar / voltar a pendente — uma ou várias linhas. */
export function useDecidirMural() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itens, status }: { itens: Pick<ItemModeracao, "resposta_id" | "pergunta_id" | "linha">[]; status: StatusMural }) => {
      // Lote numa chamada e numa transação (mig 20261103001300). Enquanto a
      // migration não estiver no banco (PGRST202), cai no laço de sempre.
      if (itens.length > 1) {
        const { error } = await sb.rpc("cs_form_mural_decidir_lote", {
          _itens: itens.map(({ resposta_id, pergunta_id, linha }) => ({ resposta_id, pergunta_id, linha })),
          _status: status,
        });
        if (!error) return;
        if (error.code !== "PGRST202") throw error;
      }
      for (const i of itens) {
        const { error } = await sb.rpc("cs_form_mural_decidir", {
          _resposta_id: i.resposta_id, _pergunta_id: i.pergunta_id, _linha: i.linha, _status: status,
        });
        if (error) throw error;
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [CHAVE_MODERACAO] });
      qc.invalidateQueries({ queryKey: [CHAVE_INICIO] });
    },
  });
}

// ---------------------------------------------------------------------
// TRIAGEM POR IA (12/11/2026, mig 20261112234500 + Edge mural-triagem-ia)
//
// Ao abrir um mês no modal, a Edge devolve a triagem já gravada e lê com a
// IA só o que ainda não foi lido. O que ela marca como NÃO recomendado fica
// fora do "Liberar" até alguém habilitar (lib/formularios/muralTriagem).
//
// Falha (IA fora, Edge ou migration ainda não no ar) NÃO trava o mural: a
// query vira erro, a tela avisa que a triagem não rodou e libera como antes.
// ---------------------------------------------------------------------

const CHAVE_TRIAGEM = "mural-reconhecimento-triagem-ia";

export interface TriagemMural {
  /** chave resposta_id:pergunta_id:linha → triagem. */
  porChave: Map<string, TriagemItem>;
  /** Pendentes que a IA não conseguiu ler agora. */
  faltam: number;
  aviso: string | null;
}

const chaveTriagem = (i: Pick<ItemModeracao, "resposta_id" | "pergunta_id" | "linha">) => `${i.resposta_id}:${i.pergunta_id}:${i.linha}`;

export function useTriagemMural(formId: string | undefined, mes: string, ativo: boolean) {
  return useQuery({
    queryKey: [CHAVE_TRIAGEM, formId, mes],
    enabled: !!formId && ativo,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<TriagemMural> => {
      const { data, error } = await supabase.functions.invoke("mural-triagem-ia", { body: { form_id: formId, mes } });
      if (error) {
        // FunctionsHttpError traz o corpo com a mensagem da Edge.
        let msg = error.message;
        try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) msg = corpo.error; } catch { /* segue */ }
        throw new Error(msg);
      }
      if (data?.error) throw new Error(String(data.error));
      const porChave = new Map<string, TriagemItem>();
      for (const t of (data?.itens ?? []) as (TriagemItem & Pick<ItemModeracao, "resposta_id" | "pergunta_id" | "linha">)[]) {
        porChave.set(chaveTriagem(t), { recomendado: t.recomendado, motivo: t.motivo, habilitado: !!t.habilitado });
      }
      return { porChave, faltam: Number(data?.faltam ?? 0), aviso: data?.aviso ?? null };
    },
  });
}

/** Habilitar (ou voltar a desabilitar) um comentário que a IA não recomendou. */
export function useHabilitarTriagem(formId: string | undefined, mes: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, habilitado }: { item: Pick<ItemModeracao, "resposta_id" | "pergunta_id" | "linha">; habilitado: boolean }) => {
      const { error } = await sb.rpc("cs_form_mural_triagem_habilitar", {
        _resposta_id: item.resposta_id, _pergunta_id: item.pergunta_id, _linha: item.linha, _habilitado: habilitado,
      });
      if (error) throw error;
    },
    // Atualiza o cache na hora em vez de reconsultar (reconsultar passaria pela Edge).
    onSuccess: (_d, { item, habilitado }) => {
      qc.setQueryData<TriagemMural>([CHAVE_TRIAGEM, formId, mes], (velho) => {
        if (!velho) return velho;
        const porChave = new Map(velho.porChave);
        const k = chaveTriagem(item);
        const t = porChave.get(k);
        if (t) porChave.set(k, { ...t, habilitado });
        return { ...velho, porChave };
      });
    },
  });
}
