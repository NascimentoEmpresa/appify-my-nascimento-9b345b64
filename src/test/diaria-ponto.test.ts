import { describe, expect, it } from "vitest";
import {
  avaliarCobertura, avaliarPontoFaltante, conflitosPorSolicitacao, coberturaValida,
  detalheEstado, fmtIntervalo, horariosDoPonto, resumoPontoDiaria,
  type EvidenciaPonto, type JornadaPonto, type PontoDiariaMalote,
} from "@/lib/diariaPonto";

const data = "2026-10-26";
const cobertura = { data, inicioCobertura: "13:00", fimCobertura: "17:00" };
const evidencia = (minutos: number[]): EvidenciaPonto => ({ disponivel: true, jornadas: [{ data, minutos, vinculo: "1/123" }] });
const avaliar = (minutos: number[]) => avaliarCobertura(cobertura, evidencia(minutos), "2026-10-28", true);

describe("SIS-2026-0800: cobertura × intervalos trabalhados", () => {
  it("Romaine 07:30–11:45 não conflita com cobertura à tarde", () => {
    expect(avaliar([450, 705]).estado).toBe("sem_conflito");
  });
  it.each([
    [[450, 1020], [{ inicio: 450, fim: 1020 }]], // contém cobertura sem batida dentro dela
    [[810, 900], [{ inicio: 810, fim: 900 }]], // trabalho contido
    [[450, 810], [{ inicio: 450, fim: 810 }]], // saída dentro
    [[990, 1140], [{ inicio: 990, fim: 1140 }]], // entrada dentro
    [[780, 1020], [{ inicio: 780, fim: 1020 }]], // igualdade
  ])("detecta sobreposição total/parcial: %j", (minutos, intervalos) => {
    const r = avaliar(minutos as number[]);
    expect(r.estado).toBe("conflito");
    expect(r.sobreposicoes).toEqual(intervalos);
    expect(detalheEstado(r)).toContain("Diária: 13:00–17:00");
    expect(detalheEstado(r)).toContain("Sobreposição com trabalho");
  });
  it.each([[450, 780], [1020, 1140]])("extremos adjacentes não conflitam: %j", (...minutos) => {
    expect(avaliar(minutos).estado).toBe("sem_conflito");
  });
  it("não preenche intervalo de almoço como trabalhado", () => {
    expect(avaliarCobertura({ data, inicioCobertura: "12:00", fimCobertura: "13:00" }, evidencia([450, 720, 780, 1020]), "2026-10-28", true).estado).toBe("sem_conflito");
  });
  it.each([[450], [450, 705, 800], [450, 450], [-1, 800], [450, 3000]])("dados incompletos ou inválidos exigem conferência: %j", (...minutos) => {
    expect(avaliar(minutos).estado).toBe("conferir");
  });
  it("não presume qual entrada ou saída está faltando numa jornada ímpar", () => {
    const r = avaliar([450, 900, 1100]);
    expect(r.estado).toBe("conferir");
    expect(r.sobreposicoes).toEqual([]);
    expect(r.pendencias.join()).toContain("incompletas");
  });
  it("legado sem horário exige conferência mesmo sem batidas", () => {
    expect(avaliarCobertura({ data }, evidencia([]), "2026-10-28", true).estado).toBe("conferir");
    expect(avaliarCobertura({ data }, evidencia([450, 705]), "2026-10-28", true).estado).toBe("conferir");
  });
  it.each([["", "17:00"], ["13:00", ""], ["13:00", "13:00"], ["24:00", "17:00"], ["13:70", "17:00"]])("recusa cobertura inválida %s–%s", (inicioCobertura, fimCobertura) => {
    expect(coberturaValida({ data, inicioCobertura, fimCobertura })).toBe(false);
  });
  it("não afirma ausência de conflito sem vínculo, sincronização ou consulta", () => {
    expect(avaliarCobertura(cobertura, evidencia([]), "2026-10-28", false).estado).toBe("sem_vinculo");
    expect(avaliarCobertura(cobertura, undefined, "2026-10-28", true).estado).toBe("indisponivel");
    expect(avaliarCobertura(cobertura, evidencia([]), null, true).estado).toBe("nao_sincronizado");
    expect(avaliarCobertura(cobertura, evidencia([450, 705]), data, true).estado).toBe("parcial");
    expect(avaliar([]).estado).toBe("sem_marcacao");
  });
  it("não pareia uma entrada de uma matrícula com a saída de outra", () => {
    const ponto = { disponivel: true, jornadas: [{ data, minutos: [450], vinculo: "1/123" }, { data, minutos: [705], vinculo: "2/123" }] };
    expect(avaliarCobertura(cobertura, ponto, "2026-10-28", true).estado).toBe("conferir");
  });
  it("cobertura noturna compara a saída >1440 e a jornada seguinte", () => {
    const c = { data, inicioCobertura: "22:00", fimCobertura: "06:00" };
    expect(avaliarCobertura(c, evidencia([1380, 1500]), "2026-10-28", true).estado).toBe("conflito");
    const jornadas: JornadaPonto[] = [{ data: "2026-10-27", minutos: [120, 240], vinculo: "1/123" }];
    expect(avaliarCobertura(c, { disponivel: true, jornadas }, "2026-10-28", true).sobreposicoes).toEqual([{ inicio: 1560, fim: 1680 }]);
    expect(avaliarCobertura(c, evidencia([]), "2026-10-27", true).estado).toBe("parcial");
  });
  it("cobertura matinal considera o fim da jornada anterior", () => {
    const ponto = { disponivel: true, jornadas: [{ data: "2026-10-25", minutos: [1320, 1860], vinculo: "1/123" }] };
    const r = avaliarCobertura({ data, inicioCobertura: "06:00", fimCobertura: "08:00" }, ponto, "2026-10-28", true);
    expect(r.estado).toBe("conflito");
    expect(fmtIntervalo(r.sobreposicoes[0])).toBe("22:00 (-1d)–07:00");
  });
  it("o mesmo dia pode ter uma cobertura em conflito e outra válida", () => {
    const linhas = [{ id: "manha", data, inicioCobertura: "08:00", fimCobertura: "10:00" }, { id: "tarde", ...cobertura }];
    const p = { disponivel: true, sincronizado_ate: "2026-10-28", vinculos: [{ id: 1, nome: "Romaine", cadastro: "123", empresa: "1", situacao: null }], dias: [{ data, minutos: [450, 705], ponto: evidencia([450, 705]) }] };
    const resultados = avaliarPontoFaltante(p, linhas);
    expect(resultados.get("manha")?.estado).toBe("conflito");
    expect(resultados.get("tarde")?.estado).toBe("sem_conflito");
    const lista = conflitosPorSolicitacao({ sincronizado_ate: p.sincronizado_ate, conflitos: linhas.map((l) => ({ solicitacao_id: "s1", linha_id: l.id, data, minutos: [450, 705], inicio_cobertura: l.inicioCobertura, fim_cobertura: l.fimCobertura, tem_vinculo: true, ponto: evidencia([450, 705]) })) });
    expect(lista.get("s1")?.map((r) => r.linhaId)).toEqual(["manha"]);
  });
  it("Malote distingue conflito, não sobreposição e necessidade de conferência", () => {
    const item: PontoDiariaMalote = { despesa_id: "d1", solicitacao_id: "s1", numero: "SD", faltante_nome: "Romaine", contrato_nome: null, posto_nome: null, tem_vinculo: true, dias: [
      { data, turno: "tarde", minutos: [450, 705], inicio_cobertura: "13:00", fim_cobertura: "17:00", ponto: evidencia([450, 705]) },
      { data, turno: "manha", minutos: [450, 705], inicio_cobertura: "08:00", fim_cobertura: "10:00", ponto: evidencia([450, 705]) },
      { data, turno: "noite", minutos: [450, 705], ponto: evidencia([450, 705]) },
    ] };
    const r = resumoPontoDiaria(item, "2026-10-28");
    expect(r.dias.map((d) => d.estado)).toEqual(["sem_conflito", "conflito", "conferir"]);
    expect(r.conflitos).toBe(1);
    expect(r.aConferir).toBe(1);
  });
  it("retorno antigo sem jornadas não pode dar sinal verde", () => {
    const r = avaliarPontoFaltante({ disponivel: true, dias: [{ data, minutos: [450, 705] }] }, [{ id: "a", ...cobertura }]);
    expect(r.get("a")?.estado).toBe("indisponivel");
  });
  it("formata minutos inclusive jornadas de outros dias", () => {
    expect(horariosDoPonto([780, 420, 1560, -120])).toEqual(["22:00 (-1d)", "07:00", "13:00", "02:00 (+1d)"]);
  });
});
