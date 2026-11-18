import { describe, expect, it } from "vitest";
import {
  agregarPorContrato, calcularIndicadoresDss, filtrarPessoas, hojeIso, intervaloMes, intervaloSemana, pct,
  rotuloSemana, segundaDaSemana, statusContrato, statusPessoa, vigenteEm,
  type LinhaContratoDss, type PessoaDss,
} from "@/lib/treinamentos/dss";

const linha = (o: Partial<LinhaContratoDss>): LinhaContratoDss => ({
  dss_id: "a", empresa: 1, filial: 100, contrato_nome: "1050 - UFRGS", destinatarios: 0, acessaram: 0, assinaram: 0, assinaram_papel: 0, ...o,
});
const pessoa = (o: Partial<PessoaDss>): PessoaDss => ({
  empregado_id: 1, nome: "ANA", matricula: "11", cargo: null, cpf: "11111111111", empresa: 1, filial: 100, contrato_nome: "UFRGS",
  acessado_em: null, assinado_em: null, origem: null, folha_id: null, assinatura_hash: null, ...o,
});

describe("DSS — status da pessoa", () => {
  it("segue não acessado → aguardando → assinado, e distingue o papel", () => {
    expect(statusPessoa({ acessado_em: null, assinado_em: null, origem: null })).toBe("nao_acessado");
    expect(statusPessoa({ acessado_em: "2026-11-18T10:00:00Z", assinado_em: null, origem: null })).toBe("aguardando");
    expect(statusPessoa({ acessado_em: "x", assinado_em: "y", origem: "portal" })).toBe("assinado");
    // Assinou no papel sem nunca abrir o portal.
    expect(statusPessoa({ acessado_em: null, assinado_em: "y", origem: "papel" })).toBe("assinado_papel");
  });
});

describe("DSS — contrato e indicadores", () => {
  it("contrato só é concluído com 100%; sem destinatário não conta como feito", () => {
    expect(statusContrato(10, 10)).toBe("concluido");
    expect(statusContrato(10, 9)).toBe("pendente");
    expect(statusContrato(0, 0)).toBe("sem_destinatarios");
    expect(pct(0, 0)).toBe(0);
    expect(pct(1, 3)).toBe(33.3);
  });

  it("soma o mesmo contrato de dois DSS do período numa linha só", () => {
    const c = agregarPorContrato([
      linha({ dss_id: "a", destinatarios: 10, acessaram: 8, assinaram: 6, assinaram_papel: 2 }),
      linha({ dss_id: "b", destinatarios: 10, acessaram: 10, assinaram: 10 }),
      linha({ dss_id: "a", empresa: 2, filial: 300, contrato_nome: "1030 - UFFS", destinatarios: 4, acessaram: 4, assinaram: 4 }),
    ]);
    expect(c).toHaveLength(2);
    const ufrgs = c.find((x) => x.filial === 100)!;
    expect(ufrgs).toMatchObject({ destinatarios: 20, assinaram: 16, assinaram_papel: 2, status: "pendente", pct: 80 });
    expect(c.find((x) => x.filial === 300)!.status).toBe("concluido");
  });

  it("indicadores: pendentes, não acessaram, aguardando e contratos", () => {
    const i = calcularIndicadoresDss([
      linha({ destinatarios: 10, acessaram: 8, assinaram: 6, assinaram_papel: 1 }),
      linha({ empresa: 2, filial: 300, destinatarios: 4, acessaram: 4, assinaram: 4 }),
      linha({ empresa: 1, filial: 200, destinatarios: 0 }),
    ]);
    expect(i).toMatchObject({
      destinatarios: 14, acessaram: 12, assinaram: 10, assinaramPapel: 1,
      naoAcessaram: 2, aguardando: 2, pendentes: 4, pctConclusao: 71.4,
      contratos: 2, contratosConcluidos: 1, contratosPendentes: 1,
    });
  });
});

describe("DSS — períodos", () => {
  it("semana de referência é a segunda-feira (domingo pertence à semana anterior)", () => {
    expect(segundaDaSemana("2026-11-18")).toBe("2026-11-16"); // quarta
    expect(segundaDaSemana("2026-11-16")).toBe("2026-11-16"); // segunda
    expect(segundaDaSemana("2026-11-22")).toBe("2026-11-16"); // domingo
    expect(segundaDaSemana("2026-03-01")).toBe("2026-02-23"); // vira o mês
    expect(intervaloSemana("2026-11-20")).toEqual({ de: "2026-11-16", ate: "2026-11-16" });
    expect(rotuloSemana("2026-12-28")).toBe("Semana de 28/12 a 03/01/2027");
  });

  it("mês cobre do dia 1 ao último dia, inclusive fevereiro", () => {
    expect(intervaloMes("2026-11")).toEqual({ de: "2026-11-01", ate: "2026-11-30" });
    expect(intervaloMes("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
  });

  it("hoje é o dia de Brasília, não o UTC", () => {
    // 01:30 UTC de 19/11 = 22:30 de 18/11 em Brasília.
    expect(hojeIso(new Date("2026-11-19T01:30:00Z"))).toBe("2026-11-18");
  });

  it("vigência: publicado, já começou e não acabou", () => {
    const d = { situacao: "publicado" as const, disponivel_de: "2026-11-16", disponivel_ate: "2026-11-22" };
    expect(vigenteEm(d, "2026-11-22")).toBe(true);
    expect(vigenteEm(d, "2026-11-23")).toBe(false);
    expect(vigenteEm(d, "2026-11-15")).toBe(false);
    expect(vigenteEm({ ...d, disponivel_ate: null }, "2027-01-01")).toBe(true);
    expect(vigenteEm({ ...d, situacao: "encerrado" }, "2026-11-18")).toBe(false);
  });
});

describe("DSS — filtro de pessoas", () => {
  const lista = [
    pessoa({ empregado_id: 1, nome: "ANA SOUZA", matricula: "4088" }),
    pessoa({ empregado_id: 2, nome: "JOÃO LIMA", matricula: "2131", cpf: "22233344455", acessado_em: "x" }),
    pessoa({ empregado_id: 3, nome: "CARLA", matricula: "999", acessado_em: "x", assinado_em: "y", origem: "portal" }),
    pessoa({ empregado_id: 4, nome: "DANI", matricula: "998", assinado_em: "y", origem: "papel" }),
  ];
  it("pendentes = quem ainda não assinou (por qualquer meio)", () => {
    expect(filtrarPessoas(lista, { status: "pendentes" }).map((p) => p.empregado_id)).toEqual([1, 2]);
    expect(filtrarPessoas(lista, { status: "assinado_papel" }).map((p) => p.empregado_id)).toEqual([4]);
  });
  it("busca por nome sem acento, matrícula ou começo do CPF", () => {
    expect(filtrarPessoas(lista, { busca: "joao" }).map((p) => p.empregado_id)).toEqual([2]);
    expect(filtrarPessoas(lista, { busca: "4088" }).map((p) => p.empregado_id)).toEqual([1]);
    expect(filtrarPessoas(lista, { busca: "222.333" }).map((p) => p.empregado_id)).toEqual([2]);
  });
});
