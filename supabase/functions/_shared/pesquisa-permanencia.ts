/**
 * RH › PESQUISA DE PERMANÊNCIA — lógica pura (mig 20261028001200).
 *
 * POR QUE EXISTE
 *   Chamado do RH/Operação: "Precisamos mapear nos contratos os motivos do
 *   excesso de rotatividade" — e, do lado do que se espera, "obter informações
 *   mais claras sobre turnover e gerar plano de ação a partir das respostas. A
 *   ideia é que a pesquisa possa selecionar o contrato e o posto de trabalho
 *   com a função". A especificação é o documento "Pesquisa de Permanência e
 *   Ambiente de Trabalho — Relatórios Detalhados" (8 perguntas, relatórios por
 *   contrato/função/motivo/prioridade/período e resumo gerencial).
 *
 * POR QUE NÃO É UM FORMULÁRIO DA CENTRAL DE SERVIÇOS
 *   O módulo de Formulários (CS_FORM_*) foi o primeiro candidato. Não cobre o
 *   documento: lá não há (1) "até 3 escolhas e depois a MAIS importante entre
 *   as marcadas", (2) complemento que abre só embaixo da alternativa escolhida,
 *   (3) alternativa exclusiva ("Manter as condições atuais"), nem (4) seletor
 *   de posto/função da Senior. E os relatórios precisam saber o que cada
 *   alternativa SIGNIFICA (problema da empresa × dos fiscais × do órgão) — em
 *   formulário genérico a opção é um texto livre que qualquer edição renomeia.
 *   Por isso o questionário é fixo, aqui, com código por alternativa.
 *   (30/10/2026: o Formulários ganhou essas peças e a pesquisa virou um
 *   formulário de lá — ver "Dentro do Formulários" no fim deste arquivo. O
 *   catálogo continua aqui pelo mesmo motivo: o significado de cada código.)
 *
 * QUEM USA ESTE ARQUIVO
 *   · a página pública do Formulários (src/pages/publico/FormularioPublico.tsx),
 *     nas perguntas local_trabalho / escolha_complemento;
 *   · a análise do formulário (src/pages/central-servicos/FormularioAnalise.tsx);
 *   · a Edge Function formulario-assistente-ia (o contexto que vai para a I.A);
 *   · os testes (src/test/pesquisa-permanencia.test.ts).
 *   O banco valida a MESMA regra (cs_form_valida_escolha, mig 20261030001000)
 *   e grava as perguntas de perguntasDoFormulario() — o teste confere o JSON.
 *
 * Sem import de Deno, Supabase ou de outro arquivo do _shared, para rodar no
 * Vitest e no navegador sem rede (mesmo arranjo de painel-indice.ts).
 */

// ─── Catálogo ──────────────────────────────────────────────────────────────

/** De quem é o problema, para o resumo gerencial do documento. */
export type Categoria = "empresa" | "fiscais" | "orgao" | "pessoal";
/** Como a alternativa conta no índice de satisfação. */
export type Tom = "pos" | "neu" | "neg";

export interface OpcaoSimples { cod: string; rotulo: string }
export interface Complemento {
  titulo: string;
  /** true = marcar todas as que se aplicam; false = uma só. */
  multipla: boolean;
  opcoes: OpcaoSimples[];
  /** Campo de texto curto obrigatório junto (pergunta 6: "Qual empresa?"). */
  texto?: { rotulo: string; max: number };
}
export interface Opcao extends OpcaoSimples {
  tom?: Tom;
  /** Pergunta 2: de quem é o motivo que levaria a pedir demissão. */
  categoria?: Categoria;
  /** Avaliação negativa (P3–P7): conta como problema desta categoria. */
  sinal?: Categoria;
  /** Não combina com nenhuma outra (pergunta 8). */
  exclusiva?: boolean;
  complemento?: Complemento;
}
export interface Pergunta {
  id: string;
  numero: number;
  titulo: string;
  /** Nome curto para relatório e para a I.A. */
  tema: string;
  /** 1 = resposta única; 3 = até 3 escolhas + a mais importante. */
  max: number;
  opcoes: Opcao[];
}

export const TITULO_PESQUISA = "Pesquisa de Permanência e Ambiente de Trabalho";
export const MENSAGEM_INICIAL = {
  titulo: "Sua opinião pode melhorar o seu ambiente de trabalho!",
  texto: "Queremos ouvir você e entender o que podemos melhorar. Responda com sinceridade! "
    + "Suas respostas vão ajudar a construir um ambiente mais respeitoso, organizado e acolhedor. "
    + "Não existem respostas certas ou erradas.",
};
export const MENSAGEM_FINAL = "Obrigado por participar! Sua opinião é importante para melhorar o seu ambiente de trabalho.";
export const PERGUNTA_PRINCIPAL = "Qual das opções marcadas é a mais importante?";

const MELHORAR_ENCARREGADO: Complemento = {
  titulo: "O que precisa melhorar?", multipla: true,
  opcoes: [
    { cod: "respeito", rotulo: "Respeito no tratamento" },
    { cod: "comunicacao", rotulo: "Comunicação e orientação" },
    { cod: "apoio", rotulo: "Apoio para resolver problemas" },
    { cod: "tarefas", rotulo: "Distribuição das tarefas" },
  ],
};
const DIFICULDADES_ORGAO: Complemento = {
  titulo: "Quais dificuldades?", multipla: true,
  opcoes: [
    { cod: "materiais", rotulo: "Falta de materiais ou equipamentos" },
    { cod: "estrutura", rotulo: "Estrutura física inadequada" },
    { cod: "descanso", rotulo: "Local inadequado para descanso e refeições" },
    { cod: "ambiente", rotulo: "Ambiente desrespeitoso" },
    { cod: "excesso", rotulo: "Excesso de tarefas" },
  ],
};

