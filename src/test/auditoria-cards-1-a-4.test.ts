import { describe, it, expect } from "vitest";
import {
  fmtPercentual, relatorioSemCentro, semCentroDetalhe, totaisCentrosMalote,
  divergenciasMaloteFluxo, linhaDaOrigemDoCard, maloteDiretoPorDespesa, relatorioDivergencias, totalMaloteDireto,
  centrosAcimaDoOrcado, entradasSaidas, linkFluxoCaixa, linksDoCard, periodoDoMes, saidasFinanceiro, situacaoComparacao,
  totaisFluxoExtrato, totaisMaloteFinanceiro, VALIDACOES, type LinhaFluxoAud,
} from "@/pages/controladoria/auditoria/regras";

const L = (origem: string, tipo: "entrada" | "saida", valor: number, extra: Partial<LinhaFluxoAud> = {}): LinhaFluxoAud => ({
  origem, tipo, valor, empresa_id: "E1", contrato_id: null, classificacao_nome: "X", ...extra,
});

const fluxo: LinhaFluxoAud[] = [
  L("malote", "saida", 1000),
  L("malote", "saida", 500, { empresa_id: "E2" }),
  L("debito_automatico", "saida", 300),
  L("debito_automatico", "entrada", 2000),
  L("cartao_fatura", "saida", 200),
  L("importacao_historica", "saida", 100),
  L("aplicacao_financeira", "saida", 9000), // giro de caixa: fora dos totais de gasto
  L("aplicacao_financeira", "entrada", 8000),
  L("importacao_historica", "saida", 777, { classificacao_nome: "SALDO ANTERIOR" }),
];
const SEM = { empresaId: null, contratoId: null };

describe("Auditoria — card 1 (Malote + Financeiro × Fluxo)", () => {
  it("Financeiro = origens que não são Malote, sem aplicação e sem saldo anterior", () => {
    expect(saidasFinanceiro(fluxo, SEM).map((l) => l.valor).sort((a, b) => a - b)).toEqual([100, 200, 300]);
  });

  it("SIS-2026-0687: Malote + todas as origens (aplicação, cartão, débito...) = total de saídas do Fluxo", () => {
    const t = totaisMaloteFinanceiro(1500, fluxo, SEM);
    expect(t.painel.financeiro).toBe(9600); // 9000 aplicação + 300 débito + 200 cartão + 100 importação
    expect(t.a).toBe(11100);
    expect(t.b).toBe(11100);
    expect(t.painel.fluxoSaidas).toBe(11100);
    expect(t.painel.aplicacoes).toBe(9000);
  });

  it("origens na ordem do mockup: aplicações, cartão, débito; as demais depois", () => {
    const t = totaisMaloteFinanceiro(1500, fluxo, SEM);
    expect(t.painel.financeiroPorOrigem).toEqual([
      { origem: "aplicacao_financeira", valor: 9000 },
      { origem: "cartao_fatura", valor: 200 },
      { origem: "debito_automatico", valor: 300 },
      { origem: "importacao_historica", valor: 100 },
    ]);
  });

  it("o saldo anterior (passagem de saldo) não entra no total do Fluxo", () => {
    const t = totaisMaloteFinanceiro(1500, fluxo, SEM);
    expect(t.b).toBe(11100); // a linha de 777 "SALDO ANTERIOR" ficou de fora
  });

  it("diverge quando o Fluxo tem ajuste de valor no Malote", () => {
    const ajustado = fluxo.map((l) => (l.valor === 1000 ? { ...l, valor: 1100 } : l));
    const t = totaisMaloteFinanceiro(1500, ajustado, SEM);
    expect(t.b - t.a).toBe(100);
  });

  it("aplicação importada da planilha (origem importação, classificação Aplicação Financeira) soma em Aplicações Financeiras", () => {
    const comImportada = [
      ...fluxo,
      L("importacao_historica", "saida", 5000, { classificacao_nome: "Aplicação Financeira" }),
      L("importacao_historica", "saida", 4000, { classificacao_nome: "APLICACAO FINANCEIRA" }),
    ];
    const t = totaisMaloteFinanceiro(1500, comImportada, SEM);
    expect(t.painel.aplicacoes).toBe(9000 + 5000 + 4000);
    expect(t.a).toBe(11100 + 9000);
    expect(t.b).toBe(11100 + 9000);
    expect(t.painel.financeiroPorOrigem.filter((o) => o.origem === "importacao_historica")).toEqual([{ origem: "importacao_historica", valor: 100 }]);
  });

  it("respeita o filtro de empresa dos dois lados", () => {
    const t = totaisMaloteFinanceiro(1000, fluxo, { empresaId: "E1", contratoId: null });
    expect(t.painel.fluxoSaidas).toBe(10600); // 1000 malote + 9600 outras origens (a linha de 500 do malote em E2 fica fora)
  });
});

