import { describe, it, expect } from "vitest";
import { SITUACAO, SITUACOES_PRESIDENCIA } from "@/pages/comite-etica/vocabulario";

// =====================================================================
// Painel da Presidência — a lista de situações tem que existir no fluxo.
//
// SITUACOES_PRESIDENCIA é espelho de canal_denuncia_situacao_presidencia()
// (20260930000217). Um valor digitado errado aqui não dá erro nenhum: o
// card simplesmente fica zerado para sempre.
// =====================================================================

describe("SITUACOES_PRESIDENCIA", () => {
  it("só contém situações do fluxo", () => {
    const validas = SITUACAO.map((s) => s.value);
    for (const s of SITUACOES_PRESIDENCIA) expect(validas).toContain(s);
  });

  it("são exatamente as cinco pedidas para a Presidência", () => {
    expect([...SITUACOES_PRESIDENCIA].sort()).toEqual([
      "aguardando_cumprimento", "aguardando_presidencia", "arquivada", "concluida", "reaberta",
    ]);
  });
});
