require("dotenv/config");
const { supabase } = require("./supabaseClient");
const { criarClienteWhatsapp } = require("./whatsapp");
const { criarTransportador } = require("./email");
const { enviarLembretes10min } = require("./lembreteWhatsapp");
const { enviarEmailsAta } = require("./emailAta");
const { verificarChamadosDevNovos } = require("./chamadosDev");
const { sincronizarCaepi } = require("./caepi");
const { sincronizarNfe } = require("./nfe");
const { darCienciaPendentes } = require("./nfeCiencia");
const { alertarErroWhatsapp } = require("./discordAlert");

const CICLO_MS = 60_000;

async function rodarCiclo(waClient, transportador) {
  try {
    // `waClient` vem nulo enquanto o WhatsApp não está pronto. Pular aqui é o
    // que permite o resto do ciclo rodar sem ele — ver a nota em `main`.
    if (waClient) await enviarLembretes10min(supabase, waClient);
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
  try {
    // Carga semanal; o próprio módulo decide se já é hora.
    await sincronizarCaepi(supabase);
  } catch (e) {
    console.error("[worker] erro no ciclo do catálogo de CA:", e);
  }
  try {
    // O módulo respeita o ritmo da SEFAZ e o recuo de 1h; ver src/nfe.js.
    await sincronizarNfe(supabase, alertarErroWhatsapp);
  } catch (e) {
    console.error("[worker] erro no ciclo de NF-e:", e);
  }
  try {
    // Escrita irreversivel na SEFAZ: so roda com NFE_CIENCIA=1 e em lotes
    // pequenos. Depois dela o XML completo chega pela fila de NSU.
    await darCienciaPendentes(supabase);
  } catch (e) {
    console.error("[worker] erro no ciclo de Ciencia da Operacao:", e);
  }
}

function main() {
  const waClient = criarClienteWhatsapp();
  const transportador = criarTransportador();

  // O ciclo NÃO espera o WhatsApp.
  //
  // Antes ele só começava no evento `ready`, e isso fazia uma tarefa das cinco
  // derrubar as outras quatro: com a sessão do WhatsApp expirada — o que
  // acontece sozinho, sem ninguém mexer em nada — a nota fiscal deixava de ser
  // buscada na SEFAZ, o catálogo de CA parava de carregar e o alerta de
  // vencimento do certificado não saía. Tudo em silêncio, esperando alguém
  // escanear um QR code.
  //
  // Agora o lembrete de reunião é a única coisa que depende do WhatsApp, e ele
  // se vira sozinho: enquanto não estiver pronto, essa tarefa é pulada e o
  // resto roda.
  let whatsappPronto = false;

  waClient.on("ready", () => {
    whatsappPronto = true;
    console.log("[worker] WhatsApp conectado — lembretes de reunião ativos.");
  });

  waClient.on("disconnected", (motivo) => {
    whatsappPronto = false;
    console.warn(`[worker] WhatsApp desconectou (${motivo}) — o resto do ciclo continua.`);
  });

  const ciclo = () => rodarCiclo(whatsappPronto ? waClient : null, transportador);

  console.log(`[worker] ciclo de verificação rodando a cada ${CICLO_MS / 1000}s...`);
  ciclo();
  setInterval(ciclo, CICLO_MS);

  waClient.initialize().catch((e) => {
    console.error("[worker] falha ao inicializar WhatsApp:", e);
    alertarErroWhatsapp(`falha ao inicializar: ${e.message}`);
  });
}

main();
