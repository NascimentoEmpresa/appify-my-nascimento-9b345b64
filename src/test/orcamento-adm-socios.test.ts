import { describe, expect, it } from "vitest";
import type { OrcamentoContratoGrupo } from "@/hooks/useOrcamentoContratos";
import type { UtilizadoOrcamentoLinha } from "@/hooks/useUtilizadoOrcamento";
import {
  agruparPorSetor, aplicarEmGrupo, alternarContrato, alternarEmpresa, configVazia, equipesDasPessoas, filtrarPessoas, pessoaDaEquipe, resumoContratos, saldoDaClassificacao,
  ordenarPessoas, setorDaPessoa, type ConfigPessoa, type PessoaOrcamento,
} from "@/pages/malote/orcamento-adm-socios/regras";

// SIS-2026-0858: Orçamento ADM e Sócios por integrante (regras do HTML do Iury).
const grupo = (id: string, nome: string, empresa: string, valores: Record<string, number>): OrcamentoContratoGrupo => ({
  contrato: { id, nome, empresa_id: empresa } as any,
  rubricas: Object.entries(valores).map(([malote, valor]) => ({ campo: malote, label: malote, grupo: "g", valor, classificacaoMaloteId: malote })),
  valorTotal: Object.values(valores).reduce((s, v) => s + v, 0),
});
const gasto = (extra: Partial<UtilizadoOrcamentoLinha>): UtilizadoOrcamentoLinha => ({
  despesa_id: "d", id_malote: "M1", descricao: "", status: "Despesa Paga" as any, competencia: "2026-10-01", data_pagamento: "2026-10-05", forma_pagamento: null,
  classificacao_id: "indiretos", classificacao_nome: "", empresa_id: "hagg", empresa_nome: "", contrato_id: "c1", contrato_nome: "UFRGS", valor: 0, ...extra,
});
const pessoa = (id: string, nome: string, setores: string[]): PessoaOrcamento => ({ userId: id, nome, setores });

describe("configuração em grupo (regra 4)", () => {
  const base = new Map<string, ConfigPessoa>([
    ["1", { classificacaoId: "velha", contratoIds: ["x"] }],
    ["2", { classificacaoId: "outra", contratoIds: ["y"] }],
  ]);
  it("copia a classificação e os contratos só para as pessoas marcadas, substituindo o que tinham", () => {
    const r = aplicarEmGrupo(base, new Set(["1", "3"]), "indiretos", ["c1", "c2"]);
    expect(r.get("1")).toEqual({ classificacaoId: "indiretos", contratoIds: ["c1", "c2"] });
    expect(r.get("3")).toEqual({ classificacaoId: "indiretos", contratoIds: ["c1", "c2"] });
    expect(r.get("2")).toEqual({ classificacaoId: "outra", contratoIds: ["y"] });
  });
  it("não altera o mapa original nem compartilha a lista de contratos entre as pessoas", () => {
    const contratos = ["c1"];
    const r = aplicarEmGrupo(base, new Set(["1", "2"]), "indiretos", contratos);
    expect(base.get("1")?.classificacaoId).toBe("velha");
    r.get("1")!.contratoIds.push("zzz");
    expect(r.get("2")!.contratoIds).toEqual(["c1"]);
    expect(contratos).toEqual(["c1"]);
  });
});

