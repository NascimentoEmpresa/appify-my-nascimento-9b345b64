import { describe, expect, it } from "vitest";
import {
  FILTROS_VAZIOS, efetividade, filtrarModulos, indicadores, montarModulos, preenchido, rotuloValor,
  type ChecklistItem, type DadosChecklist, type TelaCat,
} from "@/lib/sistemas/checklistModulos";

const item = (p: Partial<ChecklistItem>): ChecklistItem => ({
  id: "c" + Math.random(), modulo_id: "m1", menu_id: null,
  status_dev: null, status_implantacao: null, status_treinamento: null, status_validacao: null,
  responsavel_id: null, usuario_chave_id: null, previsao_entrega: null, data_implantacao: null,
  data_treinamento: null, data_validacao: null, observacoes: null, atualizado_por: null, atualizado_em: "2026-10-02T10:00:00Z", ...p,
});
const tela = (p: Partial<TelaCat>): TelaCat => ({
  id: "t1", modulo_id: "m1", codigo: "x", nome: "Tela", rota: "/app/x", ordem: 1, ativo: true,
  com_acesso: 0, ativos_30d: 0, acessos_30d: 0, ultimo_uso: null, ...p,
});
const dados = (p: Partial<DadosChecklist> = {}): DadosChecklist => ({
  modulos: [
    { id: "m1", codigo: "recrutamento", nome: "Recrutamento e Seleção", ordem: 1, ativo: true, com_acesso: 10, ativos_30d: 4 },
    { id: "m2", codigo: "sst", nome: "SST", ordem: 2, ativo: true, com_acesso: 3, ativos_30d: 0 },
  ],
  telas: [
    tela({ id: "t1", nome: "Gestão Recrutamento", com_acesso: 10, ativos_30d: 4 }),
    tela({ id: "t2", nome: "Banco de Talentos", ordem: 2, com_acesso: 5, ativos_30d: 0 }),
    tela({ id: "t3", nome: "Tela antiga", ativo: false, ordem: 3 }),
    tela({ id: "t4", modulo_id: "m2", nome: "Controle de CA", rota: "/app/sst/ca" }),
  ],
  checklist: [
    item({ menu_id: "t1", status_dev: "pronto", status_implantacao: "implantado", status_treinamento: "treinado", status_validacao: "validado", responsavel_id: "u1" }),
    item({ menu_id: "t2", status_dev: "em_desenvolvimento" }),
    item({ menu_id: null, responsavel_id: "u9" }),
  ],
  bugs: [
    { modulo_id: "m1", menu_id: "t2", status: "aberto", severidade: "alta" },
    { modulo_id: "m1", menu_id: "t2", status: "resolvido", severidade: "baixa" },
  ],
  chamados: [{ modulo: "recrutamento", abertos: 3, total: 9 }],
  treinados: [{ modulo_id: "m1", menu_id: "t1", qtd: 6 }],
  historico: [], usuarios: [], uso_total_30d: null, uso_desde: null, ...p,
});

describe("efetividade", () => {
  it("tudo pronto = 100%, nada preenchido = 0%", () => {
    expect(efetividade(item({ status_dev: "pronto", status_implantacao: "implantado", status_treinamento: "treinado", status_validacao: "validado" }))).toBe(1);
    expect(efetividade(item({}))).toBe(0);
    expect(efetividade(null)).toBe(0);
  });
  it("pesos parciais", () => {
    // 0,4 + 0 + 0 + 0 ÷ 4
    expect(efetividade(item({ status_dev: "em_desenvolvimento" }))).toBeCloseTo(0.1);
    // (1 + 1 + 0,5) ÷ 3 — "não se aplica" sai da média
    expect(efetividade(item({ status_dev: "pronto", status_implantacao: "implantado", status_treinamento: "nao_se_aplica", status_validacao: "em_validacao" }))).toBeCloseTo(2.5 / 3);
  });
  it("preenchido = algum status (responsável sozinho não conta)", () => {
    expect(preenchido(item({ responsavel_id: "u1" }))).toBe(false);
    expect(preenchido(item({ status_validacao: "pendente" }))).toBe(true);
  });
});

