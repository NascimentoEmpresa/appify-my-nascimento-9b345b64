// SIS-2026-0922 — OSC Canaã: cálculo da gestão financeira da escola.
//
// Toda a conta do painel mora aqui (e é testada em
// src/test/osc-financeiro.test.ts); o banco só guarda premissas, repasses,
// lançamentos e devolve os pagamentos do Malote já filtrados para a OSC
// (RPC osc_pagamentos_malote — ver migration 20261117092200).
//
// Regras, as mesmas da planilha "Canaa_Previsao_Investimentos.xlsx":
//   saldo do mês   = repasse − despesas − aplicação na reserva + resgates
//   acumulado      = saldo inicial do ano + Σ saldos do mês
//   após projetos  = acumulado − projetos (pendentes/aprovados) até o mês
//   saldo livre    = após projetos em dezembro − reserva extra a confirmar
// Qual valor de cada rubrica entra no mês:
//   fechada   → realizado (o que foi pago — Malote ou histórico importado)
//   em aberto → max(realizado, previsto): mês corrente ou atrasado ainda não
//               conferido; não subestima o que falta pagar e mostra estouro
//   prevista  → previsto (custo de referência / valor digitado do mês)
// Aplicação para férias/13º (rubrica tipo 'reserva') sai do saldo livre mas
// não é despesa; o resgate volta como entrada — quando a férias/rescisão é
// paga com o dinheiro da reserva, a despesa entra e o resgate compensa,
// sem contar duas vezes.

export const SEM_RUBRICA = "__sem_rubrica__";
export const CENARIO_DESPESA_EXTRA = "__cenario_despesa_extra__";

export type SituacaoMes = "fechada" | "em_aberto" | "prevista";
export type TipoRubrica = "despesa" | "reserva";
export type CriterioPrevisao = "manual" | "ultimo_realizado" | "media_realizado";
export type StatusProjeto = "pendente" | "aprovado" | "executado" | "cancelado";

export interface OscRubricaCalc {
  id: string;
  nome: string;
  grupo: string;
  tipo: TipoRubrica;
  ordem?: number;
  recorrente?: boolean;
}
export interface OscPrevisaoCalc {
  rubrica_id: string;
  criterio: CriterioPrevisao;
  base_mensal: number;
  ajuste_pct: number; // fração: 0.05 = +5%
}
export interface OscPrevisaoMesCalc {
  rubrica_id: string;
  competencia: string; // yyyy-mm-01
  valor: number;
}
export interface OscCompetenciaCalc {
  competencia: string;
  repasse_previsto: number | null;
  repasse_recebido: number | null;
  situacao: "aberta" | "fechada";
  fonte_realizado: "malote" | "historico";
}
export interface OscLancamentoCalc {
  competencia: string;
  rubrica_id: string;
  tipo: "historico" | "ajuste" | "resgate";
  valor: number;
}
export interface OscPagamentoCalc {
  competencia: string;
  rubrica_id: string | null;
  valor: number;
  ignorado: boolean;
  data_pagamento?: string | null;
}
export interface OscProjetoCalc {
  valor_estimado: number;
  competencia_prevista: string | null;
  status: StatusProjeto;
}
export interface OscCenario {
  /** fração sobre o repasse dos meses ainda não recebidos (−0.1 = corte de 10%) */
  ajusteRepassePct?: number;
  /** despesa nova por mês nos meses não fechados */
  despesaExtraMensal?: number;
  /** fração de economia sobre o previsto das despesas nos meses não fechados */
  economiaPct?: number;
  /** projetos hipotéticos (não gravados) */
  projetosExtras?: { valor: number; competencia: string | null }[];
}
export interface EntradaOsc {
  ano: number;
  hoje: Date | string;
  repasseMensal: number;
  saldoInicial: number;
  reservaExtra: number;
  rubricas: OscRubricaCalc[];
  previsoes: OscPrevisaoCalc[];
  previsoesMes: OscPrevisaoMesCalc[];
  competencias: OscCompetenciaCalc[];
  lancamentos: OscLancamentoCalc[];
  pagamentos: OscPagamentoCalc[];
  projetos: OscProjetoCalc[];
  cenario?: OscCenario;
  /** projetos pendentes abatem do saldo (padrão true; aprovados sempre) */
  incluirProjetosPendentes?: boolean;
}

