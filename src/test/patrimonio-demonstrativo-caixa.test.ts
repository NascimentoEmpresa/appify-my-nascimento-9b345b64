// SIS-2026-0939 — importação do demonstrativo da CAIXA (PDF). Texto FICTÍCIO
// no layout do "Documento Descritivo do Crédito" (como o pdf.js entrega,
// uma linha por posição vertical): contrato, valores e nomes inventados.
import { describe, it, expect } from "vitest";
import {
  lerDemonstrativoCaixa, planejarDemonstrativo, montarGravacao, parcelasDoContrato, financiamentoDestino,
  compararContrato, payloadDoContrato, observacoesComDemonstrativo, linhasDoDemonstrativo, itensDeEventos,
  chaveEvento, chaveDecisao, chavesDivergentes, dataCaixa, sistemaCurto, lerItemEvento,
} from "@/pages/juridico/patrimonio/demonstrativoCaixa";
import type { ParcelaFinanciamento } from "@/pages/juridico/patrimonio/financiamento";

const TEXTO = `=== PAGINA 1
CAIXA ECONOMICA FEDERAL (HABITACAO) #EXTERNO.CONFIDENCIAL
Agência de Origem: 1234 - AG EXEMPLO / RS / RS pag. 1
Documento Descritivo do Crédito - Portabilidade - Resolução CMN nº 5.057/2022
Data de Referência: 15/03/2025 Contrato: 9990001112223
Dados Devedor
Devedor CPF
FULANO DE TAL EXEMPLO 000.000.000-00
Dados do Financiamento
Produto: 901 - SFH Taxa de Juros Anual Nominal: 8,5000 Prazo de Amortização Contratado: 6
Sistema de Amortização: SAC-SISTEMA DE AMORTIZACAO CONSTANTE NOVO Taxa de Juros Anual Efetiva: 8,8390 Prazo de Amortização Remanescente: 3
Data de vencimento da última parcela do contrato: 10/06/2025 Custo Efetivo Total (CET): * 9,40 Saldo Devedor Perda Renda FGHAB: 0,00
Indexador: TR TR Funding: 15 - SBPE
Utilização de FGTS para pagamento de parte do valor das prestações
Qtd. Cotas Contratadas Quantidade de parcelas FGTS remanescente Valor de FGTS não utilizado do total sacado Percentual utilizado (%)
0 0 0,00 0,00
Dados da Evolução
N° Data Data Seguros / Valor FGTS Valores da Diferença de Atualização Índice de
Amortização Juros MPI DFI Taxas Valor FCVS Encargo líquido Valor devido Valor Pago Saldo devedor
Enc Vencimento Pagamento FGHAB utilizado impontualidade valor monetária correção
Taxa de Juros
01/12/2024 INCLUSAO DE FINANCIAMENTO A PESSOA FISICA 00/00/000 0,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00 0,0000 0,00 0,00 0,00 Valor do evento: 0,00 60.000,00 0,00 0,00 Saldo após: 0,00 0
reduzida:
1 10/01/2025 10/01/2025 1.000,00 425,00 10,00 5,00 15,00 25,00 0,00 0,00 1.465,00 0,00 1.465,00 1.465,00 0,00 0,00 59.000,00 0
2 10/02/2025 20/02/2025 1.000,00 418,00 10,00 5,00 15,00 25,00 0,00 0,00 1.458,00 12,34 1.470,34 1.470,34 0,00 0,00 58.050,00 1,00083099
Taxa de Juros
20/02/2025 MUDANCA DIA DE VENC DA PRESTACAO 00/00/000 0,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00 0,00 0,0000 0,00 0,00 0,00 0,00 0,00 0,00 0
reduzida:
=== PAGINA 2
CAIXA ECONOMICA FEDERAL (HABITACAO) pag. 2
Contrato: 9990001112223 - FULANO DE TAL EXEMPLO
3 10/03/2025 00/00/000 1.000,00 411,00 9,90 5,00 14,90 25,00 0,00 0,00 1.450,90 0,00 1.450,90 0,00 1.450,90 0,00 57.050,00 0
4 10/04/2025 00/00/000 1.000,00 404,00 9,80 5,00 14,80 25,00 0,00 0,00 1.443,80 0,00 1.443,80 0,00 0,00 0,00 56.050,00 0
5 10/05/2025 00/00/000 1.000,00 397,00 9,70 5,00 14,70 25,00 0,00 0,00 1.436,70 0,00 1.436,70 0,00 0,00 0,00 55.050,00 0
6 10/06/2025 00/00/000 1.000,00 390,00 9,60 5,00 14,60 25,00 0,00 0,00 1.429,60 0,00 1.429,60 0,00 0,00 0,00 54.050,00 0
Alô CAIXA: SAC CAIXA: Pessoas com deficiência auditiva ou de fala: Ouvidoria:
Emitente: X000000 Data de Emissão: 15/03/2025`;

