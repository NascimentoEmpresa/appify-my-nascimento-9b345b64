import { describe, expect, it } from "vitest";
import {
  FAIXAS_AGING, agingAbertas, agruparVagas, filtrarRecorte, funilVagas, mensalVagas, ordenarRecorte, resumoVagas, tempoPorEtapa,
  tituloRecorte, vagasDoRecorte, type PainelVagas, type VagaPainel,
} from "@/lib/relatorios/vagasPainel";

// Vagas — Dashboard (08/10/2026): clicar num gráfico abre a lista das vagas
// por trás dele. O que estes testes travam: a lista tem SEMPRE o número que
// o gráfico mostra — o recorte usa o mesmo critério da conta.

const AGORA = "2026-10-07T12:00:00Z";
const cand = (o: Partial<VagaPainel["cand"]> = {}): VagaPainel["cand"] => ({
  total: 0, desistiu: 0, etapas: {}, primeiro_em: null, selecionado_em: null, enviado_em: null, ...o,
});
const vaga = (o: Partial<VagaPainel>): VagaPainel => ({
  id: 1, criada: "2026-10-01T12:00:00Z", status: "Pendente Analista", status_em: null, cargo: "Porteiro", cidade: "Curitiba", uf: "PR",
  contrato: "CONTRATO A", setor: null, motivo: "Substituição", urgencia: "Média", qtd: 1, solicitante: "Ana", analista: null,
  aprovado_por: null, contratado: null, inicio_previsto: null, substituido: null, motivo_reprovacao: null, legado: false,
  administrativa: false, reserva: false, encarregado: false, no_periodo: true, aberta: true, log: [], aprovada_em: null, cand: cand(), ...o,
});

const vagas: VagaPainel[] = [
  // Contratada em 10 dias.
  vaga({
    id: 10, criada: "2026-09-01T12:00:00Z", status: "Contratado", status_em: "2026-09-11T12:00:00Z", aberta: false, urgencia: "Alta",
    log: [
      ["Pendente Analista", "Pendente Recrutamento", "2026-09-02T12:00:00Z"],
      ["Pendente Recrutamento", "Vaga aberta - Seleção de Currículos", "2026-09-03T12:00:00Z"],
      ["Vaga aberta - Seleção de Currículos", "Entrevista e Avaliação", "2026-09-08T12:00:00Z"],
      ["Entrevista e Avaliação", "Contratado", "2026-09-11T12:00:00Z"],
    ],
    cand: cand({ total: 4, desistiu: 1, selecionado_em: "2026-09-09T12:00:00Z" }),
  }),
  // Aberta há 12 dias, na seleção.
  vaga({
    id: 11, criada: "2026-09-25T12:00:00Z", status: "Vaga aberta - Seleção de Currículos", status_em: "2026-10-01T12:00:00Z", cargo: "Recepcionista",
    log: [["Pendente Analista", "Pendente Recrutamento", "2026-09-29T12:00:00Z"], ["Pendente Recrutamento", "Vaga aberta - Seleção de Currículos", "2026-10-01T12:00:00Z"]],
    cand: cand({ total: 2 }),
  }),
  // Aberta há 20 dias (faixa 16–30 d), contrato B.
  vaga({ id: 15, criada: "2026-09-17T12:00:00Z", status: "Pendente Recrutamento", status_em: "2026-09-18T12:00:00Z", contrato: "Contrato B", qtd: 3 }),
  // Reprovada.
  vaga({ id: 13, criada: "2026-09-20T12:00:00Z", status: "Reprovada", status_em: "2026-09-22T12:00:00Z", aberta: false, log: [["Pendente Analista", "Reprovada", "2026-09-22T12:00:00Z"]] }),
  // Aberta de fora do período (+60 d): só nos "abertos agora".
  vaga({ id: 14, criada: "2026-06-01T12:00:00Z", status: "Pendente Recrutamento", status_em: "2026-06-01T12:00:00Z", no_periodo: false, contrato: "contrato  a" }),
];
const p: PainelVagas = { de: "2026-08-01", ate: "2026-10-07", agora: AGORA, log_desde: "2026-08-19T00:00:00Z", vagas };
const ids = (vs: VagaPainel[]) => vs.map((v) => v.id).sort((a, b) => a - b);

