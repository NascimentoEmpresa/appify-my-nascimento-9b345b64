/**
 * Saídas por Contrato (SIS-2026-0769) — tipos e regras de leitura do relatório.
 *
 * A conta pesada está nas RPCs `sup_rel_saidas_por_contrato` e
 * `sup_rel_saidas_cobertura`. Aqui mora só o que transforma a linha crua em
 * leitura: agrupar por contrato, somar por competência e — o ponto do chamado —
 * dizer de onde veio cada número.
 *
 * Por que "origem" existe e não pode sumir da tela: de março a junho/2026 o
 * vínculo entre a saída e o contrato tinha se perdido, porque os pedidos foram
 * apagados DENTRO do sistema antigo antes da importação (dos ids 253..4535 do
 * legado só 1.872 chegaram). O que reconstruiu esse vínculo foram exports em
 * Excel feitos enquanto o sistema antigo rodava — dado de boa procedência, mas
 * que NÃO é registro do ERP. Numa análise de lucratividade essa diferença
 * importa, então a tela sempre mostra as três origens separadas em vez de um
 * total único que fecharia bonito e esconderia a reconstrução.
 *
 * Maio/2026 fica em ~54% de cobertura e não há como melhorar: o mês cai no vão
 * entre o export de 27/04 e o de 23/06, e o setor confirmou em 30/10/2026 que
 * não existe outro arquivo.
 */

export type OrigemSaida = "sistema" | "planilha" | "sem_destino";

export interface LinhaSaida {
  competencia: string;
  contrato_id: string | null;
  contrato_nome: string;
  sup_item_id: string | null;
  item_nome: string;
  item_codigo: string | null;
  item_tipo: string | null;
  quantidade: number | string;
  /**
   * Valor da saída em reais (quantidade × valor de custo do item), desde
   * 20261110200000. `numeric` do Postgres chega como TEXTO no PostgREST — somar
   * sem converter concatena string. Use sempre `numero()`.
   */
  valor: number | string;
  /** 'sistema' | 'sem_destino' | 'planilha:<arquivo>' — cru, como a RPC devolve. */
  origem: string;
}

/** PostgREST devolve numeric como texto e bigint como número. Normaliza os dois. */
export function numero(v: number | string | null | undefined): number {
  return Number(v) || 0;
}

export interface LinhaCobertura {
  competencia: string;
  unidades_total: number;
  unidades_sistema: number;
  unidades_planilha: number;
  unidades_sem_destino: number;
}

export interface FiltroSaidas {
  inicio: string;
  fim: string;
  contratoId: string | null;
  /**
   * Recorte por empresa do grupo, vindo do seletor do Dashboard de Compras.
   * `null` = consolidado ("Todas"), que é sempre o caso na tela própria do
   * relatório — ela não tem seletor de empresa.
   *
   * Com empresa escolhida, a saída SEM contrato identificado fica de fora: a
   * empresa vem do contrato, e sem contrato não há a que atribuir. Quem lê o
   * recorte de uma empresa precisa saber disso, senão o cartão "sem destino"
   * zerado parece ausência de buraco — por isso o painel avisa.
   */
  empresaId?: string | null;
}

/**
 * A RPC devolve 'planilha:ATÉ 23-04-2026.xlsx' para guardar a procedência no
 * próprio dado. A tela agrupa por categoria; o nome do arquivo aparece só no
 * detalhe e na exportação.
 */
export function categoriaOrigem(origem: string): OrigemSaida {
  if (origem === "sistema") return "sistema";
  if (origem.startsWith("planilha:")) return "planilha";
  return "sem_destino";
}

export function arquivoDaOrigem(origem: string): string | null {
  return origem.startsWith("planilha:") ? origem.slice("planilha:".length) : null;
}

export const ROTULO_ORIGEM: Record<OrigemSaida, string> = {
  sistema: "Registrado no sistema",
  planilha: "Reconstruído de planilha",
  sem_destino: "Sem contrato identificado",
};

export interface ResumoContrato {
  contrato_id: string | null;
  contrato_nome: string;
  quantidade: number;
  sistema: number;
  planilha: number;
  sem_destino: number;
}

/** Soma as linhas por contrato, mantendo a separação por origem. */
export function resumirPorContrato(linhas: LinhaSaida[]): ResumoContrato[] {
  const porContrato = new Map<string, ResumoContrato>();
  for (const l of linhas) {
    const chave = l.contrato_id ?? "__sem__";
    let r = porContrato.get(chave);
    if (!r) {
      r = {
        contrato_id: l.contrato_id,
        contrato_nome: l.contrato_nome,
        quantidade: 0,
        sistema: 0,
        planilha: 0,
        sem_destino: 0,
      };
      porContrato.set(chave, r);
    }
    r.quantidade += numero(l.quantidade);
    r[categoriaOrigem(l.origem)] += numero(l.quantidade);
  }
  return [...porContrato.values()].sort((a, b) => b.quantidade - a.quantidade);
}

