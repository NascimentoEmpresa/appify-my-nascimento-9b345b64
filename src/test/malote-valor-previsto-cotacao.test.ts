import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calcularSavingCompra,
  obterValorPrevistoCompra,
} from "@/lib/suprimentos/valorPrevistoCompra";

const migration = readFileSync(
  "supabase/migrations/20261113230000_sis_2026_0818_valor_previsto_cotacao.sql",
  "utf8",
);
const tela = readFileSync(
  "src/pages/suprimentos/CotacaoMaloteDetalhe.tsx",
  "utf8",
);
const lista = readFileSync(
  "src/pages/suprimentos/CotacoesMalote.tsx",
  "utf8",
);

describe("SIS-2026-0818 — valor previsto da cotação", () => {
  it("preserva a previsão separada do valor real da despesa", () => {
    expect(obterValorPrevistoCompra({
      valor_previsto_compra: 500,
      valor_total: 430,
    })).toBe(500);
  });

  it("mantém compatibilidade com solicitações anteriores à coluna própria", () => {
    expect(obterValorPrevistoCompra({
      valor_previsto_compra: null,
      valor_total: 275.5,
    })).toBe(275.5);
  });

  it("calcula saving sem transformar compra acima da previsão em saving negativo", () => {
    expect(calcularSavingCompra(500, 430)).toBe(70);
    expect(calcularSavingCompra(500, 520)).toBe(0);
  });

  it("faz o dashboard usar a previsão preservada como valor inicial", () => {
    expect(migration).toContain(
      "COALESCE(d.valor_previsto_compra, d.valor_total, 0) - COALESCE(d.valor_aprovado_cotacao, 0)",
    );
    expect(migration).toContain(
      "COALESCE(cm.valor_previsto_compra, cm.valor_total, 0)",
    );
  });

  it("registra a alteração e oferece a última compra como sugestão", () => {
    expect(migration).toContain("Valor previsto da compra ajustado por %s");
    expect(tela).toContain("Usar última compra");
    expect(tela).toContain("O pedido, a despesa e a NF usam o valor da cotação aprovada");
  });

  it("não apresenta a previsão como valor operacional depois da aprovação", () => {
    expect(lista).toContain('i.status === "cotacao_aprovada"');
    expect(lista).toContain("Valor da cotação aprovada");
    expect(lista).toContain("Previsão para saving");
  });
});
