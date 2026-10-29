import { describe, expect, it } from "vitest";
import {
  FILTRO_CONTROLE_PR_PADRAO, csvControlePr, desenvolvedoresDe, diaBrasilia, filtrarControlePr, linhasAlteradas, paginar,
  type FiltroControlePr, type PrControle,
} from "@/lib/sistemas/controlePullRequests";

// SIS-2026-0786 — Controle de Pull Requests.

const pr = (x: Partial<PrControle>): PrControle => ({
  numero: 1, titulo: "x", url: null, autor_login: null, autor_avatar: null, desenvolvedor: "Fulano",
  chamado: null, chamado_id: null, chamado_assunto: null,
  commits: 1, adicoes: 10, remocoes: 2, arquivos: 1, mergeado_em: "2026-10-29T15:00:00Z", ...x,
});

const lista = [
  pr({ numero: 1081, titulo: "SIS-2026-0787: Desenvolver Submódulo Ficha Financeira", chamado: "SIS-2026-0787", chamado_assunto: "Ficha Financeira Sênior", desenvolvedor: "Pablo Flores Santarem", autor_login: "PabloTasuyuk", mergeado_em: "2026-10-29T20:05:06Z" }),
  pr({ numero: 1082, titulo: "SIS-2026-0753: concilia estoque da IA", chamado: "SIS-2026-0753", desenvolvedor: "Eduardo Jeiel Padilha Monteiro", autor_login: "EduardoJeiel007", mergeado_em: "2026-10-29T22:17:22Z" }),
  pr({ numero: 1070, titulo: "[SEM-CHAMADO]: ajuste de produção", desenvolvedor: "João Victor Peretti de Araujo", autor_login: "joaovperetti", mergeado_em: "2026-10-28T12:00:00Z" }),
];
const f = (x: Partial<FiltroControlePr>): FiltroControlePr => ({ ...FILTRO_CONTROLE_PR_PADRAO, ...x });

describe("filtrarControlePr", () => {
  it("padrão mostra todas, com e sem chamado juntas", () => {
    expect(filtrarControlePr(lista, FILTRO_CONTROLE_PR_PADRAO).map((p) => p.numero)).toEqual([1081, 1082, 1070]);
  });

  it("separa com chamado e sem chamado", () => {
    expect(filtrarControlePr(lista, f({ chamado: "com" })).map((p) => p.numero)).toEqual([1081, 1082]);
    expect(filtrarControlePr(lista, f({ chamado: "sem" })).map((p) => p.numero)).toEqual([1070]);
  });

  it("busca ignora acento e maiúscula, e aceita #numero", () => {
    expect(filtrarControlePr(lista, f({ busca: "joao" })).map((p) => p.numero)).toEqual([1070]);
    expect(filtrarControlePr(lista, f({ busca: "SENIOR" })).map((p) => p.numero)).toEqual([1081]);
    expect(filtrarControlePr(lista, f({ busca: "#1082" })).map((p) => p.numero)).toEqual([1082]);
    expect(filtrarControlePr(lista, f({ busca: "sis-2026-0787" })).map((p) => p.numero)).toEqual([1081]);
    expect(filtrarControlePr(lista, f({ busca: "pablotasuyuk" })).map((p) => p.numero)).toEqual([1081]);
  });

  it("filtra por desenvolvedor", () => {
    expect(filtrarControlePr(lista, f({ desenvolvedor: "Pablo Flores Santarem" })).map((p) => p.numero)).toEqual([1081]);
  });

  it("período usa o dia de Brasília, inclusivo nas duas pontas", () => {
    // 22:17 UTC do dia 29 = 19:17 em Brasília, ainda dia 29.
    expect(filtrarControlePr(lista, f({ de: "2026-10-29", ate: "2026-10-29" })).map((p) => p.numero)).toEqual([1081, 1082]);
    expect(filtrarControlePr(lista, f({ ate: "2026-10-28" })).map((p) => p.numero)).toEqual([1070]);
  });

  it("merge depois das 21h de Brasília não pula para o dia seguinte", () => {
    // 01:30 UTC do dia 30 = 22:30 do dia 29 em Brasília.
    expect(diaBrasilia("2026-10-30T01:30:00Z")).toBe("2026-10-29");
    const tarde = [pr({ numero: 9, mergeado_em: "2026-10-30T01:30:00Z" })];
    expect(filtrarControlePr(tarde, f({ de: "2026-10-30" }))).toEqual([]);
    expect(filtrarControlePr(tarde, f({ ate: "2026-10-29" }))).toHaveLength(1);
  });
});

describe("apoio", () => {
  it("desenvolvedores em ordem alfabética, sem repetir", () => {
    expect(desenvolvedoresDe([...lista, lista[0]])).toEqual(["Eduardo Jeiel Padilha Monteiro", "João Victor Peretti de Araujo", "Pablo Flores Santarem"]);
  });

  it("linhas alteradas soma adições e remoções, tratando nulo como zero", () => {
    expect(linhasAlteradas(pr({ adicoes: 142, remocoes: 38 }))).toBe(180);
    expect(linhasAlteradas(pr({ adicoes: null, remocoes: 5 }))).toBe(5);
  });

  it("paginar limita a página e informa o intervalo", () => {
    const itens = Array.from({ length: 45 }, (_, i) => i);
    expect(paginar(itens, 3)).toMatchObject({ pagina: 3, totalPaginas: 3, de: 41, ate: 45 });
    expect(paginar(itens, 99).pagina).toBe(3);
    expect(paginar([], 1)).toMatchObject({ pagina: 1, totalPaginas: 1, de: 0, ate: 0, itens: [] });
  });
});

describe("csvControlePr", () => {
  it("BOM, ponto e vírgula, aspas escapadas e 'Sem chamado'", () => {
    const csv = csvControlePr([pr({ numero: 7, titulo: 'Ajuste "urgente"', desenvolvedor: "Ana", mergeado_em: "2026-10-29T20:05:06Z" })]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [cab, linha] = csv.slice(1).split("\r\n");
    expect(cab.split(";")[0]).toBe('"Desenvolvedor"');
    expect(linha).toBe('"Ana";"#7";"Sem chamado";"Ajuste ""urgente""";"1";"10";"2";"1";"29/10/2026, 17:05"');
  });
});
