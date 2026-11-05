import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO,
  PISO_VALOR,
  configDoPeriodo,
  distribuirPorPeso,
  pesosPadrao,
  redistribuirPesos,
  completarComEquipe,
  percentil,
  referenciaDoPeriodo,
  contribuicaoParaEquipe,
  dificuldadeDaComplexidade,
  diaEmBrasilia,
  entregaDaLinha,
  gerarCsv,
  htmlProposta,
  intervaloDaCompetencia,
  mediasDosCriterios,
  noPrazo,
  notaDaEntrega,
  notaDoGrupo,
  notasDaEntrega,
  pendenciasDaEntrega,
  pontosPerdidos,
  qualidadeSugerida,
  ratearBonificacao,
  resolverPeriodo,
  resumoPorDev,
  ultimasCompetencias,
  validarPesos,
  type EntregaBonificacao,
  type LinhaEntregaRpc,
  type LinhaPeriodo,
} from "@/lib/sistemas/bonificacaoColetiva";

const entrega = (p: Partial<EntregaBonificacao>): EntregaBonificacao => ({
  chamadoId: "c1", numero: "SIS-2026-0001", assunto: "Tarefa", devId: "d1", devNome: "Ana",
  concluidoDia: "2026-10-04", prazoLimite: "2026-10-05", concluidoNoPrazo: null,
  satisfacao: 5, qualidade: "sem_ajuste", dificuldade: "medio",
  valorMercado: 6400, valorFreelancer: 4000, valorClt: 2100, ...p,
});

// As oito tarefas do protótipo (Painel_ERP_Bonificacao_Coletiva.html).
const PROTOTIPO: EntregaBonificacao[] = [
  entrega({ chamadoId: "101", devId: "joao", devNome: "João Araújo", concluidoDia: "2026-10-04", prazoLimite: "2026-10-05", qualidade: "sem_ajuste", satisfacao: 5, dificuldade: "medio", valorMercado: 6400 }),
  entrega({ chamadoId: "102", devId: "joao", devNome: "João Araújo", concluidoDia: "2026-10-09", prazoLimite: "2026-10-08", qualidade: "ajuste_pequeno", satisfacao: 4, dificuldade: "facil", valorMercado: 2300 }),
  entrega({ chamadoId: "103", devId: "iury", devNome: "Iury Silva", concluidoDia: "2026-10-11", prazoLimite: "2026-10-12", qualidade: "sem_ajuste", satisfacao: 5, dificuldade: "muito_dificil", valorMercado: 16500 }),
  entrega({ chamadoId: "104", devId: "iury", devNome: "Iury Silva", concluidoDia: "2026-10-16", prazoLimite: "2026-10-15", qualidade: "retrabalho", satisfacao: 2, dificuldade: "dificil", valorMercado: 9000 }),
  entrega({ chamadoId: "105", devId: "pablo", devNome: "Pablo Santarém", concluidoDia: "2026-10-18", prazoLimite: "2026-10-18", qualidade: "sem_ajuste", satisfacao: 5, dificuldade: "medio", valorMercado: 5600 }),
  entrega({ chamadoId: "106", devId: "pablo", devNome: "Pablo Santarém", concluidoDia: "2026-10-21", prazoLimite: "2026-10-22", qualidade: "sem_ajuste", satisfacao: 4, dificuldade: "facil", valorMercado: 1700 }),
];

