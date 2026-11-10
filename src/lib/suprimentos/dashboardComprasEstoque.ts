export type FiltroDashboardCompras = {
  inicio: string;
  fim: string;
  contratoId: string | null;
  categoria: string | null;
  comprador: string | null;
};

export type SerieNomeQuantidade = { nome: string; quantidade: number };
export type SerieNomeValor = { nome: string; valor: number };

export interface PeriodoDisponivelDashboardCompras {
  inicio: string | null;
  fim: string | null;
  solicitacoes_inicio: string | null;
  solicitacoes_fim: string | null;
  itens_registrados_inicio: string | null;
  movimentos_inicio: string | null;
  cotacoes_inicio: string | null;
}

export interface DashboardComprasEstoqueDados {
  atualizado_em: string;
  periodo_disponivel: PeriodoDisponivelDashboardCompras;
  filtros: {
    contratos: { id: string; nome: string; status: string }[];
    categorias: { valor: string; nome: string }[];
    compradores: string[];
  };
  resumo: {
    /** Mesma contagem histórica exibida no card Total de Pedidos de Materiais. */
    solicitacoes_total_geral: number;
    solicitacoes: number;
    despachadas: number;
    pendentes: number;
    tempo_medio_dias: number;
    cotacoes: number;
    media_cotacoes: number;
    licitacoes: number;
    participacao_licitacoes: number;
  };
  estoque_resumo: {
    valor_total: number;
    quantidade_fisica: number;
    quantidade_reservada: number;
    /** Disponível = físico − reservado. */
    quantidade_itens: number;
    itens_distintos: number;
    entradas: number;
    saidas: number;
    /**
     * Unidades pedidas em Pedidos de Materiais que o almoxarifado ainda não
     * entregou. É POSIÇÃO DE AGORA: não respeita o período do filtro, ao
     * contrário de `entradas`/`saidas`.
     */
    quantidade_pendente_entrega?: number;
    /**
     * Pendência de linha de pedido escrita como nome livre, sem item do
     * catálogo. Não cabe em nenhuma linha da tabela por item — fica neste
     * total para a tela avisar, em vez de exibir uma soma menor calada.
     */
    quantidade_pendente_sem_vinculo?: number;
    /** Solicitação do Malote em cotação, antes do envio ao fornecedor. */
    quantidade_aguardando_compra?: number;
    /** Pedido já enviado ao fornecedor, descontado o que foi conferido. */
    quantidade_em_transito?: number;
    itens_com_pendencia?: number;
  };
  saving_resumo: { total: number; implantacao: number; execucao: number };
  solicitacoes_por_contrato: (SerieNomeQuantidade & { despachadas: number; pendentes: number })[];
  motivos_pendencias: SerieNomeQuantidade[];
  /** Envios feitos na rota Cotações do Malote, um processo por solicitação. */
  cotacoes_malote_por_comprador?: SerieNomeQuantidade[];
  /** Respostas enviadas no módulo de Cotações para Licitação. */
  cotacoes_licitacao_por_comprador?: SerieNomeQuantidade[];
  /** Série combinada legada; mantida no payload para compatibilidade. */
  cotacoes_por_comprador: SerieNomeQuantidade[];
  cotacoes_por_solicitacao: SerieNomeQuantidade[];
  evolucao: {
    mes: string;
    rotulo: string;
    solicitacoes: number;
    cotacoes: number;
    entradas: number;
    saidas: number;
  }[];
  entregas_resumo?: {
    total_despachado: number;
    correios: number;
    supervisores: number;
    confirmadas: number;
    sem_modalidade: number;
  };
  entregas_por_responsavel?: {
    nome: string;
    correios: number;
    supervisores: number;
    sem_modalidade: number;
    total: number;
  }[];
  entregas_recentes?: {
    id: string;
    data: string;
    contrato: string;
    destino: string;
    modalidade: "CORREIO" | "SUPERVISOR" | "NAO_INFORMADO";
    responsavel: string;
    comprovacao: "CONFIRMADA" | "PENDENTE" | "LEGADO" | "SEM_REGISTRO";
    recebedor: string | null;
    rastreio: string | null;
  }[];
  solicitacoes_recentes: {
    id: string;
    data: string;
    contrato: string;
    item: string;
    solicitante: string;
    status: string;
    tempo_dias: number;
  }[];
  cotacoes_recentes: {
    id: string;
    data: string;
    contrato: string | null;
    item: string;
    comprador: string | null;
    qtd_cotacoes: number;
    licitacao: boolean;
    status: string;
  }[];
  estoque_por_categoria: SerieNomeValor[];
  saude_estoque: (SerieNomeQuantidade & { ordem: number })[];
  mais_movimentados: ItemMovimentado[];
  menos_movimentados: ItemMovimentado[];
  estoque_detalhado: {
    item: string;
    codigo: string | null;
    categoria: string;
    disponivel: number;
    reservado: number;
    valor_unitario: number;
    valor_total: number;
    situacao: string;
  }[];
  saving_por_contrato: {
    contrato: string;
    valor_inicial: number;
    valor_comprado: number;
    saving: number;
    percentual: number;
  }[];
  /**
   * Uma linha por (item, tamanho): o que tem, o que entrou e saiu no período,
   * o que está pendente de entrega e o que está em processo de compra.
   *
   * Opcional porque o painel só existe depois da migration 20261110000100 —
   * enquanto o PostgREST serve o schema antigo, a chave não vem e a tela
   * mostra o aviso em vez de uma tabela vazia.
   */
  posicao_por_item?: PosicaoItem[];
}

