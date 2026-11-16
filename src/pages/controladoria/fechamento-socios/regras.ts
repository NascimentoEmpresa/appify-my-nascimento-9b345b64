import { INTEGRANTE_EMPRESA_ID } from "@/lib/integranteEmpresa";

// SIS-2026-0872 — Fechamento dos Sócios (Controladoria; pedido do Ruan). Regras puras (sem React nem banco) para serem testadas.
//
// De onde vem cada número (as colunas são as mesmas da aba "Resumo Mensal com Sócios" do Fechamento da Empresa):
//   Resultado antes das retiradas = Resultado após Outras Receitas − Tributos sobre o Resultado. É o lucro ANTES das colunas dos sócios, de
//     Investimentos e de Obras Adm: no Resultado Gerencial Líquido do Fechamento da Empresa elas já saíram, e aqui elas são as retiradas de cada sócio
//     (descontar de novo seria descontar duas vezes).
//   Integrante "Empresa" (id −1) dentro de Investimentos e Obras Adm: é gasto da própria empresa, consome o lucro ANTES da divisão entre os sócios.
//   Lucro a Distribuir = Resultado antes das retiradas − o que a Empresa consumiu em Investimentos/Obras Adm.
//   Cada sócio recebe o seu percentual do Lucro a Distribuir e, do que recebe, saem as RETIRADAS ANTECIPADAS dele:
//     a coluna dele (despesas do contrato ADMINISTRATIVO <sócio>) + o que Investimentos e Obras Adm têm com ELE como integrante (não por centro de custo).
//   Saldo a Retirar (complemento) = parte do lucro − retiradas antecipadas.
//   Linha de Investimentos/Obras Adm sem integrante (ou com um colaborador que não é sócio) não pertence a nenhum sócio: fica com a Empresa (é o que o
//   Fechamento da Empresa já faz hoje, tirando do resultado), mas aparece à parte como "sem integrante" para ser corrigida.
//   Mês negativo: o prejuízo é abatido — o Lucro a Distribuir do mês pode ficar negativo e os totais do ano somam tudo (um mês compensa o outro).

const r2 = (n: number) => Math.round(n * 100) / 100;

export type TipoRetirada = "investimentos" | "obras";
export const ROTULO_TIPO_RETIRADA: Record<TipoRetirada, string> = { investimentos: "Investimentos", obras: "Obras Adm" };

export interface SocioConfig {
  id: string;
  /** o rótulo da coluna do sócio no Fechamento da Empresa (ex.: "Carlos Eduardo") */
  nome: string;
  /** colaboradores (EMPREGADOS.ID) que valem como este sócio no integrante do rateio/Fluxo */
  empregadoIds: number[];
  percentualPadrao: number;
  ativo: boolean;
}

/** Uma linha de Investimentos ou Obras Adm do Fluxo, com o integrante do lançamento (null = sem integrante). */
export interface LinhaIntegrante {
  mes: string; // YYYY-MM
  tipo: TipoRetirada;
  integranteId: number | null;
  valor: number;
}

/** O que o Fechamento da Empresa já calculou para o mês. */
export interface EntradaMes {
  mes: string;
  resultadoAposOutrasReceitas: number;
  tributos: number;
  /** a coluna de cada sócio (despesas do contrato ADMINISTRATIVO <sócio>), por nome */
  colunaSocios: Record<string, number>;
}

export interface SocioNoMes {
  socioId: string;
  nome: string;
  percentual: number;
  valorLucro: number;
  retiradaColuna: number; // o contrato ADMINISTRATIVO dele
  retiradaInvestimentos: number; // integrante = ele
  retiradaObras: number;
  retiradas: number;
  saldo: number;
}

export interface ResultadoMes {
  mes: string;
  /** Resultado após Outras Receitas do Fechamento da Empresa (0 em mês fechado: só o resultado é gravado) */
  resultadoAposOutrasReceitas: number;
  /** Tributos sobre o Resultado (IRPJ e CSLL) do mês */
  tributos: number;
  resultadoAntesRetiradas: number;
  consumoEmpresa: { investimentos: number; obras: number; semIntegrante: number; total: number };
  lucroDistribuir: number;
  somaPercentual: number;
  percentualOk: boolean;
  socios: SocioNoMes[];
  totalRetiradas: number;
  totalSaldo: number;
}

