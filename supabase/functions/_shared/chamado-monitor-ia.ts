// Arquivo: supabase/functions/_shared/chamado-monitor-ia.ts
//
// Avaliação da I.A sobre a QUALIDADE DA SOLICITAÇÃO de um Chamado de Sistemas,
// para a tela Monitoramento de Chamados (mig 20261115000100). Lógica pura —
// prompt, montagem do contexto e leitura da resposta —, testada pelo Vitest
// (src/test/chamado-monitor-ia.test.ts) sem Deno nem rede. Mesmo desenho do
// _shared/chamado-parecer-ia.ts.
//
// POR QUE EXISTE (13/11/2026, Pablo, olhando o ranking de 01/01 a 13/11):
// "essa i.a tá avaliando mal demais todo mundo, tem que avaliar melhor, pegar
// contexto das ideias, dos chamados e das explicações dos chamados... não tem
// ninguém com 9, mas a Fernanda merecia um 9, ela explica muito bem os
// chamados dela". Até aqui NÃO havia I.A: a nota era contagem de palavras-chave
// no navegador (src/lib/chamados/monitoramento.ts). Pedido de 1.000 caracteres
// com local, situação atual, regra esperada e PDF anexo tirava ~6, porque não
// usava "gostaria"/"objetivo"/"planilha"; média geral 5,2 e teto ~8.
//
// O QUE A I.A LÊ: título, tipo, módulo, impacto, urgência, usuários afetados,
// descrição inteira, observações, os NOMES dos anexos da abertura (ela não
// abre o arquivo — mas "detalhado no PDF anexo" com o PDF lá é evidência) e a
// conversa do chamado sem as notas internas, marcando quem é o solicitante.
// Esclarecimento bom do solicitante na conversa conta a favor; o dev ter
// precisado pedir o básico conta contra a clareza do pedido original.
//
// A ESCALA é calibrada no prompt com âncoras: pedido exemplar (um dev entende
// e executa sem perguntar nada) = 9 a 10 nos critérios de clareza. Os
// critérios de valor (reaproveitamento, trabalho manual, confiabilidade) não
// punem o pedido que não é sobre aquilo: 6–7 é o neutro de um pedido útil.
//
// O ÍNDICE (0–10) é feito no front, média ponderada destes critérios com o
// "Resultado após a implantação" (que vem da avaliação da entrega, não da
// I.A). Pesos em CRITERIOS_INDICE de src/lib/chamados/monitoramento.ts.

/** Critérios que a I.A dá nota — mesmas chaves de CRITERIOS_INDICE no front
 *  (menos "resultado", que é da entrega). */
export const CRITERIOS_IA = [
  "clareza_problema",
  "clareza_resultado",
  "descricao",
  "evidencias",
  "importancia",
  "aderencia",
  "reaproveitamento",
  "reducao_manual",
  "confiabilidade",
] as const;
export type CriterioIa = (typeof CRITERIOS_IA)[number];

export interface ChamadoParaMonitorIa {
  numero: string | null;
  assunto: string;
  tipo_solicitacao: string | null;
  descricao: string | null;
  observacoes_solicitante: string | null;
  categorias: string[] | null;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  impacto_trabalho: string | null;
  urgencia: string | null;
  afeta_usuarios: number | null;
  prioridade: string | null;
  status: string | null;
  setor: string | null;
  solicitante_id: string | null;
}

export interface EventoParaMonitorIa {
  tipo: string;
  texto: string | null;
  autor_id: string | null;
  created_at: string;
}

export interface AnexoParaMonitorIa {
  nome_arquivo: string | null;
  campo: string | null;
}

// Tetos de tamanho: o pedido inteiro cabe quase sempre (o maior visto tem
// ~6 mil caracteres); a conversa vai cortada do começo, que é o que esclarece
// o pedido. Mantém cada chamada em ~2–4 mil tokens.
const MAX_DESCRICAO = 7000;
const MAX_OBS = 1500;
const MAX_CONVERSA = 5000;
const MAX_MSG = 900;

