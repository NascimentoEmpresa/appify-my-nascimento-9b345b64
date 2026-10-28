/**
 * Rotatividade do Estoque — tipos e regras de leitura da aba.
 *
 * A conta pesada é toda da RPC `sup_dashboard_rotatividade_estoque`. Aqui mora
 * só o que transforma número em leitura: classificar giro, dizer se um tamanho
 * está sobrando ou faltando, e comparar a grade declarada com a saída real.
 *
 * Os limiares de giro e de cobertura são o primeiro palpite informado, não
 * verdade de negócio: foram calibrados sobre o histórico de 2026 (giro geral
 * de 0,20 no acumulado do ano) e devem ser revisados com Suprimentos quando a
 * diretoria usar a tela por alguns meses. Estão isolados em
 * LIMIAR_GIRO/LIMIAR_COBERTURA justamente para serem ajustados num lugar só.
 */

export type CategoriaRotatividade = string;

export interface FiltroRotatividade {
  inicio: string;
  fim: string;
  contratoId: string | null;
  categoria: CategoriaRotatividade;
}

export interface TamanhoRotatividade {
  tamanho: string;
  ordem: number;
  pedidas: number;
  valor_pedido: number;
  entradas: number;
  saidas: number;
  devolucoes: number;
  saldo_disponivel: number;
  reservado: number;
  giro: number | null;
  dias_cobertura: number | null;
  pct_pedidas: number;
  declarado_pessoas: number;
  pct_declarado: number;
}

export interface PecaRotatividade {
  codigo: string | null;
  peca: string;
  pedidas: number;
  valor_pedido: number;
  entradas: number;
  saidas: number;
  saldo_disponivel: number;
  tamanho_top: string | null;
  giro: number | null;
}

/** Unidade de decisão operacional: produto identificado + tamanho. */
export interface ItemTamanhoRotatividade {
  codigo: string | null;
  item: string;
  tamanho: string | null;
  pedidas: number;
  entradas: number;
  saidas: number;
  fisico: number;
  reservado: number;
  saldo_disponivel: number;
  giro: number | null;
}

export interface ContratoRotatividade {
  contrato: string;
  contrato_id: string | null;
  pedidos: number;
  unidades: number;
  valor: number;
  tamanho_top: string | null;
}

export interface MesRotatividade {
  mes: string;
  rotulo: string;
  pedidas: number;
  valor: number;
  entradas: number;
  saidas: number;
}

/** Linha mensal do histórico que orienta a futura política de estoque mínimo. */
export interface HistoricoUniformeLinha {
  mes: string;
  /**
   * Origem operacional do pedido. O campo vem de `sup_pedido.admissao` e
   * `tipo_admissao`; não é inferido do volume, para não misturar uma demanda
   * de implantação com reposição recorrente na conta do estoque mínimo.
   */
  origem_demanda: "implantacao_aditivo" | "substituicao" | "reposicao";
  tipo_uniforme: string;
  tamanho: string | null;
  solicitados: number;
  utilizados: number;
}

/** Baixa física de uniforme, identificada pela pessoa atendida no pedido. */
export interface FornecimentoUniformeColaborador {
  data_fornecimento: string;
  colaborador: string;
  matricula: string | null;
  contrato: string;
  posto: string;
  protocolo: string;
  tipo_uniforme: string;
  tamanho: string | null;
  quantidade: number;
}

export interface GradeDeclarada {
  peca: string;
  tamanho: string;
  ordem: number;
  pessoas: number;
}

export interface AlertaRotatividade {
  ordem: number;
  tipo:
    | "grade_sem_declaracao"
    | "declarado_sem_estoque"
    | "sem_preco"
    | "catalogo_duplicado"
    | string;
  titulo: string;
  detalhe: string | null;
  unidades: number;
}

export interface DestaqueTamanho {
  tamanho: string;
  unidades?: number;
  percentual?: number;
  giro?: number;
  saldo?: number;
  saidas?: number;
}

export interface DestaqueItemTamanho {
  codigo: string | null;
  item: string;
  tamanho: string | null;
  unidades?: number;
  giro?: number;
  saldo?: number;
  saidas?: number;
}

