import { describe, it, expect } from "vitest";
import {
  limparPostoSenior, sugerirPostos, semelhancaPosto, conferirContrato, fmtSaldo, sugerirContrato,
  type ContratoAtivos, type PostoPlanilha, type PessoaContrato,
} from "@/pages/rh/conferenciaAtivos";

// =====================================================================
// RH › Ativos/Contratos (migs 20260930000279 e 20261005000001).
//
// Os nomes abaixo são reais (30/09/2026): o posto da Senior vem com código
// ("01-1099-0071-0061-06-…") e o da planilha é texto livre da licitação.
// A sugestão erra para o lado seguro: na dúvida, não sugere — quem liga é o RH.
// =====================================================================

const pl = (nome: string, vagas = 1): PostoPlanilha => ({ nome, vagas });

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
  let seq = 0;
  const p = (over: Partial<PessoaContrato>): PessoaContrato => ({
    id: ++seq, cadastro: String(seq), nome: `Pessoa ${seq}`, cargo: null, situacao: "Trabalhando",
    conta: true, posto_senior: "X", posto: null, fora: false, origem: null, ...over,
  });
  const base = (over: Partial<ContratoAtivos>): ContratoAtivos => ({
    id: "c1", nome: "Contrato", cliente: null, encerrado: false, postos: [], pessoas: [], ...over,
  });
  const n = (k: number, over: Partial<PessoaContrato>) => Array.from({ length: k }, () => p(over));

  it("previsto × tem posto a posto; afastado fica no posto mas não conta", () => {
    const r = conferirContrato(base({
      postos: TRIUNFO,
      pessoas: [
        ...n(85, { posto: "VIGIA 12X36 NOTURNO", origem: "posto" }),
        ...n(3, { posto: "VIGIA 12X36 NOTURNO", origem: "posto", situacao: "Auxílio Doença", conta: false }),
        ...n(25, { posto: "VIGIA 44H DIURNO", origem: "posto" }),
        ...n(1, { posto: "VIGIA 44H DIURNO", origem: "posto", situacao: "Atestado (dias)", conta: true }),
      ],
    }));
    const noturno = r.postos.find((x) => x.nome === "VIGIA 12X36 NOTURNO")!;
    expect(noturno).toMatchObject({ previsto: 90, tem: 85, saldo: -5, situacao: "falta" });
    expect(noturno.afastados).toHaveLength(3);
    expect(noturno.pessoas).toHaveLength(88);
    expect(r.postos.find((x) => x.nome === "VIGIA 44H DIURNO")).toMatchObject({ tem: 26, saldo: 1, situacao: "excesso" });
    expect(r.postos.find((x) => x.nome === "VIGIA 12X36 DIURNO")).toMatchObject({ previsto: 9, tem: 0, saldo: -9 });
    expect(r).toMatchObject({ previsto: 124, tem: 111, saldo: -13, falta: 14, sobra: 1, semPosto: 0 });
    expect(r.afastados).toHaveLength(3);
  });

  it("quem não tem posto fica pendente, agrupado pelo posto da Senior, com sugestão", () => {
    const r = conferirContrato(base({
      postos: TRIUNFO,
      pessoas: [
        ...n(2, { posto_senior: "02-1064-0008-0012-06-VIGIA-12X36 NOT" }),
        ...n(1, { posto_senior: "02-1064-0023-0051-6-COZINHEIRA" }),
      ],
    }));
    expect(r.semPosto).toBe(3);
    expect(r.pendentes.map((x) => [x.pessoas.length, x.sugestao])).toEqual([[2, "VIGIA 12X36 NOTURNO"], [1, null]]);
    expect(r.tem).toBe(3);                                      // conta no contrato, mesmo sem posto
    expect(r.postos.every((x) => x.tem === 0)).toBe(true);
  });

  it("fora da conta não entra em lugar nenhum", () => {
    const r = conferirContrato(base({
      postos: [pl("VIGIA 44H DIURNO", 1)],
      pessoas: [p({ posto: "VIGIA 44H DIURNO" }), p({ fora: true, origem: "pessoa" })],
    }));
    expect(r).toMatchObject({ tem: 1, saldo: 0, situacao: "ok", semPosto: 0 });
    expect(r.fora).toHaveLength(1);
  });

  it("posto que saiu da planilha volta a ser pendente", () => {
    const r = conferirContrato(base({
      postos: [pl("PORTARIA 400H", 2)],
      pessoas: [p({ posto: "PORTARIA ANTIGA", posto_senior: "PORTEIRO-44H" })],
    }));
    expect(r.semPosto).toBe(1);
  });

  it("fmtSaldo", () => {
    expect([fmtSaldo(3), fmtSaldo(-2), fmtSaldo(0)]).toEqual(["+3", "−2", "0"]);
  });
});

