import { tratamentoEfetivo, type TratamentoContrato } from "@/pages/controladoria/faturamento/tratamentoContrato";

// SIS-2026-0911: Imóveis Detalhamento. Regras puras (sem tela, sem banco) que separam, por imóvel, o que é capital aplicado do que é manutenção.
//   Aquisição            = valor do contrato do cadastro de Patrimônios (não é digitado de novo).
//   Investimentos / Obras = saídas do Fluxo de Caixa vinculadas ao imóvel em contrato de tratamento "Investimento" ou "Obra administrativa"
//                           (a mesma regra que forma as colunas Investimentos e Obras Adm do Fechamento da Empresa).
//   Manutenção           = qualquer outra saída vinculada ao imóvel (água, luz, condomínio, manutenção recorrente…): não aumenta o patrimônio.
//   Total aplicado       = aquisição + investimentos/obras + manutenção;  Resultado potencial = valor estimado de venda − total aplicado.
// Tudo em centavos inteiros para a soma fechar sem resto de ponto flutuante.

export interface LancamentoImovel {
  patrimonio_id: number;
  origem: string;
  despesa_id: string;
  numero_parcela: number | null;
  id_malote: string | null;
  data_pagamento: string | null;
  competencia: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  tratamento_excecao: string | null;
  classificacao_nome: string | null;
  descricao: string | null;
  valor: number;
}

export type TipoGastoImovel = "investimento_obra" | "manutencao";

export const ROTULO_TIPO_GASTO: Record<TipoGastoImovel, string> = {
  investimento_obra: "Investimentos / Obras",
  manutencao: "Manutenção",
};

/** Investimento/obra pelo tratamento do contrato do lançamento (exceção configurada ou, sem ela, pelo nome); o resto é manutenção. */
export function tipoDoGasto(l: Pick<LancamentoImovel, "contrato_nome" | "tratamento_excecao">): TipoGastoImovel {
  const t: TratamentoContrato = tratamentoEfetivo(l.contrato_nome, (l.tratamento_excecao as TratamentoContrato | null) ?? null);
  return t === "investimento" || t === "obra_administrativa" ? "investimento_obra" : "manutencao";
}

const cent = (n: number | null | undefined) => Math.round((Number(n) || 0) * 100);
const reais = (c: number) => c / 100;

export type StatusImovel = "saudavel" | "atencao" | "sem_estimativa";
export const ROTULO_STATUS_IMOVEL: Record<StatusImovel, string> = { saudavel: "Saudável", atencao: "Custo acima do estimado", sem_estimativa: "Sem valor estimado" };

export interface ResumoImovel {
  aquisicao: number;
  investimentosObras: number;
  manutencao: number;
  totalAplicado: number;
  valorEstimado: number | null;
  /** Valor estimado − total aplicado; nulo enquanto não há valor estimado cadastrado. */
  resultadoPotencial: number | null;
  status: StatusImovel;
  qtdLancamentos: number;
}

export function resumoDoImovel(
  cadastro: { valor_contrato?: number | null; valor_estimado?: number | null },
  lancamentos: Pick<LancamentoImovel, "valor" | "contrato_nome" | "tratamento_excecao">[],
): ResumoImovel {
  let invest = 0;
  let manut = 0;
  for (const l of lancamentos) {
    if (tipoDoGasto(l) === "investimento_obra") invest += cent(l.valor); else manut += cent(l.valor);
  }
  const aquisicao = cent(cadastro.valor_contrato);
  const total = aquisicao + invest + manut;
  const temEstimado = cadastro.valor_estimado != null && Number(cadastro.valor_estimado) > 0;
  const estimado = temEstimado ? cent(cadastro.valor_estimado) : null;
  const resultado = estimado == null ? null : estimado - total;
  return {
    aquisicao: reais(aquisicao),
    investimentosObras: reais(invest),
    manutencao: reais(manut),
    totalAplicado: reais(total),
    valorEstimado: estimado == null ? null : reais(estimado),
    resultadoPotencial: resultado == null ? null : reais(resultado),
    status: resultado == null ? "sem_estimativa" : resultado < 0 ? "atencao" : "saudavel",
    qtdLancamentos: lancamentos.length,
  };
}

/** Lançamentos agrupados por imóvel. */
export function lancamentosPorImovel(lancamentos: LancamentoImovel[]): Map<number, LancamentoImovel[]> {
  const mapa = new Map<number, LancamentoImovel[]>();
  for (const l of lancamentos) {
    const lista = mapa.get(Number(l.patrimonio_id)) ?? [];
    lista.push(l);
    mapa.set(Number(l.patrimonio_id), lista);
  }
  return mapa;
}

/** Soma dos resumos (cartões do topo). Resultado potencial só soma os imóveis que têm valor estimado. */
export function totaisDosImoveis(resumos: ResumoImovel[]) {
  const soma = (f: (r: ResumoImovel) => number) => reais(resumos.reduce((s, r) => s + cent(f(r)), 0));
  return {
    aquisicao: soma((r) => r.aquisicao),
    investimentosObras: soma((r) => r.investimentosObras),
    manutencao: soma((r) => r.manutencao),
    totalAplicado: soma((r) => r.totalAplicado),
    valorEstimado: soma((r) => r.valorEstimado ?? 0),
    resultadoPotencial: soma((r) => r.resultadoPotencial ?? 0),
  };
}

/** Chave estável do lançamento do Fluxo (a mesma do vínculo e do ajuste: origem + despesa + parcela, 0 = sem parcela). */
export const chaveVinculo = (l: { origem: string; despesa_id: string; numero_parcela: number | null }) => `${l.origem}|${l.despesa_id}|${l.numero_parcela ?? 0}`;
