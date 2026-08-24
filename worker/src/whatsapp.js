const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { alertarErroWhatsapp } = require("./discordAlert");

function criarClienteWhatsapp() {
  const client = new Client({
    // LocalAuth já persiste a sessão em disco (./.wwebjs_auth) sozinho —
    // reiniciar o processo reaproveita a sessão sem precisar reescanear o
    // QR, contanto que o WhatsApp não invalide a sessão do celular.
    authStrategy: new LocalAuth({ dataPath: "./.wwebjs_auth" }),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });

  client.on("qr", (qr) => {
    console.log("\nEscaneie o QR code abaixo com o WhatsApp (Aparelhos conectados):\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log("[whatsapp] sessão pronta.");
  });

  client.on("auth_failure", (msg) => {
    console.error("[whatsapp] falha de autenticação:", msg);
    alertarErroWhatsapp(`auth_failure: ${msg}`);
  });

  client.on("disconnected", (reason) => {
    console.error("[whatsapp] desconectado:", reason);
    alertarErroWhatsapp(`disconnected: ${reason}`);
  });

  return client;
}

// Manda mensagem resolvendo o contato antes via getNumberId(), em vez de
// montar "<numero>@c.us" na mão — evitar isso dá erro "No LID for user" em
// versões recentes do WhatsApp Web (sistema novo de identificação de
// contatos, LID). getNumberId() força o WhatsApp Web a registrar o contato
// internamente antes de mandar, o que resolve o LID corretamente.
async function enviarMensagemWhatsapp(client, telefone, texto) {
  const digitos = String(telefone).replace(/\D/g, "");
  const numberId = await client.getNumberId(digitos);
  if (!numberId) {
    throw new Error(`Número ${telefone} não encontrado no WhatsApp (ou não foi possível resolver).`);
  }
  return client.sendMessage(numberId._serialized, texto);
}

module.exports = { criarClienteWhatsapp, enviarMensagemWhatsapp };
