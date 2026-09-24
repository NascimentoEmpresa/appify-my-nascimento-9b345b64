import type { RateioLinha } from "@/hooks/useMaloteDespesa";

/**
 * Rateio que já nasce preenchido, para despesa que chega ao Malote vinda de
 * outra tela que SABE contrato, fornecedor e integrante.
 *
 * Nasceu da Diária UFRGS (24/09/2026): a diária já tem o contrato e o
 * motorista, e mesmo assim quem enviava para o Malote escolhia à mão, em
 * toda despesa, o Contrato, o Fornecedor "0 - Dispensa 1" e o Integrante
 * (que é sempre o próprio motorista — conferido na DM-2026-1285, a
 * despesa da DU-2026-000004). Redigitar o que a tela já sabe é onde nasce o
 * erro, e é o pedido literal: "o máximo de informação já puxe automático".
 *
 * Função pura, fora do componente, para o teste não depender de React nem
 * das consultas do Supabase.
 */

/**
 * O fornecedor "de dispensa" que a diária usa: não há empresa fornecedora
 * numa diária paga ao próprio motorista, e o cadastro tem registros-coringa
 * para isso ("0 - Dispensa 1", CNPJ 00.000.000/0000-00).
 *
 * Casa pelo NOME normalizado, não pelo id: o id só existe no banco de
 * produção, e o nome é o que as pessoas reconhecem no combobox. O pedido
 * escreveu "0 - Dispesa 1" — a normalização ignora acento e caixa, não a
 * grafia, então o nome aqui é o do cadastro.
 */
export const NOME_FORNECEDOR_DISPENSA = "0 - Dispensa 1";

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function acharFornecedorPorNome<F extends { id: string; nome: string }>(
  fornecedores: F[],
  nome: string,
): F | null {
  const alvo = normalizar(nome);
  return fornecedores.find((f) => normalizar(f.nome ?? "") === alvo) ?? null;
}

/** O que a tela de origem sabe sobre cada linha do rateio. */
export interface PadraoLinhaRateio {
  empresa_id?: string | null;
  contrato_id?: string | null;
  fornecedor_id?: string | null;
  integrante_empregado_id?: number | null;
}

/**
 * Uma linha nova já com o padrão. `valor`/`percentual` ficam a cargo de quem
 * chama: a primeira linha leva 100%, uma linha acrescentada depois começa
 * zerada como sempre começou.
 */
export function linhaComPadrao(
  padrao: PadraoLinhaRateio | null | undefined,
  base: Pick<RateioLinha, "valor" | "percentual" | "ordem"> & { classificacao_id?: string },
): RateioLinha {
  return {
    classificacao_id: base.classificacao_id,
    empresa_id: padrao?.empresa_id ?? null,
    contrato_id: padrao?.contrato_id ?? null,
    fornecedor_id: padrao?.fornecedor_id ?? null,
    integrante_empregado_id: padrao?.integrante_empregado_id ?? null,
    percentual: base.percentual,
    valor: base.valor,
    ordem: base.ordem,
  };
}

/** A linha única que cobre a despesa inteira — o caso de toda diária. */
export function rateioInicialComPadrao(padrao: PadraoLinhaRateio, valorTotal: number): RateioLinha[] {
  return [linhaComPadrao(padrao, { valor: Number(valorTotal.toFixed(2)), percentual: 100, ordem: 0 })];
}
