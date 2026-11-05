// Arquivo: supabase/functions/_shared/hora-extra-justificativa.ts
//
// "Gerar mensagem" da justificativa da Hora Extra (03/11/2026, Pablo: "só um
// botãozinho de Gerar mensagem"). Parte pura, sem Deno nem fetch: a Edge
// hora-extra-justificativa-ia monta o prompt e limpa a resposta por aqui, e a
// tela (NovaSolicitacaoDialog) usa o mesmo arquivo para o texto por modelo
// quando a I.A falha — falha da I.A não pode deixar o botão sem resposta.
//
// Tom pedido: adiantar as demandas para manter tudo organizado e em dia,
// citando o que vai ser desenvolvido. 2 a 4 frases, cabendo nos 500
// caracteres da textarea.
//
// Modo "conclusao" (04/11/2026, Pablo: "esse mesmo botão tem que ter quando
// for concluir a H.E"): o mesmo botão no "4. Resumo e observações" do modal
// de conclusão. Escreve o que FOI feito, a partir das PRs validadas na tabela
// (chamado, título, % concluído, linhas/commits) e das horas realizadas,
// dentro dos 1000 caracteres daquele campo. Mesma Edge, mesmo provedor, mesmo
// plano B por modelo — só o prompt e o limite mudam.

export const LIMITE_JUSTIFICATIVA = 500;

export interface ChamadoJustificativa {
  numero?: string | null;
  assunto?: string | null;
  setor?: string | null;
  prioridade?: string | null;
  percentual_previsto?: number | null;
  sem_chamado?: boolean;
}

const LABEL_PRIORIDADE: Record<string, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
  urgente: "Urgente",
};

const limpar = (v: unknown, max = 200) =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** No máximo 10 chamados, cada campo cortado: o corpo vem do navegador. */
export function normalizarChamados(lista: unknown): ChamadoJustificativa[] {
  if (!Array.isArray(lista)) return [];
  return lista.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const c = item as Record<string, unknown>;
    const pct = Number(c.percentual_previsto);
    const linha: ChamadoJustificativa = {
      numero: limpar(c.numero, 30) || null,
      assunto: limpar(c.assunto) || null,
      setor: limpar(c.setor, 80) || null,
      prioridade: limpar(c.prioridade, 20) || null,
      percentual_previsto: Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null,
      sem_chamado: c.sem_chamado === true,
    };
    return linha.assunto || linha.numero || linha.sem_chamado ? [linha] : [];
  });
}

export const SYSTEM_PROMPT =
  "Você escreve a justificativa de um pedido de hora extra de um desenvolvedor do time de Sistemas " +
  "de uma empresa brasileira. Escreva em português do Brasil, primeira pessoa do plural ou impessoal, " +
  "tom profissional e direto. Regras: de 2 a 4 frases; no máximo 450 caracteres; texto corrido, sem " +
  "listas, sem markdown, sem aspas, sem saudação nem assinatura. A ideia central é antecipar as " +
  "demandas para manter tudo organizado e em dia, citando de forma resumida o que será desenvolvido " +
  "em cada chamado (pode citar o número SIS e o setor que pediu). Não invente prazos, datas, valores " +
  "nem nomes de pessoas. Responda só com o texto da justificativa.";

function descreverChamado(c: ChamadoJustificativa): string {
  if (c.sem_chamado) return "- Ajuste emergencial em produção, sem chamado aberto";
  const partes = [`- ${c.numero ? `${c.numero}: ` : ""}${c.assunto ?? "(sem título)"}`];
  if (c.setor) partes.push(`solicitado por ${c.setor}`);
  if (c.prioridade) partes.push(`prioridade ${LABEL_PRIORIDADE[c.prioridade] ?? c.prioridade}`);
  if (c.percentual_previsto != null) partes.push(`expectativa de conclusão ${c.percentual_previsto}%`);
  return partes.join(" · ");
}

export function montarPrompt(chamados: ChamadoJustificativa[]): string {
  return [
    "Chamados que serão trabalhados durante a hora extra:",
    ...chamados.map(descreverChamado),
    "",
    "Exemplo do tom esperado: Antecipar demandas para que se mantenha organizado e tudo em dia, " +
      "também desenvolvendo o novo sistema do X, submódulo Y e desenvolvendo o que foi solicitado.",
    "",
    "Escreva a justificativa.",
  ].join("\n");
}

/** Corta no limite sem deixar palavra pela metade. */
function cortar(texto: string, limite = LIMITE_JUSTIFICATIVA): string {
  if (texto.length <= limite) return texto;
  const ate = texto.slice(0, limite);
  const fimFrase = ate.lastIndexOf(". ");
  if (fimFrase > limite * 0.5) return ate.slice(0, fimFrase + 1);
  const espaco = ate.lastIndexOf(" ");
  return `${ate.slice(0, espaco > 0 ? espaco : limite - 1).replace(/[,;:\s]+$/, "")}.`;
}

