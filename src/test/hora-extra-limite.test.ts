import { describe, expect, it, vi } from "vitest";
import {
  CONFIRMACOES_LIMITE_HE,
  LIMITE_HE_MES_MIN,
  confirmarLimiteHoraExtra,
  deslocarMes,
  periodoDoMes,
  resumirMesHoraExtra,
  type PontoMesHoraExtra,
  type SolicitacaoDoMes,
} from "@/lib/horaExtraLimite";
import type { Batida, ColaboradorPonto } from "@/lib/gestaoPonto";

// Escala de 8h, segunda a sexta. Novembro/2026: dia 2 (segunda) é Finados,
// dia 7 é sábado, dia 3 é uma terça comum.
const colaborador = (batidas: Batida[]): ColaboradorPonto => ({
  id: 1,
  empresa: 1,
  cadastro: 100,
  nome: "Fulano",
  cargo: null,
  situacao: "Trabalhando",
  admissao: "2020-01-01",
  afastamento: null,
  filial: null,
  posto: null,
  escala: { codigo: 1, descricao: "08:00-17:00 (1h)(8h) SEG-SEX", h_semana: "40:00", h_mes: null, h_dsr: null },
  batidas,
});

/** Dia inteiro com almoço de 1h: `horasTarde` depois do retorno das 13h. */
const dia = (data: string, horasTarde: number): Batida[] => [
  [data, 8 * 60],
  [data, 12 * 60],
  [data, 13 * 60],
  [data, (13 + horasTarde) * 60],
];

const he = (id: string, data_he: string, horas: number, extra: Partial<SolicitacaoDoMes> = {}): SolicitacaoDoMes => ({
  id,
  data_he,
  minutos: horas * 60,
  feriado: false,
  status: "aprovada",
  ...extra,
});

const resposta = (
  batidas: Batida[] | null,
  solicitacoes: SolicitacaoDoMes[] = [],
): PontoMesHoraExtra => ({
  mes: "2026-11",
  hoje: "2026-11-30",
  ponto_disponivel: !!batidas,
  motivo: batidas ? null : "sem_vinculo",
  colaborador: batidas ? colaborador(batidas) : null,
  solicitacoes,
});

describe("total do mês vindo do ponto da Senior", () => {
  it("dia útil: conta só o que passou da jornada", () => {
    const r = resumirMesHoraExtra(resposta(dia("2026-11-03", 6))); // 10h trabalhadas
    expect(r.minutosPonto).toBe(2 * 60);
    expect(r.total).toBe(2 * 60);
  });

  it("feriado nacional: todo o tempo trabalhado é hora extra", () => {
    const r = resumirMesHoraExtra(resposta(dia("2026-11-02", 4))); // Finados, 8h
    expect(r.minutosPonto).toBe(8 * 60);
  });

  it("sábado de quem não trabalha sábado: todo o tempo conta", () => {
    const r = resumirMesHoraExtra(resposta(dia("2026-11-07", 4)));
    expect(r.minutosPonto).toBe(8 * 60);
  });

  it("feriado marcado na solicitação (municipal) conta o dia inteiro", () => {
    const batidas = dia("2026-11-03", 4); // terça comum, 8h: sem feriado daria zero
    expect(resumirMesHoraExtra(resposta(batidas)).minutosPonto).toBe(0);
    const comFeriado = resumirMesHoraExtra(resposta(batidas, [he("a", "2026-11-03", 8, { feriado: true })]));
    expect(comFeriado.minutosPonto).toBe(8 * 60);
    expect(comFeriado.total).toBe(8 * 60);
  });

  it("dia com batida ímpar não entra na soma, como na Gestão de Ponto", () => {
    const r = resumirMesHoraExtra(resposta([...dia("2026-11-03", 6), ["2026-11-03", 20 * 60]]));
    expect(r.minutosPonto).toBe(0);
  });
});

