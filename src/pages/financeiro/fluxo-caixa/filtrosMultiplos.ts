// SIS-2026-0725: os filtros do Fluxo de Caixa aceitam mais de um item. Lista vazia = sem filtro (todos).
import type { SearchableOption } from "@/components/ui/searchable-select";

// Opção especial dos filtros de contrato/classificação: as linhas que na tela mostram "—".
export const FILTRO_SEM_VALOR = "__sem";

// A linha passa se a lista estiver vazia ou se casar com QUALQUER item escolhido (OU entre itens; E entre filtros diferentes).
// `temValor`: a linha tem o campo preenchido (para a opção "Sem …"); `casa`: a linha é do item `id`.
export function casaSelecao(selecionados: string[], temValor: boolean, casa: (id: string) => boolean): boolean {
  if (selecionados.length === 0) return true;
  return selecionados.some((id) => (id === FILTRO_SEM_VALOR ? !temValor : casa(id)));
}

export function opcoesDe(lista: [string, string][], rotuloSem?: string): SearchableOption[] {
  const base = lista.map(([value, label]) => ({ value, label }));
  return rotuloSem ? [{ value: FILTRO_SEM_VALOR, label: rotuloSem }, ...base] : base;
}

export function opcoesDeTextos(lista: string[]): SearchableOption[] {
  return lista.map((t) => ({ value: t, label: t }));
}

// Nomes dos itens escolhidos, para o resumo da planilha exportada.
export function nomesSelecionados(lista: [string, string][], ids: string[], vazio: string): string {
  if (ids.length === 0) return vazio;
  return ids.map((id) => (id === FILTRO_SEM_VALOR ? "Sem (—)" : lista.find(([i]) => i === id)?.[1] ?? id)).join(", ");
}

// Classificações que aparecem nas linhas do(s) tipo(s) escolhido(s) (Entrada / Saída). Lista vazia = os dois tipos.
// Com o filtro Tipo = Entrada, o filtro Classificação só oferece as classificações usadas em entradas (e vice-versa),
// para não misturar classificação de saída na análise de entradas.
export function classificacoesDoTipo(
  linhas: { tipo: string; classificacao_id?: string | null; classificacao_nome?: string | null }[],
  tipos: string[],
): [string, string][] {
  const map = new Map<string, string>();
  linhas.forEach((l) => {
    if (tipos.length > 0 && !tipos.includes(l.tipo)) return;
    if (l.classificacao_id && l.classificacao_nome) map.set(l.classificacao_id, l.classificacao_nome);
  });
  return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
}

// SIS-2026-0868: cada linha de rateio (contrato + classificação) que formou a linha agrupada do Fluxo.
// `contratoId` usa a mesma chave do rateioDetalhe (contrato_id, ou "nome:<contrato>" no importado sem cadastro).
export interface CotaContratoClassificacao {
  contratoId: string | null;
  classificacaoId: string | null;
  classificacaoNome: string | null;
}

// SIS-2026-0868: o filtro Classificação acompanha Tipo E Centro de Custo — só oferece as classificações que têm
// lançamento nos centros escolhidos (ex.: Centro = INVESTIMENTOS não lista VT se não houver VT em INVESTIMENTOS).
// Lançamento rateado entre centros: entram só as classificações das cotas dos centros escolhidos.
// Também entram as classificações de dentro do "Rateio" (classificacoesIds), que o filtro já casa.
export function classificacoesDoFiltro(
  linhas: {
    tipo: string;
    classificacao_id?: string | null;
    classificacao_nome?: string | null;
    contrato_id?: string | null;
    contrato_nome?: string | null;
    fatura_cartao_id?: string | null;
    cotasClassificacao?: CotaContratoClassificacao[];
  }[],
  tipos: string[],
  contratoIds: string[],
): [string, string][] {
  const map = new Map<string, string>();
  const add = (id?: string | null, nome?: string | null) => {
    if (id && nome && nome !== "Rateio") map.set(id, nome);
  };
  const semCentro = contratoIds.includes(FILTRO_SEM_VALOR);
  const centros = contratoIds.filter((id) => id !== FILTRO_SEM_VALOR);
  linhas.forEach((l) => {
    if (tipos.length > 0 && !tipos.includes(l.tipo)) return;
    const linhaInteira =
      contratoIds.length === 0 ||
      (!!l.contrato_id && centros.includes(l.contrato_id)) ||
      (semCentro && !l.contrato_nome);
    if (linhaInteira) {
      add(l.classificacao_id, l.classificacao_nome);
      l.cotasClassificacao?.forEach((c) => add(c.classificacaoId, c.classificacaoNome));
      return;
    }
    // Rateio entre centros (a fatura do cartão não entra no filtro por cota — ver linhaTemContrato).
    if (l.fatura_cartao_id) return;
    l.cotasClassificacao?.forEach((c) => {
      if (c.contratoId && centros.includes(c.contratoId)) add(c.classificacaoId, c.classificacaoNome);
    });
  });
  return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
}

// Ao trocar o Tipo, tira da seleção as classificações que não existem no(s) novo(s) tipo(s) ("Sem …" fica).
export function manterSelecionadasDisponiveis(selecionados: string[], disponiveis: [string, string][]): string[] {
  const ids = new Set(disponiveis.map(([id]) => id));
  return selecionados.filter((id) => id === FILTRO_SEM_VALOR || ids.has(id));
}

