// Monitor de queda (23/09/2026): a tela "Sistema temporariamente
// indisponível" só pode aparecer quando o BANCO está fora — não por um 500
// de uma RPC com bug, nem por abort de quem desistiu da chamada. Estes testes
// travam essa regra (ver src/lib/monitorDeQueda.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/env", () => ({
  SUPABASE_URL: "https://banco.teste",
  SUPABASE_ANON_KEY: "anon",
}));

type Resp = { status: number } | "rede";
/** fetch falso: a saúde (/rest/v1/) responde `saude`, o resto responde `chamada`. */
function fetchFalso(saude: () => Resp, chamada: () => Resp) {
  return vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    const r = url === "https://banco.teste/rest/v1/" ? saude() : chamada();
    if (r === "rede") throw new TypeError("Failed to fetch");
    return new Response(null, { status: r.status });
  });
}

async function carregar(fetch: ReturnType<typeof fetchFalso>) {
  vi.resetModules();
  window.fetch = fetch as unknown as typeof window.fetch;
  const m = await import("@/lib/monitorDeQueda");
  m.instalarMonitorDeQueda();
  return m;
}

const fetchReal = window.fetch;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); window.fetch = fetchReal; });

describe("monitor de queda", () => {
  it("500 de uma chamada com o banco respondendo NÃO mostra a tela", async () => {
    const m = await carregar(fetchFalso(() => ({ status: 200 }), () => ({ status: 500 })));
    await window.fetch("https://banco.teste/rest/v1/rpc/qualquer");
    await vi.runAllTimersAsync();
    expect(m.monitorDeQueda.estado()).toBe("ok");
  });

  it("falha de rede + saúde falhando duas vezes = sistema fora", async () => {
    const m = await carregar(fetchFalso(() => "rede", () => "rede"));
    await expect(window.fetch("https://banco.teste/rest/v1/perfil")).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3_500);
    expect(m.monitorDeQueda.estado()).toBe("fora");
    expect(m.monitorDeQueda.proximaVerificacaoEm()).not.toBeNull();
  });

  it("uma falha isolada da saúde, que responde na confirmação, não derruba", async () => {
    let n = 0;
    const m = await carregar(fetchFalso(() => (n++ === 0 ? { status: 503 } : { status: 200 }), () => ({ status: 503 })));
    await window.fetch("https://banco.teste/rest/v1/x");
    await vi.advanceTimersByTimeAsync(3_500);
    expect(m.monitorDeQueda.estado()).toBe("ok");
  });

  it("chamada a Edge Function com 500 não conta (erro da função, não queda)", async () => {
    const f = fetchFalso(() => ({ status: 503 }), () => ({ status: 500 }));
    const m = await carregar(f);
    await window.fetch("https://banco.teste/functions/v1/alguma");
    await vi.advanceTimersByTimeAsync(3_500);
    expect(m.monitorDeQueda.estado()).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1); // nem chegou a testar a saúde
  });

  it("abort de quem chamou não conta como queda", async () => {
    const f = vi.fn(async () => { throw new DOMException("cancelado", "AbortError"); });
    const m = await carregar(f as unknown as ReturnType<typeof fetchFalso>);
    await expect(window.fetch("https://banco.teste/rest/v1/x")).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3_500);
    expect(m.monitorDeQueda.estado()).toBe("ok");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
