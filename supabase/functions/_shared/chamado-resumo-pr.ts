// Arquivo: supabase/functions/_shared/chamado-resumo-pr.ts
//
// RESUMO DA ENTREGA NO CHAT DO CHAMADO (12/11/2026, pedido do Pablo:
// "quando o desenvolvedor abrir um PR conclua o chamado automaticamente e
// também coloque um resumo bom do que foi feito no chat pro solicitante ver,
// um resumo simples mas completo do que foi desenvolvido e as URLS pra ele
// acessar").
//
// Lógica pura (prompt, saneamento da entrada e montagem da mensagem), sem
// Deno nem Supabase — testada em src/test/chamado-resumo-pr.test.ts. A Edge
// chamado-concluir-pr só chama a I.A e grava a mensagem.
//
// As URLs NÃO vêm da I.A: o workflow calcula pelas rotas do App.tsx
// (.github/scripts/rotas-da-pr.cjs) e elas entram aqui como lista fechada.
// A I.A só escreve o texto — assim nenhum link inventado chega ao solicitante.

export const URL_APP = "https://app.grpnascimento.com.br";
export const MAX_ARQUIVOS = 150;
export const MAX_COMMITS = 60;
export const MAX_URLS = 8;
export const MAX_RESUMO_CHARS = 2500;
/** Teto do código alterado que vai para a I.A (o CI já corta em 40 mil). */
export const MAX_ALTERACOES_CHARS = 45000;
/** Mensagem inteira de um commit (o corpo explica o que mudou). */
export const MAX_COMMIT_CHARS = 2000;

// 13/11/2026: o resumo passou a sair no MERGE, não mais na abertura da PR.
// No SIS-2026-0854 a PR abriu antes do commit do chamado subir, e a I.A —
// que só via a 1ª linha dos commits e o nome dos arquivos — reescreveu o
// pedido como se fosse a entrega. Agora ela recebe, da PR já mergeada, só os
// commits deste chamado, a mensagem inteira de cada um e o código alterado
// (.github/scripts/contexto-resumo-pr.cjs).
export interface EntradaResumo {
  numero: string;
  assunto: string;
  descricao: string | null;
  prTitulo: string;
  prCorpo: string | null;
  commits: string[];
  arquivos: string[];
  urls: string[];
  /** Trechos do código alterado ("### arquivo\n<diff>"), dos commits do chamado. */
  alteracoes?: string | null;
}

const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Lista vinda do CI → só textos, sem vazio, sem repetição, limitada. */
export function listaDeTextos(v: unknown, max: number, maxChars = 300): string[] {
  const vistos = new Set<string>();
  for (const item of Array.isArray(v) ? v : []) {
    const t = texto(item, maxChars);
    if (t && !vistos.has(t)) vistos.add(t);
    if (vistos.size >= max) break;
  }
  return [...vistos];
}

