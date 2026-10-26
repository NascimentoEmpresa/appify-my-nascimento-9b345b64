import { describe, expect, it } from "vitest";
import { agruparVagas, resumoVagas, vagasDoRecorte, type PainelVagas, type VagaPainel } from "@/lib/relatorios/vagasPainel";
import {
  FILTRO_RECRUTADORES_PADRAO, SEM_RESPONSAVEL, chaveRecrutador, idsDaCelula, linhasRecrutadores, movDoRecorte, movMensalPorRecrutador,
  movPorMes, movPorVaga, ordenarRanking, recorteRecrutadores, rotuloRecrutador, vagasDoRecrutador, type LinhaMov,
} from "@/lib/relatorios/recrutadoresPainel";

// Vagas — DASHBOARD - RECRUTADORES (21/10/2026). O que estes testes travam:
// o ranking por recrutador SOMA o que a Visão geral mostra no mesmo recorte
// (ninguém some, nem a linha "Sem responsável"), os números de um recrutador
// são os do resumoVagas só com as vagas dele, e as movimentações vão para
// QUEM fez — não para a dona da vaga.

const AGORA = "2026-10-21T12:00:00Z";
const cand = (o: Partial<VagaPainel["cand"]> = {}): VagaPainel["cand"] => ({
  total: 0, desistiu: 0, etapas: {}, primeiro_em: null, selecionado_em: null, enviado_em: null, ...o,
});
const vaga = (o: Partial<VagaPainel>): VagaPainel => ({
  id: 1, criada: "2026-10-01T12:00:00Z", status: "Vaga aberta - Seleção de Currículos", status_em: null, cargo: "Porteiro", cidade: "Curitiba", uf: "PR",
  contrato: "CONTRATO A", setor: null, motivo: "Substituição", urgencia: "Média", qtd: 1, solicitante: "Ana", analista: null,
  aprovado_por: null, contratado: null, inicio_previsto: null, substituido: null, motivo_reprovacao: null, legado: false,
  administrativa: false, reserva: false, encarregado: false, no_periodo: true, aberta: true, log: [], aprovada_em: null, cand: cand(),
  responsavel: null, ...o,
});

const vagas: VagaPainel[] = [
  // Giovana: contratada em 10 d (no prazo) e outra em 20 d; uma aberta.
  vaga({ id: 1, responsavel: "Giovana", criada: "2026-09-01T12:00:00Z", status: "Contratado", status_em: "2026-09-11T12:00:00Z", aberta: false, cand: cand({ total: 5, desistiu: 1 }) }),
  vaga({ id: 2, responsavel: "giovana ", criada: "2026-09-05T12:00:00Z", status: "Contratado", status_em: "2026-09-25T12:00:00Z", aberta: false, cand: cand({ total: 3 }) }),
  vaga({ id: 3, responsavel: "Giovana", criada: "2026-10-10T12:00:00Z", contrato: "Contrato B", cand: cand({ total: 2 }) }),
  // Pamela: reprovada e cancelada; uma aberta pedida ANTES do período (conta só em "abertas agora").
  vaga({ id: 4, responsavel: "Pamela", criada: "2026-09-10T12:00:00Z", status: "Reprovada", status_em: "2026-09-12T12:00:00Z", aberta: false }),
  vaga({ id: 5, responsavel: "Pamela", criada: "2026-09-15T12:00:00Z", status: "Cancelada", status_em: "2026-09-16T12:00:00Z", aberta: false }),
  vaga({ id: 6, responsavel: "Pamela", criada: "2026-05-01T12:00:00Z", no_periodo: false }),
  // Sistema antigo sem responsável, contratada.
  vaga({ id: 7, legado: true, criada: "2026-08-10T12:00:00Z", status: "Contratado", status_em: "2026-08-30T12:00:00Z", aberta: false }),
  // Fechada fora do período: fica de fora de tudo.
  vaga({ id: 8, responsavel: "Giovana", criada: "2026-03-01T12:00:00Z", status: "Contratado", status_em: "2026-03-10T12:00:00Z", aberta: false, no_periodo: false }),
];
const p: PainelVagas = { de: "2026-08-01", ate: "2026-10-21", agora: AGORA, log_desde: "2026-08-19T00:00:00Z", vagas };

