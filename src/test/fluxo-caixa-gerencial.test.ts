import { describe, expect, it } from "vitest";
import type { NfEmissaoRow } from "@/hooks/useNfEmissao";
import type { ContaGarantida, MovimentoContaGarantida } from "@/pages/financeiro/conta-garantida/regras";
import {
  composicaoTop, emprestimosPorMes, indicadores, kpisEmprestimos, kpisNotas, mesesDoPeriodo, necessidadeDeCaixa, normalizarFluxo, notasDoPeriodo,
  periodoDoMes, saldoProjetado, serieEntradasSaidas, serieNotas, ultimos12Meses, type FiltroGerencial,
} from "@/pages/financeiro/fluxo-caixa-gerencial/regras";

const f = (p: Partial<FiltroGerencial> = {}): FiltroGerencial => ({ ini: "2026-11-01", fim: "2026-11-30", empresaId: "", contratoId: "", ...p });

const nf = (p: Partial<NfEmissaoRow>): NfEmissaoRow => ({
  id: "n1", empresa_id: "e1", contrato_id: "c1", status: "concluida", data_emissao: "2026-11-05", data_pagamento: null, valor_pago: null,
  vlr_bruto_total: 1000, vlr_liquido_total: 900, valor_contrato_exec_total: 1000, desconto_conta_vinculada: 0, situacao_site_pmt: null, situacao_dominio: null,
  ...p,
} as unknown as NfEmissaoRow);

describe("período", () => {
  it("mês corrente: do dia 1 ao último dia", () => {
    expect(periodoDoMes(new Date(2026, 1, 10))).toEqual({ ini: "2026-02-01", fim: "2026-02-28" });
    expect(periodoDoMes(new Date(2026, 10, 12))).toEqual({ ini: "2026-11-01", fim: "2026-11-30" });
  });
  it("meses do período: no mínimo 1, conta mês parcial", () => {
    expect(mesesDoPeriodo("2026-11-01", "2026-11-30")).toBe(1);
    expect(mesesDoPeriodo("2026-01-01", "2026-03-31")).toBe(3);
    expect(mesesDoPeriodo("2025-11-15", "2026-01-10")).toBe(3);
  });
  it("12 meses terminando no mês de fim, do mais antigo ao mais novo", () => {
    const m = ultimos12Meses("2026-11-30");
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2025-12");
    expect(m[11]).toBe("2026-11");
  });
});

describe("notas (Relatório de Serviços)", () => {
  it("só entram as notas emitidas no período, na empresa e no contrato filtrados", () => {
    const nfs = [nf({ id: "a" }), nf({ id: "b", data_emissao: "2026-10-30" }), nf({ id: "c", empresa_id: "e2" }), nf({ id: "d", contrato_id: "c2" })];
    expect(notasDoPeriodo(nfs, f()).map((n) => n.id)).toEqual(["a", "c", "d"]);
    expect(notasDoPeriodo(nfs, f({ empresaId: "e1" })).map((n) => n.id)).toEqual(["a", "d"]);
    expect(notasDoPeriodo(nfs, f({ contratoId: "c2" })).map((n) => n.id)).toEqual(["d"]);
  });
  it("rascunho e enviada (ainda não validadas) ficam fora", () => {
    expect(notasDoPeriodo([nf({ status: "rascunho" }), nf({ status: "enviada" })], f())).toHaveLength(0);
  });
  it("bruto, líquido, recebido e percentuais do líquido", () => {
    const k = kpisNotas([nf({ valor_pago: 600 }), nf({ id: "n2", valor_pago: 0 })], undefined);
    expect(k.qtd).toBe(2);
    expect(k.bruto).toBe(2000);
    expect(k.liquido).toBe(1800);
    expect(k.recebido).toBe(600);
    expect(k.pctRecebidoDoLiquido).toBeCloseTo(600 / 1800);
  });
  it("série de 12 meses: bruto/líquido no mês de emissão e recebido no mês de pagamento, ignorando o período", () => {
    const s = serieNotas([nf({ valor_pago: 500, data_pagamento: "2026-11-20" }), nf({ id: "n2", data_emissao: "2026-09-10" })], f());
    expect(s).toHaveLength(12);
    const nov = s.find((p) => p.mes === "2026-11")!;
    const set = s.find((p) => p.mes === "2026-09")!;
    expect(nov).toMatchObject({ bruto: 1000, liquido: 900, recebido: 500 });
    expect(set).toMatchObject({ bruto: 1000, recebido: 0 });
  });
});

