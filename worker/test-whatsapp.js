// Teste isolado do envio de WhatsApp — não mexe com Supabase nem e-mail.
// Tenta 3 caminhos diferentes de envio pro mesmo destino, e fica escutando
// message_ack por 20s pra ver se o status de entrega muda depois do envio
// (às vezes o retorno imediato do sendMessage() não reflete o ack real).
// Rodar: node test-whatsapp.js [numero]
require("dotenv/config");
const { criarClienteWhatsapp } = require("./src/whatsapp");

const DESTINO = process.argv[2] || "5551998270853";
const digitos = String(DESTINO).replace(/\D/g, "");

const client = criarClienteWhatsapp();
const idsEnviados = [];

client.on("message_ack", (msg, ack) => {
  if (idsEnviados.includes(msg.id._serialized)) {
    console.log(`[message_ack] ${msg.id._serialized} -> ack agora é ${ack}`);
  }
});

client.on("ready", async () => {
  console.log("--- DIAGNÓSTICO ---");
  console.log("Conectado como (client.info.wid):", JSON.stringify(client.info?.wid, null, 2));
  console.log("Dígitos usados na busca:", digitos);

  // Caminho 1: @c.us direto (o jeito "clássico")
  try {
    console.log("\n[1] Tentando client.sendMessage direto em @c.us...");
    const msg1 = await client.sendMessage(`${digitos}@c.us`, "Teste 1/3 (via @c.us direto) — worker de reuniões.");
    idsEnviados.push(msg1.id._serialized);
    console.log("[1] OK, id:", msg1.id._serialized, "ack inicial:", msg1.ack);
  } catch (e) {
    console.log("[1] FALHOU:", e.message);
  }

  // Caminho 2: getNumberId() + sendMessage (o que já tínhamos testado)
  try {
    console.log("\n[2] Tentando getNumberId() + client.sendMessage...");
    const numberId = await client.getNumberId(digitos);
    console.log("[2] getNumberId retornou:", JSON.stringify(numberId));
    if (numberId) {
      const msg2 = await client.sendMessage(numberId._serialized, "Teste 2/3 (via getNumberId) — worker de reuniões.");
      idsEnviados.push(msg2.id._serialized);
      console.log("[2] OK, id:", msg2.id._serialized, "ack inicial:", msg2.ack);
    }
  } catch (e) {
    console.log("[2] FALHOU:", e.message);
  }

  // Caminho 3: getChatById + chat.sendMessage
  try {
    console.log("\n[3] Tentando getChatById() + chat.sendMessage...");
    const numberId = await client.getNumberId(digitos);
    if (numberId) {
      const chat = await client.getChatById(numberId._serialized);
      const msg3 = await chat.sendMessage("Teste 3/3 (via getChatById) — worker de reuniões.");
      idsEnviados.push(msg3.id._serialized);
      console.log("[3] OK, id:", msg3.id._serialized, "ack inicial:", msg3.ack);
    }
  } catch (e) {
    console.log("[3] FALHOU:", e.message);
  }

  console.log("\nAguardando 20s por eventos message_ack (0=pendente/1=enviado/2=entregue/3=lido)...");
  setTimeout(() => {
    console.log("\nFim da espera. Confira também o celular de destino.");
    process.exit(0);
  }, 20_000);
});

client.initialize();
