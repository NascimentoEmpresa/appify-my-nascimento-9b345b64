// Arquivo: supabase/functions/denuncia-listas/index.ts
//
// As listas que o formulário público precisa para montar os dois campos
// novos: EMPRESA (obrigatório) e CONTRATO.
//
// Mesmo desenho das outras rotas públicas do canal: o navegador manda JSON
// puro, sem header de autenticação, e a chave anon fica aqui no servidor.
//
// O QUE SAI DAQUI
//   · empresas  — nome das opções cadastradas em CANAL_DENUNCIA_EMPRESA.
//   · contratos — nomes de local de trabalho, distintos, da empresa escolhida.
//
// Nada além disso: nenhum dado de empregado, nenhuma contagem, nenhum
// identificador interno além do id da própria opção de empresa. É uma rota
// aberta à internet, e lista pública de empresa e de posto é a superfície
// mínima para o formulário funcionar.
//
// verify_jwt = false no config.toml — público de propósito.

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

  let body: { o?: string; empresa_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  if (body?.o === "empresas") {
    const { data, error } = await sb.rpc("denuncia_empresas");
    if (error) return json({ error: "Não foi possível carregar as empresas." }, 400);
    return json(data);
  }

  if (body?.o === "contratos") {
    const { data, error } = await sb.rpc("denuncia_contratos", {
      p_empresa_id: body.empresa_id ?? null,
    });
    if (error) return json({ error: "Não foi possível carregar os contratos." }, 400);
    return json(data);
  }

  return json({ error: "Operação desconhecida." }, 400);
});
