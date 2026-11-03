import { describe, expect, it } from "vitest";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import { linhasDoFluxoParaConciliacao } from "@/lib/conciliacaoCalculo";
import { saldosMensais, totaisDeSaldos, totaisFluxoDosBancosConciliados, type ConciliacaoParaSaldo, type LinhaFluxoSaldo } from "@/lib/conciliacaoDashboard";
import { chaveContaDoLancamento, comContaBanco, contarSemConta, contasDaConciliacao, extratoPareceDaConta, filtrarPorConta, rotuloConta, type ContaBanco } from "@/lib/contaBanco";
import { planejarAtribuicaoDeConta, type LinhaMassa } from "@/pages/financeiro/fluxo-caixa/alteracaoEmMassa";

// SIS-2026-0777: contas do mesmo banco (Sicredi HAGG 119 e HAGG 155) conciliadas e conferidas cada uma por si.
const C119 = "11111111-1111-4111-8111-111111111111";
const C155 = "22222222-2222-4222-8222-222222222222";
const contas: ContaBanco[] = [
  { id: C119, banco_id: "SICREDI", empresa_id: "HAGG", numero: "119", apelido: "Conta movimento", ativo: true },
  { id: C155, banco_id: "SICREDI", empresa_id: "HAGG", numero: "155", apelido: null, ativo: true },
  { id: "x", banco_id: "SICREDI", empresa_id: "NH", numero: "9", apelido: null, ativo: true },
  { id: "y", banco_id: "SICREDI", empresa_id: "HAGG", numero: "7", apelido: null, ativo: false },
  { id: "z", banco_id: "OUTRO", empresa_id: "HAGG", numero: "1", apelido: null, ativo: true },
];

const lf = (o: Partial<FluxoCaixaMaloteLinha> = {}): FluxoCaixaMaloteLinha =>
  ({
    despesa_id: "d1", id_malote: "DM-1", data_pagamento: "2026-10-10", competencia: "2026-10-01", empresa_id: "HAGG", empresa_nome: "HAGG",
    contrato_id: null, contrato_nome: null, classificacao_id: null, classificacao_nome: "Uniforme", descricao: "x", forma_pagamento: "PIX",
    banco_id: "SICREDI", banco_nome: "Sicredi", banco_logo_path: null, numero_parcela: null, numero_parcelas: null, valor: 100, tipo: "saida", origem: "malote", ajustado: false, ...o,
  }) as FluxoCaixaMaloteLinha;

describe("conta do lançamento", () => {
  it("a chave é origem + despesa + parcela (0 = sem parcela)", () => {
    expect(chaveContaDoLancamento({ origem: "malote", despesa_id: "d1", numero_parcela: null })).toBe("malote|d1|0");
    expect(chaveContaDoLancamento({ origem: "malote", despesa_id: "d1", numero_parcela: 3 })).toBe("malote|d1|3");
  });
  it("sem nenhuma atribuição devolve o mesmo array; com atribuição carimba só a linha ligada", () => {
    const linhas = [lf(), lf({ despesa_id: "d2" })];
    expect(comContaBanco(linhas, new Map())).toBe(linhas);
    const out = comContaBanco(linhas, new Map([["malote|d2|0", C155]]));
    expect(out[0].conta_banco_id).toBeUndefined();
    expect(out[1].conta_banco_id).toBe(C155);
  });
  it("rótulo com e sem apelido", () => {
    expect(rotuloConta(contas[0])).toBe("119 — Conta movimento");
    expect(rotuloConta(contas[1])).toBe("155");
  });
});

describe("contas que entram na conciliação", () => {
  it("só ativas, do banco e das empresas escolhidas", () => {
    expect(contasDaConciliacao(contas, "SICREDI", false, ["HAGG"]).map((c) => c.numero)).toEqual(["119", "155"]);
    expect(contasDaConciliacao(contas, "SICREDI", true, []).map((c) => c.numero)).toEqual(["119", "155", "9"]);
    expect(contasDaConciliacao(contas, "", true, [])).toEqual([]);
  });
});

