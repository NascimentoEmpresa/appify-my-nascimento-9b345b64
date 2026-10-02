import { describe, expect, it } from "vitest";
import {
  FILTROS_VAZIOS, aderenciaUsuarioChave, checklistEm, derivarDev, derivarTreinamento, derivarValidacao, efetividade,
  evolucaoEntregas, filtrarModulos, fraseMovimentacao, indicadores, montarModulos, ordenarModulos, prontosSemValidacao,
  rankingAreas, rotuloValor, variacao, variacaoPP, modulosSemTreinamento, statusDevDaTela, exigeResponsavelTreinamento,
  type StatusDevTelas,
  type ChecklistItem, type DadosChecklist, type Historico, type TelaCat,
} from "@/lib/sistemas/checklistModulos";

const item = (p: Partial<ChecklistItem>): ChecklistItem => ({
  id: "c" + Math.random(), modulo_id: "m1", menu_id: null,
  status_dev: null, status_implantacao: null, status_treinamento: null, status_validacao: null,
  responsavel_id: null, usuario_chave_id: null, previsao_entrega: null, data_implantacao: null,
  data_treinamento: null, data_validacao: null, observacoes: null, area: null, atualizado_por: null, atualizado_em: "2026-10-02T10:00:00Z", ...p,
});
const tela = (p: Partial<TelaCat>): TelaCat => ({
  id: "t1", modulo_id: "m1", codigo: "x", nome: "Tela", rota: "/app/x", ordem: 1, ativo: true,
  com_acesso: 0, ativos_30d: 0, acessos_30d: 0, ultimo_uso: null, ...p,
});
const dados = (checklist: ChecklistItem[]): DadosChecklist => ({
  modulos: [
    { id: "m1", codigo: "recrutamento", nome: "Recrutamento e Seleção", ordem: 1, ativo: true, com_acesso: 10, ativos_30d: 4 },
    { id: "m2", codigo: "sst", nome: "SST", ordem: 2, ativo: true, com_acesso: 3, ativos_30d: 0 },
    { id: "m3", codigo: "ti", nome: "T.I", ordem: 3, ativo: false, com_acesso: 0, ativos_30d: 0 },
  ],
  telas: [
    tela({ id: "t1", nome: "Gestão Recrutamento", com_acesso: 10, ativos_30d: 4 }),
    tela({ id: "t2", nome: "Banco de Talentos", ordem: 2 }),
    tela({ id: "t3", nome: "Tela antiga", ativo: false, ordem: 3 }),
    tela({ id: "t4", modulo_id: "m2", nome: "Controle de CA", rota: "/app/sst/ca" }),
  ],
  checklist, bugs: [{ modulo_id: "m1", menu_id: "t2", status: "aberto", severidade: "alta" }],
  chamados: [{ modulo: "recrutamento", abertos: 3, total: 9 }], treinados: [],
  historico: [], usuarios: [], uso_total_30d: null, uso_desde: null,
});

describe("efetividade (desenvolvimento, treinamento e validação)", () => {
  it("tudo concluído = 100%; implantação não entra", () => {
    expect(efetividade(item({ status_dev: "pronto", status_treinamento: "treinado", status_validacao: "validado" }))).toBe(1);
    expect(efetividade(item({ status_dev: "pronto", status_treinamento: "treinado", status_validacao: "validado", status_implantacao: "nao_implantado" }))).toBe(1);
  });
  it("nada para medir = null; só implantação também", () => {
    expect(efetividade(item({}))).toBeNull();
    expect(efetividade(item({ status_implantacao: "implantado" }))).toBeNull();
  });
  it("pesos parciais e 'não se aplica' fora da média", () => {
    expect(efetividade(item({ status_dev: "em_desenvolvimento" }))).toBeCloseTo(0.4 / 3);
    expect(efetividade(item({ status_dev: "pronto", status_treinamento: "nao_se_aplica", status_validacao: "em_validacao" }))).toBeCloseTo(1.5 / 2);
  });
});

describe("status do módulo calculado pelas telas", () => {
  it("desenvolvimento", () => {
    expect(derivarDev([null, null])).toBeNull();
    expect(derivarDev(["pronto", "pronto"])).toBe("pronto");
    expect(derivarDev(["pronto", null])).toBe("em_desenvolvimento");
    expect(derivarDev(["pronto", "em_homologacao"])).toBe("em_homologacao");
    expect(derivarDev(["em_homologacao", "em_desenvolvimento"])).toBe("em_desenvolvimento");
    expect(derivarDev(["nao_iniciado", null])).toBe("nao_iniciado");
  });
  it("treinamento e validação", () => {
    expect(derivarTreinamento(["treinado", "nao_se_aplica"])).toBe("treinado");
    expect(derivarTreinamento(["treinado", null])).toBe("pendente");
    expect(derivarTreinamento(["agendado", "pendente"])).toBe("agendado");
    expect(derivarValidacao(["validado", "validado"])).toBe("validado");
    expect(derivarValidacao(["validado", "pendente"])).toBe("em_validacao");
    expect(derivarValidacao(["reprovado", "validado"])).toBe("reprovado");
  });
});

