import { describe, expect, it, vi } from "vitest";
import { deslocamentoAntiEstatica, manterTelaAcordada, rotuloTelaAcordada, type ModoTelaAcordada } from "@/lib/tv/telaAcordada";

// 04/11/2026 — TVs dormindo: wake lock que caía e não voltava, e navegador
// sem a API sem reserva nenhuma (src/lib/tv/telaAcordada.ts).

function documentoFalso() {
  const ouvintes = new Map<string, Set<() => void>>();
  return {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (t: string, f: () => void) => { if (!ouvintes.has(t)) ouvintes.set(t, new Set()); ouvintes.get(t)!.add(f); },
    removeEventListener: (t: string, f: () => void) => { ouvintes.get(t)?.delete(f); },
    disparar: (t: string) => ouvintes.get(t)?.forEach((f) => f()),
    total: () => [...ouvintes.values()].reduce((n, s) => n + s.size, 0),
  };
}
function lockFalso() {
  const fs: Array<() => void> = [];
  const l = {
    released: false,
    release: vi.fn(async () => { l.released = true; }),
    addEventListener: (_t: "release", f: () => void) => { fs.push(f); },
    soltar: () => { l.released = true; fs.forEach((f) => f()); },
  };
  return l;
}
function videoFalso(tocar: () => Promise<void> = async () => {}) {
  return { play: vi.fn(tocar), pause: vi.fn(), remove: vi.fn(), paused: false };
}
const esperar = () => new Promise((r) => setTimeout(r, 0));
const relogio = () => {
  let f: (() => void) | null = null;
  return { setInterval: (g: () => void) => { f = g; return 1; }, clearInterval: vi.fn(), tique: () => f?.() };
};

describe("rotuloTelaAcordada", () => {
  it("rótulos curtos para o campo tela (30 letras no banco)", () => {
    expect(rotuloTelaAcordada("wakelock")).toBe("wl");
    expect(rotuloTelaAcordada("video")).toBe("vd");
    expect(rotuloTelaAcordada("nenhum")).toBe("x");
    expect(rotuloTelaAcordada("pendente")).toBe("");
  });
  it("tela típica com aviso cabe em 30", () => {
    expect(["1920x1080", "abcdef12", "vd", "av:404#3"].join(" ").length).toBeLessThanOrEqual(30);
  });
});

describe("deslocamentoAntiEstatica", () => {
  it("anda em quadrado de 1 px e volta ao início", () => {
    expect([0, 1, 2, 3, 4].map(deslocamentoAntiEstatica)).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 },
    ]);
  });
  it("nunca passa de 1 px, nem com passo negativo/fracionado", () => {
    for (const p of [-7, -1, 2.9, 1e9 + 3]) {
      const d = deslocamentoAntiEstatica(p);
      expect([0, 1]).toContain(d.x); expect([0, 1]).toContain(d.y);
    }
  });
});

describe("manterTelaAcordada", () => {
  it("com a API: pega o wake lock e avisa wakelock", async () => {
    const doc = documentoFalso(); const r = relogio();
    const lock = lockFalso();
    const modos: ModoTelaAcordada[] = [];
    const criarVideo = vi.fn(() => videoFalso());
    manterTelaAcordada({ wakeLock: { request: vi.fn(async () => lock) }, documento: doc as any, criarVideo, aoMudar: (m) => modos.push(m), ...r });
    await esperar();
    expect(modos).toEqual(["wakelock"]);
    expect(criarVideo).not.toHaveBeenCalled();
  });

  it("lock solto com a página visível: pede de novo na hora (o bug de 04/11)", async () => {
    const doc = documentoFalso(); const r = relogio();
    const locks = [lockFalso(), lockFalso()];
    const request = vi.fn(async () => locks[request.mock.calls.length - 1]);
    manterTelaAcordada({ wakeLock: { request }, documento: doc as any, criarVideo: () => null, ...r });
    await esperar();
    locks[0].soltar();
    await esperar();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("página oculta não pede; ao voltar a ficar visível, pede", async () => {
    const doc = documentoFalso(); const r = relogio();
    const lock = lockFalso();
    const request = vi.fn(async () => lock);
    manterTelaAcordada({ wakeLock: { request }, documento: doc as any, criarVideo: () => null, ...r });
    await esperar();
    doc.visibilityState = "hidden"; lock.soltar();
    await esperar();
    expect(request).toHaveBeenCalledTimes(1);
    doc.visibilityState = "visible"; doc.disparar("visibilitychange");
    await esperar();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("conferência periódica não pede de novo se o lock está firme", async () => {
    const doc = documentoFalso(); const r = relogio();
    const request = vi.fn(async () => lockFalso());
    manterTelaAcordada({ wakeLock: { request }, documento: doc as any, criarVideo: () => null, ...r });
    await esperar(); r.tique(); r.tique(); await esperar();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("sem a API: cai no vídeo-reserva", async () => {
    const doc = documentoFalso(); const r = relogio();
    const v = videoFalso();
    const modos: ModoTelaAcordada[] = [];
    manterTelaAcordada({ documento: doc as any, criarVideo: () => v, aoMudar: (m) => modos.push(m), ...r });
    await esperar();
    expect(v.play).toHaveBeenCalled();
    expect(modos).toEqual(["video"]);
  });

  it("wake lock recusado (NotAllowedError): cai no vídeo-reserva", async () => {
    const doc = documentoFalso(); const r = relogio();
    const v = videoFalso();
    const modos: ModoTelaAcordada[] = [];
    manterTelaAcordada({ wakeLock: { request: async () => { throw new Error("NotAllowedError"); } }, documento: doc as any, criarVideo: () => v, aoMudar: (m) => modos.push(m), ...r });
    await esperar();
    expect(modos).toEqual(["video"]);
  });

  it("autoplay barrado: avisa nenhum e tenta de novo no toque do controle", async () => {
    const doc = documentoFalso(); const r = relogio();
    let liberado = false;
    const v = videoFalso(async () => { if (!liberado) throw new Error("NotAllowedError"); });
    const modos: ModoTelaAcordada[] = [];
    manterTelaAcordada({ documento: doc as any, criarVideo: () => v, aoMudar: (m) => modos.push(m), ...r });
    await esperar();
    expect(modos).toEqual(["nenhum"]);
    liberado = true; doc.disparar("keydown");
    await esperar();
    expect(modos).toEqual(["nenhum", "video"]);
  });

  it("sem API e sem como criar vídeo: nenhum", async () => {
    const doc = documentoFalso(); const r = relogio();
    const modos: ModoTelaAcordada[] = [];
    manterTelaAcordada({ documento: doc as any, criarVideo: () => null, aoMudar: (m) => modos.push(m), ...r });
    await esperar();
    expect(modos).toEqual(["nenhum"]);
  });

  it("ao parar: solta o lock, para o vídeo, tira os ouvintes e o timer", async () => {
    const doc = documentoFalso(); const r = relogio();
    const lock = lockFalso();
    const parar = manterTelaAcordada({ wakeLock: { request: async () => lock }, documento: doc as any, criarVideo: () => null, ...r });
    await esperar();
    parar();
    expect(lock.release).toHaveBeenCalled();
    expect(doc.total()).toBe(0);
    expect(r.clearInterval).toHaveBeenCalled();

    const doc2 = documentoFalso(); const v = videoFalso();
    const parar2 = manterTelaAcordada({ documento: doc2 as any, criarVideo: () => v, ...relogio() });
    await esperar(); parar2();
    expect(v.remove).toHaveBeenCalled();
  });
});