describe("notas por critério", () => {
  it("converte cada critério para 0–100 como no protótipo", () => {
    const n = notasDaEntrega(PROTOTIPO[0], CONFIG_PADRAO);
    expect(n).toEqual({ qualidade: 100, satisfacao: 100, prazo: 100, dificuldade: 50, valor: 82 }); // piso 50 + 50 × 6400/10000
    const n2 = notasDaEntrega(PROTOTIPO[1], CONFIG_PADRAO);
    expect(n2).toEqual({ qualidade: 50, satisfacao: 80, prazo: 0, dificuldade: 25, valor: 61.5 }); // piso 50 + 50 × 2300/10000
  });

  it("valor tem teto de 100", () => {
    expect(notasDaEntrega(PROTOTIPO[2], CONFIG_PADRAO).valor).toBe(100);
  });

  it("concluido_no_prazo do banco vence a comparação de datas", () => {
    expect(noPrazo(entrega({ concluidoNoPrazo: false, concluidoDia: "2026-10-01", prazoLimite: "2026-10-05" }))).toBe(false);
    expect(noPrazo(entrega({ concluidoNoPrazo: null, concluidoDia: "2026-10-05", prazoLimite: "2026-10-05" }))).toBe(true);
    expect(noPrazo(entrega({ concluidoNoPrazo: null, prazoLimite: null }))).toBeNull();
  });

  it("nota da entrega = Σ nota × peso ÷ 100", () => {
    // 100×.3 + 100×.2 + 100×.2 + 50×.15 + 82×.15 = 89,8
    expect(notaDaEntrega(PROTOTIPO[0], CONFIG_PADRAO)).toBeCloseTo(89.8, 6);
  });

  it("pontos perdidos somam 100 − nota", () => {
    const n = notasDaEntrega(PROTOTIPO[0], CONFIG_PADRAO);
    const perdidos = Object.values(pontosPerdidos(n, CONFIG_PADRAO.pesos)).reduce((a, b) => a + b, 0);
    expect(perdidos).toBeCloseTo(100 - 89.8, 6);
  });
});

describe("nota do grupo", () => {
  it("é a média de cada critério, depois os pesos (não a média das notas)", () => {
    const m = mediasDosCriterios(PROTOTIPO, CONFIG_PADRAO);
    expect(m.qualidade).toBeCloseTo((100 + 50 + 100 + 0 + 100 + 100) / 6, 6);
    const esperado = CONFIG_PADRAO.pesos.qualidade * m.qualidade! / 100
      + CONFIG_PADRAO.pesos.satisfacao * m.satisfacao! / 100
      + CONFIG_PADRAO.pesos.prazo * m.prazo! / 100
      + CONFIG_PADRAO.pesos.dificuldade * m.dificuldade! / 100
      + CONFIG_PADRAO.pesos.valor * m.valor! / 100;
    expect(notaDoGrupo(PROTOTIPO, CONFIG_PADRAO)).toBeCloseTo(esperado, 6);
  });

  it("critério sem dado sai da média e os pesos são renormalizados", () => {
    const e = entrega({ satisfacao: null }); // falta satisfação (peso 20)
    // (100×30 + 100×20 + 50×15 + 82×15) / 80
    expect(notaDaEntrega(e, CONFIG_PADRAO)).toBeCloseTo((3000 + 2000 + 750 + 1230) / 80, 6);
  });

  it("sem nenhuma entrega a nota é null", () => {
    expect(notaDoGrupo([], CONFIG_PADRAO)).toBeNull();
  });

  it("contribuição de uma tarefa para a equipe = nota ÷ total de entregas", () => {
    expect(contribuicaoParaEquipe(80, 8)).toBe(10);
    expect(contribuicaoParaEquipe(null, 8)).toBe(0);
  });

  it("agrupa por desenvolvedor em ordem alfabética", () => {
    const r = resumoPorDev(PROTOTIPO, CONFIG_PADRAO);
    expect(r.map((d) => d.devNome)).toEqual(["Iury Silva", "João Araújo", "Pablo Santarém"]);
    expect(r[0].mercado).toBe(25500);
  });
});

describe("rateio igualitário", () => {
  const devs = [{ devId: "b", devNome: "Bruno" }, { devId: "a", devNome: "Ana" }, { devId: "c", devNome: "Carla" }];

  it("libera verba × nota e divide igual, centavos fecham o total", () => {
    const r = ratearBonificacao(1000, 77.77, devs);
    expect(r.liberado).toBe(777.7);
    expect(r.saldo).toBe(222.3);
    expect(r.participantes.map((p) => p.devNome)).toEqual(["Ana", "Bruno", "Carla"]);
    expect(r.participantes.map((p) => p.valor)).toEqual([259.24, 259.23, 259.23]);
    const soma = Math.round(r.participantes.reduce((a, p) => a + p.valor, 0) * 100);
    expect(soma).toBe(77770);
  });

  it("dev repetido conta uma vez", () => {
    const r = ratearBonificacao(900, 100, [...devs, { devId: "a", devNome: "Ana" }]);
    expect(r.participantes).toHaveLength(3);
    expect(r.participantes.every((p) => p.valor === 300)).toBe(true);
  });

  it("sem participantes ou sem nota nada é liberado", () => {
    expect(ratearBonificacao(5000, 80, []).liberado).toBe(0);
    expect(ratearBonificacao(5000, 80, []).saldo).toBe(5000);
    expect(ratearBonificacao(5000, null, devs).liberado).toBe(0);
  });
});

