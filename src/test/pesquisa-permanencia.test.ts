import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FORMULARIO_PERMANENCIA_ID, ID_PERGUNTA_FORM, MIN_RESPOSTAS_GRUPO, PERGUNTAS, agrupar, agruparTurnover, alternar, alternarComplemento,
  contarPergunta, contextoIA, ehFormularioPermanencia, errosDaPergunta, filtrar, indicadores, linhasDoFormulario, paraPergunta,
  perguntaPorId, perguntasDoFormulario, pontosDeAtencao, resumoGerencial, taxaTurnover, validarRespostas,
  type ConfigEscolha, type LinhaResposta, type LinhaTurnover, type Respostas,
} from "../../supabase/functions/_shared/pesquisa-permanencia";

// Pesquisa de Permanência (mig 20261028001200; virou formulário na
// 20261030001000): as regras do documento do RH e as contas dos relatórios.

const P = (id: string) => perguntaPorId(id)!;

/** Respostas válidas, com sobrescrita por pergunta. */
function resp(over: Respostas = {}): Respostas {
  return {
    p1: { marcadas: ["salario", "colegas"], principal: "salario" },
    p2: { marcadas: ["salario_fora"], principal: "salario_fora" },
    p3: { marcadas: ["bom"] },
    p4: { marcadas: ["positivo"] },
    p5: { marcadas: ["boas"] },
    p6: { marcadas: ["grupo_nascimento"] },
    p7: { marcadas: ["sim"] },
    p8: { marcadas: ["salario"], principal: "salario" },
    ...over,
  };
}

const linha = (r: Respostas, o: Partial<LinhaResposta> = {}): LinhaResposta => ({
  aplicacao_id: "a1", mes: "2026-10", empresa: 1, filial: 10, contrato: "UFAC", posto: "PO-1", posto_nome: "AUX LIMPEZA", funcao: "AUX DE LIMPEZA", r, ...o,
});

describe("catálogo do documento", () => {
  it("tem as 8 perguntas, com até 3 nas 1, 2 e 8 e resposta única nas demais", () => {
    expect(PERGUNTAS.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(PERGUNTAS.filter((p) => p.max === 3).map((p) => p.numero)).toEqual([1, 2, 8]);
    expect(PERGUNTAS.filter((p) => p.max === 1)).toHaveLength(5);
  });
  it("só 'Manter as condições atuais' é exclusiva", () => {
    expect(PERGUNTAS.flatMap((p) => p.opcoes.filter((o) => o.exclusiva).map((o) => `${p.id}.${o.cod}`))).toEqual(["p8.manter"]);
  });
  it("o formulário gravado pela migration tem exatamente as perguntas do catálogo", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261030001000_pesquisa_permanencia_vira_formulario.sql"), "utf8");
    const trecho = sql.slice(sql.indexOf("-- form-permanencia-inicio"), sql.indexOf("-- form-permanencia-fim"));
    expect(trecho).toContain(FORMULARIO_PERMANENCIA_ID);
    const json = trecho.match(/'(\[\{.*\}\])'::jsonb/s)?.[1];
    expect(json).toBeTruthy();
    expect(JSON.parse(json!)).toEqual(perguntasDoFormulario());
    // A migração das respostas antigas usa os mesmos ids de pergunta.
    for (const [cod, id] of Object.entries(ID_PERGUNTA_FORM)) if (cod !== "local") expect(sql).toContain(`('${cod}', '${id}')`);
  });
  it("o formulário é reconhecido como pesquisa de permanência; sem o local de trabalho, não", () => {
    const ps = perguntasDoFormulario();
    expect(ehFormularioPermanencia(ps)).toBe(true);
    expect(ehFormularioPermanencia(ps.filter((p) => p.tipo !== "local_trabalho"))).toBe(false);
    expect(ehFormularioPermanencia(ps.filter((p) => (p.config as ConfigEscolha).codigo !== "p8"))).toBe(false);
  });
});

