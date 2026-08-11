// Arquivo: supabase/functions/chamado-info/index.ts
// Devolve assunto/descrição/status de um Chamado de Sistemas pelo número
// (ex: SIS-2026-0076). Usada pelo GitHub Actions (.github/workflows/
// chamado_pr_sync.yml) pra validar e sincronizar PRs — não é chamada por
// usuários logados, por isso NÃO usa o padrão de sessão (auth.getUser()).
//
// Autenticação: header "Authorization: Bearer <CHAMADOS_CI_SECRET>",
// verificado à mão contra o secret abaixo — nunca a service role key nem a
// verificação padrão de JWT da Supabase (a anon key já é pública no
// repositório, então não protegeria nada). verify_jwt = false no config.toml.
//
// Secrets: CHAMADOS_CI_SECRET (SUPABASE_URL / SERVICE_ROLE já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CI_SECRET = Deno.env.get("CHAMADOS_CI_SECRET") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!CI_SECRET || authHeader !== `Bearer ${CI_SECRET}`) return json({ error: "não autorizado" }, 401);

  const numero = new URL(req.url).searchParams.get("numero")?.trim().toUpperCase() ?? "";
  if (!numero) return json({ error: "parâmetro 'numero' é obrigatório" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: chamado, error } = await admin
    .from("CHAMADO_SISTEMA")
    .select("numero, assunto, descricao, status")
    .eq("numero", numero)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!chamado) return json({ encontrado: false });

  return json({ encontrado: true, ...chamado });
});
