import type { OrcamentoContratoGrupo } from "@/hooks/useOrcamentoContratos";
import type { UtilizadoOrcamentoLinha } from "@/hooks/useUtilizadoOrcamento";
import { ehContratoAdministrativo } from "@/pages/controladoria/faturamento/regras";
import { socioDoContrato } from "@/pages/controladoria/fechamento/regras";

// SIS-2026-0702: regras do novo Orçamento Administrativo / Orçamento Sócios ("Regras do Módulo de Orçamentos"). Tudo aqui é puro (sem
// React nem banco) para ser testado: a tela só lê os dados, chama estas funções e desenha.

export type TipoOrcamento = "administrativo" | "socios";
export type ModoOrcamento = "percentual" | "manual";

export interface LinhaOrcamento {
  classificacaoMaloteId: string;
  descricao: string;
  modo: ModoOrcamento;
  percentual: number;
  /** Classificações do Malote (as do Orçamento Geral - Contratos) usadas como origem. */
  origemIds: string[];
  valorManual: number;
  /** empresa_id → % (só no modo manual; a soma tem que fechar 100). */
  distribuicao: Record<string, number>;
}

const TOLERANCIA = 0.001;
const centavos = (v: number) => Math.round((Number(v) || 0) * 100);

/**
 * Regra 6: o que sobra da origem em cada empresa. Por contrato da empresa: orçado da(s) classificação(ões) de origem no mês MENOS o que o
 * Malote já utilizou nesse contrato, sem deixar o saldo de um contrato ficar negativo (um contrato estourado não "come" o saldo de outro).
 * Os contratos ADMINISTRATIVO … não são origem: o dinheiro deles é justamente o que este orçamento distribui.
 */
export function saldoDaOrigemPorEmpresa(
  grupos: OrcamentoContratoGrupo[],
  utilizado: UtilizadoOrcamentoLinha[],
  origemIds: string[],
  anoMes: string,
): Map<string, number> {
  const origens = new Set(origemIds);
  const gasto = new Map<string, number>();
  for (const l of utilizado) {
    if (!l.contrato_id || !l.classificacao_id || !origens.has(l.classificacao_id)) continue;
    if (!l.competencia || l.competencia.slice(0, 7) !== anoMes) continue;
    gasto.set(l.contrato_id, (gasto.get(l.contrato_id) ?? 0) + (Number(l.valor) || 0));
  }
  const saldo = new Map<string, number>();
  for (const g of grupos) {
    if (ehContratoAdministrativo(g.contrato.nome)) continue;
    const orcado = g.rubricas.reduce((s, r) => (r.classificacaoMaloteId && origens.has(r.classificacaoMaloteId) ? s + r.valor : s), 0);
    const restante = Math.max(0, orcado - (gasto.get(g.contrato.id) ?? 0));
    if (restante === 0) continue;
    saldo.set(g.contrato.empresa_id, (saldo.get(g.contrato.empresa_id) ?? 0) + restante);
  }
  return saldo;
}

/** Valor orçado da classificação em cada empresa (regras 5 e 7). */
export function orcadoPorEmpresa(linha: LinhaOrcamento, saldoOrigem: Map<string, number>, empresaIds: string[]): Map<string, number> {
  const r = new Map<string, number>();
  if (linha.modo === "manual") {
    // reparte em centavos; a última empresa com percentual fica com a sobra de arredondamento para a soma fechar no valor digitado
    const total = centavos(linha.valorManual);
    const partes = empresaIds.map((id) => Math.round((total * (linha.distribuicao[id] ?? 0)) / 100));
    const fecha = Math.abs(empresaIds.reduce((s, id) => s + (linha.distribuicao[id] ?? 0), 0) - 100) < TOLERANCIA;
    if (fecha) {
      let ultimo = -1;
      empresaIds.forEach((id, i) => { if ((linha.distribuicao[id] ?? 0) > 0) ultimo = i; });
      if (ultimo >= 0) partes[ultimo] += total - partes.reduce((s, v) => s + v, 0);
    }
    empresaIds.forEach((id, i) => r.set(id, partes[i] / 100));
    return r;
  }
  for (const id of empresaIds) r.set(id, Math.round((saldoOrigem.get(id) ?? 0) * linha.percentual) / 100);
  return r;
}