describe("montarModulos", () => {
  it("o marcado no módulo vence o calculado; vazio cai no calculado", () => {
    const d = dados([
      item({ menu_id: "t1", status_dev: "pronto", status_treinamento: "treinado", responsavel_id: "u1" }),
      item({ menu_id: "t2", status_dev: "em_homologacao", responsavel_id: "u1" }),
      item({ menu_id: null, status_validacao: "validado", area: "RH Corporativo" }),
    ]);
    const rec = montarModulos(d).find((m) => m.modulo.id === "m1")!;
    expect(rec.status).toMatchObject({ status_dev: "em_homologacao", status_treinamento: "pendente", status_validacao: "validado" });
    expect(rec.calculado).toMatchObject({ dev: true, treinamento: true, validacao: false });
    expect(rec.efetividade).toBeCloseTo((0.75 + 0 + 1) / 3);
    expect(rec).toMatchObject({ area: "RH Corporativo", responsavelId: "u1", ativas: 2, preenchidas: 2, bugsAbertos: 1, chamadosAbertos: 3, comAcesso: 10, ativos30d: 4 });
  });
  it("área padrão pelo código; módulo sem nada = efetividade null", () => {
    const sst = montarModulos(dados([])).find((m) => m.modulo.id === "m2")!;
    expect(sst.area).toBe("Segurança do Trabalho");
    expect(sst.efetividade).toBeNull();
    expect(sst.status.status_dev).toBeNull();
  });
});

describe("filtros, ordem e indicadores", () => {
  const d = dados([
    item({ menu_id: null, modulo_id: "m1", status_dev: "pronto", status_treinamento: "treinado", status_validacao: "validado", responsavel_id: "u1", atualizado_em: "2026-09-01T00:00:00Z" }),
    item({ menu_id: null, modulo_id: "m2", status_dev: "em_desenvolvimento", status_treinamento: "pendente", status_validacao: "pendente", atualizado_em: "2026-10-01T00:00:00Z" }),
  ]);
  const mods = montarModulos(d);
  it("só módulos ativos; filtros pelo status efetivo, área, responsável e busca (inclui telas)", () => {
    expect(filtrarModulos(mods, FILTROS_VAZIOS).map((m) => m.modulo.id)).toEqual(["m1", "m2"]);
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, dev: "pronto" }).map((m) => m.modulo.id)).toEqual(["m1"]);
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, area: "Segurança do Trabalho" }).map((m) => m.modulo.id)).toEqual(["m2"]);
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, responsavel: "u1" }).map((m) => m.modulo.id)).toEqual(["m1"]);
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, busca: "talentos" }).map((m) => m.modulo.id)).toEqual(["m1"]);
  });
  it("ordena por desenvolvimento e por última atualização", () => {
    expect(ordenarModulos(mods.filter((m) => m.modulo.ativo), "dev", true).map((m) => m.modulo.id)).toEqual(["m1", "m2"]);
    expect(ordenarModulos(mods.filter((m) => m.modulo.ativo), "atualizacao", false).map((m) => m.modulo.id)).toEqual(["m2", "m1"]);
  });
  it("indicadores por módulo", () => {
    const i = indicadores(mods);
    expect(i).toMatchObject({ modulos: 2, prontos: 1, emDesenvolvimento: 1, treinados: 1, validados: 1, preenchidos: 2 });
    expect(i.efetividade).toBeCloseTo((1 + 0.4 / 3) / 2);
  });
  it("análises: sem treinamento, prontos sem validação, áreas, usuário-chave", () => {
    expect(modulosSemTreinamento(mods).map((m) => m.modulo.id)).toEqual(["m2"]);
    expect(prontosSemValidacao(mods)).toHaveLength(0);
    expect(rankingAreas(mods)[0]).toMatchObject({ area: "Segurança do Trabalho", modulos: 1, pendencias: 3 });
    const d2 = dados([item({ menu_id: "t1", usuario_chave_id: "k1", status_validacao: "validado" }), item({ menu_id: "t2", usuario_chave_id: "k1" })]);
    expect(aderenciaUsuarioChave(montarModulos(d2))[0]).toMatchObject({ userId: "k1", itens: 2, validados: 1, taxa: 0.5 });
  });
});

