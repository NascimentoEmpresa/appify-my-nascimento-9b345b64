// Arquivo: supabase/functions/_shared/demissao-relato-ia.ts
//
// Relatório de Demissões › "Motivos do relato (I.A)" (05/11/2026, Pablo: o
// texto livre "Relate abaixo o motivo da solicitação de demissão" diz a mesma
// coisa de jeitos diferentes — "colaborador quis sair", "pediu pra sair",
// "precisava sair" — e o relatório tem que juntar isso num motivo só).
//
// Parte pura, sem Deno nem fetch: a Edge demissao-relato-ia monta o prompt e
// lê a resposta por aqui, e o Vitest prova as regras. A LISTA de categorias é
// FECHADA de propósito: categoria livre da I.A viraria "Pediu pra sair" num
// lote e "Pedido do colaborador" no outro, e o agrupamento voltaria ao ponto
// de partida. Resposta fora da lista cai em "Outro".
//
// Mudar a lista: o relatório agrupa pelo TEXTO gravado em
// SISTEMA_DEMISSAO_RELATO_IA.categoria — renomear uma categoria aqui deixa as
// antigas com o nome velho. Para reclassificar tudo, apague as linhas da
// tabela (a tela reprocessa as pendentes sozinha).

export const CATEGORIAS_RELATO = [
  "Pediu para sair (sem detalhar)",
  "Proposta de outro emprego",
  "Insatisfação salarial / benefícios",
  "Insatisfação com função, escala ou ambiente",
  "Conflito com colegas ou liderança",
  "Problemas pessoais / familiares",
  "Problemas de saúde",
  "Mudança de cidade / distância / transporte",
  "Estudos",
  "Aposentadoria",
  "Faltas e atrasos",
  "Abandono de emprego",
  "Baixo desempenho",
  "Comportamento / indisciplina / falta grave",
  "Não se adaptou (experiência)",
  "Fim do contrato / posto / redução de quadro",
  "Outro",
] as const;
export type CategoriaRelato = (typeof CATEGORIAS_RELATO)[number];

/** Relato curto demais para a I.A dizer algo — não gasta token. */
export const CATEGORIA_SEM_RELATO = "Sem relato";
export const RELATO_MIN_IA = 8;
/** Quantos relatos vão num pedido só (uma chamada de I.A por lote). */
export const LOTE_IA = 25;
const MAX_RELATO = 600;

export interface RelatoPendente {
  id: number;
  relato: string | null;
  motivo_solicitacao?: string | null;
  motivo_pedido?: string | null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const chave = (s: string) => semAcento(s).replace(/[^a-z0-9]+/g, " ").trim();
const POR_CHAVE = new Map(CATEGORIAS_RELATO.map((c) => [chave(c), c] as const));

/** Texto da I.A → categoria da lista (tolera acento/caixa/pontuação; fora dela → "Outro"). */
export function normalizarCategoria(v: unknown): CategoriaRelato {
  const k = chave(String(v ?? ""));
  if (!k) return "Outro";
  const exata = POR_CHAVE.get(k);
  if (exata) return exata;
  // A I.A às vezes devolve só o começo ("Proposta de outro emprego." / "Problemas de saude").
  // Só aceita o começo quando ele aponta para UMA categoria ("Problemas" serve para duas → "Outro").
  if (k.length >= 6) {
    const comeco = [...POR_CHAVE].filter(([kc]) => kc.startsWith(k));
    if (comeco.length === 1) return comeco[0][1];
  }
  for (const [kc, c] of POR_CHAVE) if (k.startsWith(kc + " ")) return c;
  return "Outro";
}

/** Relato limpo como a I.A vai ler (uma linha, cortado). */
export const limparRelato = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_RELATO);

/** Separa o que precisa de I.A do que já sai como "Sem relato". */
export function separarParaIA(itens: RelatoPendente[]): { ia: RelatoPendente[]; semRelato: number[] } {
  const ia: RelatoPendente[] = [];
  const semRelato: number[] = [];
  for (const it of itens) {
    if (limparRelato(it.relato).length < RELATO_MIN_IA) semRelato.push(it.id);
    else ia.push(it);
  }
  return { ia, semRelato };
}

export const SYSTEM_PROMPT = [
  "Você classifica relatos de solicitações de demissão de uma empresa de terceirização (limpeza, portaria, vigilância, manutenção).",
  "Cada relato foi escrito pelo encarregado e diz POR QUE o colaborador está saindo. Textos diferentes com o mesmo sentido",
  "(\"colaborador quis sair\", \"pediu pra sair\", \"precisava sair\") recebem a MESMA categoria.",
  "Use EXATAMENTE um destes nomes de categoria, copiado letra por letra:",
  ...CATEGORIAS_RELATO.map((c) => `- ${c}`),
  "Regras: o motivo REAL descrito no relato vale mais que o campo de lista. \"Pediu para sair (sem detalhar)\" só quando o relato",
  "diz que a pessoa quis sair sem dizer por quê. Faltas repetidas sem justificar = \"Faltas e atrasos\"; sumiu e não voltou =",
  "\"Abandono de emprego\". Fim de posto, contrato encerrado ou corte de vagas = \"Fim do contrato / posto / redução de quadro\".",
  "Responda SOMENTE com JSON no formato {\"itens\":[{\"id\":123,\"categoria\":\"...\"}]}, um item por relato recebido, sem comentários.",
].join("\n");

export function montarPrompt(itens: RelatoPendente[]): string {
  const linhas = itens.map((it) => JSON.stringify({
    id: it.id,
    motivo_lista: [it.motivo_solicitacao, it.motivo_pedido].filter(Boolean).join(" / ") || null,
    relato: limparRelato(it.relato),
  }));
  return `Classifique os ${itens.length} relatos abaixo (um JSON por linha):\n${linhas.join("\n")}`;
}

/**
 * Resposta da I.A → {id → categoria}. Aceita o JSON cru, dentro de ```json```,
 * ou com texto em volta; ignora id que não foi pedido. Quem não veio na
 * resposta fica de fora (continua pendente e entra no próximo lote).
 */
export function lerResposta(texto: string, idsPedidos: number[]): Map<number, CategoriaRelato> {
  const saida = new Map<number, CategoriaRelato>();
  const pedidos = new Set(idsPedidos);
  const bruto = String(texto ?? "");
  const ini = bruto.indexOf("{");
  const fim = bruto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return saida;
  let dados: unknown;
  try { dados = JSON.parse(bruto.slice(ini, fim + 1)); } catch { return saida; }
  const itens = Array.isArray((dados as { itens?: unknown })?.itens) ? (dados as { itens: unknown[] }).itens : [];
  for (const it of itens) {
    const id = Number((it as { id?: unknown })?.id);
    if (!Number.isFinite(id) || !pedidos.has(id) || saida.has(id)) continue;
    saida.set(id, normalizarCategoria((it as { categoria?: unknown })?.categoria));
  }
  return saida;
}