describe("montarModulos", () => {
  const mods = montarModulos(dados());
  const rec = mods.find((m) => m.modulo.id === "m1")!;
  it("agrega as telas ATIVAS do módulo, pendente contando 0", () => {
    expect(rec.ativas).toBe(2);
    expect(rec.preenchidas).toBe(2);
    expect(rec.efetividade).toBeCloseTo((1 + 0.1) / 2);
    expect(rec.porDev).toMatchObject({ pronto: 1, em_desenvolvimento: 1, pendente: 0 });
    expect(rec).toMatchObject({ prontas: 1, implantadas: 1, treinadas: 1, validadas: 1, bugsAbertos: 1, chamadosAbertos: 3, comAcesso: 10, ativos30d: 4 });
  });
  it("dados do módulo (menu_id nulo) ficam no item do módulo", () => {
    expect(rec.item?.responsavel_id).toBe("u9");
  });
  it("tela: bugs abertos, treinados e adoção", () => {
    const t1 = rec.telas.find((t) => t.tela.id === "t1")!;
    const t2 = rec.telas.find((t) => t.tela.id === "t2")!;
    expect(t1).toMatchObject({ treinados: 6, bugsAbertos: 0 });
    expect(t1.adocao).toBeCloseTo(0.4);
    expect(t2.bugsAbertos).toBe(1);
    expect(t2.adocao).toBe(0);
  });
  it("módulo sem nada preenchido fica 0% e pendente", () => {
    const sst = mods.find((m) => m.modulo.id === "m2")!;
    expect(sst).toMatchObject({ ativas: 1, preenchidas: 0, efetividade: 0 });
    expect(sst.porDev.pendente).toBe(1);
  });
});

describe("filtros e indicadores", () => {
  const mods = montarModulos(dados());
  it("sem filtro: módulos ativos e telas ativas", () => {
    const r = filtrarModulos(mods, FILTROS_VAZIOS);
    expect(r.map((x) => x.modulo.modulo.id)).toEqual(["m1", "m2"]);
    expect(r[0].telas.map((t) => t.tela.id)).toEqual(["t1", "t2"]);
  });
  it("só pendentes de preenchimento", () => {
    const r = filtrarModulos(mods, { ...FILTROS_VAZIOS, soPendentes: true });
    expect(r.map((x) => x.modulo.modulo.id)).toEqual(["m2"]);
  });
  it("por status e responsável (o do módulo vale para a tela sem responsável)", () => {
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, dev: "pronto" })[0].telas.map((t) => t.tela.id)).toEqual(["t1"]);
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, responsavel: "u9" })[0].telas.map((t) => t.tela.id)).toEqual(["t2"]);
  });
  it("busca sem acento, inclui o nome do módulo", () => {
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, busca: "selecao" }).map((x) => x.modulo.modulo.id)).toEqual(["m1"]);
    expect(filtrarModulos(mods, { ...FILTROS_VAZIOS, busca: "talentos" })[0].telas.map((t) => t.tela.id)).toEqual(["t2"]);
  });
  it("indicadores gerais", () => {
    const i = indicadores(mods);
    expect(i).toMatchObject({ modulos: 2, telas: 3, preenchidas: 2, pendentes: 1, prontas: 1, emDesenvolvimento: 1, treinadas: 1, validadas: 1, bugsAbertos: 1, semUso: 1 });
    expect(i.efetividade).toBeCloseTo(1.1 / 3);
  });
  it("rótulos do histórico", () => {
    expect(rotuloValor("status_dev", "em_homologacao")).toBe("Em homologação");
    expect(rotuloValor("previsao_entrega", "2026-10-30")).toBe("30/10/2026");
    expect(rotuloValor("observacoes", null)).toBe("—");
  });
});
