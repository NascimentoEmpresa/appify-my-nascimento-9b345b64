import { describe, expect, it } from "vitest";
import {
  acoesDoMenu, contratosDoEncarregado, contratosQueTrocamDeEncarregado, ehLoginEncarregado, encarregadoEfetivo, montarArvore,
  validarLoginEncarregado, type ContratoOrg, type PainelOrg, type PessoaOrg,
} from "@/lib/operacional/organogramaOperacional";

// Organograma › Operacional (mig 20261117000100). As mesmas regras foram
// provadas no banco (PostgreSQL 18 descartável) — aqui, o espelho da tela.

const p = (id: number, nome: string, cargo = "", situacao = "Trabalhando"): PessoaOrg => ({ id, nome, cargo, situacao });
const c = (id: string, nome: string, enc: number | null, sup: number | null, colab = 5): ContratoOrg => ({
  id, nome, status: "ativo", encarregado_id: enc, supervisor_id: sup, colaboradores: colab,
});

const pessoas = [
  p(1, "GERENTE OPER", "GERENTE OPERACIONAL"), p(2, "ANA SUPERVISORA", "SUPERVISOR"), p(3, "BRUNO SUPERVISOR", "SUPERVISOR"),
  p(10, "IDALECIO", "ENCARREGADO"), p(11, "JOAO ENC", "ENCARREGADO"), p(12, "DEMITIDO ENC", "ENCARREGADO", "Demitido"),
  p(4, "CARLA SUPERVISORA", "SUPERVISOR"),
];
const painel = (contratos: ContratoOrg[]): PainelOrg => ({
  contratos, pessoas,
  papeis: [{ empregado_id: 1, papel: "gerente" }, { empregado_id: 4, papel: "supervisor" }],
  historico: [], pode_alterar: true,
});

describe("hierarquia: gerente › supervisores › encarregados › contratos", () => {
  const arv = montarArvore(painel([
    c("a", "UFFS", 10, 2), c("b", "PREF", 10, 3), c("c", "HOSPITAL", 11, 2), c("d", "NOVO", null, 2), c("e", "SOLTO", 11, null), c("f", "ORFAO", null, null),
  ]));

  it("o gerente vem do papel", () => expect(arv.gerente?.nome).toBe("GERENTE OPER"));

  it("supervisor aparece pelo contrato ou pelo cadastro (mesmo sem contrato)", () => {
    expect(arv.supervisores.map((s) => s.pessoa!.nome)).toEqual(["ANA SUPERVISORA", "BRUNO SUPERVISOR", "CARLA SUPERVISORA"]);
    expect(arv.supervisores[2].encarregados).toEqual([]);
  });

  it("encarregado fica sob o supervisor de cada contrato dele", () => {
    const ana = arv.supervisores[0];
    expect(ana.encarregados.map((e) => [e.pessoa.nome, e.contratos.map((x) => x.nome)])).toEqual([["IDALECIO", ["UFFS"]], ["JOAO ENC", ["HOSPITAL"]]]);
    expect(ana.semEncarregado.map((x) => x.nome)).toEqual(["NOVO"]);
    expect(arv.supervisores[1].encarregados.map((e) => [e.pessoa.nome, e.contratos.map((x) => x.nome)])).toEqual([["IDALECIO", ["PREF"]]]);
  });

  it("sem supervisor vai para a caixa à parte", () => {
    expect(arv.semSupervisor.pessoa).toBeNull();
    expect(arv.semSupervisor.encarregados.map((e) => e.pessoa.nome)).toEqual(["JOAO ENC"]);
    expect(arv.semSupervisor.semEncarregado.map((x) => x.nome)).toEqual(["ORFAO"]);
  });

  it("conta os contratos sem encarregado", () => {
    expect(arv.totalContratos).toBe(6);
    expect(arv.contratosSemEncarregado).toBe(2);
  });

  it("contratos de um encarregado no organograma inteiro", () => {
    expect(contratosDoEncarregado(painel([c("a", "UFFS", 10, 2), c("b", "PREF", 10, 3)]).contratos, 10).map((x) => x.nome)).toEqual(["UFFS", "PREF"]);
  });
});

