import { describe, expect, it } from "vitest";
import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import { conciliar, type ContratoParaConciliacao, type FiltrosConciliacao } from "@/pages/financeiro/conciliacao-servicos/regras";
import { chaveIndicador, chaveNota, dadosDashboard, emAberto, resumoTratativas, textoHistorico, vencida, type Tratativa } from "@/pages/financeiro/conciliacao-servicos/tratativas";
import {
  alertasDeCriterio, destoantesDeExt, detalharIndicador, indicadoresExtendidos, INDICADORES_EXT, linhasContaVinculada, linhasImpostosDescontos, somarContaVinculada, valorDaNota,
  type EntradaIndicadores, type ValoresPorFonte,
} from "@/pages/financeiro/conciliacao-servicos/indicadores";

// SIS-2026-0903: conciliação ampliada (indicadores, detalhamento, impostos/descontos, conta vinculada, filtros).
const nf = (o: Partial<NfEmissaoRow> & { id: string }): NfEmissaoRow => ({
  empresa_id: "e1", contrato_id: "c1", competencia: "2026-03-01", data_emissao: "2026-03-10", tipo_nota: "N", status: "concluida", data_pagamento: null,
  numero_nf: o.id, variacao: null, valor_contrato_exec_total: 1000, vlr_bruto_total: 1000, vlr_liquido_total: 900, valor_pago: 0,
  desconto_conta_vinculada: 0, descontos_pos_emissao_total: 0, issqn_total: 0, inss_total: 0, ir_total: 0, cofins_total: 0, pis_total: 0, csll_total: 0,
  contrato: { id: "c1", nome: "UFRGS", cliente: "UFRGS" },
  ...o,
} as unknown as NfEmissaoRow);
const item = (o: Partial<NfEmissaoItemRow>): NfEmissaoItemRow => ({
  faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0, multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0,
  issqn: 0, inss: 0, ir: 0, cofins: 0, pis: 0, csll: 0, ...o,
} as NfEmissaoItemRow);
const orfa = (id: string, extra: Partial<NfEmissaoRow> = {}) => nf({ id, contrato_id: "c9", contrato: { id: "c9", nome: "ORFAO", cliente: "X" } as never, ...extra });
const contratos = new Map<string, ContratoParaConciliacao>([["c1", { id: "c1", empresa_id: "e1", nome: "UFRGS", cliente: "UFRGS" }]]);
const filtros: FiltrosConciliacao = { ano: 2026, competencia: "", empresaId: "", contratoId: "", cliente: "", codigo: "N", situacao: "" };
const ctx = { empresaNome: (id: string) => id, contratoPorId: new Map([["c1", { nome: "UFRGS", cliente: "UFRGS", empresa_id: "e1" }]]) };

function entrada(nfs: NfEmissaoRow[], itens = new Map<string, NfEmissaoItemRow[]>(), f = filtros, despesas: number | null = null): EntradaIndicadores {
  const r = conciliar({ nfs, itensPorNf: itens, contratoPorId: contratos, filtros: f });
  return {
    linhasRelatorio: r.linhasRelatorio, linhasFaturamento: r.linhasFaturamento, itensPorNf: itens, executavelDoContratoMes: () => 1200,
    contratosDoRecorte: [{ id: "c1" }], meses: ["2026-03"], despesas,
  };
}
const linha = (ls: ReturnType<typeof indicadoresExtendidos>, id: string) => ls.find((l) => l.indicador.id === id)!;

