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
