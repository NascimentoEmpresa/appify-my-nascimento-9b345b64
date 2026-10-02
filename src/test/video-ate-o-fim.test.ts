import { describe, expect, it } from "vitest";
import {
  estadoInicial, percentualAssistido, registrarFim, registrarPosicao, relogio, type EstadoVideo,
} from "@/lib/treinamentos/videoAteOFim";

/** Simula o player tocando de `de` até `ate`, lendo a cada `passo` segundos. */
function tocar(e: EstadoVideo, de: number, ate: number, duracao: number, passo = 0.25): EstadoVideo {
  let s = e;
  for (let t = de; t <= ate + 1e-9; t += passo) s = registrarPosicao(s, Math.min(t, ate), duracao).estado;
  return s;
}

describe("vídeo até o fim", () => {
  it("assistir do começo ao fim termina", () => {
    const e = tocar(estadoInicial(), 0, 120, 120);
    expect(e.terminou).toBe(true);
    expect(percentualAssistido(e)).toBe(100);
  });

  it("parar no meio não termina, e mostra o percentual", () => {
    const e = tocar(estadoInicial(), 0, 60, 120);
    expect(e.terminou).toBe(false);
    expect(percentualAssistido(e)).toBe(50);
  });

  it("arrastar para frente volta ao ponto mais distante já visto", () => {
    const e = tocar(estadoInicial(), 0, 30, 120);
    const r = registrarPosicao(e, 115, 120);
    expect(r.voltarPara).toBeCloseTo(30);
    expect(r.estado.maximo).toBeCloseTo(30);
    expect(r.estado.terminou).toBe(false);
  });

  it("o evento de fim depois de pular não vale", () => {
    let e = tocar(estadoInicial(), 0, 10, 120);
    e = registrarPosicao(e, 119.9, 120).estado; // pulo (o player volta)
    expect(registrarFim(e).terminou).toBe(false);
  });

  it("voltar para rever é livre e não soma de novo", () => {
    let e = tocar(estadoInicial(), 0, 60, 120);
    const antes = e.assistido;
    const r = registrarPosicao(e, 20, 120);
    expect(r.voltarPara).toBeNull();
    e = tocar(r.estado, 20, 60, 120);
    expect(e.assistido).toBeCloseTo(antes);
    e = tocar(e, 60, 120, 120);
    expect(e.terminou).toBe(true);
  });

  it("velocidade 2x conta (leituras de meio segundo)", () => {
    const e = tocar(estadoInicial(), 0, 90, 90, 0.5);
    expect(e.terminou).toBe(true);
  });

  it("clicar um pouquinho à frente (dentro da tolerância) não volta", () => {
    const e = tocar(estadoInicial(), 0, 30, 120);
    expect(registrarPosicao(e, 31.5, 120).voltarPara).toBeNull();
  });

  it("depois de terminado continua terminado, mesmo voltando ao começo", () => {
    let e = tocar(estadoInicial(), 0, 120, 120);
    e = registrarPosicao(e, 0, 120).estado;
    expect(e.terminou).toBe(true);
  });

  it("sem duração conhecida, nunca termina", () => {
    const e = tocar(estadoInicial(), 0, 50, 0);
    expect(e.terminou).toBe(false);
    expect(percentualAssistido(e)).toBe(0);
  });

  it("relógio", () => {
    expect(relogio(187)).toBe("3:07");
    expect(relogio(3725)).toBe("1:02:05");
  });
});
