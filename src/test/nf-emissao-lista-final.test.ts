// SIS-2026-0671: Lista final da Emissão de NF (regras puras).
import { describe, expect, it } from "vitest";
import {
  competenciaInicialDaLista, conferenciaDoMes, entraNosTotais, linhaDaLista, problemasParaEnviar, totaisDaLista,
  type ItemDaLista, type NfDaLista,
} from "@/pages/financeiro/nf-emissao/listaFinal";

const nf = (o: Partial<NfDaLista> = {}): NfDaLista => ({
  id: Math.random().toString(36).slice(2), variacao: "Limpeza", competencia: "2026-08-01", numero_nf: "1", data_emissao: "2026-09-09",
  tipo_nota: "N", status: "rascunho", descricao: "Serviços de limpeza", valor_contrato_exec_total: 1000, vlr_bruto_total: 1000,
  vlr_liquido_total: 900, issqn_total: 20, inss_total: 50, ir_total: 10, cofins_total: 0, pis_total: 0, csll_total: 20, desconto_conta_vinculada: 0, ...o,
});
const item = (o: Partial<ItemDaLista> = {}): ItemDaLista => ({
  nf_emissao_id: "x", identificacao: "Posto 1", faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
  multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0, ...o,
});

describe("linha da lista", () => {
  it("soma retenções e os descontos dos itens, separando antes e depois da emissão", () => {
    const l = linhaDaLista(nf(), [
      item({ faltas: 30, multas: 10, glosas: 5, multas_pos_emissao: 7 }),
      item({ faltas: 20, posto_nao_implementado: 100, outros_descontos: 2, glosas_pos_emissao: 3 }),
    ]);
    expect(l.retencoes).toBe(100);
    expect(l.faltas).toBe(50);
    expect(l.postoNaoImplementado).toBe(100);
    expect(l.descontosAntes).toBe(17);
    expect(l.descontosDepois).toBe(10);
  });
});

describe("totais", () => {
  it("cancelada e substituída aparecem mas não entram nos totais", () => {
    const linhas = [
      linhaDaLista(nf({ valor_contrato_exec_total: 500 }), []),
      linhaDaLista(nf({ valor_contrato_exec_total: 300 }), []),
      linhaDaLista(nf({ valor_contrato_exec_total: 999, status: "cancelada" }), []),
      linhaDaLista(nf({ valor_contrato_exec_total: 888, situacao_dominio: "SUBSTITUIDA" }), []),
    ];
    const t = totaisDaLista(linhas);
    expect(t.exec).toBe(800);
    expect(t.notas).toBe(2);
    expect(entraNosTotais(linhas[2].nf)).toBe(false);
    expect(entraNosTotais(linhas[3].nf)).toBe(false);
  });
});

describe("conferência com o executável", () => {
  const linhas = [
    linhaDaLista(nf({ variacao: "Limpeza A", valor_contrato_exec_total: 600 }), []),
    linhaDaLista(nf({ variacao: "Copa", valor_contrato_exec_total: 300 }), []),
    linhaDaLista(nf({ variacao: "Avulsa", tipo_nota: "A", valor_contrato_exec_total: 5000 }), []), // outro código: não conta
  ];

  it("diferença = executável − emitido nas NFs Código N; lista as variações do modelo sem NF", () => {
    const c = conferenciaDoMes(linhas, 1000, ["Limpeza A", "Copa", "Turismo", null]);
    expect(c.emitido).toBe(900);
    expect(c.diferenca).toBe(100);
    expect(c.variacoesSemNf).toEqual(["Turismo", "(sem nome)"]);
  });

  it("emitido acima do executável dá diferença negativa", () => {
    expect(conferenciaDoMes(linhas, 800, []).diferenca).toBe(-100);
  });
});

describe("o que impede enviar", () => {
  it("NF completa pode ir", () => {
    expect(problemasParaEnviar(nf(), [item()])).toEqual([]);
  });
  it("exige data de emissão, descrição sem variáveis e itens", () => {
    expect(problemasParaEnviar(nf({ data_emissao: null }), [item()])).toContain("Sem data de emissão.");
    expect(problemasParaEnviar(nf({ descricao: "Ref. a {competencia}" }), [item()])).toContain("A descrição ainda tem variáveis {…} sem preencher.");
    expect(problemasParaEnviar(nf(), [])).toContain("Sem itens.");
  });
  it("multa, glosa e outros descontos pedem justificativa (SIS-2026-0578)", () => {
    const p = problemasParaEnviar(nf(), [item({ multas: 10, glosas: 5 })]);
    expect(p).toEqual(["Falta a justificativa das multas (Posto 1).", "Falta a justificativa das glosas (Posto 1)."]);
    expect(problemasParaEnviar(nf(), [item({ multas: 10, justificativa_multas: "Ofício 12" })])).toEqual([]);
  });
  it("só rascunho é enviável", () => {
    expect(problemasParaEnviar(nf({ status: "enviada" }), [item()])).toEqual(["Já foi enviada ao Financeiro."]);
  });
});

describe("competência ao abrir", () => {
  it("prefere a mais recente com rascunho; senão a mais recente; senão a sugerida", () => {
    const n = [{ competencia: "2026-07-01", status: "rascunho" as const }, { competencia: "2026-09-01", status: "concluida" as const }, { competencia: "2026-08-01", status: "rascunho" as const }];
    expect(competenciaInicialDaLista(n, "2026-10")).toBe("2026-08");
    expect(competenciaInicialDaLista(n.filter((x) => x.status !== "rascunho"), "2026-10")).toBe("2026-09");
    expect(competenciaInicialDaLista([], "2026-10")).toBe("2026-10");
  });
});