describe("contratos por empresa (regra 3)", () => {
  const empresas = [{ id: "hagg", nome: "HAGG" }, { id: "nh", nome: "NH" }];
  const contratos = [
    { id: "uffs", nome: "UFFS - 041/2021", empresaId: "hagg" }, { id: "furg", nome: "FURG - 55/2023", empresaId: "hagg" },
    { id: "ufrgs", nome: "UFRGS - 047/2022", empresaId: "nh" },
  ];
  it("marcar a empresa marca todos os contratos dela sem mexer nos das outras; desmarcar tira só os dela", () => {
    expect(alternarEmpresa(["ufrgs"], ["uffs", "furg"], true).sort()).toEqual(["furg", "ufrgs", "uffs"].sort());
    expect(alternarEmpresa(["uffs", "furg", "ufrgs"], ["uffs", "furg"], false)).toEqual(["ufrgs"]);
  });
  it("contrato individual entra e sai", () => {
    expect(alternarContrato(["uffs"], "furg", true)).toEqual(["uffs", "furg"]);
    expect(alternarContrato(["uffs", "furg"], "uffs", false)).toEqual(["furg"]);
  });
  it("o resumo diz 'Todos os contratos' quando marcou a empresa inteira e lista os contratos quando marcou só alguns", () => {
    expect(resumoContratos(empresas, contratos, ["uffs", "furg", "ufrgs"])).toBe("HAGG — Todos os contratos · NH — Todos os contratos");
    expect(resumoContratos(empresas, contratos, ["uffs"])).toBe("UFFS - 041/2021");
    expect(resumoContratos(empresas, contratos, [])).toBe("");
  });
});

describe("equipes e busca", () => {
  const ps = [pessoa("1", "IURY", ["Sistemas"]), pessoa("2", "GUIOMAR", ["Diretor Adm", "Diretor Operacional"]), pessoa("3", "NOVO", [])];
  it("lista as equipes (setores), com 'Sem setor' para quem não tem", () => {
    expect(equipesDasPessoas(ps)).toEqual(["Diretor Adm", "Diretor Operacional", "Sem setor", "Sistemas"]);
    expect(setorDaPessoa(ps[2])).toBe("Sem setor");
    expect(setorDaPessoa(ps[1])).toBe("Diretor Adm · Diretor Operacional");
  });
  it("a pessoa com mais de um setor entra nas duas equipes", () => {
    expect(pessoaDaEquipe(ps[1], "Diretor Adm")).toBe(true);
    expect(pessoaDaEquipe(ps[1], "Diretor Operacional")).toBe(true);
    expect(pessoaDaEquipe(ps[1], "Sistemas")).toBe(false);
    expect(pessoaDaEquipe(ps[2], "Sem setor")).toBe(true);
  });
  it("busca por nome ou setor, sem diferenciar maiúscula", () => {
    expect(filtrarPessoas(ps, "iury").map((p) => p.userId)).toEqual(["1"]);
    expect(filtrarPessoas(ps, "diretor").map((p) => p.userId)).toEqual(["2"]);
    expect(filtrarPessoas(ps, "  ")).toHaveLength(3);
  });
});

describe("saldo da classificação (regra 5)", () => {
  it("orçado R$ 1.000 em um contrato, já usado R$ 100 no mês → saldo R$ 900", () => {
    expect(saldoDaClassificacao([grupo("c1", "UFRGS", "hagg", { indiretos: 1000 })], [gasto({ valor: 100 })], "indiretos", "2026-10")).toBe(900);
  });
  it("soma os contratos e um contrato estourado não come o saldo de outro", () => {
    const g = [grupo("c1", "UFRGS", "hagg", { indiretos: 1000 }), grupo("c2", "SAMU", "nh", { indiretos: 500 })];
    expect(saldoDaClassificacao(g, [gasto({ valor: 1500 }), gasto({ contrato_id: "c2", valor: 100 })], "indiretos", "2026-10")).toBe(400);
  });
  it("só conta o mês escolhido e a própria classificação; contrato ADMINISTRATIVO não entra", () => {
    const g = [grupo("c1", "UFRGS", "hagg", { indiretos: 1000, outra: 50 }), grupo("c9", "ADMINISTRATIVO NH", "nh", { indiretos: 777 })];
    expect(saldoDaClassificacao(g, [gasto({ valor: 100, competencia: "2026-09-01" }), gasto({ valor: 30, classificacao_id: "outra" })], "indiretos", "2026-10")).toBe(1000);
  });
  it("com contratos escolhidos, soma só eles (saldo muda conforme a seleção)", () => {
    const g = [grupo("c1", "UFRGS", "hagg", { indiretos: 1000 }), grupo("c2", "SAMU", "nh", { indiretos: 500 })];
    const gastos = [gasto({ valor: 100 })];
    expect(saldoDaClassificacao(g, gastos, "indiretos", "2026-10", ["c1", "c2"])).toBe(1400);
    expect(saldoDaClassificacao(g, gastos, "indiretos", "2026-10", ["c1"])).toBe(900);
    expect(saldoDaClassificacao(g, gastos, "indiretos", "2026-10", ["c2"])).toBe(500);
  });
  it("classificação sem nenhum contrato escolhido não tem saldo", () => {
    expect(saldoDaClassificacao([grupo("c1", "UFRGS", "hagg", { indiretos: 1000 })], [], "indiretos", "2026-10", [])).toBeNull();
  });
  it("sem classificação escolhida não há saldo", () => {
    expect(saldoDaClassificacao([], [], null, "2026-10")).toBeNull();
  });
});

