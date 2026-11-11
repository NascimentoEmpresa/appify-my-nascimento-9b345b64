import type { OrcamentoContratoGrupo } from "@/hooks/useOrcamentoContratos";
import type { UtilizadoOrcamentoLinha } from "@/hooks/useUtilizadoOrcamento";
import { ehContratoAdministrativo } from "@/pages/controladoria/faturamento/regras";

// SIS-2026-0858 (continuação do SIS-2026-0830): Orçamento ADM e Sócios POR INTEGRANTE, conforme o HTML do Iury ("Regras para desenvolvimento").
// Tudo aqui é puro (sem React nem banco) para ser testado: a tela lê os dados, chama estas funções e desenha.
//   1. Uma pessoa está em UMA aba por vez (Administrativo ou Sócios); mover para Sócios mantém classificação e contratos.
//   2. Cada pessoa tem UMA classificação de origem e um ou mais contratos (centros de custo de onde sai o orçamento).
//   3. Configuração em grupo: copia a classificação e os contratos só para as pessoas marcadas (substitui a configuração anterior delas).
//   4. Saldo da classificação: só consulta; é da classificação (não da pessoa) e se repete entre quem usa a mesma.

export type TipoOrcamento = "administrativo" | "socios";

export interface PessoaOrcamento {
  userId: string;
  nome: string;
  /** setores do Gerenciamento de Acesso (uma pessoa pode ter mais de um) */
  setores: string[];
}

export interface ConfigPessoa {
  /** a única classificação de origem (Classificação do Malote); null = ainda sem origem */
  classificacaoId: string | null;
  contratoIds: string[];
}

export const CONFIG_VAZIA: ConfigPessoa = { classificacaoId: null, contratoIds: [] };
export const SEM_SETOR = "Sem setor";

export interface ContratoOpcao { id: string; nome: string; empresaId: string }
export interface EmpresaOpcao { id: string; nome: string }

export const setorDaPessoa = (p: Pick<PessoaOrcamento, "setores">): string => (p.setores.length > 0 ? p.setores.join(" · ") : SEM_SETOR);