export const PERGUNTAS: Pergunta[] = [
  {
    id: "p1", numero: 1, max: 3, tema: "Motivos para permanecer",
    titulo: "Qual é o principal motivo que faz você permanecer no Grupo Nascimento?",
    opcoes: [
      { cod: "salario", rotulo: "Salário e benefícios" },
      { cod: "colegas", rotulo: "Bom relacionamento com os colegas" },
      { cod: "lideranca", rotulo: "Boa liderança e respeito" },
      { cod: "horario_local", rotulo: "Horário e localização do trabalho" },
      { cod: "estabilidade", rotulo: "Segurança e estabilidade no emprego" },
      { cod: "reconhecimento", rotulo: "Reconhecimento e valorização" },
    ],
  },
  {
    id: "p2", numero: 2, max: 3, tema: "Motivos que levariam a pedir demissão",
    titulo: "Quais situações poderiam levar você a pedir demissão?",
    opcoes: [
      { cod: "salario_fora", rotulo: "Salário ou benefícios melhores em outra empresa", categoria: "empresa" },
      {
        cod: "lideranca", rotulo: "Problemas com a liderança do Grupo Nascimento", categoria: "empresa",
        complemento: {
          titulo: "Quais dificuldades ocorrem?", multipla: true,
          opcoes: [
            { cod: "grosseria", rotulo: "Grosserias ou falta de respeito" },
            { cod: "sem_apoio", rotulo: "Falta de apoio e orientação" },
            { cod: "desigual", rotulo: "Tratamento desigual" },
            { cod: "cobranca", rotulo: "Cobranças excessivas" },
          ],
        },
      },
      {
        cod: "fiscais", rotulo: "Problemas com fiscais ou servidores do órgão público", categoria: "fiscais",
        complemento: {
          titulo: "Quais dificuldades ocorrem?", multipla: true,
          opcoes: [
            { cod: "grosseria", rotulo: "Grosserias ou desrespeito" },
            { cod: "ordens_conflitantes", rotulo: "Ordens conflitantes com as do encarregado" },
            { cod: "fora_contrato", rotulo: "Exigências fora das atividades contratadas" },
            { cod: "pressao", rotulo: "Interferência ou pressão excessiva" },
          ],
        },
      },
      // Sobrecarga é dimensionamento do posto e escala — decisão da empresa,
      // não do órgão (a estrutura do órgão é a pergunta 5).
      { cod: "sobrecarga", rotulo: "Sobrecarga ou condições ruins de trabalho", categoria: "empresa" },
      { cod: "colegas", rotulo: "Problemas de relacionamento com colegas", categoria: "empresa" },
      { cod: "pessoais", rotulo: "Questões pessoais, familiares ou de transporte", categoria: "pessoal" },
    ],
  },
  {
    id: "p3", numero: 3, max: 1, tema: "Relacionamento com o encarregado",
    titulo: "Como você avalia seu relacionamento com o encarregado?",
    opcoes: [
      { cod: "muito_bom", rotulo: "Muito bom", tom: "pos" },
      { cod: "bom", rotulo: "Bom", tom: "pos" },
      { cod: "regular", rotulo: "Regular", tom: "neu", sinal: "empresa", complemento: MELHORAR_ENCARREGADO },
      { cod: "ruim", rotulo: "Ruim", tom: "neg", sinal: "empresa", complemento: MELHORAR_ENCARREGADO },
    ],
  },
  {
    id: "p4", numero: 4, max: 1, tema: "Influência dos fiscais do órgão",
    titulo: "Como os fiscais do órgão público influenciam seu trabalho?",
    opcoes: [
      { cod: "positivo", rotulo: "Positivamente: ajudam e colaboram", tom: "pos" },
      { cod: "nao_interferem", rotulo: "Não interferem na minha rotina", tom: "neu" },
      { cod: "interferem", rotulo: "Interferem, mas sem prejudicar o trabalho", tom: "neu" },
      {
        cod: "negativo", rotulo: "Negativamente: dificultam meu trabalho", tom: "neg", sinal: "fiscais",
        complemento: {
          titulo: "De que forma?", multipla: true,
          opcoes: [
            { cod: "grosseria", rotulo: "Tratamento grosseiro ou desrespeitoso" },
            { cod: "ordens_diferentes", rotulo: "Ordens diferentes das do encarregado" },
            { cod: "fora_contrato", rotulo: "Exigências fora das atividades contratadas" },
            { cod: "cobranca", rotulo: "Cobranças excessivas ou injustas" },
          ],
        },
      },
    ],
  },
  {
    id: "p5", numero: 5, max: 1, tema: "Condições de trabalho no órgão público",
    titulo: "Como você avalia as condições de trabalho dentro do órgão público?",
    opcoes: [
      { cod: "boas", rotulo: "Boas: tenho condições adequadas", tom: "pos" },
      { cod: "regulares", rotulo: "Regulares: existem dificuldades", tom: "neu", sinal: "orgao", complemento: DIFICULDADES_ORGAO },
      { cod: "ruins", rotulo: "Ruins: prejudicam meu trabalho", tom: "neg", sinal: "orgao", complemento: DIFICULDADES_ORGAO },
    ],
  },
  {
    id: "p6", numero: 6, max: 1, tema: "Melhor empresa para trabalhar no local",
    titulo: "Entre as empresas que prestam serviços na universidade, qual você considera a melhor para trabalhar?",
    opcoes: [
      { cod: "grupo_nascimento", rotulo: "Grupo Nascimento", tom: "pos" },
      {
        cod: "outra", rotulo: "Outra empresa", tom: "neg", sinal: "empresa",
        complemento: {
          titulo: "E qual é seu principal diferencial?", multipla: false,
          texto: { rotulo: "Qual empresa?", max: 80 },
          opcoes: [
            { cod: "salario", rotulo: "Salário e benefícios" },
            { cod: "tratamento", rotulo: "Tratamento dos funcionários" },
            { cod: "condicoes", rotulo: "Condições de trabalho" },
            { cod: "horarios", rotulo: "Horários e escalas" },
          ],
        },
      },
      { cod: "nao_conhece", rotulo: "Não conheço as condições das outras empresas para comparar", tom: "neu" },
    ],
  },
  {
    id: "p7", numero: 7, max: 1, tema: "Indicaria a empresa a um amigo",
    titulo: "Você indicaria o Grupo Nascimento para um amigo trabalhar?",
    opcoes: [
      { cod: "sim", rotulo: "Sim, com certeza", tom: "pos" },
      { cod: "sim_mas", rotulo: "Sim, mas há pontos a melhorar", tom: "neu" },
      {
        cod: "nao", rotulo: "Não indicaria", tom: "neg", sinal: "empresa",
        complemento: {
          titulo: "Qual é o principal motivo?", multipla: false,
          opcoes: [
            { cod: "salario", rotulo: "Salário e benefícios" },
            { cod: "tratamento", rotulo: "Tratamento recebido" },
            { cod: "condicoes", rotulo: "Condições de trabalho" },
            { cod: "sem_apoio", rotulo: "Falta de apoio da empresa" },
          ],
        },
      },
    ],
  },
  {
    id: "p8", numero: 8, max: 3, tema: "Prioridades de melhoria",
    titulo: "Quais devem ser as prioridades do Grupo Nascimento para melhorar o trabalho?",
    opcoes: [
      { cod: "salario", rotulo: "Melhorar salários e benefícios" },
      { cod: "comunicacao", rotulo: "Melhorar comunicação e apoio" },
      { cod: "liderancas", rotulo: "Capacitar e melhorar as lideranças" },
      { cod: "materiais", rotulo: "Melhorar materiais e condições de trabalho" },
      { cod: "fiscais", rotulo: "Melhorar relacionamento com os fiscais" },
      { cod: "reconhecimento", rotulo: "Valorizar e reconhecer os funcionários" },
      { cod: "manter", rotulo: "Manter as condições atuais: estou satisfeito", exclusiva: true },
    ],
  },
];

