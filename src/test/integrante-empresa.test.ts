import { describe, expect, it } from "vitest";
import { comIntegranteEmpresa, INTEGRANTE_EMPRESA_ID } from "@/lib/integranteEmpresa";
import { erroFornecedorNoRateio } from "@/pages/malote/rateioValidacao";
import { planejarTrocaDeIntegrante, type LinhaMassa } from "@/pages/financeiro/fluxo-caixa/alteracaoEmMassa";

// SIS-2026-0873: integrante "Empresa" (ID fixo -1, não existe em EMPREGADOS) no rateio do Malote e no Fluxo de Caixa.
describe("integrante Empresa", () => {
  it("vai para o topo da lista de integrantes, uma vez só", () => {
    const lista = comIntegranteEmpresa([{ id: 10, nome: "ANA" }, { id: INTEGRANTE_EMPRESA_ID, nome: "Empresa" }, { id: 11, nome: "BIA" }]);
    expect(lista.map((i) => i.nome)).toEqual(["Empresa", "ANA", "BIA"]);
    expect(lista[0].id).toBe(-1);
  });
  it("conta como integrante preenchido no rateio do Malote (por isso -1, e não 0)", () => {
    const dims = { fornecedor: false, integrante: true };
    expect(erroFornecedorNoRateio(dims, [{ fornecedor_id: null, integrante_empregado_id: INTEGRANTE_EMPRESA_ID }])).toBeNull();
    expect(erroFornecedorNoRateio(dims, [{ fornecedor_id: null, integrante_empregado_id: null }])).not.toBeNull();
  });
  it("entra na alteração em massa do Fluxo como qualquer integrante", () => {
    const linha = (o: Partial<LinhaMassa>): LinhaMassa => ({
      origem: "malote", despesa_id: "d", numero_parcela: null, empresa_id: "E1", contrato_id: "c1", contrato_nome: "Adm", classificacao_id: "k", classificacao_nome: "Luz",
      integrante_empregado_id: null, qtdLinhasRateio: 1, ...o,
    });
    const r = planejarTrocaDeIntegrante([linha({ despesa_id: "a", integrante_empregado_id: 7 }), linha({ despesa_id: "b", integrante_empregado_id: INTEGRANTE_EMPRESA_ID })], INTEGRANTE_EMPRESA_ID);
    expect(r.aplicar.map((l) => l.despesa_id)).toEqual(["a"]);
    expect(r.ignoradas[0].motivo).toBe("Já está com este integrante");
  });
});
