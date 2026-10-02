import { describe, expect, it } from "vitest";
import {
  andamento, candidatosPorVaga, desempacotar, desfecho, diasEntre, filtrar, FILTROS_VAZIOS, funilAberto, idadeDasAbertas,
  indicadoresAgora, indicadoresCandidatos, indicadoresPeriodo, intervalo, mesesDoIntervalo, porMes, prazoDaVaga, prazoPorContrato,
  ranking, situacaoPrazo, tempoAteContratar, urgencia, vagasAbertas,
  type CandidatoDash, type VagaDash,
} from "@/lib/recrutamento/dashboardRecrutamento";

const HOJE = "2026-10-02";
const vaga = (p: Partial<VagaDash> = {}): VagaDash => ({
  id: 1, criada: "2026-09-20T10:00", status: "Vaga aberta - Seleção de Currículos", mudou: null,
  cargo: "SERVENTE DE LIMPEZA", contrato: "UFRGS", cidade: "Porto Alegre", qtd: 1, motivo: "Substituição",
  urgencia: "Alta — Urgente", prevista: "2026-10-10", escala: null, horario: null, local: null, solicitante: null,
  administrativa: false, contratado: null, contratado_inicio: null, substituido: null, legado: false,
  aprovada_em: null, aberta_em: null, ...p,
});
const cand = (p: Partial<CandidatoDash> = {}): CandidatoDash => ({
  id: 1, vaga_id: 1, criado: "2026-09-25T09:00", etapa: "ENTRADA", etapa_em: null, nome: "FULANA", tipo: "vaga",
  desistiu: false, admitido_em: null, ...p,
});

describe("desempacotar (RPC colunar)", () => {
  it("cabeçalho + listas viram objetos; qtd inválida vira 1", () => {
    const d = desempacotar({
      gerado_em: "2026-10-02T09:00",
      vagas_colunas: ["id", "status", "qtd"], vagas: [[7, "Pendente Analista", null]],
      candidatos_colunas: ["id", "vaga_id"], candidatos: [[3, 7]],
      tempos: [{ etapa: "Pendente Recrutamento", n: 2, media: "0.5", mediana: "0.4" }],
    });
    expect(d.vagas[0]).toMatchObject({ id: 7, status: "Pendente Analista", qtd: 1 });
    expect(d.candidatos[0]).toMatchObject({ id: 3, vaga_id: 7 });
    expect(d.tempos[0]).toEqual({ etapa: "Pendente Recrutamento", n: 2, media: 0.5, mediana: 0.4 });
  });
  it("resposta vazia não quebra", () => {
    expect(desempacotar(null)).toEqual({ geradoEm: "", vagas: [], candidatos: [], tempos: [] });
  });
});

describe("prazo", () => {
  it("lê ISO, imediato (vence no dia do pedido), dd/mm e dd/mm/aaaa", () => {
    expect(prazoDaVaga(vaga({ prevista: "2026-10-23" }))).toEqual({ data: "2026-10-23", imediato: false });
    expect(prazoDaVaga(vaga({ prevista: "IMEDIATO" }))).toEqual({ data: "2026-09-20", imediato: true });
    expect(prazoDaVaga(vaga({ prevista: "Imediata" })).imediato).toBe(true);
    expect(prazoDaVaga(vaga({ prevista: "MAIS RAPIDO POSSIVEL" })).imediato).toBe(true);
    expect(prazoDaVaga(vaga({ prevista: "20/03" })).data).toBe("2026-03-20");
    expect(prazoDaVaga(vaga({ prevista: "5/11/26" })).data).toBe("2026-11-05");
  });
  it("texto que não é data fica sem data", () => {
    expect(prazoDaVaga(vaga({ prevista: "TESTE" })).data).toBeNull();
    expect(prazoDaVaga(vaga({ prevista: null })).data).toBeNull();
    expect(situacaoPrazo(vaga({ prevista: "TESTE" }), HOJE)).toBe("sem_data");
  });
  it("atrasada < hoje; em atenção até 7 dias; no prazo depois", () => {
    expect(situacaoPrazo(vaga({ prevista: "2026-10-01" }), HOJE)).toBe("atrasada");
    expect(situacaoPrazo(vaga({ prevista: "2026-10-02" }), HOJE)).toBe("atencao");
    expect(situacaoPrazo(vaga({ prevista: "2026-10-09" }), HOJE)).toBe("atencao");
    expect(situacaoPrazo(vaga({ prevista: "2026-10-10" }), HOJE)).toBe("no_prazo");
  });
  it("diasEntre atravessa mês e ano", () => {
    expect(diasEntre("2026-09-30", "2026-10-02")).toBe(2);
    expect(diasEntre("2026-12-31", "2027-01-01")).toBe(1);
    expect(diasEntre("2026-10-02", "2026-08-18")).toBe(-45);
  });
});

