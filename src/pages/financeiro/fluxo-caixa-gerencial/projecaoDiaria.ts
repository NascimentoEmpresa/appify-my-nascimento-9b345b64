// SIS-2026-0893 (etapa 2, commit 1) — Motor da projeção diária de caixa do Fluxo de Caixa Gerencial.
// FUNÇÕES PURAS (sem React, sem banco): recebem saldo inicial, movimentos e aplicações e devolvem a evolução dia a dia, o menor saldo, a necessidade
// máxima de caixa e a necessidade em 30/60/90 dias. Quem lê os dados (etapas seguintes) só monta a entrada; a regra mora aqui e é testada.
//
// Regras (especificação funcional da etapa 2, Financeiro):
//  · Saldo final do dia = saldo inicial do dia + entradas − saídas; o saldo inicial do dia seguinte é o final do anterior.
//  · Os horizontes 30/60/90 saem da MESMA série diária (acumulados a partir da mesma data-base). Nunca se somam totais de horizontes entre si.
//  · Dia 1 = data-base (inclui os movimentos dela); o horizonte de N dias vai da data-base até data-base + N − 1.
//  · Compromisso vencido (data anterior à data-base) entra na PRIMEIRA data projetada, com o vencimento original preservado, e não conta de novo no original.
//  · O mesmo pagamento em mais de uma fonte conta UMA vez (mesma `chave`).
//  · Ordem de cobertura (política de SIMULAÇÃO, nada é resgatado nem contratado de verdade): saldo próprio → aplicações com resgate disponível até a data
//    → limite disponível da Conta Garantida → capital externo.
//  · Saldo inicial desconhecido (conta sem extrato validado) NÃO vira zero: o resultado sai "não validado" e só o fluxo líquido é calculado.
//  · Reserva mínima não cadastrada NÃO vira zero: o alerta diz que o parâmetro está pendente.
//  · Compensação entre empresas não existe aqui: a projeção é de UMA empresa por vez (quem chama filtra).
//  · Aritmética em centavos inteiros (sem erro de ponto flutuante).

// ── datas e calendário ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const DIA_MS = 86_400_000;
const paraData = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);

export const somarDias = (iso: string, n: number): string => paraIso(new Date(paraData(iso).getTime() + n * DIA_MS));

export function ehDiaUtil(iso: string, feriados: ReadonlySet<string>): boolean {
  const dow = paraData(iso).getUTCDay();
  return dow !== 0 && dow !== 6 && !feriados.has(iso.slice(0, 10));
}

export type RegraDiaUtil = "manter" | "antecipar" | "postergar";

/** Data efetiva de uma obrigação: `manter` não mexe; `antecipar` volta ao dia útil anterior; `postergar` avança ao próximo. Configurável por obrigação (não vale para todas). */
export function ajustarParaDiaUtil(iso: string, regra: RegraDiaUtil, feriados: ReadonlySet<string>): string {
  if (regra === "manter" || ehDiaUtil(iso, feriados)) return iso.slice(0, 10);
  const passo = regra === "antecipar" ? -1 : 1;
  let d = iso.slice(0, 10);
  for (let i = 0; i < 400 && !ehDiaUtil(d, feriados); i++) d = somarDias(d, passo);
  return d;
}

/** Soma `n` dias ÚTEIS (n ≥ 0). Se a data de partida não for dia útil, conta a partir do próximo dia útil. */
export function somarDiasUteis(iso: string, n: number, feriados: ReadonlySet<string>): string {
  let d = ajustarParaDiaUtil(iso, "postergar", feriados);
  let falta = n;
  for (let i = 0; falta > 0 && i < 4000; i++) {
    d = somarDias(d, 1);
    if (ehDiaUtil(d, feriados)) falta--;
  }
  return d;
}

// ── aplicações: quando o dinheiro pode entrar e quanto ─────────────────────────────────────────────────────────────────────────────────

export type TipoLiquidez = "D0" | "D1" | "DN" | "vencimento";

export interface AplicacaoParaLiquidez {
  id: string;
  rotulo: string;
  saldoBruto: number;
  tipoLiquidez: TipoLiquidez;
  /** prazo N (dias) quando D+N */
  prazoN?: number | null;
  calendarioLiquidacao: "uteis" | "corridos";
  /** primeira data em que o resgate pode ser PEDIDO (fim da carência) */
  fimCarencia?: string | null;
  vencimento?: string | null;
  resgateParcial: boolean;
  valorMinimoResgate?: number | null;
  /** parcela que deve permanecer aplicada */
  saldoMinimoObrigatorio?: number | null;
  /** IR/IOF/multa estimados: percentual sobre o resgatado e valor fixo */
  deducaoPct?: number | null;
  deducaoFixa?: number | null;
}

