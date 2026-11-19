import { describe, expect, it } from "vitest";
import {
  pedidoAceitaSolicitacaoCancelamento,
  rotuloCategoriaCancelamento,
  validarMotivoCancelamento,
} from "@/lib/suprimentos/cancelamentoPedido";
import { anexarCancelamentosDashboard } from "@/lib/suprimentos/dashboardComprasEstoque";

describe("cancelamento de pedido", () => {
  it("aceita solicitação somente antes da retirada ou despacho", () => {
    expect(pedidoAceitaSolicitacaoCancelamento("EM PREPARACAO", "NENHUM")).toBe(true);
    expect(pedidoAceitaSolicitacaoCancelamento("EM SEPARACAO", "RECUSADO")).toBe(true);
    expect(pedidoAceitaSolicitacaoCancelamento("AGUARDANDO ENVIO", "SOLICITADO")).toBe(false);
    expect(pedidoAceitaSolicitacaoCancelamento("RETIRADO PARA ENTREGA", "NENHUM")).toBe(false);
    expect(pedidoAceitaSolicitacaoCancelamento("DESPACHADO", "NENHUM")).toBe(false);
    expect(pedidoAceitaSolicitacaoCancelamento("CANCELADO", "APROVADO")).toBe(false);
  });

  it("exige categoria conhecida e detalhe auditável", () => {
    expect(validarMotivoCancelamento("", "detalhe suficiente")).toContain("Selecione");
    expect(validarMotivoCancelamento("OUTRO", "curto")).toContain("10 caracteres");
    expect(validarMotivoCancelamento("OUTRO", "Motivo explicado corretamente")).toBeNull();
    expect(validarMotivoCancelamento("OUTRO", "x".repeat(1001))).toContain("1000");
  });

  it("traduz as categorias usadas no dashboard", () => {
    expect(rotuloCategoriaCancelamento("DUPLICIDADE")).toBe("Pedido duplicado");
    expect(rotuloCategoriaCancelamento("DESISTENCIA_ADMISSAO")).toBe("Desistência da admissão");
    expect(rotuloCategoriaCancelamento("DESCONHECIDO")).toBe("Outro");
  });

  it("normaliza o resumo de cancelamentos devolvido pelo banco", () => {
    const painel = anexarCancelamentosDashboard({ atualizado_em: "2026-11-19" } as never, {
      total: 3,
      por_motivo: [{ nome: "Pedido incorreto", quantidade: 2 }],
      por_origem: [{ nome: "Encarregado", quantidade: 3 }],
    });
    expect(painel.cancelamentos?.total).toBe(3);
    expect(painel.cancelamentos?.por_motivo).toEqual([{ nome: "Pedido incorreto", quantidade: 2 }]);
  });
});