describe("validações", () => {
  it("pesos inteiros que somam 100", () => {
    expect(validarPesos(CONFIG_PADRAO.pesos)).toBeNull();
    expect(validarPesos({ ...CONFIG_PADRAO.pesos, valor: 20 })).toMatch(/105%/);
    expect(validarPesos({ ...CONFIG_PADRAO.pesos, valor: 15.5, prazo: 19.5 })).toMatch(/inteiro/);
  });
});

describe("sugestões e linha da RPC", () => {
  it("complexidade 1–5 vira dificuldade", () => {
    expect([1, 2, 3, 4, 5].map(dificuldadeDaComplexidade)).toEqual(["facil", "medio", "medio", "dificil", "muito_dificil"]);
    expect(dificuldadeDaComplexidade(null)).toBeNull();
  });

  it("reaberturas sugerem a qualidade", () => {
    expect([0, 1, 2, 5].map(qualidadeSugerida)).toEqual(["sem_ajuste", "ajuste_pequeno", "retrabalho", "retrabalho"]);
  });

  it("dia da conclusão no fuso de Brasília", () => {
    expect(diaEmBrasilia("2026-11-01T02:30:00Z")).toBe("2026-10-31");
    expect(diaEmBrasilia("2026-11-01T03:00:00Z")).toBe("2026-11-01");
  });

  const linha: LinhaEntregaRpc = {
    chamado_id: "x", numero: "SIS-2026-0800", assunto: "Tela", tipo_solicitacao: "melhoria",
    responsavel_id: "d1", responsavel_nome: "Ana", concluido_em: "2026-10-10T15:00:00Z",
    prazo_limite: "2026-10-12", concluido_no_prazo: true, horas_gastas: "6.5", satisfacao: 4,
    reaberturas: 1, ia_status: "pronto", ia_complexidade: 4,
    ia_valor_mercado: "8000.00", ia_valor_freelancer: "5000", ia_valor_clt: "2500",
    qualidade: null, dificuldade: null, valor_mercado: null, valor_freelancer: null, valor_clt: null,
    fora_da_bonificacao: false, motivo_exclusao: null, observacao: null, avaliado_em: null,
  };

  it("sem avaliação do gestor usa as sugestões", () => {
    const e = entregaDaLinha(linha);
    expect(e.qualidade).toBe("ajuste_pequeno");
    expect(e.dificuldade).toBe("dificil");
    expect(e.valorMercado).toBe(8000);
    expect(e.horasGastas).toBe(6.5);
    expect(e.qualidadeAvaliada).toBe(false);
    expect(pendenciasDaEntrega(e)).toEqual(["qualidade não confirmada pelo gestor"]);
  });

  it("avaliação do gestor vence a IA", () => {
    const e = entregaDaLinha({ ...linha, qualidade: "sem_ajuste", dificuldade: "facil", valor_mercado: "1200" });
    expect(e.qualidade).toBe("sem_ajuste");
    expect(e.dificuldade).toBe("facil");
    expect(e.valorMercado).toBe(1200);
    expect(e.valorFreelancer).toBe(5000); // não sobrescrito → IA
  });
});

