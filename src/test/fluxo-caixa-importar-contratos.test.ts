import { describe, expect, it } from "vitest";
import { casarContratos, lerLinhasPlanilha, erroEhJaNoContrato, type ContratoImportacao, type LinhaFluxoParaImportar } from "@/pages/financeiro/fluxo-caixa/importarContratos";

const contratos: ContratoImportacao[] = [
  { id: "c-adm-hagg", nome: "ADMINISTRATIVO - HAGG", empresa_id: "e-hagg" },
  { id: "c-adm-nh", nome: "ADMINISTRATIVO - NH", empresa_id: "e-nh" },
  { id: "c-est-hagg", nome: "ESTOQUE HAGG", empresa_id: "e-hagg" },
  { id: "c-est-sn", nome: "ESTOQUE SN", empresa_id: "e-sn" },
];

let seq = 0;
const fluxo = (o: Partial<LinhaFluxoParaImportar>): LinhaFluxoParaImportar => ({
  origem: "importacao_historica", despesa_id: `d${++seq}`, id_malote: "IMP-1", data_pagamento: "2026-02-03", tipo: "saida", valor: 3638.2,
  empresa_id: "e-hagg", empresa_nome: "HAGG", contrato_id: null, contrato_nome: null, numero_parcela: null, ...o,
});

const planilha = (o: Record<string, unknown>) => ({
  "Data pagamento": "03/02/2026", Tipo: "Saída", Origem: "Importação (planilha)", "Nº": "IMP-1", Empresa: "HAGG", Contrato: "ESTOQUE HAGG", Parcela: "", Valor: -3638.2, ...o,
});

