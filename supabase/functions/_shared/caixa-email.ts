// ─────────────────────────────────────────────────────────────────────────────
//  CAIXA DE E-MAIL DO ERP — o miolo das Edges que enviam o que a pessoa
//  escreveu numa tela estilo Gmail e gravam o resultado numa tabela.
//
//  Usado por:
//    fornecedor-email-enviar  (Suprimentos › Fornecedores, caixa compartilhada)
//    email-enviar             (módulo E-mail, cada um do próprio endereço)
//
//  Cada Edge só diz: qual menu/ação libera, qual tabela e bucket, quem é o
//  remetente e que colunas a mais a linha leva. O resto (validar, anexar do
//  Storage, enviar, gravar enviado/falhou) é igual e mora aqui — separado em
//  06/11/2026, quando a segunda caixa nasceu, para uma correção não precisar
//  ser feita duas vezes.
//
//  Ações do corpo:
//    { acao: "config" }  → o "De" que a tela mostra. Não envia nada.
//    { acao: "enviar", id?, para, cc, cco, assunto, html, anexos, responder_para, ... }
//
//  ANEXOS: só caminhos da pasta <uid>/ de quem envia — sem isso daria para
//  mandar para fora o arquivo que outra pessoa subiu. Teto de 20 MB somados
//  (o Resend recusa acima de 40 MB já em base64).
// ─────────────────────────────────────────────────────────────────────────────
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { enviarEmail, type AnexoEmail } from "./enviar-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMTP = {
  host: Deno.env.get("SMTP_HOST") ?? "",
  porta: Number(Deno.env.get("SMTP_PORT") ?? 587),
  usuario: Deno.env.get("SMTP_USER") ?? "",
  senha: Deno.env.get("SMTP_PASS") ?? "",
};

const MAX_DESTINATARIOS = 50;
const MAX_ANEXOS_BYTES = 20 * 1024 * 1024;
export const RE_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** "Nome <a@b>" ou "a@b" → "a@b". */
export function soEndereco(v: string): string {
  const m = v.match(/<([^>]+)>/);
  return (m ? m[1] : v).trim().toLowerCase();
}