describe("período", () => {
  it("intervalo do mês", () => {
    expect(intervaloDaCompetencia("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28", competencia: "2026-02-01" });
    expect(intervaloDaCompetencia("2026-12").fim).toBe("2026-12-31");
  });

  it("últimas competências viram o ano", () => {
    expect(ultimasCompetencias("2026-02-15", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });

  const lp = (competencia: string, verba: number, peso_valor = 15, peso_prazo = 20): LinhaPeriodo => ({
    competencia, verba, peso_qualidade: 30, peso_satisfacao: 20, peso_prazo, peso_dificuldade: 15, peso_valor,
    pontos_facil: 25, pontos_medio: 50, pontos_dificil: 75, pontos_muito_dificil: 100, referencia_valor: 10000,
    observacao: null, fechado_em: null, fechado_por: null, resultado: null,
  });

  it("mês sem linha herda a configuração do anterior, mas não a verba", () => {
    const r = resolverPeriodo("2026-11", [lp("2026-09-01", 3000, 25, 10), lp("2026-10-01", 5000, 20, 15)]);
    expect(r.herdadoDe).toBe("2026-10");
    expect(r.verba).toBe(0);
    expect(r.config.pesos.valor).toBe(20);
  });

  it("sem nenhuma linha usa o padrão", () => {
    const r = resolverPeriodo("2026-11", []);
    expect(r.herdadoDe).toBe("padrao");
    expect(r.config).toEqual(CONFIG_PADRAO);
  });

  it("linha própria vale", () => {
    const r = resolverPeriodo("2026-10", [lp("2026-10-01", 5000)]);
    expect(r.herdadoDe).toBeNull();
    expect(r.verba).toBe(5000);
  });
});

describe("régua do valor (05/11/2026)", () => {
  it("piso: entrega de valor baixo nunca zera o critério", () => {
    expect(notasDaEntrega(entrega({ valorMercado: 1 }), CONFIG_PADRAO).valor).toBeCloseTo(50, 1);
    expect(notasDaEntrega(entrega({ valorMercado: 99999 }), CONFIG_PADRAO).valor).toBe(100);
    expect(PISO_VALOR).toBe(50);
  });

  it("percentil com interpolação linear", () => {
    expect(percentil([1000, 2000, 3000, 4000, 5000], 0.75)).toBe(4000);
    expect(percentil([1000, 2000], 0.75)).toBe(1750);
    expect(percentil([], 0.75)).toBeNull();
  });

  it("régua do mês = percentil 75 das entregas; com menos de 3 com valor, a fixa", () => {
    const vals = [800, 1200, 1600, 2000, 4000].map((v) => entrega({ valorMercado: v }));
    expect(referenciaDoPeriodo(vals, 10000)).toEqual({ valor: 2000, automatica: true, base: 5 });
    const poucas = [entrega({ valorMercado: 800 }), entrega({ valorMercado: null })];
    expect(referenciaDoPeriodo(poucas, 10000)).toEqual({ valor: 10000, automatica: false, base: 1 });
    // Chamado de R$ 1.000 num mês cuja régua é R$ 2.000: 50 + 50 × 0,5 = 75.
    const cfg = configDoPeriodo(CONFIG_PADRAO, vals);
    expect(cfg.referenciaValor).toBe(2000);
    expect(notasDaEntrega(entrega({ valorMercado: 1000 }), cfg).valor).toBe(75);
  });
});

describe("distribuição com peso no valor (05/11/2026)", () => {
  const dev = (devId: string, nota: number | null, devNome = devId) => ({ devId, devNome, nota, entregas: [] });
  it("peso padrão: Eduardo, Iury, João e Pablo iguais; os demais com metade", () => {
    const p = pesosPadrao([
      dev("e", 0, "Eduardo Jeiel Padilha Monteiro"), dev("i", 0, "IURY DE JESUS SILVA"),
      dev("j", 0, "João Victor Peretti de Araujo"), dev("p", 0, "Pablo Flores Santarem"), dev("o", 0, "OTAVIO DA SILVA FERREIRA"),
    ]);
    expect(p).toEqual({ e: 22.22, i: 22.22, j: 22.22, p: 22.22, o: 11.11 });
  });
  it("padrão pela porcentagem: os quatro recebem IGUAL, Otavio metade, fecha no liberado", () => {
    const d = distribuirPorPeso(4411.5, [
      dev("e", 100, "Eduardo"), dev("i", 96.3, "Iury"), dev("j", 91.4, "João"), dev("o", 82, "Otavio"), dev("p", 84.7, "Pablo"),
    ]);
    const v = Object.fromEntries(d.linhas.map((l) => [l.devId, l.valor]));
    expect(d.distribuido).toBe(4411.5);
    expect(new Set([v.e, v.i, v.j, v.p]).size).toBeLessThanOrEqual(2); // iguais (±1 centavo)
    expect(Math.abs(v.e - v.p)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(v.o - v.p / 2)).toBeLessThan(0.5);
  });
  it("pela porcentagem com pesos abaixo de 100: sobra saldo", () => {
    const d = distribuirPorPeso(1000, [dev("a", 50), dev("b", 90)], { a: 40, b: 40 });
    expect(d.linhas.map((l) => l.valor)).toEqual([400, 400]);
    expect(d.saldo).toBe(200);
  });
  it("divide o LIBERADO inteiro por peso × nota (fecha no centavo)", () => {
    const d = distribuirPorPeso(4411.5, [
      dev("e", 100, "Eduardo"), dev("i", 96.3, "Iury"), dev("j", 91.4, "João"), dev("o", 82, "Otavio"), dev("p", 84.7, "Pablo"),
    ], {}, "nota");
    expect(d.distribuido).toBe(4411.5);
    expect(d.saldo).toBe(0);
    expect(d.pesosPadrao).toBe(true);
    const v = Object.fromEntries(d.linhas.map((l) => [l.devId, l.valor]));
    expect(v.e).toBeGreaterThan(v.p);
    expect(v.o).toBeLessThan(v.p / 2 + 1);
  });
  it("peso personalizado e dev sem nota (leva 0, os outros levam tudo)", () => {
    const d = distribuirPorPeso(1000, [dev("a", 100), dev("b", null)], { a: 70, b: 30 }, "nota");
    expect(d.linhas.map((l) => l.valor)).toEqual([1000, 0]);
    expect(d.saldo).toBe(0);
    expect(d.pesosPadrao).toBe(false);
  });
  it("dev da equipe sem entrega no mês: aparece com 0% e R$ 0", () => {
    const devs = completarComEquipe([], [{ devId: "t", devNome: "Thamires" }]);
    expect(devs).toHaveLength(1);
    expect(devs[0].nota).toBeNull();
    const d = distribuirPorPeso(1000, [dev("p", 90, "Pablo"), { ...devs[0], entregas: [] }]);
    expect(d.linhas.map((l) => [l.peso, l.valor])).toEqual([[100, 1000], [0, 0]]);
    expect(d.pesosPadrao).toBe(true);
  });
  it("editar um peso redistribui entre os outros com peso, na proporção, e fecha em 100", () => {
    const base = { e: 22.22, i: 22.22, j: 22.22, p: 22.22, o: 11.11, t: 0 };
    const r = redistribuirPesos(base, "o", 5);
    expect(r.o).toBe(5);
    expect(r.t).toBe(0); // sem entrega continua em 0
    expect(Math.round(Object.values(r).reduce((a, b) => a + b, 0) * 100)).toBe(10000);
    for (const id of ["e", "i", "j", "p"]) expect(Math.abs(r[id] - 23.75)).toBeLessThanOrEqual(0.01);
    // aumentar: os outros diminuem na mesma proporção
    const r2 = redistribuirPesos({ a: 50, b: 30, c: 20 }, "a", 60);
    expect(r2).toEqual({ a: 60, b: 24, c: 16 });
    // nada sem destino depois da edição
    const d = distribuirPorPeso(1000, [dev("a", 90), dev("b", 80), dev("c", 70)], r2);
    expect(d.saldo).toBe(0);
    // ninguém mais com peso: o editado fica com 100
    expect(redistribuirPesos({ a: 100, b: 0 }, "a", 40)).toEqual({ a: 100, b: 0 });
    // acima de 100 vira 100 e os outros 0
    expect(redistribuirPesos({ a: 50, b: 50 }, "a", 150)).toEqual({ a: 100, b: 0 });
  });
  it("ninguém com nota: nada distribuído", () => {
    const d = distribuirPorPeso(1000, [dev("a", null)], {}, "nota");
    expect(d.distribuido).toBe(0);
    expect(d.saldo).toBe(1000);
  });
});

describe("exportações", () => {
  it("CSV com BOM, ponto e vírgula e a cota de cada dev", () => {
    const rateio = ratearBonificacao(5000, notaDoGrupo(PROTOTIPO, CONFIG_PADRAO), PROTOTIPO);
    const csv = gerarCsv(PROTOTIPO.slice(0, 1), CONFIG_PADRAO, rateio);
    expect(csv.startsWith("﻿")).toBe(true);
    const [cab, l1] = csv.slice(1).split("\r\n");
    expect(cab.split(";")).toHaveLength(19);
    expect(l1).toContain('"João Araújo"');
    expect(l1).toContain('"89,8"');
  });

  it("proposta escapa HTML", () => {
    const devs = resumoPorDev([entrega({ devNome: "<script>x</script>" })], CONFIG_PADRAO);
    const html = htmlProposta({
      mes: "2026-10", cfg: CONFIG_PADRAO, rateio: ratearBonificacao(1000, 80, devs), medias: devs[0].medias,
      devs, totalEntregas: 1, geradoEm: "05/11/2026", fechado: false,
    });
    expect(html).not.toContain("<script>x");
    expect(html).toContain("Outubro/2026");
  });
});