describe("SIS-2026-0752 — importar contratos preenchidos na planilha do Fluxo", () => {
  it("lê as colunas pelo cabeçalho (data dd/mm/aaaa, tipo, valor assinado, parcela x/y)", () => {
    const [l] = lerLinhasPlanilha([planilha({ Parcela: "2/3", Valor: "-1.234,56" })]);
    expect(l).toMatchObject({ linha: 2, numero: "IMP-1", dataIso: "2026-02-03", tipo: "saida", empresa: "HAGG", valor: -1234.56, parcela: 2, contratoNome: "ESTOQUE HAGG" });
  });

  it("linha totalmente em branco (sobra de linha apagada) é ignorada, sem virar pendência", () => {
    const lidas = lerLinhasPlanilha([planilha({}), { "Data pagamento": "", Tipo: "", Origem: "", "Nº": "", Empresa: "", Contrato: "", Parcela: "", Valor: "" }]);
    expect(lidas).toHaveLength(1);
  });

  it("casa por Nº + data + tipo + empresa + valor e manda atualizar no contrato da planilha", () => {
    const f = fluxo({});
    const r = casarContratos(lerLinhasPlanilha([planilha({})]), [f], contratos);
    expect(r.atualizar).toEqual([{ origem: "importacao_historica", despesaId: f.despesa_id, contratoId: "c-est-hagg", contratoNome: "ESTOQUE HAGG", numero: "IMP-1", linhasPlanilha: [2] }]);
    expect(r.pendencias).toEqual([]);
  });

  it("não sobrescreve contrato já preenchido; igual ao da planilha conta como já feito", () => {
    const ja = fluxo({ contrato_id: "c-est-hagg", contrato_nome: "ESTOQUE HAGG" });
    expect(casarContratos(lerLinhasPlanilha([planilha({})]), [ja], contratos)).toMatchObject({ atualizar: [], jaNoContrato: 1 });
    const outro = fluxo({ contrato_id: "c-adm-hagg", contrato_nome: "ADMINISTRATIVO - HAGG" });
    const r = casarContratos(lerLinhasPlanilha([planilha({})]), [outro], contratos);
    expect(r.atualizar).toEqual([]);
    expect(r.pendencias[0].motivo).toBe("ja_tem_outro_contrato");
  });

  it("contrato que não existe no sistema vira pendência e é contado por nome", () => {
    const r = casarContratos(lerLinhasPlanilha([planilha({ Contrato: "PM FARROUPILHA 327.2021" })]), [fluxo({})], contratos);
    expect(r.atualizar).toEqual([]);
    expect(r.contratosNaoEncontrados).toEqual([{ nome: "PM FARROUPILHA 327.2021", linhas: 1 }]);
  });

  it("nome do contrato ignora acento, caixa e espaço sobrando", () => {
    const r = casarContratos(lerLinhasPlanilha([planilha({ Contrato: "  administrativo  -  hagg " })]), [fluxo({})], contratos);
    expect(r.atualizar[0].contratoId).toBe("c-adm-hagg");
  });

  it("linha sem correspondência no Fluxo, contrato em branco e cartão/aplicação ficam como pendência, sem aplicar", () => {
    const r = casarContratos(
      lerLinhasPlanilha([planilha({ "Nº": "IMP-999" }), planilha({ Contrato: "" }), planilha({ "Nº": "AF-1" })]),
      [fluxo({}), fluxo({ id_malote: "AF-1", origem: "aplicacao_financeira" })],
      contratos,
    );
    expect(r.atualizar).toEqual([]);
    expect(r.pendencias.map((p) => p.motivo)).toEqual(["sem_correspondencia_no_fluxo", "sem_contrato_na_planilha", "origem_sem_suporte"]);
  });

  it("duas linhas idênticas (mesmo Nº e valor, como Compras-25) casam cada uma com uma linha diferente do Fluxo", () => {
    const a = fluxo({ id_malote: "Compras-25", valor: 1280, data_pagamento: "2026-04-28" });
    const b = fluxo({ id_malote: "Compras-25", valor: 1280, data_pagamento: "2026-04-28" });
    const linhas = [planilha({ "Nº": "Compras-25", "Data pagamento": "28/04/2026", Valor: -1280 }), planilha({ "Nº": "Compras-25", "Data pagamento": "28/04/2026", Valor: -1280 })];
    const r = casarContratos(lerLinhasPlanilha(linhas), [a, b], contratos);
    expect(r.atualizar.map((x) => x.despesaId).sort()).toEqual([a.despesa_id, b.despesa_id].sort());
  });

  it("débito automático de transferência (entrada na NH e saída na HAGG, mesmo Nº) casa cada lado com o seu contrato", () => {
    const entrada = fluxo({ origem: "debito_automatico", id_malote: "DA-2026-0012", tipo: "entrada", valor: 5800, empresa_id: "e-nh", empresa_nome: "NH" });
    const saida = fluxo({ origem: "debito_automatico", id_malote: "DA-2026-0012", tipo: "saida", valor: 5800 });
    const linhas = [
      planilha({ "Nº": "DA-2026-0012", Tipo: "Entrada", Empresa: "NH", Valor: 5800, Contrato: "ADMINISTRATIVO - NH" }),
      planilha({ "Nº": "DA-2026-0012", Tipo: "Saída", Empresa: "HAGG", Valor: -5800, Contrato: "ADMINISTRATIVO - HAGG" }),
    ];
    const r = casarContratos(lerLinhasPlanilha(linhas), [entrada, saida], contratos);
    expect(r.atualizar.map((x) => [x.despesaId, x.contratoId])).toEqual([[entrada.despesa_id, "c-adm-nh"], [saida.despesa_id, "c-adm-hagg"]]);
  });

  it("despesa do Malote com várias parcelas: um lançamento só; contratos diferentes para o mesmo lançamento viram pendência", () => {
    const p1 = fluxo({ origem: "malote", despesa_id: "dm1", id_malote: "DM-2026-1", numero_parcela: 1 });
    const p2 = fluxo({ origem: "malote", despesa_id: "dm1", id_malote: "DM-2026-1", numero_parcela: 2, data_pagamento: "2026-03-03" });
    const linhas = [planilha({ "Nº": "DM-2026-1", Parcela: "1/2" }), planilha({ "Nº": "DM-2026-1", Parcela: "2/2", "Data pagamento": "03/03/2026", Contrato: "ESTOQUE SN" })];
    const r = casarContratos(lerLinhasPlanilha(linhas), [p1, p2], contratos);
    expect(r.atualizar).toHaveLength(1);
    expect(r.pendencias.map((p) => p.motivo)).toEqual(["contratos_diferentes_no_mesmo_lancamento"]);
  });

  it("reconhece o erro 'já está neste contrato' como já feito", () => {
    expect(erroEhJaNoContrato("O lançamento já está neste contrato.")).toBe(true);
    expect(erroEhJaNoContrato("Sem permissão")).toBe(false);
  });
});