describe("recorte = o mesmo número do gráfico", () => {
  it("aging: cada faixa lista as abertas daquela idade (16–30 d → a #15)", () => {
    agingAbertas(p).forEach((f, i) => expect(vagasDoRecorte(p, { tipo: "aging", faixa: i })).toHaveLength(f.vagas));
    const i1630 = FAIXAS_AGING.findIndex((f) => f.rotulo === "16–30 d");
    expect(ids(vagasDoRecorte(p, { tipo: "aging", faixa: i1630 }))).toEqual([15]);
    expect(ids(vagasDoRecorte(p, { tipo: "aging", faixa: FAIXAS_AGING.length - 1 }))).toEqual([14]);
    expect(vagasDoRecorte(p, { tipo: "aging", faixa: 99 })).toEqual([]);
  });

  it("funil: cada degrau", () => {
    for (const d of funilVagas(p)) expect(vagasDoRecorte(p, { tipo: "funil", degrau: d.chave })).toHaveLength(d.n);
  });

  it("mês a mês: o mês inteiro e cada pedaço da barra", () => {
    for (const m of mensalVagas(p)) {
      expect(vagasDoRecorte(p, { tipo: "mes", mes: m.mes })).toHaveLength(m.solicitadas);
      expect(vagasDoRecorte(p, { tipo: "mes", mes: m.mes, desfecho: "contratadas" })).toHaveLength(m.contratadas);
      expect(vagasDoRecorte(p, { tipo: "mes", mes: m.mes, desfecho: "andamento" })).toHaveLength(m.andamento);
      expect(vagasDoRecorte(p, { tipo: "mes", mes: m.mes, desfecho: "reprovadas" })).toHaveLength(m.reprovadas);
    }
  });

  it("tabela por contrato: cada coluna, juntando grafias diferentes", () => {
    for (const g of agruparVagas(p, "contrato")) {
      expect(vagasDoRecorte(p, { tipo: "grupo", dim: "contrato", nome: g.nome, coluna: "vagas" })).toHaveLength(g.vagas);
      expect(vagasDoRecorte(p, { tipo: "grupo", dim: "contrato", nome: g.nome, coluna: "abertas" })).toHaveLength(g.abertas);
      expect(vagasDoRecorte(p, { tipo: "grupo", dim: "contrato", nome: g.nome, coluna: "contratadas" })).toHaveLength(g.contratadas);
      expect(vagasDoRecorte(p, { tipo: "grupo", dim: "contrato", nome: g.nome, coluna: "reprovadas" })).toHaveLength(g.reprovadas);
    }
    // "CONTRATO A" e "contrato  a" são o mesmo grupo; a linha inteira traz as do período + as abertas de fora.
    expect(ids(vagasDoRecorte(p, { tipo: "grupo", dim: "contrato", nome: "CONTRATO A" }))).toEqual([10, 11, 13, 14]);
  });

  it("etapas: paradas agora e as que passaram", () => {
    for (const e of tempoPorEtapa(p)) {
      expect(vagasDoRecorte(p, { tipo: "etapa_parada", etapa: e.chave })).toHaveLength(e.paradasAgora);
      expect(vagasDoRecorte(p, { tipo: "etapa_passou", etapa: e.chave })).toHaveLength(e.vagas);
    }
  });

  it("KPIs", () => {
    const r = resumoVagas(p);
    expect(vagasDoRecorte(p, { tipo: "kpi", kpi: "solicitadas" })).toHaveLength(r.solicitadas);
    expect(vagasDoRecorte(p, { tipo: "kpi", kpi: "contratadas" })).toHaveLength(r.contratadas);
    expect(vagasDoRecorte(p, { tipo: "kpi", kpi: "reprovadas" })).toHaveLength(r.reprovadas + r.canceladas);
    expect(vagasDoRecorte(p, { tipo: "kpi", kpi: "abertas" })).toHaveLength(r.abertasAgora);
    expect(ids(vagasDoRecorte(p, { tipo: "kpi", kpi: "no_prazo" }))).toEqual([10]);
    expect(ids(vagasDoRecorte(p, { tipo: "kpi", kpi: "desistencias" }))).toEqual([10]);
  });

  it("desfecho (pizza)", () => {
    expect(ids(vagasDoRecorte(p, { tipo: "desfecho", desfecho: "andamento" }))).toEqual([11, 15]);
    expect(ids(vagasDoRecorte(p, { tipo: "desfecho", desfecho: "reprovada" }))).toEqual([13]);
  });
});

describe("lista do recorte", () => {
  it("título", () => {
    expect(tituloRecorte({ tipo: "aging", faixa: 2 })).toBe("Abertas agora há 16–30 d");
    expect(tituloRecorte({ tipo: "mes", mes: "2026-06", desfecho: "contratadas" })).toBe("Contratadas · vagas pedidas em jun/26");
    expect(tituloRecorte({ tipo: "grupo", dim: "urgencia", nome: "Alta", coluna: "contratadas" })).toBe("Urgência: Alta · contratadas");
  });

  it("busca sem acento e filtro por desfecho", () => {
    const todas = vagasDoRecorte(p, { tipo: "kpi", kpi: "solicitadas" });
    expect(ids(filtrarRecorte(todas, "RECEPÇ", null))).toEqual([11]);   // sem acento e sem caixa
    expect(ids(filtrarRecorte(todas, "porteiro", null))).toEqual([10, 13, 15]);
    expect(ids(filtrarRecorte(todas, "#13", null))).toEqual([13]);
    expect(ids(filtrarRecorte(todas, "", "contratada"))).toEqual([10]);
  });

  it("ordem: mais tempo, mais antigas, mais recentes, candidatos", () => {
    const ab = vagasDoRecorte(p, { tipo: "kpi", kpi: "abertas" });
    expect(ordenarRecorte(ab, AGORA, "demoradas").map((v) => v.id)).toEqual([14, 15, 11]);
    expect(ordenarRecorte(ab, AGORA, "antigas").map((v) => v.id)).toEqual([14, 15, 11]);
    expect(ordenarRecorte(ab, AGORA, "recentes").map((v) => v.id)).toEqual([15, 14, 11]);
    expect(ordenarRecorte(ab, AGORA, "candidatos")[0].id).toBe(11);
  });
});
