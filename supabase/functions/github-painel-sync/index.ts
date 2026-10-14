// Arquivo: supabase/functions/github-painel-sync/index.ts
// Sistemas › Chamados › Painel do Desenvolvedor › GitHub (mig 20261007000015).
//
// Traz do GitHub para o banco o que o painel mostra:
//   · PRs (GraphQL): autor, datas, linhas +/-, arquivos, commits, branch →
//     "GITHUB_PR". Incremental: PRs por data de ATUALIZAÇÃO, parando na
//     última sincronização. A 1ª carga (todas) vai em partes — cada chamada
//     usa até ~90 s e guarda o cursor em "GITHUB_SYNC".
//   · Commits e linhas por autor por semana na main (REST stats/contributors)
//     → "GITHUB_COMMITS_SEMANA". O GitHub às vezes responde 202 ("calculando");
//     aí fica o que já estava e tenta na próxima.
// No máximo a cada 15 min (body.forcar ignora). Quem chama precisa do
// Painel do Desenvolvedor (chamados_sistemas_dev). O token fica só nos
// Secrets (GITHUB_TOKEN, o mesmo da Hora Extra); o navegador lê do banco.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const DONO = "NascimentoEmpresa";
const REPO = "appify-my-nascimento-9b345b64";
const INTERVALO_MIN = 15;
const ORCAMENTO_MS = 90_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const gh = { Authorization: `Bearer ${GITHUB_TOKEN}`, "User-Agent": "erp-painel-dev", Accept: "application/vnd.github+json" };

const CONSULTA = `query($c: String, $ordem: PullRequestOrderField!) {
  repository(owner: "${DONO}", name: "${REPO}") {
    pullRequests(first: 50, after: $c, orderBy: { field: $ordem, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number title state createdAt mergedAt closedAt updatedAt additions deletions changedFiles
              commits { totalCount } author { login } headRefName }
    }
  }
}`;

type No = {
  number: number; title: string; state: string; createdAt: string; mergedAt: string | null; closedAt: string | null; updatedAt: string;
  additions: number; deletions: number; changedFiles: number; commits: { totalCount: number }; author: { login: string } | null; headRefName: string;
};