/**
 * Atenção ao misturar naturezas nesta linha: `entrou`/`saiu`/`ajustes` são do
 * período filtrado; `disponivel`, `reservado`, `pendente_entrega`,
 * `aguardando_compra` e `em_transito` são posição de AGORA. O cabeçalho do
 * painel escreve essa diferença — sem isso a leitura mais natural está errada.
 */
export interface PosicaoItem {
  base_id: string;
  /** `null` é o "sem tamanho" do sistema antigo, não um tamanho chamado "Único". */
  tamanho: string | null;
  codigo: string | null;
  item: string;
  categoria: string;
  ordem_tamanho: number;
  disponivel: number;
  reservado: number;
  fisico: number;
  entrou: number;
  saiu: number;
  /** Ajuste e correção de inventário: nem entrada nem saída de operação. */
  ajustes: number;
  pendente_entrega: number;
  aguardando_compra: number;
  em_transito: number;
  valor_unitario: number | null;
  valor_total: number;
}

export interface ItemMovimentado {
  item: string;
  codigo: string | null;
  categoria: string;
  quantidade: number;
  valor_total: number;
}

export function formatarMoeda(valor: number | null | undefined): string {
  return Number(valor ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

export function formatarNumero(valor: number | null | undefined, casas = 0): string {
  return Number(valor ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function percentual(parte: number, total: number): number {
  if (!Number.isFinite(parte) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((parte / total) * 1000) / 10;
}

export function rotuloCategoria(valor: string): string {
  const mapa: Record<string, string> = {
    epi: "EPI",
    uniforme: "Uniformes",
    insumo: "Insumos",
    equipamento: "Equipamentos",
  };
  return mapa[valor] ?? valor;
}

export function classeSituacaoEstoque(situacao: string): string {
  if (situacao === "Adequado") return "bg-emerald-100 text-emerald-700";
  if (situacao === "Atenção") return "bg-amber-100 text-amber-700";
  if (situacao === "Baixo") return "bg-rose-100 text-rose-700";
  return "bg-slate-200 text-slate-700";
}

function agruparNomeQuantidade(
  grupos: SerieNomeQuantidade[][],
  limite?: number,
): SerieNomeQuantidade[] {
  const mapa = new Map<string, number>();
  for (const grupo of grupos) {
    for (const linha of grupo) mapa.set(linha.nome, (mapa.get(linha.nome) ?? 0) + Number(linha.quantidade));
  }
  const linhas = [...mapa].map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
  return limite ? linhas.slice(0, limite) : linhas;
}

function agruparNomeValor(grupos: SerieNomeValor[][]): SerieNomeValor[] {
  const mapa = new Map<string, number>();
  for (const grupo of grupos) {
    for (const linha of grupo) mapa.set(linha.nome, (mapa.get(linha.nome) ?? 0) + Number(linha.valor));
  }
  return [...mapa].map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * Consolida as RPCs das empresas acessíveis quando o filtro está em "Todas".
 * Cada empresa continua sendo validada no banco; esta função só soma respostas
 * que o usuário já tinha autorização para consultar individualmente.
 */
export function consolidarDashboardsCompras(
  paineis: DashboardComprasEstoqueDados[],
): DashboardComprasEstoqueDados {
  if (!paineis.length) throw new Error("Nenhuma empresa disponível para consolidar o dashboard.");
  if (paineis.length === 1) return paineis[0];

  const soma = (ler: (painel: DashboardComprasEstoqueDados) => number) =>
    paineis.reduce((total, painel) => total + Number(ler(painel) ?? 0), 0);
  const menorData = (ler: (painel: DashboardComprasEstoqueDados) => string | null) =>
    paineis.map(ler).filter((data): data is string => !!data).sort()[0] ?? null;
  const maiorData = (ler: (painel: DashboardComprasEstoqueDados) => string | null) =>
    paineis.map(ler).filter((data): data is string => !!data).sort().at(-1) ?? null;
  const solicitacoesPeriodo = soma((p) => p.resumo.solicitacoes);
  const cotacoes = soma((p) => p.resumo.cotacoes);
  const despachadas = soma((p) => p.resumo.despachadas);

  const contratos = new Map<string, { id: string; nome: string; status: string }>();
  const categorias = new Map<string, { valor: string; nome: string }>();
  const compradores = new Set<string>();
  for (const painel of paineis) {
    for (const contrato of painel.filtros.contratos) contratos.set(contrato.id, contrato);
    for (const categoria of painel.filtros.categorias) categorias.set(categoria.valor, categoria);
    for (const comprador of painel.filtros.compradores) compradores.add(comprador);
  }

  const solicitacoesPorContrato = new Map<string, DashboardComprasEstoqueDados["solicitacoes_por_contrato"][number]>();
  for (const painel of paineis) {
    for (const linha of painel.solicitacoes_por_contrato) {
      const atual = solicitacoesPorContrato.get(linha.nome) ?? { nome: linha.nome, quantidade: 0, despachadas: 0, pendentes: 0 };
      atual.quantidade += Number(linha.quantidade);
      atual.despachadas += Number(linha.despachadas);
      atual.pendentes += Number(linha.pendentes);
      solicitacoesPorContrato.set(linha.nome, atual);
    }
  }

  const evolucao = new Map<string, DashboardComprasEstoqueDados["evolucao"][number]>();
  for (const painel of paineis) {
    for (const linha of painel.evolucao) {
      const atual = evolucao.get(linha.mes) ?? { ...linha, solicitacoes: 0, cotacoes: 0, entradas: 0, saidas: 0 };
      atual.solicitacoes += Number(linha.solicitacoes);
      atual.cotacoes += Number(linha.cotacoes);
      atual.entradas += Number(linha.entradas);
      atual.saidas += Number(linha.saidas);
      evolucao.set(linha.mes, atual);
    }
  }

  const savingPorContrato = new Map<string, DashboardComprasEstoqueDados["saving_por_contrato"][number]>();
  for (const painel of paineis) {
    for (const linha of painel.saving_por_contrato) {
      const atual = savingPorContrato.get(linha.contrato) ?? {
        contrato: linha.contrato, valor_inicial: 0, valor_comprado: 0, saving: 0, percentual: 0,
      };
      atual.valor_inicial += Number(linha.valor_inicial);
      atual.valor_comprado += Number(linha.valor_comprado);
      atual.saving += Number(linha.saving);
      atual.percentual = percentual(atual.saving, atual.valor_inicial);
      savingPorContrato.set(linha.contrato, atual);
    }
  }

  const entregasPorResponsavel = new Map<
    string,
    NonNullable<DashboardComprasEstoqueDados["entregas_por_responsavel"]>[number]
  >();
  for (const painel of paineis) {
    for (const linha of painel.entregas_por_responsavel ?? []) {
      const atual = entregasPorResponsavel.get(linha.nome) ?? {
        nome: linha.nome, correios: 0, supervisores: 0, sem_modalidade: 0, total: 0,
      };
      atual.correios += Number(linha.correios);
      atual.supervisores += Number(linha.supervisores);
      atual.sem_modalidade += Number(linha.sem_modalidade);
      atual.total += Number(linha.total);
      entregasPorResponsavel.set(linha.nome, atual);
    }
  }

  // Empresas diferentes têm catálogo próprio, então o mesmo material tem
  // base_id distinto em cada uma. A chave de consolidação é (nome, tamanho) —
  // somar por base_id devolveria a linha de uma empresa só, calado.
  const posicaoPorItem = (): PosicaoItem[] | undefined => {
    if (!paineis.some((p) => p.posicao_por_item)) return undefined;
    const mapa = new Map<string, PosicaoItem>();
    for (const painel of paineis) {
      for (const linha of painel.posicao_por_item ?? []) {
        const chave = `${linha.item}|${linha.tamanho ?? ""}`;
        const atual = mapa.get(chave);
        if (!atual) {
          mapa.set(chave, { ...linha });
          continue;
        }
        atual.disponivel += Number(linha.disponivel);
        atual.reservado += Number(linha.reservado);
        atual.fisico += Number(linha.fisico);
        atual.entrou += Number(linha.entrou);
        atual.saiu += Number(linha.saiu);
        atual.ajustes += Number(linha.ajustes);
        atual.pendente_entrega += Number(linha.pendente_entrega);
        atual.aguardando_compra += Number(linha.aguardando_compra);
        atual.em_transito += Number(linha.em_transito);
        atual.valor_total += Number(linha.valor_total);
        // Código e preço são da empresa: no consolidado deixam de identificar
        // um produto só, então não se inventa um vencedor.
        if (atual.codigo !== linha.codigo) atual.codigo = null;
        if (atual.valor_unitario !== linha.valor_unitario) atual.valor_unitario = null;
      }
    }
    return [...mapa.values()];
  };

  const movimentados = (campo: "mais_movimentados" | "menos_movimentados", desc: boolean) => {
    const mapa = new Map<string, ItemMovimentado>();
    for (const painel of paineis) {
      for (const linha of painel[campo]) {
        const chave = `${linha.codigo ?? ""}|${linha.item}|${linha.categoria}`;
        const atual = mapa.get(chave) ?? { ...linha, quantidade: 0, valor_total: 0 };
        atual.quantidade += Number(linha.quantidade);
        atual.valor_total += Number(linha.valor_total);
        mapa.set(chave, atual);
      }
    }
    return [...mapa.values()]
      .sort((a, b) => (desc ? b.quantidade - a.quantidade : a.quantidade - b.quantidade) || a.item.localeCompare(b.item, "pt-BR"))
      .slice(0, 10);
  };

  return {
    atualizado_em: paineis.map((p) => p.atualizado_em).sort().at(-1) ?? paineis[0].atualizado_em,
    periodo_disponivel: {
      inicio: menorData((p) => p.periodo_disponivel?.inicio ?? null),
      fim: maiorData((p) => p.periodo_disponivel?.fim ?? null),
      solicitacoes_inicio: menorData((p) => p.periodo_disponivel?.solicitacoes_inicio ?? null),
      solicitacoes_fim: maiorData((p) => p.periodo_disponivel?.solicitacoes_fim ?? null),
      itens_registrados_inicio: menorData((p) => p.periodo_disponivel?.itens_registrados_inicio ?? null),
      movimentos_inicio: menorData((p) => p.periodo_disponivel?.movimentos_inicio ?? null),
      cotacoes_inicio: menorData((p) => p.periodo_disponivel?.cotacoes_inicio ?? null),
    },
    filtros: {
      contratos: [...contratos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      categorias: [...categorias.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      compradores: [...compradores].sort((a, b) => a.localeCompare(b, "pt-BR")),
    },
    resumo: {
      solicitacoes_total_geral: soma((p) => p.resumo.solicitacoes_total_geral),
      solicitacoes: solicitacoesPeriodo,
      despachadas,
      pendentes: soma((p) => p.resumo.pendentes),
      tempo_medio_dias: despachadas > 0
        ? Math.round(soma((p) => p.resumo.tempo_medio_dias * p.resumo.despachadas) / despachadas * 10) / 10
        : 0,
      cotacoes,
      media_cotacoes: solicitacoesPeriodo > 0
        ? Math.round(soma((p) => p.resumo.media_cotacoes * p.resumo.solicitacoes) / solicitacoesPeriodo * 10) / 10
        : 0,
      licitacoes: soma((p) => p.resumo.licitacoes),
      participacao_licitacoes: percentual(soma((p) => p.resumo.licitacoes), cotacoes),
    },
    estoque_resumo: {
      valor_total: soma((p) => p.estoque_resumo.valor_total),
      quantidade_fisica: soma((p) => p.estoque_resumo.quantidade_fisica),
      quantidade_reservada: soma((p) => p.estoque_resumo.quantidade_reservada),
      quantidade_itens: soma((p) => p.estoque_resumo.quantidade_itens),
      itens_distintos: soma((p) => p.estoque_resumo.itens_distintos),
      entradas: soma((p) => p.estoque_resumo.entradas),
      saidas: soma((p) => p.estoque_resumo.saidas),
      quantidade_pendente_entrega: soma((p) => p.estoque_resumo.quantidade_pendente_entrega ?? 0),
      quantidade_pendente_sem_vinculo: soma((p) => p.estoque_resumo.quantidade_pendente_sem_vinculo ?? 0),
      quantidade_aguardando_compra: soma((p) => p.estoque_resumo.quantidade_aguardando_compra ?? 0),
      quantidade_em_transito: soma((p) => p.estoque_resumo.quantidade_em_transito ?? 0),
      itens_com_pendencia: soma((p) => p.estoque_resumo.itens_com_pendencia ?? 0),
    },
    saving_resumo: {
      total: soma((p) => p.saving_resumo.total),
      implantacao: soma((p) => p.saving_resumo.implantacao),
      execucao: soma((p) => p.saving_resumo.execucao),
    },
    solicitacoes_por_contrato: [...solicitacoesPorContrato.values()]
      .sort((a, b) => b.quantidade - a.quantidade).slice(0, 10),
    motivos_pendencias: agruparNomeQuantidade(paineis.map((p) => p.motivos_pendencias)),
    cotacoes_malote_por_comprador: agruparNomeQuantidade(
      paineis.map((p) => p.cotacoes_malote_por_comprador ?? []),
      10,
    ),
    cotacoes_licitacao_por_comprador: agruparNomeQuantidade(
      paineis.map((p) => p.cotacoes_licitacao_por_comprador ?? []),
      10,
    ),
    cotacoes_por_comprador: agruparNomeQuantidade(paineis.map((p) => p.cotacoes_por_comprador), 10),
    cotacoes_por_solicitacao: agruparNomeQuantidade(paineis.map((p) => p.cotacoes_por_solicitacao)),
    evolucao: [...evolucao.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    entregas_resumo: {
      total_despachado: soma((p) => p.entregas_resumo?.total_despachado ?? 0),
      correios: soma((p) => p.entregas_resumo?.correios ?? 0),
      supervisores: soma((p) => p.entregas_resumo?.supervisores ?? 0),
      confirmadas: soma((p) => p.entregas_resumo?.confirmadas ?? 0),
      sem_modalidade: soma((p) => p.entregas_resumo?.sem_modalidade ?? 0),
    },
    entregas_por_responsavel: [...entregasPorResponsavel.values()]
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"))
      .slice(0, 15),
    entregas_recentes: paineis.flatMap((p) => p.entregas_recentes ?? [])
      .sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 50),
    solicitacoes_recentes: paineis.flatMap((p) => p.solicitacoes_recentes)
      .sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 8),
    cotacoes_recentes: paineis.flatMap((p) => p.cotacoes_recentes)
      .sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 8),
    estoque_por_categoria: agruparNomeValor(paineis.map((p) => p.estoque_por_categoria)),
    saude_estoque: agruparNomeQuantidade(paineis.map((p) => p.saude_estoque)).map((linha, ordem) => ({ ...linha, ordem })),
    mais_movimentados: movimentados("mais_movimentados", true),
    menos_movimentados: movimentados("menos_movimentados", false),
    estoque_detalhado: paineis.flatMap((p) => p.estoque_detalhado)
      .sort((a, b) => b.valor_total - a.valor_total).slice(0, 15),
    saving_por_contrato: [...savingPorContrato.values()].sort((a, b) => b.saving - a.saving),
    posicao_por_item: posicaoPorItem(),
  };
}
