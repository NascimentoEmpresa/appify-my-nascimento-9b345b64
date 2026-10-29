/**
 * Estoque Saudável — tipos e regras de leitura da aba.
 *
 * A conta pesada é toda da RPC `sup_estoque_saudavel` (mig 20261020000021):
 * demanda, estoque de segurança, ponto de pedido, alvo, compra sugerida,
 * dinheiro parado. Aqui mora só o que transforma número em leitura — rótulo,
 * cor, ordenação e as frases que explicam a conta para quem não é de
 * Suprimentos.
 *
 * Por que os limiares NÃO estão neste arquivo, ao contrário de
 * `rotatividadeEstoque.ts`: as premissas (prazo de reposição, nível de
 * serviço, ciclo de revisão, janela, meses sem giro) vivem em
 * `sup_estoque_parametro`, editáveis na própria tela. Duplicá-las aqui criaria
 * dois lugares para a mesma regra e, na primeira divergência, a tela mostraria
 * uma classificação diferente da que o banco usou para calcular o alvo.
 */

export interface PremissasEstoque {
  lead_time_dias: number;
  nivel_servico: number;
  z: number;
  ciclo_revisao_dias: number;
  janela_meses: number;
  meses_sem_giro_morto: number;
  tolerancia_excesso: number;
  janela_inicio: string;
  janela_fim: string;
  ultimo_mes_completo: string;
  dias_janela: number;
}

export type SituacaoEstoque =
  | "falta"
  | "repor"
  | "saudavel"
  | "excesso"
  | "morto"
  | "liquidar"
  | "fora_do_plano"
  | "sem_movimento";

export interface ItemEstoqueSaudavel {
  base_id: string;
  item: string;
  tamanho: string | null;
  ordem: number;
  tipo: string | null;

  disponivel: number;
  reservado: number;
  /** Peças físicas na prateleira, antes de descontar o que já está separado. */
  fisico: number;
  em_transito: number;

  demanda_janela: number;
  demanda_mensal: number;
  demanda_dia: number;
  saida_janela: number;
  dp_mensal: number;
  /** Meses completos de histórico. Abaixo de 2, o alvo é provisório. */
  meses_completos: number;

  lead_time_dias: number;
  seguranca: number;
  ponto_pedido: number;
  alvo_calculado: number;
  /** O que vale: o aprovado manda sobre o calculado. */
  alvo: number;
  minimo: number;
  alvo_aprovado: number | null;
  minimo_aprovado: number | null;
  /** O que está cadastrado hoje em sup_estoque_item — não é o calculado. */
  minimo_cadastrado: number;

  comprar: number;
  excesso: number;
  cobertura_dias: number | null;
  meses_sem_giro: number | null;
  /** Quantas vezes o estoque deste item se renova por ano. */
  giro_anual: number | null;
  /**
   * Quantas compras por ano o modelo exige. Referência, não ranking: como o
   * alvo é consumo × (prazo + ciclo), este número é ~365/(prazo+ciclo) para
   * todo item sem estoque de segurança. Para "o que reponho mais seguido",
   * use `reposicoes`.
   */
  ciclos_por_ano: number | null;
  /** Reposições que de fato aconteceram na janela (entradas, agrupadas por dia). */
  reposicoes: number;
  ultima_reposicao: string | null;
  /** Pedidos deste item avaliados desde que há baixa por item registrada. */
  vezes_pedido: number;
  /** Quantos desses pedidos o estoque NÃO conseguiu atender. */
  vezes_faltou: number;
  unidades_faltaram: number;
  pct_falta: number | null;
  ultima_falta: string | null;
  ultima_saida: string | null;
  /** Última reserva para separação. Reserva não é baixa física. */
  ultima_reserva: string | null;
  ultimo_pedido: string | null;

  valor_unitario: number | null;
  sem_preco: boolean;
  valor_em_estoque: number;
  valor_excesso: number;
  valor_comprar: number;
  valor_consumo: number;

  classe_abc: "A" | "B" | "C" | null;
  classe_xyz: "X" | "Y" | "Z" | null;
  coef_variacao: number | null;

  situacao: SituacaoEstoque;
  liquidar: boolean;
  liquidar_motivo: string | null;
  fora_do_plano: boolean;
  politica_observacao: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
}

export interface FamiliaCompra {
  base_id: string;
  item: string;
  tipo: string | null;
  comprar: number;
  valor_comprar: number;
  disponivel: number;
  alvo: number;
  demanda_mensal: number;
  tamanhos_em_falta: number;
  tamanhos_a_comprar: number;
  grade: { tamanho: string | null; ordem: number; comprar: number; disponivel: number; alvo: number }[];
}

