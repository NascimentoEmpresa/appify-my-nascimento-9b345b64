import { describe, expect, it } from "vitest";
import {
  acessoEfetivoAposSalvar,
  concedidosFinais,
  contarNovosModulos,
  filtrarNovosModulos,
  menuPendente,
  pessoasDaSelecao,
  planejarLinhasNovoModulo,
  resumoLiberacao,
  type AcessosGravados,
  type NovoModulo,
} from "@/lib/novosModulos";
import { ACOES_DO_TOGGLE_PADRAO } from "@/lib/acoesDoToggleAcesso";
import type { PessoaAcesso } from "@/lib/acessoPorSetorCargo";

/**
 * Novos Módulos (SIS-2026-0931): tela nova nasce bloqueada e só abre quando
 * um administrador libera. O que estes testes travam é onde um descuido vira
 * furo: quem entra pela seleção, o que salvar grava (e que nunca grava outra
 * tela), e a conta de "quantas pessoas vão ver" que decide se a tela abre.
 */

const pessoa = (id: string, p: Partial<PessoaAcesso> = {}): PessoaAcesso => ({
  id, nome: id, cargo: null, nivel: null, setores: [], ativo: true, ...p,
});

const tela = (codigo: string, p: Partial<NovoModulo> = {}): NovoModulo => ({
  codigo, nome: codigo, rota: `/app/${codigo}`, modulo_codigo: "sst", modulo_nome: "SST", modulo_novo: false,
  tipo: "submodulo", ativo: true, criado_em: "2026-11-17T12:00:00Z", situacao: "pendente", liberado_em: null,
  liberado_por_nome: null, pessoas_individuais: 0, perfis: 0, pessoas_com_acesso: 0, ...p,
});

describe("situação da linha de app_menu", () => {
  it("só liberado_em null é pendente — coluna ausente (front antes da migration) não trava nada", () => {
    expect(menuPendente({ liberado_em: null })).toBe(true);
    expect(menuPendente({ liberado_em: "2026-11-17T12:00:00Z" })).toBe(false);
    expect(menuPendente({})).toBe(false);
  });
});

describe("tabela da aba", () => {
  const lista = [
    tela("sst_acidentes", { nome: "Acidentes de Trabalho" }),
    tela("sup_epi", { nome: "Entrega de EPIs", modulo_nome: "Suprimentos", situacao: "liberado" }),
    tela("fin_osc", { nome: "Gestão da Escola", modulo_nome: "Financeiro", situacao: "liberado_antes" }),
  ];

  it("conta pendentes e liberados (liberado antes do controle conta como liberado)", () => {
    expect(contarNovosModulos(lista)).toEqual({ total: 3, pendentes: 1, liberados: 2 });
  });

  it("filtra por situação", () => {
    expect(filtrarNovosModulos(lista, "", "pendentes").map((m) => m.codigo)).toEqual(["sst_acidentes"]);
    expect(filtrarNovosModulos(lista, "", "liberados").map((m) => m.codigo)).toEqual(["sup_epi", "fin_osc"]);
    expect(filtrarNovosModulos(lista, "", "todas")).toHaveLength(3);
  });

  it("busca sem acento por nome, módulo, código ou rota", () => {
    expect(filtrarNovosModulos(lista, "gestao", "todas").map((m) => m.codigo)).toEqual(["fin_osc"]);
    expect(filtrarNovosModulos(lista, "SUPRIMENTOS", "todas").map((m) => m.codigo)).toEqual(["sup_epi"]);
    expect(filtrarNovosModulos(lista, "/app/sst_", "todas").map((m) => m.codigo)).toEqual(["sst_acidentes"]);
  });
});

describe("seleção por setor e cargo", () => {
  const pessoas = [
    pessoa("ana", { setores: ["SST"], cargo: "TÉCNICO DE SEGURANÇA" }),
    pessoa("bia", { setores: ["RH", "SST"], cargo: "ANALISTA" }),
    pessoa("caio", { setores: ["RH"], cargo: "ANALISTA" }),
    pessoa("davi", { setores: ["SST"], ativo: false }),
  ];

  it("traz quem é do setor ou do cargo, com o motivo, e deixa login inativo de fora", () => {
    const via = pessoasDaSelecao(pessoas, new Set(["SST"]), new Set(["ANALISTA"]));
    expect([...via.keys()].sort()).toEqual(["ana", "bia", "caio"]);
    expect(via.get("bia")).toEqual(["setor SST", "cargo ANALISTA"]);
    expect(via.has("davi")).toBe(false);
  });

  it("sem setor nem cargo marcado não traz ninguém", () => {
    expect(pessoasDaSelecao(pessoas, new Set(), new Set()).size).toBe(0);
  });

  it("os concedidos são a união do marcado à mão com o que veio do grupo", () => {
    const via = pessoasDaSelecao(pessoas, new Set(["RH"]), new Set());
    expect([...concedidosFinais(new Set(["ana"]), via)].sort()).toEqual(["ana", "bia", "caio"]);
  });
});