describe("indicadores ampliados", () => {
  it("cobre todos os indicadores pedidos no chamado", () => {
    const ids: string[] = INDICADORES_EXT.map((i) => i.id);
    for (const id of ["executavel", "executado", "bruto", "dif_exec_fat", "liquido", "impostos", "faltas", "postos", "glosas_antes", "glosas_depois", "multas_antes", "multas_depois",
      "outros_antes", "outros_depois", "recebido", "pendente", "cv_descontada", "cv_recebida", "cv_pendente", "despesas", "lucro_faturamento", "lucro_recebimentos", "margem"]) {
      expect(ids).toContain(id);
    }
  });

  it("indicador que a fonte não traz é null (indisponível), não zero", () => {
    const l = indicadoresExtendidos(entrada([nf({ id: "1" })]));
    const imp = linha(l, "impostos");
    expect(imp.valores).toEqual({ geral: 0, dashboard: null, faturamento: null, lucratividade: null });
    expect(imp.status).toBe("fonte_unica");
    expect(imp.diferenca).toBeNull();
    expect(imp.indisponiveis).toEqual(["dashboard", "faturamento", "lucratividade"]);
  });

  it("compara só quem tem o indicador e aponta quem destoa", () => {
    const l = indicadoresExtendidos(entrada([nf({ id: "1", valor_pago: 800, data_pagamento: "2026-04-10" })]));
    const pend = linha(l, "pendente");
    expect(pend.valores).toMatchObject({ geral: 100, dashboard: 100, faturamento: 0, lucratividade: null });
    expect(pend.status).toBe("divergente");
    expect(pend.diferenca).toBe(100);
    expect(pend.destoantes).toEqual(["faturamento"]);
    expect(linha(l, "bruto").status).toBe("conciliado");
  });

  it("executável: Relatório conta só contrato/mês com NF; Faturamento e Lucratividade, todos do recorte", () => {
    const e = entrada([nf({ id: "1" })]);
    e.contratosDoRecorte = [{ id: "c1" }, { id: "c2" }];
    const ex = linha(indicadoresExtendidos(e), "executavel");
    expect(ex.valores).toMatchObject({ geral: 1200, faturamento: 2400, lucratividade: 2400, dashboard: null });
    expect(ex.status).toBe("divergente");
    expect(ex.destoantes).toEqual(["geral"]);
  });

  it("descontos por tipo vêm dos itens; pós-emissão total compara itens × cabeçalho", () => {
    const itens = new Map([["1", [item({ faltas: 10, glosas: 20, multas_pos_emissao: 30, glosas_pos_emissao: 5 })]]]);
    const l = indicadoresExtendidos(entrada([nf({ id: "1", descontos_pos_emissao_total: 0 })], itens));
    expect(linha(l, "faltas").valores.dashboard).toBe(10);
    expect(linha(l, "glosas_antes").valores.dashboard).toBe(20);
    expect(linha(l, "multas_depois").valores.dashboard).toBe(30);
    const pos = linha(l, "desc_pos_total");
    expect(pos.valores).toMatchObject({ dashboard: 35, faturamento: 0 });
    expect(pos.status).toBe("divergente");
  });

  it("despesas, lucro e margem: sem dado até carregar as despesas; depois só a fonte que traz", () => {
    expect(linha(indicadoresExtendidos(entrada([nf({ id: "1" })])), "despesas").status).toBe("sem_dado");
    const l = indicadoresExtendidos(entrada([nf({ id: "1", valor_pago: 900, data_pagamento: "2026-04-01" })], new Map(), filtros, 300));
    expect(linha(l, "despesas").valores.lucratividade).toBe(300);
    expect(linha(l, "lucro_faturamento").valores.lucratividade).toBe(600);
    expect(linha(l, "lucro_recebimentos").valores.faturamento).toBe(600);
    expect(linha(l, "margem").valores.lucratividade).toBeCloseTo(66.67, 1);
  });

  it("destoantes: a fonte sozinha contra as iguais; todas diferentes = todas", () => {
    const v = (g: number | null, d: number | null, f: number | null, l: number | null): ValoresPorFonte => ({ geral: g, dashboard: d, faturamento: f, lucratividade: l });
    expect(destoantesDeExt(v(10, 10, 12, null))).toEqual(["faturamento"]);
    expect(destoantesDeExt(v(10, 11, 12, null))).toEqual(["geral", "dashboard", "faturamento"]);
    expect(destoantesDeExt(v(10, 10, null, null))).toEqual([]);
  });
});

describe("filtros novos", () => {
  const base = [nf({ id: "1", competencia: "2026-01-01", data_emissao: "2026-01-10" }), nf({ id: "2", competencia: "2026-03-01", data_emissao: "2026-03-10", data_pagamento: "2026-04-05", valor_pago: 900 }), nf({ id: "3", competencia: "2026-06-01", data_emissao: "2026-06-10" })];
  const ids = (f: Partial<FiltrosConciliacao>) => conciliar({ nfs: base, itensPorNf: new Map(), contratoPorId: contratos, filtros: { ...filtros, ...f } }).notas.map((n) => n.id).sort();
  it("vários meses (de/até)", () => { expect(ids({ competenciaDe: "2026-01", competenciaAte: "2026-03" })).toEqual(["1", "2"]); });
  it("período de emissão", () => { expect(ids({ emissaoDe: "2026-03-01", emissaoAte: "2026-06-30" })).toEqual(["2", "3"]); });
  it("período de pagamento: NF sem pagamento fica fora", () => { expect(ids({ pagamentoDe: "2026-04-01", pagamentoAte: "2026-04-30" })).toEqual(["2"]); });
});

describe("tipos de divergência", () => {
  it("classifica por origem: registro ausente e erro de lançamento", () => {
    const r = conciliar({ nfs: [orfa("1"), nf({ id: "2", valor_pago: 800, data_pagamento: "2026-04-10" })], itensPorNf: new Map(), contratoPorId: contratos, filtros });
    expect(r.notas.find((n) => n.id === "1")!.tipos).toEqual(["registro_ausente"]);
    expect(r.notas.find((n) => n.id === "2")!.tipos).toEqual(["erro_lancamento"]);
  });
});

