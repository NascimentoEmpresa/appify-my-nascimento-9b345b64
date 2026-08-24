// Chamado pelo iniciar.bat quando o "npm start" encerra com código de erro
// (processo do worker caiu de vez — diferente do alerta de sessão do
// WhatsApp, que é disparado de dentro do próprio processo rodando).
require("dotenv/config");
const { enviarAlertaDiscord } = require("./src/discordAlert");

enviarAlertaDiscord("O WORKER DE AUTOMAÇÃO DE REUNIÕES PAROU DE RODAR (processo encerrado inesperadamente). Verifique o PC e reinicie o worker.")
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