export const CATEGORIA_ROTULO: Record<Categoria, string> = {
  empresa: "Problemas da empresa",
  fiscais: "Problemas com os fiscais",
  orgao: "Estrutura do órgão público",
  pessoal: "Questões pessoais",
};

/** Abaixo disso o grupo não é detalhado (anonimato: posto com 1-2 pessoas). */
export const MIN_RESPOSTAS_GRUPO = 3;

export const perguntaPorId = (id: string) => PERGUNTAS.find((p) => p.id === id);
export const opcaoDe = (pid: string, cod: string) => perguntaPorId(pid)?.opcoes.find((o) => o.cod === cod);

// ─── Respostas ─────────────────────────────────────────────────────────────

export interface RespostaPergunta {
  marcadas: string[];
  /** Perguntas de até 3: a mais importante entre as marcadas. */
  principal?: string;
  /** Complemento de cada alternativa marcada que tem complemento. */
  comp?: Record<string, string[]>;
  /** Texto curto do complemento (pergunta 6, "Qual empresa?"). */
  texto?: Record<string, string>;
}
export type Respostas = Record<string, RespostaPergunta>;

export const respostaVazia = (): RespostaPergunta => ({ marcadas: [] });

/**
 * Marca/desmarca uma alternativa respeitando as regras do documento: resposta
 * única troca; até 3 não deixa passar da quarta; a exclusiva limpa as outras
 * (e as outras limpam a exclusiva). Complemento e "mais importante" de quem
 * saiu somem junto. Com uma só marcada, ela já é a mais importante.
 */
export function alternar(p: Pergunta, atual: RespostaPergunta | undefined, cod: string): RespostaPergunta {
  const r = atual ?? respostaVazia();
  const op = p.opcoes.find((o) => o.cod === cod);
  if (!op) return r;
  let marcadas: string[];
  if (p.max === 1) {
    marcadas = r.marcadas[0] === cod ? [] : [cod];
  } else if (r.marcadas.includes(cod)) {
    marcadas = r.marcadas.filter((c) => c !== cod);
  } else if (op.exclusiva) {
    marcadas = [cod];
  } else {
    const semExclusiva = r.marcadas.filter((c) => !p.opcoes.find((o) => o.cod === c)?.exclusiva);
    if (semExclusiva.length >= p.max) return r;
    marcadas = [...semExclusiva, cod];
  }
  const comp: Record<string, string[]> = {};
  const texto: Record<string, string> = {};
  for (const c of marcadas) {
    if (r.comp?.[c]) comp[c] = r.comp[c];
    if (r.texto?.[c] !== undefined) texto[c] = r.texto[c];
  }
  const out: RespostaPergunta = { marcadas };
  if (p.max > 1) {
    // Marcou mais uma: a pessoa escolhe de novo qual é a mais importante (se
    // a primeira ficasse como principal sozinha, quem não lê a pergunta de
    // baixo enviaria a primeira que tocou). Desmarcou: a escolhida continua.
    const acrescentou = marcadas.length > r.marcadas.length;
    if (marcadas.length === 1) out.principal = marcadas[0];
    else if (!acrescentou && r.principal && marcadas.includes(r.principal)) out.principal = r.principal;
  }
  if (Object.keys(comp).length) out.comp = comp;
  if (Object.keys(texto).length) out.texto = texto;
  return out;
}

/** Marca/desmarca uma alternativa do complemento (todas as aplicáveis, ou uma só). */
export function alternarComplemento(p: Pergunta, atual: RespostaPergunta, opCod: string, cod: string): RespostaPergunta {
  const comp = p.opcoes.find((o) => o.cod === opCod)?.complemento;
  if (!comp || !atual.marcadas.includes(opCod)) return atual;
  const antes = atual.comp?.[opCod] ?? [];
  const depois = comp.multipla
    ? (antes.includes(cod) ? antes.filter((c) => c !== cod) : [...antes, cod])
    : (antes[0] === cod ? [] : [cod]);
  const novo = { ...(atual.comp ?? {}) };
  if (depois.length) novo[opCod] = depois; else delete novo[opCod];
  const out: RespostaPergunta = { ...atual, comp: novo };
  if (!Object.keys(novo).length) delete out.comp;
  return out;
}

/** Erros de UMA pergunta, em português para a tela. Vazio = ok. */
export function errosDaPergunta(p: Pergunta, r: RespostaPergunta | undefined): string[] {
  const erros: string[] = [];
  const marcadas = r?.marcadas ?? [];
  if (!marcadas.length) return [`Responda a pergunta ${p.numero}.`];
  const validas = new Set(p.opcoes.map((o) => o.cod));
  if (marcadas.some((c) => !validas.has(c)) || new Set(marcadas).size !== marcadas.length) erros.push(`Pergunta ${p.numero}: alternativa inválida.`);
  if (marcadas.length > p.max) erros.push(`Pergunta ${p.numero}: marque no máximo ${p.max}.`);
  if (marcadas.length > 1 && marcadas.some((c) => p.opcoes.find((o) => o.cod === c)?.exclusiva)) {
    erros.push(`Pergunta ${p.numero}: "${p.opcoes.find((o) => o.exclusiva)?.rotulo}" não pode ser combinada com outras opções.`);
  }
  if (p.max > 1 && (!r?.principal || !marcadas.includes(r.principal))) erros.push(`Pergunta ${p.numero}: indique a mais importante entre as que marcou.`);
  for (const op of p.opcoes) {
    const sel = r?.comp?.[op.cod] ?? [];
    if (!op.complemento) continue;
    if (!marcadas.includes(op.cod)) continue;
    const okCods = new Set(op.complemento.opcoes.map((o) => o.cod));
    if (!sel.length) erros.push(`Pergunta ${p.numero}: responda "${op.complemento.titulo}".`);
    else if (sel.some((c) => !okCods.has(c)) || (!op.complemento.multipla && sel.length > 1)) erros.push(`Pergunta ${p.numero}: complemento inválido.`);
    if (op.complemento.texto) {
      const t = (r?.texto?.[op.cod] ?? "").trim();
      if (!t) erros.push(`Pergunta ${p.numero}: responda "${op.complemento.texto.rotulo}".`);
      else if (t.length > op.complemento.texto.max) erros.push(`Pergunta ${p.numero}: "${op.complemento.texto.rotulo}" com no máximo ${op.complemento.texto.max} letras.`);
    }
  }
  return erros;
}