export interface AplicacaoResgatavel {
  id: string;
  rotulo: string;
  /** primeira data em que o dinheiro LÍQUIDO pode estar na conta */
  dataDisponivel: string;
  valorLiquido: number;
  parcial: boolean;
  valorMinimo: number;
}

/**
 * Data de disponibilidade e valor líquido resgatável. Exemplo da especificação: carência até o dia 10 e D+1 útil → o pedido sai no dia 10 e o dinheiro entra no dia 11
 * (útil); antes disso a aplicação NÃO cobre nenhuma necessidade. Sem data de vencimento e liquidez "no vencimento", o resgate não é elegível (`null`).
 */
export function calcularResgatavel(a: AplicacaoParaLiquidez, dataBase: string, feriados: ReadonlySet<string> = new Set()): AplicacaoResgatavel | null {
  const livre = Math.max(0, a.saldoBruto - (a.saldoMinimoObrigatorio ?? 0));
  const liquido = Math.max(0, livre - livre * ((a.deducaoPct ?? 0) / 100) - (a.deducaoFixa ?? 0));
  if (liquido <= 0) return null;

  // primeiro dia em que dá para pedir o resgate
  let pedido = a.fimCarencia && a.fimCarencia > dataBase ? a.fimCarencia : dataBase;
  let disponivel: string;
  if (a.tipoLiquidez === "vencimento") {
    if (!a.vencimento) return null;
    pedido = a.vencimento > pedido ? a.vencimento : pedido;
    disponivel = pedido;
  } else {
    const n = a.tipoLiquidez === "D0" ? 0 : a.tipoLiquidez === "D1" ? 1 : Math.max(0, a.prazoN ?? 0);
    const pedidoUtil = a.calendarioLiquidacao === "uteis" ? ajustarParaDiaUtil(pedido, "postergar", feriados) : pedido;
    disponivel = a.calendarioLiquidacao === "uteis" ? somarDiasUteis(pedidoUtil, n, feriados) : somarDias(pedidoUtil, n);
  }
  return { id: a.id, rotulo: a.rotulo, dataDisponivel: disponivel, valorLiquido: round2(liquido), parcial: a.resgateParcial, valorMinimo: a.valorMinimoResgate ?? 0 };
}

// ── movimentos ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MovimentoProjetado {
  /** identificador único do compromisso entre fontes (Malote, Débito Automático, Fluxo...): mesma chave = o mesmo pagamento, contado uma vez */
  chave?: string;
  data: string;
  valor: number;
  tipo: "entrada" | "saida";
  rotulo: string;
  origem?: string;
}

export interface MovimentoDoDia extends MovimentoProjetado {
  /** definido quando o compromisso estava vencido e foi trazido para a primeira data */
  vencimentoOriginal?: string;
}

/** Mesma `chave` conta uma vez só (vale o primeiro). Movimento sem chave nunca é descartado. */
export function deduplicarMovimentos(movs: MovimentoProjetado[]): MovimentoProjetado[] {
  const vistos = new Set<string>();
  return movs.filter((m) => {
    if (!m.chave) return true;
    if (vistos.has(m.chave)) return false;
    vistos.add(m.chave);
    return true;
  });
}

// ── projeção ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EntradaProjecao {
  /** YYYY-MM-DD: dia 1 da projeção */
  dataBase: string;
  /** null = saldo não validado (sem extrato confiável): NUNCA assumir zero */
  saldoInicial: number | null;
  movimentos: MovimentoProjetado[];
  aplicacoes?: AplicacaoResgatavel[];
  /** limite da Conta Garantida ainda disponível; null/ausente = não há crédito a simular */
  limiteCreditoDisponivel?: number | null;
  /** null/ausente = parâmetro pendente (não presume zero) */
  reservaMinima?: number | null;
  horizontes?: number[];
}

export type Alerta = "verde" | "amarelo" | "vermelho" | "nao_validado" | "reserva_pendente";

export interface DiaProjetado {
  data: string;
  entradas: number;
  saidas: number;
  /** saldo do próprio caixa (sem resgates nem crédito); null quando o saldo inicial não é validado */
  saldoInicial: number | null;
  saldoFinal: number | null;
  /** soma líquida desde a data-base (existe mesmo sem saldo inicial) */
  fluxoAcumulado: number;
  movimentos: MovimentoDoDia[];
  /** o que a simulação resgatou/usou de crédito NESTE dia */
  resgatesDoDia: { id: string; rotulo: string; valor: number }[];
  creditoDoDia: number;
}

export interface CenarioHorizonte {
  saldoFinal: number;
  menorSaldo: number;
  dataMenorSaldo: string;
  /** maior déficit do período: max(0, −menor saldo) */
  necessidadeMaxima: number;
  /** déficit no último dia do horizonte: max(0, −saldo final) */
  necessidadeFinal: number;
  sobraFinal: number;
}

