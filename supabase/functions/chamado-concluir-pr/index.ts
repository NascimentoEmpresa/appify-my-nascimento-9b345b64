// Arquivo: supabase/functions/chamado-concluir-pr/index.ts
// Conclui um Chamado de Sistemas pela PR que o resolve.
// Chamada pelo GitHub Actions (.github/workflows/chamado_concluir_no_merge.yml)
// — mesma autenticação por secret de chamado-info / chamado-vincular-pr.
//
// QUANDO (12/11/2026, pedido do Pablo): "quando o desenvolvedor abrir um PR
// conclua o chamado automaticamente". Antes era só no merge. Agora:
//   · origem "pr_aberta" — PR aberta (ou saída de rascunho): conclui e põe no
//     chat do chamado o RESUMO do que foi feito, para o solicitante, com as
//     URLs das telas (calculadas no workflow pelas rotas do App.tsx);
//   · origem "merge" — continua como reserva para PR aberta antes desta
//     mudança. Se ESTA PR já concluiu o chamado uma vez, o merge não conclui
//     de novo: o solicitante pode ter reaberto, e a reabertura vale.
//
// Replica o que o botão "Concluir chamado" faz no ERP
// (src/pages/chamados/ExecutarChamado.tsx, mudarStatus("concluido", ...)):
// muda o status, registra o evento no histórico e dispara o push pro
// solicitante. A diferença é a origem: aqui não existe usuário logado.
//
// Concluir não encerra de vez (mig 20261028001300): o gatilho
// chamado_sistema_confirmacao deixa o chamado aguardando o SOLICITANTE
// clicar em "Confirmar conclusão", e chamado_concluido_avisa_solicitante põe
// o aviso no sino dele. O parecer da I.A sai pelo gatilho da conclusão
// (mig 20261112001000), sem horas gastas.
//
// RESUMO: Gemini (GEMINI_API_KEY) com Groq (GROQ_API_KEY) de reserva, os
// mesmos do parecer. Sem I.A (sem chave, cota), vai o título da PR e os
// commits — a mensagem sai de qualquer jeito. Prompt e montagem em
// _shared/chamado-resumo-pr.ts (testado no Vitest).
//
// Secrets: CHAMADOS_CI_SECRET (SUPABASE_URL / SERVICE_ROLE já existem).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  limparResumoIa, listaDeTextos, MAX_ARQUIVOS, MAX_COMMITS, montarMensagemResumo, montarPromptResumo,
  resumoSemIa, urlsValidas, type EntradaResumo,
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
  /** "pr_aberta" (padrão desde 12/11/2026) ou "merge". */
  origem?: string;
  pr_corpo?: string | null;
  /** Mensagens de commit, nomes de arquivo e URLs das telas — só na PR aberta. */
  commits?: unknown;
  arquivos?: unknown;
  urls?: unknown;
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: chamado, error: chErr } = await admin
    .from("CHAMADO_SISTEMA")
    .select("id, status, assunto, descricao")
    .eq("numero", numero)
    .maybeSingle();
  if (chErr) return json({ error: chErr.message }, 500);
  if (!chamado) return json({ ok: true, concluido: false, motivo: "chamado não encontrado" });

  // Idempotência: o GitHub pode reentregar o mesmo evento, e um chamado
  // reaberto e concluído à mão não deve ganhar evento duplicado.
  if (chamado.status === "concluido") {
    return json({ ok: true, concluido: true, motivo: "já estava concluído" });
  }
  // Esta PR já concluiu o chamado antes (na abertura) e ele foi reaberto:
  // o merge (ou a PR reaberta) não passa por cima da reabertura.
  const { data: jaConcluiu } = await admin
    .from("CHAMADO_SISTEMA_EVENTO")
    .select("chamado_id")
    .eq("chamado_id", chamado.id)
    .eq("meta->>pr_url", prUrl)
    .in("meta->>origem", ["pr_aberta", "merge"])
    .limit(1);
  if (jaConcluiu && jaConcluiu.length > 0) {
    return json({ ok: true, concluido: false, motivo: "esta PR já concluiu o chamado antes; ele foi reaberto depois" });
  }

  const autorId = await perfilDoLoginGithub(admin, prAutorGithub);
  if (!autorId) return json({ ok: true, concluido: false, motivo: "autor do GitHub não mapeado" });

  const { error: upErr } = await admin
    .from("CHAMADO_SISTEMA")
    .update({ status: "concluido" })
    .eq("id", chamado.id);
  if (upErr) return json({ error: upErr.message }, 500);

  const metricas = [
    prCommits !== null && `${prCommits} ${prCommits === 1 ? "commit" : "commits"}`,
    prLinhasAdicionadas !== null && `${prLinhasAdicionadas} linhas adicionadas`,
    prArquivosAlterados !== null && `${prArquivosAlterados} ${prArquivosAlterados === 1 ? "arquivo alterado" : "arquivos alterados"}`,
  ].filter(Boolean).join(" · ");

  const { error: insErr } = await admin.from("CHAMADO_SISTEMA_EVENTO").insert({
    chamado_id: chamado.id,
    autor_id: autorId,
    tipo: "evento",
    texto: `Chamado concluído automaticamente — PR${prNumero !== null ? ` #${prNumero}` : ""} ${origem === "pr_aberta" ? "aberta" : "mergeada"}: ${prTitulo || prUrl}${metricas ? ` — ${metricas}` : ""} — ${prUrl}`,
    meta: {
      canal: "github", origem, pr_numero: prNumero, pr_url: prUrl,
      pr_titulo: prTitulo, pr_autor_github: prAutorGithub, pr_commits: prCommits,
      pr_linhas_adicionadas: prLinhasAdicionadas, pr_arquivos_alterados: prArquivosAlterados,
    },
  });
  // Status já mudou; um erro no histórico não justifica desfazer a conclusão.
  if (insErr) console.error("Falha ao registrar evento de conclusão:", insErr.message);

  // Resumo para o solicitante, no chat (comentário do dev). Só na PR aberta:
  // é quando o workflow manda commits, arquivos e URLs. Best-effort.
  let resumoGravado = false;
  if (origem === "pr_aberta") {
    const entrada: EntradaResumo = {
      numero, assunto: chamado.assunto ?? "", descricao: chamado.descricao ?? null,
      prTitulo, prCorpo: body.pr_corpo ?? null,
      commits: listaDeTextos(body.commits, MAX_COMMITS),
      arquivos: listaDeTextos(body.arquivos, MAX_ARQUIVOS),
      urls: urlsValidas(body.urls),
    };
    const ia = await resumirComIa(montarPromptResumo(entrada));
    const resumo = (ia && limparResumoIa(ia)) || resumoSemIa(entrada);
    const { error: resErr } = await admin.from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: chamado.id,
      autor_id: autorId,
      tipo: "comentario",
      texto: montarMensagemResumo(resumo, entrada.urls),
      meta: { canal: "github", origem: "resumo_pr", pr_url: prUrl, pr_numero: prNumero, ia: !!ia, urls: entrada.urls },
    });
    if (resErr) console.error("Falha ao gravar o resumo no chat:", resErr.message);
    else resumoGravado = true;
  }

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

  return json({ ok: true, concluido: true, origem, resumo: resumoGravado });
});