export interface LinhaLiquidar {
  base_id: string;
  item: string;
  tamanho: string | null;
  disponivel: number;
  valor_em_estoque: number;
  meses_sem_giro: number | null;
  ultima_saida: string | null;
  ultima_reserva: string | null;
  ultimo_pedido: string | null;
  ja_marcado: boolean;
  motivo: string | null;
  sem_preco: boolean;
}

export interface LinhaRanking {
  item: string;
  tamanho: string | null;
  situacao?: SituacaoEstoque;
  disponivel?: number;
  demanda_mensal?: number;
  cobertura_dias?: number | null;
  /* mais_roda */
  giro_anual?: number | null;
  /* repor_mais_seguido */
  reposicoes_na_janela?: number;
  dias_entre_reposicoes?: number | null;
  ultima_reposicao?: string | null;
  ciclos_por_ano_modelo?: number | null;
  alvo?: number;
  comprar?: number;
  /* mais_faltou */
  vezes_faltou?: number;
  vezes_pedido?: number;
  pct_falta?: number | null;
  unidades_faltaram?: number;
  ultima_falta?: string | null;
  /* mais_acumulado */
  excesso?: number;
  valor_excesso?: number;
  valor_em_estoque?: number;
  meses_sem_giro?: number | null;
  sem_preco?: boolean;
  /* comprar_urgente */
  em_transito?: number;
  valor_comprar?: number;
  lead_time_dias?: number;
}

export interface RankingsEstoque {
  mais_roda: LinhaRanking[];
  repor_mais_seguido: LinhaRanking[];
  mais_faltou: LinhaRanking[];
  mais_acumulado: LinhaRanking[];
  comprar_urgente: LinhaRanking[];
  /**
   * Desde quando dá para afirmar que um pedido "faltou": a data do primeiro
   * movimento de almoxarifado. Antes dela nenhum pedido tem baixa por item
   * registrada, então todos pareceriam não atendidos. `null` = empresa sem
   * movimento nenhum, e o ranking de falta vem vazio.
   */
  falta_contada_desde: string | null;
  pedidos_avaliados: number;
}

export interface MesEstoque {
  mes: string;
  rotulo: string;
  /** Nulo quando aquele mês ainda não tinha fechamento confiável. */
  saldo: number | null;
  demanda: number;
  alvo: number | null;
  valor: number | null;
  /** Fechamento histórico, posição ao vivo de hoje ou mês sem fechamento. */
  tipo_ponto?: "fechamento" | "hoje" | "sem_fechamento";
}

export interface AlertaEstoque {
  ordem: number;
  tipo:
    | "falta_agora"
    | "sem_preco"
    | "historico_curto"
    | "sem_snapshot"
    | "minimo_cadastrado_divergente"
    | "fora_de_escopo"
    | "demanda_irregular"
    | string;
  titulo: string;
  detalhe: string | null;
  valor: number;
}

export interface EstoqueSaudavelDados {
  atualizado_em: string;
  categoria: string | null;
  pode_editar: boolean;
  premissas: PremissasEstoque;
  filtros: {
    contratos: { id: string; nome: string }[];
    categorias: { valor: string; nome: string }[];
    almoxarifados: { id: string; nome: string }[];
  };
  resumo: {
    itens_planejados: number;
    valor_em_estoque: number;
    unidades_em_estoque: number;
    dinheiro_parado: number;
    valor_morto: number;
    unidades_mortas: number;
    itens_em_falta: number;
    itens_a_repor: number;
    itens_em_excesso: number;
    itens_saudaveis: number;
    itens_mortos: number;
    unidades_a_comprar: number;
    valor_a_comprar: number;
    /** Itens que JÁ deixaram pedido sem atendimento — histórico, não hoje. */
    itens_que_faltaram: number;
    pedidos_nao_atendidos: number;
    itens_sem_preco: number;
    alvos_aprovados: number;
    cobertura_media_dias: number | null;
    demanda_mensal_total: number;
    demanda_fora_de_escopo: number;
    primeiro_movimento: string | null;
  };
  /**
   * Topos calculados sobre o CATÁLOGO INTEIRO, no banco.
   *
   * Existem para o assistente poder responder "qual item mais/menos ..." — a
   * lista `itens` vai truncada para o prompt da I.A, e um topo tirado de
   * amostra é resposta errada com cara de certa. Ao acrescentar pergunta
   * pronta no chat, confira se há ranking que a sustente.
   */
  rankings: RankingsEstoque;
  itens: ItemEstoqueSaudavel[];
  compra_por_familia: FamiliaCompra[];
  liquidar: LinhaLiquidar[];
  evolucao: MesEstoque[];
  alertas: AlertaEstoque[];
}

