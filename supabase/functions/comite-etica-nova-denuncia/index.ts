// Arquivo: supabase/functions/comite-etica-nova-denuncia/index.ts
//
// Avisa o Comitê de Ética, por e-mail, que uma denúncia acabou de entrar.
//
// Disparada pelo trigger trg_canal_denuncia_avisa_comite em CANAL_DENUNCIA
// (migration 20260925000002) via pg_net — mesmo padrão de
// novidade-ia-chamado e dos ticks de cron.
//
// O E-MAIL É MUDO SOBRE O CONTEÚDO — protocolo e data/hora, nada mais.
// O módulo inteiro trata aviso assim (ver comite-etica-alertas-tick: "canal
// de ética não vaza por push"), e e-mail é pior que push nesse quesito: sai
// do ERP, pode ser encaminhado e fica num servidor que a RLS não alcança.
// Assunto, descrição, gravidade, denunciado e denunciante ficam de fora de
// propósito. O protocolo basta para abrir o caso no ERP, onde o acesso é
// controlado. Se algum dia pedirem "só o tipo da denúncia", lembre que o
// tipo já é conteúdo.
//
// Destinatários vêm de CANAL_DENUNCIA_AVISO_EMAIL (ativos), não do código:
// trocar quem recebe é rotina do Comitê e não pode depender de deploy.
//
// Secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
// (Sem eles a função responde 500 e registra a falha no log — o silêncio
// aqui seria pior do que o erro.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? 587);
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";

const APP_URL = "https://appify-my-nascimento.lovable.app/app/comite-etica/denuncias";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

/** dd/mm/aaaa às HH:MM no fuso de São Paulo — o e-mail é lido por gente daqui. */
function quando(iso: string): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const p = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} às ${p("hour")}:${p("minute")}`;
}

function corpoHtml(protocolo: string, dataHora: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f1f5f9;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="background:#0f3171;padding:20px 24px;color:#fff">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Grupo Nascimento</div>
      <div style="font-size:18px;font-weight:700;margin-top:2px">Comitê de Ética</div>
    </td></tr>
    <tr><td style="padding:24px">
      <p style="margin:0 0 16px;font-size:15px">Uma nova denúncia foi registrada no Canal de Ética.</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr>
          <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Protocolo</td>
          <td style="padding:10px 12px;border:1px solid #e2e8f0;font-weight:700;font-size:15px">${protocolo}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Registrada em</td>
          <td style="padding:10px 12px;border:1px solid #e2e8f0;font-size:15px">${dataHora}</td>
        </tr>
      </table>
      <a href="${APP_URL}" style="display:inline-block;background:#0f3171;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:14px">Abrir no ERP</a>
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;line-height:1.5">
        Por sigilo, este aviso não traz o teor da denúncia. Os detalhes ficam no ERP,
        onde o acesso é registrado.
      </p>
    </td></tr>
    <tr><td style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
      Mensagem automática do ERP — não responda a este e-mail.
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let denunciaId = "";
  try {
    const body = await req.json();
    denunciaId = String(body?.denuncia_id ?? "").trim();
  } catch { return json({ error: "json inválido" }, 400); }
  if (!denunciaId) return json({ error: "denuncia_id é obrigatório" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Idempotência antes de tudo: o pg_net reentrega, e ninguém precisa
  // receber o mesmo aviso duas vezes.
  const { data: jaFoi } = await admin
    .from("CANAL_DENUNCIA_AVISO_LOG")
    .select("denuncia_id, ok").eq("denuncia_id", denunciaId).maybeSingle();
  if (jaFoi?.ok) return json({ ok: true, enviados: 0, motivo: "já avisado" });

  // Só o que vai no e-mail sai da tabela. Nem por engano um `select *` aqui.
  const { data: d, error: dErr } = await admin
    .from("CANAL_DENUNCIA")
    .select("id, protocolo, created_at").eq("id", denunciaId).maybeSingle();
  if (dErr) return json({ error: dErr.message }, 500);
  if (!d) return json({ ok: true, enviados: 0, motivo: "denúncia não encontrada" });

  const { data: dest } = await admin
    .from("CANAL_DENUNCIA_AVISO_EMAIL").select("nome, email").eq("ativo", true);
  const emails = (dest ?? []).map((r) => String((r as { email: string }).email));
  if (emails.length === 0) {
    // Lista vazia é configuração, não erro de entrega: não marca como
    // enviado, para o dia em que alguém cadastrar não perder o aviso.
    return json({ ok: true, enviados: 0, motivo: "nenhum destinatário ativo" });
  }

  const registrar = (ok: boolean, erro?: string) =>
    admin.from("CANAL_DENUNCIA_AVISO_LOG").upsert({
      denuncia_id: denunciaId,
      protocolo: d.protocolo,
      destinatarios: emails,
      enviado_em: new Date().toISOString(),
      ok, erro: erro ?? null,
    }, { onConflict: "denuncia_id" });

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    const erro = "SMTP não configurado no servidor (SMTP_HOST/USER/PASS)";
    console.error(erro);
    await registrar(false, erro);
    return json({ error: erro }, 500);
  }

  const dataHora = quando(String(d.created_at));
  const protocolo = String(d.protocolo ?? "—");

  try {
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        // 465 é TLS implícito; 587 sobe por STARTTLS, que o denomailer
        // negocia sozinho quando `tls` é false.
        tls: SMTP_PORT === 465,
        auth: { username: SMTP_USER, password: SMTP_PASS },
      },
    });

    // Um envio por destinatário, em BCC-de-pobre: sem isso cada um vê o
    // e-mail do outro no cabeçalho, e a composição do Comitê é informação
    // que não precisa circular.
    for (const to of emails) {
      await client.send({
        from: SMTP_USER,
        to,
        subject: `Comitê de Ética — nova denúncia (${protocolo})`,
        content: `Uma nova denúncia foi registrada no Canal de Ética.\n\n`
               + `Protocolo: ${protocolo}\nRegistrada em: ${dataHora}\n\n`
               + `Acesse o ERP para ver os detalhes: ${APP_URL}\n\n`
               + `Por sigilo, este aviso não traz o teor da denúncia.\n`
               + `Mensagem automática — não responda.`,
        html: corpoHtml(protocolo, dataHora),
      });
    }
    await client.close();
  } catch (e) {
    const erro = String((e as Error)?.message ?? e);
    console.error("falha no envio", erro);
    // Marca ok=false: o log fica com o motivo e o reenvio manual continua
    // possível, porque a idempotência só barra o que saiu com sucesso.
    await registrar(false, erro);
    return json({ error: "falha ao enviar o e-mail", detalhe: erro }, 502);
  }

  await registrar(true);
  return json({ ok: true, enviados: emails.length, protocolo });
});
