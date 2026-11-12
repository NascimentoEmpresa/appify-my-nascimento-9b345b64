import { describe, expect, it } from "vitest";
import {
  filtrar, indCusto, indFaltas, indGlosas, indLucratividade, indPostos, indReclamacoes, indTurnover,
  montarLinhas, ordenar, resumir, type ContratoRpc, type DadosContratosRpc,
} from "@/lib/operacional/indicadoresContratos";

// Operacional › Indicadores por Contrato (11/11/2026). Valores fictícios.

const contrato = (x: Partial<ContratoRpc> = {}): ContratoRpc => ({
  id: "a", nome: "CONTRATO A", cliente: "CLIENTE 1", encerrado: false,
  postos: { contratados: 20, previsto: 20, implantado_registrado: false, cobertos: 20, afastados: 0 },
  efetivo: 20, demissoes: 0,
  atestados: { dias_pessoa: 0, pessoas: 0 },
  glosas: { valor: 0, qtd: 0, causa: null },
  reclamacoes: { qtd: 0, causa: null },
  orcado: { custo_direto_por_mes: { "2026-09": 80_000, "2026-10": 80_000 }, margem_prevista: 8 },
  ...x,
});

describe("sem fonte nunca vira zero", () => {
  it("contrato sem Planilha de Custo: postos e custo sem fonte", () => {
    const c = contrato({ postos: null, orcado: null });
    expect(indPostos(c)).toMatchObject({ status: "sem_fonte", valor: null });
    expect(indCusto(c, "2026-10", new Map())).toMatchObject({ status: "sem_fonte", valor: null });
  });
  it("sem acesso ao Faturamento: lucratividade e custo sem fonte", () => {
    const c = contrato();
    expect(indLucratividade(c, undefined, false)).toMatchObject({ status: "sem_fonte", valor: null });
    expect(indCusto(c, "2026-10", null)).toMatchObject({ status: "sem_fonte", valor: null });
  });
});

describe("1. Postos", () => {
  it("coberto, atenção e crítico", () => {
    expect(indPostos(contrato()).status).toBe("ok");
    expect(indPostos(contrato({ postos: { contratados: 40, previsto: 40, implantado_registrado: true, cobertos: 39, afastados: 1 } }))).toMatchObject({ status: "atencao", valor: 97.5, texto: "39 de 40" });
    expect(indPostos(contrato({ postos: { contratados: 20, previsto: 20, implantado_registrado: false, cobertos: 15, afastados: 0 } })).status).toBe("critico");
  });
  it("mais gente que posto não é falta", () => {
    expect(indPostos(contrato({ postos: { contratados: 10, previsto: 10, implantado_registrado: false, cobertos: 12, afastados: 0 } })).status).toBe("ok");
  });
});

describe("2. Lucratividade", () => {
  const c = contrato();
  it("prejuízo é crítico; abaixo da prevista na licitação é atenção", () => {
    expect(indLucratividade(c, { receita: 100_000, custo: 110_000 }, true)).toMatchObject({ status: "critico", valor: -10 });
    expect(indLucratividade(c, { receita: 100_000, custo: 95_000 }, true)).toMatchObject({ status: "atencao", valor: 5 });
    expect(indLucratividade(c, { receita: 100_000, custo: 90_000 }, true)).toMatchObject({ status: "ok", valor: 10 });
  });
  it("sem lucro na Planilha usa o mínimo de 10%", () => {
    const s = contrato({ orcado: { custo_direto_por_mes: {}, margem_prevista: null } });
    expect(indLucratividade(s, { receita: 100_000, custo: 92_000 }, true).status).toBe("atencao");
  });
  it("receita pequena ou custo não lançado não acusa", () => {
    expect(indLucratividade(c, { receita: 5_000, custo: 9_000 }, true).status).toBe("sem_dado");
    expect(indLucratividade(c, { receita: 100_000, custo: 0 }, true).status).toBe("sem_dado");
  });
});

describe("3. Custo direto × orçado", () => {
  it("acumula só os meses do ano com despesa lançada", () => {
    const c = contrato();
    const real = new Map([["a|2026-09", 84_000], ["a|2026-10", 0]]);
    expect(indCusto(c, "2026-10", real)).toMatchObject({ status: "ok", valor: 5 });
    const alto = new Map([["a|2026-09", 90_000], ["a|2026-10", 90_000]]);
    expect(indCusto(c, "2026-10", alto)).toMatchObject({ status: "critico", valor: 12.5 });
  });
  it("mês depois da competência não entra", () => {
    const c = contrato();
    expect(indCusto(c, "2026-09", new Map([["a|2026-09", 86_000], ["a|2026-10", 999_999]]))).toMatchObject({ status: "atencao", valor: 7.5 });
  });
  it("sem despesa no ano: sem dado, não 'dentro do orçado'", () => {
    expect(indCusto(contrato(), "2026-10", new Map()).status).toBe("sem_dado");
  });
});