// Páginas de 50: com 100, o GitHub às vezes estoura o tempo calculando as
// linhas (devolve uma página HTML de erro). Erro passageiro: até 3 tentativas.
async function paginaPrs(cursor: string | null, ordem: "CREATED_AT" | "UPDATED_AT") {
  let ultimo = "";
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const r = await fetch("https://api.github.com/graphql", {
      method: "POST", headers: gh, body: JSON.stringify({ query: CONSULTA, variables: { c: cursor, ordem } }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (r?.ok && j?.data && !j.errors) return j.data.repository.pullRequests as { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: No[] };
    ultimo = `GitHub GraphQL ${r?.status ?? "sem resposta"}: ${j?.errors?.[0]?.message ?? j?.message ?? "erro"}`;
    if (r && r.status < 500 && j) break;          // erro de verdade (permissão, consulta) — não adianta repetir
    await new Promise((ok) => setTimeout(ok, 2000 * tentativa));
  }
  throw new Error(ultimo);
}

const linha = (n: No) => ({
  numero: n.number, titulo: n.title, estado: n.state, autor: n.author?.login ?? "(apagado)", branch: n.headRefName,
  criado_em: n.createdAt, mergeado_em: n.mergedAt, fechado_em: n.closedAt, atualizado_gh: n.updatedAt,
  adicoes: n.additions, remocoes: n.deletions, arquivos: n.changedFiles, commits: n.commits?.totalCount ?? 0,
  sincronizado_em: new Date().toISOString(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!GITHUB_TOKEN) return json({ error: "A integração do GitHub ainda não foi configurada (GITHUB_TOKEN)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado." }, 401);
  const usuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: sessao } = await usuario.auth.getUser();
  if (!sessao?.user) return json({ error: "Sessão inválida." }, 401);
  const adm = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: pode } = await adm.rpc("has_screen_access", { _user: sessao.user.id, _menu: "chamados_sistemas_dev", _acao: "visualizar" });
  if (!pode) return json({ error: "Sem acesso ao Painel do Desenvolvedor." }, 403);

  const body = await req.json().catch(() => ({}));
  const inicio = Date.now();
  const { data: syncs } = await adm.from("GITHUB_SYNC").select("*");
  const sPrs = syncs?.find((s: any) => s.id === "prs");
  const sCom = syncs?.find((s: any) => s.id === "commits");
  const recente = (s: any) => s?.sincronizado_em && Date.now() - new Date(s.sincronizado_em).getTime() < INTERVALO_MIN * 60_000;
  const res: Record<string, unknown> = {};

  // ── PRs ─────────────────────────────────────────────────────────────
  try {
    const completo = !!sPrs?.info?.completo;
    if (completo && recente(sPrs) && !body?.forcar) {
      res.prs = "em dia";
    } else if (!completo) {
      // 1ª carga, em partes: por data de criação, a partir do cursor salvo.
      let cursor: string | null = sPrs?.info?.cursor ?? null, total = 0, fim = false;
      while (Date.now() - inicio < ORCAMENTO_MS) {
        const p = await paginaPrs(cursor, "CREATED_AT");
        if (p.nodes.length) await adm.from("GITHUB_PR").upsert(p.nodes.map(linha), { onConflict: "numero" });
        total += p.nodes.length; cursor = p.pageInfo.endCursor;
        if (!p.pageInfo.hasNextPage) { fim = true; break; }
      }
      await adm.from("GITHUB_SYNC").upsert({ id: "prs", sincronizado_em: new Date().toISOString(), info: { completo: fim, cursor: fim ? null : cursor } });
      res.prs = fim ? `carga completa (${total} nesta parte)` : `carga em andamento (${total} nesta parte)`;
    } else {
      // Incremental: as atualizadas desde a última sincronização (10 min de folga).
      const desde = new Date(sPrs.sincronizado_em).getTime() - 10 * 60_000;
      let cursor: string | null = null, total = 0;
      for (let pag = 0; pag < 5 && Date.now() - inicio < ORCAMENTO_MS; pag++) {
        const p = await paginaPrs(cursor, "UPDATED_AT");
        const novas = p.nodes.filter((n) => new Date(n.updatedAt).getTime() >= desde);
        if (novas.length) await adm.from("GITHUB_PR").upsert(novas.map(linha), { onConflict: "numero" });
        total += novas.length; cursor = p.pageInfo.endCursor;
        if (novas.length < p.nodes.length || !p.pageInfo.hasNextPage) break;
      }
      await adm.from("GITHUB_SYNC").upsert({ id: "prs", sincronizado_em: new Date().toISOString(), info: { completo: true } });
      res.prs = `${total} atualizada(s)`;
    }
  } catch (e) {
    console.error("prs", e);
    res.prs_erro = (e as Error).message;
  }

  // ── Commits por semana (main) ───────────────────────────────────────
  if (recente(sCom) && !body?.forcar) {
    res.commits = "em dia";
  } else {
    try {
      const r = await fetch(`https://api.github.com/repos/${DONO}/${REPO}/stats/contributors`, { headers: gh });
      if (r.status === 202) {
        res.commits = "o GitHub está calculando — aparece na próxima atualização";
      } else if (r.status === 403 || r.status === 404) {
        res.commits_erro = "O token do GitHub não tem permissão de leitura do conteúdo (Contents: Read-only) — sem ela não dá para contar commits por pessoa.";
      } else if (!r.ok) {
        res.commits_erro = `GitHub stats ${r.status}`;
      } else {
        const lista = await r.json() as { author: { login: string } | null; weeks: { w: number; a: number; d: number; c: number }[] }[];
        const linhas = lista.flatMap((c) => (c.weeks ?? []).filter((w) => w.c || w.a || w.d).map((w) => ({
          autor: c.author?.login ?? "(apagado)", semana: new Date(w.w * 1000).toISOString().slice(0, 10), commits: w.c, adicoes: w.a, remocoes: w.d,
        })));
        await adm.from("GITHUB_COMMITS_SEMANA").delete().neq("autor", "");
        for (let i = 0; i < linhas.length; i += 500) await adm.from("GITHUB_COMMITS_SEMANA").insert(linhas.slice(i, i + 500));
        await adm.from("GITHUB_SYNC").upsert({ id: "commits", sincronizado_em: new Date().toISOString(), info: { autores: lista.length, semanas: linhas.length } });
        res.commits = `${linhas.length} semana(s) de ${lista.length} autor(es)`;
      }
    } catch (e) {
      console.error("commits", e);
      res.commits_erro = (e as Error).message;
    }
  }

  // Login novo do GitHub aparece na lista de nomes (para alguém dar o nome).
  await adm.rpc("github_dev_completar").then(() => {}, () => {});
  return json({ ok: true, ...res, ms: Date.now() - inicio });
});
