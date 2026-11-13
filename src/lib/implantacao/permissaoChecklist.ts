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