export interface FiltroEstoqueSaudavel {
  janelaMeses: number | null;
  contratoId: string | null;
  categoria: string | null;
  almoxarifadoId: string | null;
}

/* ------------------------------------------------------------------ */
/* Rótulos e cores                                                    */
/* ------------------------------------------------------------------ */

/**
 * O rótulo é escrito na linguagem da operação, não do estoque: "Vai faltar"
 * em vez de "abaixo do ponto de pedido". Quem lê esta tela decide compra, não
 * estuda reposição.
 */
export function rotuloSituacao(situacao: SituacaoEstoque): string {
  const mapa: Record<SituacaoEstoque, string> = {
    falta: "Faltando agora",
    repor: "Vai faltar",
    saudavel: "Saudável",
    excesso: "Sobrando",
    morto: "Sem giro",
    liquidar: "Marcado p/ liquidar",
    fora_do_plano: "Fora do plano",
    sem_movimento: "Sem movimento",
  };
  return mapa[situacao] ?? situacao;
}

/**
 * Cores de ESTADO, reservadas — nunca reaproveitadas como cor de série nos
 * gráficos, e sempre acompanhadas do rótulo em texto, para quem não distingue
 * as cores continuar lendo a tabela. Mesma regra da aba de Rotatividade.
 */
export function classeSituacao(situacao: SituacaoEstoque): string {
  const mapa: Record<SituacaoEstoque, string> = {
    falta: "bg-rose-100 text-rose-800",
    repor: "bg-amber-100 text-amber-800",
    saudavel: "bg-emerald-100 text-emerald-700",
    excesso: "bg-blue-100 text-blue-700",
    morto: "bg-slate-300 text-slate-800",
    liquidar: "bg-violet-100 text-violet-700",
    fora_do_plano: "bg-slate-100 text-slate-500",
    sem_movimento: "bg-slate-100 text-slate-500",
  };
  return mapa[situacao] ?? "bg-slate-100 text-slate-600";
}

/** Urgência de leitura: é a ordem em que a tela e a RPC listam. */
export const ORDEM_SITUACAO: SituacaoEstoque[] = [
  "falta",
  "repor",
  "morto",
  "liquidar",
  "excesso",
  "saudavel",
  "sem_movimento",
  "fora_do_plano",
];

export function pesoSituacao(situacao: SituacaoEstoque): number {
  const i = ORDEM_SITUACAO.indexOf(situacao);
  return i < 0 ? ORDEM_SITUACAO.length : i;
}

/* ------------------------------------------------------------------ */
/* Formatação                                                         */
/* ------------------------------------------------------------------ */

export function formatarDias(dias: number | null | undefined): string {
  if (dias === null || dias === undefined || !Number.isFinite(dias)) return "—";
  if (dias > 999) return "+999 dias";
  if (dias <= 0) return "0 dias";
  return `${Math.round(dias).toLocaleString("pt-BR")} dias`;
}

export function formatarMeses(meses: number | null | undefined): string {
  if (meses === null || meses === undefined || !Number.isFinite(meses)) return "—";
  if (meses <= 0) return "este mês";
  return meses === 1 ? "1 mês" : `${Math.round(meses)} meses`;
}

/** "AX", "CZ" — ou "—" quando a classe não pôde ser calculada. */
export function rotuloClasse(item: Pick<ItemEstoqueSaudavel, "classe_abc" | "classe_xyz">): string {
  if (!item.classe_abc && !item.classe_xyz) return "—";
  return `${item.classe_abc ?? "?"}${item.classe_xyz ?? ""}`;
}

/* ------------------------------------------------------------------ */
/* Leituras derivadas                                                 */
/* ------------------------------------------------------------------ */

/**
 * O alvo deste item é confiável?
 *
 * Três motivos de desconfiança, e os três importam por razões diferentes:
 *   · histórico curto  — menos de dois meses completos: não há série, o alvo
 *                        é o consumo de um mês projetado;
 *   · demanda irregular (classe Z) — o colchão de segurança domina o alvo; um
 *                        pico de admissão em bloco que não repete inflaria a
 *                        compra;
 *   · sem preço        — a quantidade está certa, mas o valor não entra em
 *                        nenhum total de dinheiro.
 *
 * Devolve a lista de motivos, não um booleano: a tela mostra POR QUE
 * desconfiar, que é o que permite a pessoa decidir se aprova ou confere.
 */