describe("Auditoria — card 2 (Fluxo × Extrato, entradas e saídas separadas)", () => {
  it("entradasSaidas: total movimentado soma, saldo subtrai", () => {
    expect(entradasSaidas([{ tipo: "entrada", valor: 100 }, { tipo: "saida", valor: 40 }])).toEqual({ entradas: 100, saidas: 40, movimentado: 140, saldo: 60 });
  });

  const B1 = "banco-1", B2 = "banco-2";
  const F = (tipo: "entrada" | "saida", valor: number, banco: string, extra: Partial<LinhaFluxoAud & { banco_id: string; descricao: string; banco_nome: string }> = {}) =>
    ({ origem: "malote", tipo, valor, empresa_id: "E1", contrato_id: null, classificacao_nome: "X", banco_id: banco, banco_nome: banco === B1 ? "Banrisul" : "Bradesco", descricao: "", ...extra }) as LinhaFluxoAud;
  const concil = (extra: Record<string, unknown> = {}) => ({ id: "c1", banco_id: B1, empresa_ids: ["E1"], todas_empresas: false, data_inicio: "2026-09-01", data_fim: "2026-09-30", created_at: "2026-10-13T10:00:00Z", extrato_entradas: 1000, extrato_saidas: 600, ...extra });
  const fluxoMes = [F("entrada", 1000, B1), F("saida", 600, B1), F("saida", 400, B2)];

  it("compara só o recorte conciliado (banco + empresa) e mostra a cobertura do mês", () => {
    const t = totaisFluxoExtrato(fluxoMes, [concil()], null);
    expect(t.painel.fluxo).toMatchObject({ entradas: 1000, saidas: 600 });
    expect(t.painel.extrato).toMatchObject({ entradas: 1000, saidas: 600 });
    expect(t.painel.difEntradas).toBe(0);
    expect(t.painel.difSaidas).toBe(0);
    expect(t.painel.fluxoMes.saidas).toBe(1000); // o banco 2 existe no Fluxo, mas não foi conciliado
    expect(t.painel.cobertura).toBeCloseTo(0.6);
    expect(t.painel.bancos).toEqual(["Banrisul"]);
    const def = VALIDACOES.find((v) => v.tipo === "fluxo_extrato")!;
    expect(situacaoComparacao(def, t)).toBe("confere");
  });

  // SIS-2026-0701: jan/26 — o Fluxo da tela somava o saldo anterior nas entradas e a Auditoria não, então os totais não batiam.
  it("ponte: total do Fluxo (com saldo anterior) = saldo anterior + bancos sem conciliação + ignorados + recorte, entradas e saídas", () => {
    const linhas = [
      ...fluxoMes,
      F("entrada", 300, B1, { classificacao_nome: "SALDO ANTERIOR" }),
      F("saida", 50, B1, { descricao: "PAGAMENTO CONTA VINCULADA" }),
      F("entrada", 70, B2),
    ];
    const t = totaisFluxoExtrato(linhas, [concil()], null, (l) => (l.descricao ?? "").includes("CONTA VINCULADA") && l.tipo === "saida");
    const p = t.painel.ponte!;
    expect(p.total).toMatchObject({ entradas: 1370, saidas: 1050 });
    expect(p.saldoAnterior).toMatchObject({ entradas: 300, saidas: 0 });
    expect(p.semConciliacao).toMatchObject({ entradas: 70, saidas: 400 });
    expect(p.ignorados).toMatchObject({ entradas: 0, saidas: 50 });
    expect(t.painel.fluxo).toMatchObject({ entradas: 1000, saidas: 600 });
    expect(p.total.entradas).toBe(p.saldoAnterior.entradas + p.semConciliacao.entradas + p.ignorados.entradas + t.painel.fluxo.entradas);
    expect(p.total.saidas).toBe(p.saldoAnterior.saidas + p.semConciliacao.saidas + p.ignorados.saidas + t.painel.fluxo.saidas);
  });

  it("sem conciliação salva não há ponte", () => {
    expect(totaisFluxoExtrato(fluxoMes, [], null).painel.ponte).toBeNull();
  });

  it("sem conciliação salva: Fluxo do mês inteiro contra extrato zerado, e marcado como não conciliado", () => {
    const t = totaisFluxoExtrato(fluxoMes, [], null);
    expect(t.painel.conciliado).toBe(false);
    expect(t.painel.fluxo.saidas).toBe(1000);
    expect(t.painel.extrato.movimentado).toBe(0);
    expect(t.painel.cobertura).toBeNull();
  });

  it("conciliação salva duas vezes (mesma conta e período) conta uma vez só: vale a mais recente", () => {
    const antiga = concil({ id: "velha", created_at: "2026-10-09T10:00:00Z", extrato_entradas: 1, extrato_saidas: 1 });
    const t = totaisFluxoExtrato(fluxoMes, [antiga, concil()], null);
    expect(t.painel.conciliacoes).toBe(1);
    expect(t.painel.extrato.entradas).toBe(1000);
  });

  it("soma contas diferentes e respeita o filtro de empresa", () => {
    const c2 = concil({ id: "c2", banco_id: B2, extrato_entradas: 0, extrato_saidas: 400 });
    const t = totaisFluxoExtrato(fluxoMes, [concil(), c2], null);
    expect(t.painel.extrato.saidas).toBe(1000);
    expect(t.painel.difSaidas).toBe(0);
    const outraEmpresa = totaisFluxoExtrato(fluxoMes, [concil()], "E2");
    expect(outraEmpresa.painel.conciliado).toBe(false); // conciliação é da E1
  });

  it("não confere quando entrada ou saída divergem (somadas poderiam esconder)", () => {
    const def = VALIDACOES.find((v) => v.tipo === "fluxo_extrato")!;
    const t = totaisFluxoExtrato([F("entrada", 100, B1), F("saida", 100, B1)], [concil({ extrato_entradas: 200, extrato_saidas: 0 })], null);
    expect(t.a).toBe(t.b); // somados são iguais
    expect(situacaoComparacao(def, t)).toBe("diverge");
  });

  it("o que a conciliação ignora (conta vinculada) fica fora do Fluxo comparado", () => {
    const ignora = (l: { descricao?: string | null }) => (l.descricao ?? "").includes("CONTA VINCULADA");
    const fluxo = [F("saida", 600, B1), F("saida", 50, B1, { descricao: "RESGATE CONTA VINCULADA" })];
    const t = totaisFluxoExtrato(fluxo, [concil({ extrato_entradas: 0, extrato_saidas: 600 })], null, ignora);
    expect(t.painel.fluxo.saidas).toBe(600);
    expect(t.painel.difSaidas).toBe(0);
  });

  it("conciliação antiga sem total de extrato é sinalizada, não somada como zero escondido", () => {
    const t = totaisFluxoExtrato(fluxoMes, [concil({ extrato_entradas: null, extrato_saidas: null })], null);
    expect(t.painel.semTotais).toBe(1);
  });
});

