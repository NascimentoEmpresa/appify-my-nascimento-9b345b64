import { describe, it, expect } from "vitest";
import { diasDesde, media, pct, rotuloDiaSemana, rotuloTela, setoresPorAcesso } from "@/lib/sistemas/loginsPainel";

// Sistemas › Logins › Painel de uso (mig 20261007000008).

describe("painel de uso dos logins", () => {
  it("porcentagem e média com uma casa, sem dividir por zero", () => {
    expect(pct(135, 159)).toBe(84.9);
    expect(pct(1, 0)).toBe(0);
    expect(media(1306, 94)).toBe(13.9);
    expect(media(5, 0)).toBe(0);
  });

  it("setores por acesso: ordena pelo total e traz a média por login", () => {
    const r = setoresPorAcesso([
      { setor: "Encarregados", logins: 94, ativos: 73, acessos: 1306, bloqueados: 7 },
      { setor: "Sistemas", logins: 5, ativos: 5, acessos: 534, bloqueados: 0 },
      { setor: "Vazio", logins: 3, ativos: 0, acessos: 0, bloqueados: 0 },
    ]);
    expect(r.map((s) => s.setor)).toEqual(["Encarregados", "Sistemas"]);
    expect(r[1].porLogin).toBe(106.8);
  });

  it("rótulos de dia da semana e de tela", () => {
    expect(rotuloDiaSemana(0)).toBe("Dom");
    expect(rotuloDiaSemana(6)).toBe("Sáb");
    expect(rotuloTela("/app/sistemas/chamados/dashboard-tv")).toBe("sistemas › chamados › dashboard-tv");
    expect(rotuloTela("/app")).toBe("início");
  });

  it("dias desde o último acesso", () => {
    const agora = new Date("2026-10-07T12:00:00Z");
    expect(diasDesde(null, agora)).toBeNull();
    expect(diasDesde("2026-10-07T08:00:00Z", agora)).toBe(0);
    expect(diasDesde("2026-09-07T12:00:00Z", agora)).toBe(30);
  });
});