describe("fonte do encarregado: só o organograma (Hierarquia de Postos removida)", () => {
  const mapa = new Map(pessoas.map((x) => [x.id, x]));

  it("definido no organograma é o encarregado", () => {
    expect(encarregadoEfetivo(c("a", "UFFS", 11, 2), mapa)).toEqual({ ids: [11], origem: "organograma" });
  });

  it("sem definição: ninguém (não há mais reserva)", () => {
    expect(encarregadoEfetivo(c("a", "UFFS", null, 2), mapa)).toEqual({ ids: [], origem: "nenhum" });
  });

  it("encarregado demitido não conta", () => {
    expect(encarregadoEfetivo(c("a", "UFFS", 12, 2), mapa)).toEqual({ ids: [], origem: "nenhum" });
  });
});

describe("menu de contexto", () => {
  it("contrato com encarregado e supervisor oferece mover, definir, trocar e remover", () => {
    expect(acoesDoMenu({ tipo: "contrato", contrato: c("a", "UFFS", 10, 2) }, true)).toEqual([
      "mover_contrato_encarregado", "mover_contrato_supervisor", "definir_encarregado", "trocar_supervisor",
      "remover_encarregado", "remover_supervisor_contrato", "historico_contrato",
    ]);
  });

  it("contrato sem encarregado não oferece remover encarregado", () => {
    expect(acoesDoMenu({ tipo: "contrato", contrato: c("a", "UFFS", null, null) }, true)).not.toContain("remover_encarregado");
  });

  it("pessoa: encarregado troca supervisor ou sai; colaborador vira encarregado", () => {
    expect(acoesDoMenu({ tipo: "encarregado", pessoa: pessoas[3], supervisorId: 2 }, true)).toEqual(["trocar_supervisor_encarregado", "tirar_encarregado_de_todos"]);
    expect(acoesDoMenu({ tipo: "colaborador", pessoa: pessoas[3], contrato: c("a", "UFFS", null, 2) }, true)).toEqual(["tornar_encarregado"]);
  });

  it("sem permissão de alterar: só o histórico do contrato", () => {
    expect(acoesDoMenu({ tipo: "contrato", contrato: c("a", "UFFS", 10, 2) }, false)).toEqual(["historico_contrato"]);
    expect(acoesDoMenu({ tipo: "supervisor", pessoa: pessoas[1] }, false)).toEqual([]);
  });
});

describe("login novo de encarregado", () => {
  it("reconhece encarregado pelo cargo (com ou sem acento) ou pelo setor", () => {
    expect(ehLoginEncarregado("ENCARREGADO DE LIMPEZA")).toBe(true);
    expect(ehLoginEncarregado("Encarregada")).toBe(true);
    expect(ehLoginEncarregado("Analista", ["Encarregados"])).toBe(true);
    expect(ehLoginEncarregado("Supervisor Operacional", ["Operacional"])).toBe(false);
  });

  it("não-encarregado passa sem contrato", () => {
    expect(validarLoginEncarregado({ cargo: "Analista de RH", setores: ["RH"], empregadoId: null, contratos: [] })).toBeNull();
  });

  it("encarregado sem colaborador do cadastro é recusado", () => {
    expect(validarLoginEncarregado({ cargo: "Encarregado", setores: [], empregadoId: null, contratos: ["a"] })).toMatch(/cadastro de colaboradores/);
  });

  it("encarregado sem contrato é recusado", () => {
    expect(validarLoginEncarregado({ cargo: "Encarregado", setores: [], empregadoId: 10, contratos: [] })).toMatch(/qual\(is\) contrato/);
  });

  it("encarregado com colaborador e contrato passa", () => {
    expect(validarLoginEncarregado({ cargo: "Encarregado", setores: ["Encarregados"], empregadoId: 10, contratos: ["a", "b"] })).toBeNull();
  });

  it("avisa quando o contrato escolhido já tem outro encarregado", () => {
    const opcoes = [
      { id: "a", nome: "UFFS", encarregado_id: 11, encarregado_nome: "JOAO ENC" },
      { id: "b", nome: "PREF", encarregado_id: 10, encarregado_nome: "IDALECIO" },
      { id: "c", nome: "NOVO", encarregado_id: null, encarregado_nome: null },
    ];
    expect(contratosQueTrocamDeEncarregado(["a", "b", "c"], opcoes, 10)).toEqual([{ nome: "UFFS", atual: "JOAO ENC" }]);
  });
});