describe("Auditoria — card 4 (centros acima do orçado)", () => {
  const centros = [
    { nome: "A", orcado: 100, realizado: 80 },
    { nome: "B", orcado: 100, realizado: 300 },
    { nome: "C", orcado: 50, realizado: 150 },
    { nome: "D", orcado: 10, realizado: 40 },
    { nome: "E", orcado: 10, realizado: 15 },
  ];
  it("lista só quem estourou, do maior para o menor, com o resto agrupado", () => {
    const p = centrosAcimaDoOrcado(centros, 3);
    expect(p.principais.map((c) => [c.nome, c.excesso])).toEqual([["B", 200], ["C", 100], ["D", 30]]);
    expect(p.outrosQtd).toBe(1);
    expect(p.outros).toBe(5);
    expect(p.totalAcima).toBe(335);
  });
  it("sem estouro, nada a listar", () => {
    expect(centrosAcimaDoOrcado([{ nome: "A", orcado: 10, realizado: 5 }]).totalAcima).toBe(0);
  });
});

describe("Auditoria — links para conferir a origem", () => {
  it("período do mês, inclusive fevereiro e ano bissexto", () => {
    expect(periodoDoMes("2026-02")).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(periodoDoMes("2028-02").ate).toBe("2028-02-29");
    expect(periodoDoMes("2026-12").ate).toBe("2026-12-31");
  });
  it("Fluxo abre no período e na empresa do painel", () => {
    expect(linkFluxoCaixa("2026-09", "E1")).toBe("/app/financeiro/gestao-financeira/fluxo-caixa?de=2026-09-01&ate=2026-09-30&empresa=E1");
    expect(linkFluxoCaixa("2026-09", null)).not.toContain("empresa=");
  });
  it("cada card traz os links pedidos; cards 5 a 7 não mudam", () => {
    const rot = (t: Parameters<typeof linksDoCard>[0]) => linksDoCard(t, "2026-09", null).map((l) => l.rotulo);
    expect(rot("malote_fluxo")).toEqual(["Malote", "Fluxo de Caixa"]);
    expect(rot("fluxo_extrato")).toEqual(["Malote", "Fluxo de Caixa", "Conciliação Bancária"]);
    expect(rot("centros_malote")).toEqual(["Malote", "Lançamentos financeiros", "Centros de Custo"]);
    expect(rot("orcado_realizado")).toEqual(["Fluxo de Caixa", "Orçamento Geral"]);
    expect(rot("faturado")).toEqual([]);
  });
});