describe("o que salvar grava", () => {
  const gravado: AcessosGravados = {
    pendente: true,
    individuais: [
      { user_id: "bruno", allow: true },  // seed do desenvolvedor
      { user_id: "elisa", allow: false },
    ],
    perfis: [{ id: "perfil-sst", nome: "SST", pessoas: ["carla", "elisa"] }],
  };

  it("salvar sem mexer no preparado não grava nada (só libera o que já estava preparado)", () => {
    const r = planejarLinhasNovoModulo("sst_nova", gravado, new Set(["bruno"]));
    expect(r.linhas).toEqual([]);
  });

  it("quem entra recebe o pacote do toggle; quem sai recebe o pacote com false", () => {
    const r = planejarLinhasNovoModulo("sst_nova", gravado, new Set(["diego"]));
    expect(r.adicionados).toEqual(["diego"]);
    expect(r.removidos).toEqual(["bruno"]);
    expect(r.linhas.filter((l) => l.user_id === "diego" && l.allow).map((l) => l.acao)).toEqual([...ACOES_DO_TOGGLE_PADRAO]);
    expect(r.linhas.filter((l) => l.user_id === "bruno").every((l) => !l.allow)).toBe(true);
    expect(r.linhas.filter((l) => l.user_id === "bruno").map((l) => l.acao)).toEqual([...ACOES_DO_TOGGLE_PADRAO]);
  });

  it("nunca escreve outra tela — liberar um submódulo não libera outro", () => {
    const r = planejarLinhasNovoModulo("sst_nova", gravado, new Set(["diego", "ana"]));
    expect(new Set(r.linhas.map((l) => l.menu_codigo))).toEqual(new Set(["sst_nova"]));
  });

  it("respeita as ações fora do pacote (Fechamento dos Sócios só ganha visualizar)", () => {
    const r = planejarLinhasNovoModulo("fechamento-socios", { individuais: [] }, new Set(["x"]));
    expect(r.linhas.map((l) => l.acao)).not.toContain("alterar");
    expect(r.linhas.map((l) => l.acao)).not.toContain("aprovar");
  });
});

describe("quantas pessoas vão ver (decide se a tela abre)", () => {
  const gravado: AcessosGravados = {
    pendente: true,
    individuais: [{ user_id: "bruno", allow: true }, { user_id: "elisa", allow: false }],
    perfis: [{ id: "perfil-sst", nome: "SST", pessoas: ["carla", "elisa"] }],
  };

  it("preparado do jeito que veio: Bruno (individual) + Carla (perfil); Elisa negada fica fora", () => {
    const e = acessoEfetivoAposSalvar({ gravado, concedidos: new Set(["bruno"]), perfisMantidos: new Set(["perfil-sst"]) });
    expect([...e].sort()).toEqual(["bruno", "carla"]);
  });

  it("tirar o perfil tira só quem vinha por ele", () => {
    const e = acessoEfetivoAposSalvar({ gravado, concedidos: new Set(["bruno"]), perfisMantidos: new Set() });
    expect([...e]).toEqual(["bruno"]);
  });

  it("desmarcar quem também está no perfil tira de verdade (vira allow=false)", () => {
    const comCarla: AcessosGravados = { ...gravado, individuais: [...gravado.individuais, { user_id: "carla", allow: true }] };
    const e = acessoEfetivoAposSalvar({ gravado: comCarla, concedidos: new Set(["bruno"]), perfisMantidos: new Set(["perfil-sst"]) });
    expect(e.has("carla")).toBe(false);
  });

  it("marcar a Elisa à mão vence o negado antigo", () => {
    const e = acessoEfetivoAposSalvar({ gravado, concedidos: new Set(["elisa"]), perfisMantidos: new Set() });
    expect([...e]).toEqual(["elisa"]);
  });

  it("zero pessoas = a tela fica bloqueada", () => {
    expect(resumoLiberacao(0, true)).toMatch(/bloqueada para todos/);
    expect(resumoLiberacao(1, true)).toMatch(/1 pessoa terá acesso ao salvar/);
    expect(resumoLiberacao(3, false)).toBe("3 pessoas terão acesso.");
  });
});