export interface ResultadoHorizonte {
  dias: number;
  dataFim: string;
  entradas: number;
  saidas: number;
  /** só o próprio caixa */
  semResgates: CenarioHorizonte | null;
  /** + aplicações elegíveis, resgatadas quando há déficit */
  comResgates: CenarioHorizonte | null;
  /** + limite da Conta Garantida; o que sobrar é capital externo */
  comCredito: CenarioHorizonte | null;
  usoResgates: number;
  usoCredito: number;
  /** o que ainda falta depois de saldo, resgates e crédito (capital externo adicional) */
  capitalExterno: number;
  alerta: Alerta;
}

export interface DiaCritico {
  data: string;
  saldoFinal: number;
  deficit: number;
  /** maiores pagamentos do dia */
  pagamentos: MovimentoDoDia[];
  entradasAcumuladas: number;
  /** o que as aplicações já podem entregar até esta data (valor líquido) */
  resgatavelAteAData: number;
  /** déficit que resta depois dos resgates disponíveis até a data */
  deficitAposResgates: number;
}

export interface ResultadoProjecao {
  dataBase: string;
  validado: boolean;
  reservaPendente: boolean;
  dias: DiaProjetado[];
  horizontes: ResultadoHorizonte[];
  diasCriticos: DiaCritico[];
  /** vencidos trazidos para a primeira data */
  vencidos: MovimentoDoDia[];
  totalVencidos: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const cent = (n: number) => Math.round(n * 100);
const reais = (c: number) => c / 100;

export function projetarCaixa(e: EntradaProjecao): ResultadoProjecao {
  const horizontes = (e.horizontes ?? [30, 60, 90]).slice().sort((a, b) => a - b);
  const maxDias = horizontes[horizontes.length - 1] ?? 0;
  const validado = e.saldoInicial !== null && e.saldoInicial !== undefined;
  const inicialC = validado ? cent(e.saldoInicial as number) : 0;
  const movs = deduplicarMovimentos(e.movimentos);

  // distribui por dia (vencidos vão ao dia 1; depois do horizonte é ignorado)
  const ultimo = somarDias(e.dataBase, maxDias - 1);
  const porDia = new Map<string, MovimentoDoDia[]>();
  const vencidos: MovimentoDoDia[] = [];
  for (const m of movs) {
    const dia = m.data.slice(0, 10);
    if (dia > ultimo || !(m.valor > 0)) continue;
    if (dia < e.dataBase) {
      const v: MovimentoDoDia = { ...m, data: e.dataBase, vencimentoOriginal: dia };
      vencidos.push(v);
      porDia.set(e.dataBase, [...(porDia.get(e.dataBase) ?? []), v]);
    } else {
      porDia.set(dia, [...(porDia.get(dia) ?? []), { ...m, data: dia }]);
    }
  }

  // aplicações: restam por aplicação (centavos)
  const apps = (e.aplicacoes ?? []).map((a) => ({ ...a, restanteC: cent(a.valorLiquido) })).sort((a, b) => a.dataDisponivel.localeCompare(b.dataDisponivel) || b.restanteC - a.restanteC);
  let limiteRestC = cent(Math.max(0, e.limiteCreditoDisponivel ?? 0));

  const dias: DiaProjetado[] = [];
  // séries por dia, em centavos: saldo só do caixa, com resgates, com resgates + crédito
  const sem: number[] = [], comR: number[] = [], comC: number[] = [];
  const resgatadoAcum: number[] = [], creditoAcum: number[] = [], entAcum: number[] = [], saiAcum: number[] = [];
  let saldoSem = inicialC, fluxo = 0, entTot = 0, saiTot = 0, resgatado = 0, credito = 0;

  for (let i = 0; i < maxDias; i++) {
    const data = somarDias(e.dataBase, i);
    const lista = porDia.get(data) ?? [];
    const entC = lista.filter((m) => m.tipo === "entrada").reduce((s, m) => s + cent(m.valor), 0);
    const saiC = lista.filter((m) => m.tipo === "saida").reduce((s, m) => s + cent(m.valor), 0);
    const iniDia = saldoSem;
    saldoSem += entC - saiC;
    fluxo += entC - saiC;
    entTot += entC; saiTot += saiC;

    // 1) resgates, só se há déficit e a aplicação já está disponível na data
    const resgatesDoDia: DiaProjetado["resgatesDoDia"] = [];
    let deficit = validado ? Math.max(0, -(saldoSem + resgatado)) : 0;
    for (const a of apps) {
      if (deficit <= 0) break;
      if (a.dataDisponivel > data || a.restanteC <= 0) continue;
      let tomar = a.parcial ? Math.min(a.restanteC, deficit) : a.restanteC;
      const minimoC = cent(a.valorMinimo);
      if (a.parcial && minimoC > 0 && tomar < minimoC) {
        if (a.restanteC < minimoC) continue;
        tomar = minimoC;
      }
      a.restanteC -= tomar; resgatado += tomar; deficit -= tomar;
      resgatesDoDia.push({ id: a.id, rotulo: a.rotulo, valor: reais(tomar) });
    }
    // 2) crédito da Conta Garantida cobre o que sobrou (nunca passa do limite)
    let creditoDoDia = 0;
    if (validado && deficit > 0 && limiteRestC > 0) {
      creditoDoDia = Math.min(deficit, limiteRestC);
      limiteRestC -= creditoDoDia; credito += creditoDoDia;
    }

    sem.push(saldoSem); comR.push(saldoSem + resgatado); comC.push(saldoSem + resgatado + credito);
    resgatadoAcum.push(resgatado); creditoAcum.push(credito); entAcum.push(entTot); saiAcum.push(saiTot);
    dias.push({
      data, entradas: reais(entC), saidas: reais(saiC), saldoInicial: validado ? reais(iniDia) : null, saldoFinal: validado ? reais(saldoSem) : null,
      fluxoAcumulado: reais(fluxo), movimentos: lista, resgatesDoDia, creditoDoDia: reais(creditoDoDia),
    });
  }

  const cenario = (serie: number[], n: number): CenarioHorizonte | null => {
    if (!validado || n === 0) return null;
    const prefixo = serie.slice(0, n);
    // o saldo de abertura também é candidato a "menor saldo" (conta já negativa, ou sem movimento que a melhore)
    let menor = inicialC, quando = e.dataBase;
    prefixo.forEach((s, i) => { if (s < menor) { menor = s; quando = somarDias(e.dataBase, i); } });
    const final = prefixo[n - 1];
    return {
      saldoFinal: reais(final), menorSaldo: reais(menor), dataMenorSaldo: quando,
      necessidadeMaxima: reais(Math.max(0, -menor)), necessidadeFinal: reais(Math.max(0, -final)), sobraFinal: reais(Math.max(0, final)),
    };
  };

  const reservaPendente = e.reservaMinima === null || e.reservaMinima === undefined;
  const resultadoHorizontes: ResultadoHorizonte[] = horizontes.map((n) => {
    const idx = Math.min(n, maxDias) - 1;
    const s = cenario(sem, n), r = cenario(comR, n), c = cenario(comC, n);
    const menorSem = s?.menorSaldo ?? null;
    let alerta: Alerta;
    if (!validado) alerta = "nao_validado";
    else if ((menorSem as number) < 0) alerta = "vermelho";
    else if (reservaPendente) alerta = "reserva_pendente";
    else alerta = (menorSem as number) < (e.reservaMinima as number) ? "amarelo" : "verde";
    return {
      dias: n, dataFim: somarDias(e.dataBase, n - 1), entradas: reais(entAcum[idx] ?? 0), saidas: reais(saiAcum[idx] ?? 0),
      semResgates: s, comResgates: r, comCredito: c,
      usoResgates: reais(resgatadoAcum[idx] ?? 0), usoCredito: reais(creditoAcum[idx] ?? 0),
      capitalExterno: validado ? reais(Math.max(0, -(comC[idx] ?? 0))) : 0,
      alerta,
    };
  });

  // dias críticos: saldo só do caixa negativo (o que a Controladoria precisa cobrir)
  const diasCriticos: DiaCritico[] = [];
  if (validado) {
    dias.forEach((d, i) => {
      if (sem[i] >= 0) return;
      const disponivelC = (e.aplicacoes ?? []).filter((a) => a.dataDisponivel <= d.data).reduce((s, a) => s + cent(a.valorLiquido), 0);
      const deficitC = -sem[i];
      diasCriticos.push({
        data: d.data, saldoFinal: reais(sem[i]), deficit: reais(deficitC),
        pagamentos: d.movimentos.filter((m) => m.tipo === "saida").sort((a, b) => b.valor - a.valor).slice(0, 5),
        entradasAcumuladas: reais(entAcum[i]), resgatavelAteAData: reais(disponivelC), deficitAposResgates: reais(Math.max(0, deficitC - disponivelC)),
      });
    });
  }

  return {
    dataBase: e.dataBase, validado, reservaPendente, dias, horizontes: resultadoHorizontes, diasCriticos, vencidos,
    totalVencidos: round2(vencidos.reduce((s, m) => s + (m.tipo === "saida" ? m.valor : 0), 0)),
  };
}
