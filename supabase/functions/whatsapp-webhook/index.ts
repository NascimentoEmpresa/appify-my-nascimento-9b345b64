// Arquivo: supabase/functions/whatsapp-webhook/index.ts
// Webhook da Meta WhatsApp Cloud API.
//   GET  → verificação do webhook (hub.challenge).
//   POST → recebe mensagens/status. Valida a assinatura X-Hub-Signature-256,
//          grava contato/conversa/mensagem (dedupe por wa_message_id) e, quando
//          o bot está ativo, gera a resposta com a IA (Claude) e envia de volta
//          pela Graph API. Responde 200 rápido; a resposta do bot roda em
//          segundo plano (EdgeRuntime.waitUntil).
//
// Secrets necessários (Supabase → Edge Functions → Secrets):
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_TOKEN,
//   WHATSAPP_PHONE_NUMBER_ID, ANTHROPIC_API_KEY
//   (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const GRAPH = "https://graph.facebook.com/v21.0";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ---------- assinatura ----------
async function assinaturaValida(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return true; // sem secret configurado → não bloqueia (dev)
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  const esperado = header.slice("sha256=".length);
  // comparação em tempo ~constante
  if (hex.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

// ---------- envio ----------
async function enviarTexto(to: string, body: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("Falha ao enviar WhatsApp:", JSON.stringify(data)); return null; }
  return data?.messages?.[0]?.id ?? null;
}

// ---------- horário de atendimento ----------
function dentroDoHorario(cfg: any): boolean {
  const agora = new Date();
  // usa fuso -03:00 (Brasil) de forma simples
  const local = new Date(agora.getTime() - 3 * 3600 * 1000);
  const dia = local.getUTCDay();               // 0..6
  const hhmm = local.getUTCHours() * 60 + local.getUTCMinutes();
  const dias: number[] = cfg.dias_semana ?? [1, 2, 3, 4, 5];
  if (!dias.includes(dia)) return false;
  const [hi, mi] = String(cfg.horario_inicio ?? "08:00").split(":").map(Number);
  const [hf, mf] = String(cfg.horario_fim ?? "18:00").split(":").map(Number);
  return hhmm >= hi * 60 + mi && hhmm <= hf * 60 + mf;
}

// ---------- resposta do bot (IA) ----------
// Recebe o cfg já carregado por processarBot (que valida ativo/horário).
async function responderComBot(conversaId: string, contatoId: string, to: string, cfg: any) {
  // Histórico recente (limite pra caber no contexto).
  const { data: hist } = await admin.from("WA_MENSAGEM")
    .select("direcao, texto").eq("conversa_id", conversaId)
    .order("criada_em", { ascending: false }).limit(20);
  const historico = (hist ?? []).reverse().filter((m: any) => m.texto);

  // Base de conhecimento.
  const { data: conh } = await admin.from("WA_BOT_CONHECIMENTO")
    .select("titulo, conteudo").eq("ativo", true).order("ordem");
  const base = (conh ?? []).map((c: any) => `## ${c.titulo}\n${c.conteudo}`).join("\n\n");

  const system = [
    cfg.persona,
    "Responda apenas com a mensagem final ao cliente, em português do Brasil, sem tags internas nem raciocínio.",
    base ? `\nBase de conhecimento (use quando pertinente):\n${base}` : "",
  ].filter(Boolean).join("\n");

  const messages = historico.map((m: any) => ({
    role: m.direcao === "entrada" ? "user" : "assistant",
    content: m.texto as string,
  }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return;

  let resposta = cfg.fallback as string;
  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const out: any = await anthropic.messages.create({
      model: cfg.modelo || "claude-opus-5",
      max_tokens: cfg.max_tokens || 1024,
      thinking: { type: "disabled" }, // resposta de chat: sem raciocínio, mais rápida e sem truncar
      system,
      messages,
    });
    const texto = (out.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (texto) resposta = texto;
  } catch (e) {
    console.error("Erro na IA:", e instanceof Error ? e.message : String(e));
  }

  await registrarSaida(conversaId, contatoId, to, resposta, "bot");
}

// Envia e registra uma mensagem de saída (bot/atendente).
async function registrarSaida(conversaId: string, contatoId: string, to: string, texto: string, origem: string) {
  const waId = await enviarTexto(to, texto);
  await admin.from("WA_MENSAGEM").insert({
    conversa_id: conversaId, contato_id: contatoId, direcao: "saida", tipo: "text",
    texto, wa_message_id: waId, status: waId ? "enviada" : "erro", origem,
  });
  await admin.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: texto.slice(0, 120),
    ultima_direcao: "saida",
  }).eq("id", conversaId);
}

// ---------- roteamento do bot (menu automático + IA) ----------
// Decide o que o bot faz a cada mensagem: clique no menu → ação; primeira
// mensagem → apresenta o menu; conversa livre → responde com a IA.
async function processarBot(
  conversaId: string, contatoId: string, to: string,
  msgType: string, texto: string | null, replyId: string | null,
) {
  const { data: cfg } = await admin.from("WA_BOT_CONFIG").select("*").limit(1).maybeSingle();
  if (!cfg || !cfg.ativo) return;

  // Fora do horário: manda o aviso e para.
  if (!dentroDoHorario(cfg)) {
    if (cfg.fora_horario_msg) await registrarSaida(conversaId, contatoId, to, cfg.fora_horario_msg, "bot");
    return;
  }

  const menu = cfg.menu && cfg.menu.ativo && Array.isArray(cfg.menu.opcoes) && cfg.menu.opcoes.length
    ? cfg.menu : null;

  // 1) Clique numa opção do menu → executa a ação configurada.
  if (replyId && menu) {
    const opt = menu.opcoes.find((o: any) => String(o.id) === replyId);
    if (opt) { await executarAcaoMenu(conversaId, contatoId, to, opt); return; }
  }

  // 2) Primeira mensagem da conversa → apresenta o menu.
  if (menu) {
    const { count } = await admin.from("WA_MENSAGEM")
      .select("id", { count: "exact", head: true })
      .eq("conversa_id", conversaId).eq("direcao", "entrada");
    if ((count ?? 0) <= 1) { await enviarMenu(conversaId, contatoId, to, menu); return; }
  }

  // 3) Conversa livre → responde com a IA (só texto).
  if (msgType === "text" && texto) await responderComBot(conversaId, contatoId, to, cfg);
}

// Executa a ação de uma opção do menu clicada.
async function executarAcaoMenu(conversaId: string, contatoId: string, to: string, opt: any) {
  const valor = typeof opt.valor === "string" ? opt.valor.trim() : "";
  if (opt.acao === "humano") {
    // Passa a conversa para atendimento humano (desliga o bot) e avisa o cliente.
    await admin.from("WA_CONVERSA").update({ bot_ativo: false }).eq("id", conversaId);
    if (valor) await registrarSaida(conversaId, contatoId, to, valor, "bot");
    return;
  }
  if (opt.acao === "texto") {
    await registrarSaida(conversaId, contatoId, to, valor || String(opt.titulo ?? "…"), "bot");
    return;
  }
  // acao "ia": manda um aviso opcional; as próximas mensagens caem na IA.
  if (valor) await registrarSaida(conversaId, contatoId, to, valor, "bot");
}

// Envia uma mensagem interativa (botões/lista) pela Graph API.
async function enviarInterativo(to: string, interactive: any): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "interactive", interactive }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error("Falha ao enviar interativo:", JSON.stringify(data)); return null; }
  return data?.messages?.[0]?.id ?? null;
}

