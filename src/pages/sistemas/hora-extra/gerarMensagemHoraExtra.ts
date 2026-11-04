// "Gerar mensagem" da Hora Extra — a ida à Edge hora-extra-justificativa-ia,
// tirada de dentro do NovaSolicitacaoDialog (04/11/2026) para o mesmo botão
// servir também à conclusão da HE (ConcluirHoraExtraDialog). Cada tela monta
// o próprio corpo e cuida do plano B (texto por modelo); aqui fica só a
// chamada, o prazo e a leitura do erro, iguais para as duas.
import { supabase } from "@/integrations/supabase/client";
import { motivoErroFuncao } from "./horaExtraUtils";

const PRAZO_GERAR_MS = 25_000;

/**
 * Pede o texto à I.A. Lança erro com motivo legível (vai no toast) quando a
 * Edge falha, demora ou não devolve texto.
 *
 * `modoEsperado`: a Edge devolve o `modo` que entendeu; se a tela pediu um
 * modo novo e a Edge publicada ainda é a antiga (deploy próprio), ela ignora o
 * campo e escreveria o texto errado — nesse caso vale como falha.
 */
export async function pedirMensagemHoraExtra(
  corpo: Record<string, unknown>,
  modoEsperado?: string,
): Promise<string> {
  // Prazo de 25 s (03/11/2026, Pablo: "aqui fica só gerando e não vai"):
  // sem ele, uma Edge/I.A que não respondia deixava o botão girando para
  // sempre, sem toast. O `timeout` do invoke corta a requisição; a corrida
  // com o relógio cobre o que vem antes dela (renovação do token).
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    const prazo = new Promise<never>((_, rejeitar) => {
      relogio = setTimeout(() => rejeitar(new Error("A I.A demorou demais para responder.")), PRAZO_GERAR_MS);
    });
    const { data, error } = await Promise.race([
      supabase.functions.invoke("hora-extra-justificativa-ia", {
        body: corpo,
        timeout: PRAZO_GERAR_MS - 1_000,
      }),
      prazo,
    ]);
    if (error) {
      // A mensagem útil vem no corpo — mas nem sempre em JSON com `error`:
      // o roteador do cluster usa `erro` e o proxy devolve página em texto.
      const ctx = (error as { context?: unknown }).context;
      if (ctx instanceof Response) {
        const texto = await ctx.text().catch(() => "");
        throw new Error(motivoErroFuncao(ctx.status, texto));
      }
      if ((error as { name?: string }).name === "FunctionsFetchError") {
        throw new Error("A função não respondeu (rede fora ou passou de 25 s).");
      }
      throw new Error(error.message);
    }
    if (data?.error || !data?.texto) throw new Error(data?.error ?? "A IA não devolveu texto.");
    if (modoEsperado && data?.modo !== modoEsperado) {
      throw new Error("A função de I.A ainda não foi atualizada para este campo.");
    }
    return String(data.texto);
  } finally {
    clearTimeout(relogio);
  }
}