describe("Auditoria — card 1: relatório das despesas divergentes", () => {
  const desp = (id: string, numero: string, valor: number) => ({ id, numero, empresa_id: "E1", contrato_id: null, valor_aprovado: valor, valor_total: valor, parcelado: false });
  const direto = maloteDiretoPorDespesa([desp("a", "DM-1", 4615.94), desp("b", "DM-2", 1410.51), desp("c", "DM-3", 111.57), desp("d", "DM-4", 50)], [], [], [], SEM);
  const linhaMalote = (id: string, numero: string, valor: number, ajustado = false): LinhaFluxoAud =>
    ({ origem: "malote", tipo: "saida", valor, empresa_id: "E1", contrato_id: null, classificacao_nome: "X", despesa_id: id, id_malote: numero, ajustado });

  it("o total direto não mudou com o refator por despesa", () => {
    expect(totalMaloteDireto([desp("a", "DM-1", 100.1), desp("b", "DM-2", 200.2)], [], [], [], SEM)).toBe(300.3);
  });

  it("aponta as despesas ajustadas no Fluxo (o caso real de setembro: R$ 9,80)", () => {
    const fluxo = [
      linhaMalote("a", "DM-1", 4605.94, true), // -10,00 no Fluxo
      linhaMalote("b", "DM-2", 1410.61, true), // +0,10
      linhaMalote("c", "DM-3", 111.67, true), // +0,10
      linhaMalote("d", "DM-4", 50),
    ];
    const divs = divergenciasMaloteFluxo(direto, fluxo, SEM);
    expect(divs.map((d) => [d.numero, d.diferenca, d.motivo])).toEqual([
      ["DM-1", 10, "ajustado_no_fluxo"],
      ["DM-2", -0.1, "ajustado_no_fluxo"],
      ["DM-3", -0.1, "ajustado_no_fluxo"],
    ]);
    expect(Math.round(divs.reduce((s, d) => s + d.diferenca, 0) * 100) / 100).toBe(9.8);
  });

  it("distingue: só no Malote, só no Fluxo e valor diferente sem ajuste", () => {
    const fluxo = [linhaMalote("a", "DM-1", 4615.94), linhaMalote("b", "DM-2", 1500), linhaMalote("z", "DM-9", 77)];
    const motivos = Object.fromEntries(divergenciasMaloteFluxo(direto, fluxo, SEM).map((d) => [d.numero, d.motivo]));
    expect(motivos).toEqual({ "DM-2": "valor_diferente", "DM-3": "so_no_malote", "DM-4": "so_no_malote", "DM-9": "so_no_fluxo" });
  });

  it("sem divergência, lista vazia e relatório diz isso", () => {
    const fluxo = [linhaMalote("a", "DM-1", 4615.94), linhaMalote("b", "DM-2", 1410.51), linhaMalote("c", "DM-3", 111.57), linhaMalote("d", "DM-4", 50)];
    expect(divergenciasMaloteFluxo(direto, fluxo, SEM)).toEqual([]);
    expect(relatorioDivergencias([])).toMatch(/Nenhuma despesa divergente/);
  });

  it("relatório em texto traz ID, valores, motivo e autor quando conhecido", () => {
    const divs = divergenciasMaloteFluxo(direto, [linhaMalote("a", "DM-1", 4605.94, true)], SEM).filter((d) => d.numero === "DM-1");
    const txt = relatorioDivergencias(divs, new Map([["a", "ajustado por Fulana em 13/10/2026"]]));
    expect(txt).toContain("DM-1");
    expect(txt).toContain("Valor ajustado só no Fluxo de Caixa");
    expect(txt).toContain("ajustado por Fulana");
  });
});

