// Arquivo: supabase/functions/whatsapp-enviar/index.ts
// Envia uma mensagem de texto pela WhatsApp Cloud API a partir da Caixa de
// Entrada (atendente humano). Autentica o usuário e faz as operações no banco
// com a sessão dele (a RLS de 'whatsapp' autoriza); só o envio na Graph API usa
// o token do servidor. Registra a mensagem de saída e zera as não lidas.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (SUPABASE_URL / ANON já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

// Limites da Cloud API por tipo. Mandar acima disso a Graph recusa a mídia
// inteira, então é melhor barrar aqui e explicar do que devolver erro cru.
const LIMITES: Record<string, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

// Tipo da mensagem a partir do mime. O que não for mídia reconhecida vai como
// documento — é o que o WhatsApp faz com anexo genérico.
function tipoDaMidia(mime: string): "image" | "video" | "audio" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

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

  let body: {
    conversa_id?: string; texto?: string; botoes?: Array<{ id?: string; titulo?: string }>;
    midia?: { storage_path?: string; mime_type?: string; filename?: string };
    // Reagir a uma mensagem existente. Emoji vazio remove a reação.
    reagir?: { wa_message_id?: string; emoji?: string };
  };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const conversaId = body.conversa_id;
  const texto = (body.texto ?? "").trim();
  // Com anexo, o texto é a legenda e pode ser vazio; sem anexo, é obrigatório.
  const anexoPath = String(body.midia?.storage_path ?? "").trim();
  const reagirA = String(body.reagir?.wa_message_id ?? "").trim();
  if (!conversaId || (!texto && !anexoPath && !reagirA)) {
    return json({ error: "conversa_id e (texto, mídia ou reação) são obrigatórios" }, 400);
  }
  // O caminho vem do cliente: sem esta trava dava pra mandar qualquer objeto
  // do bucket, inclusive mídia recebida de outra conversa.
  if (anexoPath && !anexoPath.startsWith(`saida/${conversaId}/`)) {
    return json({ error: "caminho de mídia inválido para esta conversa" }, 400);
  }

  // Botões de resposta (opcional): até 3, título ≤ 20 caracteres (limite da Meta).
  const botoes = Array.isArray(body.botoes)
    ? body.botoes
        .filter((b) => b && typeof b.titulo === "string" && b.titulo.trim())
        .slice(0, 3)
        .map((b, i) => ({ id: String(b.id ?? `opt_${i + 1}`).slice(0, 256), titulo: b.titulo!.trim().slice(0, 20) }))
    : [];
  const temBotoes = botoes.length > 0;

  // Assinatura do atendente: "*Nome Completo | Setor*" numa linha, a mensagem
  // embaixo. O nome oficial e o setor vêm de EMPREGADOS (vínculo Senior); sem
  // vínculo, cai pro display_name do profile e a assinatura sai só com o nome.
  const [{ data: perfil }, { data: empregado }] = await Promise.all([
    db.from("profiles").select("display_name").eq("id", userData.user.id).maybeSingle(),
    db.from("EMPREGADOS").select('"Nome","Setor_ERP"').eq("auth_user_id", userData.user.id).maybeSingle(),
  ]);
  const nome = (empregado?.["Nome"] ?? perfil?.display_name ?? "").trim();
  const setor = (empregado?.["Setor_ERP"] ?? "").trim();
  const assinatura = [nome, setor].filter(Boolean).join(" | ");
  // Asteriscos = negrito no WhatsApp. Sem nome nenhum, envia o texto puro.
  const textoEnviado = assinatura ? `*${assinatura}*\n${texto}` : texto;

  // Carrega a conversa + contato pela sessão do usuário (RLS autoriza quem tem 'whatsapp').
  const { data: conversa } = await db.from("WA_CONVERSA").select("id, contato_id").eq("id", conversaId).maybeSingle();
  if (!conversa) return json({ error: "conversa não encontrada ou sem acesso" }, 403);
  const { data: contato } = await db.from("WA_CONTATO").select("wa_id").eq("id", conversa.contato_id).maybeSingle();
  if (!contato) return json({ error: "contato não encontrado" }, 404);

  // Reação: não gera mensagem nova, só marca a existente. A Meta responde com
  // um wamid próprio que não interessa guardar — o que importa é o emoji na
  // mensagem alvo, que é o que a tela desenha.
  if (reagirA) {
    const emoji = String(body.reagir?.emoji ?? "").trim(); // vazio = remover
    const resR = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: contato.wa_id, type: "reaction",
        reaction: { message_id: reagirA, emoji },
      }),
    });
    const dataR = await resR.json().catch(() => ({}));
    if (!resR.ok) return json({ error: "falha ao reagir", detalhe: dataR }, 502);

    const { data: alvo } = await db.from("WA_MENSAGEM")
      .select("id, payload").eq("wa_message_id", reagirA).eq("conversa_id", conversa.id).maybeSingle();
    if (alvo) {
      await db.from("WA_MENSAGEM").update({
        payload: {
          ...((alvo.payload as Record<string, unknown>) ?? {}),
          reacoes: { ...((alvo.payload as any)?.reacoes ?? {}), nossa: emoji || null },
        },
      }).eq("id", alvo.id);
    }
    return json({ ok: true, reagiu: true, emoji });
  }

  // Anexo: o front já subiu o arquivo pro bucket; aqui a function baixa com
  // service_role, repassa pra Graph (que devolve um media_id próprio) e manda
  // a mensagem apontando pra ele. O arquivo fica no bucket pra bolha enviada
  // renderizar igual às recebidas.
  let midiaEnviada: Record<string, unknown> | null = null;
  let mediaId: string | null = null;
  if (anexoPath) {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: arquivo, error: erroDown } = await admin.storage.from("whatsapp-midia").download(anexoPath);
    if (erroDown || !arquivo) return json({ error: "não consegui ler o arquivo enviado", detalhe: erroDown?.message }, 400);

    const mime = String(body.midia?.mime_type ?? arquivo.type ?? "application/octet-stream");
    const filename = String(body.midia?.filename ?? "arquivo").slice(0, 200);
    const tipo = tipoDaMidia(mime);
    if (arquivo.size > (LIMITES[tipo] ?? LIMITES.document)) {
      return json({
        error: `Arquivo grande demais para ${tipo}: o WhatsApp aceita até ${Math.round((LIMITES[tipo] ?? 0) / 1024 / 1024)} MB.`,
      }, 400);
    }

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new File([arquivo], filename, { type: mime }));
    const up = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/media`, {
      method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}` }, body: form,
    });
    const upData = await up.json().catch(() => ({}));
    if (!up.ok || !upData?.id) return json({ error: "falha ao subir a mídia", detalhe: upData }, 502);
    mediaId = String(upData.id);

    midiaEnviada = {
      tipo, media_id: mediaId, filename, mime_type: mime,
      storage_path: anexoPath, tamanho: arquivo.size, status: "pronto",
    };
  }

  // Envia pela Graph API (token do servidor). Com anexo vira mensagem de mídia
  // (a legenda é o texto); com botões, interativa; senão, texto simples.
  const mensagemGraph = midiaEnviada
    ? {
        messaging_product: "whatsapp", to: contato.wa_id,
        type: midiaEnviada.tipo,
        // Só image, video e document aceitam caption — áudio não.
        [String(midiaEnviada.tipo)]: {
          id: mediaId,
          ...(midiaEnviada.tipo === "document" ? { filename: midiaEnviada.filename } : {}),
          ...(textoEnviado && midiaEnviada.tipo !== "audio" ? { caption: textoEnviado.slice(0, 1024) } : {}),
        },
      }
    : temBotoes
    ? {
        messaging_product: "whatsapp", to: contato.wa_id, type: "interactive",
        interactive: {
          type: "button",
          body: { text: textoEnviado },
          action: { buttons: botoes.map((b) => ({ type: "reply", reply: { id: b.id, title: b.titulo } })) },
        },
      }
    : { messaging_product: "whatsapp", to: contato.wa_id, type: "text", text: { body: textoEnviado } };

  let waId: string | null = null;
  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(mensagemGraph),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: "falha ao enviar", detalhe: data }, 502);
  waId = data?.messages?.[0]?.id ?? null;

  // Registra a mensagem e atualiza a conversa (RLS pela sessão do usuário).
  // Só inclui `payload` quando há botões, para não depender da coluna nova
  // enquanto a migration não roda (envio de texto puro segue funcionando).
  const row: Record<string, unknown> = {
    conversa_id: conversa.id, contato_id: conversa.contato_id, direcao: "saida",
    tipo: midiaEnviada ? String(midiaEnviada.tipo) : temBotoes ? "interactive" : "text",
    texto: textoEnviado, wa_message_id: waId, status: waId ? "enviada" : "erro",
    origem: "atendente", autor_id: userData.user.id,
  };
  if (midiaEnviada) row.payload = { midia: midiaEnviada };
  if (temBotoes) row.payload = { tipo: "button", botoes };
  await db.from("WA_MENSAGEM").insert(row);
  await db.from("WA_CONVERSA").update({
    ultima_mensagem_em: new Date().toISOString(),
    // Prévia sem a assinatura (senão toda conversa vira "Você: Fulano | Setor").
    // Anexo sem legenda mostra o tipo, como o WhatsApp faz.
    ultima_mensagem_preview: (texto || `[${midiaEnviada?.tipo ?? "arquivo"}]`).slice(0, 120),
    ultima_direcao: "saida",
    nao_lidas: 0,
  }).eq("id", conversa.id);

  return json({ ok: true, wa_message_id: waId });
});
