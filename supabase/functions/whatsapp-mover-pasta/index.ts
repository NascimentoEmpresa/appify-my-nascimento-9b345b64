// Arquivo: supabase/functions/whatsapp-mover-pasta/index.ts
// Move a conversa de pasta E avisa o contato pelo WhatsApp, numa operação só.
//
// Por que não ficou no front: mandar mensagem exige o WHATSAPP_TOKEN, que é
// secret de servidor. E por que não virou trigger no banco: trigger não faz
// chamada HTTP para a Graph API sem gambiarra (pg_net), e um envio que falha
// dentro de trigger derrubaria o próprio UPDATE.
//
// O UPDATE roda com a SESSÃO DO USUÁRIO de propósito: os triggers de histórico
// e de conclusão leem auth.uid() para saber quem moveu. Com service_role o
// registro sairia como "Sistema".
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const PASTA_CONCLUIDO = "atendimento_concluido";
const MSG_CONCLUIDO = "Seu atendimento foi marcado como Concluído.";
const msgTransferido = (setor: string) => `Seu atendimento foi transferido para o setor: ${setor}.`;

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
  const { data: userData } = await db.auth.getUser();
  if (!userData?.user) return json({ error: "sessão inválida" }, 401);

  let body: { conversa_id?: string; pasta_codigo?: string | null };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const conversaId = String(body.conversa_id ?? "").trim();
  const destino = body.pasta_codigo ? String(body.pasta_codigo) : null;
  if (!conversaId) return json({ error: "conversa_id é obrigatório" }, 400);

  // A RLS já barra conversa que o usuário não enxerga.
  const { data: conversa } = await db.from("WA_CONVERSA")
    .select("id, contato_id, pasta_codigo").eq("id", conversaId).maybeSingle();
  if (!conversa) return json({ error: "conversa não encontrada ou sem acesso" }, 403);

  // Pasta destino tem que existir e estar ativa; senão a conversa iria parar
  // numa fila que ninguém enxerga.
  let nomePasta: string | null = null;
  if (destino) {
    const { data: pasta } = await db.from("WA_PASTA")
      .select("codigo, nome").eq("codigo", destino).eq("ativo", true).maybeSingle();
    if (!pasta) return json({ error: "pasta inexistente ou inativa" }, 400);
    nomePasta = pasta.nome;
  }

  if (conversa.pasta_codigo === destino) {
    return json({ ok: true, semMudanca: true });
  }

  const { error: erroUpd } = await db.from("WA_CONVERSA")
    .update({ pasta_codigo: destino }).eq("id", conversaId);
  if (erroUpd) return json({ error: "não deu para mover", detalhe: erroUpd.message }, 400);

  // Sem destino (voltou para a triagem) não há o que comunicar: "seu
  // atendimento saiu de uma fila" não diz nada para quem está do outro lado.
  if (!destino) return json({ ok: true, avisado: false, motivo: "voltou para a triagem" });

  const texto = destino === PASTA_CONCLUIDO ? MSG_CONCLUIDO : msgTransferido(nomePasta ?? "");

  const { data: contato } = await db.from("WA_CONTATO")
    .select("wa_id").eq("id", conversa.contato_id).maybeSingle();
  if (!contato?.wa_id) return json({ ok: true, avisado: false, motivo: "contato sem número" });

  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: contato.wa_id, type: "text", text: { body: texto } }),
  });
  const data = await res.json().catch(() => ({}));
  const waId = res.ok ? (data?.messages?.[0]?.id ?? null) : null;

  // A mensagem é registrada mesmo quando falha: fora da janela de 24h ela
  // volta erro, e a bolha vermelha com o motivo é mais útil do que silêncio.
  // service_role porque quem grava aqui é o sistema, não o atendente.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await admin.from("WA_MENSAGEM").insert({
    conversa_id: conversaId, contato_id: conversa.contato_id, direcao: "saida",
    tipo: "text", texto, wa_message_id: waId,
    status: waId ? "enviada" : "erro", origem: "bot",
    ...(waId ? {} : { payload: { erro: { codigo: data?.error?.code ?? null, titulo: data?.error?.type ?? null, detalhe: data?.error?.message ?? null } } }),
  });
  if (waId) {
    await admin.from("WA_CONVERSA").update({
      ultima_mensagem_em: new Date().toISOString(),
      ultima_mensagem_preview: texto.slice(0, 120),
      ultima_direcao: "saida",
    }).eq("id", conversaId);
  }

  // Mover deu certo mesmo se o aviso falhou — por isso 200 com `avisado`.
  return json({ ok: true, avisado: !!waId, detalhe: waId ? null : data });
});
