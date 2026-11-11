import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET_JUSTIFICATIVA, caminhoAnexoJustificativa, type AnexoJustificativa } from "@/lib/controladoria/anexosJustificativa";

// SIS-2026-0808: chat de justificativa dos contratos não faturados (migration 20261105007000).
// Leitura pela RLS ('controle-faturamento' › visualizar); quem escreve é a RPC faturamento_justificativa_enviar ('responder').
// SIS-2026-0870 (migration 20261111235000): a mensagem leva anexos — sobem para o bucket antes e a RPC confere cada um.

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
  anexos: AnexoJustificativa[];
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

const COLUNAS = "id, contrato_id, competencia, autor_id, destinatario_id, texto, anexos, created_at";

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
    mutationFn: async (i: { contratoId: string; competencia: string; texto: string; destinatarioId: string | null; arquivos?: File[] }) => {
      // Um arquivo por vez (cada upload é uma conexão do pool do Storage). Se algum falhar, apaga os que já subiram
      // — a policy de DELETE só deixa apagar o que ainda não está em mensagem — e a mensagem não é gravada.
      const anexos: AnexoJustificativa[] = [];
      const agora = Date.now();
      try {
        for (const [indice, f] of (i.arquivos ?? []).entries()) {
          const path = caminhoAnexoJustificativa(i.contratoId, i.competencia, f.name, indice, agora);
          const { error } = await supabase.storage.from(BUCKET_JUSTIFICATIVA).upload(path, f, { contentType: f.type || undefined, upsert: false });
          if (error) throw new Error(`Não foi possível anexar "${f.name}": ${error.message}`);
          anexos.push({ nome: f.name, path, tipo: f.type || null, tamanho: f.size });
        }
        // _anexos só vai quando há arquivo: mensagem de texto continua chamando a RPC como antes, então a tela
        // segue funcionando se o frontend for publicado antes da migration 20261111235000 rodar no banco.
        const { error } = await db.rpc("faturamento_justificativa_enviar", {
          _contrato_id: i.contratoId, _competencia: i.competencia, _texto: i.texto, _destinatario_id: i.destinatarioId,
          ...(anexos.length ? { _anexos: anexos } : {}),
        });
        if (error) throw new Error(error.message);
      } catch (e) {
        if (anexos.length) await supabase.storage.from(BUCKET_JUSTIFICATIVA).remove(anexos.map((a) => a.path)).catch(() => undefined);
        throw e;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE] }),
  });
}

/**
 * Bytes de um anexo do chat pelo DOWNLOAD AUTENTICADO, como os anexos de chamado (useAnexoChamado): a URL
 * assinada sai mesmo quando os bytes ainda não chegaram ao nó que respondeu, e o window.open depois de um await
 * cai no bloqueador de pop-up. Quem chama reserva a aba ainda no clique (ver BotoesAnexo no diálogo).
 */
export async function obterAnexoJustificativa(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET_JUSTIFICATIVA).download(path);
  if (error || !data) throw new Error(error?.message ? `O servidor não entregou o arquivo (${error.message}). Tente de novo em instantes.` : "O servidor não entregou o arquivo. Tente de novo em instantes.");
  if (data.size === 0) throw new Error("O arquivo está vazio no servidor.");
  return data;
}
