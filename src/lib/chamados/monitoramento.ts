// =====================================================================
// MONITORAMENTO DE CHAMADOS (22/10/2026) — regras da visão gerencial.
//
// Pedido do Pablo: medir a QUALIDADE DAS SOLICITAÇÕES de desenvolvimento
// (não o desempenho do time) a partir do que já está gravado no chamado —
// sem formulário novo para o solicitante e sem cadastro paralelo. Tudo aqui
// é regra determinística: o mesmo chamado sempre dá o mesmo tema e a mesma
// nota, e cada nota vem com o porquê (nada de "a I.A. achou").
//
// Fonte: RPC chamados_monitoramento (mig 20261022000180), que devolve o
// chamado + contagens (anexos, conversa, reaberturas) + avaliações já
// existentes (a do solicitante sobre a entrega e a do dev sobre o pedido).
// Ajustes manuais (tema, complexidade, aderência, efetividade, índice) ficam
// em CHAMADO_SISTEMA_MONITOR_AJUSTE, com quem/quando/por quê; o último por
// campo vence (valor null = volta ao automático).
//
// Regras da avaliação (do pedido):
//   · avalia-se a SOLICITAÇÃO; o solicitante é só a soma dos chamados dele;
//   · não concluído = nota PRELIMINAR; efetividade só existe após a entrega;
//   · cancelado conta à parte e não pesa contra ninguém.
// =====================================================================

// ---- Tipos de entrada (linha da RPC) ---------------------------------
export interface ChamadoMonitor {
  id: string;
  numero: string | null;
  assunto: string;
  descricao: string | null;
  categorias: string[] | null;
  tipo_solicitacao: string | null;
  prioridade: string;
  impacto_trabalho: string | null;
  urgencia: string | null;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  afeta_usuarios: number | null;
  observacoes_solicitante: string | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  setor: string | null;
  status: string;
  prazo_previsto: string | null;
  concluido_em: string | null;
  created_at: string;
  anexos_abertura: number;
  anexos_total: number;
  comentarios: number;
  pedidos_info: number;
  reaberturas: number;
  /** Avaliação do solicitante sobre a ENTREGA, média ponderada 1..5 (null = não avaliou). */
  aval_entrega: number | null;
  /** Avaliação do dev sobre o PEDIDO: clareza e informações/evidências, 1..5. */
  aval_dev_clareza: number | null;
  aval_dev_informacoes: number | null;
  /** Validação da Presidência (quando o chamado passou por ela). */
  validacao_aprovado: boolean | null;
  validacao_devolucoes: number | null;
  /** Ajustes manuais vigentes (último por campo). */
  ajustes?: Partial<Record<CampoAjuste, string | null>>;
}

export type CampoAjuste = "tema" | "complexidade" | "aderencia" | "efetividade" | "indice";

export interface AjusteMonitor {
  id: number;
  chamado_id: string;
  campo: CampoAjuste;
  valor: string | null;
  valor_anterior: string | null;
  justificativa: string;
  autor_id: string;
  autor_nome: string | null;
  created_at: string;
}

