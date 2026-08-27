// Alerta de erro via DM do bot do Discord — só usado quando a sessão do
// WhatsApp cai/precisa logar de novo (não é um webhook de canal, é um bot
// de verdade mandando mensagem direta pro usuário).

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID;
const MENSAGEM_ERRO = "SESSÃO DE LOGIN NO WHATSAPP DEU ERRO. FAVOR LOGAR MANUALMENTE NOVAMENTE";

let dmChannelIdCache = null;

// ── Anti-repetição ───────────────────────────────────────────────────────
//
// Problema real, medido em 26/08/2026: o worker rodava o ciclo a cada 60s e
// cada falha PERSISTENTE virava uma DM. Sessão do WhatsApp caída, certificado
// perto de vencer e chamado que não conseguia abrir sessão geraram dezenas de
// mensagens idênticas em minutos, e o Discord do Eduardo virou spam.
//
// Alerta que se repete deixa de ser alerta: quem recebe trinta iguais para de
// ler, e a mensagem que importa se perde no meio. Então a mesma mensagem só
// volta depois de um intervalo — o problema continua sinalizado, sem virar
// ruído.
//
// O estado é em memória de propósito: reiniciar o worker é a hora legítima de
// avisar de novo, porque significa que alguém mexeu ou que ele caiu.

const INTERVALO_REPETICAO_MS = 6 * 60 * 60 * 1000; // 6 horas
const ultimoEnvio = new Map();

/**
 * A chave é a própria mensagem, sem normalizar números.
 *
 * Cheguei a colapsar dígitos para agrupar mensagens parecidas, e o efeito foi
 * pior que o problema: dois chamados DIFERENTES falhando pelo mesmo motivo
 * viravam a mesma assinatura, e o segundo era silenciado. Alerta que esconde
 * falha nova é pior que alerta repetido.
 *
 * Dá para ser preciso aqui porque a retentativa infinita foi corrigida na
 * origem (o cursor de `chamadosDev` avança mesmo quando falha). Esta trava é a
 * segunda linha de defesa, não a única.
 */
function assinatura(mensagem) {
  return String(mensagem).slice(0, 200);
}

function deveEnviar(mensagem) {
  const chave = assinatura(mensagem);
  const agora = Date.now();
  const anterior = ultimoEnvio.get(chave);
  if (anterior && agora - anterior < INTERVALO_REPETICAO_MS) return false;
  ultimoEnvio.set(chave, agora);
  return true;
}

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

async function enviarAlertaDiscord(mensagem, { forcar = false } = {}) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_USER_ID) {
    console.error("[discord] DISCORD_BOT_TOKEN/DISCORD_USER_ID não configurados no .env — não deu pra alertar.");
    return;
  }
  if (!forcar && !deveEnviar(mensagem)) {
    // Fica no log local, que não incomoda ninguém: o problema continua
    // visível para quem for investigar, sem gerar mais uma DM.
    console.warn("[discord] alerta repetido, silenciado:", String(mensagem).slice(0, 80));
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
