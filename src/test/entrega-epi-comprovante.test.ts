import { afterEach, describe, expect, it, vi } from "vitest";
import { imprimirComprovanteEpi } from "@/lib/suprimentos/entregaEpi";

afterEach(() => vi.restoreAllMocks());

describe("comprovante de EPI", () => {
  it("mostra quantidade, lote, CA, confirmação e protege nomes inseridos no HTML", () => {
    let html = "";
    const janela = { opener: window, document: { write: (v: string) => { html = v; }, close: () => undefined } } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(janela);
    imprimirComprovanteEpi({
      protocolo: "PED-001", colaborador: '<img src=x onerror=alert(1)>',
      matricula: "123", empresa: "Empresa", contrato: "Contrato", posto: "Posto",
      responsavel: "João", confirmadoEm: "2026-11-17T12:00:00Z", hash: "abc123",
      itens: [{ pedido_item_id: "i1", descricao: "Botina", tamanho: "40", codigo: "L001",
        ca: "40377", ca_validade: "2027-01-31", quantidade: 2 }],
    });
    expect(html).toContain("2</td>");
    expect(html).toContain("L001");
    expect(html).toContain("40377");
    expect(html).toContain("31/01/2027");
    expect(html).toContain("abc123");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(janela.opener).toBeNull();
  });
});