/** Divide `total` pelos percentuais em centavos, sem sobra nem falta: o que sobra dos arredondamentos vai para quem tem a maior fração. */
export function distribuirPorPercentual(total: number, partes: { id: string; percentual: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  const soma = partes.reduce((s, p) => s + p.percentual, 0);
  if (partes.length === 0) return out;
  if (soma <= 0) { for (const p of partes) out.set(p.id, 0); return out; }
  const centavos = Math.round(total * 100);
  const brutos = partes.map((p) => ({ id: p.id, v: (centavos * p.percentual) / soma }));
  const pisos = brutos.map((b) => ({ id: b.id, piso: Math.floor(b.v), frac: b.v - Math.floor(b.v) }));
  let resto = centavos - pisos.reduce((s, p) => s + p.piso, 0);
  const porFracao = [...pisos].sort((a, b) => b.frac - a.frac);
  for (const p of porFracao) {
    if (resto === 0) break;
    p.piso += resto > 0 ? 1 : -1;
    resto += resto > 0 ? -1 : 1;
  }
  for (const p of pisos) out.set(p.id, p.piso / 100);
  return out;
}

/** Quem é o dono de uma linha de Investimentos/Obras Adm: um sócio, a Empresa ou ninguém (sem integrante). */
export function donoDaLinha(integranteId: number | null, socios: SocioConfig[]): { tipo: "socio"; socioId: string } | { tipo: "empresa" } | { tipo: "sem_integrante" } {
  if (integranteId === INTEGRANTE_EMPRESA_ID) return { tipo: "empresa" };
  if (integranteId == null) return { tipo: "sem_integrante" };
  const s = socios.find((x) => x.empregadoIds.includes(integranteId));
  return s ? { tipo: "socio", socioId: s.id } : { tipo: "sem_integrante" };
}

export function calcularMes(
  entrada: EntradaMes,
  socios: SocioConfig[],
  percentuais: Map<string, number>, // socioId → % do mês (sem entrada vale o padrão)
  linhas: LinhaIntegrante[],
): ResultadoMes {
  const ativos = socios.filter((s) => s.ativo);
  const consumo = { investimentos: 0, obras: 0, semIntegrante: 0, total: 0 };
  const porSocio = new Map<string, { investimentos: number; obras: number }>();
  for (const l of linhas) {
    if (l.mes !== entrada.mes) continue;
    const dono = donoDaLinha(l.integranteId, ativos);
    if (dono.tipo === "socio") {
      const p = porSocio.get(dono.socioId) ?? { investimentos: 0, obras: 0 };
      p[l.tipo] += l.valor;
      porSocio.set(dono.socioId, p);
    } else {
      // Empresa (integrante −1) e "sem integrante" consomem o lucro; o segundo é mostrado à parte
      consumo[l.tipo] += dono.tipo === "empresa" ? l.valor : 0;
      if (dono.tipo === "sem_integrante") consumo.semIntegrante += l.valor;
    }
  }
  consumo.investimentos = r2(consumo.investimentos);
  consumo.obras = r2(consumo.obras);
  consumo.semIntegrante = r2(consumo.semIntegrante);
  consumo.total = r2(consumo.investimentos + consumo.obras + consumo.semIntegrante);

  const resultadoAntesRetiradas = r2(entrada.resultadoAposOutrasReceitas - entrada.tributos);
  const lucroDistribuir = r2(resultadoAntesRetiradas - consumo.total);
  const pcts = ativos.map((s) => ({ id: s.id, percentual: percentuais.get(s.id) ?? s.percentualPadrao }));
  const parte = distribuirPorPercentual(lucroDistribuir, pcts);
  const somaPercentual = r2(pcts.reduce((s, p) => s + p.percentual, 0));

  const linhasSocios: SocioNoMes[] = ativos.map((s) => {
    const p = porSocio.get(s.id) ?? { investimentos: 0, obras: 0 };
    const coluna = r2(entrada.colunaSocios[s.nome] ?? 0);
    const retiradas = r2(coluna + p.investimentos + p.obras);
    const valorLucro = parte.get(s.id) ?? 0;
    return {
      socioId: s.id, nome: s.nome, percentual: pcts.find((x) => x.id === s.id)!.percentual, valorLucro,
      retiradaColuna: coluna, retiradaInvestimentos: r2(p.investimentos), retiradaObras: r2(p.obras), retiradas, saldo: r2(valorLucro - retiradas),
    };
  });
  return {
    mes: entrada.mes, resultadoAposOutrasReceitas: r2(entrada.resultadoAposOutrasReceitas), tributos: r2(entrada.tributos), resultadoAntesRetiradas, consumoEmpresa: consumo, lucroDistribuir, somaPercentual, percentualOk: Math.abs(somaPercentual - 100) < 0.005,
    socios: linhasSocios,
    totalRetiradas: r2(linhasSocios.reduce((s, x) => s + x.retiradas, 0)),
    totalSaldo: r2(linhasSocios.reduce((s, x) => s + x.saldo, 0)),
  };
}

export interface TotalPeriodo {
  resultadoAposOutrasReceitas: number;
  tributos: number;
  resultadoAntesRetiradas: number;
  consumoEmpresa: number;
  /** o consumo da Empresa aberto: Investimentos e Obras Adm com integrante "Empresa" e o que está sem integrante */
  consumoDetalhe: { investimentos: number; obras: number; semIntegrante: number };
  lucroDistribuir: number;
  totalRetiradas: number;
  totalSaldo: number;
  socios: {
    socioId: string; nome: string; valorLucro: number; retiradas: number; saldo: number; percentualEfetivo: number;
    /** de onde vêm as retiradas: a coluna do contrato ADMINISTRATIVO <sócio> e Investimentos/Obras Adm em que ele é o integrante */
    retiradaColuna: number; retiradaInvestimentos: number; retiradaObras: number;
  }[];
}

/** Soma vários meses (cada um com o seu percentual): o percentual efetivo do sócio é a fatia dele no lucro total. */
export function somarMeses(meses: ResultadoMes[]): TotalPeriodo {
  const porSocio = new Map<string, { nome: string; valorLucro: number; retiradas: number; coluna: number; investimentos: number; obras: number }>();
  for (const m of meses) {
    for (const s of m.socios) {
      const a = porSocio.get(s.socioId) ?? { nome: s.nome, valorLucro: 0, retiradas: 0, coluna: 0, investimentos: 0, obras: 0 };
      a.valorLucro += s.valorLucro;
      a.retiradas += s.retiradas;
      a.coluna += s.retiradaColuna;
      a.investimentos += s.retiradaInvestimentos;
      a.obras += s.retiradaObras;
      porSocio.set(s.socioId, a);
    }
  }
  const lucro = r2(meses.reduce((s, m) => s + m.lucroDistribuir, 0));
  const socios = [...porSocio.entries()].map(([socioId, a]) => ({
    socioId, nome: a.nome, valorLucro: r2(a.valorLucro), retiradas: r2(a.retiradas), saldo: r2(a.valorLucro - a.retiradas),
    percentualEfetivo: lucro !== 0 ? (a.valorLucro / lucro) * 100 : 0,
    retiradaColuna: r2(a.coluna), retiradaInvestimentos: r2(a.investimentos), retiradaObras: r2(a.obras),
  }));
  const soma = (f: (m: ResultadoMes) => number) => r2(meses.reduce((s, m) => s + f(m), 0));
  return {
    resultadoAposOutrasReceitas: soma((m) => m.resultadoAposOutrasReceitas),
    tributos: soma((m) => m.tributos),
    resultadoAntesRetiradas: soma((m) => m.resultadoAntesRetiradas),
    consumoEmpresa: soma((m) => m.consumoEmpresa.total),
    consumoDetalhe: { investimentos: soma((m) => m.consumoEmpresa.investimentos), obras: soma((m) => m.consumoEmpresa.obras), semIntegrante: soma((m) => m.consumoEmpresa.semIntegrante) },
    lucroDistribuir: lucro,
    totalRetiradas: r2(socios.reduce((s, x) => s + x.retiradas, 0)),
    totalSaldo: r2(socios.reduce((s, x) => s + x.saldo, 0)),
    socios,
  };
}

// ── Fechamento da competência (Histórico de Distribuições) ────────────────────────────────────────────────────────────────────────
export type StatusCompetencia = "aberto" | "fechado";

export interface SocioFechado {
  socioId: string;
  nome: string;
  percentual: number;
  valorLucro: number;
  retiradas: number;
  saldo: number; // saldo a retirar no fechamento
  complementoPago: number;
}

export interface LinhaHistorico {
  mes: string;
  status: StatusCompetencia;
  resultadoAntesRetiradas: number;
  lucroDistribuir: number;
  retiradas: number;
  complementoPago: number;
  saldoRemanescente: number; // o que ainda pode ser retirado: saldo a retirar − complemento pago
  dataFechamento: string | null;
}

export const totalComplementoPago = (s: SocioFechado[]) => r2(s.reduce((t, x) => t + (Number(x.complementoPago) || 0), 0));

/** Mês fechado vale o que foi gravado no fechamento; mês aberto, o que o cálculo de hoje mostra (complemento ainda não pago). */
export function linhaDoHistorico(
  calculado: ResultadoMes,
  fechamento: { status: StatusCompetencia; dataFechamento: string | null; socios: SocioFechado[]; resultadoAntesRetiradas: number; lucroDistribuir: number } | undefined,
): LinhaHistorico {
  if (fechamento && fechamento.status === "fechado") {
    const retiradas = r2(fechamento.socios.reduce((s, x) => s + x.retiradas, 0));
    const saldo = r2(fechamento.socios.reduce((s, x) => s + x.saldo, 0));
    const pago = totalComplementoPago(fechamento.socios);
    return {
      mes: calculado.mes, status: "fechado", resultadoAntesRetiradas: fechamento.resultadoAntesRetiradas, lucroDistribuir: fechamento.lucroDistribuir, retiradas,
      complementoPago: pago, saldoRemanescente: r2(saldo - pago), dataFechamento: fechamento.dataFechamento,
    };
  }
  return {
    mes: calculado.mes, status: "aberto", resultadoAntesRetiradas: calculado.resultadoAntesRetiradas, lucroDistribuir: calculado.lucroDistribuir, retiradas: calculado.totalRetiradas,
    complementoPago: 0, saldoRemanescente: calculado.totalSaldo, dataFechamento: null,
  };
}

/** Foto dos sócios no momento do fechamento (o que vai para o banco). */
export function fotoDoFechamento(r: ResultadoMes, complementoPago: Map<string, number> = new Map()): SocioFechado[] {
  return r.socios.map((s) => ({
    socioId: s.socioId, nome: s.nome, percentual: s.percentual, valorLucro: s.valorLucro, retiradas: s.retiradas, saldo: s.saldo,
    complementoPago: r2(complementoPago.get(s.socioId) ?? 0),
  }));
}

/** O que impede de fechar a competência (vazio = pode fechar). */
export function pendenciasParaFechar(r: ResultadoMes): string[] {
  const p: string[] = [];
  if (r.socios.length === 0) p.push("Cadastre os sócios e os percentuais.");
  else if (!r.percentualOk) p.push(`Os percentuais somam ${r.somaPercentual.toLocaleString("pt-BR")}%; precisam somar 100%.`);
  return p;
}

/** Mês FECHADO: o resultado vale o que foi gravado (a divisão de retiradas por tipo não é gravada: tudo vai em `retiradaColuna`). */
export function resultadoDoFechamento(
  mes: string,
  f: { resultadoAntesRetiradas: number; consumoEmpresa: number; lucroDistribuir: number; socios: SocioFechado[] },
): ResultadoMes {
  const socios: SocioNoMes[] = f.socios.map((s) => ({
    socioId: s.socioId, nome: s.nome, percentual: s.percentual, valorLucro: s.valorLucro, retiradaColuna: s.retiradas, retiradaInvestimentos: 0, retiradaObras: 0,
    retiradas: s.retiradas, saldo: s.saldo,
  }));
  const somaPercentual = r2(socios.reduce((t, x) => t + x.percentual, 0));
  return {
    mes, resultadoAposOutrasReceitas: f.resultadoAntesRetiradas, tributos: 0, resultadoAntesRetiradas: f.resultadoAntesRetiradas,
    consumoEmpresa: { investimentos: 0, obras: 0, semIntegrante: 0, total: f.consumoEmpresa },
    lucroDistribuir: f.lucroDistribuir, somaPercentual, percentualOk: Math.abs(somaPercentual - 100) < 0.005, socios,
    totalRetiradas: r2(socios.reduce((t, x) => t + x.retiradas, 0)), totalSaldo: r2(socios.reduce((t, x) => t + x.saldo, 0)),
  };
}

// ── Retiradas — detalhado ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export type TipoLancamento = "coluna_socio" | TipoRetirada;
export const ROTULO_TIPO_LANCAMENTO: Record<TipoLancamento, string> = { coluna_socio: "Despesa do sócio", investimentos: "Investimento", obras: "Obra adm" };

export interface LancamentoRetirada {
  data: string | null;
  mes: string;
  socioId: string;
  socioNome: string;
  tipo: TipoLancamento;
  descricao: string;
  origem: string; // centro de custo (contrato)
  classificacao: string;
  valor: number;
}

export function resumoPorSocio(lancamentos: LancamentoRetirada[]): { socioId: string; nome: string; valor: number; pct: number }[] {
  const total = lancamentos.reduce((s, l) => s + l.valor, 0);
  const m = new Map<string, { nome: string; valor: number }>();
  for (const l of lancamentos) {
    const a = m.get(l.socioId) ?? { nome: l.socioNome, valor: 0 };
    a.valor += l.valor;
    m.set(l.socioId, a);
  }
  return [...m.entries()]
    .map(([socioId, a]) => ({ socioId, nome: a.nome, valor: r2(a.valor), pct: total ? (a.valor / total) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor);
}
