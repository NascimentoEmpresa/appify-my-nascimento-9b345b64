// SIS-2026-0798: regras puras da Conta Garantida nativa (sem tela, sem banco). A mesma conta que a RPC conta_garantida_validar_saldo faz no servidor
// é feita aqui para avisar antes de enviar; o servidor continua sendo quem decide.
//
// Modelo: resgate = utilização do limite (aumenta o saldo devedor e ENTRA no banco); amortização = devolução (reduz o saldo, SAI do banco);
// juros = encargo pago (SAI do banco, não mexe no saldo devedor). Estornado não conta em nada.

export type TipoMovimento = "resgate" | "amortizacao" | "juros";
export type StatusConta = "ativa" | "encerrada";

export interface ContaGarantida {
  id: string;
  numero: string;
  empresa_id: string;
  banco_id: string;
  conta_banco_id: string | null;
  conta: string;
  limite: number;
  taxa: string | null;
  vencimento: string | null;
  status: StatusConta;
  observacao: string | null;
}

export interface MovimentoContaGarantida {
  id: string;
  seq: number;
  numero: string;
  conta_garantida_id: string;
  tipo: TipoMovimento;
  data_movimento: string; // YYYY-MM-DD
  valor: number;
  classificacao_id: string | null;
  observacao: string | null;
  cancelado_em: string | null;
  motivo_cancelamento: string | null;
  // Veio do Fluxo de Caixa já existente (carga do passado): conta na Conta Garantida, mas não gera linha nova no Fluxo.
  historico?: boolean;
  created_at: string;
}

export const ROTULO_TIPO: Record<TipoMovimento, string> = {
  resgate: "Resgate",
  amortizacao: "Amortização",
  juros: "Juros",
};

const arred = (n: number) => Math.round(n * 100) / 100;

export const estaAtivo = (m: Pick<MovimentoContaGarantida, "cancelado_em">) => !m.cancelado_em;

/** Efeito do lançamento no saldo devedor. */
export function deltaDoMovimento(m: Pick<MovimentoContaGarantida, "tipo" | "valor">): number {
  if (m.tipo === "resgate") return m.valor;
  if (m.tipo === "amortizacao") return -m.valor;
  return 0;
}

/** Ordem cronológica de verdade: data e, no mesmo dia, a ordem em que foi lançado. */
export const porCronologia = (a: Pick<MovimentoContaGarantida, "data_movimento" | "seq">, b: Pick<MovimentoContaGarantida, "data_movimento" | "seq">) =>
  a.data_movimento.localeCompare(b.data_movimento) || a.seq - b.seq;

/** Saldo devedor atual de cada conta (só lançamentos não estornados). */
export function saldoPorConta(movimentos: MovimentoContaGarantida[]): Map<string, number> {
  const saldos = new Map<string, number>();
  for (const m of movimentos) {
    if (!estaAtivo(m)) continue;
    saldos.set(m.conta_garantida_id, arred((saldos.get(m.conta_garantida_id) ?? 0) + deltaDoMovimento(m)));
  }
  return saldos;
}

export type MovimentoComSaldo = MovimentoContaGarantida & { saldoApos: number | null };

/** Cada lançamento com o saldo da conta logo depois dele. Estornado fica com saldoApos nulo (não entrou na conta). Saída: do mais recente para o mais antigo. */
export function movimentosComSaldo(movimentos: MovimentoContaGarantida[]): MovimentoComSaldo[] {
  const saldos = new Map<string, number>();
  const cronologicos = [...movimentos].sort(porCronologia);
  const comSaldo = cronologicos.map((m) => {
    if (!estaAtivo(m)) return { ...m, saldoApos: null };
    const novo = arred((saldos.get(m.conta_garantida_id) ?? 0) + deltaDoMovimento(m));
    saldos.set(m.conta_garantida_id, novo);
    return { ...m, saldoApos: novo };
  });
  return comSaldo.reverse();
}

export interface SimulacaoLancamento {
  saldoAtual: number;
  saldoDepois: number;
  disponivelDepois: number;
  /** Texto do problema (mesmas regras da RPC) ou null se o lançamento passa. */
  erro: string | null;
}

/**
 * Simula um lançamento novo sobre os lançamentos da conta e confere a linha do tempo inteira (vale para data passada): o saldo não pode ficar
 * negativo em nenhuma data nem passar do limite. `seqNovo` é maior que todos (o lançamento novo é sempre o último do dia).
 */
export function simularLancamento(
  limite: number,
  movimentosDaConta: MovimentoContaGarantida[],
  novo: { tipo: TipoMovimento; data: string; valor: number },
): SimulacaoLancamento {
  const ativos = movimentosDaConta.filter(estaAtivo);
  const saldoAtual = arred(ativos.reduce((s, m) => s + deltaDoMovimento(m), 0));
  const delta = deltaDoMovimento({ tipo: novo.tipo, valor: novo.valor });
  const saldoDepois = arred(saldoAtual + delta);
  const seqNovo = ativos.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
  const linha = [...ativos, { tipo: novo.tipo, valor: novo.valor, data_movimento: novo.data, seq: seqNovo } as MovimentoContaGarantida].sort(porCronologia);

  let corrente = 0;
  let min = 0;
  let max = 0;
  for (const m of linha) {
    corrente = arred(corrente + deltaDoMovimento(m));
    // O histórico (carga do Fluxo) acumula no saldo mas não entra na conferência, igual à RPC: o passado pode ter passado do limite.
    if (m.historico) continue;
    min = Math.min(min, corrente);
    max = Math.max(max, corrente);
  }

  let erro: string | null = null;
  if (!(novo.valor > 0)) erro = "Informe um valor maior que zero.";
  else if (min < 0) erro = novo.tipo === "amortizacao" && saldoDepois < 0
    ? "A amortização não pode ser maior que o saldo devedor da conta."
    : "O lançamento deixaria o saldo devedor negativo em alguma data.";
  else if (max > limite) erro = "A operação excede o limite disponível da conta.";

  return { saldoAtual, saldoDepois, disponivelDepois: arred(limite - saldoDepois), erro };
}

