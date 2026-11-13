// Arquivo: supabase/functions/mural-triagem-ia/index.ts
//
// Triagem por IA do Mural do Início (12/11/2026). Chamada pelo modal
// "Mural do Início — Reconhecimento" (MuralModeracao) ao abrir um mês:
//
//   1. lê os positivos do mês + a triagem já gravada (cs_form_mural_triagem,
//      com o JWT de quem chamou — o portão cs_form_pode(_, 'acesso') é do
//      banco, igual à fila de moderação);
//   2. manda para a IA SÓ os pendentes sem triagem válida (texto novo ou
//      mudado) e os que uma régua anterior recomendou (precisaTriagem), em
//      lotes de 20;
//   3. grava o que voltou (cs_form_mural_triagem_gravar) e devolve a triagem
//      do mês inteiro.
//
// Abrir de novo não gasta token: tudo que já foi lido vem do banco.
//
// Falha da IA não trava o mural: o que não foi classificado volta em
// `faltam` com `aviso`, e a tela segue como antes para esses comentários.
//
// Provedor: o mesmo de hora-extra-justificativa-ia — Gemini (GEMINI_API_KEY)
// primeiro; sem tokens/chave recusada/erro, Groq (GROQ_API_KEY, modelo
// openai/gpt-oss-120b). Chaves nos secrets da Edge, nunca em arquivo.
// Sem service_role: tudo roda como o usuário.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  emLotes, lerResultadoTriagem, modeloComVersao, montarPromptTriagem, precisaTriagem,
  SYSTEM_PROMPT_TRIAGEM, TAMANHO_LOTE,
} from "../_shared/mural-triagem-ia.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Prazos: cada chamada à IA 20 s, o conjunto 40 s (o que sobrar fica para a
// próxima abertura), banco 10 s. Abaixo dos 60 s em que a tela desiste.
const PRAZO_TENTATIVA_MS = 20_000;
const PRAZO_IA_MS = 40_000;
const PRAZO_BANCO_MS = 10_000;
const LOTES_EM_PARALELO = 3;
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

/** Texto da IA ou o erro; tenta o próximo provedor em qualquer falha. */
async function chamarIA(provs: Provedor[], prompt: string, ate: number):
  Promise<{ texto?: string; modelo?: string; erro?: string }> {
  let erro = "A IA não respondeu.";
  for (const prov of provs) {
    const resta = ate - Date.now();
    if (resta < 3_000) return { erro: "A IA demorou demais para responder." };
    const r = await fetchComPrazo(Math.min(PRAZO_TENTATIVA_MS, resta))(prov.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: prov.modelo, temperature: 0,
        // Mesmo cuidado de chamado-parecer-ia: modo JSON só no Groq.
        ...(prov.nome === "groq" ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: SYSTEM_PROMPT_TRIAGEM }, { role: "user", content: prompt }],
      }),
    }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
    if (r && r.ok) {
      const dados = await r.json().catch(() => null);
      const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
      if (texto) return { texto, modelo: `${prov.nome}:${prov.modelo}` };
      erro = "A IA devolveu resposta vazia.";
      continue;
    }
    const status = r?.status ?? 0;
    console.error("IA erro", prov.nome, prov.modelo, status, r ? (await r.text()).slice(0, 300) : "sem resposta");
    erro = status === 429 || status === 402
      ? "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens."
      : status === 401 || status === 403
        ? "A chave da IA foi recusada. Avise o time de Sistemas."
        : `Falha ao chamar a IA (HTTP ${status || "sem resposta"}).`;
  }
  return { erro };
}

interface LinhaTriagem {
  resposta_id: string;
  pergunta_id: string;
  linha: number;
  colaborador: string;
  setor: string | null;
  comentario: string;
  assinatura: string;
  status: string;
  triado: boolean;
  recomendado: boolean | null;
  motivo: string | null;
  habilitado: boolean;
  /** "v2|gemini:..." — versão da régua que leu (mig 20261114000100). */
  modelo?: string | null;
}

const paraTela = (l: LinhaTriagem) => ({
  resposta_id: l.resposta_id, pergunta_id: l.pergunta_id, linha: l.linha,
  recomendado: l.recomendado, motivo: l.motivo, habilitado: l.habilitado,
});

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

    const corpo = await req.json().catch(() => ({}));
    const formId = String(corpo?.form_id ?? "");
    const mes = String(corpo?.mes ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(formId) || !/^\d{4}-\d{2}$/.test(mes)) {
      return respostaJson({ error: "Informe o formulário e o mês (AAAA-MM)." }, 400);
    }

    // Portão + dados: a RPC recusa quem não tem acesso às permissões do formulário.
    const { data, error } = await supa.rpc("cs_form_mural_triagem", { _form_id: formId, _mes: `${mes}-01` });
    if (error) return respostaJson({ error: error.message, code: error.code }, error.code === "42501" ? 403 : 500);
    const linhas = (data ?? []) as LinhaTriagem[];

    // Nunca lidos + recomendados por uma régua anterior (ver precisaTriagem:
    // a releitura só acrescenta sinalização, não desfaz o que foi decidido).
    const aLer = linhas.filter(precisaTriagem);
    if (!aLer.length) return respostaJson({ itens: linhas.filter((l) => l.triado).map(paraTela), faltam: 0 });
    const lidos = new Set<LinhaTriagem>();

    const provs = provedores();
    if (!provs.length) {
      return respostaJson({
        itens: linhas.filter((l) => l.triado).map(paraTela), faltam: aLer.length,
        aviso: "A chave da IA não está configurada. Avise o time de Sistemas.",
      });
    }

    const ate = Date.now() + PRAZO_IA_MS;
    const lotes = emLotes(aLer, TAMANHO_LOTE);
    const erros: string[] = [];
    // Lotes em paralelo, poucos por vez (sem martelar o provedor).
    let proximo = 0;
    const trabalhar = async () => {
      while (proximo < lotes.length) {
        const lote = lotes[proximo++];
        const res = await chamarIA(provs, montarPromptTriagem(lote), ate);
        if (!res.texto) { erros.push(res.erro ?? "Falha na IA."); continue; }
        const resultado = lerResultadoTriagem(res.texto, lote.length);
        if (!resultado.length) { erros.push("A IA devolveu um formato inesperado."); continue; }
        const itens = resultado.map((r) => {
          const l = lote[r.indice];
          return { resposta_id: l.resposta_id, pergunta_id: l.pergunta_id, linha: l.linha,
                   assinatura: l.assinatura, recomendado: r.recomendado, motivo: r.motivo };
        });
        const { error: gErr } = await supa.rpc("cs_form_mural_triagem_gravar", { _form_id: formId, _itens: itens, _modelo: modeloComVersao(res.modelo) });
        if (gErr) { erros.push(gErr.message); continue; }
        for (const r of resultado) {
          const l = lote[r.indice];
          // Mesma assinatura: o banco preserva o "habilitado à mão" (e aqui
          // só chega quem não estava habilitado — ver precisaTriagem).
          l.triado = true; l.recomendado = r.recomendado; l.motivo = r.motivo;
          lidos.add(l);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOTES_EM_PARALELO, lotes.length) }, trabalhar));

    const faltam = aLer.filter((l) => !lidos.has(l)).length;
    return respostaJson({
      itens: linhas.filter((l) => l.triado).map(paraTela),
      faltam,
      ...(faltam ? { aviso: erros[0] ?? "Parte dos comentários não foi analisada a tempo." } : {}),
    });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível fazer a triagem agora." }, 500);
  }
});
