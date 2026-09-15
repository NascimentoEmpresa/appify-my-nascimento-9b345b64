import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PlanoAcaoRow } from "@/hooks/usePlanoAcoes";
import type { SearchableOption } from "@/components/ui/searchable-select";
import { chaveTextoPlanoAcao } from "@/lib/chaveTextoPlanoAcao";

/**
 * Extrai opções de filtro (Responsável, Comitê, Área, Setor) a partir das
 * rows já carregadas pela tela — Comitê/Área/Setor são client-side, sem
 * query extra. Responsável busca o nome em profiles (fonte viva), não no
 * texto congelado em responsavel_nome_origem, pra não desalinhar o rótulo
 * do filtro do texto exibido nas linhas.
 *
 * Comitê/Área/Setor: value = chaveTextoPlanoAcao(texto) — grafias diferentes
 * do mesmo setor ("Jurídico"/"JURIDICO", "Licitações"/"LICITACAO") viram UMA
 * opção só (SIS-2026-0392). Filtre com matchTexto(), nunca por igualdade
 * direta com o texto da row.
 *
 * Responsável tem dois caminhos:
 *  - canônico: value = `pid:${responsavel_profile_id}` (representa o usuário)
 *  - legado:   value = `nome:${chave do responsavel_nome_origem}` (texto livre, marcado)
 *
 * Todos os filtros aceitam vários valores (string[]); lista vazia = sem filtro.
 */
export interface PlanoAcaoFilterOptions {
  comites: SearchableOption[];
  areas: SearchableOption[];
  setores: SearchableOption[];
  responsaveis: SearchableOption[];
  empresas: SearchableOption[];
  /** empresa_id -> código, pra exibir na coluna Empresa da Lista. */
  empresaLabelById: Record<string, string>;
}

const cmp = (a: SearchableOption, b: SearchableOption) =>
  a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });

// Entre as grafias de um mesmo grupo, mostra a mais usada; no empate, a que
// não está toda em maiúsculas e tem acento ("Jurídico" antes de "JURIDICO").
function melhorRotulo(contagem: Map<string, number>): string {
  const pontos = (s: string) => (s !== s.toUpperCase() ? 2 : 0) + (/[À-ɏ]/.test(s) ? 1 : 0);
  return Array.from(contagem.entries()).sort(([a, na], [b, nb]) =>
    nb - na || pontos(b) - pontos(a) || a.localeCompare(b, "pt-BR"),
  )[0][0];
}

function agruparTexto(rows: PlanoAcaoRow[], pick: (r: PlanoAcaoRow) => string | null | undefined): SearchableOption[] {
  const grupos = new Map<string, Map<string, number>>();
  rows.forEach((r) => {
    const v = pick(r)?.trim();
    if (!v) return;
    const k = chaveTextoPlanoAcao(v);
    if (!k) return;
    const g = grupos.get(k) ?? new Map<string, number>();
    g.set(v, (g.get(v) ?? 0) + 1);
    grupos.set(k, g);
  });
  return Array.from(grupos.entries()).map(([value, g]) => ({ value, label: melhorRotulo(g) })).sort(cmp);
}