export interface ValorRubricaMes {
  previsto: number;
  realizado: number;
  considerado: number;
}
export interface ResultadoMes {
  mes: number; // 1..12
  competencia: string;
  situacao: SituacaoMes;
  fonteRealizado: "malote" | "historico";
  repasse: number;
  repasseConfirmado: boolean;
  /** pago no Malote (não ignorado), mesmo quando o mês usa o histórico — base da conciliação */
  pagoMalote: number;
  /** histórico importado do mês (lançamentos 'historico'), conte ou não */
  historicoImportado: number;
  /** ajustes manuais (pagos fora do Malote) */
  ajustesManuais: number;
  realizadoDespesas: number;
  previstoDespesas: number;
  realizadoAplicacoes: number;
  previstoAplicacoes: number;
  despesas: number; // consideradas
  aplicacoes: number; // consideradas
  resgates: number;
  saidas: number; // despesas + aplicacoes
  saldoMes: number;
  saldoAcumulado: number;
  projetos: number;
  saldoAposProjetos: number;
  reservaAcumulada: number;
  porRubrica: Record<string, ValorRubricaMes>;
}
export interface AlertaOsc {
  tipo: "deficit" | "deficit_mes" | "sem_rubrica" | "acima_previsto" | "repasse_nao_confirmado"
    | "mes_atrasado_aberto" | "competencia_divergente" | "saldo_a_destinar";
  nivel: "erro" | "aviso" | "info";
  mensagem: string;
  competencia?: string;
  rubrica_id?: string;
  valor?: number;
}
export interface ComposicaoItem {
  rubrica_id: string;
  nome: string;
  grupo: string;
  valor: number;
  pct: number;
}
export interface ResultadoOsc {
  meses: ResultadoMes[];
  mesAtual: number; // 0 = ano futuro; 12 = ano passado
  ultimoFechado: number | null;
  saldoAteUltimoFechado: number;
  mesReferencia: number | null; // 1º mês não fechado
  custoReferencia: number; // saídas previstas (despesas + aplicação) do mês de referência
  saldoProjetadoDezembro: number;
  saldoAposProjetosDezembro: number;
  reservaAcumuladaAtual: number;
  projetosAprovados: number;
  projetosPendentes: number;
  saldoLivre: number;
  totais: { repasse: number; despesas: number; aplicacoes: number; resgates: number; pagoMalote: number };
  composicao: ComposicaoItem[];
  alertas: AlertaOsc[];
}

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function competenciaDe(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}
/** mês (1..12) de uma data/competência 'yyyy-mm-dd' se for do ano; senão null */
export function mesDoAno(data: string | null | undefined, ano: number): number | null {
  if (!data) return null;
  const a = Number(data.slice(0, 4));
  const m = Number(data.slice(5, 7));
  if (a !== ano || !(m >= 1 && m <= 12)) return null;
  return m;
}
export function mesAtualNoAno(hoje: Date | string, ano: number) {
  const d = typeof hoje === "string" ? new Date(`${hoje.slice(0, 10)}T12:00:00`) : hoje;
  const a = d.getFullYear();
  if (a < ano) return 0;
  if (a > ano) return 12;
  return d.getMonth() + 1;
}

export const NOME_MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const NOME_MES_LONGO = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
  "Setembro", "Outubro", "Novembro", "Dezembro"];

