import { describe, expect, it } from "vitest";
import {
  conciliacaoDaEmpresa, descontosPorCategoria, diferenca, situacaoComparacao, statusGeral, totaisCentrosMalote, totalMaloteDireto, valoresMudaramDesdeDecisao, VALIDACOES,
  type DespesaMalote, type ItemDesconto,
} from "@/pages/controladoria/auditoria/regras";

const sem = { empresaId: null, contratoId: null };
const desp = (o: Partial<DespesaMalote> & { id: string }): DespesaMalote => ({ empresa_id: "E1", contrato_id: null, valor_aprovado: 100, valor_total: 100, parcelado: false, ...o });

describe("status geral", () => {
  it("conta sempre as 7 validações; sem decisão = pendente", () => {
    expect(statusGeral([])).toEqual({ aprovadas: 0, pendentes: 7, rejeitadas: 0, total: 7 });
    const r = statusGeral([
      { tipo: "malote_fluxo", status: "aprovado" },
      { tipo: "fluxo_extrato", status: "aprovado" },
      { tipo: "faturado", status: "rejeitado" },
      { tipo: "recebido", status: "pendente" },
    ]);
    expect(r).toEqual({ aprovadas: 2, pendentes: 4, rejeitadas: 1, total: 7 });
  });
  it("catálogo tem as 7 validações do chamado", () => {
    expect(VALIDACOES.map((v) => v.numero)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("comparação", () => {
  it("diferença em valor e percentual sobre o primeiro total", () => {
    expect(diferenca({ a: 1000, b: 900 })).toEqual({ valor: 100, percentual: 0.1 });
    expect(diferenca({ a: 0, b: 50 }).percentual).toBeNull();
  });
  it("validação 'igual' diverge acima da tolerância; 'livre' é só informativa", () => {
    const igual = { comparacao: "igual" as const };
    const livre = { comparacao: "livre" as const };
    expect(situacaoComparacao(igual, { a: 100, b: 100.5 })).toBe("confere");
    expect(situacaoComparacao(igual, { a: 100, b: 90 })).toBe("diverge");
    expect(situacaoComparacao(livre, { a: 100, b: 10 })).toBe("informativo");
  });
  it("aprovação perde o sentido quando os totais mudam depois", () => {
    expect(valoresMudaramDesdeDecisao({ a: 100, b: 50 }, { a: 100, b: 50.4 })).toBe(false);
    expect(valoresMudaramDesdeDecisao({ a: 100, b: 50 }, { a: 100, b: 80 })).toBe(true);
    expect(valoresMudaramDesdeDecisao(null, { a: 1, b: 1 })).toBe(false);
  });
});

describe("totalMaloteDireto", () => {
  it("soma despesa sem rateio, rateio por linha e parcela proporcional ao rateio", () => {
    const rateios = [
      { despesa_id: "R", empresa_id: "E1", contrato_id: "C1", valor: 60 },
      { despesa_id: "R", empresa_id: "E2", contrato_id: "C2", valor: 40 },
      { despesa_id: "P", empresa_id: "E1", contrato_id: "C1", valor: 300 },
      { despesa_id: "P", empresa_id: "E2", contrato_id: "C2", valor: 100 },
    ];
    const naoParceladas = [desp({ id: "S", valor_aprovado: 25 }), desp({ id: "R", valor_aprovado: 100 })];
    const dParcelada = desp({ id: "P", parcelado: true, valor_total: 400 });
    const parcelas = [{ despesa_id: "P", valor: 200 }];
    expect(totalMaloteDireto(naoParceladas, parcelas, [dParcelada], rateios, sem)).toBe(25 + 100 + 200);
    // Filtro de empresa: só as linhas daquela empresa (rateio entre empresas).
    expect(totalMaloteDireto(naoParceladas, parcelas, [dParcelada], rateios, { empresaId: "E2", contratoId: null })).toBe(40 + 50);
    expect(totalMaloteDireto(naoParceladas, parcelas, [dParcelada], rateios, { empresaId: null, contratoId: "C1" })).toBe(60 + 150);
  });
});

describe("descontosPorCategoria", () => {
  const item = (o: Partial<ItemDesconto>): ItemDesconto => ({
    faltas: 0, posto_nao_implementado: 0, multas: 0, glosas: 0, outros_descontos: 0,
    multas_pos_emissao: 0, glosas_pos_emissao: 0, outros_descontos_pos_emissao: 0, vlr_materiais: 0, total_descontos: 0, ...o,
  });
  it("agrupa por categoria, mostra pós-emissão à parte (não soma) e não soma materiais no total", () => {
    const r = descontosPorCategoria([
      item({ faltas: 10, multas: 5, multas_pos_emissao: 5, glosas_pos_emissao: 20, vlr_materiais: 999, total_descontos: 15 }),
      item({ posto_nao_implementado: 30, outros_descontos: 15, total_descontos: 45 }),
    ]);
    const v = (rotulo: string) => r.categorias.find((c) => c.rotulo.startsWith(rotulo))!.valor;
    expect(v("Faltas")).toBe(10);
    expect(v("Multas")).toBe(5);
    expect(v("Glosas")).toBe(0);
    expect(v("Descontos pós-emissão")).toBe(25);
    expect(v("Postos")).toBe(30);
    expect(v("Outros")).toBe(15);
    expect(v("Materiais")).toBe(999);
    expect(r.totalCategorias).toBe(60);
    expect(r.totalDescontado).toBe(60);
  });
});

describe("conciliação por empresa", () => {
  it("sem filtro vale tudo; com filtro, só a que cobre a empresa", () => {
    expect(conciliacaoDaEmpresa({ id: "1", empresa_ids: ["A"], todas_empresas: false }, null)).toBe(true);
    expect(conciliacaoDaEmpresa({ id: "1", empresa_ids: ["A"], todas_empresas: false }, "B")).toBe(false);
    expect(conciliacaoDaEmpresa({ id: "1", empresa_ids: [], todas_empresas: true }, "B")).toBe(true);
  });
});

describe("centros de custo x malote (centro de custo = contrato)", () => {
  const tipos = new Map<string, string | null>([["ADM", "administrativo"], ["CT", "contrato"], ["SEM", null]]);
  const l = (valor: number, contrato_id: string | null, classificacao_id: string | null, empresa_id = "E1") => ({ valor, contrato_id, classificacao_id, empresa_id });
  it("contrato e administrativo contam como centro; o resto é pendência", () => {
    const linhas = [l(100, "C1", "CT"), l(50, null, "ADM"), l(30, null, "CT"), l(20, null, "SEM"), l(5, null, null)];
    expect(totaisCentrosMalote(linhas, tipos, sem)).toEqual({ total: 205, comContrato: 100, administrativo: 50, pendente: 55 });
  });
  it("filtra por empresa e por contrato (sem contrato some quando o contrato é filtrado)", () => {
    const linhas = [l(100, "C1", "CT"), l(50, null, "ADM", "E2")];
    expect(totaisCentrosMalote(linhas, tipos, { empresaId: "E2", contratoId: null }).administrativo).toBe(50);
    expect(totaisCentrosMalote(linhas, tipos, { empresaId: null, contratoId: "C1" })).toEqual({ total: 100, comContrato: 100, administrativo: 0, pendente: 0 });
  });
});
