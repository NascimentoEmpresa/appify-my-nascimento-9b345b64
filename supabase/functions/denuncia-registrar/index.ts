// Arquivo: supabase/functions/denuncia-registrar/index.ts
// Registro público de denúncia — o endpoint que o formulário /denuncia chama.
//
// POR QUE EXISTE
// Antes a página falava direto com o PostgREST, e isso obriga o navegador a
// carregar a chave anon (que é um JWT). Aqui o navegador manda JSON puro, SEM
// nenhum header de autenticação: quem guarda a chave é esta função, no
// ambiente do servidor. Nenhum token, de nenhum tipo, passa pelo cliente.
//
// verify_jwt = false no config.toml — é público de propósito. Isso não
// afrouxa nada: a chave anon sempre foi pública (vai no bundle de qualquer
// app Supabase), então ela nunca foi barreira. A barreira real continua sendo
// a RPC, que valida os campos e é a única coisa que esta função alcança.
//
// Usa a chave ANON, não a service role: assim o GRANT da RPC continua valendo
// e esta função não ganha poder nenhum sobre o resto do banco.
//
// ANONIMATO: não loga corpo, IP nem user-agent. O que entra aqui vai direto
// para a RPC, que também não grava identidade. Ver a migration
// 20260812000001_canal_denuncias.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Confirmação no WhatsApp. Reaproveita os secrets que o módulo de WhatsApp já
// usa; ausentes, o envio simplesmente não acontece e o registro segue igual.
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const TEMPLATE = Deno.env.get("WHATSAPP_TEMPLATE_DENUNCIA") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

// "authorization" fica FORA do allow-headers de propósito: se um dia alguém
// mandar um token daqui, o navegador barra antes de sair.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("denuncia_registrar", { payload });

  if (error) {
    // A mensagem da RPC é escrita para o denunciante ler ("Preencha relação,
    // tipo de denúncia e como tomou conhecimento."), então vai inteira. O
    // resto do erro fica aqui.
    return json({ error: error.message || "Não foi possível registrar agora." }, 400);
  }

  // Confirmação no WhatsApp — best-effort de propósito. A denúncia JÁ está
  // gravada neste ponto; se a Graph API estiver fora, o número não existir ou
  // faltar template aprovado, a pessoa não pode receber erro por isso.
  const celular = typeof (payload as Record<string, unknown>)?.celular === "string"
    ? (payload as Record<string, string>).celular : "";
  if (celular) {
    try {
      await avisarNoWhatsApp(celular, (data as { protocolo?: string })?.protocolo ?? "", payload);
    } catch (_) {
      // Silêncio proposital: nada do envio pode vazar para a resposta, nem
      // sequer o fato de ter falhado — e log com telefone iria contra o
      // desenho de não registrar rastro do denunciante.
    }
  }

  return json(data);
});

/**
 * Manda protocolo e link pelo número do próprio denunciante.
 *
 * ⚠️ A Cloud API só aceita texto livre dentro da janela de 24h depois de a
 * pessoa ter escrito para o número. Fora dela é preciso TEMPLATE aprovado
 * pela Meta — configure o nome em WHATSAPP_TEMPLATE_DENUNCIA. Sem template,
 * a mensagem só chega a quem já conversou com o canal recentemente.
 */
async function avisarNoWhatsApp(celular: string, protocolo: string, payload: unknown) {
  if (!WA_TOKEN || !PHONE_NUMBER_ID) return;

  // Brasil: 55 + DDD + número. Descarta o que claramente não é telefone.
  const digitos = celular.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 13) return;
  const para = digitos.startsWith("55") ? digitos : `55${digitos}`;

  const base = (Deno.env.get("DENUNCIA_URL_BASE") ?? origemDoPayload(payload) ?? "").replace(/\/+$/, "");
  const link = base ? `${base}/denuncia?acompanhar` : "";

  const corpo = TEMPLATE
    ? {
        messaging_product: "whatsapp", to: para, type: "template",
        template: {
          name: TEMPLATE, language: { code: "pt_BR" },
          components: [{ type: "body", parameters: [{ type: "text", text: protocolo }] }],
        },
      }
    : {
        messaging_product: "whatsapp", to: para, type: "text",
        text: {
          preview_url: false,
          body:
            `Sua denúncia foi registrada no Canal de Ética do Grupo Nascimento.\n\n` +
            `Número do processo: ${protocolo}\n\n` +
            `Para acompanhar, acesse com o seu e-mail e a senha que você escolheu` +
            (link ? `:\n${link}` : ".") +
            `\n\nEsta mensagem é automática — não responda por aqui.`,
        },
      };

  await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

/** Origem enviada pela página, aceita só se for http(s) — vira link na mensagem. */
function origemDoPayload(payload: unknown): string | null {
  const o = (payload as Record<string, unknown>)?.origem_url;
  return typeof o === "string" && /^https?:\/\/[^\s]+$/.test(o) ? o : null;
}
