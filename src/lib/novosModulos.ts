/**
 * Novos Módulos (SIS-2026-0931, 17/11/2026) — tela nova nasce BLOQUEADA.
 *
 * Pedido do Iury: "nenhum módulo ou submódulo novo poderá ser acessado até que
 * sua permissão seja liberada manualmente por um administrador, inclusive por
 * acesso direto via URL" — independentemente das permissões que já existam.
 *
 * Quem segura é o banco (mig 20261118093100): app_menu.liberado_em NULL =
 * tela PENDENTE, e has_screen_access/list_accessible_menus respondem "não"
 * antes de olhar qualquer grant. O que o desenvolvedor semeou na migration da
 * tela (pessoas e perfis) continua gravado e vira "acesso preparado": aparece
 * pré-marcado no modal e só vale depois que alguém salva ali.
 *
 * As regras abaixo são as mesmas de "Por Setor / Cargo" (SIS-2026-0851):
 * setor e cargo só ESCOLHEM pessoas, e o que vai para o banco é uma linha por
 * pessoa em screen_permission_user, com o pacote do toggle
 * (acoesGravadasPeloToggle). Quem entra no setor depois não ganha sozinho.
 */
import { acoesGravadasPeloToggle } from "@/lib/acoesDoToggleAcesso";
import type { LinhaPermissao, PessoaAcesso } from "@/lib/acessoPorSetorCargo";

export type SituacaoTela = "pendente" | "liberado" | "liberado_antes";
export type TipoTela = "modulo" | "submodulo" | "acao";
export type FiltroSituacao = "pendentes" | "liberados" | "todas";

/** Uma linha de novos_modulos_listar(). */
export interface NovoModulo {
  codigo: string;
  nome: string;
  rota: string | null;
  modulo_codigo: string | null;
  modulo_nome: string | null;
  modulo_novo: boolean;
  tipo: TipoTela;
  ativo: boolean;
  criado_em: string;
  situacao: SituacaoTela;
  liberado_em: string | null;
  liberado_por_nome: string | null;
  pessoas_individuais: number;
  perfis: number;
  /** Quem vê (liberada) ou passará a ver (pendente) a tela. */
  pessoas_com_acesso: number;
}

/** O que novo_modulo_acessos() devolve: o que está gravado, valendo ou não. */
export interface AcessosGravados {
  pendente: boolean;
  individuais: { user_id: string; allow: boolean }[];
  perfis: { id: string; nome: string; pessoas: string[] }[];
}

export const ROTULO_SITUACAO: Readonly<Record<SituacaoTela, string>> = {
  pendente: "Pendente",
  liberado: "Liberado",
  liberado_antes: "Liberado antes do controle",
};

export const ROTULO_TIPO: Readonly<Record<TipoTela, string>> = {
  modulo: "Módulo novo",
  submodulo: "Submódulo",
  acao: "Ação / permissão especial",
};

/**
 * A linha de app_menu está pendente? `undefined` (coluna ainda não criada —
 * front publicado antes da migration) NÃO é pendente: o banco continua sendo
 * a barreira, e o painel não pode travar telas por engano.
 */
export const menuPendente = (m: { liberado_em?: string | null }): boolean => m.liberado_em === null;

const DIACRITICOS = new RegExp("[\\u0300-\\u036f]", "g");
const normalizar = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(DIACRITICOS, "").toLowerCase();

export function filtrarNovosModulos(lista: readonly NovoModulo[], busca: string, filtro: FiltroSituacao): NovoModulo[] {
  const q = normalizar(busca.trim());
  return lista.filter((m) => {
    if (filtro === "pendentes" && m.situacao !== "pendente") return false;
    if (filtro === "liberados" && m.situacao === "pendente") return false;
    if (!q) return true;
    return [m.nome, m.modulo_nome, m.codigo, m.rota].some((campo) => normalizar(campo).includes(q));
  });
}

export function contarNovosModulos(lista: readonly NovoModulo[]): { total: number; pendentes: number; liberados: number } {
  const pendentes = lista.filter((m) => m.situacao === "pendente").length;
  return { total: lista.length, pendentes, liberados: lista.length - pendentes };
}

/**
 * Quem os setores e cargos marcados trazem, com o motivo de cada um
 * ("setor SST", "cargo ANALISTA"). Só login ativo. É ATALHO de seleção: no
 * banco a pessoa entra individualmente, como na SIS-2026-0851.
 */
