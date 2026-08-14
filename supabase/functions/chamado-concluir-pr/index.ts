// Arquivo: supabase/functions/chamado-concluir-pr/index.ts
// Conclui um Chamado de Sistemas quando a PR que o resolve é mergeada na main.
// Chamada pelo GitHub Actions (.github/workflows/chamado_concluir_no_merge.yml)
// — mesma autenticação por secret de chamado-info / chamado-vincular-pr.
//
// Replica exatamente o que o botão "Concluir chamado" faz no ERP
// (src/pages/chamados/ExecutarChamado.tsx, mudarStatus("concluido", ...)):
// muda o status, registra o evento no histórico e dispara o push pro
// solicitante. A diferença é a origem: aqui não existe usuário logado.
//
// Secrets: CHAMADOS_CI_SECRET (SUPABASE_URL / SERVICE_ROLE já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CI_SECRET = Deno.env.get("CHAMADOS_CI_SECRET") ?? "";

// Login do GitHub → profiles.id. Mesma lista de chamado-vincular-pr e de
// .github/workflows/notify_discord.yml — atualizar nos três quando entrar
// gente nova no time. CHAMADO_SISTEMA_EVENTO.autor_id é NOT NULL (FK pra
// auth.users) e aqui não há auth.uid(), então sem essa correspondência o
// evento não é gravado.
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
    .select("id, status")
    .eq("numero", numero)
    .maybeSingle();
  if (chErr) return json({ error: chErr.message }, 500);
  if (!chamado) return json({ ok: true, concluido: false, motivo: "chamado não encontrado" });

  // Idempotência: o GitHub pode reentregar o mesmo evento de merge, e um
  // chamado reaberto e concluído à mão não deve ganhar evento duplicado.
  if (chamado.status === "concluido") {
    return json({ ok: true, concluido: true, motivo: "já estava concluído" });
  }

  const autorId = GITHUB_LOGIN_PARA_PROFILE_ID[prAutorGithub];
  if (!autorId) return json({ ok: true, concluido: false, motivo: "autor do GitHub não mapeado" });

  const { error: upErr } = await admin
    .from("CHAMADO_SISTEMA")
    .update({ status: "concluido" })
    .eq("id", chamado.id);
  if (upErr) return json({ error: upErr.message }, 500);

  const { error: insErr } = await admin.from("CHAMADO_SISTEMA_EVENTO").insert({
    chamado_id: chamado.id,
    autor_id: autorId,
    tipo: "evento",
    texto: `Chamado concluído automaticamente — PR mergeada: ${prTitulo || prUrl} — ${prUrl}`,
    meta: { canal: "github", origem: "merge", pr_url: prUrl, pr_titulo: prTitulo, pr_autor_github: prAutorGithub },
  });
  // Status já mudou; um erro no histórico não justifica desfazer a conclusão.
  if (insErr) console.error("Falha ao registrar evento de conclusão:", insErr.message);

  // Mesmo push que o clique manual dispara. Best-effort: o chamado já está
  // concluído, e falha de push não pode virar erro pro CI.
  try {
    const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/enviar-notificacao-push`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CI_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ chamado_id: chamado.id, evento: "concluido" }),
    });
    if (!pushRes.ok) console.error("enviar-notificacao-push respondeu", pushRes.status);
  } catch (e) {
    console.error("Falha ao chamar enviar-notificacao-push:", (e as Error).message);
  }

  return json({ ok: true, concluido: true });
});
