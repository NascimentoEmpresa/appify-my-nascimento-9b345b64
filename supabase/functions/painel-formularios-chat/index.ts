// Chat lateral do Painel Gerencial de Formulários (SIS-2026-0311).
//
// Responde dúvida de navegação — "onde eu acho o colaborador X?" — sobre os
// formulários que o usuário já enxerga. A RLS do usuário escolhe as respostas;
// a busca por pessoa é feita em código (painel-indice.ts) e o modelo só redige
// o que ela achou. O modelo NUNCA decide se alguém existe.
//
// IA GRATUITA: usa Google AI Studio (Gemini) pelo endpoint compatível com o
// formato OpenAI-chat. Não usa o gateway do Lovable de propósito — aquele
// consome crédito da workspace, e o pedido era explicitamente por IA grátis.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buscarPessoas,
  montarIndicePainel,
  montarPromptChat,
  MAX_MENSAGENS_HISTORICO,
  MAX_PERGUNTA_CHARS,
  type FormularioPainel,
  type RespostaPainel,
} from "../_shared/painel-indice.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: jsonHeaders });

// ── Provedor de IA ────────────────────────────────────────────────────────
// Trocar de provedor é trocar estas três constantes; o corpo da requisição é o
// mesmo formato OpenAI-chat nos dois.
//   Groq:  https://api.groq.com/openai/v1/chat/completions  +  GROQ_API_KEY
// O modelo sai em variável de ambiente porque nome de modelo do free tier muda
// com frequência — ajustar a variável evita um redeploy só para isso. Não é
// hipótese: em 02/09/2026 o gemini-2.5-flash já respondia 404 com "no longer
// available to new users", apontando o 3.6 como substituto.
const IA_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const IA_MODELO = Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash";

/**
 * A mensagem de cota é a que o solicitante pediu, com estas palavras: no free
 * tier a cota estoura sozinha e volta depois, então o usuário final precisa
 * entender que é para esperar, não que o sistema quebrou.
 */
const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";

// Teto de leitura: o índice cobre TODOS os formulários visíveis, então sem
// limite um usuário com escopo amplo carregaria o histórico inteiro na memória
// da função a cada pergunta.
const TAMANHO_PAGINA = 1000;
const MAX_RESPOSTAS_INDICE = 4000;

const SYSTEM_PROMPT = `Você é o assistente do Painel Gerencial de Formulários do Grupo Nascimento.
Responde em português do Brasil, curto e direto — duas ou três frases bastam.

REGRAS ABSOLUTAS:
1. A busca por pessoa JÁ FOI FEITA em código. O resultado está nos blocos ACHADOS e PARECIDOS.
   Você nunca procura por conta própria e nunca contradiz esses blocos.
2. Se ACHADOS tem alguém, essa pessoa EXISTE. Jamais diga que ela não existe ou que não há
   informação sobre ela. Diga onde ela está e como chegar lá, no formato:
   "Painel Gerencial → <aba> → setor: <SETOR>". Cite o formulário quando houver mais de um.
   Se vierem várias pessoas, liste todas — pode ser homônimo.
3. Se ACHADOS estiver vazio, responda que você não encontrou essa pessoa nos formulários
   visíveis para o usuário. NUNCA responda "não existe" de forma absoluta: o acesso de cada
   usuário é recortado por permissão, e o que você enxerga pode não ser tudo. Se houver
   PARECIDOS, ofereça: "Você quis dizer ...?".
4. Você NÃO tem o conteúdo dos feedbacks — só nomes, setores, formulários e quantidades. Se
   pedirem o que alguém respondeu ou escreveu, diga que essa leitura está nas abas do painel
   (Histórico Individual, Diagnóstico IA), não com você.
5. Nunca invente nome, setor, formulário ou número que não esteja no contexto.
6. Para dúvida geral sobre o painel, responda com o que está no CONTEXTO e indique a aba certa.`;

interface MensagemChat { role: string; content: string }