const mov: LinhaMov[] = [
  [1, "Giovana", "2026-09-02", "selecao", 2, [101, 102]],
  [1, "Giovana", "2026-09-08", "movimento", 3, [101, 102]],
  [1, "Giovana", "2026-09-10", "admissao", 1, [101]],
  // Pamela mexeu numa vaga da Giovana: conta para a Pamela.
  [3, "Pamela", "2026-10-12", "movimento", 1, [301]],
  [4, "PAMELA", "2026-09-11", "reprovacao", 2, [401, 402]],
  // Vaga que não está no painel (ex.: filtrada): não entra.
  [99, "Giovana", "2026-09-20", "movimento", 5, [991]],
];

const linha = (ls: ReturnType<typeof linhasRecrutadores>, nome: string) => ls.find((l) => l.chave === chaveRecrutador(nome))!;

describe("ranking por recrutador fecha com a Visão geral", () => {
  const ls = linhasRecrutadores(p, mov);
  const r = resumoVagas(p);

  it("soma das linhas = KPIs da Visão geral", () => {
    const soma = (f: (l: (typeof ls)[number]) => number) => ls.reduce((s, l) => s + f(l), 0);
    expect(soma((l) => l.vagas)).toBe(r.solicitadas);
    expect(soma((l) => l.contratadas)).toBe(r.contratadas);
    expect(soma((l) => l.reprovadas + l.canceladas)).toBe(r.reprovadas + r.canceladas);
    expect(soma((l) => l.abertasAgora)).toBe(r.abertasAgora);
    expect(soma((l) => l.desistencias)).toBe(r.desistencias);
    expect(soma((l) => l.posicoes)).toBe(r.posicoes);
  });

  it("mesmo agrupamento da tabela 'Responsável pela vaga' (caixa/espaço juntam)", () => {
    const g = agruparVagas(p, "responsavel");
    for (const x of g) {
      const l = linha(ls, x.nome);
      expect([l.vagas, l.contratadas, l.abertasAgora, l.reprovadas + l.canceladas]).toEqual([x.vagas, x.contratadas, x.abertas, x.reprovadas]);
    }
    expect(linha(ls, "GIOVANA").vagas).toBe(3);
  });

  it("vaga sem responsável não some: vira 'Sem responsável'", () => {
    const sem = linha(ls, SEM_RESPONSAVEL);
    expect(sem.semResponsavel).toBe(true);
    expect(sem.contratadas).toBe(1);
    expect(rotuloRecrutador(SEM_RESPONSAVEL)).toBe("Sem responsável");
  });

  it("números de UM recrutador = resumoVagas só com as vagas dele", () => {
    const g = linha(ls, "Giovana");
    const rg = resumoVagas(vagasDoRecrutador(p, g.chave));
    expect(g.contratadas).toBe(rg.contratadas);
    expect(g.tempoMedioContratar).toBeCloseTo(rg.tempoMedioContratar!, 6);
    expect(g.noPrazoPct).toBeCloseTo(rg.noPrazoPct!, 6);
    expect(g.noPrazo).toBe(1);
    expect(g.tempoMedioContratar).toBeCloseTo(15, 6);
    expect(g.aproveitamentoPct).toBe(100);
    const pa = linha(ls, "Pamela");
    expect([pa.vagas, pa.reprovadas, pa.canceladas, pa.abertasAgora, pa.aproveitamentoPct]).toEqual([2, 1, 1, 1, 0]);
  });
});