export function motivosDeDesconfianca(item: ItemEstoqueSaudavel): string[] {
  const motivos: string[] = [];
  if (item.demanda_janela > 0 && item.meses_completos < 2) {
    motivos.push("Histórico de menos de dois meses — alvo provisório");
  }
  if (item.classe_xyz === "Z") {
    motivos.push("Demanda irregular — o alvo é puxado pelo estoque de segurança");
  }
  if (item.sem_preco && item.disponivel > 0) {
    motivos.push("Sem preço cadastrado — fica fora dos valores em R$");
  }
  return motivos;
}

/**
 * "Já faltou 2 de 5 pedidos (40%)" — ou `null` quando nunca faltou.
 *
 * É a informação que a coluna "Situação" NÃO dá. Um tamanho que deixou dois
 * pedidos sem atendimento no semestre e foi reposto ontem aparece como
 * "Saudável" na tabela, e é, no ano, um dos que mais travaram a operação. O
 * gerente pediu exatamente isto: "qual item tem faltado muito nos pedidos
 * solicitados e precisamos comprar urgentemente".
 */
export function rotuloFaltaHistorica(item: ItemEstoqueSaudavel): string | null {
  if (!item.vezes_faltou || item.vezes_faltou <= 0) return null;
  const pct = item.pct_falta ?? 0;
  return `Já faltou ${item.vezes_faltou} de ${item.vezes_pedido} ${
    item.vezes_pedido === 1 ? "pedido" : "pedidos"
  } (${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%)`;
}

/**
 * Falta crônica: faltou várias vezes E em boa parte dos pedidos.
 *
 * Os dois critérios juntos, porque cada um sozinho mente: 1 falta em 1 pedido
 * dá 100% e não é crônico, e 2 faltas em 90 pedidos é ruído de operação. Com
 * 2+ faltas e 25%+ dos pedidos, o alvo do item está errado — não é azar.
 */
export function faltaCronica(item: ItemEstoqueSaudavel): boolean {
  return (item.vezes_faltou ?? 0) >= 2 && (item.pct_falta ?? 0) >= 25;
}

/**
 * Quantos dias de operação o item ainda cobre, contando o que está vindo.
 *
 * Diferente de `cobertura_dias`, que olha só o que está em casa. Esta é a
 * pergunta da reposição: "dá tempo de chegar?". Se a cobertura com o que está
 * em trânsito ainda é menor que o prazo de reposição, pedir hoje já chega
 * atrasado — e é esse o caso que deixa gente parada em casa.
 */
export function coberturaComTransito(item: ItemEstoqueSaudavel): number | null {
  if (item.demanda_dia <= 0) return null;
  return Math.round((item.disponivel + item.em_transito) / item.demanda_dia);
}

export function chegaAtrasado(item: ItemEstoqueSaudavel): boolean {
  const cobertura = coberturaComTransito(item);
  return cobertura !== null && cobertura < item.lead_time_dias;
}

/**
 * A frase que explica a conta daquele item, em português.
 *
 * Existe porque "alvo 35" sozinho não convence ninguém a assinar uma compra.
 * O gerente pediu previsibilidade: a tela tem de poder mostrar de onde o
 * número saiu, com os números dele.
 */
export function explicarAlvo(item: ItemEstoqueSaudavel, premissas: PremissasEstoque): string {
  const consumo = item.demanda_mensal.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const dias = premissas.lead_time_dias + premissas.ciclo_revisao_dias;
  const base = Math.max(item.alvo_calculado - item.seguranca, 0);
  const partes = [
    `Consumo de ${consumo} por mês`,
    `${dias} dias de cobertura (${premissas.lead_time_dias} de reposição + ${premissas.ciclo_revisao_dias} até a próxima compra) = ${base}`,
  ];
  if (item.seguranca > 0) {
    partes.push(
      `+ ${item.seguranca} de segurança para a oscilação da demanda (nível de ${Math.round(premissas.nivel_servico * 100)}%)`,
    );
  } else {
    partes.push("sem colchão de segurança: a demanda não oscilou no período");
  }
  partes.push(`= alvo de ${item.alvo_calculado}`);
  if (item.alvo_aprovado !== null && item.alvo_aprovado !== item.alvo_calculado) {
    partes.push(`Alvo aprovado manualmente: ${item.alvo_aprovado}`);
  }
  return partes.join(". ") + ".";
}

/**
 * A mesma explicação para a linha de compra: por que comprar ESTA quantidade.
 */