/** Nome de exibição sem aspas nem quebra — vai dentro de "…" no cabeçalho. */
export function nomeSeguro(v: string): string {
  return v.replace(/["\r\n<>]/g, "").trim().slice(0, 80);
}

/** Há caminho de envio configurado no servidor? */
export function envioConfigurado(): boolean {
  return !!Deno.env.get("RESEND_API_KEY") || (!!SMTP.host && !!SMTP.usuario && !!SMTP.senha);
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

export interface Usuario {
  uid: string;
  emailLogin: string;
  nomePerfil: string;          // display_name ou o começo do e-mail
}

/** O "De" de uma mensagem. `de_email` null = não pode enviar (motivo diz por quê). */
export interface Remetente {
  de_nome: string;
  de_email: string | null;
  /** Reply-To padrão (o usuário pode desligar na tela). null = não usa. */
  responder_para: string | null;
  motivo?: string;
}

export interface ConfigCaixa {
  /** Menu e ação de has_screen_access que liberam escrever/enviar. */
  menu: string;
  acao: string;
  mensagemSemAcesso: string;
  tabela: string;
  bucket: string;
  remetente: (admin: SupabaseClient, u: Usuario) => Promise<Remetente>;
  /** Colunas a mais na linha gravada (ex.: fornecedor_ids). */
  colunasExtras?: (corpo: Record<string, unknown>) => Record<string, unknown>;
}

type AnexoPedido = { path: string; nome: string; tipo?: string; tamanho?: number };

export function servirCaixaEmail(cfg: ConfigCaixa) {
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
      _user: uid, _menu: cfg.menu, _acao: cfg.acao,
    });
    if (podeErr) return json({ error: podeErr.message }, 500);
    if (!pode) return json({ error: cfg.mensagemSemAcesso }, 403);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: perfil } = await admin.from("profiles").select("display_name").eq("id", uid).maybeSingle();
    const nomePerfil = nomeSeguro(String(perfil?.display_name ?? "") || emailLogin.split("@")[0] || "ERP");
    const rem = await cfg.remetente(admin, { uid, emailLogin, nomePerfil });

    const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
    const acao = String(corpo?.acao ?? "enviar");

    if (acao === "config") {
      return json({
        de_nome: rem.de_nome,
        de_email: rem.de_email,
        responder_para: rem.responder_para,
        autor_nome: nomePerfil,
        configurado: !!rem.de_email && envioConfigurado(),
        motivo: rem.de_email ? (envioConfigurado() ? null : "O envio não está configurado no servidor.") : (rem.motivo ?? null),
      });
    }
    if (acao !== "enviar") return json({ error: "Ação desconhecida." }, 400);

    // ── Validação ─────────────────────────────────────────────────────
    const para = listaEmails(corpo?.para);
    const cc = listaEmails(corpo?.cc).filter((e) => !para.includes(e));
    const cco = listaEmails(corpo?.cco).filter((e) => !para.includes(e) && !cc.includes(e));
    const todos = [...para, ...cc, ...cco];
    const assunto = String(corpo?.assunto ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
    const html = String(corpo?.html ?? "");
    const anexosPedido: AnexoPedido[] = Array.isArray(corpo?.anexos) ? corpo.anexos as AnexoPedido[] : [];
    const responderPara = corpo?.responder_para === false ? null : rem.responder_para;
    const rascunhoId = corpo?.id ? String(corpo.id) : null;

    if (!rem.de_email) return json({ error: rem.motivo ?? "Remetente não configurado." }, 400);
    if (para.length === 0) return json({ error: "Informe ao menos um destinatário em Para." }, 400);
    const invalidos = todos.filter((e) => !RE_EMAIL.test(e));
    if (invalidos.length) return json({ error: `Endereço inválido: ${invalidos.join(", ")}` }, 400);
    if (todos.length > MAX_DESTINATARIOS) return json({ error: `No máximo ${MAX_DESTINATARIOS} destinatários por mensagem.` }, 400);
    if (!assunto) return json({ error: "Informe o assunto." }, 400);
    if (html.length > 500_000) return json({ error: "Mensagem grande demais." }, 400);
    for (const a of anexosPedido) {
      if (!a?.path || !String(a.path).startsWith(`${uid}/`) || String(a.path).includes("..")) {
        return json({ error: "Anexo inválido." }, 400);
      }
    }

    // ── Rascunho → mensagem ───────────────────────────────────────────
    if (rascunhoId) {
      const { data: r } = await admin.from(cfg.tabela)
        .select("id, status, autor_id").eq("id", rascunhoId).maybeSingle();
      if (!r || r.autor_id !== uid || r.status !== "rascunho") {
        return json({ error: "Rascunho não encontrado (ou já enviado)." }, 409);
      }
    }

    const registro = {
      status: "enviando",
      de_nome: rem.de_nome, de_email: rem.de_email, responder_para: responderPara,
      para, cc, cco, assunto, corpo_html: html,
      anexos: anexosPedido.map((a) => ({ path: a.path, nome: a.nome, tipo: a.tipo ?? null, tamanho: a.tamanho ?? null })),
      erro: null, autor_id: uid, autor_nome: nomePerfil,
      ...(cfg.colunasExtras?.(corpo) ?? {}),
    };
    const gravado = rascunhoId
      ? await admin.from(cfg.tabela).update(registro).eq("id", rascunhoId).select("id").single()
      : await admin.from(cfg.tabela).insert(registro).select("id").single();
    if (gravado.error) return json({ error: gravado.error.message }, 500);
    const id = gravado.data.id as string;

    // Daqui em diante a resposta leva `id`: a tela sabe que a tentativa foi
    // gravada e que o rascunho de origem deixou de ser rascunho.
    const falhar = async (erro: string, status = 502) => {
      await admin.from(cfg.tabela).update({ status: "falhou", erro: erro.slice(0, 1000) }).eq("id", id);
      return json({ error: erro, id }, status);
    };

    // ── Anexos ────────────────────────────────────────────────────────
    const anexos: AnexoEmail[] = [];
    let total = 0;
    for (const a of anexosPedido) {
      const { data: blob, error } = await admin.storage.from(cfg.bucket).download(a.path);
      if (error || !blob) return await falhar(`Não foi possível ler o anexo "${a.nome}".`, 400);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      total += bytes.byteLength;
      if (total > MAX_ANEXOS_BYTES) return await falhar("Anexos passam de 20 MB somados.", 400);
      anexos.push({ nome: String(a.nome || a.path.split("/").pop()), tipo: a.tipo, base64: encodeBase64(bytes) });
    }

    // ── Envio ─────────────────────────────────────────────────────────
    try {
      await enviarEmail({
        de: `"${rem.de_nome}" <${rem.de_email}>`,
        para, cc, cco,
        responderPara: responderPara ?? undefined,
        assunto,
        html: envelopar(html),
        texto: htmlParaTexto(html),
        anexos,
      }, SMTP);
    } catch (e) {
      const erro = String((e as Error)?.message ?? e);
      console.error(`${cfg.tabela}: falha no envio`, erro);
      return await falhar(erro);
    }

    await admin.from(cfg.tabela)
      .update({ status: "enviado", enviado_em: new Date().toISOString(), erro: null }).eq("id", id);
    return json({ ok: true, id });
  });
}
