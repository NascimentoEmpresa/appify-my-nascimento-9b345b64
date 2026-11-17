import { describe, expect, it, vi } from "vitest";
import { criarRecargaSegura, ESPERA_APOS_FALHA_MS, paginaDoErpNoAr } from "@/lib/tv/recargaSegura";

// SIS-2026-0912 — a TV recarregava com o ERP fora e ficava presa na página de
// erro do navegador (src/lib/tv/recargaSegura.ts).

const INDEX_OK = `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-CQpxHe6J.js"></script></head><body><div id="root"></div></body></html>`;
const PAGINA_502 = `<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>`;

describe("paginaDoErpNoAr", () => {
  it("index.html publicado: no ar", () => expect(paginaDoErpNoAr(INDEX_OK)).toBe(true));
  it("página de erro do servidor/proxy, vazio ou null: fora", () => {
    expect(paginaDoErpNoAr(PAGINA_502)).toBe(false);
    expect(paginaDoErpNoAr("")).toBe(false);
    expect(paginaDoErpNoAr(null)).toBe(false);
  });
});

describe("criarRecargaSegura", () => {
  const montar = (buscar: () => Promise<string | null>) => {
    let t = 1_000_000;
    const irPara = vi.fn();
    const buscarIndex = vi.fn(buscar);
    const recarregar = criarRecargaSegura({ buscarIndex, irPara, agora: () => t });
    return { recarregar, irPara, buscarIndex, avancar: (ms: number) => { t += ms; } };
  };

  it("ERP no ar: sai da página", async () => {
    const m = montar(async () => INDEX_OK);
    expect(await m.recarregar()).toBe(true);
    expect(m.irPara).toHaveBeenCalledTimes(1);
  });

  it("ERP fora (502, resposta não-OK ou sem rede): fica na página", async () => {
    for (const buscar of [async () => PAGINA_502, async () => null, async () => { throw new TypeError("Failed to fetch"); }]) {
      const m = montar(buscar);
      expect(await m.recarregar()).toBe(false);
      expect(m.irPara).not.toHaveBeenCalled();
    }
  });

  it("depois de uma falha espera antes de tentar de novo, e recarrega quando o ERP volta", async () => {
    let noAr = false;
    const m = montar(async () => (noAr ? INDEX_OK : PAGINA_502));
    await m.recarregar();
    m.avancar(30_000);
    await m.recarregar();                       // cão de guarda a cada 30 s: ainda na espera
    expect(m.buscarIndex).toHaveBeenCalledTimes(1);
    noAr = true;
    m.avancar(ESPERA_APOS_FALHA_MS);
    expect(await m.recarregar()).toBe(true);
    expect(m.irPara).toHaveBeenCalledTimes(1);
  });

  it("uma tentativa por vez", async () => {
    let soltar: (h: string) => void = () => {};
    const m = montar(() => new Promise((r) => { soltar = r; }));
    const primeira = m.recarregar();
    expect(await m.recarregar()).toBe(false);
    soltar(INDEX_OK);
    expect(await primeira).toBe(true);
    expect(m.buscarIndex).toHaveBeenCalledTimes(1);
  });
});