/** Tira cerca, markdown, aspas e quebra de linha que a I.A às vezes devolve. */
export function limparResposta(bruto: string, limite = LIMITE_JUSTIFICATIVA): string {
  const texto = String(bruto ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[a-z]*\n?|```/gi, "")
    .replace(/[*_#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“'](.*)["”']$/, "$1")
    .replace(/^\s*justificativa\s*:\s*/i, "")
    .trim();
  return cortar(texto, limite);
}

/** Plano B, sem I.A: texto por modelo a partir dos títulos da tela. */
export function gerarJustificativaModelo(chamados: ChamadoJustificativa[]): string {
  const lista = chamados.filter((c) => c.assunto || c.numero || c.sem_chamado);
  if (!lista.length) return "";
  if (lista.some((c) => c.sem_chamado)) {
    return cortar(
      "Hora extra para tratar um ajuste emergencial em produção, que precisa ser resolvido de imediato " +
        "para não impactar a operação. Os detalhes do que foi feito serão registrados na conclusão da HE.",
    );
  }
  const itens = lista.map((c) => {
    // Título como está na tela: baixar a inicial estragava nome próprio
    // ("convenções Coletivas").
    const titulo = (c.assunto ?? "").replace(/[.;\s]+$/, "");
    const ref = c.numero ? ` (${c.numero}${c.setor ? `, ${c.setor}` : ""})` : c.setor ? ` (${c.setor})` : "";
    return `${titulo || "o chamado"}${ref}`;
  });
  const juntar = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join("; ")} e ${xs[xs.length - 1]}` : xs[0]);
  const urgente = lista.some((c) => ["alta", "critica", "urgente"].includes(String(c.prioridade)));
  const frases = [
    "Antecipar as demandas em andamento para manter tudo organizado e em dia.",
    `Durante a hora extra, ${lista.length > 1 ? "serão desenvolvidos os chamados" : "será desenvolvido o chamado"}: ${juntar(itens)}.`,
    urgente
      ? "São demandas de prioridade alta, e adiantá-las evita atraso nas entregas aos setores solicitantes."
      : "Adiantar essas entregas evita acúmulo e atraso para os setores solicitantes.",
  ];
  let texto = frases.join(" ");
  // Muitos chamados estouram o limite: cai para a contagem, sem a lista.
  if (texto.length > LIMITE_JUSTIFICATIVA) {
    frases[1] = `Durante a hora extra, serão desenvolvidos ${lista.length} chamados (${lista
      .map((c) => c.numero)
      .filter(Boolean)
      .join(", ")}), conforme solicitado pelos setores.`;
    texto = frases.join(" ");
  }
  return cortar(texto);
}

// ---------------------------------------------------------------------------
// Modo "conclusao": resumo do que foi realizado na HE.
// ---------------------------------------------------------------------------

export const LIMITE_RESUMO_CONCLUSAO = 1000;

export interface ChamadoConclusao extends ChamadoJustificativa {
  percentual_concluido?: number | null;
  pr_numero?: number | null;
  pr_titulo?: string | null;
  pr_linhas_adicionadas?: number | null;
  pr_commits?: number | null;
  adicional?: boolean;
}

export interface DadosConclusao {
  /** "normal" | "emergencial". */
  tipo?: string | null;
  /** Total de HE já formatado pela tela, ex. "2h 30min". */
  total_he?: string | null;
  /** Faixa da HE, ex. "17:18 - 19:48". */
  horario?: string | null;
  chamados: ChamadoConclusao[];
}

const inteiro = (v: unknown, max: number): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : null;
};

/** Corpo do navegador: no máximo 15 linhas, campos cortados. */
export function normalizarConclusao(corpo: unknown): DadosConclusao {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const lista = Array.isArray(c.chamados) ? c.chamados.slice(0, 15) : [];
  const chamados = lista.flatMap((item): ChamadoConclusao[] => {
    if (!item || typeof item !== "object") return [];
    const l = item as Record<string, unknown>;
    const linha: ChamadoConclusao = {
      numero: limpar(l.numero, 30) || null,
      assunto: limpar(l.assunto) || null,
      setor: limpar(l.setor, 80) || null,
      sem_chamado: l.sem_chamado === true,
      adicional: l.adicional === true,
      percentual_concluido: inteiro(l.percentual_concluido, 100),
      pr_numero: inteiro(l.pr_numero, 10_000_000),
      pr_titulo: limpar(l.pr_titulo) || null,
      pr_linhas_adicionadas: inteiro(l.pr_linhas_adicionadas, 10_000_000),
      pr_commits: inteiro(l.pr_commits, 100_000),
    };
    return linha.assunto || linha.numero || linha.pr_titulo || linha.sem_chamado ? [linha] : [];
  });
  return {
    tipo: limpar(c.tipo, 20) || null,
    total_he: limpar(c.total_he, 20) || null,
    horario: limpar(c.horario, 20) || null,
    chamados,
  };
}

