// Arquivo: supabase/functions/worker-notificar-whatsapp/index.ts
// Envia mensagem de template pela WhatsApp Cloud API a pedido do worker.
//
// POR QUE O WORKER NÃO FALA DIRETO COM A META
// A rede da empresa bloqueia domínios da Meta no DNS: `graph.facebook.com`
// resolve para o próprio roteador (bloqueio de redes sociais, que leva a API
// junto). Medido em 26/08/2026. A saída do Supabase para a internet não passa
// por esse firewall — é por isso que a notificação de chamado sempre
// funcionou, e é o mesmo caminho que esta function abre para o worker.
//
// AUTENTICAÇÃO POR SEGREDO, NÃO POR JWT
// O worker é um processo, não uma pessoa: não tem sessão de usuário. Segue o
// padrão que o projeto já usa para o CI (`chamado-info`, `chamado-vincular-pr`),
// com `verify_jwt = false` no config.toml e um segredo compartilhado no
// cabeçalho. A comparação é de tempo constante para não vazar o segredo pelo
// tempo de resposta.
//
// SÓ TEMPLATE, NUNCA TEXTO LIVRE
// A Cloud API só aceita texto livre dentro de 24h depois de a pessoa escrever
// para a empresa — o que nunca acontece num lembrete disparado por nós. Fora
// dessa janela a Meta recusa, então esta function nem tenta: exige o nome de
// um template aprovado.
//
// Secrets: WORKER_NOTIFICAR_SECRET, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

const WORKER_SECRET = Deno.env.get("WORKER_NOTIFICAR_SECRET") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Comparação de tempo constante: evita descobrir o segredo medindo a resposta. */
function segredoConfere(recebido: string): boolean {
  if (!WORKER_SECRET || recebido.length !== WORKER_SECRET.length) return false;
  let diferenca = 0;
  for (let i = 0; i < WORKER_SECRET.length; i++) {
    diferenca |= WORKER_SECRET.charCodeAt(i) ^ recebido.charCodeAt(i);
  }
  return diferenca === 0;
}

// A Meta rejeita parâmetro de template com quebra de linha, tab ou espaços
// seguidos — e o erro que devolve não diz qual parâmetro causou. Limpar aqui
// evita uma investigação inútil depois.
const limparParametro = (valor: string) =>
  String(valor ?? "").replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 900);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!segredoConfere(req.headers.get("x-worker-secret") ?? "")) {
    return json({ error: "não autorizado" }, 401);
  }
  if (!WA_TOKEN || !PHONE_NUMBER_ID) {
    return json({ error: "WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configurados" }, 500);
  }

  let corpo: {
    telefone?: string;
    template?: string;
    idioma?: string;
    parametros?: string[];
  };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "json inválido" }, 400);
  }

  const telefone = String(corpo.telefone ?? "").replace(/\D/g, "");
  if (!telefone) return json({ error: "telefone não informado" }, 400);
  if (!corpo.template) {
    return json(
      { error: "template não informado — a Cloud API não aceita texto livre em mensagem proativa" },
      400,
    );
  }

  const parametros = (corpo.parametros ?? []).map(limparParametro);

  const payload = {
    messaging_product: "whatsapp",
    to: telefone,
    type: "template",
    template: {
      name: corpo.template,
      language: { code: corpo.idioma ?? "pt_BR" },
      ...(parametros.length
        ? {
            components: [
              {
                type: "body",
                parameters: parametros.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  };

  const resposta = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const retorno = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    const erro = retorno?.error ?? {};
    // A família 1320xx da Meta significa "template inutilizável" — não existe,
    // não foi aprovado ou foi pausado. Repetir não resolve; quem lê o erro
    // precisa saber que a ação é na Meta, não no código.
    const inutilizavel = String(erro.code ?? "").startsWith("132");
    return json(
      {
        error: erro.message ?? `Graph respondeu HTTP ${resposta.status}`,
        codigo: erro.code ?? null,
        template_indisponivel: inutilizavel,
        dica: inutilizavel
          ? `O template "${corpo.template}" não está aprovado e utilizável na conta. Verifique no Business Manager da Meta.`
          : undefined,
      },
      resposta.status,
    );
  }

  return json({ enviado: true, id: retorno?.messages?.[0]?.id ?? null });
});