describe("conta garantida (empréstimos)", () => {
  const conta = (id: string, limite: number, empresa = "e1", status: "ativa" | "encerrada" = "ativa"): ContaGarantida =>
    ({ id, numero: id, empresa_id: empresa, banco_id: "b", conta_banco_id: null, conta: "1", limite, taxa: null, vencimento: null, status, observacao: null });
  const mov = (conta_garantida_id: string, tipo: MovimentoContaGarantida["tipo"], valor: number, data = "2026-11-03", cancelado: string | null = null): MovimentoContaGarantida =>
    ({ id: Math.random().toString(), seq: 1, numero: "x", conta_garantida_id, tipo, data_movimento: data, valor, classificacao_id: null, observacao: null, cancelado_em: cancelado, motivo_cancelamento: null, created_at: "" });

  it("contratado = limite das contas ativas; saldo devedor = resgates − amortizações (estornado e juros não contam)", () => {
    const contas = [conta("c1", 3_000_000), conta("c2", 500_000, "e2"), conta("c3", 900_000, "e1", "encerrada")];
    const movs = [mov("c1", "resgate", 3_000_000), mov("c1", "amortizacao", 1_000_000), mov("c1", "juros", 50_000), mov("c1", "resgate", 200_000, "2026-11-04", "2026-11-05"), mov("c2", "resgate", 100_000)];
    expect(kpisEmprestimos(contas, movs, "")).toEqual({ contratado: 3_500_000, saldoDevedor: 2_100_000 });
    expect(kpisEmprestimos(contas, movs, "e1")).toEqual({ contratado: 3_000_000, saldoDevedor: 2_000_000 });
  });
  it("empréstimo por mês = resgates (utilização do limite) ativos, dentro dos 12 meses", () => {
    const contas = [conta("c1", 1)];
    const m = emprestimosPorMes(contas, [mov("c1", "resgate", 100, "2026-11-03"), mov("c1", "resgate", 50, "2026-11-20"), mov("c1", "amortizacao", 70), mov("c1", "resgate", 9, "2024-01-01")], "", "2026-11-30");
    expect(m.get("2026-11")).toBe(150);
    expect(m.has("2024-01")).toBe(false);
  });
});

describe("fluxo (RPC) e indicadores", () => {
  it("normaliza o jsonb (números como texto, campos ausentes)", () => {
    const r = normalizarFluxo({ despesas_pagas: "4485260.885", qtd_despesas: 752, por_mes: [{ mes: "2026-11", despesas: "10" }], projecao: { d30: { recebimentos: "89850", pagamentos: 699525 } } });
    expect(r.despesas_pagas).toBeCloseTo(4485260.885);
    expect(r.por_mes[0].despesas).toBe(10);
    expect(r.projecao.d30).toEqual({ recebimentos: 89850, pagamentos: 699525 });
    expect(r.projecao.d90).toEqual({ recebimentos: 0, pagamentos: 0 });
    expect(normalizarFluxo(null).composicao).toEqual([]);
  });
  it("composição: maiores 5 + Outras, com percentual do total", () => {
    const c = composicaoTop([{ nome: "A", valor: 50 }, { nome: "B", valor: 20 }, { nome: "C", valor: 10 }, { nome: "D", valor: 8 }, { nome: "E", valor: 6 }, { nome: "F", valor: 4 }, { nome: "G", valor: 2 }], 5);
    expect(c.map((x) => x.nome)).toEqual(["A", "B", "C", "D", "E", "Outras"]);
    expect(c[5].valor).toBe(6);
    expect(c[0].pct).toBeCloseTo(0.5);
    expect(composicaoTop([], 5)).toEqual([]);
  });
  it("entradas × saídas: recebido + empréstimos do mês contra as despesas do mês", () => {
    const notas = [{ mes: "2026-11", bruto: 0, liquido: 0, recebido: 100 }, { mes: "2026-12", bruto: 0, liquido: 0, recebido: 0 }];
    const s = serieEntradasSaidas(notas, new Map([["2026-11", 40]]), [{ mes: "2026-11", despesas: 90 }]);
    expect(s).toEqual([{ mes: "2026-11", entradas: 140, saidas: 90 }, { mes: "2026-12", entradas: 0, saidas: 0 }]);
  });
  it("indicadores: razões, e zero quando o divisor é zero", () => {
    const k = kpisNotas([nf({ valor_pago: 500 })], undefined);
    const i = indicadores(k, 2000, { contratado: 3000, saldoDevedor: 1000 });
    expect(i.conversaoCaixa).toBeCloseTo(0.5);
    expect(i.coberturaDespesas).toBeCloseTo(0.25);
    expect(i.dependenciaEmprestimos).toBeCloseTo(0.5);
    expect(indicadores(k, 0, { contratado: 0, saldoDevedor: 0 })).toMatchObject({ coberturaDespesas: 0, dependenciaEmprestimos: 0 });
  });
  it("necessidade de caixa = custo mensal (despesas ÷ meses) − recebimentos previstos; o malote não é somado de novo", () => {
    expect(necessidadeDeCaixa(6_000_000, "2026-09-01", "2026-11-30", 1_500_000)).toEqual({ custoMensal: 2_000_000, recebimentosPrevistos: 1_500_000, necessidade: 500_000 });
    expect(necessidadeDeCaixa(1_000_000, "2026-11-01", "2026-11-30", 1_500_000).necessidade).toBe(-500_000);
  });
  it("saldo projetado = recebimentos − pagamentos", () => {
    expect(saldoProjetado({ recebimentos: 100, pagamentos: 130 })).toBe(-30);
  });
});

