import { describe, expect, it } from "vitest";
import { ordenarPorConclusao } from "@/pages/financeiro/nf-emissao/ordemConclusao";

// SIS-2026-0614: relatórios na ordem de conclusão pelo Financeiro, não na de criação pelo analista.
const nf = (id: string, created_at: string, concluida_em?: string | null) => ({ id, created_at, concluida_em });

describe("ordenarPorConclusao", () => {
  it("a última concluída pelo Financeiro vem primeiro, mesmo criada antes pelo analista", () => {
    const lista = [
      nf("criada-por-ultimo", "2026-10-05T10:00:00Z", "2026-10-05T10:30:00Z"),
      nf("criada-primeiro", "2026-10-01T09:00:00Z", "2026-10-06T15:00:00Z"), // liberada cedo, concluída tarde
      nf("meio", "2026-10-03T09:00:00Z", "2026-10-06T08:00:00Z"),
    ];
    expect(ordenarPorConclusao(lista).map((n) => n.id)).toEqual(["criada-primeiro", "meio", "criada-por-ultimo"]);
  });

  it("sem data de conclusão (legada ou ainda não concluída) usa a data de criação", () => {
    const lista = [
      nf("legada-antiga", "2026-03-01T00:00:00Z"),
      nf("concluida-hoje", "2026-09-01T00:00:00Z", "2026-10-06T12:00:00Z"),
      nf("legada-recente", "2026-09-20T00:00:00Z", null),
    ];
    expect(ordenarPorConclusao(lista).map((n) => n.id)).toEqual(["concluida-hoje", "legada-recente", "legada-antiga"]);
  });

  it("empate mantém a ordem de chegada e a lista original não é alterada", () => {
    const a = nf("a", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    const b = nf("b", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    const original = [a, b];
    expect(ordenarPorConclusao(original).map((n) => n.id)).toEqual(["a", "b"]);
    expect(original.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
