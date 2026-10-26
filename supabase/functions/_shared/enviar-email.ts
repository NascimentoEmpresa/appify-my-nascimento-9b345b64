// ─────────────────────────────────────────────────────────────────────────────
//  O ENVIO DE E-MAIL DO ERP, NUM LUGAR SÓ
//
//  POR QUE ISTO EXISTE (22/10/2026)
//  O e-mail da empresa fica na UOL Host, e a UOL **recusa entregar mensagem
//  vinda dos IPs do cluster**: o banco1 autentica e leva
//  `554 5.7.1 Rejected for policy reason`, e o banco2 não abre conexão em porta
//  nenhuma. A mesma caixa, com a mesma senha, envia `250 Ok` a partir da rede
//  da empresa — ou seja, credencial certa, IP de origem recusado. Isso atingia
//  TODA function que manda e-mail, não só a cobrança: o aviso de denúncia do
//  Comitê de Ética estava no mesmo buraco, sem ninguém perceber.
//
//  A saída foi um serviço transacional (Resend). Só que trocar o endereço do
//  SMTP não bastou: o Resend respondeu `554: Failed to parse email message` a
//  cada tentativa. Provado em 22/10 que não era conta, chave, domínio nem
//  remetente — o mesmo envio, pela mesma caixa e chave, partindo de um
//  nodemailer, foi aceito com `250`. O que o Resend não aceita é o MIME que o
//  `denomailer` monta.
//
//  Por isso o caminho preferido é a **API HTTP**: o corpo vai como JSON e quem
//  monta a mensagem é o próprio Resend. Sem RESEND_API_KEY, cai no SMTP de
//  antes — nada muda para quem não cadastrou a chave.
// ─────────────────────────────────────────────────────────────────────────────
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export interface EmailParaEnviar {
  de: string;                 // remetente; precisa ser do domínio verificado
  para: string[];
  cc?: string[];
  assunto: string;
  html?: string;
  texto?: string;
}

/** Credenciais do SMTP de fallback. Os nomes variam por function (COBRANCA_*). */
export interface SmtpConfig {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
}

async function porApiDoResend(chave: string, e: EmailParaEnviar) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: e.de,
      to: e.para,
      ...(e.cc?.length ? { cc: e.cc } : {}),
      subject: e.assunto,
      ...(e.html ? { html: e.html } : {}),
      ...(e.texto ? { text: e.texto } : {}),
    }),
  });
  if (!res.ok) {
    // A mensagem do Resend é específica ("domain is not verified", "from
    // address is not allowed"...). Levar ela inteira: é ela que diz o conserto.
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function porSmtp(cfg: SmtpConfig, e: EmailParaEnviar) {
  const client = new SMTPClient({
    connection: {
      hostname: cfg.host,
      port: cfg.porta,
      tls: cfg.porta === 465,
      auth: { username: cfg.usuario, password: cfg.senha },
    },
  });
  try {
    await client.send({
      from: e.de,
      to: e.para,
      cc: e.cc?.length ? e.cc : undefined,
      subject: e.assunto,
      ...(e.html ? { html: e.html, content: "auto" as const } : { content: e.texto ?? "" }),
    });
  } finally {
    try { await client.close(); } catch { /* conexão já caiu: o erro que interessa é o do envio */ }
  }
}

/**
 * Manda o e-mail pelo melhor caminho disponível: API do Resend quando houver
 * `RESEND_API_KEY`, senão o SMTP recebido. Quem chama não precisa saber qual.
 */
export async function enviarEmail(e: EmailParaEnviar, smtp: SmtpConfig): Promise<void> {
  const chave = Deno.env.get("RESEND_API_KEY");
  if (chave) return await porApiDoResend(chave, e);
  if (!smtp.host || !smtp.usuario || !smtp.senha) {
    throw new Error("Sem caminho de envio: nem RESEND_API_KEY, nem SMTP completo.");
  }
  return await porSmtp(smtp, e);
}
