// Painel Gerencial — de qual PERGUNTA sai cada indicador.
//
// O formulário é livre: cada RH escreve as perguntas como quiser. Por isso o
// painel adivinha o mapeamento por palavra-chave (autoMapa) e deixa a pessoa
// corrigir na tela, em ⚙ Mapeamento. Nada disso toca o banco — a escolha fica
// no localStorage, por formulário.
import { Pergunta } from "../Formularios";
import { Mapa } from "./tipos";

export const CHART_TIPOS = ["multipla_escolha", "caixas_selecao", "lista_suspensa", "escala", "escala_trabalho"];

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// indicadores de DESENVOLVIMENTO e as palavras-chave para o auto-mapeamento.
export const IND: { key: string; label: string; kw: string[] }[] = [
  { key: "situacao", label: "Situação profissional", kw: ["situacao", "como voce acredita", "acredita que est", "nivel prof", "visao do liderado"] },
  { key: "necessidades", label: "Necessidades de desenvolvimento", kw: ["dificuldade", "necessidade", "precisa desenvolver"] },
  { key: "fortes", label: "Pontos fortes", kw: ["fazendo bem", "ponto forte", "faz bem", "pontos fortes"] },
  { key: "melhoria", label: "Pontos de melhoria", kw: ["precisa melhorar", "melhorar", "melhoria", "sente que precisa"] },
];

// Exclusivo da VISÃO EXECUTIVA: o que o colaborador pede DA LIDERANÇA — outra
// pergunta, não o que ele mesmo precisa desenvolver. Fica fora de IND para não
// poluir o mapeamento da aba Desenvolvimento, que não usa este indicador.
export const IND_EXEC: { key: string; label: string; kw: string[] }[] = [
  { key: "necLideranca", label: "O que se pede da liderança", kw: ["precisa da lideranca", "precisa do lider", "espera da lideranca", "da sua lideranca", "do seu lider", "da lideranca"] },
];
// Indicadores da aba ALINHAMENTO E ENTREGA (todos viram nota 1..5).
export const IND_ALIN: { key: string; label: string; kw: string[]; opcional?: boolean }[] = [
  { key: "alinhamento", label: "Alinhamento às metas", kw: ["alinhad", "alinhamento", "visao do liderado", "meta"] },
  { key: "entrega", label: "Qualidade da entrega", kw: ["entrega", "nivel de entrega", "qualidade"] },
  { key: "contribuicao", label: "Contribuição para resultados", kw: ["comprometimento", "contribui", "resultado"] },
  { key: "metasConcluidas", label: "Metas concluídas (opcional)", kw: ["meta concluida", "metas concluidas", "concluiu"], opcional: true },
  { key: "metasPrazo", label: "Metas no prazo (opcional)", kw: ["no prazo", "dentro do prazo", "prazo"], opcional: true },
];

// Aba PLANOS DE AÇÃO — o plano já está no formulário: uma pergunta diz a ação
// definida e outra o prazo. Sem essas duas a aba não tem o que mostrar.
export const IND_PLANO: { key: string; label: string; kw: string[] }[] = [
  { key: "acaoPlano", label: "Ação definida", kw: ["acao definida", "treinamento ou acompanhamento", "o que exatamente vai ser feito", "plano de acao"] },
  { key: "prazoPlano", label: "Prazo para a ação", kw: ["prazo para acao", "prazo para a acao", "prazo da acao", "prazo"] },
];

// Todos os campos de mapeamento num lugar só — é o que a aba "Indicadores e
// Cálculos" oferece: lá a pessoa está justamente conferindo de onde cada número
// sai, então limitar a edição aos indicadores de uma aba obrigaria a passear
// pelo painel inteiro para consertar o que ela acabou de ver quebrado.
// `tipos` mantém a mesma restrição das abas: indicador de gráfico não aceita
// pergunta de texto.
export const CAMPOS_MAPA: { key: string; label: string; tipos?: string[] }[] = [
  ...IND.map(i => ({ key: i.key, label: `Desenvolvimento · ${i.label}`, tipos: CHART_TIPOS })),
  ...IND_EXEC.map(i => ({ key: i.key, label: `Visão executiva · ${i.label}`, tipos: CHART_TIPOS })),
  { key: "lider", label: "Liderança · quem é a liderança avaliada" },
  { key: "avaliado", label: "Histórico · colaborador avaliado" },
  ...IND_ALIN.map(i => ({ key: i.key, label: `Alinhamento · ${i.label}`, tipos: ["escala", "multipla_escolha", "lista_suspensa"] })),
  ...IND_PLANO.map(i => ({ key: i.key, label: `Planos de ação · ${i.label}` })),
];


