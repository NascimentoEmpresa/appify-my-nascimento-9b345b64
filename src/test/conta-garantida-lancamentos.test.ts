import { describe, expect, it } from "vitest";
import {
  agruparPorBanco, filtrarMovimentos, kpisDaCarteira, movimentosComSaldo, movimentosPorMes, resumoDasContas, saldoPorConta, simularLancamento,
  type ContaGarantida, type MovimentoContaGarantida,
} from "@/pages/financeiro/conta-garantida/regras";

// SIS-2026-0798: resgate aumenta o saldo devedor, amortização reduz, juros não mexe; estornado não conta; histórico acumula mas não trava a conferência.
const conta = (o: Partial<ContaGarantida> = {}): ContaGarantida => ({
  id: "c1", numero: "CG-2026-0001", empresa_id: "HAGG", banco_id: "bb", conta_banco_id: null, conta: "1", limite: 1000, taxa: null, vencimento: null, status: "ativa", observacao: null, ...o,
});
let seq = 0;
const mov = (tipo: MovimentoContaGarantida["tipo"], valor: number, data: string, o: Partial<MovimentoContaGarantida> = {}): MovimentoContaGarantida => ({
  id: `m${++seq}`, seq, numero: `CGM-${seq}`, conta_garantida_id: "c1", tipo, data_movimento: data, valor, classificacao_id: "k", observacao: null,
  cancelado_em: null, motivo_cancelamento: null, created_at: data, ...o,
});

describe("saldo da conta", () => {
  it("resgate soma, amortização subtrai, juros não mexe", () => {
    const ms = [mov("resgate", 500, "2026-01-02"), mov("amortizacao", 200, "2026-01-05"), mov("juros", 30, "2026-01-31")];
    expect(saldoPorConta(ms).get("c1")).toBe(300);
  });
  it("estornado não conta", () => {
    const ms = [mov("resgate", 500, "2026-01-02"), mov("resgate", 100, "2026-01-03", { cancelado_em: "2026-01-04" })];
    expect(saldoPorConta(ms).get("c1")).toBe(500);
  });
  it("saldo após cada movimento segue a data e, no mesmo dia, a ordem do lançamento; estornado fica sem saldo", () => {
    const ms = [mov("amortizacao", 100, "2026-01-05"), mov("resgate", 400, "2026-01-02"), mov("resgate", 50, "2026-01-05", { cancelado_em: "x" })];
    const r = movimentosComSaldo(ms);
    expect(r.map((m) => m.saldoApos)).toEqual([null, 300, 400]); // do mais recente para o mais antigo
  });
});

describe("simular um lançamento novo", () => {
  const base = [mov("resgate", 600, "2026-01-02")];
  it("resgate dentro do limite passa e mostra o saldo e o disponível depois", () => {
    const s = simularLancamento(1000, base, { tipo: "resgate", data: "2026-02-01", valor: 300 });
    expect(s).toMatchObject({ saldoAtual: 600, saldoDepois: 900, disponivelDepois: 100, erro: null });
  });
  it("resgate acima do limite é recusado", () => {
    expect(simularLancamento(1000, base, { tipo: "resgate", data: "2026-02-01", valor: 500 }).erro).toMatch(/limite/);
  });
  it("amortização maior que o saldo devedor é recusada", () => {
    expect(simularLancamento(1000, base, { tipo: "amortizacao", data: "2026-02-01", valor: 700 }).erro).toMatch(/saldo devedor/);
  });
  it("lançamento com data passada que deixaria o saldo negativo em algum dia é recusado", () => {
    // amortizar 600 em 01/01, antes do resgate de 02/01, deixaria o saldo negativo naquele dia
    expect(simularLancamento(1000, base, { tipo: "amortizacao", data: "2026-01-01", valor: 600 }).erro).toMatch(/negativo/);
  });
  it("juros não altera o saldo e sempre passa com valor positivo", () => {
    expect(simularLancamento(1000, base, { tipo: "juros", data: "2026-02-01", valor: 40 })).toMatchObject({ saldoDepois: 600, erro: null });
  });
  it("valor zero é recusado", () => {
    expect(simularLancamento(1000, base, { tipo: "resgate", data: "2026-02-01", valor: 0 }).erro).toBeTruthy();
  });
  it("estornado não pesa na conferência", () => {
    const ms = [mov("resgate", 900, "2026-01-02", { cancelado_em: "x" })];
    expect(simularLancamento(1000, ms, { tipo: "resgate", data: "2026-02-01", valor: 900 }).erro).toBeNull();
  });
  it("o histórico acumula no saldo mas não trava: pico antigo acima do limite não impede lançar", () => {
    const hist = [mov("resgate", 249950, "2026-01-06", { historico: true }), mov("amortizacao", 249950, "2026-01-21", { historico: true }), mov("resgate", 100, "2026-02-01", { historico: true })];
    const ok = simularLancamento(150000, hist, { tipo: "resgate", data: "2026-03-01", valor: 1000 });
    expect(ok.erro).toBeNull();
    expect(ok.saldoDepois).toBe(1100);
    expect(simularLancamento(150000, hist, { tipo: "resgate", data: "2026-03-01", valor: 150000 }).erro).toMatch(/limite/);
  });
});