describe("4. Glosas", () => {
  it("zero é real (a fonte existe); glosa grande para a receita é crítica", () => {
    expect(indGlosas(contrato(), undefined)).toMatchObject({ status: "ok", valor: 0 });
    const c = contrato({ glosas: { valor: 3_000, qtd: 2, causa: "Posto descoberto" } });
    expect(indGlosas(c, { receita: 100_000, custo: 1 }).status).toBe("critico");
    expect(indGlosas(c, { receita: 500_000, custo: 1 }).status).toBe("atencao");
    expect(indGlosas(c, undefined).detalhe).toContain("Posto descoberto");
  });
});

describe("5. Faltas e 6. Turnover", () => {
  it("faltas = dias de atestado ÷ (efetivo × dias)", () => {
    const c = contrato({ efetivo: 10, atestados: { dias_pessoa: 12, pessoas: 3 } });
    expect(indFaltas(c, 30)).toMatchObject({ valor: 4, status: "atencao" });
    expect(indFaltas(contrato({ efetivo: 3 }), 30).status).toBe("sem_dado");
  });
  it("turnover: uma demissão sozinha ou efetivo pequeno não acusa", () => {
    expect(indTurnover(contrato({ efetivo: 20, demissoes: 1 })).status).toBe("ok");
    expect(indTurnover(contrato({ efetivo: 8, demissoes: 4 })).status).toBe("sem_dado");
    expect(indTurnover(contrato({ efetivo: 40, demissoes: 2 }))).toMatchObject({ valor: 5, status: "atencao" });
    expect(indTurnover(contrato({ efetivo: 20, demissoes: 2 }))).toMatchObject({ valor: 10, status: "critico" });
  });
});

describe("7. Reclamações", () => {
  it("notificações do cliente; satisfação sempre sem fonte no texto", () => {
    expect(indReclamacoes(contrato()).status).toBe("ok");
    const r = indReclamacoes(contrato({ reclamacoes: { qtd: 3, causa: "Atraso" } }));
    expect(r.status).toBe("critico");
    expect(r.detalhe).toContain("satisfação sem fonte");
  });
});

describe("ordem e filtro pelo pior", () => {
  const dados: DadosContratosRpc = {
    competencia: "2026-10", de: "2026-10-01", ate: "2026-10-31", dias: 31,
    janela_notificacoes: { de: "2026-08-03", ate: "2026-10-31" }, gerado_em: "",
    sem_contrato: { glosas_valor: 0, glosas_qtd: 0, reclamacoes_qtd: 0 },
    contratos: [
      contrato({ id: "a", nome: "ÁGUA LIMPA" }),
      contrato({ id: "b", nome: "BETA", postos: { contratados: 20, previsto: 20, implantado_registrado: false, cobertos: 10, afastados: 0 }, reclamacoes: { qtd: 1, causa: null } }),
      contrato({ id: "c", nome: "CENTRO", glosas: { valor: 500, qtd: 1, causa: null } }),
    ],
  };
  const fin = {
    doMes: new Map([["a", { receita: 100_000, custo: 80_000 }], ["b", { receita: 100_000, custo: 80_000 }], ["c", { receita: 100_000, custo: 80_000 }]]),
    custoPorMes: new Map<string, number>(),
  };
  const linhas = montarLinhas(dados, fin);

  it("gravidade: crítico 3, atenção 1", () => {
    expect(linhas.find((l) => l.id === "b")).toMatchObject({ criticos: 1, atencoes: 1, gravidade: 4 });
    expect(ordenar(linhas, "pior").map((l) => l.id)).toEqual(["b", "c", "a"]);
  });
  it("por coluna e filtros", () => {
    expect(ordenar(linhas, "glosas")[0].id).toBe("c");
    expect(filtrar(linhas, { busca: "", fora: "algum" }).map((l) => l.id)).toEqual(["b", "c"]);
    expect(filtrar(linhas, { busca: "", fora: "postos" }).map((l) => l.id)).toEqual(["b"]);
    expect(filtrar(linhas, { busca: "agua", fora: null }).map((l) => l.id)).toEqual(["a"]);
  });
  it("resumo por indicador", () => {
    const postos = resumir(linhas).find((r) => r.chave === "postos");
    expect(postos).toMatchObject({ criticos: 1, ok: 2 });
    expect(resumir(linhas).find((r) => r.chave === "custo")?.semBase).toBe(3);
  });
});
