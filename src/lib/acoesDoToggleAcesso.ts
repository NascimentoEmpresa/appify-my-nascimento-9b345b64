/**
 * O que o toggle de uma TELA grava no Gerenciamento de Acesso.
 *
 * O switch principal de cada linha do painel (`/app/administracao?tab=modulos`)
 * nunca valeu só por "visualizar": ele concede o pacote de trabalho inteiro.
 * A razão está no comentário de `stageAll` em ModulosMenusTab.tsx — liberar a
 * tela e deixar as ações desligadas é justamente o estado que trava a pessoa
 * no dia a dia (ela enxerga e não consegue trabalhar), e é mais fácil
 * desmarcar uma ação sobrando do que caçar uma faltando.
 *
 * Isto aqui é a EXCEÇÃO a essa regra, extraída para um módulo próprio porque
 * é lógica de permissão — quem pode aprovar pagamento —, e no projeto essa
 * classe de regra mora em `src/lib` com teste (mesmo desenho de
 * `menusOcultosGerenciamento.ts`).
 */
export type AppAcao =
  | "visualizar"
  | "incluir"
  | "alterar"
  | "excluir"
  | "aprovar"
  | "enviar_malote"
  | "exportar"
  | "executar_ia"
  | "alterar_dre"
  | "responder";

/** O pacote de trabalho que ligar uma tela concede, quando não há exceção. */
export const ACOES_DO_TOGGLE_PADRAO: readonly AppAcao[] = [
  "visualizar",
  "incluir",
  "alterar",
  "aprovar",
  "exportar",
];

/**
 * Ações que o toggle da tela NÃO concede junto, por menu.
 *
 * Existe tela em que uma das ações do pacote é a DECISÃO em si, e aí "ligar a
 * tela" não pode significar "ganhou o poder de decidir".
 *
 * Diárias (16/09/2026): não havia como dar /app/operacional/diarias a um
 * funcionário só para CONFERIR — ligar a chave ligava 'aprovar' junto, e
 * aprovar diária é liberar pagamento a pessoa física. Agora 'aprovar' tem
 * switch próprio (a linha em `app_menu_acao` veio na migration
 * 20260930000153) e só entra se alguém ligar explicitamente.
 *
 * Em `encarregados_diarias` o 'aprovar' sai por outro motivo: ele nunca
 * significou nada ali — `diaria_pode()` recusa 'aprovar' por aquele menu e
 * `diaria_guard()` só reconhece `operacional_diarias`. Gravar a linha mesmo
 * assim enchia `screen_permission_user` de permissão morta e fazia qualquer
 * auditoria de "quem pode aprovar diária?" responder errado.
 */
export const ACOES_FORA_DO_TOGGLE: Readonly<Record<string, readonly AppAcao[]>> = {
  operacional_diarias: ["aprovar", "enviar_malote"],
  // Parecer Jurídico (17/09/2026): responder dúvida é decisão do Jurídico,
  // não vem de brinde com a tela — mas desligar a tela revoga junto.
  duvidas: ["responder"],
  encarregados_diarias: ["aprovar", "enviar_malote"],
  financeiro_diarias: ["aprovar", "enviar_malote"],
};

/**
 * As ações que o toggle escreve em `screen_permission_user` para este menu.
 *
 * ASSIMETRIA DELIBERADA entre ligar e desligar:
 *
 *   ligar   → concede só o pacote, sem o que está em ACOES_FORA_DO_TOGGLE;
 *             aquelas ações têm switch próprio e ficam intocadas.
 *   desligar→ revoga TUDO, exceções incluídas.
 *
 * O segundo caso não é simetria quebrada por descuido: `has_screen_access()`
 * responde pela ação pedida e NÃO exige 'visualizar' junto. Sem revogar as
 * exceções ao desligar, tirar Diárias de alguém deixaria um `aprovar`
 * allow=true pendurado, e a pessoa continuaria aprovando pagamento numa tela
 * que ela nem enxerga mais.
 */
export function acoesGravadasPeloToggle(codigo: string, allow: boolean): AppAcao[] {
  const fora = ACOES_FORA_DO_TOGGLE[codigo] ?? [];
  if (allow) return ACOES_DO_TOGGLE_PADRAO.filter((a) => !fora.includes(a));
  return [...ACOES_DO_TOGGLE_PADRAO, ...fora.filter((a) => !ACOES_DO_TOGGLE_PADRAO.includes(a))];
}