export const SYSTEM_PROMPT_MONITOR = `Você avalia a QUALIDADE DE SOLICITAÇÕES de desenvolvimento abertas no ERP interno de uma empresa de serviços terceirizados (limpeza, portaria, manutenção) por funcionários de áreas como RH, Recrutamento, Controladoria, Licitações, Financeiro e Suprimentos. Quem lê o seu resultado é a gestão, para reconhecer quem faz bons pedidos.

Avalie o PEDIDO, não a entrega nem o desenvolvedor. Leia tudo: título, descrição inteira, observações, nomes dos anexos e a conversa. Entenda a IDEIA: o que a pessoa quer, por quê, e quanto isso ajuda a empresa.

Dê nota de 0 a 10 (pode usar uma casa decimal) para cada critério:
- clareza_problema: diz onde (módulo/tela/campo) e o que acontece hoje, ou qual necessidade existe.
- clareza_resultado: diz exatamente o que deve passar a acontecer (regra, comportamento, campos, fluxo).
- descricao: completude e organização do texto — passos, itens, regras, exceções, exemplos de dados reais. Tamanho só conta se for conteúdo útil.
- evidencias: prints, PDFs, planilhas, modelos, números de documentos/registros de exemplo. Os anexos você só vê pelo nome; "explicação detalhada no PDF anexo" com o anexo presente conta como evidência boa.
- importancia: impacto operacional real (trava trabalho? atrasa? quantas pessoas? dinheiro, prazo, obrigação legal?).
- aderencia: alinhamento aos objetivos da empresa — controle, gestão, caixa, conformidade, qualidade do serviço.
- reaproveitamento: o resultado serve a outros setores/telas ou é padrão reutilizável.
- reducao_manual: elimina retrabalho, digitação, planilha paralela, passos manuais.
- confiabilidade: deixa a informação mais correta, conferível ou rastreável.

CALIBRAGEM — use a escala inteira, sem avareza:
- 9 a 10: pedido exemplar. Um desenvolvedor entende e executa sem precisar perguntar nada: local exato, situação atual, comportamento esperado, regras e exemplos/anexos.
- 7 a 8: bom pedido, claro, com pequenas lacunas.
- 5 a 6: entendível, mas faltam informações importantes (onde, regra, exemplo).
- 3 a 4: vago, uma ou duas linhas, depende de adivinhação.
- 0 a 2: impossível entender o que se quer.
Nos critérios de valor (importancia, aderencia, reaproveitamento, reducao_manual, confiabilidade), um pedido útil comum fica em 6 a 7; acima disso só com ganho claro; NÃO puna com nota baixa um pedido que simplesmente não é sobre aquele assunto (ex.: correção de tela não precisa falar de planilha).
Se o desenvolvedor teve de pedir o básico na conversa, desconte na clareza; se o solicitante respondeu bem e completou o pedido, isso conta a favor da descrição.

Responda SOMENTE um JSON, sem texto fora dele:
{"criterios":{"clareza_problema":{"nota":0,"motivo":"..."},"clareza_resultado":{"nota":0,"motivo":"..."},"descricao":{"nota":0,"motivo":"..."},"evidencias":{"nota":0,"motivo":"..."},"importancia":{"nota":0,"motivo":"..."},"aderencia":{"nota":0,"motivo":"..."},"reaproveitamento":{"nota":0,"motivo":"..."},"reducao_manual":{"nota":0,"motivo":"..."},"confiabilidade":{"nota":0,"motivo":"..."}},"resumo":"uma frase sobre a qualidade do pedido e o valor da ideia"}
Cada "motivo" tem no máximo 160 caracteres, em português, citando o que existe (ou falta) no pedido.`;

