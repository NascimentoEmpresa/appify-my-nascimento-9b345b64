import { describe, expect, it } from "vitest";
import {
  aplicarMarcacoesSenior,
  mapearMarcacoesNosCampos,
  marcacoesDoDia,
  type CampoPonto,
  type ValoresPonto,
} from "@/lib/horaExtraPontoSenior";
import type { Batida } from "@/lib/gestaoPonto";

const escala: ValoresPonto = {
  ponto_entrada: "07:30",
  ponto_saida_intervalo: "12:00",
  ponto_retorno_intervalo: "13:00",
  ponto_saida: "17:18",
};
const vazio = new Set<CampoPonto>();

describe("marcacoesDoDia", () => {
  it("pega só a data pedida, em ordem e sem batida repetida", () => {
    const batidas: Batida[] = [
      ["2026-11-04", 450],
      ["2026-11-05", 785],
      ["2026-11-05", 452],
      ["2026-11-05", 720],
      ["2026-11-05", 452],
    ];
    expect(marcacoesDoDia(batidas, "2026-11-05")).toEqual(["07:32", "12:00", "13:05"]);
  });

  it("aceita minuto em texto e ignora lixo", () => {
    const batidas = [["2026-11-05", "480"], ["2026-11-05", null], ["2026-11-05", -3]] as unknown as Batida[];
    expect(marcacoesDoDia(batidas, "2026-11-05")).toEqual(["08:00"]);
  });

  it("sem batidas devolve lista vazia", () => {
    expect(marcacoesDoDia(undefined, "2026-11-05")).toEqual([]);
    expect(marcacoesDoDia([["2026-11-04", 450]], "2026-11-05")).toEqual([]);
  });
});

describe("mapearMarcacoesNosCampos", () => {
  it("três batidas: entrada, saída e retorno do intervalo; saída fica de fora", () => {
    expect(mapearMarcacoesNosCampos(["07:32", "12:00", "13:05"])).toEqual({
      ponto_entrada: "07:32",
      ponto_saida_intervalo: "12:00",
      ponto_retorno_intervalo: "13:05",
    });
  });

  it("uma batida: só a entrada", () => {
    expect(mapearMarcacoesNosCampos(["07:32"])).toEqual({ ponto_entrada: "07:32" });
  });

  it("quatro batidas preenchem tudo", () => {
    expect(mapearMarcacoesNosCampos(["07:30", "12:00", "13:00", "21:18"]).ponto_saida).toBe("21:18");
  });

  it("seis batidas (pausa extra): a saída é a última", () => {
    expect(mapearMarcacoesNosCampos(["07:30", "12:00", "13:00", "15:00", "15:15", "21:18"]).ponto_saida).toBe("21:18");
  });

  it("cinco batidas: a pessoa voltou para dentro, a saída é a 4ª", () => {
    expect(mapearMarcacoesNosCampos(["07:30", "12:00", "13:00", "17:18", "18:00"]).ponto_saida).toBe("17:18");
  });
});

describe("aplicarMarcacoesSenior", () => {
  it("preenche o que tem batida e deixa o resto com o horário da escala", () => {
    const r = aplicarMarcacoesSenior({
      atual: escala,
      padrao: escala,
      marcacoes: ["07:32", "12:00", "13:05"],
      editados: vazio,
      daSenior: vazio,
    });
    expect(r.valores).toEqual({ ...escala, ponto_entrada: "07:32", ponto_retorno_intervalo: "13:05" });
    expect([...r.daSenior].sort()).toEqual(["ponto_entrada", "ponto_retorno_intervalo", "ponto_saida_intervalo"]);
  });

  it("não sobrescreve o que o usuário editou", () => {
    const r = aplicarMarcacoesSenior({
      atual: { ...escala, ponto_entrada: "08:00" },
      padrao: escala,
      marcacoes: ["07:32", "12:00", "13:05"],
      editados: new Set<CampoPonto>(["ponto_entrada"]),
      daSenior: vazio,
    });
    expect(r.valores.ponto_entrada).toBe("08:00");
    expect(r.daSenior.has("ponto_entrada")).toBe(false);
  });

  it("trocou para um dia sem batida: o que veio da Senior volta para a escala", () => {
    const r = aplicarMarcacoesSenior({
      atual: { ...escala, ponto_entrada: "07:32", ponto_saida: "21:00" },
      padrao: escala,
      marcacoes: [],
      editados: new Set<CampoPonto>(["ponto_saida"]),
      daSenior: new Set<CampoPonto>(["ponto_entrada"]),
    });
    expect(r.valores).toEqual({ ...escala, ponto_saida: "21:00" });
    expect(r.daSenior.size).toBe(0);
  });
});
