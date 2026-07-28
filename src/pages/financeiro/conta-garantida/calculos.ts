// Porta fiel do motor de cálculo do sistema legado "Conta Garantida"
// (_calcular_financeiro / _obter_cdi_diario, Flask/pandas standalone) —
// mesma lógica de acúmulo dia-a-dia de dívida de cheque especial e
// rendimento de aplicação, indexados a taxa fixa mensal e/ou %CDI.

export interface MovimentoInput {
  data: string; // YYYY-MM-DD
  banco: string;
  tipo: string;
  classificacao: string;
  valor: number;
}

export interface BancoConfig {
  taxa_mensal: number; // % ao mês (ex: 2.15)
  perc_cdi: number; // % do CDI (ex: 95)
}

export interface RegistroCalculado {
  data: string;
  banco: string;
  tipo: string;
  classificacao: string;
  valor: number;
  saldoDevedor: number;
  saldoAplicado: number;
  dias: number;
  jurosPendente: number;
  jurosPeriodo: number;
  valorPegoDivida: number;
  rendimentoPeriodo: number;
}

const CDI_FALLBACK = 0.000401;

/** Busca o CDI do dia, andando pra trás até 15 dias se não encontrar (igual ao legado). */
export function obterCdiDiario(data: Date, cdiPorData: Record<string, number>): number {
  const d = new Date(data);
  for (let i = 0; i < 15; i++) {
    const chave = d.toISOString().slice(0, 10);
    if (chave in cdiPorData) return cdiPorData[chave];
    d.setDate(d.getDate() - 1);
  }
  return CDI_FALLBACK;
}

function diasEntre(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

export function calcularContaGarantida(
  movimentos: MovimentoInput[],
  bancosConfig: Record<string, BancoConfig>,
  cdiPorData: Record<string, number>,
  bancosExcluidos: Set<string>
): RegistroCalculado[] {
  const excluidos = new Set([...bancosExcluidos].map((b) => b.toUpperCase()));
  excluidos.add("CAIXA CANAÃ");
  excluidos.add("CAIXA CANAA");

  const porBanco = new Map<string, MovimentoInput[]>();
  for (const m of movimentos) {
    const banco = m.banco.trim().toUpperCase();
    if (excluidos.has(banco)) continue;
    const arr = porBanco.get(banco) ?? [];
    arr.push(m);
    porBanco.set(banco, arr);
  }

  const registros: RegistroCalculado[] = [];

  for (const [banco, linhasBanco] of porBanco) {
    const linhas = [...linhasBanco].sort((a, b) => a.data.localeCompare(b.data));
    const cfg = bancosConfig[banco] ?? { taxa_mensal: 0, perc_cdi: 0 };

    let saldoDivida = 0;
    let saldoJuros = 0;
    let saldoAplic = 0;

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      const dt = new Date(linha.data + "T00:00:00");
      const prox = i < linhas.length - 1 ? new Date(linhas[i + 1].data + "T00:00:00") : new Date();
      const dias = diasEntre(dt, prox);

      const taxaD = cfg.taxa_mensal > 0 ? (1 + cfg.taxa_mensal / 100) ** (1 / 30) - 1 : 0;
      const valor = Math.abs(linha.valor);
      const desc = linha.classificacao.toUpperCase();
      const tipo = linha.tipo.toUpperCase();
      const isInvest = desc.includes("APLICAÇÃO") || desc.includes("APLICACAO");
      const isJuros = desc.includes("JURO");
      const isRend = desc.includes("RENDIMENTO");
      let valorPego = 0;

      if (isInvest) {
        if (tipo.includes("SAÍDA") || tipo.includes("SAIDA")) {
          saldoAplic += valor;
        } else {
          saldoAplic -= valor;
          if (saldoAplic < 0) saldoAplic = 0;
        }
      } else if (!isJuros && !isRend) {
        if (tipo.includes("SAÍDA") || tipo.includes("SAIDA") || desc.includes("AMORTIZAÇÃO")) {
          saldoDivida -= valor;
          if (saldoDivida < 0) {
            const sobra = Math.abs(saldoDivida);
            saldoDivida = 0;
            saldoJuros -= sobra;
            if (saldoJuros < 0) saldoJuros = 0;
          }
        } else {
          saldoDivida += valor;
          valorPego = valor;
        }
      }

      const cdiD = obterCdiDiario(dt, cdiPorData);
      const perc = cfg.perc_cdi / 100;
      let taxaFinal = taxaD;
      if (!isInvest && perc > 0) {
        taxaFinal = (1 + taxaD) * (1 + cdiD * perc) - 1;
      }

      let jurosP = 0;
      let rendP = 0;
      if (saldoDivida > 0 && dias > 0 && taxaFinal > 0) {
        jurosP = saldoDivida * ((1 + taxaFinal) ** dias - 1);
        saldoJuros += jurosP;
      }
      if (saldoAplic > 0 && dias > 0 && perc > 0) {
        rendP = saldoAplic * ((1 + cdiD * perc) ** dias - 1);
      }

      registros.push({
        data: linha.data,
        banco,
        tipo: linha.tipo,
        classificacao: linha.classificacao,
        valor,
        saldoDevedor: saldoDivida,
        saldoAplicado: saldoAplic,
        dias,
        jurosPendente: saldoJuros,
        jurosPeriodo: jurosP,
        valorPegoDivida: valorPego,
        rendimentoPeriodo: rendP,
      });
    }
  }

  return registros.sort((a, b) => a.data.localeCompare(b.data));
}

