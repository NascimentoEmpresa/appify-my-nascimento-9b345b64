// Arquivo: supabase/functions/denuncia-anexar/index.ts
//
// Recebe os arquivos que quem denuncia junta ao relato — documentos, fotos,
// vídeos, áudios. Era a maior lacuna do canal: o campo "evidências" é texto,
// então até aqui a pessoa só conseguia DESCREVER a prova, nunca entregá-la.
//
// POR QUE PASSA POR AQUI E NÃO DIRETO PELO STORAGE
// O site roda sem login, e o desenho do canal é não ter chave nenhuma no
// navegador (ver denuncia-registrar). Dar a `anon` permissão de escrever no
// bucket abriria um depósito público de arquivos em domínio da empresa. Aqui
// o upload usa service_role, no servidor, depois de conferir a credencial.
//
// CREDENCIAL
// protocolo + senha, os mesmos que a pessoa acabou de receber/escolher no
// registro. Sem eles não se anexa nada — e ninguém junta arquivo ao caso de
// outra pessoa, porque a senha não confere com aquela linha.
//
// verify_jwt = false no config.toml — público de propósito.
// ANONIMATO: não loga corpo, IP nem user-agent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "denuncia-evidencias";

/** 25 MB. O bucket aceita 50, mas o corpo ainda sobe inteiro na memória da função. */
const TAMANHO_MAX = 25 * 1024 * 1024;

/** No máximo isto por denúncia — evita que o canal vire hospedagem. */
const MAX_POR_DENUNCIA = 20;

/**
 * O que aceitamos. Lista fechada: um canal de ética recebe prova, não
 * executável. `.exe`, `.js` e afins simplesmente não entram.
 */
const MIMES_OK = [
  "image/", "video/", "audio/",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
  "text/plain", "text/csv",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Nome seguro para o storage, preservando a extensão que o Comitê vai ver. */
function nomeSeguro(nome: string): string {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_");
  return limpo.slice(-120) || "arquivo";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Envio inválido." }, 400);
  }

  const protocolo = String(form.get("protocolo") ?? "").trim().toUpperCase();
  // Não normalizada: é a senha escolhida pela pessoa, gravada como veio.
  const senha = String(form.get("senha") ?? "");
  const descricao = String(form.get("descricao") ?? "").trim().slice(0, 500);
  const arquivo = form.get("arquivo");

  if (!protocolo || !senha) return json({ error: "Informe o protocolo e a senha." }, 400);
  if (!(arquivo instanceof File)) return json({ error: "Nenhum arquivo recebido." }, 400);

  if (arquivo.size === 0) return json({ error: "O arquivo está vazio." }, 400);
  if (arquivo.size > TAMANHO_MAX) {
    return json({ error: "Arquivo maior que 25 MB. Envie uma versão menor ou divida em partes." }, 400);
  }
  const mime = arquivo.type || "application/octet-stream";
  if (!MIMES_OK.some((p) => mime.startsWith(p))) {
    return json({ error: "Tipo de arquivo não aceito. Envie imagem, vídeo, áudio, PDF ou documento." }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Credencial. A RPC compara contra o hash bcrypt e devolve o id só quando
  // protocolo e senha batem NA MESMA linha.
  const { data: ids, error: authErr } = await admin.rpc("denuncia_autenticar", {
    p_identificador: protocolo, p_senha: senha,
  });
  if (authErr) return json({ error: "Não foi possível validar o acesso." }, 400);

  const lista = (Array.isArray(ids) ? ids : ids ? [ids] : []) as string[];
  if (lista.length === 0) return json({ error: "Dados de acesso inválidos." }, 400);

  // `denuncia_autenticar` por e-mail devolve todas as denúncias da pessoa;
  // aqui o identificador é o protocolo, então é uma só. Conferimos mesmo
  // assim — anexar no caso errado seria pior que recusar.
  const { data: alvo } = await admin
    .from("CANAL_DENUNCIA").select("id").eq("protocolo", protocolo).maybeSingle();
  const denunciaId = alvo?.id as string | undefined;
  if (!denunciaId || !lista.includes(denunciaId)) {
    return json({ error: "Dados de acesso inválidos." }, 400);
  }

  const { count } = await admin
    .from("CANAL_DENUNCIA_ANEXO")
    .select("id", { count: "exact", head: true })
    .eq("denuncia_id", denunciaId)
    .eq("origem", "denunciante");
  if ((count ?? 0) >= MAX_POR_DENUNCIA) {
    return json({ error: `Limite de ${MAX_POR_DENUNCIA} arquivos por denúncia atingido.` }, 400);
  }

  const path = `${denunciaId}/denunciante/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, arquivo, {
    contentType: mime, upsert: false,
  });
  if (upErr) {
    console.error("upload falhou", upErr.message);
    return json({ error: "Não foi possível guardar o arquivo agora." }, 500);
  }

  const { error: insErr } = await admin.from("CANAL_DENUNCIA_ANEXO").insert({
    denuncia_id: denunciaId,
    origem: "denunciante",
    categoria: "evidencia",
    nome_arquivo: arquivo.name.slice(0, 200),
    storage_path: path,
    mime_type: mime,
    tamanho_bytes: arquivo.size,
    // Prova mandada por quem denuncia nasce sigilosa: pode conter a identidade
    // dele numa foto de crachá, num áudio, num print de conversa. Quem
    // reclassifica é o Comitê, com a capacidade de sigilo.
    sensivel: true,
    descricao: descricao || null,
  });
  if (insErr) {
    // O arquivo já subiu; sem a linha ele viraria lixo invisível no bucket.
    await admin.storage.from(BUCKET).remove([path]);
    console.error("insert anexo falhou", insErr.message);
    return json({ error: "Não foi possível registrar o arquivo agora." }, 500);
  }

  return json({ ok: true, nome: arquivo.name, tamanho: arquivo.size });
});
