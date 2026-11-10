import { describe, expect, it } from "vitest";
import {
  cargoUsadoPeloMalote,
  limparNomeCargo,
  pessoasDoGrupo,
  planejarAplicacao,
  sugerirNivelPorCargo,
  telasDoGrupo,
  telasDoModeloParaPessoa,
  telasFaltando,
  telasForaDoModelo,
  type ModeloAcesso,
  type PessoaAcesso,
} from "@/lib/acessoPorSetorCargo";
import { ACOES_DO_TOGGLE_PADRAO } from "@/lib/acoesDoToggleAcesso";

/**
 * Liberação em massa por Setor e Cargo (SIS-2026-0851).
 *
 * O que estes testes travam é onde um descuido vira furo de permissão:
 * quem entra no grupo, o que liberar grava, que remover só sai quando o admin
 * marca, e que Administrador Geral nunca recebe allow=false em massa (a
 * exceção individual vence o concede_tudo e o trancaria para sempre).
 */

const pessoa = (id: string, p: Partial<PessoaAcesso> = {}): PessoaAcesso => ({
  id, nome: id, cargo: null, nivel: "adm", setores: ["RH"], ativo: true, ...p,
});

describe("cargo como lista", () => {
  it("limpa o nome do jeito que o catálogo guarda", () => {
    expect(limparNomeCargo("encaregado")).toBe("ENCARREGADO");
    expect(limparNomeCargo("CONTABIIDADE")).toBe("CONTABILIDADE");
    expect(limparNomeCargo("  Supervisor ")).toBe("SUPERVISOR");
    expect(limparNomeCargo("Analista  de   Licitação")).toBe("ANALISTA DE LICITAÇÃO");
    expect(limparNomeCargo("   ")).toBeNull();
    expect(limparNomeCargo(null)).toBeNull();
  });

  it("sugere o nível pelo nome, na mesma ordem da migration", () => {
    expect(sugerirNivelPorCargo("GERENTE DE SISTEMAS")).toBe("gerente");
    expect(sugerirNivelPorCargo("Supervisor Operacional")).toBe("supervisor");
    expect(sugerirNivelPorCargo("DIRETORA ADMINISTRATIVA")).toBe("diretor");
    expect(sugerirNivelPorCargo("PRESIDENTE")).toBe("presidente");
    expect(sugerirNivelPorCargo("Jovem Aprendiz")).toBe("aprendiz");
    expect(sugerirNivelPorCargo("Encarregado Administrativa")).toBe("adm");
    expect(sugerirNivelPorCargo("")).toBe("adm");
  });

  it("aponta os cargos que as regras do Malote leem pelo texto", () => {
    expect(cargoUsadoPeloMalote("GERENTE FINANCEIRO")).toBe(true);
    expect(cargoUsadoPeloMalote("PRESIDENTE")).toBe(true);
    expect(cargoUsadoPeloMalote("SUPERVISOR CONTROLADORIA")).toBe(true);
    expect(cargoUsadoPeloMalote("ANALISTA DESENV. DE SISTEMAS I")).toBe(true);
    expect(cargoUsadoPeloMalote("ASSISTENTE SST")).toBe(false);
    // Malote compara PRESIDENTE com igualdade, não "contém".
    expect(cargoUsadoPeloMalote("VICE PRESIDENTE")).toBe(false);
  });
});

describe("quem é do grupo", () => {
  const pessoas = [
    pessoa("ana", { setores: ["RH"], nivel: "gerente" }),
    pessoa("bia", { setores: ["RH", "Financeiro"], nivel: "adm" }),
    pessoa("caio", { setores: ["Financeiro"], nivel: "adm" }),
    pessoa("davi", { setores: ["RH"], nivel: "adm", ativo: false }),
  ];

  it("nível nulo pega o setor inteiro, só gente ativa", () => {
    expect(pessoasDoGrupo(pessoas, "RH", null).map((p) => p.id)).toEqual(["ana", "bia"]);
  });

  it("pessoa com dois setores entra nos dois grupos", () => {
    expect(pessoasDoGrupo(pessoas, "Financeiro", "adm").map((p) => p.id)).toEqual(["bia", "caio"]);
  });
});

describe("telas do modelo — SOMA de setor · todos com setor · nível", () => {
  const modelos: ModeloAcesso[] = [
    { id: "1", setor: "RH", nivel: null, telas: ["ferias", "rh_inicio"] },
    { id: "2", setor: "RH", nivel: "gerente", telas: ["rh_rateio_despesas"] },
    { id: "3", setor: "Financeiro", nivel: null, telas: ["contas-pagar"] },
  ];

  it("o grupo de um nível leva também o que é do setor inteiro", () => {
    expect([...telasDoGrupo(modelos, "RH", "gerente")].sort()).toEqual(["ferias", "rh_inicio", "rh_rateio_despesas"]);
    expect([...telasDoGrupo(modelos, "RH", null)].sort()).toEqual(["ferias", "rh_inicio"]);
  });

  it("a pessoa soma os modelos de cada setor dela", () => {
    const bia = pessoa("bia", { setores: ["RH", "Financeiro"], nivel: "adm" });
    expect([...telasDoModeloParaPessoa(modelos, bia)].sort()).toEqual(["contas-pagar", "ferias", "rh_inicio"]);
  });
});