// Monta e envia o menu: até 3 opções viram botões; 4–10 viram lista.
async function enviarMenu(conversaId: string, contatoId: string, to: string, menu: any) {
  const opcoes = (menu.opcoes as any[]).slice(0, 10);
  const corpo: string = (menu.titulo && String(menu.titulo).trim()) || "Como posso te ajudar?";
  const interactive = opcoes.length <= 3
    ? {
        type: "button",
        body: { text: corpo },
        action: { buttons: opcoes.map((o) => ({ type: "reply", reply: { id: String(o.id), title: String(o.titulo).slice(0, 20) } })) },
      }
    : {
        type: "list",
        body: { text: corpo },
        action: {
          button: "Ver opções",
          sections: [{ title: "Opções", rows: opcoes.map((o) => ({ id: String(o.id), title: String(o.titulo).slice(0, 24) })) }],
        },
      };
  const waId = await enviarInterativo(to, interactive);
  await admin.from("WA_MENSAGEM").insert({
    conversa_id: conversaId, contato_id: contatoId, direcao: "saida", tipo: "interactive",
    texto: corpo, wa_message_id: waId, status: waId ? "enviada" : "erro", origem: "bot",
    payload: { tipo: opcoes.length <= 3 ? "button" : "list", botoes: opcoes.map((o) => ({ id: String(o.id), titulo: String(o.titulo) })) },
  });
  await admin.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: corpo.slice(0, 120),
    ultima_direcao: "saida",
  }).eq("id", conversaId);
}

