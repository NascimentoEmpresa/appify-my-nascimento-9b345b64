import { describe, expect, it } from "vitest";
import type { AplicacaoFinanceiraLinha, AplicacaoFinanceiraResgateCaixa } from "@/hooks/useAplicacaoFinanceira";
import type { ContaGarantida, MovimentoContaGarantida } from "@/pages/financeiro/conta-garantida/regras";
import { detalheAplicacoes, diasAte, emprestimosPorInstituicao, fluxoPorNatureza, situacaoDoVencimento, totaisEmprestimos } from "@/pages/financeiro/fluxo-caixa-gerencial/emprestimosAplicacoes";

// SIS-2026-XXXX (etapa 4): empréstimos por instituição, aplicações e fluxo por natureza.
const conta = (p: Partial<ContaGarantida>): ContaGarantida => ({ id: "c1", numero: "CG-1", empresa_id: "e1", banco_id: "b1", conta_banco_id: null, conta: "119", limite: 1_000_000, taxa: "CDI + 2%", vencimento: "2026-12-15", status: "ativa", observacao: null, ...p });
let seq = 0;
const mov = (p: Partial<MovimentoContaGarantida>): MovimentoContaGarantida => ({
  id: `m${++seq}`, seq, numero: `M${seq}`, conta_garantida_id: "c1", tipo: "resgate", data_movimento: "2026-11-05", valor: 100, classificacao_id: null, observacao: null,
  cancelado_em: null, motivo_cancelamento: null, created_at: "2026-11-05", ...p,
});
const banco = (id: string) => (id === "b1" ? "Sicredi" : "Banrisul");
const F = { ini: "2026-11-01", fim: "2026-11-30", empresaId: "" };
const REF = "2026-12-01";

describe("empréstimos por instituição (Conta Garantida)", () => {
  const contas = [conta({}), conta({ id: "c2", numero: "CG-2", banco_id: "b2", conta: "55", limite: 500_000, vencimento: "2026-11-20" }), conta({ id: "c3", numero: "CG-3", banco_id: "b1", conta: "77", limite: 200_000, vencimento: null })];
  const movs = [
    mov({ valor: 600_000, data_movimento: "2026-10-10" }), mov({ tipo: "amortizacao", valor: 100_000, data_movimento: "2026-11-10" }), mov({ tipo: "juros", valor: 8_000, data_movimento: "2026-11-12" }),
    mov({ conta_garantida_id: "c2", valor: 300_000, data_movimento: "2026-11-03" }),
    mov({ conta_garantida_id: "c2", valor: 999, data_movimento: "2026-11-04", cancelado_em: "2026-11-05" }), // estornado: não conta
  ];
  const r = emprestimosPorInstituicao(contas, movs, banco, F, REF);

  it("saldo devedor = resgates − amortizações (estornado fica de fora); juros não mexem no saldo", () => {
    const c1 = r.contas.find((c) => c.contaId === "c1")!;
    expect(c1.utilizado).toBe(500_000);
    expect(c1.disponivel).toBe(500_000);
    expect(c1.pctUtilizado).toBe(0.5);
    expect(r.contas.find((c) => c.contaId === "c2")!.utilizado).toBe(300_000);
  });

  it("movimentos do período: utilização, amortização e juros separados", () => {
    const c1 = r.contas.find((c) => c.contaId === "c1")!;
    expect(c1).toMatchObject({ utilizacoesNoPeriodo: 0, amortizacoesNoPeriodo: 100_000, jurosNoPeriodo: 8_000, jurosTotal: 8_000 });
    expect(r.contas.find((c) => c.contaId === "c2")!.utilizacoesNoPeriodo).toBe(300_000);
  });

  it("agrupa por instituição (duas contas do Sicredi somam; o Banrisul fica à parte)", () => {
    const sic = r.instituicoes.find((i) => i.instituicao === "Sicredi")!;
    expect(sic).toMatchObject({ contas: 2, limite: 1_200_000, utilizado: 500_000, disponivel: 700_000, jurosNoPeriodo: 8_000 });
    expect(r.instituicoes.find((i) => i.instituicao === "Banrisul")!.utilizado).toBe(300_000);
  });

  it("vencimento: vencida, vence em 30 dias, no prazo e sem vencimento", () => {
    const sit = (id: string) => r.contas.find((c) => c.contaId === id)!.situacaoVencimento;
    expect(sit("c2")).toBe("vencida"); // 20/11 < 01/12
    expect(sit("c1")).toBe("vence_30"); // 15/12
    expect(sit("c3")).toBe("sem_vencimento");
    expect(situacaoDoVencimento(31)).toBe("no_prazo");
    expect(diasAte("2026-12-15", REF)).toBe(14);
  });

  it("totais só das contas ativas (encerrada aparece na lista mas não soma)", () => {
    const comEncerrada = emprestimosPorInstituicao([...contas, conta({ id: "c4", numero: "CG-4", status: "encerrada", limite: 9_999_999 })], movs, banco, F, REF);
    expect(totaisEmprestimos(comEncerrada.contas)).toMatchObject({ limite: 1_700_000, utilizado: 800_000, disponivel: 900_000, jurosNoPeriodo: 8_000 });
    expect(comEncerrada.contas).toHaveLength(4);
  });

  it("filtro por empresa", () => {
    expect(emprestimosPorInstituicao(contas, movs, banco, { ...F, empresaId: "e2" }, REF).contas).toHaveLength(0);
  });
});

