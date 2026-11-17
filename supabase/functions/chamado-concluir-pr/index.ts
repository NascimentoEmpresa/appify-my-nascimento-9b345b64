// Arquivo: supabase/functions/chamado-concluir-pr/index.ts
// Entrega ao GESTOR DE SISTEMAS o chamado cuja PR foi mergeada — NÃO
// conclui o chamado. Chamada pelo GitHub Actions
// (.github/workflows/chamado_concluir_no_merge.yml) — mesma autenticação por
// secret de chamado-info / chamado-vincular-pr. O nome da função e do
// workflow ficaram os antigos de propósito: mexer no workflow do GitHub
// Actions passa pelo time (revisão da PR #1310).
//
// HISTÓRICO
//   · até 12/11/2026: o merge concluía o chamado (status 'concluido');
//   · 12 a 17/11: a PR ABERTA concluía (origem "pr_aberta") e o merge era
//     reserva — no SIS-2026-0909 a PR #1302 abriu e o chat já disse "Chamado
//     concluído automaticamente — PR #1302 aberta";
//   · 17/11/2026, revisão da PR #1310: existem DUAS finalizações — concluir o
//     chamado em si (status 'concluido', o que o solicitante vê) e a do Gestor
//     de Sistemas. O merge passa a só ENTREGAR ao gestor
//     (desenvolvimento_entregue_em/_pr, mig 20261117235500; o gatilho avisa o
//     gestor no sino) e quem conclui o chamado é ele, no botão "Concluir
//     chamado". Depois seguem a confirmação do solicitante (mig 20261028001300)
//     e a finalização do gestor (mig 20261110009000), como antes.
//
// origem "pr_aberta": não faz nada (o "PR aberta: ..." no histórico é do
// chamado-vincular-pr). origem "merge": entrega ao gestor e, desde 13/11/2026,
// põe no chat o RESUMO do que foi feito, para o solicitante, com as URLs das
// telas (Pablo: "a i.a tem que ler os commits e a PR inteira depois do merge").
// Esta função não muda o status — por isso não dispara push de "concluído",
// parecer da I.A nem o "Confirme a conclusão": tudo isso sai no clique do
// gestor.
//
// RESUMO: Gemini (GEMINI_API_KEY) com Groq (GROQ_API_KEY) de reserva, os
// mesmos do parecer. Sem I.A (sem chave, cota), vai o título da PR e os
// commits — a mensagem sai de qualquer jeito. Prompt e montagem em
// _shared/chamado-resumo-pr.ts (testado no Vitest).
//
// Secrets: CHAMADOS_CI_SECRET (SUPABASE_URL / SERVICE_ROLE já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  limparResumoIa, listaDeTextos, MAX_ALTERACOES_CHARS, MAX_ARQUIVOS, MAX_COMMIT_CHARS, MAX_COMMITS, montarMensagemResumo, montarPromptResumo,
  resumoSemIa, urlsValidas, type EntradaResumo,
  commitsPorPalavras, detalhesValidos, separarRespostaIa, urlsDosEscolhidos,
} from "../_shared/chamado-resumo-pr.ts";
import { perfilDoLoginGithub } from "../_shared/dev-github-login.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CI_SECRET = Deno.env.get("CHAMADOS_CI_SECRET") ?? "";

// Login do GitHub → profiles.id: tabela DEV_GITHUB_USUARIO (12/11/2026, ver
// _shared/dev-github-login.ts). A lista chumbada que ficava aqui não tinha o
// Pablo (PabloTasuyuk) nem o Otavio: a PR deles não concluía o chamado.
// CHAMADO_SISTEMA_EVENTO.autor_id é NOT NULL (FK pra auth.users) e aqui não
// há auth.uid(), então sem essa correspondência o evento não é gravado.

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
  pr_numero?: number | null;
  pr_commits?: number | null;
  pr_linhas_adicionadas?: number | null;
  pr_arquivos_alterados?: number | null;
  /** "merge" (único aceito desde 17/11/2026). "pr_aberta" é recusado. */
  origem?: string;
  pr_corpo?: string | null;
  /**
   * Resumo no chat (13/11/2026): só no merge, com `resumo: true`. Commits do
   * chamado (mensagem inteira), arquivos, código alterado e URLs das telas.
   */
  resumo?: boolean;
  commits?: unknown;
  arquivos?: unknown;
  urls?: unknown;
  alteracoes?: unknown;
  /** [{ mensagem, urls }] por commit, na ordem de `commits` (13/11/2026). */
  commits_detalhe?: unknown;
}

