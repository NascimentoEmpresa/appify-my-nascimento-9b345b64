// Arquivo: supabase/functions/chamado-vincular-pr/index.ts
// Registra, como evento do Chamado de Sistemas, o link de uma PR do GitHub
// aberta pra resolvê-lo. Chamada pelo GitHub Actions (.github/workflows/
// chamado_pr_sync.yml) — mesma autenticação por secret de chamado-info.
//
// Secrets: CHAMADOS_CI_SECRET (SUPABASE_URL / SERVICE_ROLE já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CI_SECRET = Deno.env.get("CHAMADOS_CI_SECRET") ?? "";

// Login do GitHub → profiles.id. Mesma lista de devs usada em
// .github/workflows/notify_discord.yml — atualizar aqui junto quando entrar
// gente nova no time. CHAMADO_SISTEMA_EVENTO.autor_id é NOT NULL (FK pra
// auth.users), então sem essa correspondência o evento não é gravado.
const GITHUB_LOGIN_PARA_PROFILE_ID: Record<string, string> = {
  EduardoJeiel007: "97260632-2f1a-44e3-9f93-58b2b1f3702c",
  Tasuyuk1: "301bfa45-d01a-4e81-abd9-18d48bccef97",
  joaovperetti: "e2c4faf6-289e-4f80-a235-628c2d674f46",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Body {
  numero?: string;
  pr_url?: string;
  pr_titulo?: string;
  pr_autor_github?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!CI_SECRET || authHeader !== `Bearer ${CI_SECRET}`) return json({ error: "não autorizado" }, 401);

  let body: Body;
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const numero = body.numero?.trim().toUpperCase() ?? "";
  const prUrl = body.pr_url?.trim() ?? "";
  const prTitulo = body.pr_titulo?.trim() ?? "";
  const prAutorGithub = body.pr_autor_github?.trim() ?? "";
  if (!numero || !prUrl) return json({ error: "numero e pr_url são obrigatórios" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: chamado, error: chErr } = await admin
    .from("CHAMADO_SISTEMA")
    .select("id")
    .eq("numero", numero)
    .maybeSingle();
  if (chErr) return json({ error: chErr.message }, 500);
  if (!chamado) return json({ ok: true, vinculado: false, motivo: "chamado não encontrado" });

  const autorId = GITHUB_LOGIN_PARA_PROFILE_ID[prAutorGithub];
  if (!autorId) return json({ ok: true, vinculado: false, motivo: "autor do GitHub não mapeado" });

  // Idempotência: não duplica se essa PR já foi registrada nesse chamado.
  const { data: existente } = await admin
    .from("CHAMADO_SISTEMA_EVENTO")
    .select("id")
    .eq("chamado_id", chamado.id)
    .eq("meta->>pr_url", prUrl)
    .maybeSingle();
  if (existente) return json({ ok: true, vinculado: true, motivo: "já registrado" });

  const { error: insErr } = await admin.from("CHAMADO_SISTEMA_EVENTO").insert({
    chamado_id: chamado.id,
    autor_id: autorId,
    tipo: "evento",
    texto: `PR aberta: ${prTitulo || prUrl} — ${prUrl}`,
    meta: { canal: "github", pr_url: prUrl, pr_titulo: prTitulo, pr_autor_github: prAutorGithub },
  });
  if (insErr) return json({ error: insErr.message }, 500);

  return json({ ok: true, vinculado: true });
});
