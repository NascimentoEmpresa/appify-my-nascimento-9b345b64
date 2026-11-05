import { describe, expect, it } from "vitest";
import { chaveContrato, montarArvore, visaoDaArvore, type NoComContrato } from "@/lib/organograma/arvore";
import { linhaParaNo, posicaoDeResposta, posicaoFaltando, posicaoParaParametros, posicaoVazia } from "@/lib/organograma/pessoas";

// Cenário: Helena (escritório) > Carlos (coordena 1099 e, por vínculo, 1040) >
// Susana (1099) > Rita (1099); Lucia (1040) sem superior; Paulo sem superior mas
// com equipe (Vera).
const no = (id: string, parent_id: string | null, filial: number | null, extra: Partial<NoComContrato> = {}): NoComContrato => ({
  id, parent_id, ordem: 0, nome: id, setor: null, par_grupo: null, do_grupo: false,
  superior_pendente: false, empresa: filial == null ? null : 1, filial, contratos_extras: [], ...extra,
});
const base = () => [
  no("helena", null, 1),
  no("carlos", "helena", 1099, { contratos_extras: [[1, 1040]] }),
  no("susana", "carlos", 1099),
  no("rita", "susana", 1099),
  no("lucia", null, 1040, { superior_pendente: true }),
  no("paulo", null, 1041, { superior_pendente: true }),
  no("vera", "paulo", 1041),
];
const ids = (l: { id: string }[]) => l.map((n) => n.id).sort();

describe("organograma: o que desenhar", () => {
  it("pendente sem equipe sai do desenho e vai para as pendências", () => {
    const v = visaoDaArvore(base());
    expect(ids(v.semSuperior)).toEqual(["lucia"]);
    expect(v.visiveis.some((n) => n.id === "lucia")).toBe(false);
  });

  it("pendente COM equipe fica no desenho, senão a equipe some junto", () => {
    const v = visaoDaArvore(base());
    expect(v.visiveis.some((n) => n.id === "paulo")).toBe(true);
    expect(v.visiveis.some((n) => n.id === "vera")).toBe(true);
  });

  it("empresa toda não tem linha de comando separada", () => {
    expect(visaoDaArvore(base()).linhaDeComando.size).toBe(0);
  });
});

describe("organograma: visão por contrato", () => {
  it("mostra quem é do contrato e a linha de comando acima", () => {
    const v = visaoDaArvore(base(), chaveContrato(1, 1099));
    expect(ids(v.visiveis)).toEqual(["carlos", "helena", "rita", "susana"]);
    expect([...v.linhaDeComando]).toEqual(["helena"]);
  });

  it("vínculo extra põe a pessoa no outro contrato, com a linha dela", () => {
    const v = visaoDaArvore(base(), chaveContrato(1, 1040));
    expect(ids(v.visiveis)).toEqual(["carlos", "helena"]);
    expect([...v.linhaDeComando]).toEqual(["helena"]);
    expect(ids(v.semSuperior)).toEqual(["lucia"]);
  });

  it("empresa diferente, mesmo número de filial, não mistura", () => {
    const nos = [no("a", null, 10), { ...no("b", null, 10), empresa: 2 }];
    expect(ids(visaoDaArvore(nos, chaveContrato(2, 10)).visiveis)).toEqual(["b"]);
  });

  it("a árvore filtrada monta sem pendurar ninguém solto", () => {
    const arv = montarArvore(visaoDaArvore(base(), chaveContrato(1, 1099)).visiveis);
    expect(arv.raiz.map((i) => (i.tipo === "no" ? i.no.id : i.tipo))).toEqual(["helena"]);
  });

  it("ciclo no dado não trava a tela", () => {
    const nos = [no("a", "b", 5), no("b", "a", 5)];
    expect(ids(visaoDaArvore(nos, chaveContrato(1, 5)).visiveis)).toEqual(["a", "b"]);
  });
});

describe("organograma: operação sem setor vai para o painel do contrato", () => {
  it("usa o contrato no lugar de 'Sem setor'", () => {
    const nos = [no("chefe", null, 1), { ...no("x", "chefe", 1099), contrato: "1099 - UFRGS" }, { ...no("y", "chefe", 1099), setor: "RH", contrato: "1099 - UFRGS" }, no("z", "chefe", null)];
    const arv = montarArvore(nos);
    const paineis = arv.itens(arv.equipeDe("chefe")).map((i) => (i.tipo === "painel" ? i.setor : i.tipo));
    expect(paineis).toEqual(["1099 - UFRGS", "RH", "Sem setor"]);
  });
});

describe("organograma: posição", () => {
  it("sem superior nem topo, não pode salvar", () => {
    expect(posicaoFaltando(posicaoVazia())).toBeTruthy();
    expect(posicaoFaltando({ ...posicaoVazia(), topo: true })).toBeNull();
    expect(posicaoFaltando({ ...posicaoVazia(), superior: { id: "1", nome: "A" } })).toBeNull();
  });

  it("topo ignora superior que tenha sobrado no formulário", () => {
    const p = posicaoParaParametros({ ...posicaoVazia(), topo: true, superior: { id: "1", nome: "A" }, doGrupo: true });
    expect(p.p_parent).toBeNull();
    expect(p.p_topo).toBe(true);
    expect(p.p_do_grupo).toBe(false);
  });

  it("posto só vai para quem tem cadastro; sem posto vira limpar", () => {
    expect(posicaoParaParametros({ ...posicaoVazia(), postoCodigo: "PO-1" }).p_posto).toBeNull();
    expect(posicaoParaParametros({ ...posicaoVazia(), empregadoId: 5 }).p_posto).toBe("");
    expect(posicaoParaParametros({ ...posicaoVazia(), empregadoId: 5, postoCodigo: "PO-1" }).p_posto).toBe("PO-1");
  });

  it("resposta do banco: pendente deduzido abre sugerido, não confirmado", () => {
    const p = posicaoDeResposta({ no_id: "n", parent_id: "c", parent_nome: "Carlos", origem: "posto", pendente: false, empregado_id: 9, contratos_extras: [] });
    expect(p.superior).toEqual({ id: "c", nome: "Carlos" });
    expect(p.deduzido).toBe(true);
    expect(posicaoDeResposta({ parent_id: "c", origem: "manual" }).deduzido).toBe(false);
  });

  it("linha da RPC vira a pessoa, na ordem do comentário da organograma_arvore", () => {
    const n = linhaParaNo(["id", "u", 7, "p", 2, "fn", "NOME", "e@x", "av", "CARGO", "RH", true, "#000000", "G", true, true, "posto", "PO-1", "RECEP", 1, 1099, "1099 - X", [[1, 2]]]);
    expect(n).toMatchObject({ id: "id", user_id: "u", empregado_id: 7, parent_id: "p", funcao_manual: "fn", nome: "NOME", setor: "RH", superior_pendente: true, superior_origem: "posto", posto_codigo: "PO-1", posto_nome: "RECEP", empresa: 1, filial: 1099, contrato: "1099 - X", contratos_extras: [[1, 2]] });
  });
});
