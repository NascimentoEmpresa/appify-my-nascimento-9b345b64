// 03/11/2026: o boot de uma aba lia `profiles` ~7 vezes e `auth/v1/user` ~4
// vezes, todas iguais (src/lib/leituraCompartilhada.ts). Estes testes travam
// o compartilhamento: N pedidos juntos = 1 requisição, e nada de dado velho
// depois da validade nem de erro guardado.
import { describe, expect, it, vi } from "vitest";
import { compartilhar } from "@/lib/leituraCompartilhada";

describe("leitura compartilhada", () => {
  it("7 pedidos ao mesmo tempo viram 1 busca", async () => {
    const c = compartilhar<number>(5_000);
    const buscar = vi.fn(async () => 42);
    const r = await Promise.all(Array.from({ length: 7 }, () => c.ler("u1", buscar)));
    expect(r).toEqual([42, 42, 42, 42, 42, 42, 42]);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("depois da validade busca de novo", async () => {
    let agora = 0;
    const c = compartilhar<number>(5_000, () => agora);
    const buscar = vi.fn(async () => agora);
    await c.ler("u1", buscar);
    agora = 4_999; await c.ler("u1", buscar);
    expect(buscar).toHaveBeenCalledTimes(1);
    agora = 5_001 + 0; await Promise.resolve(); await c.ler("u1", buscar);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("erro não fica guardado: a próxima chamada tenta de novo", async () => {
    const c = compartilhar<number>(60_000);
    const buscar = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(7);
    await expect(c.ler("u1", buscar)).rejects.toThrow("503");
    await expect(c.ler("u1", buscar)).resolves.toBe(7);
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("chaves diferentes (outro usuário, outro token) não se misturam", async () => {
    const c = compartilhar<string>(60_000);
    const a = await c.ler("u1", async () => "perfil-1");
    const b = await c.ler("u2", async () => "perfil-2");
    expect([a, b]).toEqual(["perfil-1", "perfil-2"]);
  });

  it("esquecer() força leitura fresca (quem grava no próprio perfil)", async () => {
    const c = compartilhar<number>(60_000);
    let v = 1;
    const buscar = vi.fn(async () => v);
    expect(await c.ler("u1", buscar)).toBe(1);
    v = 2; c.esquecer("u1");
    expect(await c.ler("u1", buscar)).toBe(2);
  });
});