// ---- Texto ------------------------------------------------------------
/** minúsculo, sem acento, espaços colapsados — base de todas as buscas por termo. */
export function normalizar(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Termos (já normalizados) encontrados no texto. Termo curto casa por palavra inteira. */
export function termosPresentes(texto: string, termos: readonly string[]): string[] {
  const t = ` ${texto} `;
  const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // "erro" não pode casar dentro de "ferro", nem "meta" dentro de "metade" (plural vale).
  return termos.filter((k) => (k.length <= 4 ? new RegExp(`(^|[^a-z0-9])${esc(k)}s?($|[^a-z0-9])`).test(t) : t.includes(k)));
}

// ---- Temas --------------------------------------------------------------
export const TEMAS = [
  {
    value: "fluxo_caixa", label: "Melhorias em leituras de Fluxo de Caixa", cor: "#3b82f6",
    termos: ["fluxo de caixa", "caixa", "conciliacao", "conciliar", "saldo", "extrato", "bancari", "contas a pagar", "contas a receber", "recebimento", "pagamento", "tesouraria", "rateio", "ratear"],
    categorias: [] as string[],
  },
  {
    value: "automatizacao", label: "Automatização de processos manuais", cor: "#f97316",
    termos: ["automatiz", "automatic", "manual", "manualmente", "planilha", "excel", "importar", "importacao", "rotina", "retrabalho", "digitar", "redigitar", "preencher", "gerar sozinho", "robo"],
    categorias: [],
  },
  {
    value: "visao_estrategica", label: "Visão estratégica para gestão", cor: "#22c55e",
    termos: ["estrategi", "diretoria", "presidencia", "tomada de decisao", "decisao", "gestao", "gestor", "visao geral", "consolidad", "meta", "metas", "resultado da empresa", "acompanhamento gerencial"],
    categorias: [],
  },
  {
    value: "relatorios", label: "Relatórios e indicadores gerenciais", cor: "#a855f7",
    termos: ["relatorio", "dashboard", "indicador", "painel", "power bi", "grafico", "kpi", "exportar", "exportacao", "ranking", "totaliz"],
    categorias: ["relatorios_dashboards", "power_bi"],
  },
  {
    value: "integracoes", label: "Integrações entre módulos", cor: "#0ea5e9",
    termos: ["integra", "senior", "sincroniz", "api", "whatsapp", "discord", "entre modulos", "outro modulo", "vincular", "puxar automatic", "conectar", "webhook"],
    categorias: ["integracoes"],
  },
  {
    value: "cadastros", label: "Melhorias de cadastros", cor: "#14b8a6",
    termos: ["cadastro", "cadastrar", "campo", "formulario", "incluir campo", "novo campo", "editar", "alterar dados", "tela de"],
    categorias: ["ajuste_tela_cadastro"],
  },
  {
    value: "correcoes", label: "Correções de inconsistências", cor: "#ef4444",
    termos: ["erro", "bug", "nao funciona", "nao esta funcionando", "inconsisten", "corrigir", "correcao", "falha", "incorret", "errado", "divergen", "duplicad", "travando", "trava", "nao aparece", "sumiu", "nao carrega", "tela branca"],
    categorias: ["correcao_erro"],
  },
  {
    value: "outros", label: "Outros temas", cor: "#94a3b8",
    termos: [], categorias: [],
  },
] as const;

export type Tema = (typeof TEMAS)[number]["value"];
export const temaLabel = (v: string | null | undefined) => TEMAS.find((t) => t.value === v)?.label ?? "Outros temas";
export const temaCor = (v: string | null | undefined) => TEMAS.find((t) => t.value === v)?.cor ?? "#94a3b8";
export const ehTema = (v: unknown): v is Tema => TEMAS.some((t) => t.value === v);

export interface ClassificacaoTema { tema: Tema; pontos: number; termos: string[]; motivo: string }

/**
 * Tema = o de mais pontos. Termo no ASSUNTO vale 3, na descrição vale 1;
 * a categoria marcada na abertura vale 3 e o tipo "correção" soma 2 em
 * Correções. Empate fica com o tema que vem antes na lista (Fluxo de Caixa
 * primeiro, Correções por último: é o desempate que privilegia o que o
 * pedido quer enxergar). Sem ponto nenhum = Outros.
 */
export function classificarTema(c: Pick<ChamadoMonitor, "assunto" | "descricao" | "categorias" | "tipo_solicitacao" | "observacoes_solicitante">): ClassificacaoTema {
  const assunto = normalizar(c.assunto);
  const corpo = normalizar(`${c.descricao ?? ""} ${c.observacoes_solicitante ?? ""}`);
  const cats = c.categorias ?? [];
  let melhor: ClassificacaoTema = { tema: "outros", pontos: 0, termos: [], motivo: "Nenhum termo característico no título ou na descrição." };
  for (const t of TEMAS) {
    if (t.value === "outros") continue;
    const noAssunto = termosPresentes(assunto, t.termos);
    const noCorpo = termosPresentes(corpo, t.termos).filter((k) => !noAssunto.includes(k));
    const porCategoria = cats.filter((x) => (t.categorias as readonly string[]).includes(x));
    let pontos = noAssunto.length * 3 + noCorpo.length + porCategoria.length * 3;
    if (t.value === "correcoes" && c.tipo_solicitacao === "correcao") pontos += 2;
    if (pontos > melhor.pontos) {
      const termos = [...noAssunto, ...noCorpo];
      const partes: string[] = [];
      if (termos.length) partes.push(`termos: ${termos.slice(0, 5).join(", ")}`);
      if (porCategoria.length) partes.push(`categoria marcada na abertura`);
      if (t.value === "correcoes" && c.tipo_solicitacao === "correcao") partes.push("tipo Correção");
      melhor = { tema: t.value, pontos, termos, motivo: partes.join("; ") };
    }
  }
  return melhor;
}

// ---- Critérios do índice (0–10) --------------------------------------
export const CRITERIOS_INDICE = [
  { key: "clareza_problema",  titulo: "Clareza do problema",                peso: 0.12 },
  { key: "clareza_resultado", titulo: "Clareza do resultado esperado",       peso: 0.12 },
  { key: "descricao",         titulo: "Qualidade da descrição",              peso: 0.10 },
  { key: "evidencias",        titulo: "Exemplos, anexos e evidências",       peso: 0.10 },
  { key: "importancia",       titulo: "Importância operacional",             peso: 0.12 },
  { key: "aderencia",         titulo: "Aderência aos objetivos da empresa",  peso: 0.10 },
  { key: "reaproveitamento",  titulo: "Reaproveitamento em outros módulos",  peso: 0.08 },
  { key: "reducao_manual",    titulo: "Redução de trabalho manual",          peso: 0.10 },
  { key: "confiabilidade",    titulo: "Confiabilidade da informação",        peso: 0.08 },
  { key: "resultado",         titulo: "Resultado após a implantação",        peso: 0.08 },
] as const;

export type CriterioIndice = (typeof CRITERIOS_INDICE)[number]["key"];
export interface NotaCriterio { nota: number | null; motivo: string }

const lim = (n: number) => Math.max(0, Math.min(10, n));
const arred1 = (n: number) => Math.round(n * 10) / 10;
/** Nota 1..5 de avaliação → escala 0..10 (1 = 0, 5 = 10). */
const de5para10 = (n: number) => lim(((n - 1) / 4) * 10);

const TERMOS_PROBLEMA = ["hoje", "atualmente", "problema", "nao consigo", "nao conseguimos", "dificuldade", "precisamos", "preciso", "ocorre", "acontece", "quando", "porque", "pois", "demora", "erro"];
const TERMOS_RESULTADO = ["gostaria", "esperado", "espera-se", "objetivo", "para que", "resultado", "deve", "deveria", "precisa mostrar", "precisa ter", "queremos", "quero", "ideia e", "seria", "permitir", "possibilitar", "necessario que"];
const TERMOS_EXEMPLO = ["exemplo", "ex:", "ex.:", "print", "anexo", "segue", "conforme", "modelo", "imagem", "planilha anexa", "mockup"];
const TERMOS_REUSO = ["todos os modulos", "outros modulos", "outros setores", "todos os setores", "toda a empresa", "padrao", "padronizar", "reaproveit", "geral", "todas as telas", "outras areas", "integra"];
const TERMOS_MANUAL = ["manual", "manualmente", "planilha", "excel", "automatiz", "automatic", "retrabalho", "redigitar", "digitar", "horas", "tempo gasto", "agilizar", "otimizar", "rotina"];
const TERMOS_CONFIAVEL = ["inconsisten", "divergen", "conciliac", "duplicad", "incorret", "errad", "confiav", "correto", "precisao", "dados", "auditoria", "conferencia", "bater com", "fechamento"];

/** Temas que conversam com o que a empresa quer enxergar (gestão e caixa primeiro). */
const ADERENCIA_TEMA: Record<Tema, number> = {
  fluxo_caixa: 9, visao_estrategica: 9, relatorios: 8, automatizacao: 8,
  integracoes: 7, correcoes: 6, cadastros: 5, outros: 4,
};

export interface AvaliacaoChamadoMonitor {
  tema: Tema;
  temaAuto: ClassificacaoTema;
  criterios: Record<CriterioIndice, NotaCriterio>;
  indice: number;
  indiceAuto: number;
  preliminar: boolean;
  complexidade: "baixa" | "media" | "alta";
  aderencia: "alta" | "media" | "baixa";
  efetividade: number | null;
  efetividadeMotivo: string;
  prazoDias: number | null;
  cancelado: boolean;
  ajustado: CampoAjuste[];
  flags: {
    objetivoClaro: boolean;
    relevanciaOperacional: boolean;
    melhoriaProcesso: boolean;
    visaoEstrategica: boolean;
    baixaEspecificacao: boolean;
  };
}

const DIA = 86_400_000;

/** Dias corridos da abertura até a conclusão (ou até `agora`, se ainda aberto). */
export function prazoEmDias(c: Pick<ChamadoMonitor, "created_at" | "concluido_em" | "status">, agora = new Date()): number | null {
  const ini = new Date(c.created_at);
  if (isNaN(+ini)) return null;
  const fim = c.status === "concluido" && c.concluido_em ? new Date(c.concluido_em) : agora;
  if (isNaN(+fim)) return null;
  return arred1(Math.max(0, (+fim - +ini) / DIA));
}

/**
 * Avalia um chamado. Puro: depende só da linha e de `agora` (para o prazo
 * dos que ainda estão abertos).
 */
export function avaliarChamado(c: ChamadoMonitor, agora = new Date()): AvaliacaoChamadoMonitor {
  const aj = c.ajustes ?? {};
  const ajustado: CampoAjuste[] = [];
  const temaAuto = classificarTema(c);
  const tema: Tema = ehTema(aj.tema) ? aj.tema : temaAuto.tema;
  if (ehTema(aj.tema)) ajustado.push("tema");

  const desc = normalizar(c.descricao);
  const texto = normalizar(`${c.assunto} ${c.descricao ?? ""} ${c.observacoes_solicitante ?? ""}`);
  const tamanho = (c.descricao ?? "").trim().length;
  const linhas = (c.descricao ?? "").split(/\n/).filter((l) => l.trim()).length;
  const concluido = c.status === "concluido";
  const cancelado = c.status === "cancelado";

  // 1) Clareza do problema — o texto diz o que acontece hoje? A nota do dev
  //    (que leu o pedido para resolver) pesa metade quando existe.
  const tProb = termosPresentes(desc, TERMOS_PROBLEMA);
  let clarezaProb = lim((tamanho >= 80 ? 4 : tamanho >= 30 ? 2 : 0) + Math.min(6, tProb.length * 2));
  let motivoProb = tProb.length ? `descreve a situação atual (${tProb.slice(0, 3).join(", ")})` : "não descreve a situação atual";
  if (c.aval_dev_clareza != null) {
    clarezaProb = lim((clarezaProb + de5para10(c.aval_dev_clareza)) / 2);
    motivoProb += `; dev avaliou a clareza com ${c.aval_dev_clareza}/5`;
  }

  // 2) Clareza do resultado esperado.
  const tRes = termosPresentes(desc, TERMOS_RESULTADO);
  const clarezaRes = lim((tamanho >= 80 ? 3 : tamanho >= 30 ? 1 : 0) + Math.min(7, tRes.length * 2.5));
  const motivoRes = tRes.length ? `diz o que espera (${tRes.slice(0, 3).join(", ")})` : "não diz o resultado esperado";

  // 3) Qualidade da descrição — tamanho e estrutura (passos, itens, parágrafos).
  const notaTam = tamanho >= 700 ? 9 : tamanho >= 300 ? 7.5 : tamanho >= 120 ? 6 : tamanho >= 40 ? 3.5 : tamanho > 0 ? 1.5 : 0;
  const estruturado = linhas >= 3 || /(^|\n)\s*([-•*]|\d+[.)])\s/.test(c.descricao ?? "");
  const notaDesc = lim(notaTam + (estruturado ? 1.5 : 0));
  const motivoDesc = `${tamanho} caracteres${estruturado ? ", texto estruturado em itens/parágrafos" : ""}`;

  // 4) Evidências — anexos da abertura e exemplos citados; nota do dev em "informações".
  const tEx = termosPresentes(texto, TERMOS_EXEMPLO);
  let evid = lim((c.anexos_abertura >= 2 ? 7 : c.anexos_abertura === 1 ? 5.5 : 1) + Math.min(3, tEx.length * 1.5));
  let motivoEv = `${c.anexos_abertura} anexo(s) na abertura${tEx.length ? `, cita ${tEx.slice(0, 2).join(", ")}` : ""}`;
  if (c.aval_dev_informacoes != null) {
    evid = lim((evid + de5para10(c.aval_dev_informacoes)) / 2);
    motivoEv += `; dev avaliou as informações com ${c.aval_dev_informacoes}/5`;
  }

  // 5) Importância operacional — o que o próprio solicitante declarou.
  const baseImp: Record<string, number> = { impede: 9, atraso_significativo: 7.5, atraso_leve: 5, nao_impacta: 3 };
  const usuarios = c.afeta_usuarios ?? 0;
  const imp = lim((baseImp[c.impacto_trabalho ?? ""] ?? 4.5) + (usuarios >= 10 ? 1.5 : usuarios >= 3 ? 0.75 : 0) + (c.prioridade === "alta" ? 0.5 : 0));
  const motivoImp = `impacto "${c.impacto_trabalho ?? "não informado"}", afeta ${c.afeta_usuarios ?? "?"} usuário(s), prioridade ${c.prioridade}`;

  // 6) Aderência aos objetivos — pelo tema; melhoria soma, dúvida tira.
  const ader = lim(ADERENCIA_TEMA[tema] + (c.tipo_solicitacao === "melhoria" ? 1 : 0) - (c.tipo_solicitacao === "duvida" ? 3 : 0));
  const motivoAder = `tema "${temaLabel(tema)}"${c.tipo_solicitacao ? `, tipo ${c.tipo_solicitacao}` : ""}`;

  // 7) Reaproveitamento.
  const tReuso = termosPresentes(texto, TERMOS_REUSO);
  const reuso = lim(3 + Math.min(4, tReuso.length * 2) + (tema === "integracoes" ? 2 : 0) + (usuarios >= 10 ? 1 : 0));
  const motivoReuso = tReuso.length ? `cita uso amplo (${tReuso.slice(0, 3).join(", ")})` : "uso restrito a uma tela/setor";

  // 8) Redução de trabalho manual.
  const tMan = termosPresentes(texto, TERMOS_MANUAL);
  const manual = lim(2 + Math.min(6, tMan.length * 2) + (tema === "automatizacao" ? 2 : 0));
  const motivoMan = tMan.length ? `menciona ${tMan.slice(0, 3).join(", ")}` : "não fala de trabalho manual";

  // 9) Confiabilidade da informação.
  const tConf = termosPresentes(texto, TERMOS_CONFIAVEL);
  const conf = lim(3 + Math.min(5, tConf.length * 1.5) + (tema === "correcoes" || tema === "fluxo_caixa" ? 2 : 0));
  const motivoConf = tConf.length ? `trata de ${tConf.slice(0, 3).join(", ")}` : "não trata de qualidade do dado";

  // 10) Resultado após a implantação — só existe depois da entrega.
  let resultado: number | null = null;
  let motivoResultado = "aguarda a conclusão (avaliação preliminar)";
  if (concluido) {
    if (c.aval_entrega != null) {
      resultado = de5para10(c.aval_entrega);
      motivoResultado = `solicitante avaliou a entrega com ${c.aval_entrega.toFixed(1).replace(".", ",")}/5`;
    } else {
      resultado = 7;
      motivoResultado = "concluído sem avaliação do solicitante (nota neutra)";
    }
    if (c.reaberturas > 0) {
      resultado = lim(resultado - 2 * c.reaberturas);
      motivoResultado += `; reaberto ${c.reaberturas}x`;
    }
  }

  const criterios: Record<CriterioIndice, NotaCriterio> = {
    clareza_problema: { nota: arred1(clarezaProb), motivo: motivoProb },
    clareza_resultado: { nota: arred1(clarezaRes), motivo: motivoRes },
    descricao: { nota: arred1(notaDesc), motivo: motivoDesc },
    evidencias: { nota: arred1(evid), motivo: motivoEv },
    importancia: { nota: arred1(imp), motivo: motivoImp },
    aderencia: { nota: arred1(ader), motivo: motivoAder },
    reaproveitamento: { nota: arred1(reuso), motivo: motivoReuso },
    reducao_manual: { nota: arred1(manual), motivo: motivoMan },
    confiabilidade: { nota: arred1(conf), motivo: motivoConf },
    resultado: { nota: resultado == null ? null : arred1(resultado), motivo: motivoResultado },
  };

  // Índice = média ponderada dos critérios que existem (o "resultado" de quem
  // não concluiu fica de fora e o peso dele se redistribui).
  let soma = 0, pesos = 0;
  for (const k of CRITERIOS_INDICE) {
    const n = criterios[k.key].nota;
    if (n == null) continue;
    soma += n * k.peso; pesos += k.peso;
  }
  const indiceAuto = pesos ? arred1(soma / pesos) : 0;
  const indiceAj = numeroAjuste(aj.indice, 0, 10);
  if (indiceAj != null) ajustado.push("indice");
  const indice = indiceAj ?? indiceAuto;

  // Complexidade — tamanho do pedido, quantas frentes toca e o que deu de conversa.
  let pc = 0;
  if (tamanho >= 600) pc += 2; else if (tamanho >= 250) pc += 1;
  if ((c.categorias ?? []).length >= 2) pc += 1;
  if (tema === "integracoes" || tema === "automatizacao") pc += 1;
  if (c.tipo_solicitacao === "melhoria") pc += 1;
  if (c.tipo_solicitacao === "duvida") pc -= 1;
  if (c.comentarios >= 10) pc += 1;
  const prazoDias = prazoEmDias(c, agora);
  if (concluido && prazoDias != null && prazoDias >= 15) pc += 1;
  const complexAuto: AvaliacaoChamadoMonitor["complexidade"] = pc >= 4 ? "alta" : pc >= 2 ? "media" : "baixa";
  const complexAj = ["baixa", "media", "alta"].includes(aj.complexidade ?? "") ? (aj.complexidade as AvaliacaoChamadoMonitor["complexidade"]) : null;
  if (complexAj) ajustado.push("complexidade");

  const aderAuto: AvaliacaoChamadoMonitor["aderencia"] = ader >= 7.5 ? "alta" : ader >= 5 ? "media" : "baixa";
  const aderAj = ["alta", "media", "baixa"].includes(aj.aderencia ?? "") ? (aj.aderencia as AvaliacaoChamadoMonitor["aderencia"]) : null;
  if (aderAj) ajustado.push("aderencia");

  // Efetividade da entrega (%) — só para concluído. Base: a avaliação do
  // solicitante (5/5 = 100%); sem ela, 80%. Desconta reabertura, devolução da
  // Presidência e entrega depois do prazo combinado.
  let efetividade: number | null = null;
  let efetividadeMotivo = cancelado ? "cancelado — não entra na conta"
    : c.status === "reprovado" ? "reprovado — não houve entrega"
    : "aguarda conclusão e validação da entrega";
  if (concluido) {
    const partes: string[] = [];
    let e = c.aval_entrega != null ? (c.aval_entrega / 5) * 100 : 80;
    partes.push(c.aval_entrega != null ? `avaliação do solicitante ${c.aval_entrega.toFixed(1).replace(".", ",")}/5` : "sem avaliação do solicitante (base 80%)");
    if (c.reaberturas > 0) { e -= 15 * c.reaberturas; partes.push(`−15% por reabertura (${c.reaberturas})`); }
    if ((c.validacao_devolucoes ?? 0) > 0) { e -= 10 * (c.validacao_devolucoes ?? 0); partes.push(`−10% por devolução da Presidência (${c.validacao_devolucoes})`); }
    if (c.validacao_aprovado === true) { e += 5; partes.push("+5% aprovado pela Presidência"); }
    if (c.prazo_previsto && c.concluido_em && c.concluido_em.slice(0, 10) > c.prazo_previsto) { e -= 10; partes.push("−10% entregue após o prazo previsto"); }
    efetividade = Math.round(Math.max(0, Math.min(100, e)));
    efetividadeMotivo = partes.join("; ");
  }
  const efAj = numeroAjuste(aj.efetividade, 0, 100);
  if (efAj != null) { ajustado.push("efetividade"); efetividade = Math.round(efAj); efetividadeMotivo = "ajustada manualmente"; }

  return {
    tema, temaAuto, criterios, indice, indiceAuto,
    preliminar: !concluido,
    complexidade: complexAj ?? complexAuto,
    aderencia: aderAj ?? aderAuto,
    efetividade, efetividadeMotivo, prazoDias, cancelado, ajustado,
    flags: {
      objetivoClaro: clarezaRes >= 6,
      relevanciaOperacional: imp >= 7,
      melhoriaProcesso: manual >= 6 || tema === "automatizacao",
      visaoEstrategica: tema === "visao_estrategica" || tema === "fluxo_caixa" || ader >= 9,
      baixaEspecificacao: notaDesc <= 3.5 && evid <= 4,
    },
  };
}

