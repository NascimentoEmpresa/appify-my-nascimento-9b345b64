import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { instalarInsertComDefault } from "@/lib/insertComDefault";

// O caso da campanha de Treinamentos (19/10/2026): item antigo com created_at,
// item novo sem ele, salvos no mesmo upsert.
function clienteGravando() {
  const pedidos: { url: string; prefer: string }[] = [];
  const fetchFalso = async (url: RequestInfo | URL, init?: RequestInit) => {
    pedidos.push({ url: String(url), prefer: new Headers(init?.headers).get("Prefer") ?? "" });
    return new Response("[]", { status: 201, headers: { "Content-Type": "application/json" } });
  };
  const cliente = createClient("http://banco.test", "chave", { global: { fetch: fetchFalso as typeof fetch }, auth: { persistSession: false } });
  return { cliente, pedidos };
}
const itens = [{ id: "a", titulo: "velho", created_at: "2026-10-01T00:00:00Z" }, { id: "b", titulo: "novo" }];

describe("insert/upsert em lista usa o DEFAULT da coluna ausente", () => {
  it("sem a correção, o supabase-js manda NULL (o erro do created_at)", async () => {
    const { cliente, pedidos } = clienteGravando();
    await cliente.from("TRN_CAMPANHA_ITEM").upsert(itens, { onConflict: "id" });
    expect(pedidos[0].url).toContain("columns=");
    expect(pedidos[0].prefer).not.toContain("missing=default");
  });

  it("com a correção, upsert e insert pedem missing=default", async () => {
    const { cliente, pedidos } = clienteGravando();
    instalarInsertComDefault(cliente);
    await cliente.from("TRN_CAMPANHA_ITEM").upsert(itens, { onConflict: "id" });
    await cliente.from("TRN_CAMPANHA_ITEM").insert(itens);
    expect(pedidos.map((p) => p.prefer.includes("missing=default"))).toEqual([true, true]);
    expect(pedidos[0].prefer).toContain("resolution=merge-duplicates"); // o onConflict continua valendo
  });

  it("quem pedir NULL de propósito ainda consegue", async () => {
    const { cliente, pedidos } = clienteGravando();
    instalarInsertComDefault(cliente);
    instalarInsertComDefault(cliente); // instalar duas vezes não embrulha duas vezes
    await cliente.from("X").insert(itens, { defaultToNull: true });
    expect(pedidos[0].prefer).not.toContain("missing=default");
  });
});