/** Equipes (setores) que existem entre as pessoas, em ordem alfabética; quem não tem setor entra em "Sem setor". */
export function equipesDasPessoas(pessoas: Pick<PessoaOrcamento, "setores">[]): string[] {
  const s = new Set<string>();
  for (const p of pessoas) { if (p.setores.length === 0) s.add(SEM_SETOR); for (const x of p.setores) s.add(x); }
  return [...s].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export const pessoaDaEquipe = (p: Pick<PessoaOrcamento, "setores">, equipe: string): boolean =>
  p.setores.length === 0 ? equipe === SEM_SETOR : p.setores.includes(equipe);

/** Regra 4: copia a classificação e os contratos para as pessoas marcadas; as demais ficam como estão. */
export function aplicarEmGrupo(
  configs: Map<string, ConfigPessoa>, marcadas: Set<string>, origemId: string | null, contratoIds: string[],
): Map<string, ConfigPessoa> {
  const novo = new Map(configs);
  for (const id of marcadas) novo.set(id, { classificacaoId: origemId, contratoIds: [...contratoIds] });
  return novo;
}

/** Marca/desmarca todos os contratos de uma empresa, sem mexer nos das outras. */
export function alternarEmpresa(ids: string[], contratosDaEmpresa: string[], marcar: boolean): string[] {
  const resto = ids.filter((id) => !contratosDaEmpresa.includes(id));
  return marcar ? [...resto, ...contratosDaEmpresa] : resto;
}

export function alternarContrato(ids: string[], contratoId: string, marcar: boolean): string[] {
  const resto = ids.filter((id) => id !== contratoId);
  return marcar ? [...resto, contratoId] : resto;
}

/** Texto do seletor: "EMPRESA — Todos os contratos" quando marcou todos da empresa; senão os contratos marcados. */
export function resumoContratos(empresas: EmpresaOpcao[], contratos: ContratoOpcao[], ids: string[]): string {
  const marcados = new Set(ids);
  const partes: string[] = [];
  for (const e of empresas) {
    const daEmpresa = contratos.filter((c) => c.empresaId === e.id);
    const selecionados = daEmpresa.filter((c) => marcados.has(c.id));
    if (selecionados.length === 0) continue;
    if (selecionados.length === daEmpresa.length) partes.push(`${e.nome} — Todos os contratos`);
    else for (const c of selecionados) partes.push(c.nome);
  }
  return partes.join(" · ");
}

/**
 * O que sobra da classificação no mês: por contrato (que não seja ADMINISTRATIVO …), o orçado dela menos o que o Malote já utilizou nele, sem deixar
 * o saldo de um contrato ficar negativo (um contrato estourado não "come" o saldo de outro). Somado entre todos os contratos: é o saldo da
 * CLASSIFICAÇÃO, o mesmo para quem a usa (regra 5 do HTML), e não um saldo exclusivo da pessoa.
 */
export function saldoDaClassificacao(grupos: OrcamentoContratoGrupo[], utilizado: UtilizadoOrcamentoLinha[], classificacaoId: string | null, anoMes: string): number | null {
  if (!classificacaoId) return null;
  const gasto = new Map<string, number>();
  for (const l of utilizado) {
    if (!l.contrato_id || l.classificacao_id !== classificacaoId) continue;
    if (!l.competencia || l.competencia.slice(0, 7) !== anoMes) continue;
    gasto.set(l.contrato_id, (gasto.get(l.contrato_id) ?? 0) + (Number(l.valor) || 0));
  }
  let total = 0;
  for (const g of grupos) {
    if (ehContratoAdministrativo(g.contrato.nome)) continue;
    const orcado = g.rubricas.reduce((s, r) => (r.classificacaoMaloteId === classificacaoId ? s + r.valor : s), 0);
    total += Math.max(0, orcado - (gasto.get(g.contrato.id) ?? 0));
  }
  return Math.round(total * 100) / 100;
}

/** Config "vazia" (sem origem nem contrato) não precisa de linha no banco, a não ser que a pessoa seja sócia. */
export const configVazia = (c: ConfigPessoa | undefined): boolean => !c || (!c.classificacaoId && c.contratoIds.length === 0);

// Ordem da lista: por padrão separada por SETOR (um bloco por setor, nome dentro dele); clicar no título de uma coluna ordena por ela.
export type ChaveOrdem = "setor" | "nome" | "origem" | "saldo";
export type DirecaoOrdem = "asc" | "desc";

/** Setor sob o qual a pessoa aparece no agrupamento (quem tem mais de um aparece uma vez, no primeiro). */
export const setorPrincipal = (p: Pick<PessoaOrcamento, "setores">): string => p.setores[0] ?? SEM_SETOR;

const cmpTexto = (a: string, b: string) => a.localeCompare(b, "pt-BR");

export function ordenarPessoas<T extends Pick<PessoaOrcamento, "nome" | "setores" | "userId">>(
  lista: T[], chave: ChaveOrdem, direcao: DirecaoOrdem, valores: { origem: (p: T) => string; saldo: (p: T) => number | null },
): T[] {
  const sinal = direcao === "asc" ? 1 : -1;
  const porNome = (a: T, b: T) => cmpTexto(a.nome, b.nome);
  return [...lista].sort((a, b) => {
    if (chave === "nome") return sinal * porNome(a, b);
    if (chave === "setor") {
      const sa = setorPrincipal(a), sb = setorPrincipal(b);
      // "Sem setor" fica por último, qualquer que seja a direção
      if ((sa === SEM_SETOR) !== (sb === SEM_SETOR)) return sa === SEM_SETOR ? 1 : -1;
      return sinal * cmpTexto(sa, sb) || porNome(a, b);
    }
    if (chave === "origem") {
      const oa = valores.origem(a), ob = valores.origem(b);
      if (!oa !== !ob) return oa ? -1 : 1; // sem origem por último
      return sinal * cmpTexto(oa, ob) || porNome(a, b);
    }
    const va = valores.saldo(a), vb = valores.saldo(b);
    if ((va == null) !== (vb == null)) return va == null ? 1 : -1; // sem saldo por último
    return sinal * ((va ?? 0) - (vb ?? 0)) || porNome(a, b);
  });
}

/** Blocos por setor, na ordem em que aparecem na lista já ordenada por setor. */
export function agruparPorSetor<T extends Pick<PessoaOrcamento, "setores">>(lista: T[]): { setor: string; pessoas: T[] }[] {
  const blocos: { setor: string; pessoas: T[] }[] = [];
  for (const p of lista) {
    const setor = setorPrincipal(p);
    const ultimo = blocos[blocos.length - 1];
    if (ultimo && ultimo.setor === setor) ultimo.pessoas.push(p);
    else blocos.push({ setor, pessoas: [p] });
  }
  return blocos;
}

/** Filtro de busca da lista (nome ou setor). */
export function filtrarPessoas<T extends Pick<PessoaOrcamento, "nome" | "setores">>(pessoas: T[], busca: string): T[] {
  const t = busca.trim().toLocaleLowerCase("pt-BR");
  return t ? pessoas.filter((p) => `${p.nome} ${p.setores.join(" ")}`.toLocaleLowerCase("pt-BR").includes(t)) : pessoas;
}
