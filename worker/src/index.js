require("dotenv/config");
const { supabase } = require("./supabaseClient");
const { criarClienteWhatsapp } = require("./whatsapp");
const { criarTransportador } = require("./email");
const { enviarLembretes10min } = require("./lembreteWhatsapp");
const { enviarEmailsAta } = require("./emailAta");
const { verificarChamadosDevNovos } = require("./chamadosDev");
const { alertarErroWhatsapp } = require("./discordAlert");

const CICLO_MS = 60_000;

async function rodarCiclo(waClient, transportador) {
  try {
    await enviarLembretes10min(supabase, waClient);
  } catch (e) {
    console.error("[worker] erro no ciclo de lembretes:", e);
  }
  try {
    await enviarEmailsAta(supabase, transportador);
  } catch (e) {
    console.error("[worker] erro no ciclo de e-mails:", e);
  }
  try {
    await verificarChamadosDevNovos(supabase);
  } catch (e) {
    console.error("[worker] erro no ciclo de chamados de dev:", e);
  }
}

function main() {
  const waClient = criarClienteWhatsapp();
  const transportador = criarTransportador();

  waClient.on("ready", () => {
    console.log(`[worker] ciclo de verificação rodando a cada ${CICLO_MS / 1000}s...`);
    rodarCiclo(waClient, transportador);
    setInterval(() => rodarCiclo(waClient, transportador), CICLO_MS);
  });

  waClient.initialize().catch((e) => {
    console.error("[worker] falha ao inicializar WhatsApp:", e);
    alertarErroWhatsapp(`falha ao inicializar: ${e.message}`);
  });
}

main();
