// Arquivo: supabase/functions/whatsapp-perfil/index.ts
// Lê e atualiza o PERFIL DE NEGÓCIO do nosso número (o que os contatos veem ao
// abrir a conversa): foto, recado, descrição, endereço, e-mail, sites e ramo.
//
// A foto não sobe direto: a Meta exige a Resumable Upload API, que devolve um
// "handle" — e é esse handle, não a imagem, que vai no perfil. São três saltos:
//   1) POST /{APP_ID}/uploads            -> abre a sessão, devolve upload:...
//   2) POST /{sessão} (bytes crus)       -> devolve { h: handle }
//   3) POST /{PHONE_ID}/whatsapp_business_profile { profile_picture_handle: h }
//
// Requisito da Meta para a foto: JPEG quadrado, no máximo 640px de lado e 5 MB.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_APP_ID
// (este último é NOVO — o passo 1 é no app, não no número).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const APP_ID = Deno.env.get("WHATSAPP_APP_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const CAMPOS = "about,address,description,email,profile_picture_url,websites,vertical";

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
  const { data: userData } = await db.auth.getUser();
  if (!userData?.user) return json({ error: "sessão inválida" }, 401);

  // Mexer no perfil é configuração do bot, não atendimento: exige o menu do
  // Chatbot, o mesmo que governa o resto das configurações.
  // O parâmetro chama-se _menu_codigo (o _acao tem default 'visualizar').
  // Com o nome errado a RPC falha, `pode` vem null e todo mundo levava 403.
  const { data: pode, error: erroPerm } = await db.rpc("tem_acesso_menu", { _menu_codigo: "whatsapp_chatbot" });
  if (erroPerm) return json({ error: "não consegui verificar sua permissão", detalhe: erroPerm.message }, 500);
  if (pode !== true) return json({ error: "sem permissão para editar o perfil (menu Chatbot)" }, 403);

  let body: {
    acao?: "ler" | "salvar";
    perfil?: Record<string, unknown>;
    foto?: { storage_path?: string; mime_type?: string; tamanho?: number };
  };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }

  // ---- ler -------------------------------------------------------------
  if (body.acao !== "salvar") {
    const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/whatsapp_business_profile?fields=${CAMPOS}`, {
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: "falha ao ler o perfil", detalhe: data }, 502);
    return json({ ok: true, perfil: data?.data?.[0] ?? {} });
  }

  // ---- salvar ----------------------------------------------------------
  const patch: Record<string, unknown> = { messaging_product: "whatsapp" };
  const p = body.perfil ?? {};

  // Campo VAZIO não pode ir: a Graph responde 131000 "Something went wrong" e
  // derruba a chamada inteira — inclusive os campos que estavam preenchidos.
  // Por isso só entra no patch o que tem conteúdo. Limites da Meta aplicados
  // aqui, porque estourar devolve o mesmo erro genérico.
  const texto = (v: unknown, max: number) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s.slice(0, max) : null;
  };
  const about = texto(p.about, 139);
  const description = texto(p.description, 512);
  const address = texto(p.address, 256);
  const email = texto(p.email, 128);
  const vertical = texto(p.vertical, 40);
  if (about) patch.about = about;
  if (description) patch.description = description;
  if (address) patch.address = address;
  if (email) patch.email = email;
  if (vertical) patch.vertical = vertical;
  if (Array.isArray(p.websites)) {
    const sites = p.websites.map((s) => String(s).trim()).filter(Boolean).slice(0, 2);
    if (sites.length) patch.websites = sites;
  }

  // Nada além do messaging_product e sem foto: não há o que salvar.
  if (Object.keys(patch).length === 1 && !body.foto?.storage_path) {
    return json({ error: "Preencha ao menos um campo antes de salvar." }, 400);
  }

  // Foto: o front já subiu o arquivo pro bucket; aqui ela sobe pra Meta.
  if (body.foto?.storage_path) {
    if (!APP_ID) {
      return json({ error: "Falta o secret WHATSAPP_APP_ID — sem ele a Meta não abre a sessão de upload da foto." }, 500);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: arquivo, error: erroDown } = await admin.storage
      .from("whatsapp-midia").download(body.foto.storage_path);
    if (erroDown || !arquivo) return json({ error: "não consegui ler a imagem enviada", detalhe: erroDown?.message }, 400);

    const mime = String(body.foto.mime_type ?? arquivo.type ?? "");
    if (!/^image\/jpe?g$/i.test(mime)) {
      return json({ error: "A Meta só aceita JPG na foto de perfil. Converta a imagem e tente de novo." }, 400);
    }
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return json({ error: "Imagem acima de 5 MB — o limite da Meta para foto de perfil." }, 400);
    }

    // 1) abre a sessão
    const abrir = await fetch(
      `${GRAPH}/${APP_ID}/uploads?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(mime)}`,
      { method: "POST", headers: { Authorization: `Bearer ${WA_TOKEN}` } },
    );
    const sessao = await abrir.json().catch(() => ({}));
    if (!abrir.ok || !sessao?.id) return json({ error: "falha ao abrir upload da foto", detalhe: sessao }, 502);

    // 2) envia os bytes. Aqui o header é "OAuth", não "Bearer" — a Resumable
    //    Upload API recusa Bearer, e o erro que ela devolve não diz isso.
    const enviar = await fetch(`${GRAPH}/${sessao.id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${WA_TOKEN}`, file_offset: "0", "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    const up = await enviar.json().catch(() => ({}));
    if (!enviar.ok || !up?.h) return json({ error: "falha ao enviar a foto", detalhe: up }, 502);

    patch.profile_picture_handle = up.h;
  }

  const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/whatsapp_business_profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // "An unknown error has occurred" é o que a Graph devolve para metade dos
    // problemas deste endpoint, e sozinho não permite consertar nada. O que
    // ajuda está em error.code/error_subcode/error_data — e saber QUAIS campos
    // foram enviados, já que campo vazio ou fora do limite derruba a chamada
    // inteira, inclusive os campos que estavam certos.
    console.error("perfil: Meta recusou", JSON.stringify({ patch: Object.keys(patch), erro: data }));
    const e = (data as { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } })?.error;
    const detalhe = [
      e?.error_user_msg || e?.message,
      e?.code ? `código ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""}` : null,
      `campos enviados: ${Object.keys(patch).filter(k => k !== "messaging_product").join(", ") || "nenhum"}`,
    ].filter(Boolean).join(" — ");
    return json({ error: `falha ao salvar o perfil: ${detalhe}`, detalhe: data }, 502);
  }

  // Devolve o perfil já relido: a foto vem com URL nova e o front atualiza sem
  // precisar de um segundo clique.
  const rel = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/whatsapp_business_profile?fields=${CAMPOS}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  });
  const relido = await rel.json().catch(() => ({}));
  return json({ ok: true, perfil: relido?.data?.[0] ?? {} });
});