const normalizarMensagens = (valor: unknown): MensagemChat[] =>
  (Array.isArray(valor) ? valor : [])
    .map((item: unknown) => {
      const m = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const role = String(m.role ?? "") === "assistant" ? "assistant" : "user";
      return { role, content: String(m.content ?? "").slice(0, MAX_PERGUNTA_CHARS) };
    })
    .filter((m) => m.content.trim().length > 0)
    .slice(-MAX_MENSAGENS_HISTORICO);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") ?? "";
    const supa = createClient(supaUrl, anon, { global: { headers: { Authorization: auth } } });

    const { data: userData } = await supa.auth.getUser();
    if (!userData.user) return respostaJson({ error: "Não autenticado" }, 401);

    // Mesma ideia do diagnóstico: quem pode LER as respostas é a RLS, mas o
    // acesso à ferramenta é uma capacidade à parte, ligada/desligada por
    // usuário em Administração → Módulos & Menus → Acesso por Usuário.
    const { data: temCap, error: erroCap } = await supa.rpc("cs_form_cap", { _cap: "chat_ia_painel" });
    if (erroCap) throw erroCap;
    if (!temCap) return respostaJson({ error: "Sem permissão para usar o chat do painel." }, 403);

    const body = await req.json().catch(() => ({}));
    const mensagens = normalizarMensagens(body?.mensagens);
    if (!mensagens.length) return respostaJson({ error: "Envie uma pergunta." }, 400);

    const ultima = [...mensagens].reverse().find((m) => m.role === "user");
    if (!ultima) return respostaJson({ error: "Envie uma pergunta." }, 400);

    // Dica de mapeamento vinda da tela: quais perguntas guardam o nome do
    // colaborador avaliado. Mora no localStorage do navegador, então a função
    // não tem como descobrir sozinha — ver idsDeNome() sobre por que confiar
    // nisso não amplia acesso.
    const dicas = body?.dica_ids && typeof body.dica_ids === "object"
      ? body.dica_ids as Record<string, string[]>
      : {};

    const { data: formularios, error: erroForms } = await supa
      .from("CS_FORMULARIOS")
      .select("id, titulo, perguntas");
    if (erroForms) throw erroForms;

    const formsVisiveis = (formularios ?? []) as FormularioPainel[];
    if (!formsVisiveis.length) {
      return respostaJson({ resposta: "Não há nenhum formulário visível para o seu acesso." });
    }

    const idsForm = formsVisiveis.map((f) => String(f.id));
    const respostas: RespostaPainel[] = [];
    for (let inicio = 0; inicio < MAX_RESPOSTAS_INDICE; inicio += TAMANHO_PAGINA) {
      const { data: pagina, error: erroResp } = await supa
        .from("CS_FORM_RESPOSTAS")
        .select("id, formulario_id, setor, respondente_nome, itens")
        .in("formulario_id", idsForm)
        .order("id", { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (erroResp) throw erroResp;
      respostas.push(...((pagina ?? []) as RespostaPainel[]));
      if ((pagina ?? []).length < TAMANHO_PAGINA) break;
    }

    if (!respostas.length) {
      return respostaJson({
        resposta: "Ainda não há nenhuma resposta de formulário visível para o seu acesso, "
          + "então não tenho o que consultar. Confira com o responsável se o seu acesso "
          + "alcança as respostas em Administração › Acesso por Usuário.",
      });
    }

    const indice = montarIndicePainel(formsVisiveis, respostas, dicas);
    const busca = buscarPessoas(indice, ultima.content);

    const IA_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!IA_KEY) {
      console.error("painel-formularios-chat: GEMINI_API_KEY ausente");
      return respostaJson({
        error: "A chave da IA não está configurada. Avise o time de Sistemas.",
      }, 500);
    }

    // O histórico vai como está; só a última pergunta é reescrita para carregar
    // o contexto e o resultado da busca, que é o que muda a cada turno.
    const anteriores = mensagens.slice(0, -1);
    const aiResp = await fetch(IA_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${IA_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IA_MODELO,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...anteriores,
          { role: "user", content: montarPromptChat(indice, busca, ultima.content) },
        ],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("IA gateway error", aiResp.status, txt);
      // 429 (cota estourada) e 402 (crédito) são o mesmo fato para quem está no
      // chat: a IA parou por limite e volta sozinha. Qualquer outro erro não
      // deve virar essa mensagem, senão o usuário espera por algo que não vem.
      if (aiResp.status === 429 || aiResp.status === 402) {
        return respostaJson({ error: ERRO_SEM_TOKENS }, aiResp.status);
      }
      if (aiResp.status === 401 || aiResp.status === 403) {
        return respostaJson({ error: "A chave da IA foi recusada. Avise o time de Sistemas." }, 502);
      }
      if (aiResp.status === 404) {
        return respostaJson({
          error: `O modelo "${IA_MODELO}" não existe nesta API. Ajuste a variável IA_CHAT_MODELO.`,
        }, 502);
      }
      // O status entra na mensagem de propósito. "Falha ao chamar a IA" sozinho
      // não distingue indisponibilidade momentânea (5xx, adianta tentar de novo)
      // de payload recusado (4xx, tentar de novo não resolve) — e sem log
      // acessível pelo CLI, esse número é o que permite diagnosticar.
      const motivo = String(
        (() => { try { return JSON.parse(txt)?.error?.message ?? ""; } catch { return ""; } })()
      ).slice(0, 160);
      return respostaJson({
        error: `Falha ao chamar a IA (HTTP ${aiResp.status})${motivo ? `: ${motivo}` : "."}`,
      }, 502);
    }

    const dadosIa = await aiResp.json();
    // Alguns provedores devolvem 200 com o estouro de cota no corpo, em vez de
    // 429. Sem esta checagem o usuário receberia "resposta vazia" no lugar do
    // aviso de tokens.
    const erroCorpo = String(dadosIa?.error?.message ?? dadosIa?.error?.status ?? "");
    if (/quota|rate limit|resource_exhausted|exhausted/i.test(erroCorpo)) {
      console.error("IA cota estourada (200 com erro no corpo)", erroCorpo);
      return respostaJson({ error: ERRO_SEM_TOKENS }, 429);
    }

    const texto = String(dadosIa?.choices?.[0]?.message?.content ?? "").trim();
    if (!texto) {
      console.error("IA sem conteúdo", JSON.stringify(dadosIa).slice(0, 500));
      return respostaJson({ error: "A IA não respondeu desta vez. Tente perguntar de novo." }, 502);
    }

    return respostaJson({ resposta: texto });
  } catch (e) {
    console.error("painel-formularios-chat error", e);
    return respostaJson({ error: e instanceof Error ? e.message : "Erro inesperado" }, 500);
  }
});