describe("status, andamento e urgência", () => {
  it("Concluída, Concluído… e Contratado são contratadas", () => {
    expect(desfecho("Concluída")).toBe("contratada");
    expect(desfecho("Concluído")).toBe("contratada");
    expect(desfecho("Contratado")).toBe("contratada");
    expect(desfecho("Reprovada")).toBe("reprovada");
    expect(desfecho("Cancelada")).toBe("cancelada");
    expect(desfecho("Pendente Analista")).toBe("aberta");
  });
  it("três blocos de andamento", () => {
    expect(andamento("Pendente Analista")).toBe("Aguardando aprovação");
    expect(andamento("Pendente Diretoria")).toBe("Aguardando aprovação");
    expect(andamento("Pendente Recrutamento")).toBe("Conferência do Recrutamento");
    expect(andamento("Aguardando SST e Compras")).toBe("Em seleção");
    expect(andamento("status que ninguém conhece")).toBe("Em seleção");
  });
  it("as duas 'Alta' do banco são a mesma", () => {
    expect(urgencia("Alta – posto não pode ficar descoberto")).toBe("Alta");
    expect(urgencia("Alta — Urgente")).toBe("Alta");
    expect(urgencia("Média")).toBe("Média");
    expect(urgencia(null)).toBe("Não informada");
  });
});

describe("candidatos por vaga", () => {
  it("mostra o ativo mais adiantado e conta só os ativos", () => {
    const m = candidatosPorVaga([
      cand({ id: 1, nome: "A", etapa: "ENTRADA" }),
      cand({ id: 2, nome: "B", etapa: "DOCUMENTAÇÃO" }),
      cand({ id: 3, nome: "C", etapa: "ADMISSÃO", desistiu: true }),
      cand({ id: 4, nome: "D", etapa: "Reprovado" }),
      cand({ id: 5, nome: "E", etapa: "COMPRAS" }),
    ]);
    expect(m.get(1)).toEqual({ nome: "E", etapa: "SST + COMPRAS", total: 3 });
  });
});

describe("situação agora", () => {
  const vagas = [
    vaga({ id: 1, prevista: "2026-09-01", contrato: "UFRGS" }),
    vaga({ id: 2, prevista: "2026-10-05", status: "Pendente Analista", contrato: "UFRGS", urgencia: "Média" }),
    vaga({ id: 3, prevista: "2026-11-01", status: "Pendente Recrutamento", contrato: "CANAÃ", qtd: 3 }),
    vaga({ id: 4, prevista: "TESTE" }),
    vaga({ id: 5, status: "Concluído" }),
    vaga({ id: 6, status: "Reprovada" }),
  ];
  const abertas = vagasAbertas(vagas, [cand({ vaga_id: 1, nome: "ANA", etapa: "ENTREVISTA" })], HOJE);

  it("só as abertas, mais atrasada primeiro e sem data no fim", () => {
    expect(abertas.map((v) => v.id)).toEqual([1, 2, 3, 4]);
    expect(abertas[0]).toMatchObject({ faltam: -31, situacao: "atrasada", candidato: { nome: "ANA", etapa: "ENTREVISTA", total: 1 } });
  });
  it("indicadores somam por prazo, por andamento e as posições", () => {
    const i = indicadoresAgora(abertas);
    expect(i).toMatchObject({ solicitacoes: 4, posicoes: 6, aprovacao: 1, conferencia: 1, selecao: 2, urgentesAtrasadas: 1, candidatosAtivos: 1, semCandidato: 1 });
    expect(i.porPrazo).toEqual({ atrasada: 1, atencao: 1, no_prazo: 1, sem_data: 1 });
  });
  it("funil, contratos, idade", () => {
    const f = funilAberto(abertas);
    expect(f[0]).toMatchObject({ nome: "Aprovação", qtd: 1 });
    expect(f.reduce((s, x) => s + x.qtd, 0)).toBe(4);
    expect(prazoPorContrato(abertas)[0]).toMatchObject({ nome: "UFRGS", total: 3, atrasada: 1, atencao: 1, sem_data: 1 });
    expect(idadeDasAbertas(abertas).find((x) => x.nome === "8 a 15")?.qtd).toBe(4);
  });
  it("filtros de dimensão", () => {
    expect(filtrar(vagas, { ...FILTROS_VAZIOS, contratos: ["CANAÃ"] }).map((v) => v.id)).toEqual([3]);
    expect(filtrar(vagas, { ...FILTROS_VAZIOS, urgencia: "Média" }).map((v) => v.id)).toEqual([2]);
    expect(filtrar(vagas, { ...FILTROS_VAZIOS, cidade: "PORTO ALEGRE" })).toHaveLength(6);
  });
});