describe("detalhamento até a nota", () => {
  const nfs = [nf({ id: "1", competencia: "2026-01-01", valor_pago: 800, data_pagamento: "2026-02-01" }), nf({ id: "2", competencia: "2026-02-01" }), orfa("3", { competencia: "2026-02-01" })];
  const e = entrada(nfs);
  it("por competência: a diferença cai no mês certo", () => {
    const d = detalharIndicador("pendente", e, "competencia", {}, ctx);
    // fev: a NF de contrato fora do cadastro está no Relatório e não no Faturamento (900 de diferença, 1 ausente); jan: NF paga a menor (100)
    expect(d[0]).toMatchObject({ chave: "2026-02", diferenca: 900, ausentes: 1 });
    expect(d[1]).toMatchObject({ chave: "2026-01", diferenca: 100, ausentes: 0 });
  });
  it("por nota dentro do mês e do contrato (drill progressivo)", () => {
    const d = detalharIndicador("pendente", e, "nota", { competencia: "2026-01", contrato: "c1" }, ctx);
    expect(d).toHaveLength(1);
    expect(d[0].nota).toMatchObject({ id: "1" });
    expect(d[0].valores).toMatchObject({ geral: 100, dashboard: 100, faturamento: 0 });
  });
  it("NF ausente de uma fonte é 'ausente', não valor zerado", () => {
    const d = detalharIndicador("bruto", e, "contrato", {}, ctx);
    const orfao = d.find((x) => x.chave === "c9")!;
    expect(orfao.valores.geral).toBe(1000);
    expect(orfao.valores.faturamento).toBeNull();
    expect(orfao.ausentes).toBe(1);
  });
  it("indicador sem valor por nota não abre detalhamento", () => { expect(detalharIndicador("executavel", e, "nota", {}, ctx)).toEqual([]); });
  it("valor da nota respeita a fonte", () => {
    const n = nf({ id: "1", valor_pago: 800, data_pagamento: "2026-02-01" });
    expect(valorDaNota("pendente", "geral", n, [])).toBe(100);
    expect(valorDaNota("pendente", "faturamento", n, [])).toBe(0);
    expect(valorDaNota("impostos", "dashboard", n, [])).toBeNull();
  });
});

describe("impostos e descontos / conta vinculada", () => {
  it("aponta cabeçalho × itens e separa antes/depois da emissão", () => {
    const n = nf({ id: "1", issqn_total: 50, descontos_pos_emissao_total: 10 });
    const itens = new Map([["1", [item({ issqn: 40, multas: 7, glosas_pos_emissao: 10 })]]]);
    const [l] = linhasImpostosDescontos([n], itens, () => "UFRGS");
    expect(l.totalImpostos).toBe(50);
    expect(l.totalImpostosItens).toBe(40);
    expect(l.multasAntes).toBe(7);
    expect(l.glosasDepois).toBe(10);
    expect(l.inconsistencias).toHaveLength(1);
    expect(l.inconsistencias[0]).toMatch(/Impostos/);
  });
  it("itens ainda não carregados não geram inconsistência", () => {
    const [l] = linhasImpostosDescontos([nf({ id: "1", issqn_total: 50 })], undefined, () => "UFRGS");
    expect(l.inconsistencias).toEqual([]);
  });
  it("conta vinculada: descontado × recebido × pendente e situação", () => {
    const cv = (id: string, desc: number, rec?: number) => nf({ id, desconto_conta_vinculada: desc, ...(rec === undefined ? {} : { conta_vinculada_valor_recebido: rec }) } as never);
    const linhas = linhasContaVinculada([cv("1", 100, 100), cv("2", 100, 40), cv("3", 100), cv("4", 100, 130), nf({ id: "5" })], () => "UFRGS");
    expect(linhas.map((l) => [l.id, l.situacao, l.pendente])).toEqual([["3", "pendente", 100], ["2", "parcial", 60], ["1", "recebida", 0], ["4", "recebido_a_mais", 0]]);
    const g = somarContaVinculada(linhas, () => ({ chave: "c1", rotulo: "UFRGS" }));
    expect(g[0]).toMatchObject({ notas: 4, descontada: 400, recebida: 270, pendente: 160 });
  });
  it("alertas de critério avisam antes de chamar de divergência", () => {
    const a = alertasDeCriterio([nf({ id: "1", contrato_id: "c9" }), nf({ id: "2", valor_pago: 800, data_pagamento: "2026-02-01" })], new Map([["c1", { empresa_id: "e1" }]]));
    expect(a.map((x) => x.id)).toEqual(["sem_contrato", "paga_com_saldo"]);
  });
});

