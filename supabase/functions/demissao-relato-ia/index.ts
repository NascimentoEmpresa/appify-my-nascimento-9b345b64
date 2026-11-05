// Arquivo: supabase/functions/demissao-relato-ia/index.ts
//
// Relatório de Demissões › "Motivos do relato (I.A)" (05/11/2026). Classifica
// o relato livre de cada solicitação de demissão numa categoria FECHADA
// (_shared/demissao-relato-ia.ts) e grava em SISTEMA_DEMISSAO_RELATO_IA
// (mig 20261105008300). Um lote por chamada (LOTE_IA relatos, UMA ida à I.A);
// a tela chama de novo enquanto `restantes` cair — é assim que as antigas
// são processadas, sem cron.
//
// Portão: JWT de usuário. A fila (dem_relato_ia_pendentes) é lida COM esse
// JWT, então quem não vê o relatório (dir_rel_exige) leva 403 antes de
// gastar token. A gravação (dem_relato_ia_gravar) é só service_role.
//
// Relato com menos de RELATO_MIN_IA caracteres vira "Sem relato" sem I.A.
// Provedor: o mesmo da hora-extra-justificativa-ia — Gemini primeiro, Groq
// (openai/gpt-oss-120b) de reserva. Falha da I.A: devolve o erro, nada é
// gravado, as linhas continuam pendentes e o relatório mostra
// "(aguardando I.A)" — o resto da tela não depende disto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  CATEGORIA_SEM_RELATO, LOTE_IA, lerResposta, montarPrompt, separarParaIA, SYSTEM_PROMPT, type RelatoPendente,
} from "../_shared/demissao-relato-ia.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";

// Classificar 25 relatos pede mais tempo que uma mensagem curta: 25 s por
// tentativa, 45 s no total, banco 10 s.
const PRAZO_TENTATIVA_MS = 25_000;
const PRAZO_IA_MS = 45_000;
const PRAZO_BANCO_MS = 10_000;
const fetchComPrazo = (ms: number): typeof fetch => (url, opcoes) =>
  fetch(url, { ...opcoes, signal: AbortSignal.timeout(ms) });

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
  Promise<{ texto?: string; modelo?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível classificar agora.", status: 502 };
  const inicio = Date.now();
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const resta = PRAZO_IA_MS - (Date.now() - inicio);
      if (resta < 3_000) return { erro: "A IA demorou demais para responder.", status: 504 };
      const r = await fetchComPrazo(Math.min(PRAZO_TENTATIVA_MS, resta))(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: prov.modelo, temperature: 0, messages }),
      }).catch((e) => {
        console.error("IA rede", prov.nome, e);
        return e instanceof DOMException && e.name === "TimeoutError" ? ("prazo" as const) : null;
      });
      if (r === "prazo") { ultimo = { erro: `A IA (${prov.nome}) não respondeu a tempo.`, status: 504 }; break; }
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto, modelo: `${prov.nome}/${prov.modelo}` };
        ultimo = { erro: "A IA devolveu resposta vazia.", status: 502 };
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

type Pendente = RelatoPendente & { md5: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respostaJson({ error: "Use POST." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Faça login." }, 401);
    const supa = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader }, fetch: fetchComPrazo(PRAZO_BANCO_MS) },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) return respostaJson({ error: "Sessão inválida." }, 401);

    // A fila com o JWT do usuário: dir_rel_exige dentro dela é o portão.
    const { data: fila, error: filaErr } = await supa.rpc("dem_relato_ia_pendentes", { _limite: LOTE_IA });
    if (filaErr) {
      const semAcesso = filaErr.code === "42501" || /acesso/i.test(filaErr.message);
      return respostaJson({ error: filaErr.message }, semAcesso ? 403 : 500);
    }
    const total = Number(fila?.total ?? 0);
    const itens: Pendente[] = Array.isArray(fila?.itens) ? fila.itens : [];
    if (!itens.length) return respostaJson({ gravados: 0, restantes: 0 });

    const md5 = new Map(itens.map((i) => [Number(i.id), String(i.md5)]));
    const { ia, semRelato } = separarParaIA(itens);
    const gravar: { id: number; categoria: string; md5: string; modelo: string | null }[] =
      semRelato.map((id) => ({ id, categoria: CATEGORIA_SEM_RELATO, md5: md5.get(id)!, modelo: null }));

    let erroIA: string | null = null;
    if (ia.length) {
      const provs = provedores();
      if (!provs.length) {
        erroIA = "A chave da IA não está configurada. Avise o time de Sistemas.";
      } else {
        const res = await chamarIA(provs, [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: montarPrompt(ia) },
        ]);
        if (!res.texto) erroIA = res.erro ?? "Não foi possível classificar agora.";
        else {
          const lidas = lerResposta(res.texto, ia.map((i) => Number(i.id)));
          if (!lidas.size) erroIA = "A IA devolveu uma resposta que não deu para ler.";
          for (const [id, categoria] of lidas) gravar.push({ id, categoria, md5: md5.get(id)!, modelo: res.modelo ?? null });
        }
      }
    }

    let gravados = 0;
    if (gravar.length) {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
        global: { fetch: fetchComPrazo(PRAZO_BANCO_MS) }, auth: { persistSession: false },
      });
      const { data, error } = await admin.rpc("dem_relato_ia_gravar", { _itens: gravar });
      if (error) return respostaJson({ error: error.message }, 500);
      gravados = Number(data ?? 0);
    }

    const restantes = Math.max(0, total - gravados);
    // Nada gravado e a I.A falhou: a tela para o laço e mostra o motivo.
    if (!gravados && erroIA) return respostaJson({ error: erroIA, gravados: 0, restantes }, 502);
    return respostaJson({ gravados, restantes, aviso: erroIA });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível classificar agora." }, 500);
  }
});
