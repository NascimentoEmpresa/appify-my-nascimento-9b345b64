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
