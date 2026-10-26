import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { chaveDoEnvio, instalarEnvioUnico } from "@/lib/envioUnico";

// Cliente de verdade com fetch falso: conta quantas vezes cada envio chega ao "banco".
function cliente(status = 201) {
  const chamadas: { metodo: string; url: string; corpo: string }[] = [];
  let id = 0;
  const fetchFalso = async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ metodo: init?.method ?? "GET", url: String(url), corpo: String(init?.body ?? "") });
    await new Promise((r) => setTimeout(r, 20));
    const corpo = status < 300 ? JSON.stringify({ id: ++id }) : JSON.stringify({ message: "falhou", code: "X" });
    return new Response(corpo, { status, headers: { "Content-Type": "application/json" } });
  };
  const sb = createClient("http://banco.test", "chave", { global: { fetch: fetchFalso as typeof fetch }, auth: { persistSession: false } });
  instalarEnvioUnico(sb);
  return { sb, chamadas };
}

describe("envio único", () => {
  it("clique repetido no mesmo insert vai ao banco uma vez e todos recebem o mesmo id", async () => {
    const { sb, chamadas } = cliente();
    const payload = { colaborador_id: 1050, descricao_ocorrido: "FALTA" };
    const rs = await Promise.all(Array.from({ length: 8 }, () =>
      sb.from("SISTEMA_SOLICITACOES_ADVERTENCIA").insert(payload).select("id").single()));
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(1);
    expect(new Set(rs.map((r) => (r.data as { id: number }).id))).toEqual(new Set([1]));
    // logo depois (dentro da janela) também não duplica
    await sb.from("SISTEMA_SOLICITACOES_ADVERTENCIA").insert(payload).select("id").single();
    expect(chamadas).toHaveLength(1);
  });

  it("corpo diferente passa normal", async () => {
    const { sb, chamadas } = cliente();
    await sb.from("T").insert({ a: 1 });
    await sb.from("T").insert({ a: 2 });
    expect(chamadas).toHaveLength(2);
  });

  it("erro não fica guardado: tentar de novo vai ao banco", async () => {
    const { sb, chamadas } = cliente(400);
    const r1 = await sb.from("T_ERRO").insert({ a: 1 });
    expect(r1.error).toBeTruthy();
    await sb.from("T_ERRO").insert({ a: 1 });
    expect(chamadas).toHaveLength(2);
  });

  it("leitura, rpc e upsert não são travados", async () => {
    const { sb, chamadas } = cliente();
    await Promise.all([sb.from("T").select("*"), sb.from("T").select("*")]);
    await Promise.all([sb.rpc("f", { x: 1 }), sb.rpc("f", { x: 1 })]);
    await Promise.all([sb.from("T").upsert({ a: 1 }), sb.from("T").upsert({ a: 1 })]);
    expect(chamadas).toHaveLength(6);
  });

  it("chave: só POST com corpo, fora de /rpc/, sem upsert", () => {
    expect(chaveDoEnvio({ method: "GET", url: "u", body: {} })).toBeNull();
    expect(chaveDoEnvio({ method: "POST", url: "http://x/rest/v1/rpc/f", body: {} })).toBeNull();
    expect(chaveDoEnvio({ method: "POST", url: "u", body: {}, headers: { Prefer: "resolution=merge-duplicates" } })).toBeNull();
    expect(chaveDoEnvio({ method: "POST", url: "u", body: { a: 1 } })).toContain('{"a":1}');
  });
});
