// =====================================================================
// "QUAIS PESSOAS DEVEM TER ACESSO AO MÓDULO?" (SIS-2026-0934, 17/11/2026)
//
// Pedido: na abertura do chamado, quem pede um módulo novo ou acesso a um
// módulo que já existe informa QUEM vai usar — antes o dev entregava a tela e
// só depois descobria, pela conversa, a quem liberar. Desde o SIS-2026-0931
// toda tela nova nasce bloqueada até alguém liberar à mão, então essa lista é
// o que o dev (e quem libera em Novos Módulos) precisa ter na frente.
//
// Quando é OBRIGATÓRIO: o formulário não tinha nada que dissesse "módulo
// novo" — a Posição ("novo módulo ou módulo diretamente ajustado") serve aos
// dois casos. Então os dois casos viraram CATEGORIAS (a lista de várias
// escolhas da Classificação):
//   · "novo_modulo"      — Novo módulo / tela (categoria nova deste chamado);
//   · "acesso_permissao" — Acesso / Permissão (já existia).
// Com qualquer uma delas marcada, pelo menos uma pessoa. Nas outras, opcional.
// O banco confere o mesmo no gatilho da mig 20261118100000
// (chamado_acesso_modulo_validar) — mudar a lista aqui exige mudar lá.
//
// Gravado em CHAMADO_SISTEMA.acesso_modulo_usuarios (jsonb): [{id, nome}],
// id = profiles.id. O nome vai junto para a tela do chamado não depender de
// ler profiles de terceiros; o gatilho reescreve o nome a partir de profiles
// (e descarta id que não é login), então o que fica gravado é o de verdade.
// =====================================================================

/** Categorias em que a lista de pessoas é obrigatória. */
export const CATEGORIAS_EXIGEM_ACESSO = ["novo_modulo", "acesso_permissao"] as const;

export interface PessoaAcesso { id: string; nome: string }

/** O chamado pede módulo novo ou acesso a módulo? */
export function exigeAcessoModulo(categorias: readonly string[] | null | undefined): boolean {
  return (categorias ?? []).some((c) => (CATEGORIAS_EXIGEM_ACESSO as readonly string[]).includes(c));
}

/** Sem id vazio e sem repetidos, mantendo a ordem de escolha; nome sem espaços nas pontas. */
export function normalizarPessoasAcesso(xs: readonly (Partial<PessoaAcesso> | null | undefined)[] | null | undefined): PessoaAcesso[] {
  const vistos = new Set<string>();
  const saida: PessoaAcesso[] = [];
  for (const x of xs ?? []) {
    const id = (x?.id ?? "").trim();
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    saida.push({ id, nome: (x?.nome ?? "").trim() });
  }
  return saida;
}

/** Ids escolhidos no seletor → [{id, nome}] com o nome da lista de usuários. */
export function pessoasDosIds(ids: readonly string[], usuarios: readonly { id: string; display_name: string | null }[]): PessoaAcesso[] {
  const nomes = new Map(usuarios.map((u) => [u.id, u.display_name ?? ""]));
  return normalizarPessoasAcesso(ids.map((id) => ({ id, nome: nomes.get(id) ?? "" })));
}

/** O campo está pendente (obrigatório e vazio)? */
export function acessoModuloPendente(categorias: readonly string[] | null | undefined, pessoas: readonly Partial<PessoaAcesso>[] | null | undefined): boolean {
  return exigeAcessoModulo(categorias) && normalizarPessoasAcesso(pessoas).length === 0;
}
