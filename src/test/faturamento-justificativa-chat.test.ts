import { describe, expect, it } from "vitest";
import { resumirChats, type MensagemFaturamento } from "@/hooks/useFaturamentoJustificativa";

// SIS-2026-0808: o resumo da coluna "Justificativa" conta as mensagens do chat de cada contrato e guarda a última.
const M = (o: Partial<MensagemFaturamento> = {}): MensagemFaturamento => ({
  id: "m", contrato_id: "c1", competencia: "2026-10-01", autor_id: "u1", destinatario_id: null, texto: "oi", anexos: [], created_at: "2026-10-20T10:00:00Z", ...o,
});

describe("resumo do chat de faturamento por contrato", () => {
  it("conta as mensagens por contrato e devolve a mais recente como última", () => {
    const r = resumirChats([
      M({ id: "a", created_at: "2026-10-20T10:00:00Z", texto: "por que não faturou?" }),
      M({ id: "b", created_at: "2026-10-21T09:00:00Z", texto: "medição pendente" }),
      M({ id: "c", contrato_id: "c2", texto: "outro" }),
    ]);
    expect(r.get("c1")?.total).toBe(2);
    expect(r.get("c1")?.ultima.texto).toBe("medição pendente");
    expect(r.get("c2")?.total).toBe(1);
    expect(r.has("c3")).toBe(false);
  });
  it("não depende da ordem em que as mensagens chegam", () => {
    const r = resumirChats([M({ id: "b", created_at: "2026-10-21T09:00:00Z", texto: "nova" }), M({ id: "a", created_at: "2026-10-20T10:00:00Z", texto: "antiga" })]);
    expect(r.get("c1")?.ultima.texto).toBe("nova");
  });
});
