import { describe, expect, it } from "vitest";
import {
  casarPessoa, lerRelacaoBancaria, montarLote, nomeContratoMalote, nomeDespesaLote, tipoPagina,
  type CandidataLote,
} from "@/lib/rh/loteFerias";

/**
 * Malote em massa da Gestão de Férias (05/11/2026). Os textos abaixo têm o
 * formato exato que o pdf.js tira do lote da Senior ("FERIAS UFRGS MOTORISTAS
 * 034.2022.pdf": relação bancária + um recibo por página), com nome e CPF
 * trocados por fictícios.
 */
const RELACAO = `0001 - NASCIMENTO SERVICOS DE LIMPEZA LTDA Pág.: 1
Relação Bancária
Filial: 1048 UFRGS MOTORISTA - 034.2022
Banco: BANCO MENTORE
Data Pagamento: 06/11/2026
Cadastro Nome Cpf Agência Conta Dg Valor
000005644 FULANO DE TAL DA SILVA 111.222.333-96 00001 000000000000 - 3.346,58
000008018 BELTRANO SOUZA LIMA 444.555.666-01 00001 000000000000 - 4.745,25
Total do Banco: 8.091,83
8.091,83 Total da Filial:
Total Geral da Empresa: 8.091,83
04/11/2026 - 16:53 Total da Página: 8.091,83`;

const recibo = (cad: string, nome: string, cpf: string, inicio: string, prov: string, desc: string, liq: string, extenso: string) => `0001 - NASCIMENTO SERVICOS DE LIMPEZA LTDA Pág.: 1
Recibo de Férias
NASCIMENTO SERVICOS DE LIMPEZA LTDA 03.644.009/0001-23
Empresa: CNPJ:
Cadastro: ${cad} - ${nome} CPF: ${cpf}
Cargo: 0155 - MOTORISTA CAT B
Período Aquisitivo........: 25/10/2025 a 24/10/2026 Número CTPS: 000003877
Período das Férias......: ${inicio} a 08/12/2026 Série CTPS.....: 4 - RS
Retorno ao Trabalho...: 09/12/2026 Dias Férias.....: 30,00
Pagamento do Recibo: 06/11/2026 Dias Abono.....: 0,00
Evento Descrição Referência Proventos Descontos
0005 Horas Férias Diurnas 220,00 2.464,79
2002 INSS Férias 12,00 329,74
Totais...........: ${prov} ${desc}
Líquido.........: ${liq}
Recebi a importância de R$ ${liq} (${extenso} )
referente a quitação das férias.`;

const R1 = recibo("000005644", "FULANO DE TAL DA SILVA", "111.222.333-96", "09/11/2026", "3.676,32", "329,74", "3.346,58",
  "três mil, trezentos e quarenta e seis reais e cinquenta e oito centavos");
const R2 = recibo("000008018", "BELTRANO SOUZA LIMA", "444.555.666-01", "09/11/2026", "5.515,99", "770,74", "4.745,25",
  "quatro mil, setecentos e quarenta e cinco reais e vinte e cinco centavos");

describe("relação bancária", () => {
  it("lê cada linha com cadastro, nome, CPF e valor, e o total fecha", () => {
    const r = lerRelacaoBancaria(RELACAO);
    expect(r.linhas).toEqual([
      { cadastro: "5644", nome: "FULANO DE TAL DA SILVA", cpf: "11122233396", valor: 3346.58 },
      { cadastro: "8018", nome: "BELTRANO SOUZA LIMA", cpf: "44455566601", valor: 4745.25 },
    ]);
    expect(r.totalGeral).toBe(8091.83);
    expect(r.fecha).toBe(true);
    expect(r.dataPagamento).toBe("2026-11-06");
    expect(r.filialNome).toBe("UFRGS MOTORISTA - 034.2022");
    expect(r.empresaCodigo).toBe("1");
  });

  it("soma que não fecha com o Total Geral não vale como prova", () => {
    const r = lerRelacaoBancaria(RELACAO.replace("Total Geral da Empresa: 8.091,83", "Total Geral da Empresa: 8.091,93"));
    expect(r.fecha).toBe(false);
  });

  it("classifica as páginas", () => {
    expect(tipoPagina(RELACAO)).toBe("relacao");
    expect(tipoPagina(R1)).toBe("recibo");
    expect(tipoPagina("Termo de ciência")).toBe("outra");
  });
});