describe("mês anterior", () => {
  it("refaz o checklist pelo histórico até a data", () => {
    const c = item({ id: "A", menu_id: null, status_dev: "pronto", status_validacao: "validado" });
    const hist = [
      { checklist_id: "A", campo: "status_dev", para: "em_desenvolvimento", created_at: "2026-09-10T10:00:00+00:00" },
      { checklist_id: "A", campo: "status_dev", para: "pronto", created_at: "2026-10-01T12:00:00+00:00" },
      { checklist_id: "A", campo: "status_validacao", para: "validado", created_at: "2026-10-01T12:00:00+00:00" },
    ];
    const antes = checklistEm([c, item({ id: "B" })], hist, "2026-10-01T03:00:00.000Z");
    expect(antes).toHaveLength(1);
    expect(antes[0]).toMatchObject({ status_dev: "em_desenvolvimento", status_validacao: null });
  });
  it("variação relativa, absoluta sem base e em pontos percentuais", () => {
    expect(variacao(18, 16, true)).toEqual({ texto: "+13%", sentido: "sobe", bom: true });
    expect(variacao(7, 5, false)).toMatchObject({ texto: "+40%", bom: false });
    expect(variacao(2, 0, true)).toMatchObject({ texto: "+2", sentido: "sobe" });
    expect(variacao(3, 3, true)).toMatchObject({ sentido: "igual" });
    expect(variacaoPP(0.611, 0.527)).toMatchObject({ texto: "+8,4 p.p.", bom: true });
  });
  it("evolução das entregas por mês", () => {
    const e = evolucaoEntregas([
      { campo: "status_dev", para: "pronto", created_at: "2026-09-15T12:00:00Z" },
      { campo: "status_validacao", para: "validado", created_at: "2026-10-01T12:00:00Z" },
      { campo: "status_dev", para: "em_desenvolvimento", created_at: "2026-10-01T12:00:00Z" },
    ], 2, new Date("2026-10-02T12:00:00Z"));
    expect(e).toEqual([
      { mes: "2026-09", rotulo: "set/26", prontos: 1, treinados: 0, validados: 0 },
      { mes: "2026-10", rotulo: "out/26", prontos: 0, treinados: 0, validados: 1 },
    ]);
  });
});

describe("textos", () => {
  const h = (p: Partial<Historico>): Historico => ({ id: 1, checklist_id: "A", modulo_id: "m1", menu_id: null, campo: "status_validacao", de: null, para: "validado", usuario_nome: "Juliana Santos", created_at: "2026-10-01T12:00:00Z", ...p });
  it("frases das movimentações", () => {
    expect(fraseMovimentacao(h({}), "Controle de Faturamento", null)).toMatchObject({ tipo: "validado", texto: "Módulo Controle de Faturamento validado por Juliana Santos" });
    expect(fraseMovimentacao(h({ campo: "status_treinamento", para: "agendado" }), "Compras", null).texto).toBe("Módulo Compras enviado para treinamento");
    expect(fraseMovimentacao(h({ campo: "responsavel_id", para: "Patrícia Gomes" }), "Licitações", null).texto).toBe("Módulo Licitações atribuído para Patrícia Gomes");
    expect(fraseMovimentacao(h({ campo: "status_dev", para: "pronto", menu_id: "t1" }), "RH", "Férias").tipo).toBe("atualizado");
  });
  it("rótulos", () => {
    expect(rotuloValor("status_validacao", "pendente")).toBe("Não validado");
    expect(rotuloValor("previsao_entrega", "2026-10-30")).toBe("30/10/2026");
  });
});

describe("status de desenvolvimento no canto da tela", () => {
  const base: StatusDevTelas = {
    telas: [
      { codigo: "a", modulo_id: "m1", ativo: true, status_dev: "pronto" },
      { codigo: "b", modulo_id: "m1", ativo: true, status_dev: null },
      { codigo: "c", modulo_id: "m2", ativo: true, status_dev: null },
      { codigo: "d", modulo_id: "m3", ativo: true, status_dev: null },
    ],
    modulos: [{ modulo_id: "m2", status_dev: "em_homologacao" }],
  };
  it("vale o da tela; vazia, o do módulo; sem módulo, o calculado; nada, pendente", () => {
    expect(statusDevDaTela(base, "a")).toEqual({ status: "pronto", origem: "tela" });
    expect(statusDevDaTela(base, "c")).toEqual({ status: "em_homologacao", origem: "modulo" });
    expect(statusDevDaTela(base, "b")).toEqual({ status: "em_desenvolvimento", origem: "calculado" });
    expect(statusDevDaTela(base, "d")).toEqual({ status: null, origem: "pendente" });
  });
  it("tela fora do catálogo ou sem dados não mostra nada", () => {
    expect(statusDevDaTela(base, "zz")).toBeNull();
    expect(statusDevDaTela(null, "a")).toBeNull();
    expect(statusDevDaTela(base, null)).toBeNull();
  });
});

describe("responsáveis pelo treinamento", () => {
  it("obrigatório com status de treinamento, menos 'não se aplica'", () => {
    expect(exigeResponsavelTreinamento("treinado")).toBe(true);
    expect(exigeResponsavelTreinamento("agendado")).toBe(true);
    expect(exigeResponsavelTreinamento("pendente")).toBe(true);
    expect(exigeResponsavelTreinamento("nao_se_aplica")).toBe(false);
    expect(exigeResponsavelTreinamento(null)).toBe(false);
  });
});
