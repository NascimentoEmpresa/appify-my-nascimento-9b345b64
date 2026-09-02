// Chat lateral do Painel Gerencial de Formulários (SIS-2026-0311).
//
// A tela não monta contexto nenhum: manda a conversa e a Edge Function
// reconstrói o índice sob a RLS de quem perguntou. A única coisa que sobe daqui
// é a DICA de mapeamento (quais perguntas guardam o nome do colaborador
// avaliado), porque isso mora no localStorage do navegador e o servidor não tem
// como descobrir sozinho.
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PapelChat = "user" | "assistant";
export interface MensagemChat { papel: PapelChat; texto: string }

/** Mesmo teto da Edge Function — evita mandar o que vai ser cortado lá. */
export const MAX_PERGUNTA_CHARS = 500;
const MAX_HISTORICO = 8;

interface ErroComResposta { context?: Response; message?: string }

const mensagemErroFuncao = async (erro: unknown, padrao: string): Promise<string> => {
  const detalhe = erro as ErroComResposta | null;
  try {
    const resposta = detalhe?.context;
    if (resposta && typeof resposta.clone === "function") {
      const corpo = await resposta.clone().json() as { error?: unknown };
      if (corpo?.error) return String(corpo.error);
    }
  } catch { /* a mensagem padrão abaixo ainda é útil */ }
  return detalhe?.message || padrao;
};

export function usePainelChat(dicaIds: Record<string, string[]>) {
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Mesma proteção de corrida de useDiagnosticoFeedback: resposta de pergunta
  // antiga não pode sobrescrever a atual.
  const requisicaoAtual = useRef(0);

  const enviar = useCallback(async (texto: string) => {
    const pergunta = texto.trim().slice(0, MAX_PERGUNTA_CHARS);
    if (!pergunta) return;

    const requisicao = ++requisicaoAtual.current;
    const comPergunta = [...mensagens, { papel: "user" as PapelChat, texto: pergunta }];
    setMensagens(comPergunta);
    setErro(null);
    setPensando(true);

    try {
      const { data, error } = await supabase.functions.invoke("painel-formularios-chat", {
        body: {
          mensagens: comPergunta.slice(-MAX_HISTORICO).map((m) => ({
            role: m.papel, content: m.texto,
          })),
          dica_ids: dicaIds,
        },
      });
      if (error) throw new Error(await mensagemErroFuncao(error, "Falha ao falar com a IA."));

      const corpo = data as { resposta?: string; error?: unknown } | null;
      if (corpo?.error) throw new Error(String(corpo.error));

      const resposta = String(corpo?.resposta ?? "").trim();
      if (!resposta) throw new Error("A IA não respondeu desta vez. Tente perguntar de novo.");
      if (requisicao === requisicaoAtual.current) {
        setMensagens((prev) => [...prev, { papel: "assistant", texto: resposta }]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Não foi possível falar com a IA agora.";
      if (requisicao === requisicaoAtual.current) setErro(msg);
    } finally {
      if (requisicao === requisicaoAtual.current) setPensando(false);
    }
  }, [mensagens, dicaIds]);

  const limpar = useCallback(() => {
    requisicaoAtual.current += 1;
    setMensagens([]);
    setErro(null);
    setPensando(false);
  }, []);

  return { mensagens, pensando, erro, enviar, limpar };
}
