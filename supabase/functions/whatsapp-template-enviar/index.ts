// Arquivo: supabase/functions/whatsapp-template-enviar/index.ts
//
// Envia uma mensagem da BIBLIOTECA (WA_TEMPLATE) numa conversa — é o que o
// menu da "/" na Caixa de Entrada dispara.
//
// Por que não serve o whatsapp-enviar: ele só manda texto livre, que a Meta
// aceita apenas dentro da janela de 24h contada da última mensagem DO
// CONTATO. Fora dela só passa template aprovado — outra rota no corpo da
// Graph API. Esta função escolhe o caminho pela janela e mantém os dois com
// o mesmo texto, igual whatsapp-abertura faz para a mensagem de abertura.
//
// Ações:
//   { conversa_id, codigo, valores? } → envia a mensagem
//   { acao: "criar_template", codigo } → submete o texto à Meta e/ou devolve
//                                        o status da revisão
//   { acao: "status" }                → status na Meta de toda a biblioteca
//
// Enviar exige a Caixa de Entrada (a RLS da conversa autoriza); criar
// template exige o menu do Chatbot, porque mexe na conta da empresa.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Família 1320xx da Meta: "template inutilizável" (não existe, não aprovado,
// pausado, parâmetro errado). Separado de falha de rede porque a saída é
// outra — criar/aguardar o template, não tentar de novo.
const problemaDeTemplate = (codigo: unknown): boolean => {
  const n = Number(codigo);
  return Number.isFinite(n) && n >= 132000 && n < 133000;
};

/** Troca {{1}}, {{2}}… pelos valores informados, na ordem. */
const preencher = (texto: string, valores: string[]) =>
  texto.replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? "");