/** Regra 4: o centro de custo da aba. ADM = "ADMINISTRATIVO - EMPRESA"; Sócios = "ADMINISTRATIVO SÓCIOS - NOME". */
export function contratoDaAba(nomeContrato: string | null | undefined, tipo: TipoOrcamento): boolean {
  if (!ehContratoAdministrativo(nomeContrato)) return false;
  const socio = socioDoContrato(nomeContrato) !== null;
  return tipo === "socios" ? socio : !socio;
}

/**
 * Valor utilizado da classificação por empresa no mês: lançamentos do Malote da classificação do Malote ligada à Administrativo, nos
 * contratos da aba (regra 4). A empresa é a do lançamento. Sem ligação não há como achar o gasto: devolve vazio.
 */
export function utilizadoPorEmpresa(
  utilizado: UtilizadoOrcamentoLinha[],
  classificacaoMaloteId: string | null | undefined,
  tipo: TipoOrcamento,
  anoMes: string,
): Map<string, { valor: number; ultima: string | null }> {
  const r = new Map<string, { valor: number; ultima: string | null }>();
  if (!classificacaoMaloteId) return r;
  for (const l of utilizado) {
    if (l.classificacao_id !== classificacaoMaloteId || !l.empresa_id) continue;
    if (!l.competencia || l.competencia.slice(0, 7) !== anoMes) continue;
    if (!contratoDaAba(l.contrato_nome, tipo)) continue;
    const atual = r.get(l.empresa_id) ?? { valor: 0, ultima: null };
    atual.valor += Number(l.valor) || 0;
    const dia = l.data_pagamento ?? l.competencia;
    if (dia && (!atual.ultima || dia > atual.ultima)) atual.ultima = dia;
    r.set(l.empresa_id, atual);
  }
  return r;
}

export interface ProblemaDistribuicao { linha?: string; mensagem: string }

/**
 * Regra 7: a soma dos percentuais das classificações com origem percentual tem que fechar EXATAMENTE 100%, e no modo manual a distribuição
 * por empresa também. Devolve o que impede de salvar (vazio = pode salvar).
 */
export function validarDistribuicao(linhas: LinhaOrcamento[], nomes: Map<string, string>): ProblemaDistribuicao[] {
  const problemas: ProblemaDistribuicao[] = [];
  const percentuais = linhas.filter((l) => l.modo === "percentual");
  if (percentuais.length > 0) {
    const soma = percentuais.reduce((s, l) => s + l.percentual, 0);
    if (Math.abs(soma - 100) > TOLERANCIA) problemas.push({ mensagem: `A soma dos percentuais é ${soma.toFixed(2).replace(".", ",")}% e precisa ser exatamente 100%.` });
  }
  // classificação ainda sem % (recém-incluída, a preencher) não trava o salvamento; com % precisa de origem
  for (const l of percentuais) {
    if (l.percentual > 0 && l.origemIds.length === 0) problemas.push({ linha: l.classificacaoMaloteId, mensagem: `${nomes.get(l.classificacaoMaloteId) ?? "Classificação"}: selecione ao menos uma classificação de origem.` });
  }
  for (const l of linhas.filter((x) => x.modo === "manual")) {
    const soma = Object.values(l.distribuicao).reduce((s, v) => s + (Number(v) || 0), 0);
    if (Math.abs(soma - 100) > TOLERANCIA) problemas.push({ linha: l.classificacaoMaloteId, mensagem: `${nomes.get(l.classificacaoMaloteId) ?? "Classificação"}: a distribuição por empresa soma ${soma.toFixed(2).replace(".", ",")}% e precisa ser 100%.` });
  }
  return problemas;
}

export function percentualUtilizado(utilizado: number, orcado: number): number {
  return orcado > 0 ? (utilizado / orcado) * 100 : 0;
}