/** Todas as perguntas são obrigatórias. */
export function validarRespostas(r: Respostas): string[] {
  return PERGUNTAS.flatMap((p) => errosDaPergunta(p, r[p.id]));
}

/**
 * As regras que o banco confere em pp_responder (pp_regras() na migration).
 * O teste compara este JSON com o que está escrito no SQL.
 */
export function regrasParaBanco() {
  const out: Record<string, unknown> = {};
  for (const p of PERGUNTAS) {
    const comp: Record<string, unknown> = {};
    for (const o of p.opcoes) {
      if (!o.complemento) continue;
      comp[o.cod] = {
        multipla: o.complemento.multipla,
        opcoes: o.complemento.opcoes.map((x) => x.cod),
        texto_max: o.complemento.texto?.max ?? 0,
      };
    }
    out[p.id] = {
      max: p.max,
      opcoes: p.opcoes.map((o) => o.cod),
      exclusivas: p.opcoes.filter((o) => o.exclusiva).map((o) => o.cod),
      comp,
    };
  }
  return out;
}

// ─── Relatórios ────────────────────────────────────────────────────────────

/** Uma resposta como a RPC pp_respostas devolve (sem nada que identifique quem respondeu). */
export interface LinhaResposta {
  aplicacao_id: string;
  /** "YYYY-MM" — o dia não sai do banco. */
  mes: string;
  empresa: number | null;
  filial: number | null;
  contrato: string;
  posto: string | null;
  posto_nome: string | null;
  funcao: string;
  r: Respostas;
}

export type Dimensao = "contrato" | "posto" | "funcao" | "mes" | "aplicacao";

export const chaveContrato = (empresa: number | null, filial: number | null) => `${empresa ?? "?"}-${filial ?? "?"}`;
export const normFuncao = (s: string | null | undefined) => (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();

export function chaveDe(l: Pick<LinhaResposta, "empresa" | "filial" | "posto" | "funcao" | "mes" | "aplicacao_id">, d: Dimensao): string {
  switch (d) {
    case "contrato": return chaveContrato(l.empresa, l.filial);
    case "posto": return l.posto ?? `sem-posto:${chaveContrato(l.empresa, l.filial)}`;
    case "funcao": return normFuncao(l.funcao);
    case "mes": return l.mes;
    case "aplicacao": return l.aplicacao_id;
  }
}

export function rotuloDe(l: Pick<LinhaResposta, "contrato" | "posto" | "posto_nome" | "funcao" | "mes">, d: Dimensao): string {
  switch (d) {
    case "contrato": return l.contrato;
    case "posto": return l.posto ? (l.posto_nome ? `${l.posto} · ${l.posto_nome}` : l.posto) : `Sem posto informado · ${l.contrato}`;
    case "funcao": return normFuncao(l.funcao);
    case "mes": return l.mes;
    case "aplicacao": return l.mes;
  }
}

export interface Filtro {
  contrato?: string | null;
  posto?: string | null;
  funcao?: string | null;
  aplicacao?: string | null;
  /** "YYYY-MM", inclusivo. */
  de?: string | null;
  ate?: string | null;
}

export function filtrar(linhas: LinhaResposta[], f: Filtro): LinhaResposta[] {
  return linhas.filter((l) =>
    (!f.contrato || chaveDe(l, "contrato") === f.contrato)
    && (!f.posto || chaveDe(l, "posto") === f.posto)
    && (!f.funcao || chaveDe(l, "funcao") === normFuncao(f.funcao))
    && (!f.aplicacao || l.aplicacao_id === f.aplicacao)
    && (!f.de || l.mes >= f.de)
    && (!f.ate || l.mes <= f.ate));
}

const pct = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : 0);

export interface ContagemOpcao {
  cod: string; rotulo: string;
  /** Quantos marcaram / % dos que responderam. */
  n: number; pct: number;
  /** Quantos indicaram como a MAIS importante (perguntas de até 3). */
  principal: number; pctPrincipal: number;
  comp: { cod: string; rotulo: string; n: number; pct: number }[];
  /** Respostas do texto curto (pergunta 6), agrupadas. */
  textos: { texto: string; n: number }[];
}

/** Quantidades e percentuais de uma pergunta. Base = quem respondeu a pergunta. */
export function contarPergunta(linhas: LinhaResposta[], pid: string): { total: number; opcoes: ContagemOpcao[] } {
  const p = perguntaPorId(pid);
  if (!p) return { total: 0, opcoes: [] };
  const comResposta = linhas.filter((l) => (l.r?.[pid]?.marcadas ?? []).length > 0);
  const total = comResposta.length;
  const opcoes = p.opcoes.map((o): ContagemOpcao => {
    const marcaram = comResposta.filter((l) => l.r[pid].marcadas.includes(o.cod));
    const n = marcaram.length;
    const principal = p.max > 1 ? comResposta.filter((l) => l.r[pid].principal === o.cod).length : n;
    const comp = (o.complemento?.opcoes ?? []).map((c) => {
      const k = marcaram.filter((l) => (l.r[pid].comp?.[o.cod] ?? []).includes(c.cod)).length;
      return { cod: c.cod, rotulo: c.rotulo, n: k, pct: pct(k, n) };
    }).sort((a, b) => b.n - a.n);
    const porTexto = new Map<string, number>();
    if (o.complemento?.texto) {
      for (const l of marcaram) {
        const t = normFuncao(l.r[pid].texto?.[o.cod]);
        if (t) porTexto.set(t, (porTexto.get(t) ?? 0) + 1);
      }
    }
    const textos = [...porTexto.entries()].map(([texto, k]) => ({ texto, n: k })).sort((a, b) => b.n - a.n);
    return { cod: o.cod, rotulo: o.rotulo, n, pct: pct(n, total), principal, pctPrincipal: pct(principal, total), comp, textos };
  });
  return { total, opcoes };
}