describe("movimentações vão para quem fez", () => {
  const ls = linhasRecrutadores(p, mov);

  it("conta eventos, candidatos distintos, dias e vagas de outras pessoas", () => {
    const g = linha(ls, "Giovana").mov;
    expect(g.eventos).toBe(6);              // a vaga 99 (fora do painel) não entra
    expect(g.candidatos).toBe(2);
    expect(g.diasAtivos).toBe(3);
    expect(g.ultimo).toBe("2026-09-10");
    expect(g.porTipo.admissao).toBe(1);
    expect(g.emVagasDeOutros).toBe(0);
    const pa = linha(ls, "Pamela").mov;
    expect(pa.eventos).toBe(3);
    expect(pa.candidatos).toBe(3);
    expect(pa.vagasTocadas).toBe(2);
    expect(pa.emVagasDeOutros).toBe(1);     // a vaga 3 é da Giovana
  });

  it("pessoa só com movimentos (sem vaga) também aparece", () => {
    const ls2 = linhasRecrutadores(p, [...mov, [1, "Thaimiani", "2026-09-03", "candidato", 1, [103]]]);
    const t = linha(ls2, "Thaimiani");
    expect([t.vagas, t.mov.eventos]).toEqual([0, 1]);
  });

  it("filtro de vaga/contrato vale para as duas fontes", () => {
    const pb = recorteRecrutadores(p, { ...FILTRO_RECRUTADORES_PADRAO, contrato: "contrato  b" });
    expect(pb.vagas.map((v) => v.id)).toEqual([3]);
    const lb = linhasRecrutadores(pb, mov);
    expect(linha(lb, "Pamela").mov.eventos).toBe(1);
    expect(linha(lb, "Giovana").mov.eventos).toBe(0);
    expect(recorteRecrutadores(p, { ...FILTRO_RECRUTADORES_PADRAO, vaga: 4 }).vagas.map((v) => v.id)).toEqual([4]);
    expect(recorteRecrutadores(p, FILTRO_RECRUTADORES_PADRAO)).toBe(p);
    expect(movDoRecorte(mov, p, chaveRecrutador("pamela"))).toHaveLength(2);
  });

  it("mês a mês pela data do movimento", () => {
    const m = movPorMes(movDoRecorte(mov, p), p.de, p.ate);
    expect(m.map((x) => x.mes)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(m.map((x) => x.eventos)).toEqual([0, 8, 1]);
    const s = movMensalPorRecrutador(movDoRecorte(mov, p), [chaveRecrutador("Giovana"), chaveRecrutador("Pamela")], p.de, p.ate);
    expect(s[1]).toMatchObject({ mes: "2026-09", GIOVANA: 6, PAMELA: 2 });
    const pv = movPorVaga(movDoRecorte(mov, p, "GIOVANA"));
    expect(pv.get(1)).toEqual({ eventos: 6, candidatos: 2 });
  });
});

describe("ordem e lista por trás das células", () => {
  const ls = linhasRecrutadores(p, mov);

  it("'Sem responsável' sempre por último", () => {
    const o = ordenarRanking(ls, "contratadas");
    expect(o[o.length - 1].semResponsavel).toBe(true);
    expect(o[0].chave).toBe("GIOVANA");
    expect(ordenarRanking(ls, "movimentos")[0].chave).toBe("GIOVANA");
  });

  it("a lista de cada célula tem o número da célula", () => {
    for (const l of ls) {
      expect(idsDaCelula(p, mov, l.chave, "vagas")).toHaveLength(l.vagas);
      expect(idsDaCelula(p, mov, l.chave, "contratadas")).toHaveLength(l.contratadas);
      expect(idsDaCelula(p, mov, l.chave, "reprovadas")).toHaveLength(l.reprovadas + l.canceladas);
      expect(idsDaCelula(p, mov, l.chave, "abertas")).toHaveLength(l.abertasAgora);
      expect(idsDaCelula(p, mov, l.chave, "no_prazo")).toHaveLength(l.noPrazo);
      expect(idsDaCelula(p, mov, l.chave, "tocadas")).toHaveLength(l.mov.vagasTocadas);
    }
    const ids = idsDaCelula(p, mov, "GIOVANA", "contratadas");
    expect(vagasDoRecorte(p, { tipo: "lista", titulo: "x", ids }).map((v) => v.id).sort()).toEqual([1, 2]);
  });
});