export function autoMapa(pergs: Pergunta[]): Mapa {
  const m: Mapa = {};
  const chart = pergs.filter(p => CHART_TIPOS.includes(p.tipo));
  for (const ind of IND) {
    const achou = chart.find(p => ind.kw.some(k => semAcento(p.titulo || "").includes(k)));
    if (achou) m[ind.key] = achou.id;
  }
  // Da mais específica para a mais genérica: "da lideranca" é fraca e casaria
  // com o enunciado errado se testada junto das outras.
  for (const ind of IND_EXEC) {
    const achou = achaPorEspecificidade(chart, ind.kw);
    if (achou) m[ind.key] = achou.id;
  }
  // Perguntas do tipo colaborador: uma diz QUEM É O LÍDER, outra QUEM FOI
  // AVALIADO. O avaliado é o sujeito do Histórico Individual e o denominador da
  // Visão Executiva — `respondente_nome` não serve, porque quem preenche o
  // feedback é o líder e o campo costuma vir vazio.
  //
  // Com UMA pergunta só, ela é o AVALIADO, não o líder: o formulário guiado de
  // feedback pergunta de quem se está falando, não quem está falando. A regra
  // antiga chutava "líder" nesse caso e deixava o avaliado vazio — a Visão
  // Executiva ficava sem o dado principal em todo formulário de uma pergunta só.
  const colabs = pergs.filter(p => p.tipo === "colaborador");
  const ehLider = (p: Pergunta) => /lideranc|lider|gestor|chefe/.test(semAcento(p.titulo || ""));
  const ehAvaliado = (p: Pergunta) => /colaborador|avaliad|liderado|funcionario|empregado|nome do/.test(semAcento(p.titulo || ""));
  const lid = colabs.find(ehLider) ?? (colabs.length > 1 ? colabs.find(p => !ehAvaliado(p)) : undefined);
  if (lid) m.lider = lid.id;
  const restantes = colabs.filter(p => p.id !== lid?.id);
  const aval = restantes.find(ehAvaliado) ?? restantes[0];
  if (aval) m.avaliado = aval.id;
  // … e as dimensões avaliadas: escalas (ideal) ou perguntas "o nível/como está".
  const escalas = pergs.filter(p => p.tipo === "escala");
  const ordinais = pergs.filter(p => ["multipla_escolha", "lista_suspensa"].includes(p.tipo)
    && /nivel|como est|avalia|visao do liderado|comprometimento|entrega/.test(semAcento(p.titulo || "")));
  const dims = (escalas.length ? escalas : ordinais).map(p => p.id);
  if (dims.length) m.dimensoes = dims;
  // ALINHAMENTO E ENTREGA: cada indicador é uma pergunta ordinal/escala.
  const notaveis = pergs.filter(p => ["escala", "multipla_escolha", "lista_suspensa"].includes(p.tipo));
  for (const ind of IND_ALIN) {
    const achou = notaveis.find(p => ind.kw.some(k => semAcento(p.titulo || "").includes(k)));
    if (achou) m[ind.key] = achou.id;
  }
  // PLANOS DE AÇÃO: ação é texto, prazo é data/texto.
  const textuais = pergs.filter(p => ["texto_longo", "texto_curto"].includes(p.tipo));
  const acaoP = achaPorEspecificidade(textuais, IND_PLANO[0].kw);
  if (acaoP) m.acaoPlano = acaoP.id;
  // Perguntas do tipo data primeiro: o prazo costuma ser uma delas, e assim um
  // campo de texto que só cite "prazo" não passa na frente.
  const dataPrimeiro = [
    ...pergs.filter(p => p.tipo === "data"),
    ...pergs.filter(p => ["texto_curto", "texto_longo"].includes(p.tipo)),
  ];
  const prazoP = achaPorEspecificidade(dataPrimeiro, IND_PLANO[1].kw, acaoP?.id);
  if (prazoP) m.prazoPlano = prazoP.id;
  return m;
}

// Casa keyword a keyword — da mais específica para a mais genérica — em vez de
// pergunta a pergunta.
//
// Por que importa: o enunciado da própria "Ação definida" cita "prazo" no meio
// do texto ("…você tem um prazo de x dias…"). Varrendo por pergunta, ela casava
// com a keyword fraca "prazo" e roubava o mapeamento antes de a pergunta certa
// ("Prazo para Ação") ser sequer testada — todo plano ficava "sem prazo".
// `excluir` garante que a mesma pergunta não vire ação E prazo.
function achaPorEspecificidade(cands: Pergunta[], kws: string[], excluir?: string): Pergunta | undefined {
  const uteis = cands.filter(p => p.id !== excluir);
  for (const k of kws) {
    const achou = uteis.find(p => semAcento(p.titulo || "").includes(k));
    if (achou) return achou;
  }
  return undefined;
}