describe("planejarAplicacao", () => {
  const validos = new Set(["contas-pagar", "operacional_diarias", "ferias", "desligada_nao"].filter((t) => t !== "desligada_nao"));

  it("libera o pacote do toggle só para quem ainda não vê a tela", () => {
    const plano = planejarAplicacao({
      pessoas: [pessoa("ana"), pessoa("bia")],
      liberar: ["contas-pagar"],
      remover: [],
      efetivo: new Map([["ana", new Set(["contas-pagar"])]]),
      adminGeral: new Set(),
      menusValidos: validos,
    });
    expect(plano.jaTem).toBe(1);
    expect(plano.linhas.every((l) => l.user_id === "bia" && l.allow)).toBe(true);
    expect(plano.linhas.map((l) => l.acao)).toEqual([...ACOES_DO_TOGGLE_PADRAO]);
    expect(plano.porPessoa.has("ana")).toBe(false);
  });

  it("liberar respeita as ações fora do toggle (Diárias não ganha aprovar)", () => {
    const plano = planejarAplicacao({
      pessoas: [pessoa("ana")], liberar: ["operacional_diarias"], remover: [],
      efetivo: new Map(), adminGeral: new Set(), menusValidos: validos,
    });
    const acoes = plano.linhas.map((l) => l.acao);
    expect(acoes).not.toContain("aprovar");
    expect(acoes).not.toContain("enviar_malote");
  });

  it("remover só sai de quem vê, e grava o pacote inteiro com false", () => {
    const plano = planejarAplicacao({
      pessoas: [pessoa("ana"), pessoa("bia")],
      liberar: [],
      remover: ["operacional_diarias"],
      efetivo: new Map([["ana", new Set(["operacional_diarias"])]]),
      adminGeral: new Set(), menusValidos: validos,
    });
    expect(new Set(plano.linhas.map((l) => l.user_id))).toEqual(new Set(["ana"]));
    expect(plano.linhas.every((l) => !l.allow)).toBe(true);
    // Desligar revoga também as exceções — senão sobra um 'aprovar' pendurado.
    expect(plano.linhas.map((l) => l.acao)).toEqual(expect.arrayContaining(["visualizar", "aprovar", "enviar_malote"]));
  });

  it("Administrador Geral nunca entra em remoção", () => {
    const plano = planejarAplicacao({
      pessoas: [pessoa("chefe")],
      liberar: [],
      remover: ["contas-pagar"],
      efetivo: new Map([["chefe", new Set(["contas-pagar"])]]),
      adminGeral: new Set(["chefe"]),
      menusValidos: validos,
    });
    expect(plano.linhas).toEqual([]);
    expect(plano.adminGeralPoupados).toEqual(["chefe"]);
  });

  it("tela inativa ou fora do gerenciamento é descartada; a mesma tela não é liberada e removida juntas", () => {
    const plano = planejarAplicacao({
      pessoas: [pessoa("ana")],
      liberar: ["desligada_nao", "ferias"],
      remover: ["ferias"],
      efetivo: new Map(), adminGeral: new Set(), menusValidos: validos,
    });
    expect(new Set(plano.linhas.map((l) => l.menu_codigo))).toEqual(new Set(["ferias"]));
    expect(plano.linhas.every((l) => l.allow)).toBe(true);
  });
});

describe("prévia: fora do modelo e faltando", () => {
  const modelos: ModeloAcesso[] = [{ id: "1", setor: "RH", nivel: null, telas: ["ferias"] }];
  const validos = new Set(["ferias", "contas-pagar"]);
  const efetivo = new Map([
    ["ana", new Set(["ferias", "contas-pagar", "tela_fora_do_gerenciamento"])],
    ["chefe", new Set(["ferias", "contas-pagar"])],
    ["bia", new Set<string>()],
  ]);

  it("conta quem tem tela fora do modelo, sem Administrador Geral", () => {
    const fora = telasForaDoModelo([pessoa("ana"), pessoa("chefe"), pessoa("bia")], modelos, efetivo, new Set(["chefe"]), validos);
    expect([...fora]).toEqual([["contas-pagar", 1]]);
  });

  it("diz quais telas do modelo a pessoa ainda não vê", () => {
    expect(telasFaltando(pessoa("bia"), modelos, efetivo, validos)).toEqual(["ferias"]);
    expect(telasFaltando(pessoa("ana"), modelos, efetivo, validos)).toEqual([]);
  });
});