describe("leitura do demonstrativo CAIXA", () => {
  const d = lerDemonstrativoCaixa(TEXTO);

  it("lê os dados gerais do contrato", () => {
    expect(d.contrato).toMatchObject({
      numero_contrato: "9990001112223", credor: "CAIXA", devedor: "FULANO DE TAL EXEMPLO",
      data_referencia: "2025-03-15", data_emissao: "2025-03-15", produto: "901 - SFH",
      sistema_amortizacao: "SAC", taxa_juros_nominal_aa: 8.5, taxa_juros_efetiva_aa: 8.839, cet_aa: 9.4,
      prazo_meses: 6, prazo_remanescente_meses: 3, data_ultima_parcela: "2025-06-10",
      saldo_perda_renda_fghab: 0, indexador: "TR", funding: "15 - SBPE",
      cotas_fgts_contratadas: 0, parcelas_fgts_remanescentes: 0, fgts_nao_utilizado: 0, percentual_fgts_utilizado: 0,
    });
    expect(d.contrato.agencia).toBe("1234 - AG EXEMPLO / RS / RS");
    expect(d.avisos).toEqual([]);
  });

  it("lê todas as parcelas com os 16 valores na ordem das colunas", () => {
    expect(d.parcelas.map(p => p.numero)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d.parcelas[1]).toMatchObject({
      numero: 2, vencimento: "2025-02-10", data_pagamento: "2025-02-20",
      amortizacao: 1000, juros: 418, seguro_mip: 10, seguro_dfi: 5, seguros_fghab: 15, taxas: 25,
      valor_fcvs: 0, fgts_utilizado: 0, encargo_liquido: 1458, valor_impontualidade: 12.34, valor: 1470.34,
      valor_pago: 1470.34, diferenca_valor: 0, atualizacao_monetaria: 0, saldo_devedor: 58050, indice_correcao: 1.00083099,
    });
    // Índice "0" do documento = sem correção, não fator zero.
    expect(d.parcelas[0].indice_correcao).toBeNull();
  });

  it("classifica paga × vencida em aberto × futura pela data de referência", () => {
    expect(d.parcelas.map(p => p.classe)).toEqual(["paga", "paga", "vencida", "futura", "futura", "futura"]);
  });

  it("eventos não viram parcela e trazem valor do evento", () => {
    expect(d.eventos).toHaveLength(2);
    expect(d.eventos[0]).toMatchObject({ data: "2024-12-01", descricao: "INCLUSAO DE FINANCIAMENTO A PESSOA FISICA", valor_evento: 60000, taxa_juros_reduzida: 0 });
    expect(d.eventos[1]).toMatchObject({ data: "2025-02-20", descricao: "MUDANCA DIA DE VENC DA PRESTACAO", valor_evento: null, saldo_apos: null });
  });

  it("avisa linha de parcela incompleta e parcela que faltou", () => {
    const quebrado = TEXTO.replace(/^4 10\/04\/2025 .*$/m, "4 10/04/2025 00/00/000 1.000,00 404,00");
    const r = lerDemonstrativoCaixa(quebrado);
    expect(r.parcelas.map(p => p.numero)).toEqual([1, 2, 3, 5, 6]);
    expect(r.avisos.join(" ")).toMatch(/parcela 4 com 2 valores/);
    expect(r.avisos.join(" ")).toMatch(/não lidas no documento: 4/);
    expect(r.avisos.join(" ")).toMatch(/prazo de 6 meses e foram lidas 5/);
  });

  it("recusa o que não é demonstrativo", () => {
    const r = lerDemonstrativoCaixa("Boleto qualquer\nValor 100,00");
    expect(r.parcelas).toEqual([]);
    expect(r.avisos[0]).toMatch(/não parece um demonstrativo/);
  });

  it("datas e sistema", () => {
    expect(dataCaixa("00/00/000")).toBeNull();
    expect(dataCaixa("05/06/2019")).toBe("2019-06-05");
    expect(sistemaCurto("SAC-SISTEMA DE AMORTIZACAO CONSTANTE NOVO")).toBe("SAC");
    expect(sistemaCurto("TABELA PRICE")).toBe("PRICE");
  });
});

