// Arquivo: supabase/functions/chamado-parecer-ia/index.ts
//
// Parecer da I.A sobre um Chamado de Sistemas (mig 20261029000900): três
// preços médios de mercado (freelancer, software house, equipe interna — cada
// um com valor/hora × horas e a explicação) e a complexidade de 1 a 5 com a
// justificativa. Grava em CHAMADO_SISTEMA_PARECER_IA; a tela só LÊ de lá.
//
// Entrega real (29/10/2026): além do texto de abertura, a I.A recebe as PRs
// do chamado e as métricas do GitHub, e precifica o que FOI ENTREGUE. Ao
// concluir, o parecer é refeito sozinho (fila com `forcar`).
//
// Modo "chat" (29/10/2026): conversa sobre os custos do parecer ("da onde
// você tirou esse valor?"). Quem vê o chamado pode perguntar — o portão é a
// própria RLS de CHAMADO_SISTEMA, lida com o JWT de quem perguntou. Não grava
// nada: o histórico vem do cliente a cada pergunta.
//
// Dois jeitos de GERAR o parecer:
//   · worker/fila_http (Bearer = service_role): chamado recém-aberto e o
//     backfill da migration. Parecer já pronto é pulado — não gasta token.
//   · botão "Gerar de novo" na tela (Bearer = JWT do usuário): confere
//     chamado_parecer_ia_pode_gerar (gestão de chamados ou o responsável)
//     COM O LOGIN DE QUEM CLICOU antes de qualquer coisa, e refaz sempre.
//
// A I.A falhar NÃO some em silêncio: a linha fica com status 'erro' e a
// mensagem, e a tela mostra. Se já havia um parecer pronto, ele é mantido e
// só o botão recebe o erro.
//
// Provedor: o mesmo de pesquisa-permanencia-ia — Gemini (GEMINI_API_KEY)
// primeiro; erro passageiro tenta de novo; sem tokens ou chave recusada, passa
// ao Groq (GROQ_API_KEY, modelo openai/gpt-oss-120b). Chaves nos secrets da
// Edge Function, nunca em arquivo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  extrairJson, limparHistorico, montarPrompt, montarSistemaChat, resumirEntrega, validarParecer, SYSTEM_PROMPT,
  type ChamadoParaParecer, type EntregaReal, type EventoGithub, type ParecerParaChat,
} from "../_shared/chamado-parecer-ia.ts";

const CAMPOS_CHAMADO = "id, numero, assunto, tipo_solicitacao, descricao, categorias, modulo_sistema, modulo_sistema_outro, ambiente, impacto_trabalho, urgencia, afeta_usuarios, observacoes_solicitante, definicao, status, created_at, concluido_em";

/** O que foi entregue de fato: PRs e métricas gravadas pelo vínculo/merge do
 *  GitHub (chamado-vincular-pr / chamado-concluir-pr). Sem PR, null. */
async function carregarEntrega(admin: ReturnType<typeof createClient>, c: ChamadoParaParecer): Promise<EntregaReal | null> {
  const { data, error } = await admin.from("CHAMADO_SISTEMA_EVENTO")
    .select("created_at, meta")
    .eq("chamado_id", c.id)
    .eq("meta->>canal", "github")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) { console.error("eventos github", error.message); return null; }
  return resumirEntrega((data ?? []) as EventoGithub[], c);
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
                 modelo: Deno.env.get("IA_PARECER_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({ nome: "groq", url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
                 modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" });
  }
  return lista;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamarIA(provs: Provedor[], messages: { role: string; content: string }[], json = true):
  Promise<{ texto?: string; provedor?: string; modelo?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível gerar o parecer agora.", status: 502 };
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: prov.modelo,
          temperature: 0.2,
          messages,
          // O Groq aceita forçar JSON; no Gemini o extrairJson dá conta da cerca ```.
          ...(json && prov.nome === "groq" ? { response_format: { type: "json_object" } } : {}),
        }),
      }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto, provedor: prov.nome, modelo: prov.modelo };
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

type Cliente = ReturnType<typeof createClient>;

