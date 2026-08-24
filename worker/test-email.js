// Teste isolado do envio de e-mail — não mexe com WhatsApp nem Supabase.
// Rodar: node test-email.js
require("dotenv/config");
const { criarTransportador } = require("./src/email");

const DESTINO = process.argv[2] || "analisededados@haggltda.com.br";

async function main() {
  const transportador = criarTransportador();
  await transportador.sendMail({
    from: process.env.SMTP_USER,
    to: DESTINO,
    subject: "Teste — worker de automação de reuniões",
    text: "Se você recebeu este e-mail, o envio automático via Nodemailer está funcionando.",
  });
  console.log(`Enviado pra ${DESTINO}. Confira a caixa de entrada (e o spam).`);
}

main().catch((e) => {
  console.error("Falha ao enviar e-mail de teste:", e);
  process.exit(1);
});