describe("sugerirContrato", () => {
  const cts = [
    { id: "cx", nome: "CAXIAS DO SUL - 2026/95" },
    { id: "cx-old", nome: "CAXIAS DO SUL  -2025/162" },
    { id: "gu", nome: "GUAPORÉ LIMPEZA SMED EMERGENCIAL - 063/2026" },
    { id: "em", nome: "EMBRAPA - CANOINHA - 47/2024" },
    { id: "em2", nome: "EMBRAPA CLIMA TEMPERADO - 2026/02" },
    { id: "lb", nome: "UFRGS INTERPRETE DE LIBRAS C. 009.2026" },
    { id: "sb", nome: "UFRGS AUXILIAR DE SAUDE BUCAL - 030/2026" },
  ];
  it("casa número/ano em qualquer ordem e abreviações", () => {
    expect(sugerirContrato("1042 - CAXIAS DO SUL - 95.2026", cts)?.id).toBe("cx");
    expect(sugerirContrato("1097 - GUAPORÉ LIMP SMED EMERGENCIAL - 063.2026", cts)?.id).toBe("gu");
    expect(sugerirContrato("1094 - EMBRAPA CANOINHAS - 47/2024", cts)?.id).toBe("em");
    expect(sugerirContrato("1107 - UFRGS - INTERPRETE DE LIBRAS - 009.2026", cts)?.id).toBe("lb");
  });
  it("não sugere quando não há contrato parecido", () => {
    expect(sugerirContrato("1036 - PM DE CHARQUEADAS", cts)).toBeNull();
  });
});

describe("sugerirPostos — jornada, cidade e chefia (casos reais de 05/10/2026)", () => {
  const CAMARA = [pl("AUX. LIMPEZA 220H 5X2", 9), pl("COPEIRA 220H 5X2", 4), pl("ENCARREGADO 220H 5X2", 1)];
  const VERANOPOLIS = [pl("AUX. COZINHA/COPEIRO 220H 5X2"), pl("AUX. LIMPEZA 22H 5X2"), pl("AUX. LIMPEZA 44H 5X2"), pl("COPEIRA 22H 5X2"), pl("COPEIRA 33H 5X2")];
  const CANAA = [pl("SERVENTE DE LIMPEZA 40H 40% INSALUBRIDADE"), pl("SUPERVISOR 20H"), pl("PROFESSOR REGENTE DE TURMA 44H")];
  const CARGA = [pl("AUX. CARGA E DESCARGA 44H 5X2 PORTO ALEGRE"), pl("AUX. CARGA E DESCARGA 44H 5X2 TRAMANDAI"), pl("SUPERVISOR DE CARGA E DESCARGA 5X2 PORTO ALEGRE")];

  it("44H semanal = 220H mensal; SEG A SEX = 5X2; LIDER = ENCARREGADO", () => {
    expect(sugerirPostos("AUX LIMPEZA-44H SEG A SEX", CAMARA)).toEqual(["AUX. LIMPEZA 220H 5X2"]);
    expect(sugerirPostos("AUX LIMPEZA (LIDER)-44H SEG A SEX", CAMARA)).toEqual(["ENCARREGADO 220H 5X2"]);
    expect(sugerirPostos("RECEPCIONISTA-150H", [pl("RECEPCIONISTA 30H"), pl("RECEPCIONISTA 40H")])).toEqual(["RECEPCIONISTA 30H"]);
  });
  it("COPEIRO = COPEIRA, e carga horária diferente é outro posto", () => {
    expect(sugerirPostos("COPEIRO-110H SEG A SEX", VERANOPOLIS)).toEqual(["COPEIRA 22H 5X2"]);
  });
  it("só jornada em comum não é sugestão", () => {
    expect(sugerirPostos("APRENDIZ-40h", CANAA)).toEqual([]);
    expect(sugerirPostos("APRENDIZ-20h", CANAA)).toEqual([]);
  });
  it("POA = PORTO ALEGRE; supervisor só casa com supervisor", () => {
    expect(sugerirPostos("AUX CARGA E DESCARGA-44h-5X2-POA", CARGA)).toEqual(["AUX. CARGA E DESCARGA 44H 5X2 PORTO ALEGRE"]);
    expect(sugerirPostos("SUPERVISOR-44h-5X2-POA", CARGA)).toEqual(["SUPERVISOR DE CARGA E DESCARGA 5X2 PORTO ALEGRE"]);
  });
  it("na conferência: empate (cidades) não sugere; contrato de um posto só sugere ele", () => {
    const pes = (posto_senior: string): PessoaContrato => ({ id: 1, cadastro: "1", nome: "A", cargo: "COPEIRO", situacao: "Trabalhando", conta: true, posto_senior, posto: null, fora: false, origem: null });
    const empate = conferirContrato({ id: "c", nome: "C", cliente: null, encerrado: false,
      postos: [pl("COPEIRO 40H 5X2 IMBÉ"), pl("COPEIRO 40H 5X2 PORTO ALEGRE")], pessoas: [pes("COPEIRO-40H REITORIA")] });
    expect(empate.pendentes[0].sugestao).toBeNull();
    const unico = conferirContrato({ id: "c", nome: "C", cliente: null, encerrado: false,
      postos: [pl("CONTÍNUO 44H", 30)], pessoas: [pes("MENSAGEIRO-44H-6X1")] });
    expect(unico.pendentes[0].sugestao).toBe("CONTÍNUO 44H");
  });
});

describe("sugerirContrato — filiais administrativas", () => {
  const cts = [
    { id: "nh", nome: "ADMINISTRATIVO - NH" }, { id: "sn", nome: "ADMINISTRATIVO - SN" },
    { id: "hagg", nome: "ADMINISTRATIVO - HAGG" }, { id: "irga", nome: "IRGA APOIO ADMINISTRATIVO - 049/2026" },
  ];
  it("ADM = ADMINISTRATIVO, e a empresa no fim decide", () => {
    expect(sugerirContrato("1093 - ADM E ESTAGIARIOS - NH", cts)?.id).toBe("nh");
    expect(sugerirContrato("1054 - ADM E ESTAGIARIOS - SN", cts)?.id).toBe("sn");
    expect(sugerirContrato("1053 - ADM E ESTAGIARIOS - HAGG", cts)?.id).toBe("hagg");
  });
});