// Centros de custo (contratos) que aparecem nas linhas da(s) empresa(s) escolhida(s). Lista vazia = todas as empresas.
// Com o filtro Empresa marcado, o filtro Centro de Custo só oferece os contratos daquela empresa (antes listava todos).
export function contratosDasEmpresas(
  linhas: { empresa_id?: string | null; contrato_id?: string | null; contrato_nome?: string | null }[],
  empresaIds: string[],
): [string, string][] {
  const map = new Map<string, string>();
  linhas.forEach((l) => {
    if (empresaIds.length > 0 && !empresaIds.includes(l.empresa_id ?? "")) return;
    if (l.contrato_id && l.contrato_nome) map.set(l.contrato_id, l.contrato_nome);
  });
  return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
}

// SIS-2026-0913: filtros em cascata (facetas). Antes cada filtro acompanhava só alguns outros (Centro de Custo só a
// Empresa, Classificação só Tipo + Centro), e com Tipo = Saída + Classificação = Transferência entre Contas o filtro
// Centro de Custo ainda listava todos os centros (ADMINISTRATIVO - …), sem nenhum lançamento naquela combinação.
// Regra agora: as opções de cada filtro saem das linhas que passam em TODOS os OUTROS filtros — o próprio fica de
// fora, senão escolher um centro esconderia os demais centros e não daria para marcar mais de um.
export type ChaveFiltroFacetado = "tipo" | "empresa" | "origem" | "contrato" | "integrante" | "classificacao" | "forma" | "banco" | "conta";

export const CHAVES_FILTRO_FACETADO: ChaveFiltroFacetado[] = ["tipo", "empresa", "origem", "contrato", "integrante", "classificacao", "forma", "banco", "conta"];

export interface SeparacaoFacetas<L> {
  /** linhas que passam em todos os filtros (o resultado da tabela). */
  passam: L[];
  /** linhas reprovadas por UM filtro só — entram na base das opções daquele filtro. */
  quase: Record<ChaveFiltroFacetado, L[]>;
}

/**
 * Avalia cada linha uma vez. `reprova(l)` devolve os filtros facetados que a linha não passa, ou `null` quando ela já
 * cai num filtro sem faceta (data, valor, busca, situação…) — essa não entra em base nenhuma.
 */
export function separarPorFacetas<L>(linhas: L[], reprova: (l: L) => ChaveFiltroFacetado[] | null): SeparacaoFacetas<L> {
  const passam: L[] = [];
  const quase = Object.fromEntries(CHAVES_FILTRO_FACETADO.map((k) => [k, [] as L[]])) as Record<ChaveFiltroFacetado, L[]>;
  linhas.forEach((l) => {
    const falhas = reprova(l);
    if (falhas === null) return;
    if (falhas.length === 0) passam.push(l);
    else if (falhas.length === 1) quase[falhas[0]].push(l);
  });
  return { passam, quase };
}

/** Linhas que servem de base para as opções do filtro `chave`: as que passam em todos os outros filtros. */
export function baseDaFaceta<L>(sep: SeparacaoFacetas<L>, chave: ChaveFiltroFacetado): L[] {
  return sep.quase[chave].length === 0 ? sep.passam : [...sep.passam, ...sep.quase[chave]];
}

/** Pares id → nome tirados das linhas (sem repetir), em ordem alfabética. */
export function paresDasLinhas<L>(linhas: L[], par: (l: L) => [string | null | undefined, string | null | undefined]): [string, string][] {
  const map = new Map<string, string>();
  linhas.forEach((l) => {
    const [id, nome] = par(l);
    if (id && nome) map.set(id, nome);
  });
  return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
}

/**
 * Centros de custo (contratos) das linhas, incluindo os das cotas de rateio — o filtro da tabela (linhaTemContrato)
 * já acha a linha rateada pela cota, então o centro que só aparece em rateio também é opção válida.
 * Fatura do cartão fica de fora pelas cotas: o rateioDetalhe dela é por despesa, não por contrato.
 */
export function contratosDasLinhas(
  linhas: { contrato_id?: string | null; contrato_nome?: string | null; fatura_cartao_id?: string | null; rateioDetalhe?: { id: string; nome: string }[] }[],
): [string, string][] {
  const map = new Map<string, string>();
  linhas.forEach((l) => {
    if (l.contrato_id && l.contrato_nome) map.set(l.contrato_id, l.contrato_nome);
    if (!l.fatura_cartao_id) l.rateioDetalhe?.forEach((c) => c.id && c.nome && map.set(c.id, c.nome));
  });
  return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
}

/**
 * Opções de um filtro facetado. Item já escolhido que ficou sem lançamento (outro filtro mudou) continua na lista:
 * o SearchableMultiSelect só desenha o badge de quem está nas opções, e sem isso ficaria um filtro ativo invisível.
 * "Sem …" só aparece se houver linha sem o campo na base (ou se já estiver marcado).
 */
export function opcoesFacetadas(
  disponiveis: [string, string][],
  selecionados: string[],
  todos: [string, string][],
  sem?: { rotulo: string; temLinhaSem: boolean },
): SearchableOption[] {
  const ids = new Set(disponiveis.map(([id]) => id));
  const extras = selecionados
    .filter((id) => id !== FILTRO_SEM_VALOR && !ids.has(id))
    .map((id) => [id, todos.find(([i]) => i === id)?.[1] ?? id] as [string, string]);
  const lista = extras.length === 0 ? disponiveis : [...disponiveis, ...extras].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const comSem = !!sem && (sem.temLinhaSem || selecionados.includes(FILTRO_SEM_VALOR));
  return opcoesDe(lista, comSem ? sem!.rotulo : undefined);
}
