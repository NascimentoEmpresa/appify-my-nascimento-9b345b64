import { ehContratoForaDasDespesas, ehContratoAdministrativo } from "./regras";

// Tratamento de cada contrato nos relatórios da Controladoria (configurável em controladoria_contrato_tratamento).
//   normal            = conta como contrato comum (custo entra em Despesas e no Lucro);
//   fora_das_despesas = o que se paga nele não é despesa de contrato (estoque, movimentação financeira…);
//   investimento      = idem, e o valor aparece na coluna Investimentos do Fechamento da Empresa.
// Só as EXCEÇÕES ficam gravadas: contrato sem linha usa a regra pelo nome (tratamentoPadraoPorNome), que é a que já valia antes da configuração.
export type TratamentoContrato = "normal" | "fora_das_despesas" | "investimento";

export const TRATAMENTOS: { valor: TratamentoContrato; rotulo: string; ajuda: string }[] = [
  { valor: "normal", rotulo: "Contrato comum", ajuda: "O custo entra em Despesas e diminui o lucro." },
  { valor: "fora_das_despesas", rotulo: "Fora das despesas", ajuda: "Não entra em Despesas nem no Lucro (ex.: estoque, movimentação financeira)." },
  { valor: "investimento", rotulo: "Investimento", ajuda: "Fora das despesas e do lucro; o valor aparece na coluna Investimentos do Fechamento." },
];

export const ROTULO_TRATAMENTO: Record<TratamentoContrato, string> = Object.fromEntries(TRATAMENTOS.map((t) => [t.valor, t.rotulo])) as Record<TratamentoContrato, string>;

export type TratamentosContrato = Map<string, TratamentoContrato>;

const semAcento = (nome: string | null | undefined) => (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

// A regra de antes da configuração, só pelo início do nome.
export function tratamentoPadraoPorNome(nome: string | null | undefined): TratamentoContrato {
  if (semAcento(nome).startsWith("INVESTIMENTO")) return "investimento";
  return ehContratoForaDasDespesas(nome) ? "fora_das_despesas" : "normal";
}

// O que vale para o contrato: a exceção gravada, ou o padrão pelo nome.
export function tratamentoEfetivo(nome: string | null | undefined, excecao?: TratamentoContrato | null): TratamentoContrato {
  return excecao ?? tratamentoPadraoPorNome(nome);
}

// Fora da coluna Despesas? Investimento também, exceto no Fechamento, que precisa das linhas dele para a coluna Investimentos.
export function saiDasDespesas(tratamento: TratamentoContrato, opcoes?: { manterInvestimentos?: boolean }): boolean {
  return tratamento === "fora_das_despesas" || (tratamento === "investimento" && !opcoes?.manterInvestimentos);
}

// Contratos administrativos e de sócio têm regra própria (centros de custo da empresa) e não entram nesta configuração.
export function contratoConfiguravel(nome: string | null | undefined): boolean {
  return !ehContratoAdministrativo(nome);
}
