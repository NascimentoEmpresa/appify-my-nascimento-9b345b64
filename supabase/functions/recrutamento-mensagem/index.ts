// Arquivo: supabase/functions/recrutamento-mensagem/index.ts
//
// Dispara a mensagem automática de WhatsApp de uma etapa do recrutamento
// (TRIAGEM, ENTREVISTA, ENTREVISTA GESTOR, APROVADO).
//
// Por que TEMPLATE e não texto livre: a Cloud API só aceita texto livre
// dentro de 24h da última mensagem DO CONTATO. Candidato que se inscreveu
// pelo portal normalmente nunca escreveu no nosso número, então o texto
// livre voltaria 131047 na maioria das vezes. Template aprovado pela Meta
// pode iniciar conversa a qualquer momento.
//
// O texto de fato mora no Meta Business Manager. Aqui só resolvemos qual
// template, em que idioma, e o que entra em cada {{n}}.
//
// A mensagem entra na Caixa de Entrada como qualquer envio nosso: cria/reusa
// contato e conversa e grava em WA_MENSAGEM. Sem isso o RH responderia o
// candidato sem ver o que o sistema já tinha dito a ele.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const ETAPAS_COM_MENSAGEM = ["TRIAGEM", "ENTREVISTA", "ENTREVISTA GESTOR", "APROVADO"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// "PABLO SANTAREM" -> "Pablo". Nome gritado em caixa alta é como vem da folha
// e do portal; mandar assim para o candidato fica agressivo.
function primeiroNomeDe(nome: string): string {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

// 11 dígitos viram 55 + DDD + número. Quem já vem com 55 fica como está.
function waIdDe(telefone: string): string | null {
  const d = String(telefone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : "55" + d;
}

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

  let body: { candidato_id?: number; etapa?: string };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }

  const candidatoId = Number(body.candidato_id ?? 0);
  const etapa = String(body.etapa ?? "").trim();
  if (!candidatoId || !etapa) return json({ error: "candidato_id e etapa são obrigatórios" }, 400);
  if (!ETAPAS_COM_MENSAGEM.includes(etapa)) return json({ ok: true, enviado: false, motivo: "etapa_sem_mensagem" });

  // service_role: o log tem que ser gravável mesmo quando o envio falha, e a
  // tabela é só-leitura para o usuário de propósito.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const logar = (row: Record<string, unknown>) =>
    admin.from("RECRUTAMENTO_MENSAGENS_LOG").insert({ candidato_id: candidatoId, etapa, ...row });

  // ── Config da etapa ───────────────────────────────────────────────
  const { data: cfg } = await db.from("RECRUTAMENTO_MENSAGENS").select("*").eq("etapa", etapa).maybeSingle();
  if (!cfg || !cfg.ativo) {
    await logar({ status: "desligado" });
    return json({ ok: true, enviado: false, motivo: "desligado" });
  }
  if (!cfg.template_nome) {
    await logar({ status: "sem_config" });
    return json({ ok: true, enviado: false, motivo: "sem_template" });
  }

  // ── Candidato + vaga (para resolver os {{n}}) ─────────────────────
  const { data: cand } = await db.from("WA_CURRICULOS")
    .select("id, nome, telefone, vaga_id").eq("id", candidatoId).maybeSingle();
  if (!cand) return json({ error: "candidato não encontrado" }, 404);

  const waId = waIdDe(cand.telefone ?? "");
  if (!waId) {
    await logar({ status: "sem_telefone", telefone: cand.telefone ?? null });
    return json({ ok: true, enviado: false, motivo: "sem_telefone" });
  }

  let vaga: Record<string, unknown> | null = null;
  if (cand.vaga_id) {
    const { data } = await db.from("SISTEMA_RECRUTAMENTO")
      .select("cargo, cidade, contrato").eq("id", cand.vaga_id).maybeSingle();
    vaga = data ?? null;
  }

  const VARS: Record<string, string> = {
    primeiro_nome: primeiroNomeDe(cand.nome ?? ""),
    nome: String(cand.nome ?? "").trim(),
    cargo: String(vaga?.cargo ?? "").trim(),
    cidade: String(vaga?.cidade ?? "").trim(),
    contrato: String(vaga?.contrato ?? "").trim(),
    empresa: "Grupo Nascimento",
  };
  // A Meta recusa parâmetro vazio no template ("" quebra o envio inteiro),
  // então variável sem valor vira "-".
  const parametros: string[] = Array.isArray(cfg.parametros) ? cfg.parametros : [];
  const valores = parametros.map((p) => VARS[String(p)] || "-");

  // ── Contato e conversa (a mensagem tem que aparecer na Caixa) ─────
  await admin.from("WA_CONTATO").upsert(
    { wa_id: waId, nome: String(cand.nome ?? "").trim() || null, telefone: cand.telefone ?? null },
    { onConflict: "wa_id", ignoreDuplicates: false },
  );
  const { data: contato } = await admin.from("WA_CONTATO").select("id").eq("wa_id", waId).maybeSingle();
  if (!contato) return json({ error: "não consegui registrar o contato" }, 500);

  await admin.from("WA_CONVERSA").upsert(
    { contato_id: contato.id }, { onConflict: "contato_id", ignoreDuplicates: true },
  );
  const { data: conversa } = await admin.from("WA_CONVERSA").select("id").eq("contato_id", contato.id).maybeSingle();
  if (!conversa) return json({ error: "não consegui abrir a conversa" }, 500);

  // ── Envio ─────────────────────────────────────────────────────────
  const componentes = valores.length
    ? [{ type: "body", parameters: valores.map((v) => ({ type: "text", text: v })) }]
    : [];
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: waId, type: "template",
      template: {
        name: cfg.template_nome,
        language: { code: cfg.template_idioma || "pt_BR" },
        ...(componentes.length ? { components: componentes } : {}),
      },
    }),
  });
  const dataG = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Erro mais comum aqui é template inexistente/não aprovado no idioma
    // pedido (132001) — daí a mensagem da Meta ir crua para o log.
    const erro = dataG?.error?.message ?? JSON.stringify(dataG).slice(0, 500);
    await logar({ status: "erro", telefone: waId, template_nome: cfg.template_nome, erro });
    return json({ ok: false, enviado: false, motivo: "falha_envio", detalhe: erro }, 200);
  }

  const wamid = dataG?.messages?.[0]?.id ?? null;

  // Espelho legível na Caixa de Entrada. O template real está na Meta; aqui
  // substituímos os {{n}} na prévia para o atendente ver o que o candidato leu.
  let previa = String(cfg.texto_previa ?? "").trim();
  valores.forEach((v, i) => { previa = previa.replaceAll(`{{${i + 1}}}`, v); });
  const textoBolha = previa || `[template: ${cfg.template_nome}]`;

  await admin.from("WA_MENSAGEM").insert({
    conversa_id: conversa.id, contato_id: contato.id, direcao: "saida",
    tipo: "template", texto: textoBolha, wa_message_id: wamid, status: "enviada",
    origem: "recrutamento",
    meta: { etapa, candidato_id: candidatoId, template: cfg.template_nome, automatica: true },
  });
  await admin.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: textoBolha.slice(0, 120),
    ultima_direcao: "saida",
  }).eq("id", conversa.id);

  await logar({ status: "enviado", telefone: waId, template_nome: cfg.template_nome, wa_message_id: wamid });
  return json({ ok: true, enviado: true, wa_message_id: wamid });
});
