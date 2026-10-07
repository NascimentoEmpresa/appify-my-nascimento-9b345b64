import { describe, expect, it } from "vitest";
import {
  avaliarPontoFaltante, bloqueia, conflitosPorSolicitacao, datasSemPonto, estadoDoDia, horariosDoPonto, type PontoFaltante,
} from "@/lib/diariaPonto";

const vinc = [{ id: 1, nome: "JOÃO", cadastro: "6983", empresa: "1", situacao: "Trabalhando" }];

describe("diárias × ponto do faltante", () => {
  it("minuto do dia vira hora, inclusive turno que vira a noite", () => {
    expect(horariosDoPonto([780, 420, 1560])).toEqual(["07:00", "13:00", "02:00 (+1d)"]);
    expect(horariosDoPonto(null)).toEqual([]);
  });

  it("estado de cada dia", () => {
    expect(estadoDoDia("2026-10-01", [420], "2026-10-06", true)).toBe("trabalhou");
    expect(estadoDoDia("2026-10-01", [420], "2026-10-06", false)).toBe("trabalhou");
    expect(estadoDoDia("2026-10-01", [], "2026-10-06", true)).toBe("sem_marcacao");
    expect(estadoDoDia("2026-10-06", null, "2026-10-06", true)).toBe("parcial");
    expect(estadoDoDia("2026-10-07", null, "2026-10-06", true)).toBe("nao_sincronizado");
    expect(estadoDoDia("2026-10-01", null, "2026-10-06", false)).toBe("sem_vinculo");
    expect(estadoDoDia("2026-10-01", null, null, true)).toBe("nao_sincronizado");
  });

  it("só bloqueia quando há batida", () => {
    expect(bloqueia("trabalhou")).toBe(true);
    for (const e of ["sem_marcacao", "parcial", "nao_sincronizado", "sem_vinculo", "indisponivel"] as const) expect(bloqueia(e)).toBe(false);
  });

  it("avalia as datas digitadas com o retorno da RPC", () => {
    const p: PontoFaltante = {
      disponivel: true, sincronizado_ate: "2026-10-06", vinculos: vinc,
      dias: [{ data: "2026-09-25", minutos: [420, 720, 780, 1020] }, { data: "2026-09-26", minutos: null }],
    };
    const r = avaliarPontoFaltante(p, ["2026-09-25", "2026-09-26", "", "2026-10-08", "2026-09-25"]);
    expect([...r.keys()]).toEqual(["2026-09-25", "2026-09-26", "2026-10-08"]);
    expect(r.get("2026-09-25")).toMatchObject({ estado: "trabalhou", horarios: ["07:00", "12:00", "13:00", "17:00"] });
    expect(r.get("2026-09-26")!.estado).toBe("sem_marcacao");
    expect(r.get("2026-10-08")!.estado).toBe("nao_sincronizado");
  });

  it("espelho fora do ar não bloqueia", () => {
    const r = avaliarPontoFaltante({ disponivel: false, motivo: "x" }, ["2026-09-25"]);
    expect(r.get("2026-09-25")!.estado).toBe("indisponivel");
  });

  it("agrupa os conflitos da lista por solicitação", () => {
    const m = conflitosPorSolicitacao({
      sincronizado_ate: "2026-10-06",
      conflitos: [
        { solicitacao_id: "a", data: "2026-08-28", minutos: [431] },
        { solicitacao_id: "a", data: "2026-08-26", minutos: [1030, 431] },
        { solicitacao_id: "b", data: "2026-09-01", minutos: [420] },
      ],
    });
    expect(m.get("a")!.map((x) => x.data)).toEqual(["2026-08-26", "2026-08-28"]);
    expect(m.get("a")![0].horarios).toEqual(["07:11", "17:10"]);
    expect(m.get("b")).toHaveLength(1);
  });

  it("datas que o relógio ainda não cobre", () => {
    expect(datasSemPonto(["2026-10-07", "2026-10-01", "2026-10-06", "2026-10-07"], "2026-10-06")).toEqual(["2026-10-06", "2026-10-07"]);
    expect(datasSemPonto(["2026-10-01"], null)).toEqual(["2026-10-01"]);
  });
});