async function responderChat(supa: Cliente, admin: Cliente, chamadoId: string, corpo: Record<string, unknown>): Promise<Response> {
  const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
  if (!pergunta) return respostaJson({ error: "Escreva a pergunta." }, 400);

  // Com o JWT de quem pergunta: se a RLS não deixa ver o chamado, não há conversa.
  const { data: c, error: cErr } = await supa.from("CHAMADO_SISTEMA").select(CAMPOS_CHAMADO).eq("id", chamadoId).maybeSingle();
  if (cErr) return respostaJson({ error: cErr.message }, 500);
  if (!c) return respostaJson({ error: "Você não tem acesso a este chamado." }, 403);

  const { data: p } = await admin.from("CHAMADO_SISTEMA_PARECER_IA")
    .select("status, precos, valor_medio, horas_estimadas, complexidade_nivel, complexidade_rotulo, complexidade_justificativa, premissas")
    .eq("chamado_id", chamadoId).maybeSingle();
  if (!p || p.status !== "pronto") return respostaJson({ error: "Este chamado ainda não tem parecer pronto para conversar." }, 409);

  const provs = provedores();
  if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

  const chamado = c as unknown as ChamadoParaParecer;
  const entrega = await carregarEntrega(admin, chamado);
  const res = await chamarIA(provs, [
    { role: "system", content: montarSistemaChat(chamado, p as unknown as ParecerParaChat, entrega) },
    ...limparHistorico(corpo?.historico),
    { role: "user", content: pergunta },
  ], false);
  if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
  return respostaJson({ texto: res.texto });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respostaJson({ error: "Use POST." }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let chamadoId = "";

  // Erro vai para a linha (a tela mostra) — mas sem apagar um parecer pronto.
  const registrarErro = async (msg: string) => {
    if (!chamadoId) return;
    const { data: atual } = await admin.from("CHAMADO_SISTEMA_PARECER_IA")
      .select("status").eq("chamado_id", chamadoId).maybeSingle();
    if (atual?.status === "pronto") return;
    await admin.from("CHAMADO_SISTEMA_PARECER_IA")
      .upsert({ chamado_id: chamadoId, status: "erro", erro: msg.slice(0, 500) }, { onConflict: "chamado_id" });
  };

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Faça login." }, 401);
    const token = authHeader.slice(7).trim();
    const viaFila = token === SERVICE_ROLE;

    const corpo = await req.json().catch(() => ({}));
    chamadoId = String(corpo?.chamado_id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(chamadoId)) { chamadoId = ""; return respostaJson({ error: "chamado_id inválido." }, 400); }

    let solicitadoPor: string | null = null;
    if (!viaFila) {
      // Com o login de quem pediu: o mesmo portão do botão na tela.
      const supa = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await supa.auth.getUser();
      if (userErr || !userData?.user) { chamadoId = ""; return respostaJson({ error: "Sessão inválida." }, 401); }
      if (corpo?.modo === "chat") {
        // Chat não grava nada: erro dele vai só para a conversa, nunca para a linha.
        const id = chamadoId;
        chamadoId = "";
        return await responderChat(supa, admin, id, corpo);
      }
      const { data: pode, error: podeErr } = await supa.rpc("chamado_parecer_ia_pode_gerar", { p_chamado_id: chamadoId });
      if (podeErr) { chamadoId = ""; return respostaJson({ error: podeErr.message }, 500); }
      if (!pode) { chamadoId = ""; return respostaJson({ error: "Só a gestão de chamados ou o responsável pode gerar o parecer." }, 403); }
      solicitadoPor = userData.user.id;
    } else {
      // Fila: parecer pronto não é refeito (reentrega do worker, backfill de
      // novo) — salvo `forcar`, que vem da conclusão do chamado e da
      // reavaliação pela entrega real (mig 20261029001200).
      const { data: atual } = await admin.from("CHAMADO_SISTEMA_PARECER_IA")
        .select("status").eq("chamado_id", chamadoId).maybeSingle();
      if (atual?.status === "pronto" && corpo?.forcar !== true) return respostaJson({ ok: true, pulado: "já pronto" });
    }

    const { data: c, error: cErr } = await admin
      .from("CHAMADO_SISTEMA")
      .select(CAMPOS_CHAMADO)
      .eq("id", chamadoId)
      .maybeSingle();
    if (cErr) { await registrarErro(cErr.message); return respostaJson({ error: cErr.message }, 500); }
    if (!c) { chamadoId = ""; return respostaJson({ ok: true, pulado: "chamado não encontrado" }); }

    const provs = provedores();
    if (!provs.length) {
      const msg = "A chave da IA não está configurada. Avise o time de Sistemas.";
      await registrarErro(msg);
      return respostaJson({ error: msg }, 500);
    }

    const chamado = c as unknown as ChamadoParaParecer;
    const entrega = await carregarEntrega(admin, chamado);
    const res = await chamarIA(provs, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: montarPrompt(chamado, entrega) },
    ]);
    if (!res.texto) {
      await registrarErro(res.erro ?? "Falha ao chamar a IA.");
      return respostaJson({ error: res.erro }, res.status ?? 502);
    }

    const v = validarParecer(extrairJson(res.texto));
    if (!v.ok) {
      console.error("parecer inválido", chamadoId, res.texto.slice(0, 500));
      await registrarErro(v.erro);
      return respostaJson({ error: v.erro }, 502);
    }

    const linha = {
      chamado_id: chamadoId,
      status: "pronto",
      ...v.parecer,
      provedor: res.provedor,
      modelo: res.modelo,
      erro: null,
      solicitado_por: solicitadoPor,
      gerado_em: new Date().toISOString(),
    };
    const { error: gravErr } = await admin.from("CHAMADO_SISTEMA_PARECER_IA").upsert(linha, { onConflict: "chamado_id" });
    if (gravErr) { console.error("gravar parecer", gravErr); return respostaJson({ error: gravErr.message }, 500); }

    return respostaJson({ ok: true, parecer: linha });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "Não foi possível gerar o parecer agora.";
    await registrarErro(msg).catch(() => {});
    return respostaJson({ error: msg }, 500);
  }
});
