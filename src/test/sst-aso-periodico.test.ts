import { describe, expect, it } from "vitest";
import {
  calcularVencimento, contarPainel, diasParaVencer, nomeContrato, ordenar, pendenciasParaRealizar, periodicidadeMeses,
  somarMeses, statusPeriodico, type ItemPeriodico,
} from "@/lib/sst/asoPeriodico";

const HOJE = "2026-11-14";
const item = (x: Partial<ItemPeriodico> = {}): ItemPeriodico => ({
  cpf: "11111111111", empregado_id: 1, nome: "Pessoa", situacao: "Trabalhando", filial_nome: null, contrato_nome: "UFRGS - LIMPEZA",
  cargo: "Servente", admissao: "2020-01-01", ultimo_aso: "2025-06-01", ultimo_tipo: "admissional", periodicidade_meses: 24,
  vencimento: "2027-06-01", status: "Em dia", ciclo: null, ultimo_periodico: null, ...x,
});

describe("periodicidade por contrato", () => {
  it("UFFS renova a cada 1 ano", () => {
    expect(periodicidadeMeses("UFFS CHAPECO - 041/2021")).toBe(12);
    expect(periodicidadeMeses(null, "Nascimento - uffs erechim")).toBe(12);
  });
  it("demais contratos, a cada 2 anos", () => {
    expect(periodicidadeMeses("UFRGS - LIMPEZA - 020/2022")).toBe(24);
    expect(periodicidadeMeses(null, null)).toBe(24);
    expect(periodicidadeMeses("BUFFSUL")).toBe(24); // só a sigla inteira conta
  });
});

describe("vencimento", () => {
  it("conta do último ASO", () => {
    expect(calcularVencimento("2025-11-14", 12)).toBe("2026-11-14");
    expect(calcularVencimento("2025-11-14", 24)).toBe("2027-11-14");
  });
  it("sem ASO, sem vencimento", () => expect(calcularVencimento(null, 24)).toBeNull());
  it("29/02 cai em 28/02, como no Postgres", () => {
    expect(somarMeses("2024-02-29", 12)).toBe("2025-02-28");
    expect(somarMeses("2024-02-29", 24)).toBe("2026-02-28");
    expect(somarMeses("2025-12-31", 2)).toBe("2026-02-28");
  });
  it("dias para vencer", () => {
    expect(diasParaVencer(item({ vencimento: "2026-11-24" }), HOJE)).toBe(10);
    expect(diasParaVencer(item({ vencimento: "2026-11-04" }), HOJE)).toBe(-10);
    expect(diasParaVencer(item({ vencimento: null }), HOJE)).toBeNull();
  });
});

describe("status", () => {
  const st = (x: Partial<ItemPeriodico>) => statusPeriodico(item(x), HOJE);
  it("vencido e próximo do vencimento (60 dias)", () => {
    expect(st({ vencimento: "2026-11-13" })).toBe("Vencido");
    expect(st({ vencimento: "2026-11-14" })).toBe("Próximo do vencimento");
    expect(st({ vencimento: "2027-01-13" })).toBe("Próximo do vencimento");
    expect(st({ vencimento: "2027-01-14" })).toBe("Em dia");
  });
  it("ciclo aberto manda no status, mesmo vencido", () => {
    const ciclo = { id: 1, agendado_para: null } as unknown as ItemPeriodico["ciclo"];
    expect(st({ vencimento: "2026-01-01", ciclo })).toBe("Aguardando agendamento");
    expect(st({ vencimento: "2026-01-01", ciclo: { ...ciclo!, agendado_para: "2026-11-20" } })).toBe("Agendado");
  });
  it("periódico feito e longe do vencimento = realizado/recebido", () => {
    expect(st({ ultimo_tipo: "periodico", vencimento: "2027-11-14" })).toBe("Realizado/recebido");
    expect(st({ ultimo_tipo: "periodico", vencimento: "2026-12-01" })).toBe("Próximo do vencimento");
  });
  it("sem nenhuma data", () => expect(st({ vencimento: null, ultimo_aso: null })).toBe("Sem ASO"));
});

describe("painel", () => {
  it("conta cada status e os previstos somam tudo que não está só em dia", () => {
    const itens = [
      item({ status: "Vencido" }), item({ status: "Vencido" }), item({ status: "Próximo do vencimento" }),
      item({ status: "Aguardando agendamento" }), item({ status: "Agendado" }), item({ status: "Realizado/recebido" }),
      item({ status: "Em dia" }), item({ status: "Sem ASO" }),
    ];
    expect(contarPainel(itens)).toEqual({ previstos: 6, proximos: 1, vencidos: 2, aguardando: 1, agendados: 1, realizados: 1 });
  });
});

describe("lista", () => {
  it("vencido primeiro, depois o vencimento mais próximo", () => {
    const l = [
      item({ nome: "C", status: "Em dia", vencimento: "2027-01-01" }),
      item({ nome: "B", status: "Próximo do vencimento", vencimento: "2026-12-20" }),
      item({ nome: "A", status: "Próximo do vencimento", vencimento: "2026-12-01" }),
      item({ nome: "D", status: "Vencido", vencimento: "2026-01-01" }),
    ].sort(ordenar);
    expect(l.map((i) => i.nome)).toEqual(["D", "A", "B", "C"]);
  });
  it("contrato: o do depara, senão a filial", () => {
    expect(nomeContrato(item({ contrato_nome: "UFFS", filial_nome: "F" }))).toBe("UFFS");
    expect(nomeContrato(item({ contrato_nome: null, filial_nome: "F" }))).toBe("F");
    expect(nomeContrato(item({ contrato_nome: null, filial_nome: null }))).toBe("Sem contrato");
  });
});

describe("marcar realizado/recebido", () => {
  it("pede data e resultado", () => {
    expect(pendenciasParaRealizar({}, HOJE)).toEqual(["data da realização", "resultado (apto ou inapto)"]);
    expect(pendenciasParaRealizar({ realizado_em: "2026-11-15", resultado: "apto" }, HOJE)).toEqual(["data da realização não pode ser futura"]);
    expect(pendenciasParaRealizar({ realizado_em: HOJE, resultado: "inapto" }, HOJE)).toEqual([]);
  });
});