describe("lote — o valor de cada pessoa", () => {
  it("relação + recibo batendo: valor confiável, com a relação entre as provas", () => {
    const lote = montarLote([RELACAO, R1, R2]);
    expect(lote.avisos).toEqual([]);
    expect(lote.pessoas.map((p) => [p.cpf, p.conferencia.valor, p.conferencia.confiavel, p.paginaRecibo])).toEqual([
      ["11122233396", 3346.58, true, 2],
      ["44455566601", 4745.25, true, 3],
    ]);
    expect(lote.pessoas[0].conferencia.provas).toContain("Relação bancária: R$ 3.346,58");
  });

  it("relação pagando valor diferente do recibo: não confia", () => {
    const lote = montarLote([RELACAO.replace("- 3.346,58", "- 3.346,85"), R1, R2]);
    const p = lote.pessoas[0];
    expect(p.conferencia.confiavel).toBe(false);
    expect(p.conferencia.problemas.join(" ")).toMatch(/relação bancária paga R\$ 3\.346,85/);
  });

  it("pessoa na relação sem recibo no arquivo: valor só da relação, RH digita", () => {
    const lote = montarLote([RELACAO, R1]);
    const p = lote.pessoas.find((x) => x.cpf === "44455566601")!;
    expect(p.recibo).toBeNull();
    expect(p.conferencia.valor).toBe(4745.25);
    expect(p.conferencia.confiavel).toBe(false);
  });

  it("recibo sem relação no arquivo: ainda confia pelas provas do próprio recibo", () => {
    const lote = montarLote([R1]);
    expect(lote.avisos[0]).toMatch(/Relação Bancária/);
    expect(lote.pessoas[0].conferencia.confiavel).toBe(true);
  });

  it("recibo com OCR ruim (só o líquido) e relação batendo: uma prova só não basta", () => {
    const ruim = R1.replace(/Totais.*\n/, "").replace(/Recebi a importância.*\n/, "");
    const lote = montarLote([RELACAO, ruim, R2]);
    const p = lote.pessoas[0];
    expect(p.conferencia.valor).toBe(3346.58);
    expect(p.conferencia.confiavel).toBe(false);
  });

  it("a mesma pessoa duas vezes no arquivo: ninguém confere sozinho", () => {
    const lote = montarLote([R1, R1]);
    expect(lote.pessoas.every((p) => !p.conferencia.confiavel)).toBe(true);
  });
});

describe("lote — casar com a solicitação do sistema", () => {
  const cand = (o: Partial<CandidataLote>): CandidataLote => ({
    id: 1, colaborador_id: 10, nome: "FULANO DE TAL DA SILVA", cpf: "111.222.333-96", matricula: "5644",
    data_saida: "2026-11-09", dias_ferias: 30, status: "Aprovada", no_malote: false,
    empresa_id: "e1", contrato_id: "c1", contrato_nome: "UFRGS - MOTORISTAS - 034/2022", ...o,
  });
  const pessoa = () => montarLote([RELACAO, R1, R2]).pessoas[0];

  it("CPF, nome completo e saída batendo: escolhe sozinho", () => {
    const c = casarPessoa(pessoa(), [cand({}), cand({ id: 2, data_saida: "2026-03-02", status: "Aprovada" })]);
    expect(c.solicitacaoId).toBe(1);
    expect(c.bloqueios).toEqual([]);
    expect(c.avisos).toEqual([]);
  });

  it("homônimo com outro CPF não é a pessoa", () => {
    const c = casarPessoa(pessoa(), [cand({ cpf: "999.888.777-66" })]);
    expect(c.solicitacaoId).toBeNull();
    expect(c.bloqueios[0]).toMatch(/outro CPF/);
  });

  it("mesmo CPF com nome diferente: casa, mas pede conferência", () => {
    const c = casarPessoa(pessoa(), [cand({ nome: "FULANO DE TAL SILVA" })]);
    expect(c.solicitacaoId).toBe(1);
    expect(c.avisos[0]).toMatch(/não é igual ao do sistema/);
  });

  it("já no Malote: fica de fora", () => {
    const c = casarPessoa(pessoa(), [cand({ no_malote: true })]);
    expect(c.solicitacaoId).toBeNull();
    expect(c.bloqueios[0]).toMatch(/já estão no Malote/);
  });

  it("duas aprovadas e nenhuma na data do recibo: o RH escolhe", () => {
    const c = casarPessoa(pessoa(), [cand({ data_saida: "2026-12-01" }), cand({ id: 2, data_saida: "2027-01-04" })]);
    expect(c.solicitacaoId).toBeNull();
    expect(c.opcoes.map((o) => o.id)).toEqual([1, 2]);
  });

  it("uma aprovada com outra data: casa com aviso", () => {
    const c = casarPessoa(pessoa(), [cand({ data_saida: "2026-11-16" })]);
    expect(c.solicitacaoId).toBe(1);
    expect(c.avisos[0]).toMatch(/16\/11\/2026/);
  });
});

describe("nome da despesa", () => {
  it("como o RH já nomeia no Malote", () => {
    expect(nomeContratoMalote("1048 - UFRGS - MOTORISTAS - 034/2022")).toBe("UFRGS MOTORISTAS 034.2022");
    expect(nomeDespesaLote(["UFRGS - MOTORISTAS - 034/2022", "UFRGS - MOTORISTAS - 034/2022"], null)).toBe("FERIAS UFRGS MOTORISTAS 034.2022");
    expect(nomeDespesaLote(["A", "B"], "UFRGS MOTORISTA - 034.2022")).toBe("FERIAS UFRGS MOTORISTA 034.2022");
  });
});