describe("detalhe das aplicações", () => {
  const ap = (p: Partial<AplicacaoFinanceiraLinha>) => ({
    id: "a1", numero: "AP-1", data_aplicacao: "2026-09-01", empresa_id: "e1", banco_nome: "Sicredi", produto: "CDB", descricao: "CDB 100% CDI", valor_aplicado: 500_000, rendimento_acumulado: 20_000,
    total_principal_resgatado: 100_000, total_rendimento_resgatado: 5_000, saldo_atual: 415_000, data_vencimento: "2027-03-01", liquidez: "D+1", status: "ativa", ...p,
  } as unknown as AplicacaoFinanceiraLinha);

  it("mostra aplicado, rendimento, resgatado e saldo atual por aplicação e por instituição", () => {
    const r = detalheAplicacoes([ap({}), ap({ id: "a2", numero: "AP-2", banco_nome: "Banrisul", valor_aplicado: 100_000, rendimento_acumulado: 1_000, total_principal_resgatado: 0, total_rendimento_resgatado: 0, saldo_atual: 101_000 })], F, REF);
    expect(r.linhas[0]).toMatchObject({ numero: "AP-1", saldoAtual: 415_000, resgatadoPrincipal: 100_000, liquidez: "D+1" });
    expect(r.instituicoes.find((i) => i.instituicao === "Sicredi")).toMatchObject({ valorAplicado: 500_000, rendimento: 20_000, resgatado: 105_000, saldoAtual: 415_000 });
    expect(r.instituicoes[0].instituicao).toBe("Sicredi");
  });

  it("dias para o vencimento e filtro de empresa", () => {
    const r = detalheAplicacoes([ap({}), ap({ id: "a3", empresa_id: "e2" })], { ...F, empresaId: "e1" }, REF);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].diasParaVencer).toBe(90);
  });
});

describe("fluxo por natureza, mês a mês", () => {
  const contas = [conta({})];
  const movs = [mov({ valor: 600_000, data_movimento: "2026-10-10" }), mov({ valor: 200_000, data_movimento: "2026-11-05" }), mov({ tipo: "amortizacao", valor: 100_000, data_movimento: "2026-11-25" }), mov({ tipo: "juros", valor: 9_000, data_movimento: "2026-11-12" })];
  const aplicacoes = [{ id: "a1", empresa_id: "e1", data_aplicacao: "2026-11-02", valor_aplicado: 300_000 }] as unknown as AplicacaoFinanceiraLinha[];
  const resgates = [{ id: "r1", empresa_id: "e1", data_resgate: "2026-11-20", valor_principal: 50_000, valor_rendimento: 2_000 }] as unknown as AplicacaoFinanceiraResgateCaixa[];
  const r = fluxoPorNatureza({
    meses: ["2026-10", "2026-11"], recebidoPorMes: new Map([["2026-11", 800_000]]), despesasPorMes: new Map([["2026-10", 100_000], ["2026-11", 900_000]]),
    contas, movimentos: movs, aplicacoes, resgates, historico: [], empresaId: "",
  });
  const nov = r[1];

  it("operacional: só recebimentos e despesas; empréstimo e aplicação não entram no resultado operacional", () => {
    expect(nov.recebimentosOperacionais).toBe(800_000);
    expect(nov.despesasOperacionais).toBe(900_000);
    expect(nov.resultadoOperacional).toBe(-100_000);
  });
  it("empréstimo: utilização, amortização, juros e saldo devedor no fim do mês", () => {
    expect(nov).toMatchObject({ emprestimoUtilizado: 200_000, emprestimoAmortizado: 100_000, jurosPagos: 9_000, saldoDevedorFim: 700_000 });
    expect(r[0].saldoDevedorFim).toBe(600_000);
  });
  it("aplicações: aplicado, resgatado e rendimento do mês", () => {
    expect(nov).toMatchObject({ aplicado: 300_000, resgatadoAplicacoes: 50_000, rendimentos: 2_000 });
    expect(r[0]).toMatchObject({ aplicado: 0, resgatadoAplicacoes: 0, rendimentos: 0 });
  });
  it("mês sem dado vem zerado (nunca some da série)", () => {
    expect(r[0].recebimentosOperacionais).toBe(0);
    expect(r).toHaveLength(2);
  });
});
