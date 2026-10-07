export type FiltroDashboardCompras = {
  inicio: string;
  fim: string;
  contratoId: string | null;
  categoria: string | null;
  comprador: string | null;
};

export type SerieNomeQuantidade = { nome: string; quantidade: number };
export type SerieNomeValor = { nome: string; valor: number };

export interface DashboardComprasEstoqueDados {
  atualizado_em: string;
  filtros: {
    contratos: { id: string; nome: string; status: string }[];
    categorias: { valor: string; nome: string }[];
    compradores: string[];
  };
  resumo: {
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
    quantidade_itens: number;
    itens_distintos: number;
    entradas: number;
    saidas: number;
  };
  saving_resumo: { total: number; implantacao: number; execucao: number };
  solicitacoes_por_contrato: (SerieNomeQuantidade & { despachadas: number; pendentes: number })[];
  motivos_pendencias: SerieNomeQuantidade[];
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
}

export interface ItemMovimentado {
  item: string;
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
