// Arquivo: supabase/functions/fornecedor-email-enviar/index.ts
//
// Envia o e-mail escrito na caixa de Fornecedores (Suprimentos) e grava o
// resultado em "SUP_FORNECEDOR_EMAIL" (migration 20261106009500).
//
// Duas ações:
//   { acao: "config" }  → quem está escrevendo e de onde a mensagem sai (o
//                         "De" que a tela mostra). Não envia nada.
//   { acao: "enviar", id?, para, cc, cco, assunto, html, anexos,
//     fornecedor_ids, responder_para }
//                       → envia. `id` = rascunho que vira a mensagem enviada.
//
// Portão: JWT do usuário + has_screen_access('fornecedores_email','incluir').
// Só esta function marca uma mensagem como enviada/falhou (service role); a
// RLS deixa a tela mexer apenas no próprio rascunho.
//
// REMETENTE: o "De" NÃO é livre. O Resend só entrega pelo domínio verificado,
// então o endereço vem do secret SUPRIMENTOS_EMAIL_FROM (ou SMTP_FROM, ou
// SMTP_USER — o mesmo de comite-etica-nova-denuncia). O nome de exibição leva
// o nome de quem escreveu e o Reply-To o e-mail do login: o fornecedor
// responde direto para a pessoa, não para uma caixa que ninguém lê.
//
// ANEXOS: sobem pela tela no bucket privado sup-fornecedor-email, na pasta
// <uid>/. Aqui só se aceita caminho da própria pasta — sem isso daria para
// mandar, por e-mail para fora, o arquivo que outra pessoa subiu.
// Teto de 20 MB somados (o Resend recusa acima de 40 MB já em base64).
//
// Secrets: RESEND_API_KEY (preferido) ou SMTP_HOST/PORT/USER/PASS;
// SUPRIMENTOS_EMAIL_FROM opcional.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { enviarEmail, type AnexoEmail } from "../_shared/enviar-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? 587);
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const FROM_CRU = Deno.env.get("SUPRIMENTOS_EMAIL_FROM") || Deno.env.get("SMTP_FROM") || SMTP_USER;

const BUCKET = "sup-fornecedor-email";
const MAX_DESTINATARIOS = 50;
const MAX_ANEXOS_BYTES = 20 * 1024 * 1024;
const RE_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** "Nome <a@b>" ou "a@b" → "a@b". */
function soEndereco(v: string): string {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim();
}

