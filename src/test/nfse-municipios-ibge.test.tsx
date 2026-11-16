import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useIBGEMunicipios } from "@/hooks/useIBGEMunicipios";

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());
describe("Catálogo de municípios do IBGE", () => {
  it("compartilha a consulta, recupera indisponibilidade e conserva código e UF mesmo sem microrregião", async () => {
    localStorage.setItem("ibge:municipios:v3", "cache corrompido");
    const buscar = vi.fn().mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", buscar);
    const a = renderHook(useIBGEMunicipios), b = renderHook(useIBGEMunicipios);
    await waitFor(() => expect(a.result.current.erro && b.result.current.erro).toBe(true));
    expect(buscar).toHaveBeenCalledOnce();
    buscar.mockResolvedValue({ ok: true, json: async () => [
      { id: 4322004, nome: "Triunfo", microrregiao: { mesorregiao: { UF: { sigla: "RS" } } } },
      { id: 5101837, nome: "Boa Esperança do Norte", microrregiao: null, "regiao-imediata": { "regiao-intermediaria": { UF: { sigla: "MT" } } } },
    ] });
    act(() => { a.result.current.recarregar(); b.result.current.recarregar(); });
    await waitFor(() => expect(a.result.current.municipios).toHaveLength(2));
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(a.result.current.municipios[0]).toEqual({ id: "4322004", nome: "Triunfo", uf: "RS" });
    expect(b.result.current.cidadesPorUF("MT")).toEqual(["Boa Esperança do Norte"]);
    expect(a.result.current.erro).toBe(false);
    const c = renderHook(useIBGEMunicipios);
    await waitFor(() => expect(c.result.current.isLoading).toBe(false));
    expect(c.result.current.municipios).toHaveLength(2);
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});