/** Perguntas que entram no índice de satisfação (as de resposta única com tom). */
const PERGUNTAS_TOM = PERGUNTAS.filter((p) => p.opcoes.some((o) => o.tom));

export interface Indicadores {
  n: number;
  /** % das avaliações (P3–P7) que foram positivas / negativas. */
  satisfacao: number;
  insatisfacao: number;
  /** P7: "Sim, com certeza" − "Não indicaria", em pontos (estilo NPS). */
  recomendacao: number;
  naoIndicaria: number;
  /** P6: % que acha outra empresa melhor para trabalhar. */
  prefereOutra: number;
  /** % de respondentes com pelo menos uma avaliação negativa na categoria. */
  sinais: Record<Categoria, number>;
  /** P2: o motivo que mais aparece como o MAIS importante para sair. */
  riscoPrincipal: { cod: string; rotulo: string; n: number; pct: number } | null;
  /** P8: a prioridade mais indicada como a mais importante. */
  prioridadePrincipal: { cod: string; rotulo: string; n: number; pct: number } | null;
}

function maisImportante(linhas: LinhaResposta[], pid: string) {
  const c = contarPergunta(linhas, pid);
  const top = [...c.opcoes].sort((a, b) => b.principal - a.principal || b.n - a.n)[0];
  return top && top.principal > 0 ? { cod: top.cod, rotulo: top.rotulo, n: top.principal, pct: top.pctPrincipal } : null;
}

export function indicadores(linhas: LinhaResposta[]): Indicadores {
  let pos = 0, neg = 0, aval = 0;
  const comSinal: Record<Categoria, number> = { empresa: 0, fiscais: 0, orgao: 0, pessoal: 0 };
  for (const l of linhas) {
    const cats = new Set<Categoria>();
    for (const p of PERGUNTAS_TOM) {
      const cod = l.r?.[p.id]?.marcadas?.[0];
      const op = cod ? p.opcoes.find((o) => o.cod === cod) : undefined;
      if (!op?.tom) continue;
      aval++;
      if (op.tom === "pos") pos++;
      if (op.tom === "neg") neg++;
      if (op.sinal) cats.add(op.sinal);
    }
    // Pergunta 2 marcando "Questões pessoais…" é o único sinal da categoria pessoal.
    if (l.r?.p2?.marcadas?.includes("pessoais")) cats.add("pessoal");
    cats.forEach((c) => { comSinal[c]++; });
  }
  const n = linhas.length;
  const p7 = contarPergunta(linhas, "p7");
  const p6 = contarPergunta(linhas, "p6");
  const p7n = (cod: string) => p7.opcoes.find((o) => o.cod === cod)?.pct ?? 0;
  return {
    n,
    satisfacao: pct(pos, aval),
    insatisfacao: pct(neg, aval),
    recomendacao: Math.round((p7n("sim") - p7n("nao")) * 10) / 10,
    naoIndicaria: p7n("nao"),
    prefereOutra: p6.opcoes.find((o) => o.cod === "outra")?.pct ?? 0,
    sinais: {
      empresa: pct(comSinal.empresa, n), fiscais: pct(comSinal.fiscais, n),
      orgao: pct(comSinal.orgao, n), pessoal: pct(comSinal.pessoal, n),
    },
    riscoPrincipal: maisImportante(linhas, "p2"),
    prioridadePrincipal: maisImportante(linhas, "p8"),
  };
}

export interface Grupo { chave: string; rotulo: string; linhas: LinhaResposta[]; ind: Indicadores; /** Poucas respostas: não detalhar. */ reservado: boolean }

/** Agrupa por contrato/posto/função/mês/aplicação, maior grupo primeiro (mês em ordem). */
export function agrupar(linhas: LinhaResposta[], d: Dimensao, minimo = MIN_RESPOSTAS_GRUPO): Grupo[] {
  const m = new Map<string, { rotulo: string; linhas: LinhaResposta[] }>();
  for (const l of linhas) {
    const k = chaveDe(l, d);
    const g = m.get(k) ?? { rotulo: rotuloDe(l, d), linhas: [] };
    g.linhas.push(l);
    m.set(k, g);
  }
  const out = [...m.entries()].map(([chave, g]) => ({
    chave, rotulo: g.rotulo, linhas: g.linhas, ind: indicadores(g.linhas), reservado: g.linhas.length < minimo,
  }));
  return d === "mes" || d === "aplicacao"
    ? out.sort((a, b) => a.rotulo.localeCompare(b.rotulo))
    : out.sort((a, b) => b.linhas.length - a.linhas.length || a.rotulo.localeCompare(b.rotulo));
}

export interface DetalheProblema { pergunta: string; origem: string; cod: string; rotulo: string; n: number; pct: number }
export interface ResumoCategoria {
  categoria: Categoria;
  rotulo: string;
  /** % de respondentes com avaliação negativa nesta categoria (P3–P7). */
  pctRespondentes: number;
  /** P2: motivos de saída desta categoria (marcados e mais importantes). */
  riscoSaida: { cod: string; rotulo: string; n: number; pct: number; principal: number }[];
  /** Os complementos ("Quais dificuldades?" etc.) mais marcados. */
  detalhes: DetalheProblema[];
}

/** Resumo gerencial do documento: empresa × fiscais × estrutura do órgão. */
export function resumoGerencial(linhas: LinhaResposta[]): ResumoCategoria[] {
  const n = linhas.length;
  const ind = indicadores(linhas);
  const p2 = contarPergunta(linhas, "p2");
  const cats: Categoria[] = ["empresa", "fiscais", "orgao", "pessoal"];
  return cats.map((cat) => {
    const riscoSaida = PERGUNTAS[1].opcoes.filter((o) => o.categoria === cat).map((o) => {
      const c = p2.opcoes.find((x) => x.cod === o.cod)!;
      return { cod: o.cod, rotulo: o.rotulo, n: c.n, pct: c.pct, principal: c.principal };
    }).sort((a, b) => b.n - a.n);
    const detalhes: DetalheProblema[] = [];
    for (const p of PERGUNTAS) {
      const cont = contarPergunta(linhas, p.id);
      for (const o of p.opcoes) {
        const daCategoria = p.id === "p2" ? o.categoria === cat : o.sinal === cat;
        if (!daCategoria || !o.complemento) continue;
        const c = cont.opcoes.find((x) => x.cod === o.cod)!;
        for (const d of c.comp) {
          if (d.n > 0) detalhes.push({ pergunta: p.id, origem: `${p.numero}. ${o.rotulo} › ${o.complemento.titulo}`, cod: d.cod, rotulo: d.rotulo, n: d.n, pct: pct(d.n, n) });
        }
      }
    }
    detalhes.sort((a, b) => b.n - a.n);
    return { categoria: cat, rotulo: CATEGORIA_ROTULO[cat], pctRespondentes: ind.sinais[cat], riscoSaida, detalhes };
  });
}