describe("casamento com o cadastro (contrato + número)", () => {
  const d = lerDemonstrativoCaixa(TEXTO);
  const existentes: ParcelaFinanciamento[] = [
    // 1: igual em tudo que já tem, sem composição → complementa
    { id: 10, numero: 1, vencimento: "2025-01-10", valor: 1465, financiamento_id: 7 },
    // 2: juros divergente; pagamento já registrado à parte não aparece aqui
    { id: 11, numero: 2, vencimento: "2025-02-10", valor: 1470.34, juros: 400, financiamento_id: 7, data_pagamento: "2025-02-20", valor_pago: 1470.34,
      amortizacao: 1000, seguro_mip: 10, seguro_dfi: 5, seguros_fghab: 15, taxas: 25, valor_fcvs: 0, fgts_utilizado: 0, encargo_liquido: 1458,
      valor_impontualidade: 12.34, diferenca_valor: 0, atualizacao_monetaria: 0, saldo_devedor: 58050, indice_correcao: 1.00083099 },
    // repetida no cadastro: casa com a de menor id
    { id: 13, numero: 3, vencimento: "2025-03-10", financiamento_id: 7 },
    { id: 12, numero: 3, vencimento: "2025-03-10", financiamento_id: 7 },
    // fora do documento
    { id: 20, numero: 99, vencimento: "2030-01-10", financiamento_id: 7 },
  ];
  const plano = planejarDemonstrativo(d, existentes);

  it("conta novas, complementa, divergentes e iguais sem duplicar", () => {
    expect(plano.contagem).toMatchObject({ novas: 3, complementa: 2, divergentes: 1, iguais: 0, camposDivergentes: 1, pagas: 2, vencidas: 1, futuras: 3 });
    expect(plano.parcelas.find(p => p.numero === 3)!.existente!.id).toBe(12);
    expect(plano.repetidasNoCadastro).toEqual([3]);
    expect(plano.foraDoDocumento.map(p => p.id)).toEqual([20]);
  });

  it("divergência só é gravada se aceita; sem decisão fica o valor atual", () => {
    expect(chavesDivergentes(plano.parcelas)).toEqual([chaveDecisao(2, "juros")]);
    const o = { patrimonioId: 1, financiamentoId: 7, autor: "teste", documentoData: "2025-03-15", ordemInicial: 50 };
    const semAceite = montarGravacao(plano, new Set(), o);
    const p2 = semAceite.atualizar.find(l => l.id === 11)!;
    expect(p2.juros).toBe(400);
    const comAceite = montarGravacao(plano, new Set([chaveDecisao(2, "juros")]), o);
    expect(comAceite.atualizar.find(l => l.id === 11)!.juros).toBe(418);
  });

  it("gravação: novas com contrato e ordem; existentes num upsert de colunas iguais e sem tocar pagamentos/anexos", () => {
    const g = montarGravacao(plano, new Set(), { patrimonioId: 1, financiamentoId: 7, autor: "teste", documentoData: "2025-03-15", ordemInicial: 50 });
    expect(g.inserir.map(l => l.numero)).toEqual([4, 5, 6]);
    expect(g.inserir.map(l => l.ordem)).toEqual([51, 52, 53]);
    expect(g.inserir[0]).toMatchObject({ financiamento_id: 7, projetado: true, valor_pago: null, data_pagamento: null, documento_origem: "Demonstrativo CAIXA", seguros_fghab_subtotal: true });
    const chaves = g.atualizar.map(l => Object.keys(l).sort().join(","));
    expect(new Set(chaves).size).toBe(1);
    for (const proibida of ["situacao", "demonstrativo_path", "demonstrativo_nome", "lancamento_financeiro", "detalhes", "origem", "ordem"]) {
      expect(chaves[0].split(",")).not.toContain(proibida);
    }
    const p1 = g.atualizar.find(l => l.id === 10)!;
    expect(p1).toMatchObject({ juros: 425, amortizacao: 1000, projetado: false, indice_tipo: null });
  });

  it("parcela não paga não grava pago 0 nem a diferença que repete o devido", () => {
    const g = montarGravacao(plano, new Set(), { patrimonioId: 1, financiamentoId: 7, autor: "t", documentoData: null, ordemInicial: 0 });
    const p3 = g.atualizar.find(l => l.id === 12)!;
    expect(p3.valor_pago).toBeNull();
    expect(p3.diferenca_valor).toBeNull();
    expect(p3.projetado).toBe(false); // vencida em aberto não é projeção
  });

  it("reimportar o mesmo documento depois de gravado não muda nada", () => {
    const g = montarGravacao(plano, new Set([chaveDecisao(2, "juros")]), { patrimonioId: 1, financiamentoId: 7, autor: "t", documentoData: "2025-03-15", ordemInicial: 50 });
    // O upsert só regrava as colunas que envia: o resto (número…) fica como estava.
    const gravadas = [...g.atualizar.map(l => ({ ...existentes.find(e => e.id === l.id), ...l })), ...g.inserir.map((l, i) => ({ ...l, id: 100 + i }))] as unknown as ParcelaFinanciamento[];
    const de_novo = planejarDemonstrativo(d, gravadas);
    expect(de_novo.contagem).toMatchObject({ novas: 0, divergentes: 0, complementa: 0, iguais: 6 });
  });

  it("parcelas do contrato: as sem contrato vão para o primeiro", () => {
    const todas: ParcelaFinanciamento[] = [{ id: 1, financiamento_id: null }, { id: 2, financiamento_id: 7 }, { id: 3, financiamento_id: 8 }];
    expect(parcelasDoContrato(todas, 7, true).map(p => p.id)).toEqual([1, 2]);
    expect(parcelasDoContrato(todas, 8, false).map(p => p.id)).toEqual([3]);
    expect(parcelasDoContrato(todas, null, true).map(p => p.id)).toEqual([1]);
  });
});