describe("dentro do Formulários", () => {
  const ps = perguntasDoFormulario();
  it("a pergunta do formulário valida igual à do catálogo", () => {
    const f = ps.find((p) => (p.config as ConfigEscolha).codigo === "p8")!;
    const pf = paraPergunta(f.id, f.titulo, 8, f.config as ConfigEscolha);
    let r = alternar(pf, undefined, "salario");
    r = alternar(pf, r, "manter");
    expect(r.marcadas).toEqual(["manter"]);
    expect(errosDaPergunta(pf, { marcadas: ["salario", "fiscais"] })).toEqual(errosDaPergunta(P("p8"), { marcadas: ["salario", "fiscais"] }));
  });
  it("respostas do formulário viram as linhas dos relatórios (só o mês, sem quem respondeu)", () => {
    const itens = {
      [ID_PERGUNTA_FORM.local]: { empresa: 1, filial: 10, contrato: "UFAC", posto: "PO-1", posto_nome: "AUX LIMPEZA", funcao: "aux de  limpeza" },
      ...Object.fromEntries(Object.entries(resp()).map(([cod, v]) => [ID_PERGUNTA_FORM[cod], v])),
    };
    const ls = linhasDoFormulario(ps, [
      { formulario_id: "f1", enviado_em: "2026-11-01T01:00:00Z", itens },   // 31/10 22h em Brasília
      { formulario_id: "f1", enviado_em: "2026-10-15T12:00:00Z", itens: { [ID_PERGUNTA_FORM.p1]: { marcadas: ["salario"] } } },
    ]);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ mes: "2026-10", empresa: 1, filial: 10, contrato: "UFAC", posto: "PO-1", funcao: "AUX DE LIMPEZA" });
    expect(ls[0].r).toEqual(resp());
  });
});

describe("marcar alternativas", () => {
  it("resposta única troca a escolha", () => {
    let r = alternar(P("p3"), undefined, "bom");
    r = alternar(P("p3"), r, "ruim");
    expect(r.marcadas).toEqual(["ruim"]);
  });
  it("até 3: a quarta não entra", () => {
    let r = alternar(P("p1"), undefined, "salario");
    r = alternar(P("p1"), r, "colegas");
    r = alternar(P("p1"), r, "lideranca");
    r = alternar(P("p1"), r, "estabilidade");
    expect(r.marcadas).toEqual(["salario", "colegas", "lideranca"]);
  });
  it("com uma só marcada ela já é a mais importante; ao marcar outra, a pessoa escolhe de novo", () => {
    let r = alternar(P("p8"), undefined, "salario");
    expect(r.principal).toBe("salario");
    r = alternar(P("p8"), r, "comunicacao");
    expect(r.principal).toBeUndefined();
    expect(validarRespostas(resp({ p8: r }))).toEqual(["Pergunta 8: indique a mais importante entre as que marcou."]);
    r = { ...r, principal: "comunicacao" };
    r = alternar(P("p8"), r, "fiscais");
    expect(r.principal).toBeUndefined();
    r = { ...r, principal: "fiscais" };
    r = alternar(P("p8"), r, "comunicacao");
    expect(r.principal).toBe("fiscais");
    r = alternar(P("p8"), r, "fiscais");
    expect(r.marcadas).toEqual(["salario"]);
    expect(r.principal).toBe("salario");
  });
  it("'Manter as condições atuais' é exclusiva nos dois sentidos", () => {
    let r = alternar(P("p8"), undefined, "salario");
    r = alternar(P("p8"), r, "manter");
    expect(r.marcadas).toEqual(["manter"]);
    r = alternar(P("p8"), r, "fiscais");
    expect(r.marcadas).toEqual(["fiscais"]);
  });
  it("desmarcar a alternativa apaga o complemento dela", () => {
    let r = alternar(P("p2"), undefined, "lideranca");
    r = alternarComplemento(P("p2"), r, "lideranca", "grosseria");
    expect(r.comp).toEqual({ lideranca: ["grosseria"] });
    r = alternar(P("p2"), r, "lideranca");
    expect(r.comp).toBeUndefined();
  });
  it("complemento de uma escolha só (pergunta 7) troca em vez de somar", () => {
    let r = alternar(P("p7"), undefined, "nao");
    r = alternarComplemento(P("p7"), r, "nao", "salario");
    r = alternarComplemento(P("p7"), r, "nao", "tratamento");
    expect(r.comp).toEqual({ nao: ["tratamento"] });
  });
});