/** Só links do próprio ERP — nada de URL arbitrária vinda do CI. */
export function urlsValidas(v: unknown): string[] {
  return listaDeTextos(v, 50, 500)
    .filter((u) => u.startsWith(`${URL_APP}/`) && !/[\s<>"']/.test(u))
    .slice(0, MAX_URLS);
}

/** Bloco que o workflow injeta no corpo da PR — repete o chamado, não ajuda o resumo. */
export function limparCorpoPr(corpo: string | null | undefined): string {
  return String(corpo ?? "")
    .replace(/<!-- chamado:auto:start -->[\s\S]*?<!-- chamado:auto:end -->/g, "")
    .replace(/🤖 Generated with \[Claude Code\]\([^)]*\)/g, "")
    .trim()
    .slice(0, 4000);
}

export const SYSTEM_PROMPT_RESUMO = `Você escreve, em português do Brasil, a mensagem que o SOLICITANTE de um chamado de sistemas recebe quando o desenvolvimento fica pronto.
Quem lê NÃO é programador: escreva para o usuário do sistema (ERP do Grupo Nascimento).

FORMATO (texto simples, sem markdown, sem asteriscos, sem títulos com #):
- Primeira linha: uma frase dizendo o que foi resolvido.
- Depois, "O que mudou:" e de 2 a 6 itens começando com "- ", cada um com uma mudança que a pessoa vai perceber na tela (o que aparece, onde clicar, o que passou a acontecer).
- Se houver algo que a pessoa precisa fazer ou saber para usar (ex.: um campo novo obrigatório, um botão que mudou de lugar), um item a mais em "Como usar:".

REGRAS:
1. Descreva o que FOI FEITO, e a prova disso são as mensagens de commit e o código alterado. O pedido do solicitante é só contexto: não repita o pedido como se tivesse sido entregue. Use o código para dizer exatamente o que a pessoa vê agora (o texto da pergunta, dos botões, dos campos, das abas, se é obrigatório). Não invente funcionalidade.
2. Sem nome de arquivo, função, tabela, migration, branch ou termo técnico (React, SQL, RPC, Edge, commit, PR). Traduza para o que a pessoa vê.
3. Não escreva URLs nem links — eles são acrescentados depois, automaticamente.
4. Não fale de prazo, de aprovação, de teste nem de "publicação".
5. No máximo 1.200 caracteres.`;

export function montarPromptResumo(e: EntradaResumo): { role: string; content: string }[] {
  const dados = [
    `CHAMADO ${e.numero}: ${texto(e.assunto, 200)}`,
    `PEDIDO DO SOLICITANTE:\n${texto(e.descricao, 3000) || "—"}`,
    `TÍTULO DA ENTREGA: ${texto(e.prTitulo, 300)}`,
    `DESCRIÇÃO DA ENTREGA:\n${limparCorpoPr(e.prCorpo) || "—"}`,
    `MENSAGENS DE COMMIT:\n${e.commits.map((c) => `- ${c.replace(/\n/g, "\n  ")}`).join("\n") || "—"}`,
    `ARQUIVOS ALTERADOS (só para você entender a área; não cite):\n${e.arquivos.join("\n") || "—"}`,
    `CÓDIGO ALTERADO (linhas com + entraram, com - saíram; leia para saber o que mudou na tela; não cite):\n${texto(e.alteracoes, MAX_ALTERACOES_CHARS) || "—"}`,
  ].join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT_RESUMO },
    { role: "user", content: dados },
  ];
}

/** Tira markdown e qualquer link que a I.A tenha escrito mesmo assim. */
export function limparResumoIa(t: string): string {
  return t
    .replace(/\r/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_RESUMO_CHARS);
}

/** Sem I.A (sem chave, cota estourada): o título da PR e os commits, como vieram. */
export function resumoSemIa(e: EntradaResumo): string {
  const itens = e.commits
    .map((c) => c.split("\n")[0].replace(/^\[SEM-CHAMADO\]:\s*|^SIS-\d{4}-\d+:\s*/i, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const titulo = e.prTitulo.replace(/^SIS-\d{4}-\d+:\s*/i, "").trim() || e.assunto;
  return [`Desenvolvimento pronto: ${titulo}.`, ...(itens.length ? ["", "O que mudou:", ...itens.map((i) => `- ${i}`)] : [])].join("\n");
}

/** A mensagem que vai para o chat: cabeçalho, resumo e "Onde acessar". */
export function montarMensagemResumo(resumo: string, urls: string[]): string {
  const partes = ["✅ Seu chamado foi desenvolvido. Resumo do que foi feito:", "", resumo.trim()];
  if (urls.length) {
    partes.push("", urls.length === 1 ? "Onde acessar:" : "Onde acessar (telas alteradas):", ...urls.map((u) => `- ${u}`));
  }
  partes.push("", "Confira e, se estiver tudo certo, clique em Confirmar conclusão. Se não atendeu, use Reabrir chamado.");
  return partes.join("\n");
}
