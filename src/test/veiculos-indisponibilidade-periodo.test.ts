import { describe, expect, it } from "vitest";
import {
  descreverPeriodo,
  disponibilidadeDoVeiculo,
  indisponivelNoDia,
  indisponivelNoPeriodo,
  periodoVigenteOuFuturo,
  periodosSeCruzam,
  somarDias,
  type VeiculoComIndisponibilidade,
} from "@/lib/veiculos/indisponibilidade";

/**
 * SIS-2026-0930: "se eu colocar indisponível no dia 13 até o 17, eles têm que
 * ficar indisponíveis somente na data selecionada". Mesma regra que o banco
 * aplica em cs_veic_checar_agendamento() (migration 20261118170000).
 */

const HOJE = "2026-11-10";

const veiculo = (v: Partial<VeiculoComIndisponibilidade> = {}): VeiculoComIndisponibilidade => ({
  em_manutencao: true,
  motivo_indisponivel: "manutencao",
  motivo_detalhe: null,
  data_inicio_manutencao: "2026-11-13",
  data_previsao_fim: "2026-11-17",
  ...v,
});

describe("periodosSeCruzam", () => {
  it("pontas incluídas", () => {
    expect(periodosSeCruzam("2026-11-13", "2026-11-17", "2026-11-17", "2026-11-20")).toBe(true);
    expect(periodosSeCruzam("2026-11-13", "2026-11-17", "2026-11-10", "2026-11-13")).toBe(true);
  });
  it("dia antes e dia depois não cruzam", () => {
    expect(periodosSeCruzam("2026-11-13", "2026-11-17", "2026-11-12", "2026-11-12")).toBe(false);
    expect(periodosSeCruzam("2026-11-13", "2026-11-17", "2026-11-18", "2026-11-20")).toBe(false);
  });
  it("período pedido que engloba o bloqueio cruza", () => {
    expect(periodosSeCruzam("2026-11-13", "2026-11-17", "2026-11-01", "2026-11-30")).toBe(true);
  });
  it("ponta null é aberta", () => {
    expect(periodosSeCruzam(null, "2026-11-17", "2000-01-01", "2000-01-01")).toBe(true);
    expect(periodosSeCruzam("2026-11-13", null, "2099-01-01", "2099-01-01")).toBe(true);
    expect(periodosSeCruzam("2026-11-13", null, "2026-11-12", "2026-11-12")).toBe(false);
    expect(periodosSeCruzam(null, null, "2026-11-12", "2026-11-12")).toBe(true);
  });
});

describe("indisponibilidade de 13 a 17 (o caso do chamado)", () => {
  const v = veiculo();
  it("fica indisponível só dentro do período", () => {
    expect(indisponivelNoDia(v, "2026-11-12")).toBe(false);
    expect(indisponivelNoDia(v, "2026-11-13")).toBe(true);
    expect(indisponivelNoDia(v, "2026-11-15")).toBe(true);
    expect(indisponivelNoDia(v, "2026-11-17")).toBe(true);
    expect(indisponivelNoDia(v, "2026-11-18")).toBe(false);
  });
  it("viagem de vários dias que encosta no período é barrada", () => {
    expect(indisponivelNoPeriodo(v, "2026-11-11", "2026-11-13")).toBe(true);
    expect(indisponivelNoPeriodo(v, "2026-11-17", "2026-11-19")).toBe(true);
    expect(indisponivelNoPeriodo(v, "2026-11-10", "2026-11-12")).toBe(false);
  });
  it("hoje (antes do período) o card está livre e escolhível, avisando o agendamento", () => {
    const d = disponibilidadeDoVeiculo(v, HOJE);
    expect(d.disponivel).toBe(true);
    expect(d.agendavel).toBe(true);
    expect(d.detalhe).toBe("Manutenção agendada de 13/11/2026 a 17/11/2026");
  });
  it("pedido dentro do período: indisponível, mas o carro continua escolhível", () => {
    const d = disponibilidadeDoVeiculo(v, HOJE, "2026-11-14", "2026-11-14");
    expect(d.disponivel).toBe(false);
    expect(d.agendavel).toBe(true);
    expect(d.detalhe).toBe("Em manutenção de 13/11/2026 a 17/11/2026. Agende a partir de 18/11/2026.");
  });
  it("depois do período: livre", () => {
    const d = disponibilidadeDoVeiculo(v, HOJE, "2026-11-20");
    expect(d.disponivel).toBe(true);
    expect(d.detalhe).toBe("Retorna em 17/11/2026");
  });
  it("status pela data: dentro do período, hoje fica indisponível", () => {
    expect(disponibilidadeDoVeiculo(v, "2026-11-15").disponivel).toBe(false);
    expect(disponibilidadeDoVeiculo(v, "2026-11-18").disponivel).toBe(true);
  });
});