describe("validação (todas obrigatórias)", () => {
  it("respostas completas passam", () => {
    expect(validarRespostas(resp())).toEqual([]);
  });
  it("pergunta em branco reprova", () => {
    const r = resp(); delete r.p5;
    expect(validarRespostas(r)).toEqual(["Responda a pergunta 5."]);
  });
  it("duas ou mais marcadas exigem a mais importante entre elas", () => {
    expect(errosDaPergunta(P("p1"), { marcadas: ["salario", "colegas"] })).toHaveLength(1);
    expect(errosDaPergunta(P("p1"), { marcadas: ["salario", "colegas"], principal: "lideranca" })).toHaveLength(1);
  });
  it("complemento é obrigatório quando a alternativa dele foi marcada", () => {
    expect(errosDaPergunta(P("p3"), { marcadas: ["ruim"] })[0]).toContain("O que precisa melhorar?");
    expect(errosDaPergunta(P("p3"), { marcadas: ["ruim"], comp: { ruim: ["respeito", "apoio"] } })).toEqual([]);
  });
  it("'Outra empresa' pede o nome e o diferencial", () => {
    expect(errosDaPergunta(P("p6"), { marcadas: ["outra"], comp: { outra: ["salario"] } })[0]).toContain("Qual empresa?");
    expect(errosDaPergunta(P("p6"), { marcadas: ["outra"], comp: { outra: ["salario"] }, texto: { outra: "Empresa X" } })).toEqual([]);
  });
  it("exclusiva combinada reprova", () => {
    expect(errosDaPergunta(P("p8"), { marcadas: ["manter", "salario"], principal: "manter" }).join()).toContain("não pode ser combinada");
  });
});

describe("relatórios", () => {
  const ruim = resp({
    p2: { marcadas: ["lideranca", "fiscais"], principal: "lideranca", comp: { lideranca: ["grosseria"], fiscais: ["pressao"] } },
    p3: { marcadas: ["ruim"], comp: { ruim: ["respeito"] } },
    p4: { marcadas: ["negativo"], comp: { negativo: ["cobranca"] } },
    p5: { marcadas: ["ruins"], comp: { ruins: ["materiais", "descanso"] } },
    p6: { marcadas: ["outra"], comp: { outra: ["salario"] }, texto: { outra: "Empresa X" } },
    p7: { marcadas: ["nao"], comp: { nao: ["tratamento"] } },
  });
  const linhas: LinhaResposta[] = [
    linha(resp()), linha(resp()), linha(resp()), linha(ruim),
    linha(ruim, { filial: 20, contrato: "UFT", posto: "PO-2", funcao: "PORTEIRO", mes: "2026-11" }),
    linha(ruim, { filial: 20, contrato: "UFT", posto: "PO-2", funcao: "PORTEIRO", mes: "2026-11" }),
    linha(ruim, { filial: 20, contrato: "UFT", posto: "PO-2", funcao: "PORTEIRO", mes: "2026-11" }),
  ];

  it("conta marcados, mais importante e complemento", () => {
    const c = contarPergunta(linhas, "p2");
    expect(c.total).toBe(7);
    const lid = c.opcoes.find((o) => o.cod === "lideranca")!;
    expect(lid.n).toBe(4);
    expect(lid.principal).toBe(4);
    expect(lid.pct).toBe(57.1);
    expect(lid.comp.find((x) => x.cod === "grosseria")!.n).toBe(4);
    const p6 = contarPergunta(linhas, "p6").opcoes.find((o) => o.cod === "outra")!;
    expect(p6.textos).toEqual([{ texto: "EMPRESA X", n: 4 }]);
  });

  it("indicadores: satisfação, insatisfação, recomendação e problema por categoria", () => {
    const i = indicadores(linhas);
    // 3 respostas boas × 5 avaliações positivas = 15 de 35; 4 ruins × 5 negativas = 20 de 35.
    expect(i.satisfacao).toBe(42.9);
    expect(i.insatisfacao).toBe(57.1);
    expect(i.recomendacao).toBe(Math.round((42.9 - 57.1) * 10) / 10);
    expect(i.sinais).toEqual({ empresa: 57.1, fiscais: 57.1, orgao: 57.1, pessoal: 0 });
    expect(i.riscoPrincipal?.cod).toBe("lideranca");
  });

  it("agrupa por contrato e reserva grupo pequeno (anonimato)", () => {
    const g = agrupar(linhas, "contrato");
    expect(g.map((x) => [x.rotulo, x.linhas.length, x.reservado])).toEqual([["UFAC", 4, false], ["UFT", 3, false]]);
    const f = agrupar(filtrar(linhas, { contrato: "1-10" }), "funcao", 5);
    expect(f[0].reservado).toBe(true);
    expect(MIN_RESPOSTAS_GRUPO).toBe(3);
  });

  it("filtra por contrato, função e período", () => {
    expect(filtrar(linhas, { contrato: "1-20" })).toHaveLength(3);
    expect(filtrar(linhas, { funcao: "porteiro " })).toHaveLength(3);
    expect(filtrar(linhas, { de: "2026-11" })).toHaveLength(3);
  });

  it("resumo gerencial separa empresa, fiscais e órgão", () => {
    const r = resumoGerencial(linhas);
    const fiscais = r.find((c) => c.categoria === "fiscais")!;
    expect(fiscais.riscoSaida.map((x) => x.cod)).toEqual(["fiscais"]);
    expect(fiscais.detalhes.map((d) => d.rotulo)).toEqual(expect.arrayContaining(["Interferência ou pressão excessiva", "Cobranças excessivas ou injustas"]));
    const orgao = r.find((c) => c.categoria === "orgao")!;
    expect(orgao.detalhes.map((d) => d.cod).sort()).toEqual(["descanso", "materiais"]);
    expect(r.find((c) => c.categoria === "empresa")!.detalhes.some((d) => d.rotulo === "Respeito no tratamento")).toBe(true);
  });

  it("ponto de atenção só onde o grupo está bem acima do geral", () => {
    const p = pontosDeAtencao(linhas, "contrato");
    expect(p.every((x) => x.rotulo === "UFT")).toBe(true);
    expect(p.find((x) => x.indicador === "insatisfacao")!.valor).toBe(100);
  });
});

