import { describe, it, expect } from "vitest";
import {
  limparPostoSenior, sugerirPostos, semelhancaPosto, conferirContrato,
  type ContratoAtivos, type PostoPlanilha,
} from "@/pages/rh/conferenciaAtivos";

// =====================================================================
// RH › Ativos/Contratos (mig 20260930000279).
//
// Os nomes abaixo são reais (30/09/2026): o posto da Senior vem com código
// ("01-1099-0071-0061-06-…") e o da planilha é texto livre da licitação.
// A sugestão erra para o lado seguro: na dúvida, não sugere — quem liga é o RH.
// =====================================================================

const pl = (nome: string, vagas = 1): PostoPlanilha => ({ nome, vagas, servico: null, vigencia: "2026-01-01" });

const PREF_POA = [
  pl("POSTO A - RECEPCIONISTA 30H 5X2", 11),
  pl("POSTO B - RECEPCIONISTA 40H 5X2", 91),
  pl("POSTO B1 - RECEPCIONISTA 40H 5X2", 28),
  pl("POSTO B2 - RECEPCIONISTA SUPERVISOR 40H 5X2", 1),
  pl("POSTO C - RECEPCIONISTA 12X36 DIURNO", 42),
  pl("POSTO CR - RECEPCIONISTA 12X36 DIURNO", 8),
  pl("POSTO D - RECEPCIONISTA 12X36 NOTURNO", 20),
  pl("POSTO D1 - RECEPCIONISTA SUPERVISOR 12X36 NOTURNO", 2),
];

const TRIUNFO = [pl("VIGIA 12X36 DIURNO", 9), pl("VIGIA 12X36 NOTURNO", 90), pl("VIGIA 44H DIURNO", 25)];

describe("limparPostoSenior", () => {
  it("tira o código da Senior da frente", () => {
    expect(limparPostoSenior("01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2")).toBe("RECEPCIONISTA-B1 40H 5X2");
    expect(limparPostoSenior("02-1091-0025-0072-6-PORTEIRO-12X36 ITEM 5")).toBe("PORTEIRO-12X36 ITEM 5");
    expect(limparPostoSenior("01-1049-0060-0162-0057-COORDENADOR ADM-40H")).toBe("COORDENADOR ADM-40H");
  });
  it("posto vazio vira 'Sem posto no cadastro'", () => {
    expect(limparPostoSenior("")).toBe("Sem posto no cadastro");
  });
});

describe("sugerirPostos", () => {
  it("casa pelo código do posto (A, B1, D…) e pela jornada", () => {
    expect(sugerirPostos("01-1099-0071-0061-06-RECEPCIONISTA-A 30H 5X2", PREF_POA)).toEqual(["POSTO A - RECEPCIONISTA 30H 5X2"]);
    expect(sugerirPostos("01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2", PREF_POA)).toEqual(["POSTO B1 - RECEPCIONISTA 40H 5X2"]);
    expect(sugerirPostos("01-1099-0071-0061-06-RECEPCIONISTA-B 40H 5X2", PREF_POA)).toEqual(["POSTO B - RECEPCIONISTA 40H 5X2"]);
    expect(sugerirPostos("01-1099-0071-0061-06-RECEPCIONISTA-D 220 Hrs 12x36 Not", PREF_POA)).toEqual(["POSTO D - RECEPCIONISTA 12X36 NOTURNO"]);
    expect(sugerirPostos("01-1099-0071-0061-06-RECEPCIONISTA-CR 220 Hrs 12x36 Diu", PREF_POA)).toEqual(["POSTO CR - RECEPCIONISTA 12X36 DIURNO"]);
  });

  it("entende abreviações de turno (NOT, DIU) e jornada", () => {
    expect(sugerirPostos("02-1064-0008-0012-06-VIGIA-12X36 NOT", TRIUNFO)).toEqual(["VIGIA 12X36 NOTURNO"]);
    expect(sugerirPostos("02-1064-0008-0012-06-VIGIA-12X36 DIU", TRIUNFO)).toEqual(["VIGIA 12X36 DIURNO"]);
    expect(sugerirPostos("02-1064-0008-0012-06-VIGIA-44H", TRIUNFO)).toEqual(["VIGIA 44H DIURNO"]);
  });

  it("código diferente derruba a nota (B não é B1 nem B2)", () => {
    const b = "01-1099-0071-0061-06-RECEPCIONISTA-B 40H 5X2";
    expect(semelhancaPosto(b, "POSTO B - RECEPCIONISTA 40H 5X2"))
      .toBeGreaterThan(semelhancaPosto(b, "POSTO B1 - RECEPCIONISTA 40H 5X2"));
  });

  it("sem semelhança suficiente não sugere nada", () => {
    expect(sugerirPostos("Posto padrão do sistema", TRIUNFO)).toEqual([]);
    expect(sugerirPostos("02-1064-0023-0051-6-COZINHEIRA", TRIUNFO)).toEqual([]);
    expect(sugerirPostos("", TRIUNFO)).toEqual([]);
  });

  it("posto separado por cidade na planilha: sugere todos os empatados", () => {
    const pls = [pl("SUP. 5D POA", 14), pl("SUP. 5D TRAMANDAI", 1), pl("ASG 5D POA", 233)];
    const s = sugerirPostos("SUP 5D", pls);
    expect(s).toEqual(expect.arrayContaining(["SUP. 5D POA", "SUP. 5D TRAMANDAI"]));
    expect(s).not.toContain("ASG 5D POA");
  });
});

