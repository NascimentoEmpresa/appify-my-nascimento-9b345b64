import { useMemo } from "react";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { incluirPosicao } from "@/lib/chamados/impactoSistemico";
import { opcoesModulosImpactados } from "../impactados";

// =====================================================================
// MÓDULOS DO SISTEMA IMPACTADOS — o campo, sozinho (SIS-2026-0910).
//
// Isolado de propósito: o SIS-2026-0921 troca o miolo por uma seleção
// hierárquica setor → telas do menu lateral (app_menu) sem mexer no resto do
// formulário. O contrato fica: `value`/`onChange` com a lista de valores
// (texto) e `posicao` — o módulo diretamente ajustado, que entra sempre na
// lista e não sai pelo "x" (para tirá-lo, troque a posição).
// =====================================================================

export interface ModulosImpactadosSelectProps {
  value: string[];
  onChange: (v: string[]) => void;
  /** Posição (modulo_sistema) já escolhida — vai junto e aparece marcada. */
  posicao?: string;
  disabled?: boolean;
}

export function ModulosImpactadosSelect({ value, onChange, posicao, disabled }: ModulosImpactadosSelectProps) {
  const opcoes = useMemo(
    () => opcoesModulosImpactados.map((o) => (o.value === posicao
      ? { ...o, label: `${o.label} · ajustado`, hint: "Posição — módulo diretamente ajustado" }
      : o)),
    [posicao],
  );
  return (
    <SearchableMultiSelect
      value={value}
      onChange={(v) => onChange(incluirPosicao(v, posicao))}
      options={opcoes}
      disabled={disabled}
      placeholder="Selecionar módulos impactados"
      searchPlaceholder="Buscar módulo..."
      emptyLabel="Nenhum módulo encontrado"
    />
  );
}