// ── Etapa 1: tipo de data, recebido por data de pagamento, detalhamento e conciliação do Malote ─────────────────────────────────────────
import { conciliacaoMalote, linhasDetalheNotas, notasRecebidasNoPeriodo } from "@/pages/financeiro/fluxo-caixa-gerencial/regras";

describe("recebimentos pela data de pagamento (hipótese do 'recebido zerado')", () => {
  // nota emitida em outubro e paga em novembro; nota emitida em novembro e ainda não paga
  const paga = nf({ id: "p", data_emissao: "2026-10-20", competencia: "2026-10-01", data_pagamento: "2026-11-10", valor_pago: 800 } as Partial<NfEmissaoRow>);
  const aberta = nf({ id: "a", data_emissao: "2026-11-05", competencia: "2026-11-01" } as Partial<NfEmissaoRow>);

  it("antes: o recebido só somava o pago das notas EMITIDAS no período e saía zerado", () => {
    const doRecorte = notasDoPeriodo([paga, aberta], f());
    expect(kpisNotas(doRecorte, undefined).recebido).toBe(0);
  });

  it("agora: o recebido é o que ENTROU no período, de qualquer emissão ou competência", () => {
    const recebidas = notasRecebidasNoPeriodo([paga, aberta], f());
    expect(recebidas.map((n) => n.id)).toEqual(["p"]);
    expect(kpisNotas(notasDoPeriodo([paga, aberta], f()), undefined, recebidas).recebido).toBe(800);
  });

  it("pagamento fora do período, valor zero, cancelada e filtros de empresa/contrato não entram", () => {
    const foraDoPeriodo = nf({ id: "x", data_pagamento: "2026-12-02", valor_pago: 500 } as Partial<NfEmissaoRow>);
    const semValor = nf({ id: "y", data_pagamento: "2026-11-02", valor_pago: 0 } as Partial<NfEmissaoRow>);
    const cancelada = nf({ id: "z", status: "cancelada", data_pagamento: "2026-11-02", valor_pago: 300 } as Partial<NfEmissaoRow>);
    const outraEmpresa = nf({ id: "w", empresa_id: "e2", data_pagamento: "2026-11-02", valor_pago: 100 } as Partial<NfEmissaoRow>);
    expect(notasRecebidasNoPeriodo([foraDoPeriodo, semValor, cancelada], f())).toHaveLength(0);
    expect(notasRecebidasNoPeriodo([outraEmpresa], f({ empresaId: "e1" }))).toHaveLength(0);
    expect(notasRecebidasNoPeriodo([outraEmpresa], f({ empresaId: "e2" }))).toHaveLength(1);
  });
});

describe("filtro 'Faturamento por' (emissão × competência)", () => {
  const n = nf({ id: "c", data_emissao: "2026-12-03", competencia: "2026-11-01" } as Partial<NfEmissaoRow>);
  it("por emissão (padrão) a nota de competência de novembro emitida em dezembro fica fora de novembro", () => {
    expect(notasDoPeriodo([n], f())).toHaveLength(0);
  });
  it("por competência ela entra em novembro", () => {
    expect(notasDoPeriodo([n], f({ tipoData: "competencia" })).map((x) => x.id)).toEqual(["c"]);
  });
  it("a série mensal acompanha a data escolhida", () => {
    const nov = (tipo: "emissao" | "competencia") => serieNotas([n], f({ tipoData: tipo })).find((p) => p.mes === "2026-11")!.bruto;
    expect(nov("emissao")).toBe(0);
    expect(nov("competencia")).toBe(1000);
  });
});

describe("detalhamento e conciliação (etapa 1)", () => {
  it("a soma das linhas de detalhe fecha com o KPI de bruto e de líquido", () => {
    const notas = notasDoPeriodo([nf({ id: "1" }), nf({ id: "2", vlr_bruto_total: 500, vlr_liquido_total: 450 } as Partial<NfEmissaoRow>)], f());
    const linhas = linhasDetalheNotas(notas, undefined);
    const k = kpisNotas(notas, undefined);
    expect(linhas.reduce((s, l) => s + l.bruto, 0)).toBe(k.bruto);
    expect(linhas.reduce((s, l) => s + l.liquido, 0)).toBe(k.liquido);
  });

  it("nota cancelada não aparece no detalhe", () => {
    expect(linhasDetalheNotas([nf({ id: "c", status: "cancelada", valor_pago: 10, data_pagamento: "2026-11-02" } as Partial<NfEmissaoRow>)], undefined)).toHaveLength(0);
  });

  it("Malote já está dentro das despesas: total = Malote + demais origens", () => {
    expect(conciliacaoMalote(1000, 600)).toEqual({ malote: 600, demais: 400, pctMalote: 0.6, ok: true });
  });

  it("Malote maior que o total das despesas indica duplicidade", () => {
    const c = conciliacaoMalote(500, 700);
    expect(c.ok).toBe(false);
    expect(c.demais).toBe(0);
  });
});