describe("pontas abertas e casos antigos", () => {
  it("sem indisponibilidade registrada: sempre livre", () => {
    const d = disponibilidadeDoVeiculo(veiculo({ em_manutencao: false }), HOJE, "2026-11-15");
    expect(d).toEqual({ disponivel: true, agendavel: true, rotulo: "Livre", detalhe: null });
  });
  it("sem datas: bloqueado por tempo indeterminado e não escolhível", () => {
    const d = disponibilidadeDoVeiculo(veiculo({ data_inicio_manutencao: null, data_previsao_fim: null }), HOJE);
    expect(d.disponivel).toBe(false);
    expect(d.agendavel).toBe(false);
    expect(d.detalhe).toBe("Em manutenção por tempo indeterminado.");
  });
  it("sem fim mas começando no futuro: escolhível, livre antes do início", () => {
    const v = veiculo({ data_previsao_fim: null, motivo_indisponivel: "outro", motivo_detalhe: "sinistro" });
    expect(disponibilidadeDoVeiculo(v, HOJE).disponivel).toBe(true);
    expect(disponibilidadeDoVeiculo(v, HOJE).agendavel).toBe(true);
    const depois = disponibilidadeDoVeiculo(v, HOJE, "2026-12-01");
    expect(depois.disponivel).toBe(false);
    expect(depois.detalhe).toBe("sinistro a partir de 13/11/2026, sem previsão de fim.");
  });
  it("sem fim e já começado: não há data possível", () => {
    const v = veiculo({ data_inicio_manutencao: "2026-11-01", data_previsao_fim: null });
    expect(disponibilidadeDoVeiculo(v, HOJE).agendavel).toBe(false);
  });
  it("só com fim (registro antigo): bloqueia até o fim, como antes", () => {
    const v = veiculo({ data_inicio_manutencao: null, motivo_indisponivel: "contrato" });
    expect(disponibilidadeDoVeiculo(v, HOJE).disponivel).toBe(false);
    expect(disponibilidadeDoVeiculo(v, HOJE).detalhe).toBe("Em contrato até 17/11/2026. Agende a partir de 18/11/2026.");
    expect(disponibilidadeDoVeiculo(v, HOJE, "2026-11-18").disponivel).toBe(true);
  });
  it("datas com hora vindas do banco são cortadas no dia", () => {
    const v = veiculo({ data_inicio_manutencao: "2026-11-13T00:00:00", data_previsao_fim: "2026-11-17T00:00:00" });
    expect(indisponivelNoDia(v, "2026-11-17")).toBe(true);
    expect(indisponivelNoDia(v, "2026-11-12")).toBe(false);
  });
});

describe("encerrar antes / estender", () => {
  it("encerrar = voltar para disponível: livre na hora", () => {
    const v = veiculo({ em_manutencao: false, data_inicio_manutencao: null, data_previsao_fim: null, motivo_indisponivel: null });
    expect(indisponivelNoDia(v, "2026-11-15")).toBe(false);
  });
  it("estender o fim alcança os novos dias", () => {
    const v = veiculo({ data_previsao_fim: "2026-11-20" });
    expect(indisponivelNoDia(v, "2026-11-19")).toBe(true);
    expect(indisponivelNoDia(v, "2026-11-21")).toBe(false);
  });
});

describe("apoio", () => {
  it("periodoVigenteOuFuturo esconde o que já acabou", () => {
    expect(periodoVigenteOuFuturo(veiculo(), "2026-11-18")).toBeNull();
    expect(periodoVigenteOuFuturo(veiculo(), "2026-11-17")).toEqual({ inicio: "2026-11-13", fim: "2026-11-17" });
    expect(periodoVigenteOuFuturo(veiculo({ data_previsao_fim: null }), "2027-01-01")).not.toBeNull();
  });
  it("descreverPeriodo", () => {
    expect(descreverPeriodo({ inicio: "2026-11-13", fim: "2026-11-13" })).toBe("em 13/11/2026");
    expect(descreverPeriodo({ inicio: null, fim: null })).toBe("por tempo indeterminado");
  });
  it("somarDias atravessa mês e ano", () => {
    expect(somarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
  });
});
