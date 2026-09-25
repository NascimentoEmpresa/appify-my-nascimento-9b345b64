import { describe, expect, it } from "vitest";
import {
  agruparPorContrato, estadoDoMarco, permaneceuEfetivo, proximaPendencia, resumoAcomp, somarDias, sugerirTipoSaida,
  type CheckAcomp, type LinhaAcomp,
} from "@/lib/recrutamento/acompanhamento";

const HOJE = "2026-09-25";
const linha = (p: Partial<LinhaAcomp> = {}): LinhaAcomp => ({
  empregado_id: 1, nome: "FULANO", cpf: "", cargo: "SERVENTE", contrato: "UFRGS", local: null,
  situacao: "Trabalhando", admissao: "2026-09-10", afastamento: null, causa: null, saiu: false,
  dias: 15, origem: "senior", candidato_id: null, vaga_id: null, vaga_status: null, cidade: null,
  acomp: null, checks: [], ...p,
});
const check = (marco: 7 | 30 | 60 | 90, resultado: CheckAcomp["resultado"] = "positivo"): CheckAcomp => ({
  id: marco, empregado_id: 1, marco, resultado, realizado_em: HOJE, observacao: null, registrado_por: "RH", registrado_em: HOJE,
});

describe("estadoDoMarco", () => {
  it("vence em admissão + N dias", () => {
    expect(somarDias("2026-09-10", 7)).toBe("2026-09-17");
    expect(somarDias("2026-08-31", 30)).toBe("2026-09-30");
  });
  it("7 dias passou sem check: atrasado, com os dias de atraso", () => {
    expect(estadoDoMarco(linha(), 7, HOJE)).toEqual({ tipo: "atrasado", vence: "2026-09-17", dias: 8 });
  });
  it("vencendo hoje, em breve (até 3 dias) e futuro", () => {
    expect(estadoDoMarco(linha({ admissao: "2026-09-18" }), 7, HOJE).tipo).toBe("hoje");
    expect(estadoDoMarco(linha({ admissao: "2026-09-20" }), 7, HOJE)).toMatchObject({ tipo: "breve", dias: 2 });
    expect(estadoDoMarco(linha(), 30, HOJE)).toMatchObject({ tipo: "futuro", vence: "2026-10-10" });
  });
  it("com check registrado é 'feito', mesmo atrasado", () => {
    expect(estadoDoMarco(linha({ checks: [check(7)] }), 7, HOJE).tipo).toBe("feito");
  });
  it("saiu antes do marco: não se aplica (não cobra check de quem já foi)", () => {
    const l = linha({ admissao: "2026-08-01", saiu: true, afastamento: "2026-08-20" });
    expect(estadoDoMarco(l, 7, HOJE).tipo).toBe("atrasado");
    expect(estadoDoMarco(l, 30, HOJE).tipo).toBe("nao_se_aplica");
  });
});

describe("proximaPendencia", () => {
  it("devolve o primeiro marco que pede ação", () => {
    expect(proximaPendencia(linha(), HOJE)?.marco).toBe(7);
    expect(proximaPendencia(linha({ checks: [check(7)] }), HOJE)).toBeNull();
  });
});

describe("permaneceuEfetivo", () => {
  it("o que foi marcado vence", () => {
    expect(permaneceuEfetivo(linha({ acomp: { permaneceu: "Não" } as LinhaAcomp["acomp"] }))).toEqual({ valor: "Não", automatico: false });
  });
  it("sem marcação: saiu na experiência = Não; passou de 90 dias = Sim; na experiência = em aberto", () => {
    expect(permaneceuEfetivo(linha({ saiu: true, admissao: "2026-08-01", afastamento: "2026-08-20" })).valor).toBe("Não");
    expect(permaneceuEfetivo(linha({ dias: 120 })).valor).toBe("Sim");
    expect(permaneceuEfetivo(linha({ dias: 40 })).valor).toBeNull();
  });
});

describe("sugerirTipoSaida", () => {
  it("lê a causa da Senior", () => {
    expect(sugerirTipoSaida("Inic.Empresa s/ Justa Causa")).toBe("Demitido");
    expect(sugerirTipoSaida("Pedido de Demissão")).toBe("Demissionário");
    expect(sugerirTipoSaida("Inic.Empregado")).toBe("Demissionário");
    expect(sugerirTipoSaida(null)).toBeNull();
  });
});

describe("resumoAcomp e agrupamento", () => {
  it("conta pendências e resultados", () => {
    const r = resumoAcomp([linha(), linha({ empregado_id: 2, checks: [check(7, "negativo")], origem: "recrutamento" })], HOJE);
    expect(r).toMatchObject({ pessoas: 2, doRecrutamento: 1, atrasados: 1, feitos: 1, negativos: 1 });
  });
  it("um bloco por contrato, em ordem alfabética", () => {
    const g = agruparPorContrato([linha({ contrato: "UFRGS" }), linha({ contrato: "CANAA" }), linha({ contrato: "UFRGS" })]);
    expect(g.map(([c, ls]) => [c, ls.length])).toEqual([["CANAA", 1], ["UFRGS", 2]]);
  });
});
