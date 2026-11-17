import { describe, expect, it } from "vitest";
import {
  calcularVencimento, contarPainel, diasParaVencer, erroConfig, erroMesesContrato, nomeContrato, ordenar,
  pendenciasParaRealizar, periodicidadeMeses, rotuloPeriodicidade, somarMeses, statusPeriodico, type ItemPeriodico,
} from "@/lib/sst/asoPeriodico";

const HOJE = "2026-11-14";
const item = (x: Partial<ItemPeriodico> = {}): ItemPeriodico => ({
  cpf: "11111111111", empregado_id: 1, nome: "Pessoa", situacao: "Trabalhando", filial_nome: null, contrato_nome: "UFRGS - LIMPEZA",
  cargo: "Servente", admissao: "2020-01-01", ultimo_aso: "2025-06-01", ultimo_tipo: "admissional", periodicidade_meses: 24,
  vencimento: "2027-06-01", status: "Em dia", ciclo: null, ultimo_periodico: null, ...x,
});

describe("periodicidade por contrato (configuração, SIS-2026-0918)", () => {
  const config = [
    { contrato_id: "uffs", periodicidade_meses: 12 },  // semente da migration
    { contrato_id: "ufrgs", periodicidade_meses: null }, // listado, sem periodicidade própria
    { contrato_id: "semestral", periodicidade_meses: 6 },
  ];
  it("contrato configurado usa a dele", () => {
    expect(periodicidadeMeses("uffs", config)).toBe(12);
    expect(periodicidadeMeses("semestral", config)).toBe(6);
  });
  it("sem configuração, sem contrato ou contrato desconhecido: o padrão (2 anos)", () => {
    expect(periodicidadeMeses("ufrgs", config)).toBe(24);
    expect(periodicidadeMeses("outro", config)).toBe(24);
    expect(periodicidadeMeses(null, config)).toBe(24);
    expect(periodicidadeMeses(undefined, [])).toBe(24);
  });
  it("o padrão também é configurável", () => {
    expect(periodicidadeMeses("ufrgs", config, 36)).toBe(36);
    expect(periodicidadeMeses("uffs", config, 36)).toBe(12);
  });
  it("não procura UFFS no nome: o nome não decide nada", () => {
    expect(periodicidadeMeses("UFFS - 041/2021", [])).toBe(24);
  });
  it("rótulo", () => {
    expect(rotuloPeriodicidade(12)).toBe("1 ano");
    expect(rotuloPeriodicidade(24)).toBe("2 anos");
    expect(rotuloPeriodicidade(6)).toBe("6 meses");
    expect(rotuloPeriodicidade(18)).toBe("18 meses");
    expect(rotuloPeriodicidade(1)).toBe("1 mês");
  });
  it("validação da configuração (faixas dos CHECKs do banco)", () => {
    expect(erroConfig(60, 24)).toBeNull();
    expect(erroConfig(0, 24)).toMatch(/Dias de aviso/);
    expect(erroConfig(366, 24)).toMatch(/Dias de aviso/);
    expect(erroConfig(30.5, 24)).toMatch(/Dias de aviso/);
    expect(erroConfig(60, 0)).toMatch(/Periodicidade padrão/);
    expect(erroConfig(60, 61)).toMatch(/Periodicidade padrão/);
    expect(erroMesesContrato(12)).toBeNull();
    expect(erroMesesContrato(0)).not.toBeNull();
    expect(erroMesesContrato(Number.NaN)).not.toBeNull();
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
  it("janela de aviso configurável", () => {
    const v = item({ vencimento: "2027-01-01" }); // 48 dias depois de HOJE
    expect(statusPeriodico(v, HOJE, 30)).toBe("Em dia");
    expect(statusPeriodico(v, HOJE, 48)).toBe("Próximo do vencimento");
    expect(statusPeriodico(v, HOJE, 90)).toBe("Próximo do vencimento");
    expect(statusPeriodico(item({ vencimento: "2026-11-13" }), HOJE, 1)).toBe("Vencido");
  });
  it("UFFS (12 meses) e demais (24) a partir do mesmo último ASO", () => {
    const ultimo = "2025-12-01";
    const uffs = item({ ultimo_aso: ultimo, vencimento: calcularVencimento(ultimo, 12) });
    const outro = item({ ultimo_aso: ultimo, vencimento: calcularVencimento(ultimo, 24) });
    expect(statusPeriodico(uffs, HOJE)).toBe("Próximo do vencimento");
    expect(statusPeriodico(outro, HOJE)).toBe("Em dia");
  });
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
