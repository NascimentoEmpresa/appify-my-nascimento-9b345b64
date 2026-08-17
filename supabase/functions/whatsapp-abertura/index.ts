// Arquivo: supabase/functions/whatsapp-abertura/index.ts
//
// A PRIMEIRA mensagem de uma conversa que NÓS começamos.
//
// Por que não serve o whatsapp-enviar: a Meta só aceita texto livre dentro
// da janela de 24h contada a partir da última mensagem DO CONTATO. Numa
// conversa aberta por nós essa janela normalmente está fechada, e ali só
// passa TEMPLATE aprovado — outra rota na Graph API, outro corpo, outro
// modo de falhar. Esta função escolhe o caminho e mantém as duas pontas
// com o mesmo texto (o de WA_BOT_CONFIG.abertura_*).
//
// Ações:
//   { conversa_id }            → manda a abertura (texto livre OU template)
//   { acao: "criar_template" } → cria/consulta o template na Meta
//
// Criar template exige o menu do Chatbot; mandar a abertura exige só a
// Caixa de Entrada (a RLS da conversa é quem autoriza).
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

// Id do botão de resposta rápida. Vira o reply_id que o webhook grava e o
// que o menu do bot enxerga quando a pessoa clica.
const BOTAO_ID = "abertura_ola";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Erro de template da Meta: a família 1320xx é "o template não está
// utilizável" (não existe, não foi aprovado, foi pausado, parâmetro
// errado). Interessa separar isso de uma falha de rede porque a saída é
// outra: criar/aguardar o template, não tentar de novo.
function problemaDeTemplate(codigo: unknown): boolean {
  const n = Number(codigo);
  return Number.isFinite(n) && n >= 132000 && n < 133000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);

  if (!WA_TOKEN || !PHONE_NUMBER_ID) return json({ error: "WhatsApp não configurado no servidor" }, 500);

  let body: { conversa_id?: string; acao?: string };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }

  // Texto, botão e nome do template — uma fonte só, no banco.
  const { data: cfg } = await db.from("WA_BOT_CONFIG")
    .select("abertura_texto, abertura_botao, abertura_template, abertura_template_idioma")
    .limit(1).maybeSingle();
  const texto = String(cfg?.abertura_texto ?? "").trim();
  const rotuloBotao = String(cfg?.abertura_botao ?? "").trim();
  const nomeTemplate = String(cfg?.abertura_template ?? "abertura_contato").trim();
  const idioma = String(cfg?.abertura_template_idioma ?? "pt_BR").trim();
  if (!texto) return json({ error: "mensagem de abertura não configurada" }, 500);

  // ---- criar o template na Meta ---------------------------------------
  if (body.acao === "criar_template") {
    // Mexe na conta da empresa na Meta e passa por revisão: é configuração
    // do bot, não atendimento.
    const { data: pode } = await db.rpc("tem_acesso_menu", { _menu_codigo: "whatsapp_chatbot" });
    if (pode !== true) return json({ error: "sem permissão para criar template (menu Chatbot)" }, 403);

    // A WABA sai do próprio número — evita mais um secret para manter.
    const resWaba = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}?fields=whatsapp_business_account`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    });
    const dataWaba = await resWaba.json().catch(() => ({}));
    const wabaId = dataWaba?.whatsapp_business_account?.id;
    if (!resWaba.ok || !wabaId) {
      return json({ error: "não consegui identificar a conta do WhatsApp", detalhe: dataWaba }, 502);
    }

    // Já existe? Devolve o status em vez de tentar recriar (a Meta recusa
    // nome repetido, e o erro dela não explica que já está lá).
    const resLista = await fetch(
      `${GRAPH}/${wabaId}/message_templates?limit=200&fields=name,status,rejected_reason`,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } },
    );
    const lista = await resLista.json().catch(() => ({}));
    const achado = (lista?.data ?? []).find((t: { name?: string }) => t?.name === nomeTemplate);
    if (achado) {
      return json({ ok: true, ja_existia: true, nome: nomeTemplate, status: achado.status, motivo: achado.rejected_reason });
    }

    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nomeTemplate,
        // UTILITY porque é aviso operacional, sem oferta. A Meta pode
        // reclassificar para MARKETING na revisão — muda o preço da
        // conversa, não o funcionamento.
        category: "UTILITY",
        language: idioma,
        components: [
          { type: "BODY", text: texto },
          // QUICK_REPLY: o clique volta como mensagem de entrada e abre a
          // janela de 24h. É o que faz a abertura virar conversa.
          ...(rotuloBotao
            ? [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: rotuloBotao.slice(0, 25) }] }]
            : []),
        ],
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: "a Meta recusou o template", detalhe: d }, 502);
    return json({ ok: true, criado: true, nome: nomeTemplate, status: d?.status ?? "PENDING" });
  }

  // ---- mandar a abertura ----------------------------------------------
  const conversaId = String(body.conversa_id ?? "").trim();
  if (!conversaId) return json({ error: "conversa_id é obrigatório" }, 400);

  // Leitura pela sessão do usuário: a RLS de 'whatsapp' é o controle de
  // acesso aqui (mesma regra do whatsapp-enviar).
  const { data: conversa } = await db.from("WA_CONVERSA").select("id, contato_id").eq("id", conversaId).maybeSingle();
  if (!conversa) return json({ error: "conversa não encontrada ou sem acesso" }, 403);
  const { data: contato } = await db.from("WA_CONTATO").select("wa_id").eq("id", conversa.contato_id).maybeSingle();
  if (!contato) return json({ error: "contato não encontrado" }, 404);

  // Janela de 24h: conta da última mensagem DE ENTRADA. Dentro dela o
  // texto livre passa (e não custa uma conversa de template); fora, só
  // template. Consultado aqui, e não recebido do front, porque a janela
  // pode ter fechado entre abrir o modal e clicar em enviar.
  const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db.from("WA_MENSAGEM")
    .select("id", { count: "exact", head: true })
    .eq("conversa_id", conversa.id).eq("direcao", "entrada").gt("criada_em", limite);
  const dentroJanela = (count ?? 0) > 0;

  const botoes = rotuloBotao ? [{ id: BOTAO_ID, titulo: rotuloBotao }] : [];

  const base = { messaging_product: "whatsapp", to: contato.wa_id };
  const mensagem: Record<string, unknown> = !dentroJanela
    ? {
        ...base, type: "template",
        // Sem `components`: o corpo não tem variável e o botão de resposta
        // rápida não leva parâmetro, então a Meta usa o que foi aprovado.
        template: { name: nomeTemplate, language: { code: idioma } },
      }
    : botoes.length
    ? {
        ...base, type: "interactive",
        interactive: {
          type: "button",
          body: { text: texto },
          // 20 caracteres é o teto do botão interativo (o do template é 25).
          action: { buttons: botoes.map((b) => ({ type: "reply", reply: { id: b.id, title: b.titulo.slice(0, 20) } })) },
        },
      }
    // Sem botão configurado não há interativo para mandar — vai texto puro.
    : { ...base, type: "text", text: { body: texto } };

  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(mensagem),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const codigo = data?.error?.code;
    // Template inutilizável: a conversa já foi criada e continua na tela,
    // então o que falta é só o template. Sinalizar isso deixa o front
    // oferecer "criar na Meta" em vez de repetir um erro sem saída.
    if (problemaDeTemplate(codigo)) {
      return json({
        error: `O template "${nomeTemplate}" ainda não está aprovado na Meta — sem ele não dá para falar com quem não escreveu nas últimas 24h.`,
        template_faltando: true, nome_template: nomeTemplate, detalhe: data,
      }, 400);
    }
    return json({ error: "falha ao enviar a abertura", detalhe: data }, 502);
  }

  const waId = data?.messages?.[0]?.id ?? null;

  // Registra a bolha. `payload.botoes` é o que a Caixa desenha embaixo da
  // mensagem — sem isso o atendente não vê que mandou um botão.
  const row: Record<string, unknown> = {
    conversa_id: conversa.id, contato_id: conversa.contato_id, direcao: "saida",
    tipo: dentroJanela ? "interactive" : "template",
    texto, wa_message_id: waId, status: waId ? "enviada" : "erro",
    origem: "atendente", autor_id: userData.user.id,
  };
  if (botoes.length) row.payload = { tipo: "button", botoes };
  await db.from("WA_MENSAGEM").insert(row);
  await db.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: texto.slice(0, 120),
    ultima_direcao: "saida",
    nao_lidas: 0,
  }).eq("id", conversa.id);

  return json({ ok: true, wa_message_id: waId, via: dentroJanela ? "texto" : "template" });
});