describe("desempenho no período", () => {
  const faixa: [string, string] = ["2026-09-01", "2026-09-30"];
  const vagas = [
    vaga({ id: 1, criada: "2026-09-01T08:00", status: "Concluído", mudou: "2026-09-11T08:00", prevista: "2026-09-15", contratado_inicio: "2026-09-14",
           aprovada_em: "2026-09-01T20:00", aberta_em: "2026-09-02T08:00" }),
    vaga({ id: 2, criada: "2026-09-05T08:00", status: "Contratado", mudou: "2026-09-25T08:00", prevista: "2026-09-10", contratado_inicio: "2026-09-26" }),
    vaga({ id: 3, criada: "2026-09-10T08:00", status: "Reprovada", mudou: "2026-09-10T09:00" }),
    vaga({ id: 4, criada: "2026-08-10T08:00", status: "Concluído", mudou: "2026-08-20T08:00" }),
    vaga({ id: 5, criada: "2026-09-20T08:00" }),
  ];
  it("conta solicitadas, contratadas e reprovadas pela data certa de cada uma", () => {
    const i = indicadoresPeriodo(vagas, faixa);
    expect(i).toMatchObject({ solicitadas: 4, contratadas: 2, reprovadas: 1, canceladas: 0 });
    expect(i.taxaReprovacao).toBeCloseTo(1 / 3);
    expect(i.diasContratar).toMatchObject({ mediana: 15, n: 2 });
    expect(i.diasAprovar.mediana).toBeCloseTo(0.5);
    expect(i.diasAbrir.mediana).toBeCloseTo(0.5);
    expect(i.noPrazo).toEqual({ taxa: 0.5, n: 2, atrasoMedio: 7.5 }); // (−1 + 16) ÷ 2
  });
  it("tempo até contratar por faixa", () => {
    const t = tempoAteContratar(vagas, faixa);
    expect(t.find((x) => x.nome === "8 a 15")?.qtd).toBe(1);
    expect(t.find((x) => x.nome === "16 a 30")?.qtd).toBe(1);
  });
  it("por mês", () => {
    const m = porMes(vagas, ["2026-08", "2026-09"]);
    expect(m).toEqual([
      { mes: "2026-08", rotulo: "ago/26", solicitadas: 1, contratadas: 1 },
      { mes: "2026-09", rotulo: "set/26", solicitadas: 4, contratadas: 2 },
    ]);
  });
  it("candidatos no período", () => {
    const c = indicadoresCandidatos([
      cand({ id: 1, criado: "2026-09-02T10:00" }),
      cand({ id: 2, criado: "2026-09-03T10:00", tipo: "geral", etapa: "Reprovado" }),
      cand({ id: 3, criado: "2026-08-03T10:00", etapa: "ADMISSÃO", admitido_em: "2026-09-04T10:00" }),
      cand({ id: 4, criado: "2026-09-05T10:00", desistiu: true }),
    ], faixa);
    expect(c).toMatchObject({ ativos: 2, candidaturas: 3, paraVaga: 2, bancoTalentos: 1, admitidos: 1, reprovados: 1, desistencias: 1 });
    expect(c.funil.find((x) => x.nome === "ADMISSÃO")?.qtd).toBe(1);
  });
  it("ativos são só os de vaga em aberto, quando o conjunto vem", () => {
    const cs = [cand({ id: 1, vaga_id: 1 }), cand({ id: 2, vaga_id: 2 }), cand({ id: 3, vaga_id: null })];
    expect(indicadoresCandidatos(cs, faixa, new Set([2])).ativos).toBe(1);
  });
  it("imediato não entra na conta do prazo", () => {
    const i = indicadoresPeriodo([vaga({ status: "Concluído", criada: "2026-09-01T08:00", mudou: "2026-09-05T08:00", prevista: "IMEDIATO", contratado_inicio: "2026-09-06" })], faixa);
    expect(i.noPrazo).toEqual({ taxa: null, n: 0, atrasoMedio: null });
  });
});

describe("período e ranking", () => {
  it("intervalos", () => {
    expect(intervalo("mes", HOJE)).toEqual(["2026-10-01", HOJE]);
    expect(intervalo("30", HOJE)).toEqual(["2026-09-03", HOJE]);
    expect(intervalo("ano", HOJE)).toEqual(["2026-01-01", HOJE]);
    expect(intervalo("tudo", HOJE)).toEqual([null, null]);
    expect(intervalo("personalizado", HOJE, "2026-02-01", "")).toEqual(["2026-02-01", null]);
  });
  it("meses: do intervalo, ou os últimos 12", () => {
    expect(mesesDoIntervalo(["2026-08-15", "2026-10-02"], HOJE)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const doze = mesesDoIntervalo([null, null], HOJE);
    expect(doze).toHaveLength(12);
    expect(doze[0]).toBe("2025-11");
    expect(doze[11]).toBe("2026-10");
  });
  it("ranking dobra o resto em Outros", () => {
    const r = ranking(["a", "a", "b", "c", "d"], (x) => x, 2);
    expect(r).toEqual([{ nome: "a", qtd: 2 }, { nome: "b", qtd: 1 }, { nome: "Outros (2)", qtd: 2 }]);
  });
});
