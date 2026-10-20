import { describe, expect, it } from "vitest";
import { pendenteHaMaisDe30Dias, pendenteHaMaisDeDias } from "@/pages/financeiro/nf-emissao/shared";
import { LIMITES_PENDENCIA_DIAS, rotuloPendencia } from "@/pages/financeiro/relatorio-servicos/FiltroPendenciaDias";

const emitidaHa = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nota = (dias: number, o: Record<string, unknown> = {}) => ({ data_emissao: emitidaHa(dias), data_pagamento: null, ...o });

describe("SIS-2026-0690 · pendente há mais de N dias", () => {
  it("as opções são 30, 60, 90 e 120, com o rótulo pedido", () => {
    expect([...LIMITES_PENDENCIA_DIAS]).toEqual([30, 60, 90, 120]);
    expect(rotuloPendencia(90)).toBe("Pendente há mais de 90 dias");
  });

  it("vale 'acima do limite': 60 também traz as de 90 e 120", () => {
    const notas = [nota(20), nota(45), nota(75), nota(100), nota(150)];
    const pega = (limite: number) => notas.filter((n) => pendenteHaMaisDeDias(n, limite)).length;
    expect([30, 60, 90, 120].map(pega)).toEqual([4, 3, 2, 1]);
  });

  it("no limite exato não entra (mais de, não 'a partir de'), igual ao filtro de 30 que já existia", () => {
    expect(pendenteHaMaisDeDias(nota(60), 60)).toBe(false);
    expect(pendenteHaMaisDeDias(nota(61), 60)).toBe(true);
  });

  it("nota paga não é pendência, qualquer que seja a idade", () => {
    expect(pendenteHaMaisDeDias(nota(200, { data_pagamento: "2026-09-01" }), 120)).toBe(false);
  });

  it("o filtro de 30 dias antigo segue igual ao novo com limite 30", () => {
    for (const d of [10, 30, 31, 90]) expect(pendenteHaMaisDe30Dias(nota(d))).toBe(pendenteHaMaisDeDias(nota(d), 30));
  });
});