export interface ResumoConta {
  conta: ContaGarantida;
  saldo: number;
  disponivel: number;
  utilizacaoPct: number;
}

export function resumoDasContas(contas: ContaGarantida[], movimentos: MovimentoContaGarantida[]): ResumoConta[] {
  const saldos = saldoPorConta(movimentos);
  return contas.map((conta) => {
    const saldo = saldos.get(conta.id) ?? 0;
    return { conta, saldo, disponivel: arred(conta.limite - saldo), utilizacaoPct: conta.limite > 0 ? Math.min(100, (saldo / conta.limite) * 100) : 0 };
  });
}

export interface FiltrosMovimento {
  de: string;
  ate: string;
  tipo: TipoMovimento | "";
}

/** Lançamentos das contas visíveis, dentro do período e do tipo escolhidos. */
export function filtrarMovimentos(movimentos: MovimentoComSaldo[], idsDasContas: Set<string>, f: FiltrosMovimento): MovimentoComSaldo[] {
  return movimentos.filter(
    (m) =>
      idsDasContas.has(m.conta_garantida_id) &&
      (!f.tipo || m.tipo === f.tipo) &&
      (!f.de || m.data_movimento >= f.de) &&
      (!f.ate || m.data_movimento <= f.ate),
  );
}

export interface KpisCarteira {
  limite: number;
  utilizado: number;
  disponivel: number;
  utilizadoPct: number;
  amortizado: number;
  juros: number;
}

/**
 * Limite, utilizado e disponível: contas ATIVAS entre as visíveis, saldo de hoje. Amortizado e juros: lançamentos não estornados das contas visíveis
 * (amortizado respeita o período do filtro; juros é o acumulado).
 */
export function kpisDaCarteira(resumos: ResumoConta[], movimentos: MovimentoContaGarantida[], periodo: { de: string; ate: string }): KpisCarteira {
  const ativas = resumos.filter((r) => r.conta.status === "ativa");
  const limite = arred(ativas.reduce((s, r) => s + r.conta.limite, 0));
  const utilizado = arred(ativas.reduce((s, r) => s + r.saldo, 0));
  const ids = new Set(resumos.map((r) => r.conta.id));
  const doPeriodo = (m: MovimentoContaGarantida) => (!periodo.de || m.data_movimento >= periodo.de) && (!periodo.ate || m.data_movimento <= periodo.ate);
  const validos = movimentos.filter((m) => estaAtivo(m) && ids.has(m.conta_garantida_id));
  return {
    limite,
    utilizado,
    disponivel: arred(limite - utilizado),
    utilizadoPct: limite > 0 ? (utilizado / limite) * 100 : 0,
    amortizado: arred(validos.filter((m) => m.tipo === "amortizacao" && doPeriodo(m)).reduce((s, m) => s + m.valor, 0)),
    juros: arred(validos.filter((m) => m.tipo === "juros").reduce((s, m) => s + m.valor, 0)),
  };
}

export interface PontoBanco {
  banco: string;
  utilizado: number;
  disponivel: number;
}

/** Utilizado e disponível por banco (contas ativas). */
export function agruparPorBanco(resumos: ResumoConta[], nomeDoBanco: (bancoId: string) => string): PontoBanco[] {
  const mapa = new Map<string, PontoBanco>();
  for (const r of resumos) {
    if (r.conta.status !== "ativa") continue;
    const nome = nomeDoBanco(r.conta.banco_id);
    const atual = mapa.get(nome) ?? { banco: nome, utilizado: 0, disponivel: 0 };
    atual.utilizado = arred(atual.utilizado + r.saldo);
    atual.disponivel = arred(atual.disponivel + Math.max(0, r.disponivel));
    mapa.set(nome, atual);
  }
  return [...mapa.values()].sort((a, b) => b.utilizado - a.utilizado);
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export interface PontoMes {
  mes: string;
  resgates: number;
  amortizacoes: number;
}

/** Resgates e amortizações por mês (últimos `limite` meses com movimento). */
export function movimentosPorMes(movimentos: MovimentoContaGarantida[], limite = 8): PontoMes[] {
  const porMes = new Map<string, PontoMes>();
  for (const m of movimentos) {
    if (!estaAtivo(m) || m.tipo === "juros") continue;
    const chave = m.data_movimento.slice(0, 7);
    const [ano, mes] = chave.split("-");
    const ponto = porMes.get(chave) ?? { mes: `${MESES[Number(mes) - 1]}/${ano.slice(2)}`, resgates: 0, amortizacoes: 0 };
    if (m.tipo === "resgate") ponto.resgates = arred(ponto.resgates + m.valor);
    else ponto.amortizacoes = arred(ponto.amortizacoes + m.valor);
    porMes.set(chave, ponto);
  }
  return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-limite).map(([, p]) => p);
}

/** Dias até o vencimento (negativo = vencida). Nulo sem vencimento. */
export function diasParaVencer(vencimento: string | null, hoje = new Date()): number | null {
  if (!vencimento) return null;
  const alvo = new Date(`${vencimento}T00:00:00`);
  const ref = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo.getTime() - ref.getTime()) / 86400000);
}