export const SYSTEM_PROMPT_CONCLUSAO =
  "Você escreve o resumo da conclusão de uma hora extra de um desenvolvedor do time de Sistemas " +
  "de uma empresa brasileira. Escreva em português do Brasil, primeira pessoa do plural ou impessoal, " +
  "tom profissional e direto. Regras: de 2 a 5 frases; no máximo 800 caracteres; texto corrido, sem " +
  "listas, sem markdown, sem aspas, sem saudação nem assinatura. Diga de forma resumida o que FOI " +
  "realizado em cada chamado (pode citar o número SIS, o setor e a PR) e quanto tempo de hora extra foi " +
  "feito. Se algum chamado não chegou a 100%, diga que ficou parcial e segue em andamento; se todos " +
  "chegaram a 100%, diga que não houve impedimentos. Não invente prazos, datas, valores, nomes de " +
  "pessoas nem detalhes técnicos que não estejam nos dados. Responda só com o texto do resumo.";

function descreverRealizado(c: ChamadoConclusao): string {
  const titulo = c.sem_chamado
    ? `Sem chamado: ${c.pr_titulo ?? c.assunto ?? "ajuste emergencial"}`
    : `${c.numero ? `${c.numero}: ` : ""}${c.assunto ?? c.pr_titulo ?? "(sem título)"}`;
  const partes = [`- ${titulo}`];
  if (c.setor) partes.push(`solicitado por ${c.setor}`);
  if (c.adicional) partes.push("chamado adicional, fora do planejado");
  if (c.pr_numero) partes.push(`PR #${c.pr_numero}${c.pr_titulo && !c.sem_chamado ? ` (${c.pr_titulo})` : ""}`);
  if (c.pr_commits != null) partes.push(`${c.pr_commits} commits`);
  if (c.pr_linhas_adicionadas != null) partes.push(`${c.pr_linhas_adicionadas} linhas adicionadas`);
  if (c.percentual_concluido != null) partes.push(`${c.percentual_concluido}% concluído`);
  return partes.join(" · ");
}

export function montarPromptConclusao(dados: DadosConclusao): string {
  return [
    `Hora extra ${dados.tipo === "emergencial" ? "emergencial" : "normal"}` +
      `${dados.total_he ? `, total de ${dados.total_he}` : ""}${dados.horario ? ` (das ${dados.horario.replace(" - ", " às ")})` : ""}.`,
    "Chamados realizados durante a hora extra:",
    ...dados.chamados.map(descreverRealizado),
    "",
    "Exemplo do tom esperado: Durante a hora extra foram desenvolvidos o novo cadastro do X (SIS-...) e os " +
      "ajustes do submódulo Y, entregues nas PRs #... e #.... Não houve impedimentos.",
    "",
    "Escreva o resumo da conclusão.",
  ].join("\n");
}

/** Plano B, sem I.A: resumo por modelo a partir das linhas da tabela. */
export function gerarResumoConclusaoModelo(dados: DadosConclusao): string {
  const lista = dados.chamados.filter((c) => c.assunto || c.numero || c.pr_titulo || c.sem_chamado);
  if (!lista.length) return "";
  const itens = lista.map((c) => {
    const titulo = (c.sem_chamado ? c.pr_titulo ?? c.assunto ?? "ajuste emergencial sem chamado" : c.assunto ?? c.pr_titulo ?? "o chamado")
      .replace(/[.;\s]+$/, "");
    const refs = [c.numero, c.pr_numero ? `PR #${c.pr_numero}` : null].filter(Boolean).join(", ");
    return `${titulo}${refs ? ` (${refs})` : ""}`;
  });
  const juntar = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join("; ")} e ${xs[xs.length - 1]}` : xs[0]);
  const parciais = lista.filter((c) => c.percentual_concluido != null && c.percentual_concluido < 100);
  const abertura = `Durante a hora extra${dados.total_he ? ` (${dados.total_he}${dados.horario ? `, das ${dados.horario.replace(" - ", " às ")}` : ""})` : ""}`;
  const frases = [
    `${abertura}, ${lista.length > 1 ? "foram realizados os chamados" : "foi realizado o chamado"}: ${juntar(itens)}.`,
    parciais.length
      ? `${parciais.length > 1 ? "Os chamados" : "O chamado"} ${parciais
          .map((c) => c.numero || (c.pr_numero ? `da PR #${c.pr_numero}` : "sem chamado"))
          .join(", ")} ${parciais.length > 1 ? "ficaram parciais e seguem" : "ficou parcial e segue"} em andamento.`
      : "As entregas foram concluídas e não houve impedimentos.",
  ];
  let texto = frases.join(" ");
  if (texto.length > LIMITE_RESUMO_CONCLUSAO) {
    const refs = lista.map((c) => c.numero || (c.pr_numero ? `PR #${c.pr_numero}` : "")).filter(Boolean).join(", ");
    frases[0] = `${abertura}, foram realizados ${lista.length} chamados (${refs}).`;
    texto = frases.join(" ");
  }
  return cortar(texto, LIMITE_RESUMO_CONCLUSAO);
}
