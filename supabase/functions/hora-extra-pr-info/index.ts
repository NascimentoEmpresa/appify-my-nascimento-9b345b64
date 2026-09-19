// Arquivo: supabase/functions/hora-extra-pr-info/index.ts
// Consulta uma PR do repositório do ERP para montar o relatório de Hora Extra.
// É chamada pelo modal autenticado de conclusão da HE. O token do GitHub fica
// apenas nos Secrets do Supabase; o navegador recebe somente as métricas já
// autorizadas e o chamado extraído do título da PR.
//
// Secrets: GITHUB_TOKEN (fine-grained: Metadata/Pull requests = Read-only),
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const REPOSITORIO = "NascimentoEmpresa/appify-my-nascimento-9b345b64";
const API_GITHUB = `https://api.github.com/repos/${REPOSITORIO}`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class ErroGithub extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function cabecalhosGithub() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "erp-hora-extra",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
  };
}

async function contarArquivosAdicionados(numeroPr: number, totalAlterados: number): Promise<number> {
  let adicionados = 0;
  for (let pagina = 1; pagina <= 30; pagina += 1) {
    const resposta = await fetch(`${API_GITHUB}/pulls/${numeroPr}/files?per_page=100&page=${pagina}`, {
      headers: cabecalhosGithub(),
    });
    if (!resposta.ok) throw new ErroGithub("Não foi possível consultar os arquivos da PR no GitHub.", resposta.status);

    const arquivos: Array<{ status?: string }> = await resposta.json();
    adicionados += arquivos.filter((arquivo) => arquivo.status === "added").length;
    if (arquivos.length < 100) return adicionados;
  }

  // A API do GitHub limita esta rota a 3.000 arquivos. É preferível avisar
  // que o relatório não pode ser fechado do que gravar um total incompleto.
  if (totalAlterados > 3000) {
    throw new ErroGithub("A PR tem arquivos demais para o GitHub calcular este relatório automaticamente.", 422);
  }
  return adicionados;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!GITHUB_TOKEN) return json({ error: "A integração do GitHub ainda não foi configurada." }, 503);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado." }, 401);

  const usuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: sessao, error: erroSessao } = await usuario.auth.getUser();
  if (erroSessao || !sessao.user) return json({ error: "Sessão inválida." }, 401);

  let body: { solicitacao_id?: string; pr_numero?: number | string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const solicitacaoId = body.solicitacao_id?.trim() ?? "";
  const numeroPr = Number(body.pr_numero);
  if (!solicitacaoId || !Number.isSafeInteger(numeroPr) || numeroPr <= 0) {
    return json({ error: "Informe um número de PR válido." }, 400);
  }

  // Antes de consumir a API do GitHub, confirma que é o próprio colaborador
  // quem está preenchendo uma HE já liberada. A RLS sozinha também deixa o
  // aprovador ler a solicitação, mas ele não pode registrar a conclusão em
  // nome de outra pessoa.
  const { data: solicitacao, error: erroSolicitacao } = await usuario
    .from("HORA_EXTRA_SOLICITACAO")
    .select("id, colaborador_id, status")
    .eq("id", solicitacaoId)
    .maybeSingle();
  if (erroSolicitacao || !solicitacao || solicitacao.colaborador_id !== sessao.user.id || solicitacao.status !== "aprovada") {
    return json({ error: "Esta solicitação de HE não está disponível para preenchimento." }, 403);
  }

  try {
    const respostaPr = await fetch(`${API_GITHUB}/pulls/${numeroPr}`, { headers: cabecalhosGithub() });
    if (respostaPr.status === 404) return json({ error: `A PR #${numeroPr} não foi encontrada no repositório do ERP.` }, 404);
    if (!respostaPr.ok) throw new ErroGithub("Não foi possível consultar a PR no GitHub.", respostaPr.status);

    const pr: {
      number: number;
      html_url: string;
      title: string;
      additions: number;
      commits: number;
      changed_files: number;
    } = await respostaPr.json();
    const chamadoNoTitulo = pr.title.match(/^SIS-\d{4}-\d+/)?.[0];
    if (!chamadoNoTitulo) {
      return json(
        { error: "O título da PR deve começar com o ID do chamado, por exemplo: SIS-2026-0459: resumo." },
        422,
      );
    }

    // A mesma regra da CI é usada aqui, mas a RPC também confirma que o
    // chamado pertence ao colaborador e é elegível para esta data de HE.
    const { data: chamados, error: erroChamado } = await usuario.rpc("hora_extra_pr_chamado", {
      p_solicitacao_id: solicitacaoId,
      p_numero: chamadoNoTitulo,
    });
    if (erroChamado) return json({ error: erroChamado.message }, 422);
    const chamado = Array.isArray(chamados) ? chamados[0] : null;
    if (!chamado) return json({ error: `O chamado ${chamadoNoTitulo} não está disponível para esta HE.` }, 422);

    const arquivosAdicionados = await contarArquivosAdicionados(pr.number, pr.changed_files);
    // A confirmação fica fora do alcance do browser e será consumida pela RPC
    // de conclusão. Isso preserva as métricas consultadas no GitHub mesmo se
    // alguém alterar o payload da chamada no DevTools.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { error: erroValidacao } = await admin.from("HORA_EXTRA_PR_VALIDACAO").upsert(
      {
        solicitacao_id: solicitacaoId,
        pr_numero: pr.number,
        pr_url: pr.html_url,
        pr_titulo: pr.title,
        chamado_id: chamado.id,
        pr_linhas_adicionadas: pr.additions,
        pr_commits: pr.commits,
        pr_arquivos_adicionados: arquivosAdicionados,
        created_at: new Date().toISOString(),
      },
      { onConflict: "solicitacao_id,pr_numero" },
    );
    if (erroValidacao) {
      console.error("[hora-extra-pr-info] não foi possível registrar a validação:", erroValidacao.message);
      return json({ error: "Não foi possível confirmar os dados da PR para esta HE." }, 500);
    }
    return json({
      pr: {
        numero: pr.number,
        url: pr.html_url,
        titulo: pr.title,
        linhas_adicionadas: pr.additions,
        commits: pr.commits,
        arquivos_adicionados: arquivosAdicionados,
      },
      chamado,
    });
  } catch (erro) {
    if (erro instanceof ErroGithub) return json({ error: erro.message }, erro.status >= 400 && erro.status < 500 ? erro.status : 502);
    console.error("[hora-extra-pr-info] erro inesperado:", erro);
    return json({ error: "Não foi possível consultar a PR agora. Tente novamente." }, 502);
  }
});
