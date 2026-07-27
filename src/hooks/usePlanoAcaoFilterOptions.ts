import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PlanoAcaoRow } from "@/hooks/usePlanoAcoes";
import type { SearchableOption } from "@/components/ui/searchable-select";

/**
 * Extrai opções de filtro (Responsável, Comitê, Área, Setor) a partir das
 * rows já carregadas pela tela — Comitê/Área/Setor são client-side, sem
 * query extra. Responsável busca o nome em profiles (fonte viva), não no
 * texto congelado em responsavel_nome_origem, pra não desalinhar o rótulo
 * do filtro do texto exibido nas linhas.
 *
 * Responsável tem dois caminhos:
 *  - canônico: value = `pid:${responsavel_profile_id}` (representa o usuário)
 *  - legado:   value = `nome:${responsavel_nome_origem}` (texto livre, marcado)
 */
export interface PlanoAcaoFilterOptions {
  comites: SearchableOption[];
  areas: SearchableOption[];
  setores: SearchableOption[];
  responsaveis: SearchableOption[];
}

const cmp = (a: SearchableOption, b: SearchableOption) =>
  a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });

function uniqText(rows: PlanoAcaoRow[], pick: (r: PlanoAcaoRow) => string | null | undefined): SearchableOption[] {
  const set = new Set<string>();
  rows.forEach((r) => {
    const v = pick(r);
    if (v && v.trim()) set.add(v.trim());
  });
  return Array.from(set).map((v) => ({ value: v, label: v })).sort(cmp);
}

export function usePlanoAcaoFilterOptions(rows: PlanoAcaoRow[]): PlanoAcaoFilterOptions {
  const profileIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.responsavel_profile_id).filter((id): id is string => !!id))),
    [rows],
  );

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
    const comites = uniqText(rows, (r) => r.comite);
    const areas = uniqText(rows, (r) => r.area);
    const setores = uniqText(rows, (r) => r.setor);

    // Responsável: canônico (profile_id) preferencial; agrupar por id.
    const canonicos = new Map<string, string>(); // profile_id -> label
    const legados = new Set<string>();
    rows.forEach((r) => {
      if (r.responsavel_profile_id) {
        const label = profileNames[r.responsavel_profile_id]?.trim()
          || r.responsavel_nome_origem?.trim()
          || "Usuário vinculado";
        canonicos.set(r.responsavel_profile_id, label);
      } else if (r.responsavel_nome_origem && r.responsavel_nome_origem.trim()) {
        legados.add(r.responsavel_nome_origem.trim());
      }
    });

    const responsaveis: SearchableOption[] = [
      ...Array.from(canonicos.entries()).map(([pid, label]) => ({
        value: `pid:${pid}`,
        label,
      })),
      ...Array.from(legados).map((nome) => ({
        value: `nome:${nome}`,
        label: nome,
        hint: "legado / sem vínculo",
      })),
    ].sort(cmp);

    return { comites, areas, setores, responsaveis };
  }, [rows, profileNames]);
}

/**
 * Aplica filtro de responsável usando o value codificado pelo hook acima.
 *  - "pid:<uuid>"  → match por responsavel_profile_id
 *  - "nome:<txt>"  → match por responsavel_nome_origem (sem profile_id)
 */
export function matchResponsavel(row: PlanoAcaoRow, value: string | "__all"): boolean {
  if (!value || value === "__all") return true;
  if (value.startsWith("pid:")) {
    return row.responsavel_profile_id === value.slice(4);
  }
  if (value.startsWith("nome:")) {
    return !row.responsavel_profile_id && (row.responsavel_nome_origem ?? "").trim() === value.slice(5);
  }
  return true;
}