export interface RotatividadeEstoqueDados {
  atualizado_em: string;
  categoria: string | null;
  periodo: { inicio: string; fim: string; dias: number };
  /** Data do primeiro movimento de almoxarifado registrado — ver `avisoMovimento`. */
  movimento_desde: string | null;
  filtros: {
    contratos: { id: string; nome: string }[];
    categorias: { valor: string; nome: string }[];
  };
  resumo: {
    pedidos: number;
    unidades_pedidas: number;
    valor_pedido: number;
    unidades_sem_tamanho: number;
    unidades_sem_preco: number;
    entradas: number;
    saidas: number;
    devolucoes: number;
    saldo_fisico: number;
    reservado: number;
    saldo_disponivel: number;
    itens_distintos: number;
    tamanhos_distintos: number;
    giro: number | null;
    tamanho_mais_sai: DestaqueTamanho | null;
    tamanho_mais_entra: DestaqueTamanho | null;
    tamanho_maior_giro: DestaqueTamanho | null;
    item_tamanho_mais_sai: DestaqueItemTamanho | null;
    item_tamanho_mais_entra: DestaqueItemTamanho | null;
    item_tamanho_maior_giro: DestaqueItemTamanho | null;
    peca_mais_sai: { codigo: string | null; peca: string; unidades: number } | null;
    tamanhos_zerados: number;
  };
  por_tamanho: TamanhoRotatividade[];
  por_item_tamanho: ItemTamanhoRotatividade[];
  por_peca: PecaRotatividade[];
  por_contrato: ContratoRotatividade[];
  evolucao: MesRotatividade[];
  grade_declarada: GradeDeclarada[];
  levantamento_resumo: {
    pessoas: number;
    respostas: number;
    contratos: number;
    sem_contrato: number;
    ultima_resposta: string | null;
  };
  alertas: AlertaRotatividade[];
}

/** Tamanho com `ordem` abaixo de 1000 é escala de letra (PP…EXGG). */
export const ORDEM_PRIMEIRO_NUMERICO = 1000;

export type SituacaoGiro = "sem_saida" | "parado" | "lento" | "saudavel" | "acelerado";

export const LIMIAR_GIRO = { lento: 0.25, saudavel: 1 } as const;
export const LIMIAR_COBERTURA = { risco: 30, adequado: 180 } as const;

export function escalaDoTamanho(ordem: number): "letra" | "numero" {
  return ordem < ORDEM_PRIMEIRO_NUMERICO ? "letra" : "numero";
}

export function somenteLetras<T extends { ordem: number }>(linhas: T[]): T[] {
  return linhas.filter((linha) => escalaDoTamanho(linha.ordem) === "letra");
}

/**
 * Classifica o giro de um tamanho. "Parado" é diferente de "sem saída": o
 * primeiro tem estoque e não sai, o segundo não teve movimento nenhum no
 * período — e um tamanho que nunca saiu porque nunca entrou não é problema de
 * rotatividade.
 */
export function situacaoGiro(linha: {
  giro: number | null;
  saidas: number;
  saldo_disponivel: number;
}): SituacaoGiro {
  if (linha.saidas <= 0) {
    return linha.saldo_disponivel > 0 ? "parado" : "sem_saida";
  }
  const giro = linha.giro ?? 0;
  if (giro < LIMIAR_GIRO.lento) return "lento";
  if (giro < LIMIAR_GIRO.saudavel) return "saudavel";
  return "acelerado";
}

export function rotuloSituacaoGiro(situacao: SituacaoGiro): string {
  const mapa: Record<SituacaoGiro, string> = {
    sem_saida: "Sem movimento",
    parado: "Parado",
    lento: "Lento",
    saudavel: "Saudável",
    acelerado: "Acelerado",
  };
  return mapa[situacao];
}

/**
 * Cor por situação. São cores de ESTADO, reservadas — nunca reaproveitadas
 * como cor de série nos gráficos, e sempre acompanhadas do rótulo em texto,
 * para quem não distingue as cores continuar lendo a tabela.
 */
export function classeSituacaoGiro(situacao: SituacaoGiro): string {
  const mapa: Record<SituacaoGiro, string> = {
    sem_saida: "bg-slate-200 text-slate-700",
    parado: "bg-rose-100 text-rose-700",
    lento: "bg-amber-100 text-amber-700",
    saudavel: "bg-emerald-100 text-emerald-700",
    acelerado: "bg-blue-100 text-blue-700",
  };
  return mapa[situacao];
}

export type SituacaoCobertura = "sem_estoque" | "risco" | "adequado" | "alto" | "indefinida";

/**
 * Cobertura em dias = saldo ÷ consumo diário do período. Sem saída no período
 * não há consumo para projetar, então a cobertura é indefinida — e não
 * "infinita", que a tela mostraria como um número gigante sem significado.
 */
export function situacaoCobertura(linha: {
  dias_cobertura: number | null;
  saldo_disponivel: number;
  saidas: number;
}): SituacaoCobertura {
  if (linha.saldo_disponivel <= 0) return "sem_estoque";
  if (linha.saidas <= 0 || linha.dias_cobertura === null) return "indefinida";
  if (linha.dias_cobertura <= LIMIAR_COBERTURA.risco) return "risco";
  if (linha.dias_cobertura <= LIMIAR_COBERTURA.adequado) return "adequado";
  return "alto";
}

export function rotuloSituacaoCobertura(situacao: SituacaoCobertura): string {
  const mapa: Record<SituacaoCobertura, string> = {
    sem_estoque: "Sem estoque",
    risco: "Risco de falta",
    adequado: "Adequado",
    alto: "Estoque alto",
    indefinida: "Sem consumo",
  };
  return mapa[situacao];
}