/* ------------------------------------------------------------------------- *
 * Quadro "Por contrato" por CATEGORIA DE ITEM (decisão da CEO, 10/11/2026)
 * ------------------------------------------------------------------------- */

/**
 * As cinco categorias são exatamente os valores de `sup_item.tipo` — o CHECK da
 * tabela, ampliado em 20260930000013 para incluir 'limpeza'. Não é lista
 * paralela: se alguém criar um sexto tipo no banco, ele cai em "Outros" abaixo
 * em vez de desaparecer da conta.
 */
export const CATEGORIAS_ITEM = ["uniforme", "epi", "limpeza", "insumo", "equipamento"] as const;

export type CategoriaItem = (typeof CATEGORIAS_ITEM)[number] | "outros";

export const ROTULO_CATEGORIA: Record<CategoriaItem, string> = {
  uniforme: "Uniforme",
  epi: "EPI",
  limpeza: "Material de limpeza",
  insumo: "Insumo",
  equipamento: "Equipamento",
  outros: "Outros",
};

/**
 * Item sem tipo ("(material removido)", porque o cadastro foi excluído depois
 * da saída) e tipo novo que o front ainda não conhece caem em "Outros".
 *
 * Isso existe para as colunas FECHAREM com o total da linha. Se o tipo
 * desconhecido fosse ignorado, a soma das categorias daria menos que o Total e
 * quem lê a tela não teria como saber onde está a diferença — exatamente o tipo
 * de buraco silencioso que gerou este chamado.
 */
export function categoriaDoItem(tipo: string | null | undefined): CategoriaItem {
  const t = (tipo ?? "").toLowerCase();
  return (CATEGORIAS_ITEM as readonly string[]).includes(t) ? (t as CategoriaItem) : "outros";
}

export interface QuantidadeValor {
  quantidade: number;
  valor: number;
}

export interface ContratoPorCategoria {
  contrato_id: string | null;
  contrato_nome: string;
  porCategoria: Record<CategoriaItem, QuantidadeValor>;
  quantidade: number;
  valor: number;
}

export interface ResumoCategorias {
  contratos: ContratoPorCategoria[];
  /** Rodapé "Total geral" — por categoria. */
  totalPorCategoria: Record<CategoriaItem, QuantidadeValor>;
  quantidade: number;
  valor: number;
  /**
   * Só as categorias com movimento no período, na ordem canônica. A tela não
   * desenha coluna vazia: com cinco categorias e duas colunas cada, mês que só
   * teve limpeza mostraria oito colunas de zero.
   */
  categoriasPresentes: CategoriaItem[];
}

function zerado(): Record<CategoriaItem, QuantidadeValor> {
  const r = {} as Record<CategoriaItem, QuantidadeValor>;
  for (const c of [...CATEGORIAS_ITEM, "outros"] as CategoriaItem[]) {
    r[c] = { quantidade: 0, valor: 0 };
  }
  return r;
}

/**
 * Agrupa as saídas em contrato × categoria, com quantidade e valor em cada
 * cruzamento, e devolve também os totais de rodapé.
 *
 * `categoria` opcional recorta ANTES de somar, para o filtro de categoria da
 * tela mudar os totais e não só esconder colunas — se o total continuasse o do
 * período inteiro, o rodapé contradiria a tabela.
 */
export function resumirPorCategoria(
  linhas: LinhaSaida[],
  categoria?: CategoriaItem | null,
): ResumoCategorias {
  const porContrato = new Map<string, ContratoPorCategoria>();
  const totalPorCategoria = zerado();
  const vistas = new Set<CategoriaItem>();
  let quantidade = 0;
  let valor = 0;

  for (const l of linhas) {
    const cat = categoriaDoItem(l.item_tipo);
    if (categoria && cat !== categoria) continue;

    const q = numero(l.quantidade);
    const v = numero(l.valor);
    const chave = l.contrato_id ?? "__sem__";

    let r = porContrato.get(chave);
    if (!r) {
      r = {
        contrato_id: l.contrato_id,
        contrato_nome: l.contrato_nome,
        porCategoria: zerado(),
        quantidade: 0,
        valor: 0,
      };
      porContrato.set(chave, r);
    }

    r.porCategoria[cat].quantidade += q;
    r.porCategoria[cat].valor += v;
    r.quantidade += q;
    r.valor += v;

    totalPorCategoria[cat].quantidade += q;
    totalPorCategoria[cat].valor += v;
    quantidade += q;
    valor += v;
    vistas.add(cat);
  }

  const categoriasPresentes = ([...CATEGORIAS_ITEM, "outros"] as CategoriaItem[]).filter((c) =>
    vistas.has(c),
  );

  return {
    // Maior valor primeiro: a pergunta da tela é "qual contrato consumiu mais".
    contratos: [...porContrato.values()].sort((a, b) => b.valor - a.valor),
    totalPorCategoria,
    quantidade,
    valor,
    categoriasPresentes,
  };
}

