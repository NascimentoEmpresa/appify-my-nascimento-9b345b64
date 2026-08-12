// Arquivo: supabase/functions/denuncia-registrar/index.ts
// Registro público de denúncia — o endpoint que o formulário /denuncia chama.
//
// POR QUE EXISTE
// Antes a página falava direto com o PostgREST, e isso obriga o navegador a
// carregar a chave anon (que é um JWT). Aqui o navegador manda JSON puro, SEM
// nenhum header de autenticação: quem guarda a chave é esta função, no
// ambiente do servidor. Nenhum token, de nenhum tipo, passa pelo cliente.
//
// verify_jwt = false no config.toml — é público de propósito. Isso não
// afrouxa nada: a chave anon sempre foi pública (vai no bundle de qualquer
// app Supabase), então ela nunca foi barreira. A barreira real continua sendo
// a RPC, que valida os campos e é a única coisa que esta função alcança.
//
// Usa a chave ANON, não a service role: assim o GRANT da RPC continua valendo
// e esta função não ganha poder nenhum sobre o resto do banco.
//
// ANONIMATO: não loga corpo, IP nem user-agent. O que entra aqui vai direto
// para a RPC, que também não grava identidade. Ver a migration
// 20260812000001_canal_denuncias.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// "authorization" fica FORA do allow-headers de propósito: se um dia alguém
// mandar um token daqui, o navegador barra antes de sair.
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("denuncia_registrar", { payload });

  if (error) {
    // A mensagem da RPC é escrita para o denunciante ler ("Preencha relação,
    // tipo de denúncia e como tomou conhecimento."), então vai inteira. O
    // resto do erro fica aqui.
    return json({ error: error.message || "Não foi possível registrar agora." }, 400);
  }
  return json(data);
});