export function usePlanoAcaoFilterOptions(rows: PlanoAcaoRow[]): PlanoAcaoFilterOptions {
  const profileIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.responsavel_profile_id).filter((id): id is string => !!id))),
    [rows],
  );

  const empresaIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.empresa_id).filter((id): id is string => !!id))),
    [rows],
  );

  // Nome/código da empresa buscado à parte, sem embed do PostgREST — não há
  // FK declarada de plano_acao.empresa_id para empresas(id), então
  // "empresas:empresa_id(...)" no select do usePlanoAcoes dava 400 em toda
  // a query (derrubava a tela inteira, não só o filtro de Empresa).
  const { data: empresaLabels = {} } = useQuery({
    queryKey: ["plano_acao_filter_empresas", empresaIds],
    enabled: empresaIds.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data } = await supabase.from("empresas").select("id, codigo, razao_social").in("id", empresaIds);
      const map: Record<string, string> = {};
      (data ?? []).forEach((e: any) => { map[e.id] = e.codigo ?? e.razao_social ?? e.id; });
      return map;
    },
  });

  // Nome do responsável resolvido direto de profiles (fonte viva) — nunca do
  // texto congelado em responsavel_nome_origem, que é só um snapshot salvo
  // no momento da ação e pode divergir do nome atual (renomeação, ação
  // antiga salva antes de algum fix, etc.), fazendo o rótulo do filtro não
  // bater com o texto exibido nas linhas da tabela.
  const { data: profileNames = {} } = useQuery({
    queryKey: ["plano_acao_filter_responsavel_nomes", profileIds],
    enabled: profileIds.length > 0,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data } = await supabase.from("profiles").select("id, display_name").in("id", profileIds);
      const map: Record<string, string> = {};
      (data ?? []).forEach((p: any) => { if (p.display_name) map[p.id] = p.display_name; });
      return map;
    },
  });

  return useMemo(() => {
    const comites = agruparTexto(rows, (r) => r.comite);
    const areas = agruparTexto(rows, (r) => r.area);
    const setores = agruparTexto(rows, (r) => r.setor);

    // Empresa: value = empresa_id (não o código), pra não colidir se dois
    // códigos coincidirem por acaso.
    const empresaIdsUnicos = Array.from(new Set(rows.map((r) => r.empresa_id).filter(Boolean)));
    const empresas: SearchableOption[] = empresaIdsUnicos
      .map((id) => ({ value: id, label: empresaLabels[id] ?? id }))
      .sort(cmp);

    // Responsável: canônico (profile_id) preferencial; agrupar por id.
    const canonicos = new Map<string, string>(); // profile_id -> label
    const legados = new Map<string, Map<string, number>>(); // chave -> grafias
    rows.forEach((r) => {
      if (r.responsavel_profile_id) {
        const label = profileNames[r.responsavel_profile_id]?.trim()
          || r.responsavel_nome_origem?.trim()
          || "Usuário vinculado";
        canonicos.set(r.responsavel_profile_id, label);
      } else if (r.responsavel_nome_origem && r.responsavel_nome_origem.trim()) {
        const nome = r.responsavel_nome_origem.trim();
        const k = chaveTextoPlanoAcao(nome);
        const g = legados.get(k) ?? new Map<string, number>();
        g.set(nome, (g.get(nome) ?? 0) + 1);
        legados.set(k, g);
      }
    });

    const responsaveis: SearchableOption[] = [
      ...Array.from(canonicos.entries()).map(([pid, label]) => ({
        value: `pid:${pid}`,
        label,
      })),
      ...Array.from(legados.entries()).map(([k, g]) => ({
        value: `nome:${k}`,
        label: melhorRotulo(g),
        hint: "legado / sem vínculo",
      })),
    ].sort(cmp);

    return { comites, areas, setores, responsaveis, empresas, empresaLabelById: empresaLabels };
  }, [rows, profileNames, empresaLabels]);
}

/** Filtro de Comitê/Área/Setor com vários valores (chaves do hook acima). Vazio = sem filtro. */
export function matchTexto(valorRow: string | null | undefined, selecionados: string[]): boolean {
  if (selecionados.length === 0) return true;
  return selecionados.includes(chaveTextoPlanoAcao(valorRow));
}

/**
 * Aplica filtro de responsável usando os values codificados pelo hook acima.
 *  - "pid:<uuid>"  → match por responsavel_profile_id
 *  - "nome:<txt>"  → match por responsavel_nome_origem (sem profile_id)
 * Vários valores = OU entre eles; vazio = sem filtro.
 */
export function matchResponsavel(row: PlanoAcaoRow, selecionados: string[]): boolean {
  if (selecionados.length === 0) return true;
  return selecionados.some((value) => {
    if (value.startsWith("pid:")) return row.responsavel_profile_id === value.slice(4);
    if (value.startsWith("nome:")) {
      return !row.responsavel_profile_id && chaveTextoPlanoAcao(row.responsavel_nome_origem) === chaveTextoPlanoAcao(value.slice(5));
    }
    return false;
  });
}

/**
 * Normaliza valores vindos de fora (URL/sessionStorage salvos antes da chave
 * existir, ex. "?comite=Comitê Diretivo" ou "?resp=nome:Fulano") pra chave
 * atual — sem isso o reset de "valor que não existe mais" apagaria o filtro.
 */
export function normalizarValorTexto(v: string): string {
  return chaveTextoPlanoAcao(v);
}
export function normalizarValorResponsavel(v: string): string {
  return v.startsWith("nome:") ? `nome:${chaveTextoPlanoAcao(v.slice(5))}` : v;
}

/** Remove da seleção valores que não existem mais nas opções. Devolve a MESMA referência quando nada muda (seguro em useEffect). */
export function manterValidos(selecionados: string[], opcoes: SearchableOption[]): string[] {
  const validos = selecionados.filter((v) => opcoes.some((o) => o.value === v));
  return validos.length === selecionados.length ? selecionados : validos;
}