/**
 * Totais do rodapé e dos cartões a partir das linhas QUE ESTÃO NA TELA.
 *
 * Separado de `resumirPorCategoria` porque a busca por nome filtra depois: se o
 * rodapé continuasse somando o período inteiro, ele contradiria as linhas logo
 * acima dele, e a exportação sairia com um "Total geral" que não fecha com as
 * próprias linhas do arquivo.
 */
export function totalizar(contratos: ContratoPorCategoria[]): {
  totalPorCategoria: Record<CategoriaItem, QuantidadeValor>;
  quantidade: number;
  valor: number;
} {
  const totalPorCategoria = zerado();
  let quantidade = 0;
  let valor = 0;
  for (const c of contratos) {
    for (const cat of [...CATEGORIAS_ITEM, "outros"] as CategoriaItem[]) {
      totalPorCategoria[cat].quantidade += c.porCategoria[cat].quantidade;
      totalPorCategoria[cat].valor += c.porCategoria[cat].valor;
    }
    quantidade += c.quantidade;
    valor += c.valor;
  }
  return { totalPorCategoria, quantidade, valor };
}

/** Filtra por nome de contrato, sem acento nem caixa atrapalhando a busca. */
export function filtrarPorNome(
  contratos: ContratoPorCategoria[],
  busca: string,
): ContratoPorCategoria[] {
  const alvo = normalizar(busca);
  if (!alvo) return contratos;
  return contratos.filter((c) => normalizar(c.contrato_nome).includes(alvo));
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Percentual de unidades com contrato identificado — some o que veio do
 * sistema com o que foi reconstruído, porque as duas respondem "para qual
 * contrato foi". Devolve null quando não houve saída no mês, para a tela
 * mostrar "—" em vez de 0%, que sugeriria mês ruim onde não houve movimento.
 */
export function percentualCobertura(linha: LinhaCobertura): number | null {
  if (!linha.unidades_total) return null;
  const comDestino = linha.unidades_sistema + linha.unidades_planilha;
  return Math.round((100 * comDestino) / linha.unidades_total);
}

/** Abaixo disso a tela destaca o mês: o número não sustenta análise fechada. */
export const LIMIAR_COBERTURA_CONFIAVEL = 90;

export function coberturaPreocupante(linha: LinhaCobertura): boolean {
  const pct = percentualCobertura(linha);
  return pct !== null && pct < LIMIAR_COBERTURA_CONFIAVEL;
}

const CABECALHO_CSV = [
  "competencia",
  "contrato",
  "item",
  "codigo",
  "tipo",
  "quantidade",
  "valor",
  "origem",
  "arquivo_origem",
];

function campoCsv(valor: string | number | null): string {
  const s = valor === null || valor === undefined ? "" : String(valor);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV com ponto-e-vírgula (o Excel em pt-BR abre assim sem pedir importação) e
 * uma coluna de origem por linha — quem receber o arquivo precisa conseguir
 * separar o que é registro do que é reconstrução sem voltar aqui para perguntar.
 */
export function gerarCsvSaidas(linhas: LinhaSaida[]): string {
  const corpo = linhas.map((l) =>
    [
      l.competencia,
      l.contrato_nome,
      l.item_nome,
      l.item_codigo,
      l.item_tipo,
      numero(l.quantidade),
      dinheiroCsv(numero(l.valor)),
      ROTULO_ORIGEM[categoriaOrigem(l.origem)],
      arquivoDaOrigem(l.origem),
    ]
      .map(campoCsv)
      .join(";"),
  );
  return [CABECALHO_CSV.join(";"), ...corpo].join("\n");
}

/** Vírgula decimal: o Excel em pt-BR soma a coluna sem precisar converter. */
function dinheiroCsv(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

/**
 * CSV do quadro por categoria — uma linha por contrato, duas colunas por
 * categoria presente, mais o total. Mesmas colunas que a tela mostra, porque
 * planilha que não confere com a tela vira discussão sobre qual das duas está
 * certa.
 */
export function gerarCsvPorCategoria(
  contratos: ContratoPorCategoria[],
  categoriasPresentes: CategoriaItem[],
): string {
  const cats = categoriasPresentes;
  const totais = totalizar(contratos);
  const cabecalho = [
    "Contrato",
    ...cats.flatMap((c) => [`${ROTULO_CATEGORIA[c]} - Quantidade`, `${ROTULO_CATEGORIA[c]} - Valor`]),
    "Quantidade total",
    "Valor total",
  ];
  const corpo = contratos.map((r) =>
    [
      r.contrato_nome,
      ...cats.flatMap((c) => [r.porCategoria[c].quantidade, dinheiroCsv(r.porCategoria[c].valor)]),
      r.quantidade,
      dinheiroCsv(r.valor),
    ]
      .map(campoCsv)
      .join(";"),
  );
  const rodape = [
    "Total geral",
    ...cats.flatMap((c) => [
      totais.totalPorCategoria[c].quantidade,
      dinheiroCsv(totais.totalPorCategoria[c].valor),
    ]),
    totais.quantidade,
    dinheiroCsv(totais.valor),
  ]
    .map(campoCsv)
    .join(";");
  return [cabecalho.join(";"), ...corpo, rodape].join("\n");
}
