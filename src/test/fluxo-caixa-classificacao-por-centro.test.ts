// SIS-2026-0868: o filtro Classificação do Fluxo de Caixa só oferece as classificações dos centros de custo escolhidos.
import { describe, expect, it } from "vitest";
import { FILTRO_SEM_VALOR, classificacoesDoFiltro, manterSelecionadasDisponiveis } from "@/pages/financeiro/fluxo-caixa/filtrosMultiplos";

const cota = (contratoId: string | null, classificacaoId: string, classificacaoNome: string) => ({ contratoId, classificacaoId, classificacaoNome });

const linhas = [
  // INVESTIMENTOS: consórcio e financiamento
  { tipo: "saida", contrato_id: "inv", contrato_nome: "INVESTIMENTOS AGPS", classificacao_id: "cons", classificacao_nome: "CONSÓRCIOS", cotasClassificacao: [cota("inv", "cons", "CONSÓRCIOS")] },
  { tipo: "saida", contrato_id: "inv", contrato_nome: "INVESTIMENTOS AGPS", classificacao_id: "fin", classificacao_nome: "FINANCIAMENTOS", cotasClassificacao: [cota("inv", "fin", "FINANCIAMENTOS")] },
  // ADMINISTRATIVO: VT e VA
  { tipo: "saida", contrato_id: "adm", contrato_nome: "ADMINISTRATIVO", classificacao_id: "vt", classificacao_nome: "VT", cotasClassificacao: [cota("adm", "vt", "VT")] },
  { tipo: "saida", contrato_id: "adm", contrato_nome: "ADMINISTRATIVO", classificacao_id: "va", classificacao_nome: "VA", cotasClassificacao: [cota("adm", "va", "VA")] },
  // Entrada em INVESTIMENTOS
  { tipo: "entrada", contrato_id: "inv", contrato_nome: "INVESTIMENTOS AGPS", classificacao_id: "resg", classificacao_nome: "RESGATE", cotasClassificacao: [cota("inv", "resg", "RESGATE")] },
  // Rateio entre ADMINISTRATIVO (telefonia) e OBRA (uniformes)
  {
    tipo: "saida", contrato_id: null, contrato_nome: "Rateio", classificacao_id: null, classificacao_nome: "Rateio",
    rateioDetalhe: [{ id: "adm", nome: "ADMINISTRATIVO", valor: 50 }, { id: "obra", nome: "OBRA", valor: 50 }],
    cotasClassificacao: [cota("adm", "tel", "TELEFONIA"), cota("obra", "unif", "UNIFORMES")],
  },
  // Sem centro de custo
  { tipo: "saida", contrato_id: null, contrato_nome: null, classificacao_id: "tarifa", classificacao_nome: "TARIFAS BANCARIAS", cotasClassificacao: [cota(null, "tarifa", "TARIFAS BANCARIAS")] },
];

const nomes = (r: [string, string][]) => r.map(([, n]) => n);

describe("classificacoesDoFiltro", () => {
  it("sem centro escolhido, lista todas (inclusive as de dentro do rateio)", () => {
    expect(nomes(classificacoesDoFiltro(linhas, [], []))).toEqual(
      ["CONSÓRCIOS", "FINANCIAMENTOS", "RESGATE", "TARIFAS BANCARIAS", "TELEFONIA", "UNIFORMES", "VA", "VT"],
    );
  });

  it("com INVESTIMENTOS, não aparece VT/VA (chamado SIS-2026-0868)", () => {
    expect(nomes(classificacoesDoFiltro(linhas, [], ["inv"]))).toEqual(["CONSÓRCIOS", "FINANCIAMENTOS", "RESGATE"]);
  });

  it("combina com o Tipo", () => {
    expect(nomes(classificacoesDoFiltro(linhas, ["saida"], ["inv"]))).toEqual(["CONSÓRCIOS", "FINANCIAMENTOS"]);
  });

  it("rateio: só a classificação da cota do centro escolhido", () => {
    expect(nomes(classificacoesDoFiltro(linhas, [], ["obra"]))).toEqual(["UNIFORMES"]);
    expect(nomes(classificacoesDoFiltro(linhas, [], ["adm"]))).toEqual(["TELEFONIA", "VA", "VT"]);
  });

  it("'Sem centro de custo' traz as classificações das linhas sem centro", () => {
    expect(nomes(classificacoesDoFiltro(linhas, [], [FILTRO_SEM_VALOR]))).toEqual(["TARIFAS BANCARIAS"]);
    expect(nomes(classificacoesDoFiltro(linhas, [], [FILTRO_SEM_VALOR, "obra"]))).toEqual(["TARIFAS BANCARIAS", "UNIFORMES"]);
  });

  it("ao trocar o centro, a classificação que não existe nele sai da seleção", () => {
    const disponiveis = classificacoesDoFiltro(linhas, [], ["inv"]);
    expect(manterSelecionadasDisponiveis(["vt", "cons", FILTRO_SEM_VALOR], disponiveis)).toEqual(["cons", FILTRO_SEM_VALOR]);
  });
});
