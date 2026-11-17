import { useEffect, useMemo, useSyncExternalStore } from "react";
import { NAV_MODULOS, iconeDoModulo, modulosComFixos, type NavItemDef, type NavModuleDef } from "@/components/layout/Sidebar";
import { useMenuLateral } from "@/hooks/useMenuLateral";
import { montarMenu } from "@/lib/menuLateral/estrutura";
import {
  assinarIndiceDasTelas, indexarArvore, indiceDasTelas, montarArvoreModulos, registrarArvoreModulos,
  type InfoTela, type SetorArvore,
} from "@/lib/chamados/arvoreModulos";

// =====================================================================
// SETOR → TELAS DA BARRA LATERAL, para os módulos impactados (SIS-2026-0921).
//
// A MESMA fonte da barra lateral, sem lista paralela: o catálogo NAV_MODULOS
// (Sidebar.tsx) passado pela organização salva (useMenuLateral), exatamente
// como a Sidebar faz em `allModules`, mais os itens fixos dela (Início,
// Novidades, Aguardando Aprovação no topo; Configurações do ERP no rodapé —
// NAV_FIXOS/modulosComFixos). Tela nova no catálogo, tela retirada ou movida
// no Organizar Menu Lateral → a árvore do chamado muda junto.
//
// Diferença proposital da barra lateral: aqui NÃO há filtro de acesso. Quem
// abre o chamado precisa poder dizer que a mudança atinge uma tela que ele
// mesmo não abre (ex.: Controladoria apontando reflexo no Financeiro).
// =====================================================================

/** A árvore da barra lateral a partir dos módulos já organizados. */
export const arvoreDaBarra = (modulos: NavModuleDef[]) =>
  montarArvoreModulos(modulosComFixos(modulos).map((m) => ({ ...m, icon: iconeDoModulo(m) })));

// Registro imediato com o catálogo (sem a organização salva), para rótulos em
// lista/CSV antes de a Sidebar montar. A Sidebar registra de novo com a
// organização salva assim que ela chega.
registrarArvoreModulos(arvoreDaBarra(montarMenu<NavItemDef, NavModuleDef>(NAV_MODULOS, null)));

export interface ArvoreModulos {
  arvore: SetorArvore[];
  indice: Map<string, InfoTela>;
}

/** A árvore como o usuário vê na barra lateral (organização salva aplicada). */
export function useArvoreModulos(): ArvoreModulos {
  const modulos = useMenuLateral<NavItemDef, NavModuleDef>(NAV_MODULOS);
  const r = useMemo(() => {
    const arvore = arvoreDaBarra(modulos);
    return { arvore, indice: indexarArvore(arvore) };
  }, [modulos]);
  useEffect(() => { registrarArvoreModulos(r.arvore); }, [r]);
  return r;
}

/**
 * O índice global (o que moduloLabel/rotuloModuloImpactado leem), com
 * re-render quando ele muda — para tela que não monta a árvore inteira.
 */
export function useIndiceDasTelas() {
  return useSyncExternalStore(assinarIndiceDasTelas, indiceDasTelas, indiceDasTelas);
}
