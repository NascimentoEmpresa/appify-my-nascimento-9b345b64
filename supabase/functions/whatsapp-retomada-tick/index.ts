// Arquivo: supabase/functions/whatsapp-retomada-tick/index.ts
// Dispara as cutucadas agendadas em WA_RETOMADA (chamado pelo cron a cada 5
// min). Uma cutucada é uma mensagem que o bot manda SOZINHO quando a pessoa
// parou de responder — configurada por opção do menu, no Chatbot.
//
// Regras que este tick garante (a fila só diz "quando"; o "se" é aqui):
//   - a pessoa respondeu depois do agendamento  → não cutuca (cancelada);
//   - um atendente assumiu (bot_ativo = false)  → não cutuca (cancelada);
//   - passou das 24h da última mensagem dela    → não cutuca (expirada),
//     porque a Meta recusaria com 131047 e sobraria só um "erro" na tela.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const JANELA_MS = 24 * 60 * 60 * 1000;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  // Só o cron dispara isto. A anon key não serve de tranca: ela é publicável e
  // está no bundle do front, então qualquer pessoa conseguiria chamar a função
  // e forçar o processamento da fila. O segredo fica no Vault (lado do cron) e
  // nos secrets da function (aqui) — nunca no repositório.
  const esperado = Deno.env.get("WHATSAPP_TICK_SECRET") ?? "";
  if (!esperado || req.headers.get("x-tick-secret") !== esperado) {
    return json({ error: "não autorizado" }, 401);
  }

  const agora = new Date();
  const { data: pendentes, error } = await admin.from("WA_RETOMADA")
    .select("id, conversa_id, contato_id, mensagem")
    .eq("status", "pendente").lte("enviar_em", agora.toISOString())
    .order("enviar_em", { ascending: true }).limit(100);
  if (error) return json({ error: error.message }, 500);

  const fecha = (id: string, status: string, detalhe: string) =>
    admin.from("WA_RETOMADA")
      .update({ status, detalhe, processada_em: new Date().toISOString() }).eq("id", id);

  const contagem = { enviadas: 0, canceladas: 0, expiradas: 0, falhas: 0 };

  for (const r of pendentes ?? []) {
    // 1) Um humano assumiu? O bot não fala por cima do atendente.
    const { data: conversa } = await admin.from("WA_CONVERSA")
      .select("bot_ativo").eq("id", r.conversa_id).maybeSingle();
    if (!conversa || conversa.bot_ativo === false) {
      await fecha(r.id, "cancelada", "atendimento humano assumiu a conversa");
      contagem.canceladas++;
      continue;
    }

    // 2) Última mensagem DELA — define se ainda estamos dentro das 24h e se
    //    ela já respondeu (o webhook cancela, mas uma corrida é possível).
    const { data: ultima } = await admin.from("WA_MENSAGEM")
      .select("criada_em").eq("conversa_id", r.conversa_id).eq("direcao", "entrada")
      .order("criada_em", { ascending: false }).limit(1).maybeSingle();
    const idade = ultima ? agora.getTime() - new Date(ultima.criada_em).getTime() : Infinity;
    if (idade >= JANELA_MS) {
      await fecha(r.id, "expirada", "fora da janela de 24h — só template seria aceito");
      contagem.expiradas++;
      continue;
    }

    // 3) Envia.
    const { data: contato } = await admin.from("WA_CONTATO")
      .select("wa_id").eq("id", r.contato_id).maybeSingle();
    if (!contato?.wa_id) {
      await fecha(r.id, "cancelada", "contato sem número");
      contagem.canceladas++;
      continue;
    }

    const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: contato.wa_id,
        type: "text", text: { body: r.mensagem },
      }),
    });
    const data = await res.json().catch(() => ({}));
    const waId = res.ok ? (data?.messages?.[0]?.id ?? null) : null;

    await admin.from("WA_MENSAGEM").insert({
      conversa_id: r.conversa_id, contato_id: r.contato_id, direcao: "saida",
      tipo: "text", texto: r.mensagem, wa_message_id: waId,
      status: waId ? "enviada" : "erro", origem: "bot",
    });
    if (waId) {
      await admin.from("WA_CONVERSA").update({
        ultima_mensagem_em: agora.toISOString(),
        ultima_mensagem_preview: r.mensagem.slice(0, 120),
        ultima_direcao: "saida",
      }).eq("id", r.conversa_id);
      await fecha(r.id, "enviada", "");
      contagem.enviadas++;
    } else {
      console.error("Retomada falhou:", JSON.stringify(data));
      await fecha(r.id, "cancelada", `falha no envio: ${JSON.stringify(data).slice(0, 300)}`);
      contagem.falhas++;
    }
  }

  return json({ ok: true, ...contagem });
});
