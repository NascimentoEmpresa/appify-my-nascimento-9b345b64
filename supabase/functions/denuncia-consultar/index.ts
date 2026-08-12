// Arquivo: supabase/functions/denuncia-consultar/index.ts
// Acompanhamento público de denúncia por protocolo + senha.
//
// Mesmo desenho do denuncia-registrar: o navegador manda JSON puro, sem
// header de autenticação nenhum, e a chave anon fica só aqui no servidor.
// verify_jwt = false no config.toml. Ver o cabeçalho daquele arquivo.
//
// Quem autentica é o par protocolo + senha, conferido dentro da RPC contra o
// hash — e ela devolve a mesma mensagem para protocolo inexistente e senha
// errada, senão daria para descobrir quais protocolos existem. A resposta
// nunca traz o relato: só status, datas e o retorno do comitê.
//
// POST em vez de GET de propósito: em GET a senha viraria query string e
// entraria em log de servidor, histórico e Referer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { protocolo?: string; senha?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const protocolo = (body?.protocolo ?? "").trim();
  const senha = (body?.senha ?? "").trim();
  if (!protocolo || !senha) {
    return json({ error: "Informe o protocolo e a senha recebidos ao registrar a denúncia." }, 400);
  }

  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("denuncia_consultar", {
    p_protocolo: protocolo,
    p_senha: senha,
  });

  // 400 para tudo: 401/404 distintos entregariam de graça se o protocolo
  // existe, que é justamente o que a RPC evita.
  if (error) return json({ error: error.message || "Não foi possível consultar agora." }, 400);
  return json(data);
});
