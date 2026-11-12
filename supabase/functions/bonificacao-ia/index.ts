// Edge: bonificacao-ia — perguntas à I.A sobre o Comparativo individual da
// Bonificação Coletiva (12/11/2026). Prompt e saneamento em
// ../_shared/bonificacao-ia.ts (testado pelo Vitest).
//
// Portão: JWT (verify_jwt no config.toml) + has_screen_access do próprio
// usuário em sistemas_bonificacao/visualizar — o mesmo da tela. O contexto
// vem da tela (o que o usuário já está vendo), então a função não lê tabela
// nenhuma e não amplia acesso.
//
// Provedor: o mesmo do parecer de chamado — Gemini (GEMINI_API_KEY), com o
// Groq (GROQ_API_KEY) de reserva quando o primeiro falha ou estoura cota.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  MAX_CONTEXTO_CHARS,
  montarMensagensBonificacao,
  normalizarMensagens,
} from "../_shared/bonificacao-ia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";

type Provedor = { nome: string; url: string; chave: string; modelo: string };

function provedores(): Provedor[] {
  const lista: Provedor[] = [];
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    lista.push({ nome: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", chave: gemini,
                 modelo: Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({ nome: "groq", url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
                 modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" });
  }
  return lista;
}

async function perguntarIA(messages: { role: string; content: string }[]): Promise<{ texto?: string; erro?: string; status?: number }> {
  const provs = provedores();
  if (!provs.length) return { erro: "A chave da IA não está configurada. Avise o time de Sistemas.", status: 500 };
  let ultimo = { erro: "Não foi possível responder agora. Tente de novo.", status: 502 };
  for (const p of provs) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.modelo, messages, temperature: 0.2 }),
      });
      if (r.ok) {
        const dados = await r.json();
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto };
        ultimo = { erro: "A IA devolveu resposta vazia. Tente de novo.", status: 502 };
        continue;
      }
      console.error("bonificacao-ia: erro do provedor", p.nome, p.modelo, r.status, (await r.text()).slice(0, 300));
      ultimo = r.status === 429 || r.status === 402
        ? { erro: ERRO_SEM_TOKENS, status: 429 }
        : { erro: `Falha ao chamar a IA (HTTP ${r.status}).`, status: 502 };
    } catch (e) {
      console.error("bonificacao-ia: provedor sem resposta", p.nome, e);
    }
  }
  return ultimo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData } = await supa.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return respostaJson({ error: "Não autenticado" }, 401);

    const { data: pode, error: erroAcesso } = await supa.rpc("has_screen_access", {
      _user: uid, _menu: "sistemas_bonificacao", _acao: "visualizar",
    });
    if (erroAcesso) throw erroAcesso;
    if (!pode) return respostaJson({ error: "Sem acesso à Bonificação Coletiva." }, 403);

    const body = await req.json().catch(() => ({}));
    const mensagens = normalizarMensagens(body?.mensagens);
    if (!mensagens.length || mensagens[mensagens.length - 1].role !== "user") {
      return respostaJson({ error: "Envie uma pergunta." }, 400);
    }
    const contexto = String(body?.contexto ?? "");
    if (!contexto.trim()) return respostaJson({ error: "Sem dados do comparativo para analisar." }, 400);
    if (contexto.length > MAX_CONTEXTO_CHARS) {
      return respostaJson({ error: "O comparativo está grande demais para a IA. Filtre um desenvolvedor e pergunte de novo." }, 413);
    }
    const rotuloMes = String(body?.rotulo_mes ?? "").slice(0, 40) || "o mês selecionado";

    const res = await perguntarIA(montarMensagensBonificacao(contexto, rotuloMes, mensagens));
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    return respostaJson({ resposta: res.texto });
  } catch (e) {
    console.error("bonificacao-ia", e);
    return respostaJson({ error: e instanceof Error ? e.message : "Erro inesperado." }, 500);
  }
});