describe("lado Fluxo da conciliação por conta", () => {
  const linhas = comContaBanco(
    [lf({ despesa_id: "a" }), lf({ despesa_id: "b" }), lf({ despesa_id: "c" })],
    new Map([["malote|a|0", C119], ["malote|b|0", C155]]),
  );
  const escopo = { bancoId: "SICREDI", todasEmpresas: false, empresaIds: ["HAGG"], dataDe: "2026-10-01", dataAte: "2026-10-31" };

  it("sem conta escolhida continua banco + empresa (as três)", () => {
    expect(linhasDoFluxoParaConciliacao(linhas, escopo)).toHaveLength(3);
  });
  it("com a conta 119 só vem o que está ligado a ela; o sem conta fica de fora", () => {
    expect(linhasDoFluxoParaConciliacao(linhas, { ...escopo, contaBancoId: C119 }).map((l) => l.despesa_id)).toEqual(["a"]);
    expect(linhasDoFluxoParaConciliacao(linhas, { ...escopo, contaBancoId: C155 }).map((l) => l.despesa_id)).toEqual(["b"]);
    expect(filtrarPorConta(linhas, C119)).toHaveLength(1);
    expect(filtrarPorConta(linhas, "")).toHaveLength(3);
  });
  it("conta quantos lançamentos ainda estão sem conta", () => {
    expect(contarSemConta(linhas)).toBe(1);
  });
});

describe("extrato OFX × conta escolhida", () => {
  it("compara só os dígitos e aceita zeros à esquerda, agência e dígito", () => {
    expect(extratoPareceDaConta(["0000119"], "119")).toBe(true);
    expect(extratoPareceDaConta(["4321/00155-0"], "155")).toBe(true);
    expect(extratoPareceDaConta(["0000155"], "119")).toBe(false);
  });
  it("sem ACCTID ou sem número, não dá para saber", () => {
    expect(extratoPareceDaConta([], "119")).toBeNull();
    expect(extratoPareceDaConta(["0000119"], "")).toBeNull();
  });
});

