import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EventoJustificativa, Justificativa, LancamentoJustificativa } from "@/pages/controladoria/justificativas/regras";

// SIS-2026-0807: Justificativas de Valor (migration 20261105001000). A leitura passa pela RLS (quem vê todas ou só as suas); quem escreve são as RPCs.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabelas/RPCs fora do types.ts gerado
const db = supabase as any;

const CHAVE = "controladoria_justificativa";

const COLUNAS = "id, numero, contrato_id, mes, coluna, coluna_rotulo, valor_referencia, base_leitura, pergunta, responsavel_id, prazo, status, resposta, respondida_em, encerrada_em, created_by, created_at";

export function useJustificativas(habilitado = true) {
  return useQuery({
    queryKey: [CHAVE],
    staleTime: 30_000,
    enabled: habilitado,
    queryFn: async (): Promise<Justificativa[]> => {
      const { data, error } = await db.from("controladoria_justificativa").select(COLUNAS).order("created_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return ((data ?? []) as Justificativa[]).map((j) => ({ ...j, valor_referencia: j.valor_referencia === null ? null : Number(j.valor_referencia) }));
    },
  });
}

export function useDetalheJustificativa(id: string | null) {
  return useQuery({
    queryKey: [CHAVE, "detalhe", id],
    enabled: !!id,
    queryFn: async (): Promise<{ lancamentos: LancamentoJustificativa[]; eventos: EventoJustificativa[] }> => {
      const [lan, eve] = await Promise.all([
        db.from("controladoria_justificativa_lancamento").select("id, justificativa_id, id_lancamento, descricao, classificacao, data_pagamento, valor").eq("justificativa_id", id).order("valor", { ascending: false }),
        db.from("controladoria_justificativa_evento").select("id, justificativa_id, tipo, ator_id, texto, created_at").eq("justificativa_id", id).order("created_at", { ascending: true }),
      ]);
      if (lan.error) throw lan.error;
      if (eve.error) throw eve.error;
      return {
        lancamentos: ((lan.data ?? []) as LancamentoJustificativa[]).map((l) => ({ ...l, valor: Number(l.valor) })),
        eventos: (eve.data ?? []) as EventoJustificativa[],
      };
    },
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [CHAVE] });
}

export interface SolicitarJustificativaInput {
  contratoId: string;
  mes: string; // YYYY-MM-01
  coluna: string;
  colunaRotulo: string;
  valorReferencia: number | null;
  base: "competencia" | "pagamento";
  pergunta: string;
  responsavelId: string;
  prazo: string | null;
  lancamentos: { id_lancamento: string | null; descricao: string | null; classificacao: string | null; data_pagamento: string | null; valor: number }[];
}

export function useSolicitarJustificativa() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (i: SolicitarJustificativaInput) => {
      const { data, error } = await db.rpc("justificativa_solicitar", {
        _contrato_id: i.contratoId,
        _mes: i.mes,
        _coluna: i.coluna,
        _coluna_rotulo: i.colunaRotulo,
        _valor_referencia: i.valorReferencia,
        _base: i.base,
        _pergunta: i.pergunta,
        _responsavel_id: i.responsavelId,
        _prazo: i.prazo,
        _lancamentos: i.lancamentos,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidar,
  });
}

export function useResponderJustificativa() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, texto }: { id: string; texto: string }) => {
      const { error } = await db.rpc("justificativa_responder", { _id: id, _texto: texto });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useDecidirJustificativa() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async ({ id, acao, texto }: { id: string; acao: "encerrar" | "reabrir" | "cancelar"; texto: string | null }) => {
      const { error } = await db.rpc("justificativa_decidir", { _id: id, _acao: acao, _texto: texto });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}