export function explicarCompra(item: ItemEstoqueSaudavel): string {
  if (item.comprar <= 0) {
    return item.disponivel + item.em_transito >= item.alvo
      ? "Nada a comprar: o que está em casa e em trânsito já cobre o alvo."
      : "Nada a comprar.";
  }
  const transito = item.em_transito > 0 ? ` − ${item.em_transito} em trânsito` : "";
  return `Alvo ${item.alvo} − ${item.disponivel} em casa${transito} = comprar ${item.comprar}.`;
}

/**
 * Cobertura do valor: quanto do estoque tem preço cadastrado.
 *
 * Mesma necessidade da aba de Rotatividade — metade das unidades pedidas em
 * 2026 é de item sem preço, e um total em R$ sem essa ressalva é lido como
 * verdade. A diferença é que aqui o número decide COMPRA, então a ressalva
 * aparece junto do cartão, não no pé da tela.
 */
export function coberturaDeValor(resumo: {
  itens_planejados: number;
  itens_sem_preco: number;
}): number {
  if (resumo.itens_planejados <= 0) return 100;
  const comPreco = Math.max(resumo.itens_planejados - resumo.itens_sem_preco, 0);
  return Math.round((comPreco / resumo.itens_planejados) * 1000) / 10;
}

/**
 * O recado de uma linha que resume o painel — é o que vai no topo da aba e no
 * título da análise da IA.
 */
export function recadoDoPainel(dados: EstoqueSaudavelDados): string {
  const r = dados.resumo;
  if (r.itens_em_falta > 0) {
    return `${r.itens_em_falta} ${r.itens_em_falta === 1 ? "tamanho está" : "tamanhos estão"} sem nenhuma peça em casa com pedido na fila.`;
  }
  if (r.itens_a_repor > 0) {
    return `${r.itens_a_repor} ${r.itens_a_repor === 1 ? "item está" : "itens estão"} abaixo do ponto de pedido — comprar antes de faltar.`;
  }
  // Nada apertado hoje não quer dizer nada apertado no ano. Se já houve pedido
  // sem atendimento, é isso que merece a linha — o alvo desses itens é que
  // está errado, e eles não aparecem em nenhuma das duas situações acima.
  if ((r.itens_que_faltaram ?? 0) > 0) {
    const n = r.itens_que_faltaram;
    return `Nada em falta agora, mas ${n} ${n === 1 ? "tamanho já deixou" : "tamanhos já deixaram"} pedido sem atendimento — reveja o alvo deles.`;
  }
  if (r.valor_morto > 0) {
    return `Nada em falta. Sobram ${formatarMoedaCurta(r.valor_morto)} em itens sem giro para liquidar.`;
  }
  return "Estoque dentro do alvo em todos os itens planejados.";
}

/** "R$ 48,2 mil" / "R$ 1,3 mi" — número de cartão, não de planilha. */
export function formatarMoedaCurta(valor: number | null | undefined): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) {
    return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  }
  if (Math.abs(n) >= 1_000) {
    return `R$ ${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------------ */
/* Exportação                                                         */
/* ------------------------------------------------------------------ */

/**
 * CSV da compra sugerida, por item e tamanho — o arquivo que vai para a
 * cotação. Sai com ponto e vírgula e vírgula decimal porque abre no Excel em
 * português sem passar pelo assistente de importação.
 */
export function csvDaCompra(itens: ItemEstoqueSaudavel[]): string {
  const cabecalho = [
    "Item",
    "Tamanho",
    "Em casa",
    "Em trânsito",
    "Consumo/mês",
    "Alvo saudável",
    "Comprar",
    "Valor unitário",
    "Valor da compra",
    "Classe",
    "Situação",
  ];
  const numero = (n: number | null) =>
    n === null || n === undefined ? "" : String(n).replace(".", ",");

  const linhas = itens
    .filter((i) => i.comprar > 0 && !i.fora_do_plano && !i.liquidar)
    .sort((a, b) => b.valor_comprar - a.valor_comprar || a.item.localeCompare(b.item, "pt-BR"))
    .map((i) =>
      [
        i.item,
        i.tamanho ?? "",
        numero(i.disponivel),
        numero(i.em_transito),
        numero(i.demanda_mensal),
        numero(i.alvo),
        numero(i.comprar),
        numero(i.valor_unitario),
        numero(i.valor_comprar),
        rotuloClasse(i),
        rotuloSituacao(i.situacao),
      ]
        // Nome de item com ponto e vírgula quebraria a coluna; entre aspas,
        // não. Aspas dentro do texto dobram, como manda o CSV.
        .map((c) => (/[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c)))
        .join(";"),
    );

  return [cabecalho.join(";"), ...linhas].join("\r\n");
}