function numeroAjuste(v: string | null | undefined, min: number, max: number): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// ---- Consolidação -------------------------------------------------------
export interface LinhaMonitor { c: ChamadoMonitor; a: AvaliacaoChamadoMonitor }

export const STATUS_ANDAMENTO = ["em_andamento", "aguardando_retorno"];

export interface KpisMonitor {
  solicitantes: number;
  total: number;
  concluidas: number;
  emAndamento: number;
  pendentes: number;
  reprovadas: number;
  canceladas: number;
  efetividadeMedia: number | null;
  indiceMedio: number | null;
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Cancelados ficam só no contador próprio — não entram em total, médias nem ranking. */
export function calcularKpis(linhas: LinhaMonitor[]): KpisMonitor {
  const validas = linhas.filter((l) => !l.a.cancelado);
  const ef = validas.map((l) => l.a.efetividade).filter((x): x is number => x != null);
  const im = media(validas.map((l) => l.a.indice));
  const em = media(ef);
  return {
    solicitantes: new Set(validas.map((l) => l.c.solicitante_id)).size,
    total: validas.length,
    concluidas: validas.filter((l) => l.c.status === "concluido").length,
    emAndamento: validas.filter((l) => STATUS_ANDAMENTO.includes(l.c.status)).length,
    pendentes: validas.filter((l) => l.c.status === "aberto").length,
    reprovadas: validas.filter((l) => l.c.status === "reprovado").length,
    canceladas: linhas.length - validas.length,
    efetividadeMedia: em == null ? null : Math.round(em),
    indiceMedio: im == null ? null : arred1(im),
  };
}

export interface TemaResumo { tema: Tema; label: string; cor: string; qtd: number; pct: number }

export function resumoTemas(linhas: LinhaMonitor[]): TemaResumo[] {
  const validas = linhas.filter((l) => !l.a.cancelado);
  const total = validas.length || 1;
  return TEMAS.map((t) => {
    const qtd = validas.filter((l) => l.a.tema === t.value).length;
    return { tema: t.value, label: t.label, cor: t.cor, qtd, pct: Math.round((qtd / total) * 100) };
  })
    .filter((r) => r.qtd > 0)
    // "Outros" sempre por último, como no mockup.
    .sort((a, b) => (a.tema === "outros" ? 1 : b.tema === "outros" ? -1 : b.qtd - a.qtd));
}

export interface RankingSolicitante {
  solicitante_id: string;
  nome: string;
  setor: string | null;
  total: number;
  concluidos: number;
  indiceMedio: number;
  efetividadeMedia: number | null;
}

/** Ordem: média do índice, depois efetividade, depois volume. */
export function rankingSolicitantes(linhas: LinhaMonitor[]): RankingSolicitante[] {
  const por = new Map<string, LinhaMonitor[]>();
  for (const l of linhas) {
    if (l.a.cancelado) continue;
    const k = l.c.solicitante_id;
    if (!por.has(k)) por.set(k, []);
    por.get(k)!.push(l);
  }
  return [...por.entries()].map(([id, ls]) => {
    const ef = ls.map((l) => l.a.efetividade).filter((x): x is number => x != null);
    const em = media(ef);
    return {
      solicitante_id: id,
      nome: ls[0].c.solicitante_nome ?? "—",
      setor: ls[0].c.setor,
      total: ls.length,
      concluidos: ls.filter((l) => l.c.status === "concluido").length,
      indiceMedio: arred1(media(ls.map((l) => l.a.indice)) ?? 0),
      efetividadeMedia: em == null ? null : Math.round(em),
    };
  }).sort((a, b) => b.indiceMedio - a.indiceMedio || (b.efetividadeMedia ?? -1) - (a.efetividadeMedia ?? -1) || b.total - a.total);
}

export interface QualidadeResumo {
  objetivoClaro: number;
  relevanciaOperacional: number;
  melhoriaProcesso: number;
  visaoEstrategica: number;
  baixaEspecificacao: number;
}

/** % das solicitações (sem canceladas) com cada característica. */
export function analiseQualidade(linhas: LinhaMonitor[]): QualidadeResumo {
  const v = linhas.filter((l) => !l.a.cancelado);
  const pct = (f: (l: LinhaMonitor) => boolean) => (v.length ? Math.round((v.filter(f).length / v.length) * 100) : 0);
  return {
    objetivoClaro: pct((l) => l.a.flags.objetivoClaro),
    relevanciaOperacional: pct((l) => l.a.flags.relevanciaOperacional),
    melhoriaProcesso: pct((l) => l.a.flags.melhoriaProcesso),
    visaoEstrategica: pct((l) => l.a.flags.visaoEstrategica),
    baixaEspecificacao: pct((l) => l.a.flags.baixaEspecificacao),
  };
}

/**
 * Texto "Leitura da Controladoria": montado só com o que está nos números —
 * setores com melhor índice médio (mínimo 2 chamados para não premiar um
 * pedido isolado), temas que mais aparecem e o alerta de baixa especificação.
 */
export function leituraControladoria(linhas: LinhaMonitor[]): string {
  const v = linhas.filter((l) => !l.a.cancelado);
  if (!v.length) return "Sem solicitações no período filtrado.";
  const porSetor = new Map<string, number[]>();
  for (const l of v) {
    const s = l.c.setor?.trim() || "Sem setor";
    if (!porSetor.has(s)) porSetor.set(s, []);
    porSetor.get(s)!.push(l.a.indice);
  }
  const setores = [...porSetor.entries()]
    .filter(([, xs]) => xs.length >= 2)
    .map(([s, xs]) => ({ s, m: media(xs)! }))
    .sort((a, b) => b.m - a.m)
    .slice(0, 3);
  const temas = resumoTemas(linhas).filter((t) => t.tema !== "outros").slice(0, 3);
  const q = analiseQualidade(linhas);
  const fmt = (n: number) => n.toFixed(1).replace(".", ",");
  const partes: string[] = [];
  if (setores.length) {
    partes.push(`As solicitações mais bem formuladas vêm de ${listaPt(setores.map((x) => `${x.s} (${fmt(x.m)})`))}.`);
  }
  if (temas.length) {
    partes.push(`Os pedidos concentram-se em ${listaPt(temas.map((t) => `${t.label.toLowerCase()} (${t.pct}%)`))}.`);
  }
  partes.push(`${q.objetivoClaro}% deixam claro o resultado esperado e ${q.relevanciaOperacional}% têm grande relevância operacional.`);
  if (q.baixaEspecificacao >= 20) {
    partes.push(`Atenção: ${q.baixaEspecificacao}% chegaram com baixa especificação (texto curto e sem evidências) — orientar os solicitantes a descrever a situação atual, o resultado esperado e anexar exemplos.`);
  }
  return partes.join(" ");
}

function listaPt(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;
}

export const COMPLEXIDADE_LABEL = { baixa: "Baixa", media: "Média", alta: "Alta" } as const;
export const ADERENCIA_LABEL = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;
export const CAMPO_AJUSTE_LABEL: Record<CampoAjuste, string> = {
  tema: "Tema", complexidade: "Complexidade", aderencia: "Aderência estratégica",
  efetividade: "Efetividade (%)", indice: "Índice de qualidade (0–10)",
};
