// Teste isolado do alerta de Discord — não mexe com WhatsApp nem Supabase.
// Rodar: node test-discord.js
require("dotenv/config");
const { alertarErroWhatsapp } = require("./src/discordAlert");

alertarErroWhatsapp("teste manual — se você recebeu isso no Discord, tá tudo certo").then(() => {
  console.log("Feito. Confira sua DM no Discord.");
});