describe("o que precisa de linha no banco", () => {
  it("configuração vazia não precisa; com origem ou contrato precisa", () => {
    expect(configVazia(undefined)).toBe(true);
    expect(configVazia({ classificacaoId: null, contratoIds: [] })).toBe(true);
    expect(configVazia({ classificacaoId: "a", contratoIds: [] })).toBe(false);
    expect(configVazia({ classificacaoId: null, contratoIds: ["c1"] })).toBe(false);
  });
});

describe("ordem da lista: por setor ou pela coluna clicada", () => {
  const ps = [
    pessoa("1", "ZÉ", ["Sistemas"]), pessoa("2", "ANA", ["RH"]), pessoa("3", "BIA", ["Sistemas"]), pessoa("4", "CAIO", []), pessoa("5", "DAN", ["RH"]),
  ];
  const origem: Record<string, string> = { "1": "SALÁRIO", "2": "", "3": "CUSTOS INDIRETOS", "4": "", "5": "SALÁRIO" };
  const saldo: Record<string, number | null> = { "1": 500, "2": null, "3": 100, "4": null, "5": 900 };
  const valores = { origem: (p: PessoaOrcamento) => origem[p.userId], saldo: (p: PessoaOrcamento) => saldo[p.userId] };
  const nomes = (l: PessoaOrcamento[]) => l.map((p) => p.nome);

  it("por setor: um bloco por setor, nome dentro dele, 'Sem setor' por último", () => {
    const l = ordenarPessoas(ps, "setor", "asc", valores);
    expect(nomes(l)).toEqual(["ANA", "DAN", "BIA", "ZÉ", "CAIO"]);
    expect(agruparPorSetor(l).map((b) => [b.setor, b.pessoas.length])).toEqual([["RH", 2], ["Sistemas", 2], ["Sem setor", 1]]);
  });
  it("por nome, nos dois sentidos", () => {
    expect(nomes(ordenarPessoas(ps, "nome", "asc", valores))).toEqual(["ANA", "BIA", "CAIO", "DAN", "ZÉ"]);
    expect(nomes(ordenarPessoas(ps, "nome", "desc", valores))).toEqual(["ZÉ", "DAN", "CAIO", "BIA", "ANA"]);
  });
  it("por origem: sem origem vai por último, mesmo invertendo", () => {
    expect(nomes(ordenarPessoas(ps, "origem", "asc", valores))).toEqual(["BIA", "DAN", "ZÉ", "ANA", "CAIO"]);
    expect(nomes(ordenarPessoas(ps, "origem", "desc", valores))).toEqual(["DAN", "ZÉ", "BIA", "ANA", "CAIO"]);
  });
  it("por saldo: sem saldo vai por último, mesmo invertendo", () => {
    expect(nomes(ordenarPessoas(ps, "saldo", "asc", valores))).toEqual(["BIA", "ZÉ", "DAN", "ANA", "CAIO"]);
    expect(nomes(ordenarPessoas(ps, "saldo", "desc", valores))).toEqual(["DAN", "ZÉ", "BIA", "ANA", "CAIO"]);
  });
  it("não altera a lista original", () => {
    const antes = nomes(ps);
    ordenarPessoas(ps, "nome", "desc", valores);
    expect(nomes(ps)).toEqual(antes);
  });
});
