// =====================================================================
// contexto-resumo-pr.cjs — o que a I.A lê para escrever o resumo do chamado
// (13/11/2026)
//
// Pedido do Pablo: "a i.a tem que ler os commits e a PR inteira depois do
// merge, pq enquanto a PR tá no github ela ainda pode ter mais commits".
// O SIS-2026-0854 mostrou o problema: a PR #1250 abriu às 23:49 com só os
// commits do Mural, o do chamado subiu às 23:52, e a I.A — que recebia só a
// 1ª linha dos commits e o nome dos arquivos — reescreveu o PEDIDO como se
// fosse a entrega ("opção Encerramento de contrato no motivo", quando o
// feito foi uma pergunta Sim/Não à parte).
//
// Agora o resumo sai no MERGE (job concluir-chamado do
// chamado_concluir_no_merge.yml), com:
//   · só os commits DESTE chamado — a PR da branch pessoal junta vários
//     ("[SEM-CHAMADO] Mural…" + "SIS-2026-0854: …"); merge commits saem;
//   · a mensagem INTEIRA de cada commit (o corpo explica o que mudou);
//   · o código alterado nesses commits (o patch que a API do GitHub manda),
//     telas primeiro, com teto por arquivo e no total.
//
// Só manipula TEXTO que veio da API — nada do código da PR é executado (o
// workflow roda em pull_request_target, com secrets).
// Testado em src/test/chamado-resumo-pr.test.ts.
// =====================================================================

const MAX_COMMITS = 40;
const MAX_MENSAGEM = 2000;
const MAX_TOTAL = 40000;
const MAX_POR_ARQUIVO = 6000;

const RE_CHAMADO = /^SIS-\d{4}-\d+/i;
const RE_OUTRO_TIPO = /^\[SEM-CHAMADO\]/i;

/**
 * commits: [{ sha, mensagem, pais }] (pais = quantos pais o commit tem).
 * Devolve os commits do chamado `numero`. Se nenhum commit traz o número
 * (dev que não prefixou), ficam os que não são de outro chamado nem
 * [SEM-CHAMADO] — e, se nem isso sobrar, todos (melhor ler a mais que nada).
 */
function commitsDoChamado(commits, numero) {
  const alvo = String(numero || "").toUpperCase();
  const simples = (commits || []).filter((c) => c && (c.pais ?? 1) <= 1);
  const primeira = (c) => String(c.mensagem || "").split("\n")[0].trim();
  const doChamado = simples.filter((c) => (primeira(c).match(RE_CHAMADO)?.[0] || "").toUpperCase() === alvo);
  const escolhidos = doChamado.length
    ? doChamado
    : simples.filter((c) => !RE_CHAMADO.test(primeira(c)) && !RE_OUTRO_TIPO.test(primeira(c)));
  return (escolhidos.length ? escolhidos : simples).slice(0, MAX_COMMITS);
}

/** Mensagem inteira, sem a assinatura de coautoria e sem linhas em branco sobrando. */
function mensagemLimpa(m) {
  return String(m || "")
    .replace(/^Co-Authored-By:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_MENSAGEM);
}

/** Arquivo que não ajuda a descrever a entrega (gerado, lock, teste, binário). */
function ehRuido(nome) {
  return /(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml)$/.test(nome)
    || /src\/integrations\/supabase\/types\.ts$/.test(nome)
    || /(^|\/)src\/test\//.test(nome)
    || /\.(png|jpe?g|gif|webp|svg|ico|pdf|xlsx?|zip|woff2?)$/i.test(nome);
}

/** Telas primeiro (é o que o solicitante vê), depois regras, banco, o resto. */
function prioridade(nome) {
  if (/^src\/(pages|components)\//.test(nome)) return 0;
  if (/^src\//.test(nome)) return 1;
  if (/^supabase\/migrations\//.test(nome)) return 2;
  if (/^supabase\/functions\//.test(nome)) return 3;
  return 4;
}

/**
 * arquivos: [{ nome, patch }] — um por arquivo por commit (o mesmo arquivo
 * pode vir de vários commits; os trechos são juntados). Devolve o texto
 * "### arquivo\n<patch>" com tetos por arquivo e no total.
 */
function montarAlteracoes(arquivos, maxTotal = MAX_TOTAL, maxPorArquivo = MAX_POR_ARQUIVO) {
  const porArquivo = new Map();
  for (const a of arquivos || []) {
    const nome = String(a?.nome || "").trim();
    if (!nome || ehRuido(nome)) continue;
    const patch = String(a?.patch || "");
    porArquivo.set(nome, (porArquivo.get(nome) ? `${porArquivo.get(nome)}\n` : "") + patch);
  }
  const ordem = [...porArquivo.keys()].sort((x, y) => prioridade(x) - prioridade(y) || x.localeCompare(y));
  const partes = [];
  let total = 0;
  for (const nome of ordem) {
    let patch = porArquivo.get(nome) || "(sem trecho: arquivo grande ou binário)";
    if (patch.length > maxPorArquivo) patch = `${patch.slice(0, maxPorArquivo)}\n[… cortado]`;
    const bloco = `### ${nome}\n${patch}`;
    if (total + bloco.length > maxTotal) {
      partes.push(`[… mais ${ordem.length - partes.length} arquivo(s) fora do limite]`);
      break;
    }
    partes.push(bloco);
    total += bloco.length + 2;
  }
  return partes.join("\n\n");
}

module.exports = { commitsDoChamado, mensagemLimpa, montarAlteracoes, ehRuido, MAX_TOTAL };