describe("soma com as HEs do ERP", () => {
  it("HE sem batida ainda entra no total, separada do ponto", () => {
    const r = resumirMesHoraExtra(resposta(dia("2026-11-03", 6), [he("a", "2026-11-20", 3)]));
    expect(r.minutosPonto).toBe(2 * 60);
    expect(r.minutosForaDoPonto).toBe(3 * 60);
    expect(r.total).toBe(5 * 60);
  });

  it("não soma ponto e HE do mesmo dia: vale o maior", () => {
    const batidas = dia("2026-11-03", 6); // 2h no ponto
    expect(resumirMesHoraExtra(resposta(batidas, [he("a", "2026-11-03", 2)])).total).toBe(2 * 60);
    expect(resumirMesHoraExtra(resposta(batidas, [he("a", "2026-11-03", 5)])).total).toBe(5 * 60);
    expect(resumirMesHoraExtra(resposta(dia("2026-11-03", 9), [he("a", "2026-11-03", 1)])).total).toBe(5 * 60);
  });

  it("duas HEs no mesmo dia somam entre si", () => {
    const r = resumirMesHoraExtra(resposta([], [he("a", "2026-11-20", 2), he("b", "2026-11-20", 3)]));
    expect(r.total).toBe(5 * 60);
  });

  it("reprovada não conta", () => {
    const r = resumirMesHoraExtra(resposta([], [he("a", "2026-11-20", 60, { status: "reprovada" })]));
    expect(r.total).toBe(0);
  });

  it("sem vínculo com a Senior, o total sai só das HEs do ERP", () => {
    const r = resumirMesHoraExtra(resposta(null, [he("a", "2026-11-20", 3)]));
    expect(r.pontoDisponivel).toBe(false);
    expect(r.minutosPonto).toBe(0);
    expect(r.total).toBe(3 * 60);
  });

  it("a HE em edição não conta duas vezes", () => {
    const r = resumirMesHoraExtra(resposta([], [he("a", "2026-11-20", 10), he("b", "2026-11-21", 1)]), {
      ignorarId: "a",
      novaHe: { data: "2026-11-20", minutos: 2 * 60 },
    });
    expect(r.total).toBe(3 * 60);
  });

  it("soma o mês inteiro: 30 HEs de 2h dão 60h", () => {
    const hes = Array.from({ length: 30 }, (_, i) =>
      he(String(i), `2026-11-${String(i + 1).padStart(2, "0")}`, 2),
    );
    expect(resumirMesHoraExtra(resposta(null, hes)).total).toBe(60 * 60);
  });
});

describe("limite de 48h", () => {
  const com = (horas: number, nova = 0) =>
    resumirMesHoraExtra(resposta([], [he("a", "2026-11-20", horas)]), {
      novaHe: nova ? { data: "2026-11-21", minutos: nova } : null,
    });

  it("o limite é 48h", () => {
    expect(LIMITE_HE_MES_MIN).toBe(2880);
  });

  it("exatamente 48h ainda não passou", () => {
    expect(com(48).passouLimite).toBe(false);
    expect(com(48).excedente).toBe(0);
    expect(com(47, 60).passouLimite).toBe(false);
  });

  it("um minuto a mais já passou", () => {
    expect(com(48, 1).passouLimite).toBe(true);
    expect(com(48, 1).excedente).toBe(1);
  });

  it("a hora extra nova é que faz passar", () => {
    expect(com(47).passouLimite).toBe(false);
    expect(com(47, 120).passouLimite).toBe(true);
    expect(com(47, 120).excedente).toBe(60);
  });

  it("feriado trabalhado empurra para cima do limite", () => {
    const r = resumirMesHoraExtra(resposta(dia("2026-11-02", 4), [he("a", "2026-11-20", 41)]));
    expect(r.total).toBe(49 * 60);
    expect(r.passouLimite).toBe(true);
  });
});

describe("as três confirmações", () => {
  it("os textos são exatamente os do pedido, nesta ordem", () => {
    expect(CONFIRMACOES_LIMITE_HE).toEqual([
      "VOCÊ JÁ CHEGOU NO LIMITE DE HORAS EXTRAS, TEM CERTEZA QUE DESEJA CONFIRMAR?",
      "CERTEZA MESMO?",
      "CERTEZA ABSOLUTA?",
    ]);
  });

  it("confirmando as três, libera", async () => {
    const perguntar = vi.fn().mockResolvedValue(true);
    await expect(confirmarLimiteHoraExtra(perguntar)).resolves.toBe(true);
    expect(perguntar.mock.calls.map(([m]) => m)).toEqual([...CONFIRMACOES_LIMITE_HE]);
  });

  it.each([0, 1, 2])("cancelar na pergunta %i encerra e não libera", async (naoEm) => {
    let chamada = 0;
    const perguntar = vi.fn(async () => chamada++ !== naoEm);
    await expect(confirmarLimiteHoraExtra(perguntar)).resolves.toBe(false);
    expect(perguntar).toHaveBeenCalledTimes(naoEm + 1);
  });
});

describe("navegação de mês", () => {
  it("vira o ano nos dois sentidos", () => {
    expect(deslocarMes("2026-01", -1)).toBe("2025-12");
    expect(deslocarMes("2026-12", 1)).toBe("2027-01");
    expect(deslocarMes("2026-11", 1)).toBe("2026-12");
  });

  it("período do mês respeita fevereiro e bissexto", () => {
    expect(periodoDoMes("2026-02")).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(periodoDoMes("2028-02").fim).toBe("2028-02-29");
    expect(periodoDoMes("2026-11").fim).toBe("2026-11-30");
  });
});
