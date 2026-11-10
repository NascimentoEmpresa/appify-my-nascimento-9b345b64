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

// Ao trocar o Tipo, tira da seleção as classificações que não existem no(s) novo(s) tipo(s) ("Sem …" fica).
export function manterSelecionadasDisponiveis(selecionados: string[], disponiveis: [string, string][]): string[] {
  const ids = new Set(disponiveis.map(([id]) => id));
  return selecionados.filter((id) => id === FILTRO_SEM_VALOR || ids.has(id));
}
