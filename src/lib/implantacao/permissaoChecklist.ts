// =====================================================================
// Implantação de Contratos — quem pode EDITAR o checklist (15/11/2026)
//
// Ver a tela (menu 'licitacoes.implantacao') e editar o checklist viraram
// coisas separadas a pedido do Pablo: "aqui precisa de um gerenciamento de
// acesso diferente". Editar é o menu fantasma abaixo, liberado por pessoa em
// Administração › Acesso por Usuário › Licitação. O banco exige o mesmo menu
// para gravar (mig 20261115000300) — a tela só esconde os botões, quem
// decide é a RLS.
// =====================================================================
import type { AppAcao } from "@/hooks/useScreenAccess";

export const MENU_EDITAR_CHECKLIST = "licitacoes-implantacao-editar-checklist";

/** Menu fantasma só tem a ação 'visualizar' — ela é o "pode". */
export const ACAO_EDITAR_CHECKLIST: AppAcao = "visualizar";

// ---------------------------------------------------------------------
// Resumo dos Contratos (15/11/2026): cada painel tem menu próprio em
// Licitação, com rota (mig 20261115000400). O RouteGuard e o menu lateral
// casam pelo prefixo mais longo, então /painel/compras é do menu de Compras
// e um setor fora desta lista cai no Resumo geral. A lista é a MESMA da
// migration e do Sidebar — o teste confere as três.
// ---------------------------------------------------------------------
export const MENU_RESUMO_GERAL = "licitacoes-implantacao-painel";

export const SLUGS_PAINEL_SETOR = [
  "compras",
  "financeiro",
  "licitacao",
  "operacional",
  "recrutamento",
  "rh",
  "sst",
  "treinamentos",
] as const;

/** Código de menu da tela do painel daquele setor (slug de slugSetor()). */
export function menuDoPainel(slug: string | null | undefined): string {
  return slug && (SLUGS_PAINEL_SETOR as readonly string[]).includes(slug)
    ? `${MENU_RESUMO_GERAL}-${slug}`
    : MENU_RESUMO_GERAL;
}
