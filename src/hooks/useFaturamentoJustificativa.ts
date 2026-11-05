import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0808: chat de justificativa dos contratos não faturados (migration 20261105007000).
// Leitura pela RLS ('controle-faturamento' › visualizar); quem escreve é a RPC faturamento_justificativa_enviar ('responder').

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabelas/RPCs fora do types.ts gerado
const db = supabase as any;

const CHAVE = "faturamento_justificativa_mensagem";

export interface MensagemFaturamento {
  id: string;
  contrato_id: string;
  competencia: string; // YYYY-MM-01
  autor_id: string;
  destinatario_id: string | null;
  texto: string;
  created_at: string;
}

export interface ResumoChatFaturamento {
  total: number;
  ultima: MensagemFaturamento;
}

/** Resumo do chat de cada contrato na competência (quantas mensagens e a última), para a coluna das tabelas. */
export function resumirChats(mensagens: MensagemFaturamento[]): Map<string, ResumoChatFaturamento> {
  const mapa = new Map<string, ResumoChatFaturamento>();
  for (const m of mensagens) {
    const atual = mapa.get(m.contrato_id);
    if (!atual) mapa.set(m.contrato_id, { total: 1, ultima: m });
    else mapa.set(m.contrato_id, { total: atual.total + 1, ultima: m.created_at > atual.ultima.created_at ? m : atual.ultima });
  }
  return mapa;
}

const COLUNAS = "id, contrato_id, competencia, autor_id, destinatario_id, texto, created_at";

export function useResumoChatsFaturamento(competencia: string) {
  return useQuery({
    queryKey: [CHAVE, "resumo", competencia],
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, ResumoChatFaturamento>> => {
      const { data, error } = await db.from("faturamento_justificativa_mensagem").select(COLUNAS).eq("competencia", competencia).order("created_at", { ascending: true }).limit(5000);
      if (error) throw error;
      return resumirChats((data ?? []) as MensagemFaturamento[]);
    },
  });
}

export function useMensagensFaturamento(contratoId: string | null, competencia: string | null) {
  return useQuery({
    queryKey: [CHAVE, "chat", contratoId, competencia],
    enabled: !!contratoId && !!competencia,
    // Sem busca automática (regra do ERP, src/lib/atualizarTela.ts): mensagem nova aparece ao abrir, ao enviar ou no botão Atualizar.
    queryFn: async (): Promise<MensagemFaturamento[]> => {
      const { data, error } = await db.from("faturamento_justificativa_mensagem").select(COLUNAS).eq("contrato_id", contratoId).eq("competencia", competencia).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MensagemFaturamento[];
    },
  });
}

export function useEnviarMensagemFaturamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { contratoId: string; competencia: string; texto: string; destinatarioId: string | null }) => {
      const { error } = await db.rpc("faturamento_justificativa_enviar", { _contrato_id: i.contratoId, _competencia: i.competencia, _texto: i.texto, _destinatario_id: i.destinatarioId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE] }),
  });
}