// Métricas da PR são contagens inteiras. null mantém compatibilidade com
// conclusões disparadas pelo workflow anterior, que não enviava os campos.
const inteiroNaoNegativo = (valor: unknown) =>
  typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : null;

type Provedor = { nome: string; url: string; chave: string; modelo: string };
function provedores(): Provedor[] {
  const lista: Provedor[] = [];
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    lista.push({ nome: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", chave: gemini,
                 modelo: Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({ nome: "groq", url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
                 modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" });
  }
  return lista;
}

/** Texto da I.A ou null (sem chave, cota, erro) — quem chama cai no resumo sem I.A. */
async function resumirComIa(messages: { role: string; content: string }[]): Promise<string | null> {
  for (const p of provedores()) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: p.modelo, messages, temperature: 0.2 }),
        signal: AbortSignal.timeout(40_000),
      });
      if (r.ok) {
        const dados = await r.json();
        const t = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (t) return t;
        continue;
      }
      console.error("chamado-concluir-pr: resumo, erro do provedor", p.nome, r.status, (await r.text()).slice(0, 300));
    } catch (e) {
      console.error("chamado-concluir-pr: resumo, provedor sem resposta", p.nome, (e as Error).message);
    }
  }
  return null;
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
  const prNumero = inteiroNaoNegativo(body.pr_numero);
  const prCommits = inteiroNaoNegativo(body.pr_commits);
  const prLinhasAdicionadas = inteiroNaoNegativo(body.pr_linhas_adicionadas);
  const prArquivosAlterados = inteiroNaoNegativo(body.pr_arquivos_alterados);
  // Sem origem = workflow antigo, que só chamava no merge.
  const origem = body.origem === "pr_aberta" ? "pr_aberta" : "merge";
  if (!numero || !prUrl) return json({ error: "numero e pr_url são obrigatórios" }, 400);
  // Abrir a PR não conclui nem entrega nada (ver topo).
  if (origem === "pr_aberta") {
    return json({ ok: true, concluido: false, origem, motivo: "abrir a PR não conclui o chamado; no merge ele é entregue ao Gestor de Sistemas, que conclui" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: chamado, error: chErr } = await admin
    .from("CHAMADO_SISTEMA")
    .select("id, status, assunto, descricao")
    .eq("numero", numero)
    .maybeSingle();
  if (chErr) return json({ error: chErr.message }, 500);
  if (!chamado) return json({ ok: true, concluido: false, motivo: "chamado não encontrado" });

  const autorId = await perfilDoLoginGithub(admin, prAutorGithub);

  // ── 1) Entrega ao Gestor de Sistemas — NÃO conclui (17/11/2026) ──────
  // Só marca desenvolvimento_entregue_em/_pr; o gestor conclui no botão.
  // Idempotência: o GitHub pode reentregar o mesmo evento.
  const encerrado = ["concluido", "cancelado", "reprovado"].includes(chamado.status);
  let entregue = false;
  let motivo: string | null = encerrado ? `chamado já está ${chamado.status} — nada a entregar` : null;
  if (!encerrado) {
    const { data: jaEntregou } = await admin
      .from("CHAMADO_SISTEMA_EVENTO")
      .select("chamado_id")
      .eq("chamado_id", chamado.id)
      .eq("meta->>pr_url", prUrl)
      .eq("meta->>origem", "merge")
      .limit(1);
    if (jaEntregou && jaEntregou.length > 0) {
      entregue = true;
      motivo = "o merge desta PR já foi registrado";
    } else if (!autorId) {
      motivo = "autor do GitHub não mapeado";
    } else {
      // Erro aqui (coluna ainda sem migration, por ex.) não impede o evento
      // nem o resumo: o gestor vê a entrega pelo histórico.
      const { error: upErr } = await admin
        .from("CHAMADO_SISTEMA")
        .update({ desenvolvimento_entregue_em: new Date().toISOString(), desenvolvimento_entregue_pr: prUrl })
        .eq("id", chamado.id);
      if (upErr) console.error("Falha ao marcar a entrega:", upErr.message);

      const metricas = [
        prCommits !== null && `${prCommits} ${prCommits === 1 ? "commit" : "commits"}`,
        prLinhasAdicionadas !== null && `${prLinhasAdicionadas} linhas adicionadas`,
        prArquivosAlterados !== null && `${prArquivosAlterados} ${prArquivosAlterados === 1 ? "arquivo alterado" : "arquivos alterados"}`,
      ].filter(Boolean).join(" · ");

      const { error: insErr } = await admin.from("CHAMADO_SISTEMA_EVENTO").insert({
        chamado_id: chamado.id,
        autor_id: autorId,
        tipo: "evento",
        texto: `Desenvolvimento entregue — PR${prNumero !== null ? ` #${prNumero}` : ""} mergeada: ${prTitulo || prUrl}${metricas ? ` — ${metricas}` : ""} — ${prUrl}. Falta o Gestor de Sistemas concluir o chamado.`,
        meta: {
          canal: "github", origem, acao: "desenvolvimento_entregue", pr_numero: prNumero, pr_url: prUrl,
          pr_titulo: prTitulo, pr_autor_github: prAutorGithub, pr_commits: prCommits,
          pr_linhas_adicionadas: prLinhasAdicionadas, pr_arquivos_alterados: prArquivosAlterados,
        },
      });
      if (insErr) console.error("Falha ao registrar a entrega no histórico:", insErr.message);
      entregue = true;
      motivo = "desenvolvimento entregue ao Gestor de Sistemas — ele conclui o chamado";
    }
  }

  // ── 2) Resumo para o solicitante, no chat — SÓ NO MERGE (13/11/2026) ──
  // Pablo: "a i.a tem que ler os commits e a PR inteira depois do merge".
  // O workflow manda `resumo: true` com os commits DESTE chamado (mensagem
  // inteira), os arquivos, o código alterado e as URLs da PR já mergeada.
  // Vale para o chamado entregue agora e para o já concluído à mão pelo gestor.
  // Uma vez por PR; cancelado/reprovado não recebe "pronto".
  let resumoGravado = false;
  let motivoResumo: string | null = null;
  if (origem === "merge" && body.resumo === true) {
    if (!entregue && chamado.status !== "concluido") motivoResumo = `chamado não foi entregue (${motivo ?? "?"}) — resumo não enviado`;
    else if (!autorId) motivoResumo = "autor do GitHub não mapeado";
    else {
      const { data: jaTem } = await admin
        .from("CHAMADO_SISTEMA_EVENTO")
        .select("chamado_id")
        .eq("chamado_id", chamado.id)
        .eq("meta->>origem", "resumo_pr")
        .eq("meta->>pr_url", prUrl)
        .limit(1);
      if (jaTem && jaTem.length > 0) {
        motivoResumo = "o resumo desta PR já foi enviado";
      } else {
        const entrada: EntradaResumo = {
          numero, assunto: chamado.assunto ?? "", descricao: chamado.descricao ?? null,
          prTitulo, prCorpo: body.pr_corpo ?? null,
          commits: listaDeTextos(body.commits, MAX_COMMITS, MAX_COMMIT_CHARS),
          arquivos: listaDeTextos(body.arquivos, MAX_ARQUIVOS),
          urls: urlsValidas(body.urls),
          alteracoes: typeof body.alteracoes === "string" ? body.alteracoes.slice(0, MAX_ALTERACOES_CHARS) : null,
        };
        // Detalhe por commit só vale se casar 1:1 com `commits` (mesma ordem).
        const detalhes = detalhesValidos(body.commits_detalhe);
        if (detalhes.length === entrada.commits.length) entrada.detalhes = detalhes;
        // 13/11/2026: a I.A diz na 1ª linha quais commits são deste chamado
        // (SIS-2026-0895 levou as URLs das TVs); sem a linha, vale o plano B
        // pelas palavras do pedido. URLs só dos commits escolhidos.
        const ia = await resumirComIa(montarPromptResumo(entrada));
        const separado = ia ? separarRespostaIa(ia, entrada.commits.length) : null;
        const escolhidos = separado?.escolhidos ?? commitsPorPalavras(entrada);
        const urls = urlsDosEscolhidos(entrada, escolhidos);
        const resumo = (separado && limparResumoIa(separado.texto)) || resumoSemIa(entrada, escolhidos);
        const { error: resErr } = await admin.from("CHAMADO_SISTEMA_EVENTO").insert({
          chamado_id: chamado.id,
          autor_id: autorId,
          tipo: "comentario",
          texto: montarMensagemResumo(resumo, urls),
          meta: {
            canal: "github", origem: "resumo_pr", pr_url: prUrl, pr_numero: prNumero, ia: !!ia, urls,
            commits_escolhidos: escolhidos.map((i) => i + 1), escolha: separado?.escolhidos ? "ia" : "palavras",
          },
        });
        if (resErr) console.error("Falha ao gravar o resumo no chat:", resErr.message);
        else resumoGravado = true;
      }
    }
  }

  return json({
    ok: true, concluido: chamado.status === "concluido", entregue, origem, resumo: resumoGravado,
    ...(motivo ? { motivo } : {}), ...(motivoResumo ? { motivo_resumo: motivoResumo } : {}),
  });
});
