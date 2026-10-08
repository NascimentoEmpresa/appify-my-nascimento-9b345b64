// Arquivo: supabase/functions/dev-github-sync/index.ts
// Painel do Desenvolvedor › GitHub (mig 20261007000022): copia PRs, commits e
// arquivos alterados do repositório do ERP para DEV_GITHUB_PR/_COMMIT.
//
// Incremental e em lotes, porque o histórico tem centenas de PRs e cada uma
// custa 3 chamadas (detalhe, commits, arquivos) — uma execução só estouraria
// o tempo da Edge:
//   1) lista as PRs por "updated" (desc) até achar uma que já está igual no
//      cache; as novas/alteradas ficam com detalhado_em = NULL;
//   2) detalha até LOTE PRs pendentes e devolve quantas ainda faltam.
// A tela chama de novo enquanto `pendentes > 0`.
//
// Secrets: GITHUB_TOKEN (o mesmo de hora-extra-pr-info — Metadata e Pull
// requests = Read-only bastam: commits e arquivos são lidos PELA PR),
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const REPOSITORIO = "NascimentoEmpresa/appify-my-nascimento-9b345b64";
const API = `https://api.github.com/repos/${REPOSITORIO}`;
const LOTE = 20;
const PARALELO = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const gh = async <T>(caminho: string): Promise<T> => {
  const r = await fetch(`${API}${caminho}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "erp-dev-github", Authorization: `Bearer ${GITHUB_TOKEN}` },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} em ${caminho}`);
  return r.json() as Promise<T>;
};

interface PrLista {
  number: number; title: string; html_url: string; state: string; draft: boolean; merged_at: string | null;
  user: { login: string; avatar_url: string } | null; head: { ref: string }; base: { ref: string };
  created_at: string; updated_at: string; closed_at: string | null;
}
interface PrDetalhe extends PrLista {
  commits: number; additions: number; deletions: number; changed_files: number; merged_by: { login: string } | null;
}
interface CommitGh {
  sha: string; author: { login: string } | null;
  commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null };
}
interface ArquivoGh { filename: string; status: string; additions: number }

const ehMigration = (f: string) => /^supabase\/migrations\/[^/]+\.sql$/i.test(f);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!GITHUB_TOKEN) return json({ error: "A integração do GitHub ainda não foi configurada (secret GITHUB_TOKEN)." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado." }, 401);
  const usuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: sessao, error: erroSessao } = await usuario.auth.getUser();
  if (erroSessao || !sessao.user) return json({ error: "Sessão inválida." }, 401);
  const { data: pode } = await usuario.rpc("dev_github_pode_ver");
  if (pode !== true) return json({ error: "Sem acesso ao Painel do Desenvolvedor." }, 403);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // ── 1) Lista incremental ───────────────────────────────────────────
    const { data: cache } = await admin.from("DEV_GITHUB_PR").select("numero, atualizado_em");
    const conhecido = new Map<number, string>((cache ?? []).map((c) => [c.numero as number, c.atualizado_em as string]));
    let novas = 0;
    for (let pagina = 1; pagina <= 30; pagina++) {
      const lista = await gh<PrLista[]>(`/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${pagina}`);
      if (!lista.length) break;
      const mudaram = lista.filter((p) => {
        const antes = conhecido.get(p.number);
        return !antes || new Date(antes).getTime() !== new Date(p.updated_at).getTime();
      });
      if (mudaram.length) {
        const { error } = await admin.from("DEV_GITHUB_PR").upsert(mudaram.map((p) => ({
          numero: p.number, titulo: p.title, url: p.html_url,
          estado: p.merged_at ? "merged" : p.state, rascunho: !!p.draft,
          autor_login: p.user?.login ?? null, autor_avatar: p.user?.avatar_url ?? null,
          branch_origem: p.head?.ref ?? null, branch_destino: p.base?.ref ?? null,
          chamado: p.title.match(/SIS-\d{4}-\d+/)?.[0] ?? null,
          criado_em: p.created_at, atualizado_em: p.updated_at, fechado_em: p.closed_at, mergeado_em: p.merged_at,
          detalhado_em: null,
        })), { onConflict: "numero" });
        if (error) throw new Error(error.message);
        novas += mudaram.length;
      }
      // Ordenado por atualização: página sem nada novo = o resto também está igual.
      if (mudaram.length < lista.length) break;
    }

    // ── 2) Detalha um lote ─────────────────────────────────────────────
    const { data: pend } = await admin.from("DEV_GITHUB_PR").select("numero")
      .is("detalhado_em", null).order("numero", { ascending: false }).limit(LOTE);
    const numeros = (pend ?? []).map((p) => p.numero as number);

    const detalhar = async (n: number) => {
      const d = await gh<PrDetalhe>(`/pulls/${n}`);
      const commits: CommitGh[] = [];
      for (let pg = 1; pg <= 3; pg++) {            // a API devolve no máximo 250 commits por PR
        const c = await gh<CommitGh[]>(`/pulls/${n}/commits?per_page=100&page=${pg}`);
        commits.push(...c);
        if (c.length < 100) break;
      }
      const arquivos: ArquivoGh[] = [];
      for (let pg = 1; pg <= 30; pg++) {           // até 3.000 arquivos
        const a = await gh<ArquivoGh[]>(`/pulls/${n}/files?per_page=100&page=${pg}`);
        arquivos.push(...a);
        if (a.length < 100) break;
      }
      const migs = arquivos.filter((a) => ehMigration(a.filename) && a.status === "added").map((a) => a.filename.split("/").pop()!);
      const linhasSql = arquivos.filter((a) => a.filename.toLowerCase().endsWith(".sql")).reduce((s, a) => s + (a.additions ?? 0), 0);

      if (commits.length) {
        const { error } = await admin.from("DEV_GITHUB_COMMIT").upsert(commits.map((c) => ({
          sha: c.sha, pr_numero: n, autor_login: c.author?.login ?? null, autor_nome: c.commit.author?.name ?? null,
          data: c.commit.author?.date ?? c.commit.committer?.date ?? d.created_at, mensagem: c.commit.message,
        })), { onConflict: "sha", ignoreDuplicates: true });   // commit já visto em PR anterior fica com ela
        if (error) throw new Error(error.message);
      }
      const { error } = await admin.from("DEV_GITHUB_PR").update({
        estado: d.merged_at ? "merged" : d.state, mergeado_em: d.merged_at, mergeado_por: d.merged_by?.login ?? null,
        fechado_em: d.closed_at, commits: d.commits, adicoes: d.additions, remocoes: d.deletions, arquivos: d.changed_files,
        migrations: migs.length, linhas_sql: linhasSql, migrations_lista: migs, detalhado_em: new Date().toISOString(),
      }).eq("numero", n);
      if (error) throw new Error(error.message);
    };

    for (let i = 0; i < numeros.length; i += PARALELO) {
      await Promise.all(numeros.slice(i, i + PARALELO).map(detalhar));
    }

    const { count } = await admin.from("DEV_GITHUB_PR").select("numero", { count: "exact", head: true }).is("detalhado_em", null);
    await admin.from("DEV_GITHUB_SYNC").update({
      ultima_em: new Date().toISOString(), ultima_por: sessao.user.email ?? null, ultimo_erro: null,
    }).eq("id", 1);
    return json({ novas, detalhadas: numeros.length, pendentes: count ?? 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("DEV_GITHUB_SYNC").update({ ultimo_erro: msg }).eq("id", 1);
    return json({ error: `Falha ao sincronizar com o GitHub: ${msg}` }, 502);
  }
});
