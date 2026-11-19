// SIS-2026-0813: centro de custo (contrato) dos lançamentos da Aplicação Financeira. O correto, para aplicação e resgate, é o contrato
// "MOVIMENTAÇÃO FINANCEIRA" da empresa: a tela já o sugere, e dá para trocar.

export interface ContratoParaCentro {
  id: string;
  nome: string;
  empresa_id: string;
  status?: string | null;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

export const ehMovimentacaoFinanceira = (nome: string): boolean => semAcento(nome).startsWith("MOVIMENTACAO FINANCEIRA");

// SIS-2026-0829: saída de CONTA VINCULADA só pode ter o centro de custo MOVIMENTAÇÃO FINANCEIRA. Não existe cadastro que marque o banco como "conta vinculada":
// ele é reconhecido pelo NOME ("Banco do Brasil Conta Vinculada Embrapa…"), a mesma regra que os cards por natureza do Fluxo de Caixa já usam (ehContaVinculadaPorTexto).
// "CONTA VINCUL" (e não "VINCULADA") para pegar também o nome gravado com a grafia errada "Vinculda".
export const ehBancoContaVinculada = (nomeDoBanco: string | null | undefined): boolean => semAcento(nomeDoBanco ?? "").includes("CONTA VINCUL");

/** Os contratos MOVIMENTAÇÃO FINANCEIRA da empresa (ativo primeiro): as ÚNICAS opções de centro de custo numa saída de conta vinculada. */
export function opcoesSomenteMovimentacao(contratos: ContratoParaCentro[], empresaId: string): ContratoParaCentro[] {
  return contratos
    .filter((c) => c.empresa_id === empresaId && ehMovimentacaoFinanceira(c.nome))
    .sort((a, b) => Number(b.status === "ativo") - Number(a.status === "ativo") || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Saída de conta vinculada com centro de custo que não é MOVIMENTAÇÃO FINANCEIRA? Devolve a mensagem de erro; nulo = pode. */
export function erroCentroContaVinculada(nomeDoBanco: string | null | undefined, nomeDoContrato: string | null | undefined): string | null {
  if (!ehBancoContaVinculada(nomeDoBanco)) return null;
  return ehMovimentacaoFinanceira(nomeDoContrato ?? "") ? null : "Saída de conta vinculada: o Centro de Custo deve ser MOVIMENTAÇÃO FINANCEIRA.";
}

/** O centro de custo sugerido para a empresa: o contrato MOVIMENTAÇÃO FINANCEIRA dela (o ativo primeiro). Sem ele, vazio. */
export function centroPadraoDaEmpresa(contratos: ContratoParaCentro[], empresaId: string): string {
  const candidatos = contratos
    .filter((c) => c.empresa_id === empresaId && ehMovimentacaoFinanceira(c.nome))
    .sort((a, b) => Number(b.status === "ativo") - Number(a.status === "ativo") || a.nome.localeCompare(b.nome, "pt-BR"));
  return candidatos[0]?.id ?? "";
}

/** Opções do seletor: os contratos da empresa (MOVIMENTAÇÃO FINANCEIRA primeiro) e, se for o caso, o contrato já gravado no lançamento. */
export function opcoesDeCentroCusto(contratos: ContratoParaCentro[], empresaId: string, atualId?: string | null): ContratoParaCentro[] {
  const lista = contratos.filter((c) => c.empresa_id === empresaId || c.id === atualId);
  return lista.sort(
    (a, b) => Number(ehMovimentacaoFinanceira(b.nome)) - Number(ehMovimentacaoFinanceira(a.nome)) || a.nome.localeCompare(b.nome, "pt-BR"),
  );
}
