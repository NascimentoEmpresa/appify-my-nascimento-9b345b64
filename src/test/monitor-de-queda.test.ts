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
    const r = url === "https://banco.teste/rest/v1/rpc/sistema_saude" ? saude() : chamada();
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

// 03/11/2026: o reteste em 15 s fixos + recarga imediata fazia todas as abas
// recarregarem juntas quando o servidor voltava — e derrubavam de novo
// (docs/incidentes/2026-11-03-post-mortem.md, C3). Estes testes travam a
// dessincronização.
describe("monitor de queda — sem recarga em manada", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("o reteste dobra a cada falha até 120 s e é sorteado entre 50% e 150%", async () => {
    const m = await import("@/lib/monitorDeQueda");
    expect(m.intervaloReverificacao(0, 0.5)).toBe(15_000);
    expect(m.intervaloReverificacao(1, 0.5)).toBe(30_000);
    expect(m.intervaloReverificacao(2, 0.5)).toBe(60_000);
    expect(m.intervaloReverificacao(3, 0.5)).toBe(120_000);
    expect(m.intervaloReverificacao(10, 0.5)).toBe(120_000);
    expect(m.intervaloReverificacao(0, 0)).toBe(7_500);
    expect(m.intervaloReverificacao(0, 0.999)).toBeLessThan(22_500);
  });

  it("100 abas sorteando o reteste se espalham por mais de 10 s (antes: todas no mesmo instante)", async () => {
    const m = await import("@/lib/monitorDeQueda");
    const esperas = Array.from({ length: 100 }, () => m.intervaloReverificacao(0));
    expect(Math.max(...esperas) - Math.min(...esperas)).toBeGreaterThan(10_000);
  });

  function trocarRecarga() {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, reload, pathname: "/", search: "", href: "https://app.teste/" } });
    return { reload, restaurar: () => Object.defineProperty(window, "location", { configurable: true, value: original }) };
  }
  function visibilidade(v: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  }

  it("aba VISÍVEL: o servidor volta e a recarga espera um sorteio, não acontece no mesmo segundo", async () => {
    const { reload, restaurar } = trocarRecarga();
    visibilidade("visible");
    let fora = true;
    const m = await carregar(fetchFalso(() => (fora ? { status: 503 } : { status: 200 }), () => ({ status: 503 })));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await window.fetch("https://banco.teste/rest/v1/x");
    await vi.advanceTimersByTimeAsync(3_500);
    expect(m.monitorDeQueda.estado()).toBe("fora");
    fora = false;
    await vi.advanceTimersByTimeAsync(15_000); // reteste (sorteio 0.5 => 15 s) responde
    expect(reload).not.toHaveBeenCalled();       // ainda esperando o sorteio da recarga (10 s)
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reload).toHaveBeenCalledTimes(1);
    restaurar();
  });

  it("aba ESCONDIDA: o servidor volta e ela NÃO recarrega até o usuário voltar para ela", async () => {
    const { reload, restaurar } = trocarRecarga();
    visibilidade("hidden");
    let fora = true;
    const m = await carregar(fetchFalso(() => (fora ? { status: 503 } : { status: 200 }), () => ({ status: 503 })));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await window.fetch("https://banco.teste/rest/v1/x");
    await vi.advanceTimersByTimeAsync(3_500);
    fora = false;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(reload).not.toHaveBeenCalled();
    visibilidade("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(reload).toHaveBeenCalledTimes(1);
    restaurar();
  });

  it("o botão Recarregar (manual) continua imediato", async () => {
    const { reload, restaurar } = trocarRecarga();
    visibilidade("visible");
    const m = await carregar(fetchFalso(() => ({ status: 200 }), () => ({ status: 200 })));
    await m.verificarAgora(true);
    expect(reload).toHaveBeenCalledTimes(1);
    restaurar();
  });
});
