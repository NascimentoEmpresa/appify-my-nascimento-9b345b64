import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// SIS-2026-0613 (DM-2026-0924): parcela paga com a despesa conferida ("pronto para pagar")
// ficava presa nesse status. A correção é em SQL (malote_pagar_parcela) — este teste trava a
// regra no arquivo da migration para ninguém tirar o bloco sem perceber.
const sql = readFileSync("supabase/migrations/20261007000001_malote_parcela_paga_volta_aguardando.sql", "utf8");

describe("malote_pagar_parcela: parcela que não é a última com despesa conferida", () => {
  it("volta a despesa para aguardando_pagamento, sem notificar de novo", () => {
    expect(sql).toMatch(/IF v_restantes > 0 AND v_status_despesa = 'pronto_para_pagar' THEN/);
    expect(sql).toMatch(/UPDATE public\.malote_despesa SET status = 'aguardando_pagamento' WHERE id = _despesa_id/);
    expect(sql).toMatch(/set_config\('malote\.sem_notificacao', 'on', true\)/);
  });
  it("o trigger de notificação respeita o silêncio da transação", () => {
    expect(sql).toMatch(/WHEN \(current_setting\('malote\.sem_notificacao', true\) IS DISTINCT FROM 'on'\)/);
  });
  it("a última parcela continua fechando a despesa como paga", () => {
    expect(sql).toMatch(/IF v_restantes = 0 THEN/);
    expect(sql).toMatch(/status = 'despesa_paga'/);
  });
  it("corrige as parceladas já presas, só as com parcela paga e outra pendente", () => {
    expect(sql).toMatch(/d\.status = 'pronto_para_pagar'/);
    expect(sql).toMatch(/p\.status = 'paga'/);
    expect(sql).toMatch(/p\.status <> 'paga'/);
  });
});
