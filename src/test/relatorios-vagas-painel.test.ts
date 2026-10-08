import { describe, expect, it } from "vitest";
import {
  agingAbertas, agruparVagas, aplicarFiltroLocal, diasPorEtapa, diasTotais, etapaAlcancada, etapaDoStatus, FILTRO_LOCAL_PADRAO,
  funilVagas, mediana, mensalVagas, resumoVagas, tempoAprovacao, tempoPorEtapa, trechosDaVaga,
  type PainelVagas, type VagaPainel,
} from "@/lib/relatorios/vagasPainel";

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

// Vaga do fluxo novo, contratada em 10 dias: 1 d aprovação, 1 d conferência, 5 d seleção, 2 d entrevistas, 1 d doc+SST.
const contratada = vaga({
  id: 10, criada: "2026-09-01T12:00:00Z", status: "Contratado", status_em: "2026-09-11T12:00:00Z", aberta: false,
  log: [
    ["Pendente Analista", "Pendente Recrutamento", "2026-09-02T12:00:00Z"],
    ["Pendente Recrutamento", "Vaga aberta - Seleção de Currículos", "2026-09-03T12:00:00Z"],
    ["Vaga aberta - Seleção de Currículos", "Entrevista e Avaliação", "2026-09-08T12:00:00Z"],
    ["Entrevista e Avaliação", "Aprovado - Aguardando SST", "2026-09-10T12:00:00Z"],
    ["Aprovado - Aguardando SST", "Aguardando SST e Compras", "2026-09-10T12:00:00Z"],
    ["Aguardando SST e Compras", "Contratado", "2026-09-11T12:00:00Z"],
  ],
  cand: cand({ total: 4, desistiu: 1, selecionado_em: "2026-09-09T12:00:00Z" }),
});
// Aberta, parada na seleção há 6 dias.
const aberta = vaga({
  id: 11, criada: "2026-09-25T12:00:00Z", status: "Vaga aberta - Seleção de Currículos", status_em: "2026-10-01T12:00:00Z",
  log: [
    ["Pendente Analista", "Pendente Recrutamento", "2026-09-29T12:00:00Z"],
    ["Pendente Recrutamento", "Vaga aberta - Seleção de Currículos", "2026-10-01T12:00:00Z"],
  ],
  cand: cand({ total: 2 }),
});
// Sistema antigo, concluída em 20 dias, sem log.
const legado = vaga({
  id: 12, criada: "2026-08-01T12:00:00Z", status: "Concluído", status_em: "2026-08-21T12:00:00Z", legado: true, aberta: false,
  aprovada_em: "2026-08-03T12:00:00Z", contrato: "contrato  a",
});
// Reprovada na aprovação.
const reprovada = vaga({
  id: 13, criada: "2026-09-20T12:00:00Z", status: "Reprovada", status_em: "2026-09-22T12:00:00Z", aberta: false, motivo: "Expansão (Aumento de Quadro)",
  log: [["Pendente Analista", "Reprovada", "2026-09-22T12:00:00Z"]],
});
// Aberta antiga, solicitada fora do período (entra só no "parado agora").
const foraPeriodo = vaga({ id: 14, criada: "2026-06-01T12:00:00Z", status: "Pendente Recrutamento", status_em: "2026-06-01T12:00:00Z", no_periodo: false });

const painel: PainelVagas = { de: "2026-08-01", ate: "2026-10-07", agora: AGORA, log_desde: "2026-08-19T00:00:00Z", vagas: [contratada, aberta, legado, reprovada, foraPeriodo] };

describe("etapas e trechos", () => {
  it("mapeia status do banco nas etapas do fluxo", () => {
    expect(etapaDoStatus("Pendente Diretoria")).toBe("aprovacao");
    expect(etapaDoStatus("Compras Confirmou - Aguardando Documentação")).toBe("aprovado");
    expect(etapaDoStatus("Concluído")).toBe("contratado");
    expect(etapaDoStatus("Algo novo")).toBe("outros");
  });

  it("quebra a vaga contratada em trechos por etapa", () => {
    const d = diasPorEtapa(trechosDaVaga(contratada, AGORA));
    expect(d).toEqual({ aprovacao: 1, recrutamento: 1, selecao: 5, entrevistas: 2, aprovado: 0, sst_compras: 1 });
    expect(diasTotais(contratada, AGORA)).toBe(10);
  });

  it("vaga aberta tem o trecho atual aberto até agora", () => {
    const tr = trechosDaVaga(aberta, AGORA);
    const ult = tr[tr.length - 1];
    expect(ult.aberto).toBe(true);
    expect(ult.etapa).toBe("selecao");
    expect(ult.dias).toBe(6);
    expect(diasPorEtapa(tr)).toEqual({ aprovacao: 4, recrutamento: 2 });
  });

  it("legado sem log vira um trecho só, sem contar nas etapas do fluxo", () => {
    const tr = trechosDaVaga(legado, AGORA);
    expect(tr).toHaveLength(1);
    expect(tr[0].etapa).toBe("legado");
    expect(tr[0].dias).toBe(20);
  });

  it("vaga que nunca trocou de status fica no status atual desde a criação", () => {
    const tr = trechosDaVaga(foraPeriodo, AGORA);
    expect(tr).toHaveLength(1);
    expect(tr[0].etapa).toBe("recrutamento");
    expect(tr[0].aberto).toBe(true);
  });
});

