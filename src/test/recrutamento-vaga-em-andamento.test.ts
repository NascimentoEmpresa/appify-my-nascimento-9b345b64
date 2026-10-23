import { describe, it, expect } from "vitest";
import { vagaEmAndamento, filtrarEmAndamento, STATUS_FORA_DO_ANDAMENTO } from "@/lib/recrutamento/vagaEmAndamento";
import { PASSOS_FLUXO } from "@/lib/recrutamento/fluxoStatus";

// Régua única de "vaga em andamento" (Gestão Recrutamento e TV RH, 22/10/2026):
// tudo menos pendente do Operacional/Diretoria/RH, concluída e reprovada/cancelada.
describe("vagaEmAndamento", () => {
  it("tira as pendentes de aprovação e da conferência do RH", () => {
    for (const s of ["Pendente Analista", "Pendente Operacional", "Pendente Diretoria", "Pendente Recrutamento"])
      expect(vagaEmAndamento(s)).toBe(false);
  });

  it("tira concluídas, reprovadas e canceladas", () => {
    for (const s of ["Contratado", "Concluído", "Concluído - Admissão", "Reprovada", "Cancelada"])
      expect(vagaEmAndamento(s)).toBe(false);
  });

  it("conta toda etapa do candidato, inclusive Pendente Seleção e SST + Compras", () => {
    const etapas = PASSOS_FLUXO.filter((p) => !["aprovacao", "recrutamento", "contratado"].includes(p.chave)).flatMap((p) => p.status);
    expect(etapas).toContain("Aprovado - Aguardando SST");
    for (const s of etapas) expect(vagaEmAndamento(s)).toBe(true);
  });

  it("status desconhecido/legado entra; espaços nas pontas não mudam a conta", () => {
    expect(vagaEmAndamento("Algum status antigo")).toBe(true);
    expect(vagaEmAndamento(" Reprovada ")).toBe(false);
  });

  it("o filtro do PostgREST exclui a mesma lista", () => {
    const chamadas: unknown[][] = [];
    const q = { not: (...a: unknown[]) => { chamadas.push(a); return q; } };
    filtrarEmAndamento(q);
    expect(chamadas[0][0]).toBe("status");
    expect(chamadas[0][1]).toBe("in");
    for (const s of STATUS_FORA_DO_ANDAMENTO) expect(String(chamadas[0][2])).toContain(`"${s}"`);
    expect(chamadas[1]).toEqual(["status", "like", "Concluído%"]);
  });
});