export interface KpisContaGarantida {
  divida: number;
  jurosPendentes: number;
  jurosPagos: number;
  totalPagar: number;
  aplicado: number;
  rendPrevisto: number;
  rendPago: number;
  limiteDisponivel: number;
}

/** Replica api_dashboard: pega o último registro de cada banco (saldo corrente). */
function ultimoPorBanco(registros: RegistroCalculado[]): RegistroCalculado[] {
  const ultimo = new Map<string, RegistroCalculado>();
  for (const r of registros) ultimo.set(r.banco, r);
  return [...ultimo.values()];
}

export function calcularKpis(
  registros: RegistroCalculado[],
  bancosConfig: Record<string, { limite: number }>
): KpisContaGarantida {
  const last = ultimoPorBanco(registros);
  const divida = last.reduce((s, r) => s + r.saldoDevedor, 0);
  const jurosPendentes = last.reduce((s, r) => s + r.jurosPendente, 0);
  const jurosPagos = registros.filter((r) => r.classificacao.toUpperCase().includes("JURO")).reduce((s, r) => s + r.valor, 0);
  const aplicado = last.reduce((s, r) => s + r.saldoAplicado, 0);
  const rendPrevisto = registros.reduce((s, r) => s + r.rendimentoPeriodo, 0);
  const rendPago = registros.filter((r) => r.classificacao.toUpperCase().includes("RENDIMENTO")).reduce((s, r) => s + r.valor, 0);
  const limiteTotal = Object.values(bancosConfig).reduce((s, b) => s + b.limite, 0);
  return {
    divida,
    jurosPendentes,
    jurosPagos,
    totalPagar: divida + jurosPendentes,
    aplicado,
    rendPrevisto,
    rendPago,
    limiteDisponivel: limiteTotal - divida,
  };
}

function mesLabel(mesAno: string): string {
  const [ano, mes] = mesAno.split("-");
  const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}

export function diasNoChequePorMes(registros: RegistroCalculado[]): { mes: string; dias: number }[] {
  const diasPorMes = new Map<string, Set<string>>();
  for (const r of registros) {
    if (r.saldoDevedor <= 0) continue;
    const mes = r.data.slice(0, 7);
    const set = diasPorMes.get(mes) ?? new Set<string>();
    set.add(r.data);
    diasPorMes.set(mes, set);
  }
  return [...diasPorMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([mes, set]) => ({ mes: mesLabel(mes), dias: set.size }));
}

export function dividaVsAplicadoPorData(registros: RegistroCalculado[]): { data: string; divida: number; aplicado: number }[] {
  const porData = new Map<string, { divida: number; aplicado: number }>();
  for (const r of registros) {
    const cur = porData.get(r.data) ?? { divida: 0, aplicado: 0 };
    cur.divida = Math.max(cur.divida, r.saldoDevedor);
    cur.aplicado = Math.max(cur.aplicado, r.saldoAplicado);
    porData.set(r.data, cur);
  }
  return [...porData.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-120)
    .map(([data, v]) => ({ data: `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(2, 4)}`, ...v }));
}

export function distribuicaoPorBanco(registros: RegistroCalculado[]): { banco: string; valor: number }[] {
  const last = ultimoPorBanco(registros);
  return last
    .filter((r) => r.saldoDevedor > 0)
    .map((r) => ({ banco: r.banco, valor: r.saldoDevedor }))
    .sort((a, b) => b.valor - a.valor);
}

export function jurosPagosPorMes(registros: RegistroCalculado[]): { mes: string; valor: number }[] {
  const porMes = new Map<string, number>();
  for (const r of registros) {
    const desc = r.classificacao.toUpperCase();
    if (!desc.includes("JURO") || desc.includes("RENDIMENTO")) continue;
    const mes = r.data.slice(0, 7);
    porMes.set(mes, (porMes.get(mes) ?? 0) + r.valor);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([mes, valor]) => ({ mes: mesLabel(mes), valor }));
}