describe("tempos e alcance", () => {
  it("tempo de aprovação sai do log ou do histórico do legado", () => {
    expect(tempoAprovacao(contratada)).toBe(1);
    expect(tempoAprovacao(aberta)).toBe(4);
    expect(tempoAprovacao(legado)).toBe(2);
    expect(tempoAprovacao(reprovada)).toBeNull();
  });

  it("até onde a vaga chegou", () => {
    expect(etapaAlcancada(contratada)).toBe(7);
    expect(etapaAlcancada(aberta)).toBe(2);
    expect(etapaAlcancada(reprovada)).toBe(0);
  });

  it("mediana", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(mediana([])).toBeNull();
  });
});

describe("painel", () => {
  it("resumo do período", () => {
    const r = resumoVagas(painel);
    expect(r.solicitadas).toBe(4);
    expect(r.contratadas).toBe(2);
    expect(r.reprovadas).toBe(1);
    expect(r.abertasAgora).toBe(2);
    expect(r.tempoMedioContratar).toBe(15);
    expect(r.medianaContratar).toBe(15);
    expect(r.noPrazoPct).toBe(50);
    expect(r.aproveitamentoPct).toBeCloseTo(66.67, 1);
    expect(r.abertaMaisAntiga?.id).toBe(14);
    expect(r.desistencias).toBe(1);
  });

  it("tempo médio por etapa e paradas agora", () => {
    const t = tempoPorEtapa(painel);
    const sel = t.find((l) => l.chave === "selecao")!;
    expect(sel.vagas).toBe(1);
    expect(sel.media).toBe(5);
    expect(sel.paradasAgora).toBe(1);
    expect(sel.maiorParada).toBe(6);
    const apr = t.find((l) => l.chave === "aprovacao")!;
    expect(apr.media).toBeCloseTo((1 + 4 + 2) / 3);
    const rec = t.find((l) => l.chave === "recrutamento")!;
    expect(rec.paradasAgora).toBe(1);   // a de fora do período
    expect(t.find((l) => l.chave === "legado")!.media).toBe(20);
  });

  it("funil", () => {
    const f = Object.fromEntries(funilVagas(painel).map((d) => [d.chave, d.n]));
    expect(f).toEqual({ solicitadas: 4, aprovadas: 3, abertas: 3, entrevistas: 2, aprovado: 2, contratadas: 2 });
  });

  it("mês a mês por coorte de solicitação", () => {
    const m = mensalVagas(painel);
    expect(m.map((x) => x.mes)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const set = m.find((x) => x.mes === "2026-09")!;
    expect(set).toMatchObject({ solicitadas: 3, contratadas: 1, reprovadas: 1, andamento: 1, tempoMedio: 10 });
  });

  it("agrupa por contrato ignorando caixa e espaços", () => {
    const g = agruparVagas(painel, "contrato");
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ vagas: 4, abertas: 2, contratadas: 2 });
  });

  it("aging das abertas", () => {
    const a = agingAbertas(painel);
    expect(a.find((f) => f.rotulo === "8–15 d")!.vagas).toBe(1);
    expect(a.find((f) => f.rotulo === "+60 d")!.vagas).toBe(1);
  });

  it("filtro local por busca, fase e legado", () => {
    expect(aplicarFiltroLocal(painel, { ...FILTRO_LOCAL_PADRAO, busca: "#13" }).vagas.map((v) => v.id)).toEqual([13]);
    expect(aplicarFiltroLocal(painel, { ...FILTRO_LOCAL_PADRAO, fase: "contratada" }).vagas.map((v) => v.id)).toEqual([10, 12]);
    expect(aplicarFiltroLocal(painel, { ...FILTRO_LOCAL_PADRAO, legado: false }).vagas).toHaveLength(4);
  });
});