export function calcularOsc(e: EntradaOsc): ResultadoOsc {
  const { ano } = e;
  const cen = e.cenario ?? {};
  const mesAtual = mesAtualNoAno(e.hoje, ano);
  const meses12 = Array.from({ length: 12 }, (_, i) => i + 1);
  const rubricaPorId = new Map(e.rubricas.map((r) => [r.id, r]));
  const tipoDe = (id: string): TipoRubrica => rubricaPorId.get(id)?.tipo ?? "despesa";

  const compPorMes = new Map<number, OscCompetenciaCalc>();
  for (const c of e.competencias) {
    const m = mesDoAno(c.competencia, ano);
    if (m) compPorMes.set(m, c);
  }
  const situacaoDe = (m: number): SituacaoMes => {
    if (compPorMes.get(m)?.situacao === "fechada") return "fechada";
    return m <= mesAtual ? "em_aberto" : "prevista";
  };
  const fonteDe = (m: number) => compPorMes.get(m)?.fonte_realizado ?? "malote";

  // ── realizado por mês × rubrica ─────────────────────────────────────────
  const realizado = meses12.map(() => new Map<string, number>());
  const somar = (mapa: Map<string, number>, k: string, v: number) => mapa.set(k, r2((mapa.get(k) ?? 0) + v));
  const pagoMalote = meses12.map(() => 0);
  const historicoImportado = meses12.map(() => 0);
  const ajustesManuais = meses12.map(() => 0);
  const resgates = meses12.map(() => 0);

  for (const p of e.pagamentos) {
    if (p.ignorado) continue;
    const m = mesDoAno(p.competencia, ano);
    if (!m) continue;
    const v = num(p.valor);
    pagoMalote[m - 1] = r2(pagoMalote[m - 1] + v);
    if (fonteDe(m) === "malote") somar(realizado[m - 1], p.rubrica_id ?? SEM_RUBRICA, v);
  }
  for (const l of e.lancamentos) {
    const m = mesDoAno(l.competencia, ano);
    if (!m) continue;
    const v = num(l.valor);
    if (l.tipo === "resgate") {
      resgates[m - 1] = r2(resgates[m - 1] + v);
    } else if (l.tipo === "historico") {
      historicoImportado[m - 1] = r2(historicoImportado[m - 1] + v);
      if (fonteDe(m) === "historico") somar(realizado[m - 1], l.rubrica_id, v);
    } else {
      ajustesManuais[m - 1] = r2(ajustesManuais[m - 1] + v);
      somar(realizado[m - 1], l.rubrica_id, v);
    }
  }

  // ── previsto por mês × rubrica ──────────────────────────────────────────
  const fechados = meses12.filter((m) => situacaoDe(m) === "fechada");
  const ultimoFechado = fechados.length ? fechados[fechados.length - 1] : null;
  const previsaoPorRubrica = new Map(e.previsoes.map((p) => [p.rubrica_id, p]));
  const override = new Map<string, number>();
  for (const pm of e.previsoesMes) {
    const m = mesDoAno(pm.competencia, ano);
    if (m) override.set(`${pm.rubrica_id}|${m}`, num(pm.valor));
  }
  const baseDe = (rubricaId: string): number => {
    const p = previsaoPorRubrica.get(rubricaId);
    if (!p) return 0;
    let base = num(p.base_mensal);
    if (p.criterio === "ultimo_realizado" && ultimoFechado) {
      base = realizado[ultimoFechado - 1].get(rubricaId) ?? 0;
    } else if (p.criterio === "media_realizado" && fechados.length) {
      const soma = fechados.reduce((s, m) => s + (realizado[m - 1].get(rubricaId) ?? 0), 0);
      base = r2(soma / fechados.length);
    }
    return r2(base * (1 + num(p.ajuste_pct)));
  };
  const baseCache = new Map<string, number>();
  const previstoDe = (rubricaId: string, m: number) => {
    const o = override.get(`${rubricaId}|${m}`);
    if (o !== undefined) return o;
    if (!baseCache.has(rubricaId)) baseCache.set(rubricaId, baseDe(rubricaId));
    return baseCache.get(rubricaId)!;
  };

  const idsRubricas = new Set<string>([...e.rubricas.map((r) => r.id), ...e.previsoes.map((p) => p.rubrica_id)]);

  // ── projetos ────────────────────────────────────────────────────────────
  const incluirPendentes = e.incluirProjetosPendentes ?? true;
  const projetosMes = meses12.map(() => 0);
  let projetosAprovados = 0;
  let projetosPendentes = 0;
  const alocarProjeto = (valor: number, comp: string | null) => {
    if (comp && Number(comp.slice(0, 4)) !== ano) return false;
    const m = comp ? mesDoAno(comp, ano) ?? 12 : 12;
    projetosMes[m - 1] = r2(projetosMes[m - 1] + valor);
    return true;
  };
  for (const p of e.projetos) {
    const v = num(p.valor_estimado);
    if (p.status === "aprovado") {
      if (alocarProjeto(v, p.competencia_prevista)) projetosAprovados = r2(projetosAprovados + v);
    } else if (p.status === "pendente") {
      const doAno = !p.competencia_prevista || Number(p.competencia_prevista.slice(0, 4)) === ano;
      if (doAno) {
        projetosPendentes = r2(projetosPendentes + v);
        if (incluirPendentes) alocarProjeto(v, p.competencia_prevista);
      }
    }
  }
  for (const p of cen.projetosExtras ?? []) alocarProjeto(num(p.valor), p.competencia);

  // ── mês a mês ───────────────────────────────────────────────────────────
  const meses: ResultadoMes[] = [];
  let acumulado = num(e.saldoInicial);
  let projetosAcum = 0;
  let reservaAcum = 0;
  for (const m of meses12) {
    const situacao = situacaoDe(m);
    const comp = compPorMes.get(m);
    const real = realizado[m - 1];
    const porRubrica: Record<string, ValorRubricaMes> = {};
    const ids = new Set<string>([...idsRubricas, ...real.keys()]);
    let realizadoDespesas = 0, previstoDespesas = 0, realizadoAplicacoes = 0, previstoAplicacoes = 0;
    let despesas = 0, aplicacoes = 0;
    for (const id of ids) {
      const tipo = id === SEM_RUBRICA ? "despesa" : tipoDe(id);
      let previsto = id === SEM_RUBRICA ? 0 : previstoDe(id, m);
      if (situacao !== "fechada" && tipo === "despesa" && cen.economiaPct) previsto = r2(previsto * (1 - cen.economiaPct));
      const realizadoV = real.get(id) ?? 0;
      const considerado = situacao === "fechada" ? realizadoV
        : situacao === "em_aberto" ? Math.max(realizadoV, previsto) : previsto;
      if (previsto === 0 && realizadoV === 0) continue;
      porRubrica[id] = { previsto: r2(previsto), realizado: r2(realizadoV), considerado: r2(considerado) };
      if (tipo === "reserva") {
        realizadoAplicacoes += realizadoV; previstoAplicacoes += previsto; aplicacoes += considerado;
      } else {
        realizadoDespesas += realizadoV; previstoDespesas += previsto; despesas += considerado;
      }
    }
    if (situacao !== "fechada" && cen.despesaExtraMensal) {
      const v = num(cen.despesaExtraMensal);
      porRubrica[CENARIO_DESPESA_EXTRA] = { previsto: v, realizado: 0, considerado: v };
      previstoDespesas += v; despesas += v;
    }

    const repassePrevisto = comp?.repasse_previsto ?? e.repasseMensal;
    const repasseConfirmado = comp?.repasse_recebido !== null && comp?.repasse_recebido !== undefined;
    let repasse = repasseConfirmado ? num(comp!.repasse_recebido) : num(repassePrevisto);
    if (!repasseConfirmado && situacao !== "fechada" && cen.ajusteRepassePct) repasse = r2(repasse * (1 + cen.ajusteRepassePct));

    const saidas = r2(despesas + aplicacoes);
    const saldoMes = r2(repasse - saidas + resgates[m - 1]);
    acumulado = r2(acumulado + saldoMes);
    projetosAcum = r2(projetosAcum + projetosMes[m - 1]);
    reservaAcum = r2(reservaAcum + aplicacoes - resgates[m - 1]);

    meses.push({
      mes: m,
      competencia: competenciaDe(ano, m),
      situacao,
      fonteRealizado: fonteDe(m),
      repasse: r2(repasse),
      repasseConfirmado,
      pagoMalote: pagoMalote[m - 1],
      historicoImportado: historicoImportado[m - 1],
      ajustesManuais: ajustesManuais[m - 1],
      realizadoDespesas: r2(realizadoDespesas),
      previstoDespesas: r2(previstoDespesas),
      realizadoAplicacoes: r2(realizadoAplicacoes),
      previstoAplicacoes: r2(previstoAplicacoes),
      despesas: r2(despesas),
      aplicacoes: r2(aplicacoes),
      resgates: resgates[m - 1],
      saidas,
      saldoMes,
      saldoAcumulado: acumulado,
      projetos: projetosMes[m - 1],
      saldoAposProjetos: r2(acumulado - projetosAcum),
      reservaAcumulada: reservaAcum,
      porRubrica,
    });
  }

  // ── indicadores ─────────────────────────────────────────────────────────
  const mesReferencia = meses.find((x) => x.situacao !== "fechada")?.mes ?? null;
  const ref = mesReferencia ? meses[mesReferencia - 1] : null;
  const dez = meses[11];
  const saldoLivre = r2(dez.saldoAposProjetos - num(e.reservaExtra));
  const reservaAtual = mesAtual >= 1 ? meses[Math.min(mesAtual, 12) - 1].reservaAcumulada : 0;

  const composicaoMapa = new Map<string, number>();
  for (const x of meses) {
    for (const [id, v] of Object.entries(x.porRubrica)) {
      composicaoMapa.set(id, r2((composicaoMapa.get(id) ?? 0) + v.considerado));
    }
  }
  const totalComp = [...composicaoMapa.values()].reduce((s, v) => s + Math.max(v, 0), 0);
  const composicao: ComposicaoItem[] = [...composicaoMapa.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => {
      const rub = rubricaPorId.get(id);
      return {
        rubrica_id: id,
        nome: id === SEM_RUBRICA ? "Sem rubrica" : id === CENARIO_DESPESA_EXTRA ? "Despesa simulada" : rub?.nome ?? id,
        grupo: id === SEM_RUBRICA ? "outros" : rub?.grupo ?? "outros",
        valor: v,
        pct: totalComp ? v / totalComp : 0,
      };
    })
    .sort((a, b) => b.valor - a.valor);

  const totais = meses.reduce(
    (t, x) => ({
      repasse: r2(t.repasse + x.repasse),
      despesas: r2(t.despesas + x.despesas),
      aplicacoes: r2(t.aplicacoes + x.aplicacoes),
      resgates: r2(t.resgates + x.resgates),
      pagoMalote: r2(t.pagoMalote + x.pagoMalote),
    }),
    { repasse: 0, despesas: 0, aplicacoes: 0, resgates: 0, pagoMalote: 0 },
  );

  const resultado: ResultadoOsc = {
    meses,
    mesAtual,
    ultimoFechado,
    saldoAteUltimoFechado: ultimoFechado ? meses[ultimoFechado - 1].saldoAcumulado : r2(num(e.saldoInicial)),
    mesReferencia,
    custoReferencia: ref ? r2(ref.previstoDespesas + ref.previstoAplicacoes) : 0,
    saldoProjetadoDezembro: dez.saldoAcumulado,
    saldoAposProjetosDezembro: dez.saldoAposProjetos,
    reservaAcumuladaAtual: reservaAtual,
    projetosAprovados,
    projetosPendentes,
    saldoLivre,
    totais,
    composicao,
    alertas: [],
  };
  resultado.alertas = gerarAlertas(e, resultado);
  return resultado;
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function gerarAlertas(e: EntradaOsc, r: ResultadoOsc): AlertaOsc[] {
  const alertas: AlertaOsc[] = [];
  const nomeRub = (id: string) => e.rubricas.find((x) => x.id === id)?.nome ?? (id === SEM_RUBRICA ? "Sem rubrica" : id);

  if (r.saldoProjetadoDezembro < 0) {
    alertas.push({ tipo: "deficit", nivel: "erro", valor: r.saldoProjetadoDezembro,
      mensagem: `Déficit projetado em dezembro: ${brl(r.saldoProjetadoDezembro)}.` });
  }
  const primeiroNegativo = r.meses.find((m) => m.saldoAcumulado < 0);
  if (primeiroNegativo && primeiroNegativo.mes !== 12) {
    alertas.push({ tipo: "deficit_mes", nivel: "aviso", competencia: primeiroNegativo.competencia, valor: primeiroNegativo.saldoAcumulado,
      mensagem: `Saldo acumulado fica negativo em ${NOME_MES_LONGO[primeiroNegativo.mes - 1]} (${brl(primeiroNegativo.saldoAcumulado)}).` });
  }

  const semRubrica = e.pagamentos.filter((p) => !p.ignorado && !p.rubrica_id && mesDoAno(p.competencia, e.ano));
  if (semRubrica.length) {
    const total = r2(semRubrica.reduce((s, p) => s + num(p.valor), 0));
    alertas.push({ tipo: "sem_rubrica", nivel: "aviso", valor: total,
      mensagem: `${semRubrica.length} pagamento(s) do Malote sem rubrica OSC (${brl(total)}) — classifique no de-para ou revise o pagamento.` });
  }

  for (const m of r.meses) {
    if (m.situacao === "prevista") continue;
    for (const [id, v] of Object.entries(m.porRubrica)) {
      if (id === SEM_RUBRICA || id === CENARIO_DESPESA_EXTRA) continue;
      const dif = r2(v.realizado - v.previsto);
      if (dif >= 100 && v.realizado > v.previsto * 1.1) {
        alertas.push({ tipo: "acima_previsto", nivel: "aviso", competencia: m.competencia, rubrica_id: id, valor: dif,
          mensagem: `${nomeRub(id)} em ${NOME_MES_LONGO[m.mes - 1]}: realizado ${brl(v.realizado)} acima do previsto ${brl(v.previsto)} (+${brl(dif)}).` });
      }
    }
    if (!m.repasseConfirmado && (m.situacao === "fechada" || m.mes < r.mesAtual)) {
      alertas.push({ tipo: "repasse_nao_confirmado", nivel: "aviso", competencia: m.competencia,
        mensagem: `Repasse de ${NOME_MES_LONGO[m.mes - 1]} não confirmado — o cálculo usa o previsto (${brl(m.repasse)}).` });
    }
    if (m.situacao === "em_aberto" && m.mes < r.mesAtual) {
      alertas.push({ tipo: "mes_atrasado_aberto", nivel: "info", competencia: m.competencia,
        mensagem: `${NOME_MES_LONGO[m.mes - 1]} ainda não foi fechado: o cálculo usa o maior entre realizado e previsto por rubrica.` });
    }
  }

  const divergentes = e.pagamentos.filter((p) => !p.ignorado && p.data_pagamento && mesDoAno(p.competencia, e.ano)
    && p.data_pagamento.slice(0, 7) !== p.competencia.slice(0, 7));
  if (divergentes.length) {
    alertas.push({ tipo: "competencia_divergente", nivel: "info",
      mensagem: `${divergentes.length} pagamento(s) com data de pagamento fora do mês da competência — o painel usa a competência.` });
  }

  if (r.saldoLivre > 0) {
    alertas.push({ tipo: "saldo_a_destinar", nivel: "info", valor: r.saldoLivre,
      mensagem: `Saldo estimado a destinar em dezembro: ${brl(r.saldoLivre)}. Validar despesas pendentes e o uso permitido no plano de trabalho antes de comprometer.` });
  }
  return alertas;
}

// ── Importação da planilha ────────────────────────────────────────────────
export interface LinhaImportacaoOsc {
  competencia: string;
  rubrica: string;
  descricao: string | null;
  valor: number;
  origem: string | null;
}
export const normalizarNome = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Lê as linhas no formato da aba "Base janeiro a julho" (Mês | Descrição
 * original | Categoria | Valor | Origem) ou um modelo simples (Competência |
 * Rubrica | Valor | Descrição). `linhas` = matriz da planilha (sheet_to_json
 * com header: 1). Procura o cabeçalho; mês pode ser número (1..12), data ou
 * 'mm/aaaa'.
 */
export function lerLinhasImportacao(linhas: unknown[][], ano: number): { linhas: LinhaImportacaoOsc[]; erros: string[] } {
  const erros: string[] = [];
  const saida: LinhaImportacaoOsc[] = [];
  const idxCab = linhas.findIndex((l) => {
    const n = (l ?? []).map((c) => normalizarNome(String(c ?? "")));
    return n.includes("valor") || n.includes("valor (r$)");
  });
  if (idxCab < 0) return { linhas: [], erros: ["Cabeçalho não encontrado (precisa de uma coluna 'Valor')."] };
  const cab = linhas[idxCab].map((c) => normalizarNome(String(c ?? "")));
  const col = (...nomes: string[]) => cab.findIndex((c) => nomes.some((n) => c === n || c.startsWith(n)));
  const cMes = col("mes", "competencia");
  const cRub = col("categoria", "rubrica");
  const cVal = col("valor");
  const cDesc = col("descricao");
  const cOrig = col("origem");
  if (cMes < 0 || cRub < 0 || cVal < 0) {
    return { linhas: [], erros: ["Colunas obrigatórias: Mês (ou Competência), Categoria (ou Rubrica) e Valor."] };
  }
  for (let i = idxCab + 1; i < linhas.length; i++) {
    const l = linhas[i] ?? [];
    const bruto = l[cMes];
    const rub = String(l[cRub] ?? "").trim();
    const valRaw = l[cVal];
    if ((bruto === undefined || bruto === null || bruto === "") && !rub) continue;
    let mes: number | null = null;
    let anoLinha = ano;
    if (typeof bruto === "number" && bruto >= 1 && bruto <= 12) mes = bruto;
    else if (bruto instanceof Date) { mes = bruto.getMonth() + 1; anoLinha = bruto.getFullYear(); }
    else if (typeof bruto === "string") {
      const s = bruto.trim();
      const mm = s.match(/^(\d{1,2})\/(\d{4})$/) ?? s.match(/^(\d{4})-(\d{2})/);
      if (mm) {
        if (s.includes("/")) { mes = Number(mm[1]); anoLinha = Number(mm[2]); } else { anoLinha = Number(mm[1]); mes = Number(mm[2]); }
      } else if (/^\d{1,2}$/.test(s)) mes = Number(s);
    }
    const valor = typeof valRaw === "number" ? valRaw
      : Number(String(valRaw ?? "").replace(/[R$\s.]/g, "").replace(",", "."));
    if (!mes || mes < 1 || mes > 12) { erros.push(`Linha ${i + 1}: mês inválido (${String(bruto)}).`); continue; }
    if (!rub) { erros.push(`Linha ${i + 1}: sem categoria/rubrica.`); continue; }
    if (!Number.isFinite(valor) || valRaw === "" || valRaw === null || valRaw === undefined) continue;
    if (valor === 0) continue;
    if (valor < 0) { erros.push(`Linha ${i + 1}: valor negativo.`); continue; }
    saida.push({
      competencia: competenciaDe(anoLinha, mes),
      rubrica: rub,
      descricao: cDesc >= 0 ? String(l[cDesc] ?? "").trim() || null : null,
      valor: r2(valor),
      origem: cOrig >= 0 ? String(l[cOrig] ?? "").trim() || null : null,
    });
  }
  return { linhas: saida, erros };
}
