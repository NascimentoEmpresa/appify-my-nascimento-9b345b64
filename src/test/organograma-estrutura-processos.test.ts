import { describe, expect, it } from "vitest";
import {
  ESTRUTURA_VAZIA, arvoreEquipe, autoOrganizar, cadeiaDoSetor, casaBusca, conexoesDoProcesso, indicadores, iniciais, linhasCsv,
  listaAtividades, processosPrincipais, setoresConectados, setoresFiltrados, FILTRO_GERAL_PADRAO,
  type Estrutura, type Membro, type Processo, type Setor,
} from "@/lib/organograma/estruturaProcessos";

const setor = (id: string, nome: string, ordem: number, unidade = "adm"): Setor =>
  ({ id, codigo: id, nome, unidade_id: unidade, icone: "building", cor: "blue", descricao: null, ordem, ativo: true });
const proc = (id: string, setorId: string, ordem: number, o: Partial<Processo> = {}): Processo => ({
  id, codigo: `P-${id}`, setor_id: setorId, unidade_id: null, nome: `Processo ${id}`, descricao: null, responsavel_membro_id: null,
  frequencia: null, entrada: null, saida: null, status: "ativo", proximo_id: null, macro_id: null, principal: false,
  exibir_organograma: true, permite_intersetorial: true, bloquear_posicao: false, pos_x: null, pos_y: null, ordem, ...o,
});
const membro = (id: string, setorId: string, nivel: number, o: Partial<Membro> = {}): Membro => ({
  id, setor_id: setorId, nome: `Pessoa ${id}`, cargo: "Cargo", nivel, parent_id: null, responsavel: false, atividades: null,
  empregado_id: null, user_id: null, ordem: 0, ...o,
});

const E: Estrutura = {
  ...ESTRUTURA_VAZIA,
  setores: [setor("ctrl", "Controladoria", 1), setor("fin", "Financeiro", 2), setor("ope", "Operacional", 3, "op")],
  membros: [
    membro("g", "ctrl", 1, { responsavel: true, nome: "Yuri Rosa" }),
    membro("s", "ctrl", 2, { parent_id: "g", nome: "Érica" }),
    membro("j", "ctrl", 6, { parent_id: "s", nome: "Jovem" }),
    membro("f", "fin", 1, { responsavel: true }),
  ],
  processos: [
    proc("1", "ctrl", 1, { proximo_id: "2" }), proc("2", "ctrl", 2, { proximo_id: "3" }), proc("3", "ctrl", 3),
    proc("4", "fin", 1), proc("5", "ope", 1), proc("6", "ctrl", 4, { status: "inativo" }),
  ],
  conexoes: [
    { id: "c1", origem_id: "4", destino_id: "1", tipo: "intersetorial", rotulo: null },
    { id: "c2", origem_id: "3", destino_id: "5", tipo: "retorno", rotulo: "Desvios" },
    { id: "c3", origem_id: "1", destino_id: "2", tipo: "fluxo", rotulo: null },
  ],
};

describe("indicadores e consultas", () => {
  it("conta pessoas, setores, processos ativos e conexões entre setores", () => {
    expect(indicadores(E)).toEqual({ colaboradores: 4, setores: 3, processos: 5, conexoes: 2 });
  });
  it("principais: os marcados primeiro, sem inativos", () => {
    const e2 = { ...E, processos: E.processos.map((p) => (p.id === "3" ? { ...p, principal: true } : p)) };
    expect(processosPrincipais(e2, "ctrl", 2).map((p) => p.id)).toEqual(["3", "1"]);
  });
  it("cadeia segue a próxima etapa", () => {
    const embaralhado = [E.processos[2], E.processos[0], E.processos[1]];
    expect(cadeiaDoSetor(embaralhado).map((p) => p.id)).toEqual(["1", "2", "3"]);
  });
  it("conexões de entrada e saída de um processo", () => {
    const c = conexoesDoProcesso(E, "1");
    expect(c.entradas.map((x) => x.p!.id)).toEqual(["4"]);
    expect(c.saidas.map((x) => x.p!.id)).toEqual(["2"]);
  });
  it("setores conectados: quem manda fica em cima", () => {
    const s = setoresConectados(E, "ctrl");
    expect(s.map((x) => [x.setor.id, x.acima])).toEqual([["fin", true], ["ope", false]]);
  });
});

describe("equipe", () => {
  it("árvore do gerente ao jovem", () => {
    const a = arvoreEquipe(E.membros.filter((m) => m.setor_id === "ctrl"));
    expect(a).toHaveLength(1);
    expect(a[0].membro.id).toBe("g");
    expect(a[0].filhos[0].membro.id).toBe("s");
    expect(a[0].filhos[0].filhos[0].membro.id).toBe("j");
  });
  it("atividades uma por linha, sem marcadores", () => {
    expect(listaAtividades("- Conferir pontos\n\n• Enviar ao RH ")).toEqual(["Conferir pontos", "Enviar ao RH"]);
  });
  it("iniciais", () => {
    expect(iniciais("Yuri Rosa")).toBe("YR");
    expect(iniciais("Érica")).toBe("É");
    expect(iniciais("")).toBe("?");
  });
});

describe("layout e filtros", () => {
  it("auto-organizar põe a cadeia em linha e os ligados em cima/baixo", () => {
    const l = autoOrganizar(E, "ctrl");
    expect(l.processos["1"].x).toBeLessThan(l.processos["2"].x);
    expect(l.processos["1"].y).toBe(l.processos["2"].y);
    expect(l.laterais.find((x) => x.setor.id === "fin")?.posicao).toBe("cima");
    expect(l.laterais.find((x) => x.setor.id === "ope")?.posicao).toBe("baixo");
  });
  it("posição salva vale; auto-organizar só mantém a travada", () => {
    const e2 = { ...E, processos: E.processos.map((p) => (p.id === "1" ? { ...p, bloquear_posicao: true, pos_x: 999, pos_y: 888 } : p)) };
    expect(autoOrganizar(e2, "ctrl", false).processos["1"]).toEqual({ x: 999, y: 888 });
    const e3 = { ...E, processos: E.processos.map((p) => (p.id === "2" ? { ...p, pos_x: 500, pos_y: 400 } : p)) };
    expect(autoOrganizar(e3, "ctrl").processos["2"]).toEqual({ x: 500, y: 400 });
    expect(autoOrganizar(e3, "ctrl", false).processos["2"]).not.toEqual({ x: 500, y: 400 });
  });
  it("busca casa setor, pessoa ou processo, sem acento", () => {
    expect(setoresFiltrados(E, { ...FILTRO_GERAL_PADRAO, busca: "erica" }).map((s) => s.id)).toEqual(["ctrl"]);
    expect(setoresFiltrados(E, { ...FILTRO_GERAL_PADRAO, busca: "P-5" }).map((s) => s.id)).toEqual(["ope"]);
    expect(setoresFiltrados(E, { ...FILTRO_GERAL_PADRAO, diretoria: "op" }).map((s) => s.id)).toEqual(["ope"]);
    expect(casaBusca("Conferência", "conferencia")).toBe(true);
    expect(casaBusca("x", "")).toBe(false);
  });
  it("CSV com cabeçalho e uma linha por processo", () => {
    const l = linhasCsv(E);
    expect(l[0][0]).toBe("Código");
    expect(l).toHaveLength(7);
    expect(l.find((r) => r[0] === "P-3")?.[9]).toContain("Operacional");
  });
});
