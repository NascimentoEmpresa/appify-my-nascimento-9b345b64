import { describe, expect, it } from "vitest";
import {
  avisoEnderecoPosto, enderecoDoPosto, formatarLocal, postoPlanilhaDe, postosDaPlanilha, proximoEndereco,
  type PostoPlanilha,
} from "@/lib/recrutamento/postosPlanilhaVaga";

// DMAE - 895/0 (13/11/2026): o catálogo tem os 4 postos da planilha + os
// locais antigos (GALERIA DE ARTES...). A vaga só pode oferecer os 4.
const catalogo = [
  { id: "p1", nome: "PORTEIRO 9H P/DIA DIURNO", na_planilha: true },
  { id: "p2", nome: "PORTEIRO 10H P/DIA DIURNO", na_planilha: true },
  { id: "p3", nome: "PORTEIRO 12X36 DIURNO", na_planilha: true },
  { id: "p4", nome: "SUPERVISOR", na_planilha: true },
  { id: "x1", nome: "GALERIA DE ARTES", na_planilha: false },
  { id: "x2", nome: "PORTARIA DA GDCE", na_planilha: false },
];
const linha = (id: string | null, posto: string, locais: PostoPlanilha["locais"] = []): PostoPlanilha =>
  ({ sup_posto_id: id, posto, planilha_custo_id: "pc-" + posto, vigencia: "2026-01-01", locais });
const planilha = [
  linha("p1", "PORTEIRO 9H P/DIA DIURNO", [{ logradouro: "Rua 24 de Outubro", numero: "200", bairro: "Moinhos", municipio: "Porto Alegre", uf: "rs", cep: "90510-000" }]),
  linha("p2", "PORTEIRO 10H P/DIA DIURNO"),
  linha("p3", "PORTEIRO 12X36 DIURNO", [
    { logradouro: "Av. A", numero: "1", bairro: "Centro", municipio: "Porto Alegre", uf: "RS" },
    { logradouro: "Av. B", numero: "2", bairro: "Centro", municipio: "Porto Alegre", uf: "RS" },
  ]),
  linha("p4", "SUPERVISOR"),
];

describe("postosDaPlanilha", () => {
  it("mostra só os postos da Planilha de Custo do contrato", () => {
    expect(postosDaPlanilha(catalogo, planilha).map(p => p.nome)).toEqual([
      "PORTEIRO 9H P/DIA DIURNO", "PORTEIRO 10H P/DIA DIURNO", "PORTEIRO 12X36 DIURNO", "SUPERVISOR",
    ]);
  });
  it("planilha ilegível (RPC fora do ar) cai no na_planilha do catálogo", () => {
    expect(postosDaPlanilha(catalogo, null).map(p => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });
  it("contrato sem planilha segue com o catálogo inteiro", () => {
    expect(postosDaPlanilha(catalogo, [])).toHaveLength(6);
    const semMarca = catalogo.map(p => ({ ...p, na_planilha: false }));
    expect(postosDaPlanilha(semMarca, null)).toHaveLength(6);
  });
  it("outro contrato, outra planilha", () => {
    expect(postosDaPlanilha(catalogo, [linha("x1", "GALERIA DE ARTES")]).map(p => p.id)).toEqual(["x1"]);
  });
});

describe("endereço do posto", () => {
  it("um local com endereço preenche", () => {
    expect(enderecoDoPosto(postoPlanilhaDe(planilha, "p1")).endereco)
      .toBe("Rua 24 de Outubro, 200, Moinhos, Porto Alegre/RS, CEP 90510-000");
  });
  it("posto sem endereço fica em branco", () => {
    expect(enderecoDoPosto(postoPlanilhaDe(planilha, "p2"))).toEqual({ endereco: "", opcoes: [] });
    expect(enderecoDoPosto(null).endereco).toBe("");
  });
  it("vários locais diferentes: não escolhe, lista", () => {
    const r = enderecoDoPosto(postoPlanilhaDe(planilha, "p3"));
    expect(r.endereco).toBe("");
    expect(r.opcoes).toHaveLength(2);
  });
  it("local só com cidade não conta como endereço", () => {
    expect(formatarLocal({ municipio: "Porto Alegre", uf: "RS" })).toBe("");
  });
});

describe("proximoEndereco", () => {
  it("preenche vazio e troca o que a tela mesma pôs", () => {
    expect(proximoEndereco("", "", "Rua A, 1")).toEqual({ valor: "Rua A, 1", auto: "Rua A, 1" });
    expect(proximoEndereco("Rua A, 1", "Rua A, 1", "Rua B, 2")).toEqual({ valor: "Rua B, 2", auto: "Rua B, 2" });
  });
  it("posto sem endereço apaga só o automático", () => {
    expect(proximoEndereco("Rua A, 1", "Rua A, 1", "")).toEqual({ valor: "", auto: "" });
  });
  it("nunca sobrescreve o que a pessoa digitou", () => {
    expect(proximoEndereco("Rua digitada, 9", "Rua A, 1", "Rua B, 2").valor).toBe("Rua digitada, 9");
    expect(proximoEndereco("Rua digitada, 9", "", "").valor).toBe("Rua digitada, 9");
  });
  it("aviso pede pra digitar quando o posto não tem endereço", () => {
    expect(avisoEnderecoPosto({ posto_id: "p2", endereco: "", opcoes: [] }, "")).toMatch(/digite/);
    expect(avisoEnderecoPosto({ posto_id: "", endereco: "", opcoes: [] }, "")).toBe("");
  });
});
