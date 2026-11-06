import { describe, it, expect } from "vitest";
import { montarEstrutura, papelDe, casaSetor, nomeSetor } from "@/lib/organograma/estruturaSetores";
import type { NoPessoa } from "@/lib/organograma/pessoas";

// Dados de exemplo (sem pessoas reais).
let seq = 0;
function p(id: string, parent: string | null, setor: string | null, funcao: string, extra: Partial<NoPessoa> = {}): NoPessoa {
  return {
    id, parent_id: parent, ordem: seq++, nome: `PESSOA ${id.toUpperCase()}`, setor, par_grupo: null, do_grupo: false, contrato: null,
    superior_pendente: false, empresa: 1, filial: 1, contratos_extras: [], user_id: null, empregado_id: null, funcao_manual: funcao,
    email: null, avatar_url: null, cargo: null, ativo: true, cor: null, superior_origem: "manual", posto_codigo: null, posto_nome: null, ...extra,
  };
}

const nos = [
  p("c1", null, null, "Conselheiro"), p("c2", null, null, "Conselheira"),
  p("pr", "c1", null, "Presidente"),
  p("g1", "pr", "FINANCEIRO", "Gerente Financeiro"), p("a1", "g1", "FINANCEIRO", "Analista"), p("a2", "a1", "FINANCEIRO", "Assistente"),
  p("g2", "pr", "RH", "Gerente de RH"), p("r1", "g2", "RH", "Analista de RH"),
  p("j1", "c2", "JURIDICO", "Advogada"),
  p("o1", "g2", null, "Supervisor", { contrato: "CONTRATO X" }), p("o2", "o1", null, "Vigilante", { contrato: "CONTRATO X" }),
  p("x1", "pr", "RH", "Desligado", { ativo: false }),
];

describe("Organograma — visão Estrutura", () => {
  const e = montarEstrutura(nos);

  it("conselho e presidência pela função", () => {
    expect(e.conselho.map((n) => n.id)).toEqual(["c1", "c2"]);
    expect(e.presidencia.map((n) => n.id)).toEqual(["pr"]);
    expect(papelDe({ funcao_manual: "Vice-Presidente", cargo: null })).toBeNull();
  });

  it("cada setor abre pelas cabeças: quem responde para fora do setor", () => {
    const fin = e.setores.find((s) => s.chave === "FINANCEIRO")!;
    expect(fin.cabecas.map((n) => n.id)).toEqual(["g1"]);
    expect(fin.membros).toHaveLength(3);
    expect(e.equipeDe("g1").map((n) => n.id)).toEqual(["a1"]);
    expect(e.totalAbaixo("g1")).toBe(2);
  });

  it("setor ligado a conselheiro sabe a quem responde; o da presidência também", () => {
    expect(e.setores.find((s) => s.chave === "JURIDICO")!.ligadoA).toBe("c2");
    expect(e.setores.find((s) => s.chave === "RH")!.ligadoA).toBe("pr");
  });

  it("quem não tem setor vai para o contrato; inativo fica de fora", () => {
    expect(e.contratos.map((c) => [c.nome, c.cabecas.map((n) => n.id)])).toEqual([["CONTRATO X", ["o1"]]]);
    expect(e.setores.find((s) => s.chave === "RH")!.membros.map((n) => n.id)).toEqual(["g2", "r1"]);
  });

  it("sem título em ninguém, o topo da árvore vira a presidência", () => {
    const sem = montarEstrutura([p("t", null, null, "Diretor"), p("f", "t", "TI", "Analista")]);
    expect(sem.presidencia.map((n) => n.id)).toEqual(["t"]);
    expect(sem.setores.map((s) => s.chave)).toEqual(["TI"]);
    expect(nomeSetor("LICITACAO")).toBe("Licitação");
  });

  it("busca acha o setor pelo nome ou por alguém dentro dele", () => {
    const fin = e.setores.find((s) => s.chave === "FINANCEIRO")!;
    expect(casaSetor(fin, "assist")).toBe(true);
    expect(casaSetor(fin, "vigil")).toBe(false);
  });
});

describe("Organograma — Estrutura com o cadastro real (regras de 06/11)", () => {
  const dados = [
    p("dona", null, "PRESIDÊNCIA", "PROPRIETÁRIA"), p("dono", null, "Diretor Operacional", "PROPRIETÁRIO"),
    p("pres", "dona", "PRESIDÊNCIA", "PRESIDENTE"),
    p("ctrl", "pres", "CONTROLADORIA", "Gerente Controladoria"), p("ctl2", "ctrl", "CONTROLADORIA", "Analista"),
    p("dadm", "ctl2", "DIRETOR ADMINISTRATIVO", "Diretora Administrativa"),
    p("dop", "ctl2", "Diretor Operacional", "Diretor"), p("dop2", "dop", "DIRETOR OPERACIONAL", "Assistente"),
    p("rh", "dadm", "RH", "Gerente de RH"), p("jur", "rh", "JURIDICO", "Advogada"),
    p("comp", "dop", "COMPRAS", "Gerente"),
    p("campo", "rh", "PADRAO", "Servente", { contrato: "1109 - LIMPEZA" }),
  ];
  const e = montarEstrutura(dados);
  const ramo = (s: { nome: string; filhos: any[] }): unknown => s.filhos.length ? { [s.nome]: s.filhos.map(ramo) } : s.nome;

  it("proprietários são o Conselho; presidente, a Presidência", () => {
    expect(e.conselho.map((n) => n.id)).toEqual(["dona", "dono"]);
    expect(e.presidencia.map((n) => n.id)).toEqual(["pres"]);
  });

  it("setores pela cadeia de comando, com nome normalizado e sem PADRAO/PRESIDÊNCIA", () => {
    expect(e.raiz.map(ramo)).toEqual([{
      Controladoria: [
        { "Diretoria Administrativa": [{ RH: ["Jurídico"] }] },
        { "Diretoria Operacional": ["Compras"] },
      ],
    }]);
    expect(e.setores.find((s) => s.nome === "Diretoria Operacional")!.membros.map((n) => n.id)).toEqual(["dop", "dop2"]);
    expect(e.raiz[0].ligadoA).toBe("pres");
  });

  it("quem é PADRAO vai para o contrato", () => {
    expect(e.contratos.map((c) => c.nome)).toEqual(["1109 - LIMPEZA"]);
  });

  it("ciclo entre setores não some com eles: vão para a raiz", () => {
    const ciclo = montarEstrutura([
      p("x", "y2", "A", "Gerente"), p("y", "x", "B", "Gerente"), p("y2", "y", "B", "Analista"),
    ]);
    expect(ciclo.setores).toHaveLength(2);
    expect(ciclo.raiz.length).toBeGreaterThanOrEqual(1);
  });
});
