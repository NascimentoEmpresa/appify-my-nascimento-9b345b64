// Alerta de erro via DM do bot do Discord — só usado quando a sessão do
// WhatsApp cai/precisa logar de novo (não é um webhook de canal, é um bot
// de verdade mandando mensagem direta pro usuário).

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID;
const MENSAGEM_ERRO = "SESSÃO DE LOGIN NO WHATSAPP DEU ERRO. FAVOR LOGAR MANUALMENTE NOVAMENTE";

let dmChannelIdCache = null;

async function obterCanalDm() {
  if (dmChannelIdCache) return dmChannelIdCache;
  const res = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: DISCORD_USER_ID }),
  });
  if (!res.ok) {
    console.error("[discord] falha ao abrir canal de DM:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  dmChannelIdCache = data.id;
  return dmChannelIdCache;
}

async function enviarAlertaDiscord(mensagem) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_USER_ID) {
    console.error("[discord] DISCORD_BOT_TOKEN/DISCORD_USER_ID não configurados no .env — não deu pra alertar.");
    return;
  }
  try {
    const channelId = await obterCanalDm();
    if (!channelId) return;
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: mensagem }),
    });
    if (!res.ok) {
      console.error("[discord] falha ao enviar mensagem de alerta:", res.status, await res.text());
    }
  } catch (e) {
    console.error("[discord] erro inesperado ao alertar:", e);
  }
}

async function alertarErroWhatsapp(detalheExtra) {
  const conteudo = detalheExtra ? `${MENSAGEM_ERRO}\n\n(${detalheExtra})` : MENSAGEM_ERRO;
  return enviarAlertaDiscord(conteudo);
}

module.exports = { alertarErroWhatsapp, enviarAlertaDiscord };
