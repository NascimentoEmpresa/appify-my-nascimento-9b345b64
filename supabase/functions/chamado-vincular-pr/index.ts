// Arquivo: supabase/functions/chamado-vincular-pr/index.ts
// Registra, como evento do Chamado de Sistemas, o link de uma PR do GitHub
// aberta pra resolvê-lo. Chamada pelo GitHub Actions (.github/workflows/
// chamado_pr_sync.yml) — mesma autenticação por secret de chamado-info.
//
// Secrets: CHAMADOS_CI_SECRET (SUPABASE_URL / SERVICE_ROLE já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { perfilDoLoginGithub } from "../_shared/dev-github-login.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CI_SECRET = Deno.env.get("CHAMADOS_CI_SECRET") ?? "";

// Login do GitHub → profiles.id: tabela DEV_GITHUB_USUARIO (12/11/2026, ver
// _shared/dev-github-login.ts). Antes era uma lista chumbada aqui, sem os
// logins do Pablo (PabloTasuyuk) e do Otavio. CHAMADO_SISTEMA_EVENTO.autor_id
// é NOT NULL (FK pra auth.users), então sem essa correspondência o evento não
// é gravado.

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

  const autorId = await perfilDoLoginGithub(admin, prAutorGithub);
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
