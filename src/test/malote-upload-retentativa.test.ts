import { describe, it, expect, vi } from "vitest";
import { ehErroDeRede, comRetentativaRede } from "@/hooks/useMaloteDespesa";

// DM-2026-0446 (João do Jurídico): o upload do anexo pro Storage falhava
// com "Failed to fetch" (fetch cortado por oscilação de rede) e a despesa
// ficava órfã. `comRetentativaRede` repete só quando a falha é de rede.
describe("ehErroDeRede", () => {
  it("reconhece TypeError (o que o fetch do browser lança ao ser cortado)", () => {
    expect(ehErroDeRede(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("reconhece pela mensagem, mesmo sem ser TypeError", () => {
    expect(ehErroDeRede(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(ehErroDeRede(new Error("Load failed"))).toBe(true);
    expect(ehErroDeRede("fetch failed")).toBe(true);
  });

  it("NÃO trata erro de API (nome inválido, permissão) como erro de rede", () => {
    expect(ehErroDeRede(new Error("Invalid key: foo/bar.pdf"))).toBe(false);
    expect(ehErroDeRede(new Error("new row violates row-level security policy"))).toBe(false);
    expect(ehErroDeRede(null)).toBe(false);
  });
});

describe("comRetentativaRede", () => {
  const semEspera = { esperaMs: () => 0 };

  it("passa direto quando dá certo de primeira", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(comRetentativaRede(fn, semEspera)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("repete o erro de rede e retorna quando uma das tentativas passa", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("ok");
    await expect(comRetentativaRede(fn, semEspera)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("desiste depois de esgotar as tentativas e propaga o último erro", async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(comRetentativaRede(fn, { tentativas: 3, esperaMs: () => 0 })).rejects.toThrow("Failed to fetch");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("NÃO repete erro de API — propaga na primeira", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Invalid key"));
    await expect(comRetentativaRede(fn, semEspera)).rejects.toThrow("Invalid key");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
