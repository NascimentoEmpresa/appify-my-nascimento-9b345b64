import { describe, it, expect } from "vitest";
import { aprovarEsperaOk, rotuloOkEncarregado, temOkEncarregado } from "@/lib/conferenciaPonto/conferencia";

// Mig 20261008000005 (08/10/2026): o OK do encarregado antes de enviar ao
// RH. O responsável de cada contrato saiu da Hierarquia de Postos (removida
// em 17/11/2026) e vem do Organograma Operacional: ver
// src/test/ope-organograma-operacional.test.ts.

describe("OK do encarregado na Conferência de Ponto", () => {
  const semOk = { ok_encarregado_por: null, ok_encarregado_em: null, ok_encarregado_pelo_operacional: false };
  const doEncarregado = { ok_encarregado_por: "IDALECIO CARDOSO COSTA", ok_encarregado_em: "2026-10-08T12:00:00Z", ok_encarregado_pelo_operacional: false };
  const doOperacional = { ok_encarregado_por: "Pablo Flores Santarem", ok_encarregado_em: "2026-10-08T12:00:00Z", ok_encarregado_pelo_operacional: true };

  it("enviar ao RH espera o OK; as outras ações não", () => {
    expect(aprovarEsperaOk(semOk, "aprovar")).toBe(true);
    expect(aprovarEsperaOk(doEncarregado, "aprovar")).toBe(false);
    expect(aprovarEsperaOk(doOperacional, "aprovar")).toBe(false);
    expect(aprovarEsperaOk(semOk, "andamento_op")).toBe(false);
    expect(aprovarEsperaOk(semOk, "confirmar")).toBe(false);
  });

  it("linha sem as colunas (banco sem a migration) conta como sem OK", () => {
    expect(temOkEncarregado({})).toBe(false);
  });

  it("o selo diz de quem é o OK", () => {
    expect(rotuloOkEncarregado(semOk)).toBeNull();
    expect(rotuloOkEncarregado(doEncarregado)).toBe("OK do IDALECIO CARDOSO COSTA");
    expect(rotuloOkEncarregado(doOperacional)).toBe("OK pelo Operacional (Pablo Flores Santarem)");
  });
});