export interface PontoAtencao {
  dimensao: Dimensao; chave: string; rotulo: string; n: number;
  indicador: "insatisfacao" | Categoria | "naoIndicaria" | "prefereOutra";
  descricao: string; valor: number; geral: number;
}

const DESCRICAO_PONTO: Record<PontoAtencao["indicador"], string> = {
  insatisfacao: "Insatisfação (avaliações negativas)",
  empresa: "Avaliação negativa da empresa (encarregado, indicação, concorrência)",
  fiscais: "Problema com os fiscais do órgão",
  orgao: "Condições ruins no órgão público",
  pessoal: "Questões pessoais/transporte como motivo de saída",
  naoIndicaria: "Não indicaria a empresa",
  prefereOutra: "Acha outra empresa melhor para trabalhar",
};

/**
 * Onde um grupo está pior que o geral: pelo menos `folga` pontos acima do
 * geral E pelo menos `piso`% — os dois juntos, para não acusar contrato com
 * 3 respostas e 5% ou o geral inteiro ruim por igual. Grupos reservados
 * (poucas respostas) ficam de fora.
 */
export function pontosDeAtencao(linhas: LinhaResposta[], d: Dimensao = "contrato", folga = 15, piso = 30): PontoAtencao[] {
  const geral = indicadores(linhas);
  const out: PontoAtencao[] = [];
  for (const g of agrupar(linhas, d)) {
    if (g.reservado) continue;
    const pares: [PontoAtencao["indicador"], number, number][] = [
      ["insatisfacao", g.ind.insatisfacao, geral.insatisfacao],
      ["empresa", g.ind.sinais.empresa, geral.sinais.empresa],
      ["fiscais", g.ind.sinais.fiscais, geral.sinais.fiscais],
      ["orgao", g.ind.sinais.orgao, geral.sinais.orgao],
      ["naoIndicaria", g.ind.naoIndicaria, geral.naoIndicaria],
      ["prefereOutra", g.ind.prefereOutra, geral.prefereOutra],
    ];
    for (const [indicador, valor, ger] of pares) {
      if (valor >= piso && valor - ger >= folga) {
        out.push({ dimensao: d, chave: g.chave, rotulo: g.rotulo, n: g.linhas.length, indicador, descricao: DESCRICAO_PONTO[indicador], valor, geral: ger });
      }
    }
  }
  return out.sort((a, b) => (b.valor - b.geral) - (a.valor - a.geral));
}

// ─── Rotatividade (a mesma conta do Turn-over) ─────────────────────────────

/**
 * Uma combinação contrato × posto × função, mês a mês, como pp_turnover
 * devolve. É a regra de dir_turnover_variacao_efetivo (Relatórios ›
 * Turn-over › Variação de Efetivo): trabalhando = efetivo no fim do mês,
 * demissões/admissões = no mês; só que recortada pela filial da Senior, pelo
 * posto e pela função, que é o recorte da pesquisa.
 */
export interface LinhaTurnover {
  empresa: number | null; filial: number | null; contrato: string;
  posto: string | null; posto_nome: string | null; funcao: string;
  trab: number[]; dem: number[]; adm: number[];
}

export interface GrupoTurnover { chave: string; rotulo: string; efetivoMedio: number; demissoes: number; admissoes: number; taxa: number | null }

const soma = (a: number[]) => a.reduce((s, x) => s + (Number(x) || 0), 0);

/**
 * Turnover médio mensal do período = Σ demissões ÷ Σ efetivo no fim de cada
 * mês × 100. É a média das taxas mensais (demissões ÷ efetivo × 100 do
 * Turn-over) ponderada pelo efetivo — mês com 3 pessoas não pesa como mês com 300.
 */
export function taxaTurnover(trab: number[], dem: number[]): number | null {
  const t = soma(trab);
  return t > 0 ? Math.round((soma(dem) / t) * 1000) / 10 : null;
}

export function agruparTurnover(linhas: LinhaTurnover[], d: Exclude<Dimensao, "mes" | "aplicacao">): GrupoTurnover[] {
  const m = new Map<string, { rotulo: string; trab: number[]; dem: number[]; adm: number[] }>();
  for (const l of linhas) {
    const base = { ...l, mes: "", aplicacao_id: "" };
    const k = chaveDe(base, d);
    const g = m.get(k) ?? { rotulo: rotuloDe(base, d), trab: [], dem: [], adm: [] };
    l.trab.forEach((v, i) => { g.trab[i] = (g.trab[i] ?? 0) + (Number(v) || 0); });
    l.dem.forEach((v, i) => { g.dem[i] = (g.dem[i] ?? 0) + (Number(v) || 0); });
    l.adm.forEach((v, i) => { g.adm[i] = (g.adm[i] ?? 0) + (Number(v) || 0); });
    m.set(k, g);
  }
  return [...m.entries()].map(([chave, g]) => ({
    chave, rotulo: g.rotulo,
    efetivoMedio: g.trab.length ? Math.round(soma(g.trab) / g.trab.length) : 0,
    demissoes: soma(g.dem), admissoes: soma(g.adm), taxa: taxaTurnover(g.trab, g.dem),
  })).sort((a, b) => (b.taxa ?? -1) - (a.taxa ?? -1) || b.demissoes - a.demissoes);
}

export function filtrarTurnover(linhas: LinhaTurnover[], f: Filtro): LinhaTurnover[] {
  return linhas.filter((l) => {
    const base = { ...l, mes: "", aplicacao_id: "" };
    return (!f.contrato || chaveDe(base, "contrato") === f.contrato)
      && (!f.posto || chaveDe(base, "posto") === f.posto)
      && (!f.funcao || chaveDe(base, "funcao") === normFuncao(f.funcao));
  });
}

// ─── Contexto da I.A ───────────────────────────────────────────────────────

