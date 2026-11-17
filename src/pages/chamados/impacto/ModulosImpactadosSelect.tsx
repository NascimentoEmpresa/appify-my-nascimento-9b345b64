import { incluirPosicao, POSICAO_OUTRO } from "@/lib/chamados/impactoSistemico";
import { rotuloModuloImpactado } from "../impactados";
import { ArvoreModulosPicker } from "./ArvoreModulosPicker";
import { useArvoreModulos } from "./catalogoTelas";

// =====================================================================
// MÓDULOS DO SISTEMA IMPACTADOS — o campo, sozinho (SIS-2026-0910).
//
// Isolado de propósito para o SIS-2026-0921 trocar o miolo: desde então a
// escolha é hierárquica, Setor → telas, com a árvore da própria barra
// lateral (catalogoTelas.ts). Grava a ROTA de cada tela. Valores amplos
// antigos (MODULOS_ERP) que vierem num "abrir baseado nesse" aparecem como
// chips e podem ser tirados. O contrato fica: `value`/`onChange` com a lista
// de valores (texto) e `posicao` — o módulo diretamente ajustado, que entra
// sempre na lista e não sai pelo "x" (para tirá-lo, troque a posição).
// =====================================================================

export interface ModulosImpactadosSelectProps {
  value: string[];
  onChange: (v: string[]) => void;
  /** Posição (modulo_sistema) já escolhida — vai junto e aparece marcada. */
  posicao?: string;
  disabled?: boolean;
}

export function ModulosImpactadosSelect({ value, onChange, posicao, disabled }: ModulosImpactadosSelectProps) {
  const { arvore, indice } = useArvoreModulos();
  return (
    <ArvoreModulosPicker
      multiplo
      arvore={arvore}
      indice={indice}
      rotulo={rotuloModuloImpactado}
      value={value}
      onChange={(v) => onChange(incluirPosicao(v, posicao))}
      destaque={posicao && posicao !== POSICAO_OUTRO ? posicao : null}
      disabled={disabled}
      placeholder="Selecionar setor › telas impactadas"
    />
  );
}

/** Rótulo da posição: "Outro" explicado, senão o de qualquer módulo gravado. */
export const rotuloPosicao = (v: string) =>
  v === POSICAO_OUTRO ? "Outro (sistema fora do ERP)" : rotuloModuloImpactado(v);

/**
 * POSIÇÃO DO NOVO MÓDULO OU MÓDULO DIRETAMENTE AJUSTADO (modulo_sistema) com
 * a mesma árvore (SIS-2026-0921): uma tela só, mais "Outro" para sistema fora
 * do ERP. Valor amplo antigo (chamado de antes, Coordenar) aparece com o
 * rótulo antigo até alguém trocar.
 */
export function PosicaoModuloSelect({ value, onChange, disabled, className }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { arvore, indice } = useArvoreModulos();
  return (
    <ArvoreModulosPicker
      arvore={arvore}
      indice={indice}
      rotulo={rotuloPosicao}
      value={value}
      onChange={onChange}
      destaque={value || null}
      disabled={disabled}
      className={className}
      placeholder="Selecionar setor › tela ajustada…"
      extras={[{ value: POSICAO_OUTRO, label: "Outro", hint: "Sistema fora do ERP (informe qual)" }]}
    />
  );
}
