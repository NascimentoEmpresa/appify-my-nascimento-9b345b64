import { describe, it, expect } from "vitest";
import { caminhoComprovante, comprovantesDaDespesa, numerosCnjDe, resumoPagamentos, rotuloStatusMalote, type PagamentoMalote } from "@/lib/juridico/comprovantes";

// Comprovantes do processo (18/09/2026, mig 193): o vínculo automático é pelo
// número CNJ no texto da despesa do Malote — o regex daqui é o mesmo do banco.
const desp = (x: Partial<PagamentoMalote>): PagamentoMalote => ({
  despesa_id: "d1", numero: "DM-2026-0001", nome: "", status: "despesa_paga", valor_total: 100, valor_aprovado: null, data_pagamento: null, pago_em: null,
  forma_pagamento: null, comprovante_path: null, observacao_pagamento: null, origem: "malote_auto", vinculo_id: null, parcelas: [], ...x,
});

describe("comprovantes do processo", () => {
  it("acha o número CNJ no nome da despesa, como o Financeiro lança", () => {
    expect(numerosCnjDe("ACORDO PARCELA 6 DE 8 DALTON ROGERIO PROCESSO 0020268-73.2025.5.04.0451")).toEqual(["0020268-73.2025.5.04.0451"]);
    expect(numerosCnjDe("GUIA DE DEPOSITO PROCESSO Nº 0020430-16.2024.5.04.0124 FERNANDA e 0020430-16.2024.5.04.0124 de novo")).toEqual(["0020430-16.2024.5.04.0124"]);
    expect(numerosCnjDe("Reembolso REEMB-202609-0043")).toEqual([]);
    expect(numerosCnjDe(null)).toEqual([]);
  });
  it("lista o comprovante da despesa e os das parcelas", () => {
    const d = desp({ comprovante_path: "a/x.pdf", parcelas: [
      { numero_parcela: 1, valor: 50, data_vencimento: null, status: "paga", comprovante_path: "a/p1.pdf", pago_em: null, data_pagamento_real: null },
      { numero_parcela: 2, valor: 50, data_vencimento: null, status: "aberta", comprovante_path: null, pago_em: null, data_pagamento_real: null },
    ] });
    expect(comprovantesDaDespesa(d).map(c => c.rotulo)).toEqual(["Comprovante", "Parcela 1"]);
    expect(comprovantesDaDespesa(desp({}))).toEqual([]);
  });
  it("resumo: pagos, total pago (valor aprovado manda) e quantos têm comprovante", () => {
    const r = resumoPagamentos({ numero_processo: "x", malote: [
      desp({ status: "despesa_paga", valor_total: 100, valor_aprovado: 90, comprovante_path: "a" }),
      desp({ despesa_id: "d2", status: "aguardando_pagamento", valor_total: 200 }),
    ], anexos: [{ id: 1, processo_id: 1, nome: "guia.pdf", storage_path: "1/guia.pdf", tipo: null, tamanho: null, descricao: null, valor: null, data_pagamento: null, criado_por_nome: null, created_at: "2026-09-18" }] });
    expect(r).toMatchObject({ despesas: 2, pagos: 1, totalPago: 90, comComprovante: 2, anexos: 1, total: 3 });
    expect(resumoPagamentos(null).total).toBe(0);
  });
  it("status do Malote em português", () => {
    expect(rotuloStatusMalote("despesa_paga").texto).toBe("Pago");
    expect(rotuloStatusMalote("aguardando_pagamento").texto).toBe("Aguardando pagamento");
    expect(rotuloStatusMalote("coisa_nova").texto).toBe("coisa nova");
  });
  it("caminho do anexo avulso: pasta do processo, nome seguro", () => {
    expect(caminhoComprovante(411, "guia depósito.pdf", 7)).toBe("411/7_guia_deposito.pdf");
  });
});