const corta = (s: string | null | undefined, max: number) => {
  const t = String(s ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}… [cortado]` : t;
};

const IMPACTO: Record<string, string> = {
  impede: "impede o trabalho",
  atraso_significativo: "atrasa significativamente",
  atraso_leve: "atraso leve",
  nao_impacta: "não impacta",
};

/** Texto do usuário enviado à I.A. Determinístico: o hash dele decide se precisa reavaliar. */
export function montarPromptMonitor(c: ChamadoParaMonitorIa, eventos: EventoParaMonitorIa[], anexos: AnexoParaMonitorIa[]): string {
  const modulo = c.modulo_sistema === "outro" ? (c.modulo_sistema_outro || "outro") : (c.modulo_sistema || "não informado");
  const anexosAbertura = anexos.filter((a) => a.campo !== "interno").map((a) => a.nome_arquivo || "(sem nome)");
  const linhas: string[] = [
    `Chamado ${c.numero ?? ""} — setor do solicitante: ${c.setor || "não informado"}`,
    `Título: ${corta(c.assunto, 300)}`,
    `Tipo: ${c.tipo_solicitacao || "não informado"} · Módulo: ${modulo} · Prioridade: ${c.prioridade || "?"}`,
    `Impacto declarado: ${IMPACTO[c.impacto_trabalho ?? ""] ?? (c.impacto_trabalho || "não informado")} · Urgência: ${c.urgencia || "não informada"} · Usuários afetados: ${c.afeta_usuarios ?? "não informado"}`,
  ];
  if (c.categorias?.length) linhas.push(`Categorias marcadas: ${c.categorias.join(", ")}`);
  linhas.push("", "DESCRIÇÃO:", corta(c.descricao, MAX_DESCRICAO) || "(vazia)");
  if ((c.observacoes_solicitante ?? "").trim()) linhas.push("", "OBSERVAÇÕES DO SOLICITANTE:", corta(c.observacoes_solicitante, MAX_OBS));
  linhas.push("", `ANEXOS (${anexosAbertura.length}): ${anexosAbertura.length ? anexosAbertura.slice(0, 15).join("; ") : "nenhum"}`);

  const conversa = [...eventos]
    .filter((e) => (e.tipo === "comentario" || e.tipo === "solicitar_info") && (e.texto ?? "").trim())
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (conversa.length) {
    const partes: string[] = [];
    let total = 0;
    for (const e of conversa) {
      const quem = e.autor_id && e.autor_id === c.solicitante_id ? "SOLICITANTE" : "EQUIPE DE SISTEMAS";
      const rotulo = e.tipo === "solicitar_info" ? `${quem} (pedido de informação)` : quem;
      const msg = `- ${rotulo}: ${corta(e.texto, MAX_MSG)}`;
      if (total + msg.length > MAX_CONVERSA) { partes.push("- … [conversa cortada]"); break; }
      partes.push(msg); total += msg.length;
    }
    linhas.push("", `CONVERSA DO CHAMADO (${conversa.length} mensagens):`, ...partes);
  } else {
    linhas.push("", "CONVERSA DO CHAMADO: nenhuma mensagem.");
  }
  return linhas.join("\n");
}

export function extrairJsonMonitor(bruto: string): unknown | null {
  const t = String(bruto ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* segue */ }
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

export interface AvaliacaoMonitorIa {
  criterios: Record<CriterioIa, { nota: number; motivo: string }>;
  resumo: string;
}

/** Valida a resposta: os 9 critérios com nota 0–10 (uma casa). Faltou algum = inválida. */
export function validarAvaliacaoMonitor(bruto: unknown): AvaliacaoMonitorIa | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const cr = (o.criterios ?? {}) as Record<string, unknown>;
  const criterios = {} as AvaliacaoMonitorIa["criterios"];
  for (const k of CRITERIOS_IA) {
    const item = cr[k] as Record<string, unknown> | number | undefined;
    const notaBruta = typeof item === "object" && item ? item.nota : item;
    const n = typeof notaBruta === "string" ? Number(notaBruta.replace(",", ".")) : Number(notaBruta);
    if (notaBruta == null || notaBruta === "" || !Number.isFinite(n)) return null;
    const motivo = typeof item === "object" && item ? String(item.motivo ?? "").trim().slice(0, 240) : "";
    criterios[k] = { nota: Math.round(Math.min(10, Math.max(0, n)) * 10) / 10, motivo };
  }
  return { criterios, resumo: String(o.resumo ?? "").trim().slice(0, 400) };
}