describe("exportação em Excel", () => {
  it("monta as oito planilhas pedidas e marca indisponível (não zero)", async () => {
    const { montarPlanilhas } = await import("@/pages/financeiro/conciliacao-servicos/exportarExcel");
    const nfs = [nf({ id: "1", valor_pago: 800, data_pagamento: "2026-04-10" })];
    const r = conciliar({ nfs, itensPorNf: new Map(), contratoPorId: contratos, filtros });
    const e = entrada(nfs);
    const planilhas = montarPlanilhas({
      recorte: ["Ano: 2026"], geradoEm: new Date("2026-11-17T12:00:00"), resultado: r, indicadores: indicadoresExtendidos(e),
      impostos: linhasImpostosDescontos(r.linhasRelatorio, new Map(), () => "UFRGS"), contaVinculada: linhasContaVinculada(r.linhasRelatorio, () => "UFRGS"), tratativas: [], empresaNome: (id) => id,
    });
    expect(planilhas.map((p) => p.nome)).toEqual([
      "Resumo executivo", "Comparativo entre fontes", "Divergências por competência", "Divergências por contrato", "Detalhe por NF", "Impostos e descontos", "Conta vinculada", "Tratativas",
    ]);
    const comp = planilhas[1].linhas;
    const impostos = comp.find((l) => l[1] === "Impostos retidos")!;
    expect(impostos.slice(2, 6)).toEqual([0, "Indisponível", "Indisponível", "Indisponível"]);
    expect(planilhas[4].linhas[1][planilhas[4].linhas[1].length - 2]).toBe("Erro de lançamento");
  });
});


// SIS-2026-0903 (Fase 2): tratativas e dashboard.
const trat = (o: Partial<Tratativa> & { alvoChave: string }): Tratativa => ({
  id: o.alvoChave, alvoTipo: "nota", nfEmissaoId: null, contratoId: null, empresaId: null, competencia: "2026-03", indicador: null, titulo: "NF 1", tipoDivergencia: "erro_lancamento",
  valorDiferenca: 100, status: "aberta", responsavelId: null, responsavelNome: null, justificativa: null, identificadaEm: "2026-11-10", prazoResolucao: null, regularizadaEm: null, ...o,
});

describe("tratativas", () => {
  it("só aberta e em análise são valor sob investigação; vence só o que está em aberto e passou do prazo", () => {
    const ts = [trat({ alvoChave: "a", valorDiferenca: 100, prazoResolucao: "2026-11-01" }), trat({ alvoChave: "b", status: "em_analise", valorDiferenca: 50, prazoResolucao: "2026-12-01" }),
      trat({ alvoChave: "c", status: "justificada", valorDiferenca: 70, prazoResolucao: "2026-11-01" }), trat({ alvoChave: "d", status: "regularizada", valorDiferenca: 30 })];
    const r = resumoTratativas(ts, "2026-11-17");
    expect(r.valorSobInvestigacao).toBe(150);
    expect(r.vencidas).toBe(1);
    expect(r.porStatus).toEqual({ aberta: 1, em_analise: 1, justificada: 1, regularizada: 1 });
    expect(emAberto(ts[2])).toBe(false);
    expect(vencida(ts[2], "2026-11-17")).toBe(false);
  });
  it("chaves do alvo e texto do histórico", () => {
    expect(chaveNota("x")).toBe("nota:x");
    expect(chaveIndicador("pendente", "c1", "2026-03")).toBe("indicador:pendente|contrato:c1|mes:2026-03");
    expect(textoHistorico({ campo: "situação", valorAnterior: "aberta", valorNovo: "regularizada" })).toBe("Situação: “Aberta” → “Regularizada”");
    expect(textoHistorico({ campo: "criacao", valorAnterior: null, valorNovo: "NF 1" })).toBe("Tratativa aberta: NF 1");
    expect(textoHistorico({ campo: "justificativa", valorAnterior: null, valorNovo: "ok" })).toBe("Justificativa: vazio → “ok”");
  });
  it("dashboard: % de conciliação, divergentes sem tratativa, tipos e evolução", () => {
    const nfs = [nf({ id: "1", valor_pago: 800, data_pagamento: "2026-04-10" }), nf({ id: "2" }), orfa("3")];
    const r = conciliar({ nfs, itensPorNf: new Map(), contratoPorId: contratos, filtros });
    const d = dadosDashboard(r, [trat({ alvoChave: chaveNota("1") })], "2026-11-17");
    expect(d.notasAvaliadas).toBe(3);
    expect(d.notasDivergentes).toBe(2);
    expect(d.pctConciliacao).toBeCloseTo(33.33, 1);
    expect(d.semTratativa).toBe(1);
    expect(d.porTipo.map((t) => t.tipo).sort()).toEqual(["erro_lancamento", "registro_ausente"]);
    expect(d.evolucao[0]).toMatchObject({ mes: "2026-03", divergentes: 2 });
    expect(d.tratativas.total).toBe(1);
  });
});