/** A WABA sai do próprio número — evita mais um secret para alguém manter. */
async function wabaId(): Promise<string | null> {
  const r = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}?fields=whatsapp_business_account`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  });
  const d = await r.json().catch(() => ({}));
  return r.ok ? (d?.whatsapp_business_account?.id ?? null) : null;
}

/** Status de cada template da conta, por nome. */
async function statusNaMeta(waba: string): Promise<Record<string, { status: string; motivo?: string }>> {
  const out: Record<string, { status: string; motivo?: string }> = {};
  let url = `${GRAPH}/${waba}/message_templates?limit=200&fields=name,status,rejected_reason`;
  for (let pagina = 0; pagina < 10 && url; pagina++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) break;
    for (const t of d?.data ?? []) out[t.name] = { status: t.status, motivo: t.rejected_reason };
    url = d?.paging?.next ?? "";
  }
  return out;
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

  let body: { conversa_id?: string; codigo?: string; valores?: string[]; acao?: string };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const acao = String(body.acao ?? "enviar");

  // ---- status da biblioteca inteira -----------------------------------
  // A Caixa usa isto para marcar, no menu da "/", o que já está aprovado —
  // sem isso o atendente só descobre que o template não passou quando a
  // mensagem não chega.
  if (acao === "status") {
    const waba = await wabaId();
    if (!waba) return json({ error: "não consegui identificar a conta do WhatsApp" }, 502);
    const { data: linhas } = await db.from("WA_TEMPLATE")
      .select("codigo, template_nome").eq("ativo", true);
    const naMeta = await statusNaMeta(waba);
    return json({
      ok: true,
      templates: (linhas ?? []).map((l) => ({
        codigo: l.codigo,
        nome: l.template_nome,
        // Sem nome de template a mensagem só existe como texto livre: dentro
        // da janela funciona, fora não há o que aprovar.
        ...(l.template_nome ? (naMeta[l.template_nome] ?? { status: "NAO_CRIADO" }) : { status: "SEM_TEMPLATE" }),
      })),
    });
  }

  // ---- submeter um texto à Meta ---------------------------------------
  if (acao === "criar_template") {
    const { data: pode } = await db.rpc("tem_acesso_menu", { _menu_codigo: "whatsapp_chatbot", _acao: "alterar" });
    if (pode !== true) return json({ error: "sem permissão para criar template (menu Chatbot)" }, 403);

    const codigo = String(body.codigo ?? "").trim();
    const { data: tpl } = await db.from("WA_TEMPLATE")
      .select("codigo, texto, variaveis, template_nome, idioma, categoria")
      .eq("codigo", codigo).maybeSingle();
    if (!tpl) return json({ error: "mensagem não encontrada na biblioteca" }, 404);
    if (!tpl.template_nome) return json({ error: "esta mensagem não tem nome de template na Meta" }, 400);

    const waba = await wabaId();
    if (!waba) return json({ error: "não consegui identificar a conta do WhatsApp" }, 502);

    // Já existe? Devolve o status em vez de recriar — a Meta recusa nome
    // repetido com um erro que não explica que já está lá.
    const naMeta = await statusNaMeta(waba);
    if (naMeta[tpl.template_nome]) {
      return json({ ok: true, ja_existia: true, nome: tpl.template_nome, ...naMeta[tpl.template_nome] });
    }

    const texto = String(tpl.texto ?? "").trim();
    // Regra da Meta: o corpo não pode começar nem terminar em variável.
    if (/^\{\{\d+\}\}/.test(texto) || /\{\{\d+\}\}\s*[.!?]?$/.test(texto)) {
      return json({ error: "o texto não pode começar nem terminar com variável" }, 400);
    }
    const variaveis: string[] = Array.isArray(tpl.variaveis) ? tpl.variaveis : [];

    const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: tpl.template_nome,
        category: tpl.categoria ?? "UTILITY",
        language: tpl.idioma || "pt_BR",
        components: [{
          type: "BODY",
          text: texto,
          // A Meta exige uma amostra de cada {{n}} para revisar, e recusa a
          // criação sem isso. O rótulo da variável serve de exemplo.
          ...(variaveis.length ? { example: { body_text: [variaveis] } } : {}),
        }],
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: "a Meta recusou o template", detalhe: d }, 502);
    return json({ ok: true, criado: true, nome: tpl.template_nome, status: d?.status ?? "PENDING" });
  }

  if (acao !== "enviar") return json({ error: "ação inválida" }, 400);

  // ---- enviar ----------------------------------------------------------
  const conversaId = String(body.conversa_id ?? "").trim();
  const codigo = String(body.codigo ?? "").trim();
  if (!conversaId || !codigo) return json({ error: "conversa_id e codigo são obrigatórios" }, 400);

  const { data: tpl } = await db.from("WA_TEMPLATE")
    .select("codigo, titulo, texto, variaveis, template_nome, idioma")
    .eq("codigo", codigo).eq("ativo", true).maybeSingle();
  if (!tpl) return json({ error: "mensagem não encontrada na biblioteca" }, 404);

  const variaveis: string[] = Array.isArray(tpl.variaveis) ? tpl.variaveis : [];
  const valores = (Array.isArray(body.valores) ? body.valores : []).map((v) => String(v ?? "").trim());
  if (valores.length < variaveis.length || valores.some((v) => !v)) {
    return json({ error: `preencha ${variaveis.length} valor(es): ${variaveis.join(", ")}` }, 400);
  }
  const texto = preencher(String(tpl.texto ?? ""), valores);

  // Leitura pela sessão do usuário: a RLS de 'whatsapp' é o controle de
  // acesso aqui (mesma regra do whatsapp-enviar).
  const { data: conversa } = await db.from("WA_CONVERSA")
    .select("id, contato_id").eq("id", conversaId).maybeSingle();
  if (!conversa) return json({ error: "conversa não encontrada ou sem acesso" }, 403);
  const { data: contato } = await db.from("WA_CONTATO")
    .select("wa_id").eq("id", conversa.contato_id).maybeSingle();
  if (!contato) return json({ error: "contato não encontrado" }, 404);

  // Consultada aqui, e não recebida do front: a janela pode ter fechado
  // entre abrir o menu e escolher a mensagem.
  const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db.from("WA_MENSAGEM")
    .select("id", { count: "exact", head: true })
    .eq("conversa_id", conversa.id).eq("direcao", "entrada").gt("criada_em", limite);
  const dentroJanela = (count ?? 0) > 0;

  if (!dentroJanela && !tpl.template_nome) {
    return json({
      error: `"${tpl.titulo}" só pode ser enviada dentro das 24h após a última mensagem do contato — ela não tem template aprovado na Meta.`,
      fora_da_janela: true,
    }, 400);
  }

  const base = { messaging_product: "whatsapp", to: contato.wa_id };
  const mensagem: Record<string, unknown> = dentroJanela
    ? { ...base, type: "text", text: { body: texto } }
    : {
        ...base, type: "template",
        template: {
          name: tpl.template_nome, language: { code: tpl.idioma || "pt_BR" },
          // Sem variável não vai `components`: a Meta usa o texto aprovado.
          ...(variaveis.length
            ? { components: [{ type: "body", parameters: valores.map((v) => ({ type: "text", text: v })) }] }
            : {}),
        },
      };

  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(mensagem),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (problemaDeTemplate(data?.error?.code)) {
      return json({
        error: `O template "${tpl.template_nome}" ainda não está aprovado na Meta — sem ele não dá para falar com quem não escreveu nas últimas 24h.`,
        template_faltando: true, nome_template: tpl.template_nome, codigo: tpl.codigo, detalhe: data,
      }, 400);
    }
    return json({ error: "falha ao enviar a mensagem", detalhe: data }, 502);
  }

  const waId = data?.messages?.[0]?.id ?? null;
  await db.from("WA_MENSAGEM").insert({
    conversa_id: conversa.id, contato_id: conversa.contato_id, direcao: "saida",
    tipo: dentroJanela ? "text" : "template",
    texto, wa_message_id: waId, status: waId ? "enviada" : "erro",
    origem: "atendente", autor_id: userData.user.id,
  });
  await db.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    ultima_mensagem_preview: texto.slice(0, 120),
    ultima_direcao: "saida",
    nao_lidas: 0,
  }).eq("id", conversa.id);

  return json({ ok: true, wa_message_id: waId, via: dentroJanela ? "texto" : "template" });
});
