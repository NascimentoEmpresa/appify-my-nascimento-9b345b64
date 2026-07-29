// Arquivo: supabase/functions/whatsapp-enviar/index.ts
// Envia uma mensagem de texto pela WhatsApp Cloud API a partir da Caixa de
// Entrada (atendente humano). Autentica o usuário e faz as operações no banco
// com a sessão dele (a RLS de 'whatsapp' autoriza); só o envio na Graph API usa
// o token do servidor. Registra a mensagem de saída e zera as não lidas.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (SUPABASE_URL / ANON já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);

  let body: { conversa_id?: string; texto?: string; botoes?: Array<{ id?: string; titulo?: string }> };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const conversaId = body.conversa_id;
  const texto = (body.texto ?? "").trim();
  if (!conversaId || !texto) return json({ error: "conversa_id e texto são obrigatórios" }, 400);

  // Botões de resposta (opcional): até 3, título ≤ 20 caracteres (limite da Meta).
  const botoes = Array.isArray(body.botoes)
    ? body.botoes
        .filter((b) => b && typeof b.titulo === "string" && b.titulo.trim())
        .slice(0, 3)
        .map((b, i) => ({ id: String(b.id ?? `opt_${i + 1}`).slice(0, 256), titulo: b.titulo!.trim().slice(0, 20) }))
    : [];
  const temBotoes = botoes.length > 0;

  // Carrega a conversa + contato pela sessão do usuário (RLS autoriza quem tem 'whatsapp').
  const { data: conversa } = await db.from("WA_CONVERSA").select("id, contato_id").eq("id", conversaId).maybeSingle();
  if (!conversa) return json({ error: "conversa não encontrada ou sem acesso" }, 403);
  const { data: contato } = await db.from("WA_CONTATO").select("wa_id").eq("id", conversa.contato_id).maybeSingle();
  if (!contato) return json({ error: "contato não encontrado" }, 404);

  // Envia pela Graph API (token do servidor). Com botões vira mensagem
  // interativa (type "interactive"); sem botões, texto simples.
  const mensagemGraph = temBotoes
    ? {
        messaging_product: "whatsapp", to: contato.wa_id, type: "interactive",
        interactive: {
          type: "button",
          body: { text: texto },
          action: { buttons: botoes.map((b) => ({ type: "reply", reply: { id: b.id, title: b.titulo } })) },
        },
      }
    : { messaging_product: "whatsapp", to: contato.wa_id, type: "text", text: { body: texto } };

  let waId: string | null = null;
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(mensagemGraph),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: "falha ao enviar", detalhe: data }, 502);
  waId = data?.messages?.[0]?.id ?? null;

  // Registra a mensagem e atualiza a conversa (RLS pela sessão do usuário).
  // Só inclui `payload` quando há botões, para não depender da coluna nova
  // enquanto a migration não roda (envio de texto puro segue funcionando).
  const row: Record<string, unknown> = {
    conversa_id: conversa.id, contato_id: conversa.contato_id, direcao: "saida",
    tipo: temBotoes ? "interactive" : "text",
    texto, wa_message_id: waId, status: waId ? "enviada" : "erro",
    origem: "atendente", autor_id: userData.user.id,
  };
  if (temBotoes) row.payload = { tipo: "button", botoes };
  await db.from("WA_MENSAGEM").insert(row);
  await db.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: texto.slice(0, 120),
    ultima_direcao: "saida",
    nao_lidas: 0,
  }).eq("id", conversa.id);

  return json({ ok: true, wa_message_id: waId });
});
