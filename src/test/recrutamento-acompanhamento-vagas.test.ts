import { describe, expect, it } from "vitest";
import {
  FILTRO_ACOMP_PADRAO, filtrarAcompanhamento, montarAcompanhamento, resumoDesistencias, vagasPorContrato, type ExtraVaga,
} from "@/lib/recrutamento/acompanhamentoVagas";
import type { VagaPainel } from "@/lib/relatorios/vagasPainel";

const AGORA = "2026-10-19T12:00:00Z";
const vaga = (o: Partial<VagaPainel>): VagaPainel => ({
  id: 1, criada: "2026-10-01T12:00:00Z", status: "Entrevista e Avaliação", status_em: "2026-10-15T12:00:00Z",
  cargo: "Servente", cidade: "Porto Alegre", uf: "RS", contrato: "1109 - POLÍCIA CIVIL", setor: null, motivo: null, urgencia: null, qtd: 1,
  solicitante: null, analista: null, aprovado_por: null, contratado: null, responsavel: "Pamela", responsavel_origem: "automatico",
  inicio_previsto: null, substituido: null, motivo_reprovacao: null, legado: false, administrativa: false, reserva: false, encarregado: false,
  no_periodo: true, aberta: true, log: [], aprovada_em: null,
  cand: { total: 0, desistiu: 0, etapas: {}, primeiro_em: null, selecionado_em: null, enviado_em: null },
  ...o,
});
const extra = (o: Partial<ExtraVaga>): ExtraVaga => ({
  id: 1, recrutadora: null, responsavel: null, responsavel_origem: null, admissao: null, desistencias: [], reprovados: 0, ...o,
});

describe("montarAcompanhamento", () => {
  it("vaga aberta: dias desde a solicitação, etapa atual e desde quando", () => {
    const [l] = montarAcompanhamento([vaga({})], { 1: extra({ recrutadora: "Thaimiani", responsavel: "Thaimiani" }) }, AGORA);
    expect(l.aberta).toBe(true);
    expect(l.diasAberto).toBe(18);
    expect(l.diasEtapa).toBe(4);
    expect(l.recrutadora).toBe("Thaimiani");
    expect(l.responsavelAtual).toBe("Thaimiani");
  });
  it("encaminhada à Admissão: segue aberta, com a Admissão como responsável atual", () => {
    const v = vaga({ status: "Contratado", status_em: "2026-10-17T12:00:00Z", log: [["Aguardando SST e Compras", "Contratado", "2026-10-17T12:00:00Z"]] });
    const x = extra({ recrutadora: "Thaimiani", responsavel: "Thaimiani",
      admissao: { responsavel: "Giovana", enviado_em: "2026-10-17T12:00:00Z", aguardando: 1, recrutadora: "Thaimiani" } });
    const [l] = montarAcompanhamento([v], { 1: x }, AGORA);
    expect(l.aberta).toBe(true);
    expect(l.aguardandoAdmissao).toBe(true);
    expect(l.etapaTitulo).toBe("Aguardando admissão");
    expect(l.responsavelAtual).toBe("Giovana");
    expect(l.recrutadora).toBe("Thaimiani");
    expect(l.diasAberto).toBe(18);           // a contagem não para no envio
    expect(l.porEtapa.admissao).toBe(2);
  });
  it("concluída: conta até a conclusão", () => {
    const v = vaga({ status: "Contratado", status_em: "2026-10-11T12:00:00Z", log: [["Entrevista e Avaliação", "Contratado", "2026-10-11T12:00:00Z"]] });
    const [l] = montarAcompanhamento([v], {}, AGORA);
    expect(l.aberta).toBe(false);
    expect(l.diasAberto).toBe(10);
    expect(l.diasEtapa).toBeNull();
  });
});

describe("filtros e agrupamentos", () => {
  const linhas = montarAcompanhamento([
    vaga({ id: 1 }),
    vaga({ id: 2, contrato: "1099 - PREF POA", cidade: "Glorinha" }),
    vaga({ id: 3, status: "Reprovada", status_em: "2026-10-05T12:00:00Z", log: [["Pendente Recrutamento", "Reprovada", "2026-10-05T12:00:00Z"]] }),
  ], {
    1: extra({ id: 1, recrutadora: "Thaimiani", responsavel: "Thaimiani",
      desistencias: [{ candidato_id: 9, nome: "A", etapa: "ENTREVISTA", motivo: "Outra proposta", em: "2026-10-10" }], reprovados: 2 }),
    2: extra({ id: 2, recrutadora: "Pamela", responsavel: "Pamela",
      desistencias: [{ candidato_id: 8, nome: "B", etapa: "ENTREVISTA", motivo: "Não informado", em: "2026-10-12" },
                     { candidato_id: 7, nome: "C", etapa: "TRIAGEM", motivo: "Outra proposta", em: "2026-10-11" }] }),
  }, AGORA);

  it("padrão mostra só as abertas", () => expect(filtrarAcompanhamento(linhas, FILTRO_ACOMP_PADRAO).map((l) => l.v.id)).toEqual([1, 2]));
  it("por responsável, contrato e cidade", () => {
    expect(filtrarAcompanhamento(linhas, { ...FILTRO_ACOMP_PADRAO, responsavel: "Pamela" }).map((l) => l.v.id)).toEqual([2]);
    expect(filtrarAcompanhamento(linhas, { ...FILTRO_ACOMP_PADRAO, situacao: "todas", contrato: "1109 - POLÍCIA CIVIL" }).map((l) => l.v.id)).toEqual([1, 3]);
    expect(filtrarAcompanhamento(linhas, { ...FILTRO_ACOMP_PADRAO, cidade: "Glorinha" }).map((l) => l.v.id)).toEqual([2]);
  });
  it("vagas por contrato com a distribuição por etapa", () => {
    const c = vagasPorContrato(linhas);
    expect(c[0]).toMatchObject({ contrato: "1109 - POLÍCIA CIVIL", total: 2, abertas: 1 });
    expect(c[1]).toMatchObject({ contrato: "1099 - PREF POA", total: 1 });
  });
  it("desistências separadas das reprovações, por etapa e motivo", () => {
    const d = resumoDesistencias(linhas);
    expect(d.total).toBe(3);
    expect(d.reprovados).toBe(2);
    expect(d.vagasComDesistencia).toBe(2);
    expect(d.porEtapa).toEqual([{ nome: "ENTREVISTA", n: 2 }, { nome: "TRIAGEM", n: 1 }]);
    expect(d.porMotivo[0]).toEqual({ nome: "Outra proposta", n: 2 });
    expect(d.lista[0].nome).toBe("B");
  });
});
