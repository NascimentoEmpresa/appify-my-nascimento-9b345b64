import { describe, expect, it } from "vitest";
import { foraDaVigencia, inicioDaPlanilhaVigente, inicioDoContrato, irregularidadesDeVigencia } from "@/pages/controladoria/vigenciaContrato";

// SIS-2026-0915: custo fora da vigência do CONTRATO vira "Irregularidade" na Lucratividade (só sinaliza).
const bentoAuxAdm = { data_inicio: null, vigencia_inicial: "2026-01-01", data_fim_vigencia: "2028-12-31", vigencia_final: null };

describe("vigência do contrato", () => {
  it("o exemplo do chamado: nov/2025 é antes do início (01/01/2026); jan/2026 a dez/2028 vigentes; jan/2029 depois do fim", () => {
    expect(foraDaVigencia(bentoAuxAdm, "2025-11")).toBe("antes");
    expect(foraDaVigencia(bentoAuxAdm, "2026-01")).toBeNull();
    expect(foraDaVigencia(bentoAuxAdm, "2028-12")).toBeNull();
    expect(foraDaVigencia(bentoAuxAdm, "2029-01")).toBe("depois");
  });
  it("início no meio do mês: o próprio mês já conta como vigente", () => {
    expect(foraDaVigencia({ vigencia_inicial: "2026-02-15" }, "2026-02")).toBeNull();
    expect(foraDaVigencia({ vigencia_inicial: "2026-02-15" }, "2026-01")).toBe("antes");
  });
  it("prorrogação: vale o início mais antigo do cadastro (data_inicio do contrato original), não só o do período atual", () => {
    const prorrogado = { data_inicio: "2023-03-01", vigencia_inicial: "2026-03-01", vigencia_final: "2028-02-28" };
    expect(inicioDoContrato(prorrogado)).toBe("2023-03-01");
    expect(foraDaVigencia(prorrogado, "2025-11")).toBeNull();
  });
  it("sem datas no cadastro não acusa nada", () => {
    expect(foraDaVigencia({}, "2020-01")).toBeNull();
  });
});

describe("irregularidades de vigência por rubrica", () => {
  const custos: Record<string, Record<string, number>> = {
    "2025-11": { salarios: 55025.82, ferias: 2570.79, vt: 0 },
    "2026-01": { salarios: 60000 },
  };
  it("marca só as rubricas com valor nos meses fora da vigência", () => {
    const r = irregularidadesDeVigencia(bentoAuxAdm, ["2025-11"], (m) => custos[m]);
    expect(r?.meses).toEqual([{ mes: "2025-11", posicao: "antes" }]);
    expect([...r!.rubricas.entries()]).toEqual([["salarios", 55025.82], ["ferias", 2570.79]]);
  });
  it("dentro da vigência não há alerta", () => {
    expect(irregularidadesDeVigencia(bentoAuxAdm, ["2026-01"], (m) => custos[m])).toBeNull();
  });
  it("num intervalo, soma só a parte fora da vigência", () => {
    const r = irregularidadesDeVigencia(bentoAuxAdm, ["2025-11", "2026-01"], (m) => custos[m]);
    expect(r?.rubricas.get("salarios")).toBe(55025.82);
  });
  it("mês fora da vigência sem custo não acusa", () => {
    expect(irregularidadesDeVigencia(bentoAuxAdm, ["2025-10"], () => undefined)).toBeNull();
  });
  it("vigência corrigida na origem: o mesmo custo deixa de ser irregular", () => {
    const corrigido = { ...bentoAuxAdm, data_inicio: "2021-01-01" };
    expect(irregularidadesDeVigencia(corrigido, ["2025-11"], (m) => custos[m])).toBeNull();
  });
});

describe("vigência da planilha de custos (informativa)", () => {
  it("é a data mais recente das linhas vigentes; sem linha, null", () => {
    expect(inicioDaPlanilhaVigente([{ data_vigencia: "2025-03-01" }, { data_vigencia: "2026-03-01" }])).toBe("2026-03-01");
    expect(inicioDaPlanilhaVigente([])).toBeNull();
  });
});
