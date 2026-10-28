import { describe, expect, it } from "vitest";
import { JANELA_EX_COLABORADOR, tempoDesde, textoSaida, vinculoNaEmpresa } from "@/lib/recrutamento/exColaborador";
import { SEM_RESPONSAVEL, desempacotarPassagens, tempoPorResponsavel, type VagaDash } from "@/lib/recrutamento/dashboardRecrutamento";

const HOJE = "2026-10-27";

describe("tempoDesde", () => {
  it("conta em dias, meses e anos de calendário", () => {
    expect(tempoDesde("2026-10-27", HOJE)).toBe("hoje");
    expect(tempoDesde("2026-10-26", HOJE)).toBe("1 dia");
    expect(tempoDesde("2026-10-15", HOJE)).toBe("12 dias");
    expect(tempoDesde("2026-08-22", HOJE)).toBe("2 meses e 5 dias");
    expect(tempoDesde("2026-09-27", HOJE)).toBe("1 mês");
    expect(tempoDesde("2025-07-27", HOJE)).toBe("1 ano e 3 meses");
    expect(tempoDesde("2024-10-27", HOJE)).toBe("2 anos");
  });
  it("vira o mês quando o dia ainda não chegou", () => {
    expect(tempoDesde("2026-09-30", HOJE)).toBe("27 dias");
    expect(tempoDesde("2026-01-31", "2026-03-01")).toBe("1 mês e 1 dia");
  });
  it("data no futuro é hoje", () => {
    expect(tempoDesde("2026-11-02", HOJE)).toBe("hoje");
  });
});

describe("vinculoNaEmpresa", () => {
  it("sem cadastro = nenhum", () => {
    expect(vinculoNaEmpresa([], HOJE).tipo).toBe("nenhum");
    expect(vinculoNaEmpresa(null, HOJE).tipo).toBe("nenhum");
  });
  it("qualquer cadastro ativo = ainda é da casa", () => {
    const v = vinculoNaEmpresa([{ situacao: "Demitido", afastamento: "2026-10-01" }, { situacao: "Trabalhando" }], HOJE);
    expect(v.tipo).toBe("ativo");
  });
  it("só saídas: vale a mais recente, recente dentro da janela", () => {
    const v = vinculoNaEmpresa([
      { situacao: "Demitido", afastamento: "2024-01-10", cargo: "AUXILIAR" },
      { situacao: "Demitido", afastamento: "2026-08-22", cargo: "SERVENTE" },
    ], HOJE);
    expect(v.tipo).toBe("saiu");
    if (v.tipo !== "saiu") return;
    expect(v.saida).toBe("2026-08-22");
    expect(v.dias).toBe(66);
    expect(v.recente).toBe(true);
    expect(v.cadastro.cargo).toBe("SERVENTE");
    expect(textoSaida(v, HOJE)).toBe("Saiu há 2 meses e 5 dias (22/08/2026)");
  });
  it(`exatamente ${JANELA_EX_COLABORADOR} dias ainda pede confirmação; um a mais não`, () => {
    const no = vinculoNaEmpresa([{ situacao: "Demitido", afastamento: "2026-07-29" }], HOJE);
    const fora = vinculoNaEmpresa([{ situacao: "Demitido", afastamento: "2026-07-28" }], HOJE);
    expect(no.tipo === "saiu" && no.recente).toBe(true);
    expect(fora.tipo === "saiu" && fora.recente).toBe(false);
  });
  it("demitido sem data: saiu, mas sem como pedir confirmação", () => {
    const v = vinculoNaEmpresa([{ situacao: "Rescisão" }], HOJE);
    expect(v.tipo === "saiu" && v.saida === null && !v.recente).toBe(true);
    expect(textoSaida(v, HOJE)).toContain("data de saída não informada");
  });
});

const vaga = (p: Partial<VagaDash>): VagaDash => ({
  id: 1, criada: "2026-10-01T10:00", status: "Vaga aberta - Seleção de Currículos", mudou: null,
  cargo: null, contrato: null, cidade: null, qtd: 1, motivo: null, urgencia: null, prevista: null, escala: null,
  horario: null, local: null, solicitante: null, administrativa: false, contratado: null, contratado_inicio: null,
  substituido: null, legado: false, aprovada_em: null, aberta_em: null, ...p,
});

describe("tempoPorResponsavel", () => {
  it("junta passagens e paradas agora por responsável × status", () => {
    const passagens = desempacotarPassagens([
      { responsavel: "ANA", status: "Vaga aberta - Seleção de Currículos", n: 4, media: "3.5", mediana: "2", maximo: "9" },
      { responsavel: "Sem responsável", status: "Aguardando aprovação", n: 2, media: "1", mediana: "1", maximo: "1" },
      { responsavel: "BRUNO", status: "Entrevistas", n: 1, media: "8", mediana: "8", maximo: "8" },
    ]);
    const abertas = [
      vaga({ id: 10, responsavel: "ANA", mudou: "2026-10-17T09:00" }),
      vaga({ id: 11, responsavel: "ANA", mudou: "2026-10-25T09:00" }),
      vaga({ id: 12, responsavel: null, status: "Entrevistas", mudou: null, criada: "2026-10-20T08:00" }),
    ];
    const linhas = tempoPorResponsavel(passagens, abertas, HOJE);
    expect(linhas.map((l) => l.responsavel)).toEqual(["ANA", "BRUNO", SEM_RESPONSAVEL, SEM_RESPONSAVEL]);
    const ana = linhas[0];
    expect(ana.passagens?.n).toBe(4);
    expect(ana.agora).toEqual({ n: 2, media: 6, maximo: 10, vagas: [10, 11] });
    const semEntrevista = linhas.find((l) => l.responsavel === SEM_RESPONSAVEL && l.status === "Entrevistas");
    expect(semEntrevista?.agora?.maximo).toBe(7);
    expect(semEntrevista?.passagens).toBeNull();
    // Dentro do "Sem responsável", o que mais demora vem primeiro.
    expect(linhas[2].status).toBe("Entrevistas");
  });
});
