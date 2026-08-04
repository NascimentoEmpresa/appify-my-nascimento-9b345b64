// Arquivo: supabase/functions/notificar-chamado-whatsapp/index.ts
// Notifica por WhatsApp (Cloud API, mensagem de Template aprovada — "chamados_devs_interno")
// quando um Chamado de Sistemas é aberto ou atribuído a um dev.
// Chamado pelo front-end logo depois do INSERT/RPC bem sucedido, no mesmo
// padrão fire-and-forget de enviar-notificacao-push — não confia em nada que
// vier no corpo além de chamado_id/evento, busca tudo direto no banco.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (SUPABASE_URL / ANON /
// SERVICE_ROLE já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

// Gerente de Sistemas fixo — não deriva de profiles.cargo (esse campo é um
// backfill manual único, sem checagem de integridade; ver profiles_cargo.sql).
const GERENTE_SISTEMAS_ID = "d1dbc8d4-bf9b-4125-a6b1-11b6195155a4";

// Único template aprovado pela Meta pra chamado aberto/atribuído — o que muda
// entre os dois eventos é só o parâmetro de situação (último), não o nome do
// template (evita manter 2 templates aprovados pra praticamente o mesmo corpo).
const TEMPLATE_NAME = "chamados_devs_interno";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Parâmetros de template da Meta rejeitam quebra de linha, tab e espaços
// múltiplos — e não podem começar/terminar com espaço.
function sanitizeParam(v: string | null | undefined, maxLen = 300): string {
  const s = (v ?? "").replace(/[\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (s || "—").slice(0, maxLen);
}

function fmtDataHoraSP(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

interface Body {
  chamado_id?: string;
  evento?: "criado" | "atribuido";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const chamadoId = body.chamado_id;
  const evento = body.evento;
  if (!chamadoId || (evento !== "criado" && evento !== "atribuido")) {
    return json({ error: "chamado_id e evento ('criado' | 'atribuido') são obrigatórios" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Busca o chamado direto no banco — nunca confia em título/descrição vindos do corpo.
  const { data: chamado, error: chErr } = await admin
    .from("CHAMADO_SISTEMA")
    .select("id, numero, assunto, descricao, solicitante_nome, responsavel_id, created_at")
    .eq("id", chamadoId)
    .maybeSingle();
  if (chErr) return json({ error: chErr.message }, 500);
  if (!chamado) return json({ error: "chamado não encontrado" }, 404);

  const destinatarioId = evento === "criado" ? GERENTE_SISTEMAS_ID : chamado.responsavel_id;
  if (!destinatarioId) return json({ ok: true, enviado: false, motivo: "Sem responsável atribuído" });

  const { data: destinatario } = await admin
    .from("profiles")
    .select("telefone, display_name")
    .eq("id", destinatarioId)
    .maybeSingle();
  if (!destinatario?.telefone) {
    return json({ ok: true, enviado: false, motivo: "Destinatário sem telefone cadastrado" });
  }

  const numero = sanitizeParam(chamado.numero, 30);
  const assunto = sanitizeParam(chamado.assunto, 120);
  const descricao = sanitizeParam(chamado.descricao, 300);
  const solicitante = sanitizeParam(chamado.solicitante_nome, 100);
  const dataHora = fmtDataHoraSP(chamado.created_at as string);
  const situacao = evento === "criado"
    ? "Aguardando atribuição a um desenvolvedor."
    : sanitizeParam(`Atribuído a: ${destinatario.display_name ?? "—"}`, 120);

  const parametros = [numero, assunto, descricao, solicitante, dataHora, situacao];

  const mensagemGraph = {
    messaging_product: "whatsapp",
    to: destinatario.telefone,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: parametros.map((p) => ({ type: "text", text: p })) }],
    },
  };

  let waId: string | null = null;
  let enviado = false;
  let erro: string | null = null;
  try {
    const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(mensagemGraph),
    });
    const data = await res.json().catch(() => ({}));
    enviado = res.ok;
    waId = data?.messages?.[0]?.id ?? null;
    if (!res.ok) erro = JSON.stringify(data?.error ?? data);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }

  // Log só-de-staff (RLS já esconde 'observacao_interna' do solicitante).
  // autor_id é NOT NULL com FK pra auth.users — como este insert roda com o
  // client admin (sem sessão, auth.uid() nulo), atribui ao chamador da function.
  // O builder do PostgREST não implementa .catch() como método (só .then()),
  // então precisa envolver em try/catch em vez de encadear .catch() nele.
  try {
    await admin.from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: chamado.id,
      autor_id: userData.user.id,
      tipo: "observacao_interna",
      texto: enviado ? `WhatsApp enviado (${TEMPLATE_NAME})` : `Falha ao enviar WhatsApp (${TEMPLATE_NAME}): ${erro ?? "sem detalhe"}`,
      meta: { canal: "whatsapp", modo: TEMPLATE_NAME, evento, destinatario_id: destinatarioId, sucesso: enviado, wa_message_id: waId, erro },
    });
  } catch { /* log é best-effort, não pode derrubar a resposta da function */ }

  return json({ ok: true, enviado, wa_message_id: waId, erro });
});