export function pessoasDaSelecao(
  pessoas: readonly PessoaAcesso[],
  setores: ReadonlySet<string>,
  cargos: ReadonlySet<string>,
): Map<string, string[]> {
  const motivos = new Map<string, string[]>();
  for (const p of pessoas) {
    if (!p.ativo) continue;
    const deste: string[] = [];
    for (const s of p.setores) if (setores.has(s)) deste.push(`setor ${s}`);
    if (p.cargo && cargos.has(p.cargo)) deste.push(`cargo ${p.cargo}`);
    if (deste.length) motivos.set(p.id, deste);
  }
  return motivos;
}

/** As pessoas que ficam com liberação individual: marcadas à mão + trazidas por setor/cargo. */
export function concedidosFinais(marcados: ReadonlySet<string>, viaGrupo: ReadonlyMap<string, string[]>): Set<string> {
  return new Set([...marcados, ...viaGrupo.keys()]);
}

/** Quem tem liberação individual gravada hoje (allow=true em visualizar). */
export const individuaisLiberados = (a: Pick<AcessosGravados, "individuais">): Set<string> =>
  new Set(a.individuais.filter((i) => i.allow).map((i) => i.user_id));

/**
 * Quem verá a tela depois de salvar — a mesma conta de
 * novo_modulo_contar_acesso() no banco:
 *   liberados individualmente
 * + membros dos perfis mantidos, menos quem fica com allow=false próprio
 *   (o negado de antes que não foi marcado, e quem o admin desmarcou).
 * O número oficial é o que a RPC devolve; este é a prévia do rodapé.
 */
export function acessoEfetivoAposSalvar(e: {
  gravado: AcessosGravados;
  concedidos: ReadonlySet<string>;
  perfisMantidos: ReadonlySet<string>;
}): Set<string> {
  const negados = new Set<string>();
  for (const i of e.gravado.individuais) {
    if (!e.concedidos.has(i.user_id)) negados.add(i.user_id);
  }
  // quem estava liberado e foi desmarcado também vira allow=false (planejarLinhas)
  const efetivo = new Set(e.concedidos);
  for (const perfil of e.gravado.perfis) {
    if (!e.perfisMantidos.has(perfil.id)) continue;
    for (const id of perfil.pessoas) if (!negados.has(id)) efetivo.add(id);
  }
  return efetivo;
}

/**
 * As linhas que novo_modulo_salvar grava. Mesmo desenho do switch de "Acesso
 * por Usuário" e de planejarAplicacao (SIS-2026-0851):
 *   - entrou (não tinha liberação individual): pacote do toggle, allow=true;
 *   - saiu (tinha e foi desmarcado): pacote inteiro, allow=false — remover do
 *     perfil sozinho não tira quem tem linha própria;
 *   - quem já tinha e continua: não é tocado (ações finas ficam como estão).
 * Nunca escreve outra tela: liberar um submódulo não libera outro (a RPC
 * também recusa).
 */
export function planejarLinhasNovoModulo(
  codigo: string,
  gravado: Pick<AcessosGravados, "individuais">,
  concedidos: ReadonlySet<string>,
): { linhas: LinhaPermissao[]; adicionados: string[]; removidos: string[] } {
  const antes = individuaisLiberados(gravado);
  const adicionados = [...concedidos].filter((id) => !antes.has(id)).sort();
  const removidos = [...antes].filter((id) => !concedidos.has(id)).sort();
  const linhas: LinhaPermissao[] = [];
  for (const user_id of adicionados) {
    for (const acao of acoesGravadasPeloToggle(codigo, true)) linhas.push({ user_id, menu_codigo: codigo, acao, allow: true });
  }
  for (const user_id of removidos) {
    for (const acao of acoesGravadasPeloToggle(codigo, false)) linhas.push({ user_id, menu_codigo: codigo, acao, allow: false });
  }
  return { linhas, adicionados, removidos };
}

/** Texto do rodapé do modal. */
export function resumoLiberacao(pessoas: number, pendente: boolean): string {
  if (pessoas === 0) return "0 pessoas — a tela fica bloqueada para todos.";
  const quem = pessoas === 1 ? "1 pessoa terá acesso" : `${pessoas} pessoas terão acesso`;
  return pendente ? `${quem} ao salvar — a tela será liberada.` : `${quem}.`;
}