describe("rotatividade (conta do Turn-over)", () => {
  const tv: LinhaTurnover[] = [
    { empresa: 1, filial: 10, contrato: "UFAC", posto: "PO-1", posto_nome: "AUX", funcao: "AUX DE LIMPEZA", trab: [100, 100], dem: [5, 3], adm: [5, 3] },
    { empresa: 1, filial: 10, contrato: "UFAC", posto: "PO-9", posto_nome: "ENC", funcao: "ENCARREGADO", trab: [2, 2], dem: [0, 0], adm: [0, 0] },
    { empresa: 1, filial: 20, contrato: "UFT", posto: "PO-2", posto_nome: "PORT", funcao: "PORTEIRO", trab: [10, 0], dem: [2, 0], adm: [0, 0] },
  ];
  it("turnover médio = Σ demissões ÷ Σ efetivo no fim do mês × 100", () => {
    expect(taxaTurnover([100, 100], [5, 3])).toBe(4);
    expect(taxaTurnover([0, 0], [1, 0])).toBeNull();
  });
  it("agrupa por contrato e ordena do maior turnover", () => {
    const g = agruparTurnover(tv, "contrato");
    expect(g.map((x) => [x.rotulo, x.taxa, x.demissoes, x.efetivoMedio])).toEqual([["UFT", 20, 2, 5], ["UFAC", 3.9, 8, 102]]);
  });
  it("contexto da I.A leva só agregados, sem grupo pequeno e com o turnover do recorte", () => {
    const ls = [linha(resp()), linha(resp()), linha(resp()), linha(resp(), { filial: 20, contrato: "UFT", posto: "PO-2", funcao: "PORTEIRO" })];
    const c = contextoIA(ls, tv, ["2026-09", "2026-10"]);
    expect(c.total_respostas).toBe(4);
    expect(c.por_contrato.map((x) => x.grupo)).toEqual(["UFAC"]);
    expect(c.por_contrato[0].turnover_mensal_pct).toBe(3.9);
    expect(c.rotatividade_sem_pesquisa_suficiente.map((x) => x.contrato)).toEqual(["UFT"]);
    expect(JSON.stringify(c)).not.toContain("\"r\":");
  });
});
