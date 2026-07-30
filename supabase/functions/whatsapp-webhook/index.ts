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
//   WHATSAPP_PHONE_NUMBER_ID
//   + a chave do provedor de IA escolhido em WA_BOT_CONFIG.provedor:
//     groq → GROQ_API_KEY | gemini → GEMINI_API_KEY
//     openrouter → OPENROUTER_API_KEY | anthropic → ANTHROPIC_API_KEY
//   (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  dentroDoHorario, menuAtivo, montarBase, montarSystem, gerarResposta,
  rotearBot, inferirModo, type Msg,
} from "../_shared/whatsapp-bot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

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

// ---------- resposta do bot (IA) ----------
// Recebe o cfg e o histórico já carregados por processarBot.
async function responderComBot(
  conversaId: string, contatoId: string, to: string, cfg: any,
  mensagens: Array<{ direcao: string; texto: string | null }>,
) {
  // Base de conhecimento.
  const { data: conh } = await admin.from("WA_BOT_CONHECIMENTO")
    .select("titulo, conteudo").eq("ativo", true).order("ordem");

  const historico = mensagens.filter((m) => m.texto);
  // No fluxo normal a IA entra numa conversa que o menu já abriu, então não
  // cumprimenta de novo. `primeiraFala` só vale no caso de borda de menu vazio.
  const primeiraFala = !historico.some((m) => m.direcao === "saida");
  const system = montarSystem(cfg, montarBase(conh ?? []), primeiraFala);

  const messages: Msg[] = historico.map((m) => ({
    role: m.direcao === "entrada" ? "user" : "assistant",
    content: m.texto as string,
  }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") return;

  const r = await gerarResposta(cfg, system, messages);
  if (r.erro) console.error(`Erro na IA (${r.provedor}/${r.modelo}):`, r.erro);

  await registrarSaida(conversaId, contatoId, to, r.texto ?? (cfg.fallback as string), "bot");
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

// ---------- roteamento do bot (fluxo único guiado por menu) ----------
// Um único ponto de decisão por mensagem, via rotearBot: o menu abre toda
// conversa; a IA só assume depois que a pessoa clica na opção de atendimento por
// IA. O modo da conversa é reconstruído do histórico (inferirModo), então não
// precisa de coluna nova no banco.
async function processarBot(
  conversaId: string, contatoId: string, to: string,
  msgType: string, texto: string | null, replyId: string | null,
) {
  const { data: cfg } = await admin.from("WA_BOT_CONFIG").select("*").limit(1).maybeSingle();
  if (!cfg || !cfg.ativo) return;

  // Histórico recente com payload — o payload guarda o reply_id de cada clique,
  // que é o que inferirModo usa para saber se a conversa já está na IA.
  const { data: hist } = await admin.from("WA_MENSAGEM")
    .select("direcao, texto, payload").eq("conversa_id", conversaId)
    .order("criada_em", { ascending: false }).limit(20);
  const mensagens = (hist ?? []).reverse();

  const modo = inferirModo(cfg as any, mensagens as any);
  const rota = rotearBot(cfg as any, {
    modo,
    texto: msgType === "text" ? texto : null,
    replyId,
    dentroHorario: dentroDoHorario(cfg as any),
  });

  switch (rota.tipo) {
    case "fora_horario":
      if (cfg.fora_horario_msg) await registrarSaida(conversaId, contatoId, to, cfg.fora_horario_msg, "bot");
      return;
    case "menu": {
      const menu = menuAtivo(cfg as any);
      if (menu) await enviarMenu(conversaId, contatoId, to, menu);
      return;
    }
    case "texto":
      await registrarSaida(conversaId, contatoId, to, rota.texto, "bot");
      return;
    case "humano":
      // Passa a conversa para atendimento humano (desliga o bot) e avisa.
      await admin.from("WA_CONVERSA").update({ bot_ativo: false }).eq("id", conversaId);
      await registrarSaida(conversaId, contatoId, to, rota.aviso, "bot");
      return;
    case "ia_intro":
      // Entrou na IA: manda o aviso; as próximas mensagens caem na IA.
      await registrarSaida(conversaId, contatoId, to, rota.aviso, "bot");
      return;
    case "ia":
      await responderComBot(conversaId, contatoId, to, cfg, mensagens);
      return;
  }
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

// ---------- mídia recebida ----------
// Baixa uma mídia da Cloud API (via media id) e sobe pro bucket privado
// 'whatsapp-midia'. Retorna o caminho salvo + mime + tamanho.
async function salvarMidiaWhatsApp(
  mediaId: string, mimeHint: string | null,
): Promise<{ storage_path: string; mime_type: string; tamanho: number | null } | null> {
  // 1) URL temporária da mídia.
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  const meta: any = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta?.url) { console.error("Falha ao obter URL da mídia:", JSON.stringify(meta)); return null; }
  // 2) baixa o binário (a URL da Graph exige o token).
  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  if (!fileRes.ok) { console.error("Falha ao baixar mídia:", fileRes.status); return null; }
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  const mime = meta.mime_type || mimeHint || "application/octet-stream";
  const path = `wa/${mediaId}`;
  // 3) sobe pro Storage (service_role bypassa RLS).
  const { error } = await admin.storage.from("whatsapp-midia").upload(path, bytes, { contentType: mime, upsert: true });
  if (error) { console.error("Falha ao subir mídia:", error.message); return null; }
  return { storage_path: path, mime_type: mime, tamanho: meta.file_size ? Number(meta.file_size) : bytes.length };
}

// Baixa a mídia e atualiza o payload da mensagem (status pronto/erro),
// preservando o que já estava no payload.
async function processarMidia(mensagemId: string, midia: any) {
  const salvo = await salvarMidiaWhatsApp(midia.media_id, midia.mime_type);
  const midiaAtualizada = salvo
    ? { ...midia, storage_path: salvo.storage_path, mime_type: salvo.mime_type, tamanho: salvo.tamanho, status: "pronto" }
    : { ...midia, status: "erro" };
  const { data: atual } = await admin.from("WA_MENSAGEM").select("payload").eq("id", mensagemId).maybeSingle();
  const merged = { ...((atual?.payload as Record<string, unknown>) ?? {}), midia: midiaAtualizada };
  await admin.from("WA_MENSAGEM").update({ payload: merged }).eq("id", mensagemId);
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

        // Mídia recebida (documento/imagem/áudio/vídeo/sticker): guarda os
        // metadados; o arquivo é baixado em segundo plano e salvo no Storage.
        const MIDIA_TIPOS = ["image", "document", "audio", "video", "sticker"];
        const midiaMsg = MIDIA_TIPOS.includes(msg.type) ? (msg[msg.type] ?? {}) : null;
        const midia = midiaMsg && midiaMsg.id ? {
          tipo: String(msg.type),
          media_id: String(midiaMsg.id),
          filename: midiaMsg.filename ?? null,
          mime_type: midiaMsg.mime_type ?? null,
          caption: midiaMsg.caption ?? null,
          status: "baixando",
        } : null;

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
        const textoFinal = texto ?? midia?.caption ?? `[${msg.type}]`;
        const payloadEntrada: Record<string, unknown> = {};
        if (replyId) payloadEntrada.reply_id = replyId;
        if (midia) payloadEntrada.midia = midia;
        const entradaRow: Record<string, unknown> = {
          conversa_id: conversa.id, contato_id: contato.id, direcao: "entrada",
          tipo: msg.type ?? "text", texto: textoFinal,
          wa_message_id: msg.id, status: "recebida", origem: "contato",
        };
        if (Object.keys(payloadEntrada).length) entradaRow.payload = payloadEntrada;
        const { data: nova } = await admin.from("WA_MENSAGEM").insert(entradaRow).select("id").maybeSingle();
        if (!nova) continue; // já existia (reentrega da Meta)

        // Baixa o arquivo em segundo plano e atualiza a mensagem com o caminho.
        if (midia) tarefas.push(processarMidia(nova.id, midia));

        try { await admin.rpc("wa_incrementar_nao_lidas", { p_conversa: conversa.id }); } catch { /* best-effort */ }
        await admin.from("WA_CONVERSA").update({
          ultima_mensagem_em: new Date().toISOString(),
          ultima_mensagem_preview: textoFinal.slice(0, 120),
          ultima_direcao: "entrada",
        }).eq("id", conversa.id);

        // resposta do bot em segundo plano (não segura o 200). Trata texto livre
        // e clique em botão/lista (menu automático).
        if (conversa.bot_ativo && ((msg.type === "text" && texto) || (msg.type === "interactive" && replyId))) {
          tarefas.push(processarBot(conversa.id, contato.id, from, msg.type, texto, replyId));
        }
      }

      // Status de mensagens enviadas.
      for (const st of value.statuses ?? []) {
        const mapa: Record<string, string> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "erro" };
        const novo = mapa[st.status];
        if (novo && st.id) {
          await admin.from("WA_MENSAGEM").update({ status: novo }).eq("wa_message_id", st.id);
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
