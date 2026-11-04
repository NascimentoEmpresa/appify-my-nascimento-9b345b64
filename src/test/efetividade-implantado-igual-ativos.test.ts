import { describe, expect, it } from "vitest";
import { chaveContrato, implantadoPorFilial, totalImplantado, type ImplantadoContrato } from "@/lib/efetividade";

// Chamado da Operação (04/11/2026): "o Painel de efetividade do dia não bate
// com o Ativos/Contratos [...] o que deve aparecer para os supervisores é o
// implantado". O banco devolve uma linha por contrato (mig 20261104001300);
// a Efetividade, que é por filial da Senior, soma os contratos da filial.

const c = (o: Partial<ImplantadoContrato> & { contrato: string }): ImplantadoContrato => ({
  empresa: 1, filial: 10, contrato_id: o.contrato, com_planilha: true, previsto: 0, implantado: 0, tem: 0, ...o,
});

describe("implantado da Efetividade = o do Ativos/Contratos", () => {
  it("dois contratos na mesma filial: soma os dois (antes o menor sumia)", () => {
    const m = implantadoPorFilial([
      c({ contrato: "UFRGS LIMPEZA", previsto: 303, implantado: 300, tem: 295 }),
      c({ contrato: "UFRGS COPA", previsto: 12, implantado: 12, tem: 13 }),
    ]);
    const f = m.get(chaveContrato(1, 10))!;
    expect(f.implantado).toBe(312);
    expect(f.previsto).toBe(315);
    expect(f.tem).toBe(308);
    expect(f.saldo).toBe(-4);
    expect(f.contratos.map((x) => x.nome)).toEqual(["UFRGS LIMPEZA", "UFRGS COPA"]);
  });

  it("filiais diferentes ficam separadas", () => {
    const m = implantadoPorFilial([
      c({ contrato: "A", implantado: 5, previsto: 5 }),
      c({ contrato: "B", filial: 11, implantado: 7, previsto: 8 }),
    ]);
    expect(m.get(chaveContrato(1, 10))!.implantado).toBe(5);
    expect(m.get(chaveContrato(1, 11))!.implantado).toBe(7);
  });

  it("o total bate com o KPI do Ativos: inclui contrato sem ninguém ativo (sem filial)", () => {
    const lista = [
      c({ contrato: "A", previsto: 10, implantado: 8, tem: 7 }),
      c({ contrato: "Novo, ninguém admitido", empresa: null, filial: null, previsto: 4, implantado: 4, tem: 0 }),
      // Contrato só com gente, sem planilha: fora do total (no Ativos também).
      c({ contrato: "Sem planilha", filial: 12, com_planilha: false, tem: 9 }),
    ];
    expect(totalImplantado(lista)).toEqual({ previsto: 14, implantado: 12, tem: 7, saldo: -5 });
    // Sem filial não aparece em nenhuma linha do painel.
    expect([...implantadoPorFilial(lista).keys()]).toEqual([chaveContrato(1, 10)]);
  });

  it("com filtro, o total é só o das filiais visíveis", () => {
    const lista = [
      c({ contrato: "A", implantado: 10, previsto: 10, tem: 10 }),
      c({ contrato: "B", filial: 11, implantado: 3, previsto: 3, tem: 1 }),
      c({ contrato: "C", empresa: null, filial: null, implantado: 2, previsto: 2 }),
    ];
    expect(totalImplantado(lista, new Set([chaveContrato(1, 11)]))).toEqual({ previsto: 3, implantado: 3, tem: 1, saldo: -2 });
  });

  it("supervisor vê o implantado; sem registro da Licitação, o implantado é o previsto", () => {
    const m = implantadoPorFilial([c({ contrato: "A", previsto: 6, implantado: undefined, tem: 6 })]);
    expect(m.get(chaveContrato(1, 10))!.implantado).toBe(6);
  });

  it("banco antigo (sem 'tem' nem 'com_planilha'): mostra o implantado, tem/saldo ficam vazios", () => {
    const antigo = { empresa: 1, filial: 10, contrato_id: "x", contrato: "A", previsto: 9, implantado: 8 } as ImplantadoContrato;
    const f = implantadoPorFilial([antigo]).get(chaveContrato(1, 10))!;
    expect(f.implantado).toBe(8);
    expect(f.tem).toBeNull();
    expect(f.saldo).toBeNull();
    expect(totalImplantado([antigo])).toEqual({ previsto: 9, implantado: 8, tem: null, saldo: null });
  });
});