describe("atribuição de conta em massa", () => {
  const m = (o: Partial<LinhaMassa> = {}): LinhaMassa => ({
    origem: "malote", despesa_id: "d1", numero_parcela: null, empresa_id: "HAGG", contrato_id: null, contrato_nome: null,
    classificacao_id: null, classificacao_nome: null, banco_id: "SICREDI", conta_banco_id: null, ...o,
  });
  const destino = { id: C119, banco_id: "SICREDI", empresa_id: "HAGG" };

  it("aplica no banco e empresa da conta", () => {
    const p = planejarAtribuicaoDeConta([m(), m({ origem: "debito_automatico", despesa_id: "d2" })], destino);
    expect(p.aplicar).toHaveLength(2);
    expect(p.ignoradas).toEqual([]);
  });
  it("deixa de fora sem banco, outro banco, já na conta, outra empresa e fatia repetida", () => {
    const p = planejarAtribuicaoDeConta([
      m({ despesa_id: "a", banco_id: null }),
      m({ despesa_id: "b", banco_id: "OUTRO" }),
      m({ despesa_id: "c", conta_banco_id: C119 }),
      m({ despesa_id: "d", empresa_id: "NH" }),
      m({ despesa_id: "e" }),
      m({ despesa_id: "e" }),
    ], destino);
    expect(p.aplicar.map((l) => l.despesa_id)).toEqual(["e"]);
    expect(p.ignoradas.map((i) => i.linha.despesa_id)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("trocar de uma conta para outra é permitido", () => {
    const p = planejarAtribuicaoDeConta([m({ conta_banco_id: C155 })], destino);
    expect(p.aplicar).toHaveLength(1);
  });
});

describe("dashboard: cada conta do banco é conferida à parte", () => {
  const ln = (o: Partial<LinhaFluxoSaldo>): LinhaFluxoSaldo => ({
    empresa_id: "HAGG", banco_id: "SICREDI", banco_nome: "Sicredi", data_pagamento: "2026-10-10", tipo: "entrada", valor: 100, descricao: "x", classificacao_nome: "RECEITA", ...o,
  });
  const cs = (o: Partial<ConciliacaoParaSaldo>): ConciliacaoParaSaldo => ({
    id: "c", data_inicio: "2026-10-01", data_fim: "2026-10-31", banco_id: "SICREDI", todas_empresas: false, empresa_ids: ["HAGG"], conta_extrato: null,
    saldo_final_extrato: null, created_at: "2026-11-02T10:00:00Z", ...o,
  });
  const rotulos = new Map([[C119, "119 — Conta movimento"], [C155, "155"]]);
  const linhas = [ln({ valor: 1000, conta_banco_id: C119 }), ln({ valor: 300, conta_banco_id: C155 }), ln({ tipo: "saida", valor: 50, conta_banco_id: C155 })];

  it("gera um grupo por conta, com o movimento de cada uma", () => {
    const s = saldosMensais(linhas, [], [], undefined, rotulos);
    const c119 = s.find((x) => x.contaBancoId === C119)!;
    const c155 = s.find((x) => x.contaBancoId === C155)!;
    expect(c119.entradas).toBe(1000);
    expect(c119.saidas).toBe(0);
    expect(c119.conta).toBe("119 — Conta movimento");
    expect(c155.entradas).toBe(300);
    expect(c155.saidas).toBe(50);
  });
  it("a conciliação de uma conta só confere o saldo daquela conta", () => {
    const s = saldosMensais(linhas, [{ empresa_id: "HAGG", banco_id: "SICREDI", conta: C119, ano: 2026, valor: 0 }, { empresa_id: "HAGG", banco_id: "SICREDI", conta: C155, ano: 2026, valor: 0 }],
      [cs({ id: "k119", conta_banco_id: C119, saldo_final_extrato: 1000 })], undefined, rotulos);
    const c119 = s.find((x) => x.contaBancoId === C119 && x.mes === "2026-10")!;
    const c155 = s.find((x) => x.contaBancoId === C155 && x.mes === "2026-10")!;
    expect(c119.confere).toBe("sim");
    expect(c119.conciliacaoId).toBe("k119");
    expect(c155.confere).toBe("pendente");
    expect(c155.conciliacaoId).toBeNull();
  });
  it("sem nenhuma conta o comportamento é o de antes (um grupo por empresa + banco)", () => {
    const s = saldosMensais([ln({ valor: 100 }), ln({ valor: 40 })], [], []);
    expect(s).toHaveLength(1);
    expect(s[0].contaBancoId).toBe("");
    expect(s[0].entradas).toBe(140);
  });
  it("totais de saldo não misturam as contas: cada uma conta como um grupo", () => {
    const s = saldosMensais(linhas, [{ empresa_id: "HAGG", banco_id: "SICREDI", conta: C119, ano: 2026, valor: 0 }, { empresa_id: "HAGG", banco_id: "SICREDI", conta: C155, ano: 2026, valor: 0 }],
      [cs({ id: "k119", conta_banco_id: C119, saldo_final_extrato: 1000 }), cs({ id: "k155", conta_banco_id: C155, saldo_final_extrato: 250 })], undefined, rotulos);
    const t = totaisDeSaldos(s);
    expect(t.grupos).toBe(2);
    expect(t.sistema).toBe(1250);
    expect(t.extrato).toBe(1250);
    expect(t.divergentes).toBe(0);
  });
  it("o Fluxo 'coberto' por uma conciliação de conta é só o daquela conta", () => {
    const l = (o: Partial<FluxoCaixaMaloteLinha & { conta_banco_id: string }>) => ({ despesa_id: "d", numero_parcela: null, empresa_id: "HAGG", banco_id: "SICREDI", data_pagamento: "2026-10-10", tipo: "saida" as const, valor: 10, ...o });
    const f = { dataDe: "2026-10-01", dataAte: "2026-10-31", empresaId: null, bancoId: null, mesDe: "", mesAte: "" };
    const doDeConta = totaisFluxoDosBancosConciliados([l({ conta_banco_id: C119 }), l({ conta_banco_id: C155, valor: 5 }), l({ valor: 3 })], [cs({ conta_banco_id: C119 })], f, "2026-11-03");
    expect(doDeConta.saidas).toBe(10);
    const doBanco = totaisFluxoDosBancosConciliados([l({ conta_banco_id: C119 }), l({ conta_banco_id: C155, valor: 5 }), l({ valor: 3 })], [cs({})], f, "2026-11-03");
    expect(doBanco.saidas).toBe(18);
  });
});
