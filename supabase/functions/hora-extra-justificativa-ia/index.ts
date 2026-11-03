// Arquivo: supabase/functions/hora-extra-justificativa-ia/index.ts
//
// Botão "Gerar mensagem" na justificativa da Nova Solicitação de Hora Extra
// (03/11/2026). Recebe os chamados que estão na tabela da tela (número,
// título, setor, prioridade, expectativa) e devolve uma justificativa curta,
// de 2 a 4 frases, dentro dos 500 caracteres. Não grava nada e não lê o banco
// além do portão de acesso: o texto só entra na textarea, editável.
//
// Portão: JWT de usuário + has_screen_access em sistemas_hora_extra (incluir,
// alterar ou aprovar — quem pode abrir o modal), antes de gastar token.
//
// Provedor: o mesmo de chamado-parecer-ia — Gemini (GEMINI_API_KEY) primeiro;
// erro passageiro tenta de novo; sem tokens ou chave recusada, passa ao Groq
// (GROQ_API_KEY, modelo openai/gpt-oss-120b). Chaves nos secrets da Edge
// Function, nunca em arquivo. Falha devolve a mensagem de erro — a tela
// mostra o toast e cai no texto por modelo (gerarJustificativaModelo).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  limparResposta, montarPrompt, normalizarChamados, SYSTEM_PROMPT,
} from "../_shared/hora-extra-justificativa.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamarIA(provs: Provedor[], messages: { role: string; content: string }[]):
  Promise<{ texto?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível gerar a mensagem agora.", status: 502 };
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: prov.modelo, temperature: 0.5, messages }),
      }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto };
        ultimo = { erro: "A IA devolveu resposta vazia. Tente de novo.", status: 502 };
        break;
      }
      const status = r?.status ?? 0;
      console.error("IA erro", prov.nome, prov.modelo, status, r ? (await r.text()).slice(0, 300) : "sem resposta");
      if (status === 429 || status === 402) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
      if (status === 401 || status === 403) { ultimo = { erro: "A chave da IA foi recusada. Avise o time de Sistemas.", status: 502 }; break; }
      ultimo = { erro: `Falha ao chamar a IA (HTTP ${status || "sem resposta"}).`, status: 502 };
      if (!(status === 0 || status >= 500) || tentativa === 2) break;
      await esperar(1200);
    }
  }
  return ultimo;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respostaJson({ error: "Use POST." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Faça login." }, 401);
    const supa = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) return respostaJson({ error: "Sessão inválida." }, 401);
    const uid = userData.user.id;

    let pode = false;
    for (const acao of ["incluir", "alterar", "aprovar"]) {
      const { data, error } = await supa.rpc("has_screen_access", { _user: uid, _menu: "sistemas_hora_extra", _acao: acao });
      if (error) return respostaJson({ error: error.message }, 500);
      if (data) { pode = true; break; }
    }
    if (!pode) return respostaJson({ error: "Você não tem acesso para solicitar hora extra." }, 403);

    const corpo = await req.json().catch(() => ({}));
    const chamados = normalizarChamados(corpo?.chamados);
    if (!chamados.length) return respostaJson({ error: "Adicione ao menos um chamado antes de gerar a mensagem." }, 400);

    const provs = provedores();
    if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    const res = await chamarIA(provs, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: montarPrompt(chamados) },
    ]);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    const texto = limparResposta(res.texto);
    if (!texto) return respostaJson({ error: "A IA devolveu resposta vazia. Tente de novo." }, 502);
    return respostaJson({ texto });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível gerar a mensagem agora." }, 500);
  }
});
