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
export function limparResposta(bruto: string): string {
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
  return cortar(texto);
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
