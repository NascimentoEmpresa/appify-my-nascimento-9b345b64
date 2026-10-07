import { describe, it, expect } from "vitest";
import { pedidoPronto } from "@/hooks/useLoginsSistemas";

// =====================================================================
// Sistemas › Logins (mig 20261006160000): o login só é liberado — e
// vinculado — quando a admissão está Trabalhando na Senior (senior_id).
// pedidoPronto decide o badge, a ordem da lista e o botão de vincular.
// =====================================================================

describe("pedidoPronto", () => {
  it("pendente e admitido na Senior = pronto para liberar", () => {
    expect(pedidoPronto({ status: "pendente", senior_id: 13597 })).toBe(true);
  });
  it("pendente sem admissão Trabalhando ainda não é trabalho a fazer", () => {
    expect(pedidoPronto({ status: "pendente", senior_id: null })).toBe(false);
  });
  it("já criado, entregue ou cancelado não conta como pendência", () => {
    expect(pedidoPronto({ status: "criado", senior_id: 1 })).toBe(false);
    expect(pedidoPronto({ status: "entregue", senior_id: 1 })).toBe(false);
    expect(pedidoPronto({ status: "cancelado", senior_id: 1 })).toBe(false);
  });
});
