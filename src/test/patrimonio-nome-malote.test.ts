import { describe, it, expect } from "vitest";
import { nomeDespesaMalote } from "@/pages/juridico/patrimonio/nomeMalote";

// Chamado do Jurídico (03/11/2026): o "Enviar ao Malote" mandava
// "Luz — Novembro/2026"; o nome certo é o identificador da conta.
describe("nome da despesa enviada ao Malote", () => {
  it("usa a descrição da conta, sem tipo nem competência", () => {
    expect(nomeDespesaMalote({ categoria: "Luz", descricao: "RGE - JOÃO PESSOA 172" }, "PRÉDIO RUA JOÃO PESSOA"))
      .toBe("RGE - JOÃO PESSOA 172");
  });

  it("duas contas da mesma categoria em imóveis diferentes ficam com nomes diferentes", () => {
    const a = nomeDespesaMalote({ categoria: "Água", descricao: "CORSAN - JOÃO PESSOA CASA 172" });
    const b = nomeDespesaMalote({ categoria: "Água", descricao: "CORSAN - VEREADOR ADÃO TAVARES 64" });
    expect(a).not.toBe(b);
  });

  it("parcela do contrato: tira o '· Parcela N/T' e escreve N DE T PARCELAS", () => {
    expect(nomeDespesaMalote({
      categoria: "Financiamento", descricao: "CASA SENILTON · Parcela 91/420",
      parcela_numero: 91, parcela_total: 420, tipo_lancamento: "parcela",
    })).toBe("CASA SENILTON 91 DE 420 PARCELAS");
  });

  it("sem as colunas de número, lê o número do próprio sufixo", () => {
    expect(nomeDespesaMalote({ categoria: "Financiamento", descricao: "CASA CADU · Parcela 7/420" }))
      .toBe("CASA CADU 7 DE 420 PARCELAS");
  });

  it("molde com X: o X vira o número da parcela enviada", () => {
    expect(nomeDespesaMalote({
      descricao: "TURIM - MOISÉS OSMARINI X DE 72 PARCELAS · Parcela 15/72",
      parcela_numero: 15, parcela_total: 72,
    })).toBe("TURIM - MOISÉS OSMARINI 15 DE 72 PARCELAS");
  });

  it("seguro: o número vem do campo Parcelas", () => {
    expect(nomeDespesaMalote({ categoria: "Seguro", descricao: "SEGURO PRÉDIO TF-10 X DE 6 PARCELAS", parcelas: "2/6" }))
      .toBe("SEGURO PRÉDIO TF-10 2 DE 6 PARCELAS");
  });

  it("descrição que já diz o tamanho do contrato não ganha outro N DE T", () => {
    expect(nomeDespesaMalote({
      descricao: "GMZ EMPREEND. IMOBILIARIOS LTDA - COND. GREEN 60 PARC. · Parcela 3/60",
      parcela_numero: 3, parcela_total: 60,
    })).toBe("GMZ EMPREEND. IMOBILIARIOS LTDA - COND. GREEN 60 PARC.");
  });

  it("sinal/entrada não é parcela numerada: fica só o nome", () => {
    expect(nomeDespesaMalote({ descricao: "PIONER E TEIXEIRA CONSTRUCOES - MURANO", tipo_lancamento: "sinal" }))
      .toBe("PIONER E TEIXEIRA CONSTRUCOES - MURANO");
  });

  it("conta sem descrição cai em categoria - patrimônio", () => {
    expect(nomeDespesaMalote({ categoria: "Internet", descricao: "" }, "Chácara")).toBe("INTERNET - CHÁCARA");
    expect(nomeDespesaMalote({})).toBe("DESPESA");
  });

  it("sai em maiúsculas, como o campo do Malote", () => {
    expect(nomeDespesaMalote({ descricao: "cee - luz green" })).toBe("CEE - LUZ GREEN");
  });
});