export function classeSituacaoCobertura(situacao: SituacaoCobertura): string {
  const mapa: Record<SituacaoCobertura, string> = {
    sem_estoque: "bg-rose-100 text-rose-700",
    risco: "bg-amber-100 text-amber-700",
    adequado: "bg-emerald-100 text-emerald-700",
    alto: "bg-blue-100 text-blue-700",
    indefinida: "bg-slate-200 text-slate-700",
  };
  return mapa[situacao];
}

export interface LinhaComparativoGrade {
  tamanho: string;
  ordem: number;
  pct_declarado: number;
  pct_saida: number;
  /** pct_saida − pct_declarado. Positivo = sai mais do que a equipe declarou. */
  gap: number;
  pessoas: number;
  unidades: number;
}

/**
 * Compara a grade declarada no levantamento com a saída real, em percentual.
 *
 * Os dois lados vão normalizados a 100% de propósito: um é voto de pessoa
 * (quantas pessoas vestem M) e o outro é unidade movimentada (quantas peças M
 * saíram). Somar ou subtrair os números crus não diria nada; o que interessa é
 * se a FORMA das duas distribuições é a mesma.
 *
 * Só escala de letra entra. Calçado tem numeração própria e não tem como ser
 * comparado com a grade de vestuário na mesma barra.
 */
export function compararGrade(linhas: TamanhoRotatividade[]): LinhaComparativoGrade[] {
  return somenteLetras(linhas)
    .filter((linha) => linha.pct_declarado > 0 || linha.pct_pedidas > 0)
    .map((linha) => ({
      tamanho: linha.tamanho,
      ordem: linha.ordem,
      pct_declarado: linha.pct_declarado,
      pct_saida: linha.pct_pedidas,
      gap: Math.round((linha.pct_pedidas - linha.pct_declarado) * 10) / 10,
      pessoas: linha.declarado_pessoas,
      unidades: linha.pedidas,
    }))
    .sort((a, b) => a.ordem - b.ordem);
}

/**
 * O maior desalinhamento entre o que a equipe veste e o que sai do estoque.
 * É a resposta curta para "a gente compra o tamanho certo?".
 */
export function maiorDesalinhamento(
  comparativo: LinhaComparativoGrade[],
): LinhaComparativoGrade | null {
  let melhor: LinhaComparativoGrade | null = null;
  for (const linha of comparativo) {
    // Tamanho sem nenhuma declaração não é desalinhamento de grade, é rótulo
    // que o formulário não oferece — isso já aparece como alerta próprio.
    if (linha.pessoas === 0) continue;
    if (!melhor || Math.abs(linha.gap) > Math.abs(melhor.gap)) melhor = linha;
  }
  return melhor;
}

/**
 * Pedidos existem desde março/2026, mas o almoxarifado só registra entrada e
 * saída física desde que o módulo de estoque entrou em operação. Quando o
 * período pedido começa antes disso, entrada/saída/giro cobrem só uma parte —
 * e a tela precisa dizer isso, senão o diretor lê "551 entradas no ano".
 */
export function avisoMovimento(
  inicio: string,
  movimentoDesde: string | null,
): string | null {
  if (!movimentoDesde || !inicio || movimentoDesde <= inicio) return null;
  const data = new Date(`${movimentoDesde}T12:00:00`).toLocaleDateString("pt-BR");
  return (
    `Entradas, saídas e giro contam a partir de ${data}, quando o controle do ` +
    `almoxarifado entrou em operação. Unidades pedidas e valor cobrem o período inteiro.`
  );
}

export function formatarGiro(giro: number | null | undefined): string {
  if (giro === null || giro === undefined || !Number.isFinite(giro)) return "—";
  return `${giro.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

/** Acima de 999 dias o número exato não informa nada além de "sobra muito". */
export function formatarCobertura(dias: number | null | undefined): string {
  if (dias === null || dias === undefined || !Number.isFinite(dias)) return "—";
  if (dias > 999) return "+999 dias";
  return `${Math.round(dias).toLocaleString("pt-BR")} dias`;
}

export function formatarPercentual(valor: number | null | undefined, casas = 1): string {
  return `${Number(valor ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

/** "+3,2 p.p." / "−1,8 p.p." — diferença entre dois percentuais é ponto percentual. */
export function formatarGap(gap: number): string {
  const sinal = gap > 0 ? "+" : gap < 0 ? "−" : "";
  const absoluto = Math.abs(gap).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${sinal}${absoluto} p.p.`;
}

/**
 * O valor é estimado: metade das unidades pedidas em 2026 é de item sem preço
 * cadastrado em sup_estoque_item, e essas entram como zero. A tela precisa
 * mostrar a cobertura junto do valor para ninguém tratar o número como total.
 */
export function coberturaDePreco(resumo: {
  unidades_pedidas: number;
  unidades_sem_preco: number;
}): number {
  if (resumo.unidades_pedidas <= 0) return 0;
  const comPreco = resumo.unidades_pedidas - resumo.unidades_sem_preco;
  return Math.round((comPreco / resumo.unidades_pedidas) * 1000) / 10;
}
