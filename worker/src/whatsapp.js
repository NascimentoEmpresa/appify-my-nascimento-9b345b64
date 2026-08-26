// Envio de WhatsApp pelo worker.
//
// POR QUE ISTO NÃO USA MAIS whatsapp-web.js
//
// A versão anterior subia um Chromium via puppeteer e simulava o WhatsApp Web,
// que exige um CELULAR PAREADO lendo QR code. O número da empresa
// (55 51 9156-1344) é WhatsApp Business Cloud API, conexão oficial com a Meta:
// não existe aparelho para parear e nunca vai existir. Ou seja, aquele caminho
// não estava quebrado — estava errado desde o começo, e o sintoma era um QR
// pedido para sempre, com alerta no Discord a cada tentativa.
//
// POR QUE PASSA PELO SUPABASE E NÃO FALA DIRETO COM A META
//
// A rede da empresa bloqueia domínios da Meta no DNS: `graph.facebook.com`
// resolve para 192.168.100.1, o próprio roteador (bloqueio de redes sociais,
// que pega a API junto). Medido em 26/08/2026.
//
// A automação de chamados sempre funcionou porque roda em Edge Function do
// Supabase, cuja saída para a internet não passa por esse firewall. Este
// módulo faz o mesmo: pede ao Supabase que envie.
//
//   worker → Supabase → Meta        (funciona)
//   worker → Meta                   (o pacote nem sai da rede)
//
// Efeito colateral bom: o token da Meta continua só como secret do Supabase,
// sem cópia na máquina.
//
// MENSAGEM PROATIVA EXIGE TEMPLATE APROVADO
//
// A Cloud API só aceita texto livre dentro de 24h depois de a pessoa escrever
// para a empresa — o que nunca acontece num lembrete de reunião. Fora dessa
// janela, só template aprovado pela Meta. É a mesma razão pela qual a
// notificação de chamado usa `chamados_devs_interno`.

const SUPABASE_URL = process.env.SUPABASE_URL;
const WORKER_SECRET = process.env.WORKER_NOTIFICAR_SECRET;

// Sem segredo configurado o envio fica desligado, e o worker segue sem ele.
// Deliberado: uma tarefa não pode derrubar as outras quatro — foi exatamente
// isso que o WhatsApp fazia antes.
const LIGADO = Boolean(SUPABASE_URL && WORKER_SECRET);

/**
 * Compatibilidade com a interface antiga.
 *
 * `index.js` chamava `criarClienteWhatsapp()` e passava o cliente adiante.
 * Não existe mais cliente: o envio é HTTP sem estado. Devolver `null` mantém
 * a checagem `if (waClient)` de `rodarCiclo` funcionando sem tocar nela, e o
 * worker deixa de subir um Chromium de 300 MB para não usar.
 */
function criarClienteWhatsapp() {
  if (!LIGADO) {
    console.log(
      "[whatsapp] envio desligado (falta WORKER_NOTIFICAR_SECRET) — o resto do ciclo roda normal.",
    );
  }
  return null;
}

/** Só dígitos, com 55 na frente. A Cloud API recusa número com máscara. */
function normalizarTelefone(telefone) {
  const d = String(telefone || "").replace(/\D/g, "");
  if (!d) return null;
  return d.startsWith("55") ? d : `55${d}`;
}

/**
 * Manda uma mensagem de template.
 *
 * `_cliente` existe só para manter a assinatura antiga viva; é ignorado.
 */
async function enviarMensagemWhatsapp(_cliente, telefone, texto, opcoes = {}) {
  if (!LIGADO) return { enviado: false, motivo: "envio de WhatsApp desligado" };

  const numero = normalizarTelefone(telefone);
  if (!numero) return { enviado: false, motivo: "telefone vazio ou inválido" };

  const resposta = await fetch(`${SUPABASE_URL}/functions/v1/worker-notificar-whatsapp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": WORKER_SECRET,
    },
    body: JSON.stringify({
      telefone: numero,
      template: opcoes.template || process.env.WHATSAPP_TEMPLATE_LEMBRETE,
      parametros: opcoes.parametros || [texto],
    }),
  });

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok || corpo.error) {
    throw new Error(corpo.error || `envio falhou (HTTP ${resposta.status})`);
  }
  return { enviado: true };
}

module.exports = { criarClienteWhatsapp, enviarMensagemWhatsapp, normalizarTelefone };
