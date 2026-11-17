import { describe, expect, it } from "vitest";
import {
  abrangencia, analisarImpacto, emAberto, incluirPosicao, modulosDoChamado, normalizarLista, pendenciasImpacto, separarModulos, trocarPosicao,
  type ChamadoImpacto,
} from "@/lib/chamados/impactoSistemico";

// SIS-2026-0910 — Formulário moderno de impacto sistêmico em chamados.
describe("Impacto sistêmico — formulário", () => {
  it("normaliza a lista: trim, sem vazios, sem repetidos, na ordem", () => {
    expect(normalizarLista([" Financeiro", "", null, "Controladoria", "Financeiro"])).toEqual(["Financeiro", "Controladoria"]);
    expect(normalizarLista(null)).toEqual([]);
  });

  it("a posição entra nos impactados (em primeiro), 'outro' e vazio não", () => {
    expect(incluirPosicao(["controladoria"], "financeiro")).toEqual(["financeiro", "controladoria"]);
    expect(incluirPosicao(["controladoria", "financeiro"], "financeiro")).toEqual(["controladoria", "financeiro"]);
    expect(incluirPosicao(["rh"], "outro")).toEqual(["rh"]);
    expect(incluirPosicao(["rh"], "")).toEqual(["rh"]);
  });

  it("trocar a posição tira a anterior só se ela entrou sozinha", () => {
    expect(trocarPosicao(["financeiro", "rh"], "financeiro", "sst", true)).toEqual(["sst", "rh"]);
    expect(trocarPosicao(["financeiro", "rh"], "financeiro", "sst", false)).toEqual(["sst", "financeiro", "rh"]);
    expect(trocarPosicao(["rh"], "", "outro", false)).toEqual(["rh"]);
  });

  it("pendências: 1+ módulo, 1+ setor, posição (e o texto do 'Outro')", () => {
    const vazio = { modulos: [], setores: [], posicao: "", posicaoOutro: "" };
    expect(pendenciasImpacto(vazio).map((p) => p.label)).toEqual([
      "Módulos do sistema impactados", "Setores impactados", "Posição do novo módulo ou módulo diretamente ajustado",
    ]);
    expect(pendenciasImpacto({ modulos: ["rh"], setores: ["RH"], posicao: "outro", posicaoOutro: " " }).map((p) => p.label))
      .toEqual(["Qual sistema (Outro)"]);
    expect(pendenciasImpacto({ modulos: ["rh"], setores: ["RH"], posicao: "rh", posicaoOutro: "" })).toEqual([]);
    expect(pendenciasImpacto({ modulos: [" "], setores: ["RH"], posicao: "rh", posicaoOutro: "" })[0].id).toBe("campo-modulos-impactados");
    // Posição "Outro" (sistema fora do catálogo): módulo impactado não é exigido.
    expect(pendenciasImpacto({ modulos: [], setores: ["RH"], posicao: "outro", posicaoOutro: "Portal X" })).toEqual([]);
    expect(pendenciasImpacto({ modulos: [], setores: [], posicao: "outro", posicaoOutro: "Portal X" }).map((p) => p.label)).toEqual(["Setores impactados"]);
  });

  it("separa o módulo diretamente ajustado dos demais impactados", () => {
    expect(separarModulos(["financeiro", "controladoria", "contabil"], "financeiro"))
      .toEqual({ ajustado: "financeiro", demais: ["controladoria", "contabil"] });
    expect(separarModulos(["rh"], "outro")).toEqual({ ajustado: null, demais: ["rh"] });
    expect(separarModulos(null, "rh")).toEqual({ ajustado: null, demais: [] });
  });
});

describe("Impacto sistêmico — análises do Monitoramento", () => {
  it("modulosDoChamado: o que painel, filtro e opções leem (com a posição)", () => {
    expect(modulosDoChamado({ modulo_sistema: "rh", modulos_impactados: ["sst"] })).toEqual(["rh", "sst"]);
    expect(modulosDoChamado({ modulo_sistema: "rh", modulos_impactados: [] })).toEqual([]);
    expect(modulosDoChamado({ modulo_sistema: "outro", modulos_impactados: ["sst"] })).toEqual(["sst"]);
  });

  // O exemplo do chamado: melhoria no Fluxo de Caixa (financeiro) que mexe em
  // Lucratividade de Contratos e Fechamento (controladoria) e Auditoria (contabil).
  const chamados: ChamadoImpacto[] = [
    { id: "1", status: "em_andamento", modulo_sistema: "financeiro", modulos_impactados: ["financeiro", "controladoria", "contabil"], setores_impactados: ["Financeiro", "Controladoria"] },
    { id: "2", status: "concluido", modulo_sistema: "controladoria", modulos_impactados: ["controladoria"], setores_impactados: ["Controladoria"] },
    // Gravado antes do trigger: a posição não estava na lista — conta igual.
    { id: "3", status: "aberto", modulo_sistema: "rh", modulos_impactados: ["sst"], setores_impactados: ["RH", "SST"] },
    // Aberto antes do formulário: fica de fora das contas.
    { id: "4", status: "concluido", modulo_sistema: "financeiro", modulos_impactados: [], setores_impactados: null },
    // Sistema fora do catálogo: tem impacto (setor), mas não entra na abrangência.
    { id: "5", status: "concluido", modulo_sistema: "outro", modulos_impactados: [], setores_impactados: ["Jurídico"] },
  ];
  const a = analisarImpacto(chamados);

  it("separa quem tem impacto informado", () => {
    expect(a.comImpacto).toBe(4);
    expect(a.semImpacto).toBe(1);
  });

  it("módulos com mais alterações, com quantas vezes foram o ajustado", () => {
    expect(a.modulos[0]).toEqual({ valor: "controladoria", qtd: 2, comoPosicao: 1, emAberto: 1 });
    expect(a.modulos.find((m) => m.valor === "rh")).toEqual({ valor: "rh", qtd: 1, comoPosicao: 1, emAberto: 1 });
    expect(a.modulos.find((m) => m.valor === "financeiro")?.qtd).toBe(1); // o chamado 4 não conta
  });

  it("setores mais impactados e áreas para homologação (só não encerrados)", () => {
    expect(a.setores[0]).toMatchObject({ valor: "Controladoria", qtd: 2, emAberto: 1 });
    expect(a.homologacao.map((s) => s.valor)).toEqual(["Controladoria", "Financeiro", "RH", "SST"]);
    expect(emAberto("aguardando_retorno")).toBe(true);
    expect(emAberto("reprovado")).toBe(false);
  });

  it("abrangência = nº de módulos por chamado (com a posição)", () => {
    expect(abrangencia(chamados[0])).toBe(3);
    expect(abrangencia(chamados[2])).toBe(2);
    expect(abrangencia(chamados[3])).toBeNull();
    expect(abrangencia(chamados[4])).toBeNull();
    expect(a.abrangenciaMedia).toBe(2);
    expect(a.abrangenciaMaxima).toBe(3);
    expect(a.faixas.map((f) => f.qtd)).toEqual([1, 2, 0, 0]);
  });

  it("sem chamados não quebra", () => {
    const v = analisarImpacto([]);
    expect(v.abrangenciaMedia).toBeNull();
    expect(v.abrangenciaMaxima).toBe(0);
    expect(v.modulos).toEqual([]);
  });
});