describe("contrato e histórico", () => {
  const d = lerDemonstrativoCaixa(TEXTO);

  it("destino: mesmo nº de contrato; senão o único sem número; senão criar", () => {
    expect(financiamentoDestino([{ id: 1, nome: "Outro" }, { id: 2, observacoes: "[Demonstrativo CAIXA]\nContrato 9990001112223" }], "9990001112223")!.id).toBe(2);
    expect(financiamentoDestino([{ id: 5, nome: "Financiamento da casa" }], "9990001112223")!.id).toBe(5);
    expect(financiamentoDestino([{ id: 5, nome: "Contrato CAIXA 1110002223334" }], "9990001112223")).toBeNull();
    expect(financiamentoDestino([], "9990001112223")).toBeNull();
  });

  it("condições: campo vazio grava, divergente só com aceite", () => {
    const campos = compararContrato({ id: 5, nome: "Financiamento da casa", cet_aa: 9.4, taxa_juros_nominal_aa: 8 }, d.contrato);
    const t = Object.fromEntries(campos.map(c => [c.campo, c.tipo]));
    expect(t).toMatchObject({ cet_aa: "igual", taxa_juros_nominal_aa: "divergente", nome: "divergente", credor: "novo", prazo_meses: "novo" });
    const sem = payloadDoContrato(campos, new Set(), null, d.contrato, "t");
    expect(sem.taxa_juros_nominal_aa).toBeUndefined();
    expect(sem.prazo_meses).toBe(6);
    const com = payloadDoContrato(campos, new Set([chaveDecisao(0, "taxa_juros_nominal_aa")]), null, d.contrato, "t");
    expect(com.taxa_juros_nominal_aa).toBe(8.5);
  });

  it("observações: o bloco do demonstrativo é trocado, não empilhado, e o resto fica", () => {
    const uma = observacoesComDemonstrativo("Nota do jurídico", d.contrato);
    const duas = observacoesComDemonstrativo(uma, d.contrato);
    expect(duas).toBe(uma);
    expect(duas.startsWith("Nota do jurídico")).toBe(true);
    expect(linhasDoDemonstrativo(duas)).toContain("Prazo remanescente: 3 meses");
  });

  it("eventos entram no histórico uma vez só", () => {
    const o = { patrimonioId: 1, financiamentoId: 7, numeroContrato: d.contrato.numero_contrato, autor: "t" };
    const primeira = itensDeEventos(d.eventos, new Set(), o);
    expect(primeira).toHaveLength(2);
    expect(primeira[0]).toMatchObject({ kind: "historico", tipo: "evento_financiamento" });
    expect(lerItemEvento(primeira[0].observacao)).toMatchObject({ financiamento_id: 7, data: "2024-12-01", valor_evento: 60000 });
    const ja = new Set(primeira.map(i => lerItemEvento(i.observacao)!.chave));
    expect(itensDeEventos(d.eventos, ja, o)).toHaveLength(0);
    expect(chaveEvento("1", { data: "2025-01-01", descricao: "a  b" })).toBe(chaveEvento("1", { data: "2025-01-01", descricao: "A B" }));
  });
});