describe("conferirContrato", () => {
  const base = (over: Partial<ContratoAtivos>): ContratoAtivos => ({
    id: "c1", nome: "Contrato", cliente: null, status: "ativo", encerrado: false,
    postos: [], postos_senior: [], vinculos: [], ...over,
  });
  const v = (posto_senior: string, planilha_posto: string | null, extra: Partial<{ ignorar: boolean; orfa: boolean }> = {}) => ({
    posto_senior, planilha_posto, ignorar: false, orfa: false, planilha_posto_gravado: planilha_posto, ...extra,
  });

  it("1 para 1: confere vagas × pessoas em cada posto", () => {
    const r = conferirContrato(base({
      postos: TRIUNFO,
      postos_senior: [
        { posto_senior: "VIGIA-12X36 NOT", qtd: 85, afastados: 3 },
        { posto_senior: "VIGIA-44H", qtd: 25, afastados: 0 },
        { posto_senior: "VIGIA-12X36 DIU", qtd: 8, afastados: 1 },
      ],
      vinculos: [v("VIGIA-12X36 NOT", "VIGIA 12X36 NOTURNO"), v("VIGIA-44H", "VIGIA 44H DIURNO"), v("VIGIA-12X36 DIU", "VIGIA 12X36 DIURNO")],
    }));
    expect(r.grupos).toHaveLength(3);
    const noturno = r.grupos.find((g) => g.planilha[0].nome === "VIGIA 12X36 NOTURNO")!;
    expect(noturno).toMatchObject({ previsto: 90, ativos: 85, diferenca: -5, situacao: "falta", afastados: 3 });
    expect(r.grupos.find((g) => g.planilha[0].nome === "VIGIA 44H DIURNO")!.situacao).toBe("ok");
    expect(r.grupos[0].situacao).toBe("falta");                 // pior primeiro
    expect(r.previsto).toBe(124);
    expect(r.ativos).toBe(118);
    expect(r.pessoasPendentes).toBe(0);
    expect(r.fechado).toBe(false);
  });

  it("um posto da Senior para vários da planilha vira um grupo com a soma", () => {
    const r = conferirContrato(base({
      postos: [pl("ASG 5D POA", 233), pl("ASG 5D TRAMANDAI", 7), pl("ASG 6D POA", 37)],
      postos_senior: [
        { posto_senior: "AUX SERVIÇOS GERAIS-30H", qtd: 278, afastados: 10 },
        { posto_senior: "AUX SERVIÇOS GERAIS-36H", qtd: 52, afastados: 2 },
      ],
      vinculos: [
        v("AUX SERVIÇOS GERAIS-30H", "ASG 5D POA"),
        v("AUX SERVIÇOS GERAIS-30H", "ASG 5D TRAMANDAI"),
        v("AUX SERVIÇOS GERAIS-36H", "ASG 6D POA"),
      ],
    }));
    expect(r.grupos).toHaveLength(2);
    const g5 = r.grupos.find((g) => g.planilha.length === 2)!;
    expect(g5).toMatchObject({ previsto: 240, ativos: 278, diferenca: 38, situacao: "excesso" });
  });

  it("postos da Senior sem ligação ficam pendentes; ignorados saem da conta", () => {
    const r = conferirContrato(base({
      postos: [pl("VIGIA 44H DIURNO", 25)],
      postos_senior: [
        { posto_senior: "VIGIA-44H", qtd: 25, afastados: 0 },
        { posto_senior: "COZINHEIRA", qtd: 1, afastados: 0 },
        { posto_senior: "Posto padrão do sistema", qtd: 1, afastados: 0 },
      ],
      vinculos: [v("VIGIA-44H", "VIGIA 44H DIURNO"), v("Posto padrão do sistema", null, { ignorar: true })],
    }));
    expect(r.seniorPendentes.map((s) => s.posto_senior)).toEqual(["COZINHEIRA"]);
    expect(r.seniorIgnorados.map((s) => s.posto_senior)).toEqual(["Posto padrão do sistema"]);
    expect(r.pessoasPendentes).toBe(1);
    expect(r.ativos).toBe(26);                                   // ignorado fora
    expect(r.fechado).toBe(false);                               // ainda tem pendente
  });

  it("posto da planilha sem ninguém ligado aparece à parte; ligação órfã é avisada", () => {
    const r = conferirContrato(base({
      postos: [pl("PORTARIA 400H", 20), pl("PORTARIA 460H", 2)],
      postos_senior: [{ posto_senior: "PORTEIRO-44H ITEM 3", qtd: 15, afastados: 0 }],
      vinculos: [
        v("PORTEIRO-44H ITEM 3", "PORTARIA 400H"),
        v("PORTEIRO-30H ITEM 6", null, { orfa: true }),
      ],
    }));
    expect(r.planilhaSemVinculo.map((p) => p.nome)).toEqual(["PORTARIA 460H"]);
    expect(r.vinculosOrfaos).toHaveLength(1);
    expect(r.grupos[0]).toMatchObject({ previsto: 20, ativos: 15, situacao: "falta" });
  });

  it("tudo ligado e batendo = contrato fechado", () => {
    const r = conferirContrato(base({
      postos: [pl("VIGIA 44H DIURNO", 25)],
      postos_senior: [{ posto_senior: "VIGIA-44H", qtd: 25, afastados: 0 }],
      vinculos: [v("VIGIA-44H", "VIGIA 44H DIURNO")],
    }));
    expect(r.fechado).toBe(true);
    expect(r.diferenca).toBe(0);
  });
});