// ---------- handler ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação do webhook (configuração na Meta).
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await assinaturaValida(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const tarefas: Promise<unknown>[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const nomeContato = value.contacts?.[0]?.profile?.name ?? null;

      // Mensagens recebidas.
      for (const msg of value.messages ?? []) {
        const from: string = msg.from;
        const texto: string | null =
          msg.type === "text" ? msg.text?.body ?? null
          : msg.type === "button" ? msg.button?.text ?? null
          : msg.type === "interactive" ? (msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null)
          : null;
        // id do botão/opção clicado (payload da resposta interativa).
        const replyId: string | null = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id ?? null;

        // contato (upsert por wa_id). Só grava o nome quando a Meta mandou o
        // profile.name; se vier sem contacts (comum em mensagens seguintes),
        // preserva o nome já salvo em vez de sobrescrever com null.
        const contatoUpsert: Record<string, unknown> = { wa_id: from, telefone: from };
        if (nomeContato) contatoUpsert.nome = nomeContato;
        await admin.from("WA_CONTATO").upsert(
          contatoUpsert,
          { onConflict: "wa_id", ignoreDuplicates: false },
        );
        const { data: contato } = await admin.from("WA_CONTATO").select("id").eq("wa_id", from).maybeSingle();
        if (!contato) continue;

        // conversa (upsert por contato)
        await admin.from("WA_CONVERSA").upsert(
          { contato_id: contato.id }, { onConflict: "contato_id", ignoreDuplicates: true },
        );
        const { data: conversa } = await admin.from("WA_CONVERSA").select("id, bot_ativo").eq("contato_id", contato.id).maybeSingle();
        if (!conversa) continue;

        // dedupe: só processa se a mensagem é nova. Só inclui `payload` quando
        // há clique de botão, para não depender da coluna antes da migration.
        const entradaRow: Record<string, unknown> = {
          conversa_id: conversa.id, contato_id: contato.id, direcao: "entrada",
          tipo: msg.type ?? "text", texto: texto ?? `[${msg.type}]`,
          wa_message_id: msg.id, status: "recebida", origem: "contato",
        };
        if (replyId) entradaRow.payload = { reply_id: replyId };
        const { data: nova } = await admin.from("WA_MENSAGEM").insert(entradaRow).select("id").maybeSingle();
        if (!nova) continue; // já existia (reentrega da Meta)

        try { await admin.rpc("wa_incrementar_nao_lidas", { p_conversa: conversa.id }); } catch { /* best-effort */ }
        await admin.from("WA_CONVERSA").update({
          ultima_mensagem_em: new Date().toISOString(),
          ultima_mensagem_preview: (texto ?? `[${msg.type}]`).slice(0, 120),
          ultima_direcao: "entrada",
        }).eq("id", conversa.id);

        // resposta do bot em segundo plano (não segura o 200). Trata texto livre
        // e clique em botão/lista (menu automático).
        if (conversa.bot_ativo && ((msg.type === "text" && texto) || (msg.type === "interactive" && replyId))) {
          tarefas.push(processarBot(conversa.id, contato.id, from, msg.type, texto, replyId));
        }
      }

      // Status de mensagens enviadas. Em falha, guarda o motivo que a Meta
      // manda (st.errors) em meta — sem isso só sabíamos que falhou, não por quê.
      for (const st of value.statuses ?? []) {
        const mapa: Record<string, string> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "erro" };
        const novo = mapa[st.status];
        if (novo && st.id) {
          const update: Record<string, unknown> = { status: novo };
          if (st.status === "failed" && st.errors) {
            update.meta = { falha_webhook: st.errors };
            console.error("Status 'failed' recebido da Meta:", JSON.stringify(st));
          }
          await admin.from("WA_MENSAGEM").update(update).eq("wa_message_id", st.id);
        }
      }
    }
  }

  // processa o bot depois de responder 200 (best-effort)
  // @ts-ignore EdgeRuntime existe no runtime da Supabase
  if (typeof EdgeRuntime !== "undefined" && tarefas.length) {
    // @ts-ignore
    EdgeRuntime.waitUntil(Promise.allSettled(tarefas));
  } else {
    await Promise.allSettled(tarefas);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
