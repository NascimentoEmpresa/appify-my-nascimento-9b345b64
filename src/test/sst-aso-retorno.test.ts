import { describe, expect, it } from "vitest";
import {
  contarPainelRetorno, contratoDoRetorno, ordenarRetorno, pendenciasDoRetorno, statusAsoRetorno, voltouSemAso,
  type ItemAsoRetorno,
} from "@/lib/sst/asoRetorno";

// SIS-2026-0852: a régua do ASO de Retorno ao Trabalho. A mesma regra de
// status roda no banco (sst_aso_ret_status, mig 20261115210000).

const HOJE = "2026-11-15";
const item = (x: Partial<ItemAsoRetorno> = {}): ItemAsoRetorno => {
  const base: ItemAsoRetorno = {
    id: 1, nome: "Pessoa", contrato_nome: "UFRGS - LIMPEZA", filial_nome: null, funcao: "Servente", motivo: "Auxílio-doença",
    data_inicio: "2026-09-01", data_prevista_retorno: "2026-12-01", data_retorno_real: null, status_afastamento: "Auxílio-doença",
    senior_situacao: "Auxílio Doença", aso_necessario: false, aso_solicitado_em: null, aso_agendado_em: null, aso_clinica: null,
    aso_realizado: false, aso_recebido_em: null, aso_resultado: null, dias_afastado: 91, exige_por_prazo: true,
    status: "A solicitar", documentos: [], updated_at: "2026-11-15T10:00:00Z", ...x,
  };
  return { ...base, status: x.status ?? statusAsoRetorno(base) };
};

describe("status do ASO de retorno", () => {
  it("segue o fluxo: solicitar → aguardando → agendado → realizado", () => {
    expect(item().status).toBe("A solicitar");
    expect(item({ aso_solicitado_em: "2026-11-10" }).status).toBe("Aguardando agendamento");
    expect(item({ aso_solicitado_em: "2026-11-10", aso_agendado_em: "2026-11-20" }).status).toBe("Agendado");
    expect(item({ aso_realizado: true, aso_recebido_em: "2026-11-12", aso_resultado: "apto" }).status).toBe("Realizado/recebido");
  });
  it("realizado sem resultado ainda não está concluído", () => {
    expect(item({ aso_realizado: true, aso_agendado_em: "2026-11-12" }).status).toBe("Agendado");
  });
  it("agendado sem solicitação registrada conta como agendado", () => {
    expect(item({ aso_agendado_em: "2026-11-20" }).status).toBe("Agendado");
  });
});

describe("painel", () => {
  it("conta pendentes, cada etapa e os inaptos", () => {
    const itens = [
      item(), item({ id: 2, aso_solicitado_em: "2026-11-10" }), item({ id: 3, aso_agendado_em: "2026-11-20" }),
      item({ id: 4, aso_realizado: true, aso_recebido_em: "2026-11-12", aso_resultado: "apto" }),
      item({ id: 5, aso_realizado: true, aso_recebido_em: "2026-11-13", aso_resultado: "inapto" }),
    ];
    expect(contarPainelRetorno(itens)).toEqual({ pendentes: 3, solicitar: 1, aguardando: 1, agendados: 1, realizados: 2, inaptos: 1 });
  });
});

describe("lista", () => {
  it("ação primeiro; dentro do status, quem volta antes", () => {
    const a = item({ id: 1, nome: "Ana", data_prevista_retorno: "2026-12-10" });
    const b = item({ id: 2, nome: "Bia", data_prevista_retorno: "2026-11-20" });
    const c = item({ id: 3, nome: "Caio", aso_agendado_em: "2026-11-18" });
    const d = item({ id: 4, nome: "Davi", aso_realizado: true, aso_recebido_em: "2026-11-01", aso_resultado: "apto" });
    const e = item({ id: 5, nome: "Eva", aso_realizado: true, aso_recebido_em: "2026-11-10", aso_resultado: "apto" });
    expect([e, d, c, a, b].sort(ordenarRetorno).map((i) => i.nome)).toEqual(["Bia", "Ana", "Caio", "Eva", "Davi"]);
  });
  it("contrato do caso, senão a filial", () => {
    expect(contratoDoRetorno(item())).toBe("UFRGS - LIMPEZA");
    expect(contratoDoRetorno(item({ contrato_nome: null, filial_nome: "Filial X" }))).toBe("Filial X");
    expect(contratoDoRetorno(item({ contrato_nome: null }))).toBe("Sem contrato");
  });
  it("avisa quem já aparece trabalhando na Senior sem ASO concluído", () => {
    expect(voltouSemAso(item({ senior_situacao: "Trabalhando" }))).toBe(true);
    expect(voltouSemAso(item({ senior_situacao: "Auxílio Doença" }))).toBe(false);
    expect(voltouSemAso(item({ senior_situacao: "Trabalhando", aso_realizado: true, aso_recebido_em: "2026-11-12", aso_resultado: "apto" }))).toBe(false);
  });
});

describe("o que impede salvar", () => {
  it("realizado pede data e resultado", () => {
    expect(pendenciasDoRetorno({ aso_realizado: true }, HOJE)).toEqual(["data da realização", "resultado (apto ou inapto)"]);
    expect(pendenciasDoRetorno({ aso_realizado: true, aso_recebido_em: "2026-11-15", aso_resultado: "apto" }, HOJE)).toEqual([]);
  });
  it("datas: nada no futuro, agendamento depois da solicitação", () => {
    expect(pendenciasDoRetorno({ aso_solicitado_em: "2026-11-16" }, HOJE)).toEqual(["data da solicitação não pode ser futura"]);
    expect(pendenciasDoRetorno({ aso_solicitado_em: "2026-11-10", aso_agendado_em: "2026-11-09" }, HOJE)).toEqual(["agendamento não pode ser antes da solicitação"]);
    expect(pendenciasDoRetorno({ aso_realizado: true, aso_recebido_em: "2026-11-16", aso_resultado: "apto" }, HOJE)).toEqual(["data da realização não pode ser futura"]);
    // Agendamento futuro é o normal.
    expect(pendenciasDoRetorno({ aso_solicitado_em: "2026-11-15", aso_agendado_em: "2026-12-01" }, HOJE)).toEqual([]);
  });
});
