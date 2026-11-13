// =====================================================================
// Implantação de Contratos — quem pode EDITAR o checklist (15/11/2026)
//
// Ver a tela e editar o checklist são coisas separadas a pedido do Pablo.
// Editar é a ação 'alterar' do próprio menu da tela, com switch próprio em
// Administração › Acesso por Usuário › Licitação › Implantação de Contratos
// ("Pode editar o checklist" — ACOES_FORA_DO_TOGGLE em acoesDoToggleAcesso.ts).
// O banco exige a mesma ação para gravar (mig 20261115000300).
// =====================================================================
import type { AppAcao } from "@/hooks/useScreenAccess";

export const MENU_EDITAR_CHECKLIST = "licitacoes.implantacao";

export const ACAO_EDITAR_CHECKLIST: AppAcao = "alterar";

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