/** Nome de exibição sem aspas nem quebra — vai dentro de "…" no cabeçalho. */
function nomeSeguro(v: string): string {
  return v.replace(/["\r\n<>]/g, "").trim().slice(0, 80);
}

function listaEmails(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const saida: string[] = [];
  for (const x of v) {
    const e = String(x ?? "").trim().toLowerCase();
    if (e && !saida.includes(e)) saida.push(e);
  }
  return saida;
}

function htmlParaTexto(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function envelopar(html: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#202124">${html}</div>`
    + `</body></html>`;
}

type AnexoPedido = { path: string; nome: string; tipo?: string; tamanho?: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Faça login." }, 401);

  const supa = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await supa.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401);
  const uid = userData.user.id;
  const emailLogin = String(userData.user.email ?? "").toLowerCase();

  const { data: pode, error: podeErr } = await supa.rpc("has_screen_access", {
    _user: uid, _menu: "fornecedores_email", _acao: "incluir",
  });
  if (podeErr) return json({ error: podeErr.message }, 500);
  if (!pode) return json({ error: "Você não tem a ação 'incluir' em Fornecedores — E-mails." }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: perfil } = await admin
    .from("profiles").select("display_name").eq("id", uid).maybeSingle();
  const autorNome = nomeSeguro(String(perfil?.display_name ?? "") || emailLogin.split("@")[0] || "Suprimentos");
  const deEmail = soEndereco(FROM_CRU);
  const deNome = `${autorNome} · Suprimentos Grupo Nascimento`;

  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao ?? "enviar");

  if (acao === "config") {
    return json({
      de_nome: deNome,
      de_email: deEmail || null,
      responder_para: emailLogin || null,
      autor_nome: autorNome,
      configurado: !!deEmail && (!!Deno.env.get("RESEND_API_KEY") || (!!SMTP_HOST && !!SMTP_USER && !!SMTP_PASS)),
    });
  }
  if (acao !== "enviar") return json({ error: "Ação desconhecida." }, 400);

  // ── Validação ───────────────────────────────────────────────────────
  const para = listaEmails(corpo?.para);
  const cc = listaEmails(corpo?.cc).filter((e) => !para.includes(e));
  const cco = listaEmails(corpo?.cco).filter((e) => !para.includes(e) && !cc.includes(e));
  const todos = [...para, ...cc, ...cco];
  const assunto = String(corpo?.assunto ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
  const html = String(corpo?.html ?? "");
  const anexosPedido: AnexoPedido[] = Array.isArray(corpo?.anexos) ? corpo.anexos : [];
  const fornecedorIds: string[] = Array.isArray(corpo?.fornecedor_ids)
    ? corpo.fornecedor_ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)) : [];
  const responderPara = corpo?.responder_para === false ? null : (emailLogin || null);
  const rascunhoId = corpo?.id ? String(corpo.id) : null;

  if (para.length === 0) return json({ error: "Informe ao menos um destinatário em Para." }, 400);
  const invalidos = todos.filter((e) => !RE_EMAIL.test(e));
  if (invalidos.length) return json({ error: `Endereço inválido: ${invalidos.join(", ")}` }, 400);
  if (todos.length > MAX_DESTINATARIOS) return json({ error: `No máximo ${MAX_DESTINATARIOS} destinatários por mensagem.` }, 400);
  if (!assunto) return json({ error: "Informe o assunto." }, 400);
  if (html.length > 500_000) return json({ error: "Mensagem grande demais." }, 400);
  if (!deEmail) return json({ error: "Remetente não configurado no servidor (SUPRIMENTOS_EMAIL_FROM / SMTP_FROM)." }, 500);

  for (const a of anexosPedido) {
    if (!a?.path || !String(a.path).startsWith(`${uid}/`) || String(a.path).includes("..")) {
      return json({ error: "Anexo inválido." }, 400);
    }
  }

  // ── Rascunho → mensagem ─────────────────────────────────────────────
  if (rascunhoId) {
    const { data: r } = await admin.from("SUP_FORNECEDOR_EMAIL")
      .select("id, status, autor_id").eq("id", rascunhoId).maybeSingle();
    if (!r || r.autor_id !== uid || r.status !== "rascunho") {
      return json({ error: "Rascunho não encontrado (ou já enviado)." }, 409);
    }
  }

  const registro = {
    status: "enviando",
    fornecedor_ids: fornecedorIds,
    de_nome: deNome, de_email: deEmail, responder_para: responderPara,
    para, cc, cco, assunto, corpo_html: html,
    anexos: anexosPedido.map((a) => ({ path: a.path, nome: a.nome, tipo: a.tipo ?? null, tamanho: a.tamanho ?? null })),
    erro: null, autor_id: uid, autor_nome: autorNome,
  };
  const gravado = rascunhoId
    ? await admin.from("SUP_FORNECEDOR_EMAIL").update(registro).eq("id", rascunhoId).select("id").single()
    : await admin.from("SUP_FORNECEDOR_EMAIL").insert(registro).select("id").single();
  if (gravado.error) return json({ error: gravado.error.message }, 500);
  const id = gravado.data.id as string;

  const falhar = async (erro: string, status = 502) => {
    await admin.from("SUP_FORNECEDOR_EMAIL").update({ status: "falhou", erro: erro.slice(0, 1000) }).eq("id", id);
    return json({ error: erro, id }, status);
  };

  // ── Anexos ──────────────────────────────────────────────────────────
  const anexos: AnexoEmail[] = [];
  let total = 0;
  for (const a of anexosPedido) {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(a.path);
    if (error || !blob) return await falhar(`Não foi possível ler o anexo "${a.nome}".`, 400);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    total += bytes.byteLength;
    if (total > MAX_ANEXOS_BYTES) return await falhar("Anexos passam de 20 MB somados.", 400);
    anexos.push({ nome: String(a.nome || a.path.split("/").pop()), tipo: a.tipo, base64: encodeBase64(bytes) });
  }

  // ── Envio ───────────────────────────────────────────────────────────
  try {
    await enviarEmail({
      de: `"${deNome}" <${deEmail}>`,
      para, cc, cco,
      responderPara: responderPara ?? undefined,
      assunto,
      html: envelopar(html),
      texto: htmlParaTexto(html),
      anexos,
    }, { host: SMTP_HOST, porta: SMTP_PORT, usuario: SMTP_USER, senha: SMTP_PASS });
  } catch (e) {
    const erro = String((e as Error)?.message ?? e);
    console.error("fornecedor-email-enviar: falha", erro);
    return await falhar(erro);
  }

  await admin.from("SUP_FORNECEDOR_EMAIL")
    .update({ status: "enviado", enviado_em: new Date().toISOString(), erro: null }).eq("id", id);
  return json({ ok: true, id });
});