describe("o que veio do Débito Automático não trava a conferência (igual à RPC)", () => {
  // Saldo negativo no meio do caminho só por lançamentos de origem Débito Automático (ou histórico): o servidor ignora, a tela também.
  const ms = [
    mov("resgate", 100, "2026-01-02", { historico: true }),
    mov("amortizacao", 500, "2026-02-01", { origem_debito_id: "d1" }), // deixa o acumulado em -400, mas não é conferido
    mov("resgate", 900, "2026-03-01", { origem_debito_id: "d2" }),
  ];
  it("amortizar com saldo acumulado hoje positivo passa, mesmo com negativo antigo vindo do Débito Automático", () => {
    const r = simularLancamento(1000, ms, { tipo: "amortizacao", data: "2026-04-01", valor: 300 });
    expect(r).toMatchObject({ saldoAtual: 500, saldoDepois: 200, erro: null });
  });
  it("mas o próprio lançamento da tela continua conferido: não pode deixar o saldo negativo", () => {
    expect(simularLancamento(1000, ms, { tipo: "amortizacao", data: "2026-04-01", valor: 600 }).erro).toMatch(/saldo devedor/);
  });
});

describe("carteira, KPIs e gráficos", () => {
  const c1 = conta();
  const c2 = conta({ id: "c2", numero: "CG-2026-0002", banco_id: "sicredi", limite: 3000 });
  const c3 = conta({ id: "c3", numero: "CG-2026-0003", status: "encerrada", limite: 500 });
  const ms = [
    mov("resgate", 400, "2026-01-10"),
    mov("amortizacao", 100, "2026-02-10"),
    mov("juros", 25, "2026-02-28"),
    mov("resgate", 1000, "2026-01-12", { conta_garantida_id: "c2" }),
    mov("amortizacao", 50, "2026-03-01", { conta_garantida_id: "c2", cancelado_em: "x" }),
  ];
  const resumos = resumoDasContas([c1, c2, c3], ms);

  it("utilizado e disponível por conta", () => {
    expect(resumos.map((r) => [r.saldo, r.disponivel])).toEqual([[300, 700], [1000, 2000], [0, 500]]);
  });
  it("KPIs só somam contas ativas; amortizado respeita o período; estornado fica fora", () => {
    const k = kpisDaCarteira(resumos, ms, { de: "", ate: "" });
    expect(k).toMatchObject({ limite: 4000, utilizado: 1300, disponivel: 2700, amortizado: 100, juros: 25 });
    expect(kpisDaCarteira(resumos, ms, { de: "2026-03-01", ate: "" }).amortizado).toBe(0);
  });
  it("filtra por conta, período e tipo", () => {
    const todos = movimentosComSaldo(ms);
    const r = filtrarMovimentos(todos, new Set(["c1"]), { de: "2026-02-01", ate: "", tipo: "amortizacao" });
    expect(r).toHaveLength(1);
    expect(r[0].valor).toBe(100);
  });
  it("agrupa por banco (contas ativas) e por mês (sem juros nem estornado)", () => {
    expect(agruparPorBanco(resumos, (id) => id)).toEqual([
      { banco: "sicredi", utilizado: 1000, disponivel: 2000 },
      { banco: "bb", utilizado: 300, disponivel: 700 },
    ]);
    expect(movimentosPorMes(ms)).toEqual([
      { mes: "Jan/26", resgates: 1400, amortizacoes: 0 },
      { mes: "Fev/26", resgates: 0, amortizacoes: 100 },
    ]);
  });
});
