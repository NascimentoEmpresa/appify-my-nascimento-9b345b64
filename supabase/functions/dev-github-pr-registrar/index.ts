// Arquivo: supabase/functions/dev-github-pr-registrar/index.ts
// SIS-2026-0786 — Controle de Pull Requests (mig 20261029004900).
//
// Grava PRs mergeadas no cache "DEV_GITHUB_PR" (o mesmo do Painel GitHub).
// Chamada SÓ pelo GitHub Actions (.github/workflows/pr_registrar_painel.yml),
// com a mesma autenticação por secret de chamado-concluir-pr:
//   · no merge: 1 PR, montada do próprio evento — zero chamada à API do GitHub;
//   · "Run workflow" manual: carga do histórico em páginas de até 100 PRs,
//     lidas pelo GraphQL com o token do próprio Actions.
// Não usa o GITHUB_TOKEN das Edges: a sincronização em massa por ele já
// suspendeu as contas do Pablo (13/10/2026).
//
// Convivência com a dev-github-sync: aqui só entram as colunas que o evento
// traz. migrations/linhas_sql/commits por autor continuam vindo dela, que
// detalha toda PR com detalhado_em NULL — por isso PR nova nasce com
// detalhado_em NULL e PR já detalhada não tem o campo tocado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CI_SECRET = Deno.env.get("CHAMADOS_CI_SECRET") ?? "";
const MAX_POR_CHAMADA = 100;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface PrEntrada {
  numero?: unknown; titulo?: unknown; url?: unknown; rascunho?: unknown;
  autor_login?: unknown; autor_avatar?: unknown; branch_origem?: unknown; branch_destino?: unknown;
  criado_em?: unknown; atualizado_em?: unknown; fechado_em?: unknown; mergeado_em?: unknown; mergeado_por?: unknown;
  commits?: unknown; adicoes?: unknown; remocoes?: unknown; arquivos?: unknown;
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const inteiro = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const data = (v: unknown) => {
  const s = texto(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!CI_SECRET || authHeader !== `Bearer ${CI_SECRET}`) return json({ error: "não autorizado" }, 401);

  let body: { prs?: PrEntrada[] };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const entrada = Array.isArray(body.prs) ? body.prs : [];
  if (!entrada.length) return json({ error: "prs vazio" }, 400);
  if (entrada.length > MAX_POR_CHAMADA) return json({ error: `no máximo ${MAX_POR_CHAMADA} PRs por chamada` }, 400);

  // Só PR mergeada: é o registro do que foi para produção. O resto é ignorado
  // (e contado), não recusado — a carga do histórico manda página inteira.
  const linhas = [];
  let ignoradas = 0;
  for (const p of entrada) {
    const numero = inteiro(p.numero);
    const titulo = texto(p.titulo);
    const mergeado = data(p.mergeado_em);
    const criado = data(p.criado_em);
    if (!numero || !titulo || !mergeado || !criado) { ignoradas++; continue; }
    linhas.push({
      numero, titulo, url: texto(p.url), estado: "merged", rascunho: p.rascunho === true,
      autor_login: texto(p.autor_login), autor_avatar: texto(p.autor_avatar),
      branch_origem: texto(p.branch_origem), branch_destino: texto(p.branch_destino),
      chamado: titulo.match(/SIS-\d{4}-\d+/)?.[0] ?? null,
      criado_em: criado, atualizado_em: data(p.atualizado_em) ?? mergeado,
      fechado_em: data(p.fechado_em) ?? mergeado, mergeado_em: mergeado, mergeado_por: texto(p.mergeado_por),
      commits: inteiro(p.commits), adicoes: inteiro(p.adicoes), remocoes: inteiro(p.remocoes), arquivos: inteiro(p.arquivos),
    });
  }
  if (!linhas.length) return json({ ok: true, gravadas: 0, ignoradas });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { error } = await admin.from("DEV_GITHUB_PR").upsert(linhas, { onConflict: "numero" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, gravadas: linhas.length, ignoradas });
});
