// SIS-2026-0777: contas do mesmo banco (ex.: Sicredi HAGG 119 e HAGG 155). O banco continua sendo o cadastro único (malote_cartao_banco); a CONTA é
// a empresa + o número dentro dele. Cada lançamento do Fluxo pode ser ligado a uma conta (financeiro_fluxo_caixa_conta); sem ligação, vale
// só banco + empresa, como sempre foi. Aqui ficam as regras puras: a chave do lançamento, o carimbo da conta nas linhas do Fluxo, a comparação
// com o ACCTID do extrato OFX e a conferência da conta numa conciliação.

export interface ContaBanco {
  id: string;
  banco_id: string;
  empresa_id: string;
  numero: string;
  apelido: string | null;
  ativo: boolean;
}

export type OrigemFluxo = "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira" | "importacao_historica";

export interface LinhaComChaveDeConta {
  origem: OrigemFluxo;
  despesa_id: string;
  numero_parcela: number | null;
}

/** Mesma chave do ajuste do Fluxo (origem + despesa + parcela); parcela 0 = lançamento sem parcela, como na tabela. */
export const chaveContaDoLancamento = (l: LinhaComChaveDeConta) => `${l.origem}|${l.despesa_id}|${l.numero_parcela ?? 0}`;

export const rotuloConta = (c: Pick<ContaBanco, "numero" | "apelido">) => (c.apelido?.trim() ? `${c.numero} — ${c.apelido.trim()}` : c.numero);

/** Carimba `conta_banco_id` nas linhas que têm conta atribuída. Sem nenhuma atribuição devolve o mesmo array (o Fluxo tem dezenas de milhares de linhas). */
export function comContaBanco<T extends LinhaComChaveDeConta>(linhas: T[], atribuicoes: Map<string, string>): (T & { conta_banco_id?: string | null })[] {
  if (atribuicoes.size === 0) return linhas;
  return linhas.map((l) => {
    const conta = atribuicoes.get(chaveContaDoLancamento(l));
    return conta ? { ...l, conta_banco_id: conta } : l;
  });
}

/** Contas ativas do banco e das empresas escolhidas ("Todas" não filtra por empresa). */
export function contasDaConciliacao(contas: ContaBanco[], bancoId: string, todasEmpresas: boolean, empresaIds: string[]): ContaBanco[] {
  if (!bancoId) return [];
  return contas.filter((c) => c.ativo && c.banco_id === bancoId && (todasEmpresas || empresaIds.includes(c.empresa_id)));
}

const soDigitos = (t: string) => t.replace(/\D/g, "").replace(/^0+/, "");

/**
 * O número da conta cadastrada aparece no ACCTID do extrato? Cada banco escreve o ACCTID de um jeito (com agência, dígito, zeros à esquerda),
 * então compara só os dígitos e aceita que o número esteja contido no ACCTID. null = não dá para saber (extrato sem ACCTID ou conta sem número).
 */
export function extratoPareceDaConta(acctIds: string[], numeroConta: string): boolean | null {
  const alvo = soDigitos(numeroConta);
  const ids = acctIds.map(soDigitos).filter(Boolean);
  if (!alvo || ids.length === 0) return null;
  return ids.some((id) => id.includes(alvo));
}

/** Escopo da conciliação por conta: só os lançamentos ligados à conta escolhida. `contaBancoId` vazio = sem filtro (banco + empresa, como antes). */
export function filtrarPorConta<T extends { conta_banco_id?: string | null }>(linhas: T[], contaBancoId: string): T[] {
  return contaBancoId ? linhas.filter((l) => l.conta_banco_id === contaBancoId) : linhas;
}

/** Quantos lançamentos do banco/empresa ainda não têm conta (eles ficam de fora da conciliação de uma conta específica). */
export function contarSemConta<T extends { conta_banco_id?: string | null }>(linhas: T[]): number {
  return linhas.filter((l) => !l.conta_banco_id).length;
}