const resumoPergunta = (linhas: LinhaResposta[], pid: string) => {
  const p = perguntaPorId(pid)!;
  const c = contarPergunta(linhas, pid);
  return {
    pergunta: `${p.numero}. ${p.titulo}`,
    respostas: c.total,
    alternativas: c.opcoes.filter((o) => o.n > 0).map((o) => ({
      alternativa: o.rotulo, marcaram: o.n, pct: o.pct,
      ...(p.max > 1 ? { mais_importante: o.principal, pct_mais_importante: o.pctPrincipal } : {}),
      ...(o.comp.some((x) => x.n > 0) ? { detalhe: o.comp.filter((x) => x.n > 0).map((x) => `${x.rotulo}: ${x.n}`) } : {}),
      // Texto livre só aparece repetido (2+), para não levar nada que identifique alguém.
      ...(o.textos.some((t) => t.n >= 2) ? { empresas_citadas: o.textos.filter((t) => t.n >= 2).map((t) => `${t.texto}: ${t.n}`) } : {}),
    })),
  };
};

const resumoGrupo = (g: Grupo) => ({
  grupo: g.rotulo, respostas: g.linhas.length,
  satisfacao_pct: g.ind.satisfacao, insatisfacao_pct: g.ind.insatisfacao,
  recomendacao_pts: g.ind.recomendacao, nao_indicaria_pct: g.ind.naoIndicaria, prefere_outra_empresa_pct: g.ind.prefereOutra,
  negativo_empresa_pct: g.ind.sinais.empresa, negativo_fiscais_pct: g.ind.sinais.fiscais, negativo_orgao_pct: g.ind.sinais.orgao,
  motivo_saida_mais_importante: g.ind.riscoPrincipal ? `${g.ind.riscoPrincipal.rotulo} (${g.ind.riscoPrincipal.n})` : null,
  prioridade_mais_importante: g.ind.prioridadePrincipal ? `${g.ind.prioridadePrincipal.rotulo} (${g.ind.prioridadePrincipal.n})` : null,
});

/**
 * O que vai para a I.A: só agregados. Nenhuma resposta individual, nenhum
 * nome (a pesquisa nem coleta), grupos com menos de MIN_RESPOSTAS_GRUPO
 * respostas só entram no total. A rotatividade vai por contrato, posto e
 * função, com a mesma conta da tela.
 */
export function contextoIA(linhas: LinhaResposta[], turnover: LinhaTurnover[], meses: string[], filtro: Filtro = {}) {
  const ls = filtrar(linhas, filtro);
  const tv = filtrarTurnover(turnover, filtro);
  const porContratoT = new Map(agruparTurnover(tv, "contrato").map((g) => [g.chave, g]));
  const comTurnover = (d: Exclude<Dimensao, "mes" | "aplicacao">, limite: number) => {
    const t = new Map(agruparTurnover(tv, d).map((g) => [g.chave, g]));
    return agrupar(ls, d).filter((g) => !g.reservado).slice(0, limite).map((g) => {
      const x = t.get(g.chave);
      return { ...resumoGrupo(g), turnover_mensal_pct: x?.taxa ?? null, demissoes_periodo: x?.demissoes ?? null, efetivo_medio: x?.efetivoMedio ?? null };
    });
  };
  const ind = indicadores(ls);
  return {
    filtro,
    periodo_turnover: meses.length ? `${meses[0]} a ${meses[meses.length - 1]} (${meses.length} meses)` : null,
    regra_turnover: "turnover mensal médio = demissões do período ÷ soma do efetivo no fim de cada mês × 100 (mesma conta do Relatórios › Turn-over).",
    total_respostas: ls.length,
    minimo_por_grupo: MIN_RESPOSTAS_GRUPO,
    indicadores_gerais: {
      satisfacao_pct: ind.satisfacao, insatisfacao_pct: ind.insatisfacao, recomendacao_pts: ind.recomendacao,
      nao_indicaria_pct: ind.naoIndicaria, prefere_outra_empresa_pct: ind.prefereOutra,
      negativo_por_categoria_pct: ind.sinais,
    },
    respostas_por_pergunta: PERGUNTAS.map((p) => resumoPergunta(ls, p.id)),
    resumo_gerencial: resumoGerencial(ls).map((c) => ({
      categoria: c.rotulo, respondentes_com_avaliacao_negativa_pct: c.pctRespondentes,
      motivos_de_saida: c.riscoSaida.filter((x) => x.n > 0).map((x) => `${x.rotulo}: ${x.n} (${x.pct}%), mais importante para ${x.principal}`),
      detalhes: c.detalhes.slice(0, 8).map((x) => `${x.origem} › ${x.rotulo}: ${x.n}`),
    })),
    pontos_de_atencao: [...pontosDeAtencao(ls, "contrato"), ...pontosDeAtencao(ls, "funcao")].slice(0, 25)
      .map((p) => `${p.dimensao} ${p.rotulo} (${p.n} respostas): ${p.descricao} ${p.valor}% contra ${p.geral}% no geral`),
    por_contrato: comTurnover("contrato", 60),
    por_funcao: comTurnover("funcao", 40),
    por_posto: comTurnover("posto", 40),
    por_periodo: agrupar(ls, "mes").map(resumoGrupo),
    // Contratos que perdem gente e ainda não responderam (ou responderam pouco).
    rotatividade_sem_pesquisa_suficiente: agruparTurnover(tv, "contrato")
      .filter((g) => g.taxa !== null && (ls.filter((l) => chaveDe(l, "contrato") === g.chave).length < MIN_RESPOSTAS_GRUPO))
      .slice(0, 20).map((g) => ({ contrato: g.rotulo, turnover_mensal_pct: g.taxa, demissoes_periodo: g.demissoes, efetivo_medio: g.efetivoMedio })),
    turnover_geral_pct: taxaTurnover(tv.flatMap((l) => l.trab), tv.flatMap((l) => l.dem)),
    contratos_com_turnover: porContratoT.size,
  };
}

// ─── Dentro do Formulários (mig 20261030001000) ───────────────────────────
//
// Pablo, 30/10/2026: "tem que ficar exatamente igual, não precisa ter um
// sistema novo de formulário" e "tira do RH essa pesquisa permanência, vai
// ficar só no formulários". A pesquisa virou um formulário comum da Central
// de Serviços (CS_FORMULARIOS, id fixo abaixo), com dois tipos de pergunta
// que o Formulários ganhou para isso e que qualquer formulário pode usar:
//   · "local_trabalho" — Contrato → Posto de trabalho → Função, da Senior;
//   · "escolha_complemento" — até N escolhas + a MAIS importante, alternativa
//     exclusiva e complemento que abre embaixo da alternativa escolhida.
// O catálogo (PERGUNTAS, com tom/categoria/sinal de cada alternativa) continua
// aqui: os relatórios leem a resposta pelo `config.codigo` da pergunta (p1..p8)
// e pelo `cod` da alternativa, então renomear o texto de uma opção no editor
// não muda o que ela significa. A migration grava perguntasDoFormulario() e o
// teste confere que o JSON de lá é este.