describe("Auditoria — card 3: lançamentos sem centro e formato da cobertura", () => {
  const tipos = new Map<string, string | null>([["ADM", "administrativo"], ["CONTRATO", "contrato"]]);
  const L3 = (o: Partial<import("@/pages/controladoria/auditoria/regras").LinhaCentroMalote> & { valor: number }) =>
    ({ empresa_id: "E1", contrato_id: null, classificacao_id: "CONTRATO", origem: "malote", despesa_id: null, id_malote: null, descricao: "", classificacao_nome: null, data_pagamento: "2026-09-10", ...o });
  const linhas = [
    L3({ valor: 1000, contrato_id: "C1", despesa_id: "d1", id_malote: "DM-1" }), // tem centro (contrato)
    L3({ valor: 300, classificacao_id: "ADM", despesa_id: "d2", id_malote: "DM-2" }), // centro administrativo
    L3({ valor: 50, despesa_id: "d3", id_malote: "DM-3", descricao: "sem contrato" }), // sem centro
    L3({ valor: 20, despesa_id: "d3", id_malote: "DM-3", descricao: "sem contrato" }), // 2ª fatia do mesmo lançamento
    L3({ valor: 700, classificacao_id: null, origem: "debito_automatico", despesa_id: "d4", id_malote: "DA-4", descricao: "financeiro" }), // sem classificação
  ];

  it("o relatório fecha com o 'sem centro' do total (a mesma conta do card)", () => {
    const tot = totaisCentrosMalote(linhas, tipos, SEM);
    const det = semCentroDetalhe(linhas, tipos, SEM);
    expect(det.reduce((s, l) => s + l.valor, 0)).toBe(tot.pendente);
    expect(tot.pendente).toBe(770);
  });

  it("junta as fatias do mesmo lançamento, ordena do maior e diz o motivo", () => {
    const det = semCentroDetalhe(linhas, tipos, SEM);
    expect(det.map((l) => [l.numero, l.valor, l.motivo])).toEqual([
      ["DA-4", 700, "sem_classificacao"],
      ["DM-3", 70, "contrato_nao_informado"],
    ]);
  });

  it("respeita o filtro de empresa e o relatório em texto traz ID, origem e motivo", () => {
    expect(semCentroDetalhe(linhas, tipos, { empresaId: "E2", contratoId: null })).toEqual([]);
    const txt = relatorioSemCentro(semCentroDetalhe(linhas, tipos, SEM));
    expect(txt).toContain("DA-4");
    expect(txt).toContain("Débito Automático");
    expect(txt).toContain("Sem classificação");
    expect(relatorioSemCentro([])).toMatch(/Nenhum lançamento/);
  });

  it("cobertura pequena não vira 0%: abaixo de 10% mostra uma casa decimal", () => {
    expect(fmtPercentual(0.0029)).toBe("0,3%");
    expect(fmtPercentual(0.06)).toBe("6%");
    expect(fmtPercentual(0.456)).toBe("46%");
    expect(fmtPercentual(1)).toBe("100%");
  });
});

describe("SIS-2026-0687 — filtro de origem do Fluxo bate com o tile do card 1", () => {
  const origens = ["aplicacao_financeira", "cartao_fatura", "debito_automatico", "importacao_historica"];
  const comImportada = [
    ...fluxo,
    L("importacao_historica", "saida", 5000, { classificacao_nome: "Aplicação Financeira" }),
  ];

  it("a soma das saídas filtradas por origem é o valor do tile, para cada origem", () => {
    const t = totaisMaloteFinanceiro(1500, comImportada, SEM);
    for (const o of origens) {
      const doFiltro = comImportada.filter((l) => l.tipo === "saida" && linhaDaOrigemDoCard(l, o)).reduce((s, l) => s + l.valor, 0);
      expect(doFiltro).toBe(t.painel.financeiroPorOrigem.find((x) => x.origem === o)?.valor);
    }
  });

  it("aplicação importada vai para Aplicações e não para Importação; saldo anterior não é de origem nenhuma", () => {
    const aplicImportada = comImportada.find((l) => l.valor === 5000)!;
    expect(linhaDaOrigemDoCard(aplicImportada, "aplicacao_financeira")).toBe(true);
    expect(linhaDaOrigemDoCard(aplicImportada, "importacao_historica")).toBe(false);
    const saldo = comImportada.find((l) => l.valor === 777)!;
    expect(origens.some((o) => linhaDaOrigemDoCard(saldo, o))).toBe(false);
  });
});