export const FORMULARIO_PERMANENCIA_ID = "6990cfd5-d0b1-4c59-bcde-48d0f88e70cb";
export const SLUG_PERMANENCIA = "pesquisa-permanencia";
export const TIPO_LOCAL = "local_trabalho";
export const TIPO_ESCOLHA = "escolha_complemento";
export const TITULO_LOCAL = "Onde você trabalha";

/** Id fixo de cada pergunta no formulário (a migração das respostas antigas usa os mesmos). */
export const ID_PERGUNTA_FORM: Record<string, string> = {
  local: "65c6c19d-a958-47fb-8b66-1b07bd7a58dc",
  p1: "4e5df533-32eb-4940-baff-4d573e864846",
  p2: "2c95e9da-12d2-467b-bdee-f6501cac74f8",
  p3: "88b052b7-3136-4f4e-a8ad-69cf968afe98",
  p4: "37a1620a-e8cd-4fff-aaba-2ab6e7d4b80e",
  p5: "81f8233e-fbba-4069-86bb-66573f72896f",
  p6: "d077e8ec-8b72-4949-80e4-da39a7000cce",
  p7: "cdc477b0-f272-491b-bb14-dfa03b5c57be",
  p8: "231250a9-8a01-4b26-bf21-536963f38561",
};

/** O `config` de uma pergunta "escolha_complemento" (o banco valida a mesma forma). */
export interface ConfigEscolha {
  /** Código da pergunta para os relatórios (p1..p8 na pesquisa de permanência). */
  codigo?: string;
  /** 1 = resposta única; >1 = até N escolhas + a mais importante. */
  max: number;
  itens: { cod: string; rotulo: string; exclusiva?: boolean; complemento?: Complemento }[];
}

/** Valor gravado pela pergunta "local_trabalho" (o banco reescreve contrato/posto_nome pelo cadastro). */
export interface ValorLocal {
  empresa: number; filial: number; contrato: string;
  /** null = "Não sei qual é o meu posto". */
  posto: string | null; posto_nome: string | null;
  funcao: string;
}

/** Pergunta do Formulários → a forma que alternar/errosDaPergunta entendem. */
export function paraPergunta(id: string, titulo: string, numero: number, cfg: ConfigEscolha): Pergunta {
  return {
    id, numero, titulo, tema: titulo, max: Math.max(1, Number(cfg?.max) || 1),
    opcoes: (cfg?.itens ?? []).map((o) => ({ cod: o.cod, rotulo: o.rotulo, exclusiva: o.exclusiva, complemento: o.complemento })),
  };
}

/** As perguntas do formulário, na ordem do documento (o que a migration grava). */
export function perguntasDoFormulario() {
  const limpo = <T>(o: T): T => JSON.parse(JSON.stringify(o));
  return [
    { id: ID_PERGUNTA_FORM.local, tipo: TIPO_LOCAL, titulo: TITULO_LOCAL, descricao: null, obrigatoria: true, imagem_url: null, opcoes: [], config: {} },
    ...PERGUNTAS.map((p) => ({
      id: ID_PERGUNTA_FORM[p.id], tipo: TIPO_ESCOLHA, titulo: p.titulo, descricao: null, obrigatoria: true, imagem_url: null,
      opcoes: p.opcoes.map((o) => o.rotulo),
      config: limpo({
        codigo: p.id, max: p.max,
        itens: p.opcoes.map((o) => ({
          cod: o.cod, rotulo: o.rotulo,
          ...(o.exclusiva ? { exclusiva: true } : {}),
          ...(o.complemento ? { complemento: o.complemento } : {}),
        })),
      } satisfies ConfigEscolha),
    })),
  ];
}

interface PerguntaFormMin { id: string; tipo: string; config?: Record<string, unknown> | null }

/** O formulário tem o recorte (local de trabalho) e as perguntas do catálogo? Aí os relatórios de permanência valem. */
export function ehFormularioPermanencia(perguntas: PerguntaFormMin[] | null | undefined): boolean {
  const ps = perguntas ?? [];
  if (!ps.some((p) => p.tipo === TIPO_LOCAL)) return false;
  const codigos = new Set(ps.filter((p) => p.tipo === TIPO_ESCOLHA).map((p) => String(p.config?.codigo ?? "")));
  return PERGUNTAS.every((p) => codigos.has(p.id));
}

/**
 * Respostas do Formulários (CS_FORM_RESPOSTAS, lidas pela RLS de quem pede)
 * → as linhas dos relatórios. Só o mês sai daqui, como na pesquisa antiga.
 * Resposta sem local de trabalho fica de fora (não tem como recortar).
 */
export function linhasDoFormulario(
  perguntas: PerguntaFormMin[],
  respostas: { formulario_id?: string; enviado_em: string; itens: Record<string, unknown> | null }[],
): LinhaResposta[] {
  const local = perguntas.find((p) => p.tipo === TIPO_LOCAL);
  if (!local) return [];
  const porCodigo = perguntas
    .filter((p) => p.tipo === TIPO_ESCOLHA && p.config?.codigo)
    .map((p) => [String(p.config!.codigo), p.id] as const);
  const out: LinhaResposta[] = [];
  for (const r of respostas) {
    const l = r.itens?.[local.id] as ValorLocal | undefined;
    if (!l || typeof l !== "object" || l.empresa == null || l.filial == null) continue;
    const rr: Respostas = {};
    for (const [cod, pid] of porCodigo) {
      const v = r.itens?.[pid] as RespostaPergunta | undefined;
      if (v && Array.isArray(v.marcadas)) rr[cod] = v;
    }
    const d = new Date(r.enviado_em);
    // Mês no fuso de Brasília, como o pp_respostas fazia (to_char … America/Sao_Paulo).
    const mes = isNaN(+d) ? "" : new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 7);
    out.push({
      aplicacao_id: r.formulario_id ?? "", mes,
      empresa: Number(l.empresa), filial: Number(l.filial), contrato: String(l.contrato ?? ""),
      posto: l.posto ?? null, posto_nome: l.posto_nome ?? null, funcao: normFuncao(l.funcao), r: rr,
    });
  }
  return out;
}
