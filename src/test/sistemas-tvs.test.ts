import { describe, it, expect } from "vitest";
import { corAviso, duracaoTotal, haQuanto, normalizarChaveTv, periodoTv, rotuloPeriodoTv, statusTv, tituloRelatorioTv, urlValida, youtubeEmbed } from "@/lib/tv/tv";

// Sistemas › TV's (mig 20261007000012).

describe("TVs — regras", () => {
  const agora = new Date("2026-10-07T12:00:00Z");

  it("online até 50 s sem notícia; depois offline; sem ping, nunca conectou", () => {
    expect(statusTv("2026-10-07T11:59:20Z", agora)).toBe("online");
    expect(statusTv("2026-10-07T11:58:00Z", agora)).toBe("offline");
    expect(statusTv(null, agora)).toBe("nunca");
  });

  it("há quanto tempo", () => {
    expect(haQuanto("2026-10-07T11:59:30Z", agora)).toBe("agora");
    expect(haQuanto("2026-10-07T11:45:00Z", agora)).toBe("há 15 min");
    expect(haQuanto("2026-10-07T09:00:00Z", agora)).toBe("há 3 h");
    expect(haQuanto("2026-10-05T12:00:00Z", agora)).toBe("há 2 dias");
    expect(haQuanto(null, agora)).toBe("nunca");
  });

  it("YouTube vira embed mudo, em loop", () => {
    const e = youtubeEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s");
    expect(e).toContain("/embed/dQw4w9WgXcQ?");
    expect(e).toContain("mute=1");
    expect(e).toContain("playlist=dQw4w9WgXcQ");
    expect(youtubeEmbed("https://youtu.be/dQw4w9WgXcQ")).toContain("/embed/dQw4w9WgXcQ");
    expect(youtubeEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toContain("/embed/dQw4w9WgXcQ");
    expect(youtubeEmbed("https://vimeo.com/123")).toBeNull();
  });

  it("url, cor e duração", () => {
    expect(urlValida("https://grupo.com.br/painel")).toBe(true);
    expect(urlValida("javascript:alert(1)")).toBe(false);
    expect(corAviso("#ff0000")).toBe("#ff0000");
    expect(corAviso("red; background:url(x)")).toBe("#1d4ed8");
    expect(duracaoTotal([{ duracao_seg: 90 }, { duracao_seg: 60 }])).toBe("2 min 30 s");
    expect(duracaoTotal([{ duracao_seg: 20 }])).toBe("20 s");
  });
});

describe("TVs — link fixo e relatórios (mig 20261007000014)", () => {
  it("chave do link fixo: 12 caracteres sem 0/O/1/I", () => {
    expect(normalizarChaveTv("LS9YCJ26HREN")).toBe("LS9YCJ26HREN");
    expect(normalizarChaveTv("ls9y-cj26-hren")).toBe("LS9YCJ26HREN");
    expect(normalizarChaveTv("LS9YCJ26HRE0")).toBeNull();
    expect(normalizarChaveTv("curta")).toBeNull();
    expect(normalizarChaveTv(null)).toBeNull();
  });
  it("rótulos de relatório e período", () => {
    expect(tituloRelatorioTv("demissoes")).toBe("Demissões");
    expect(tituloRelatorioTv("xyz")).toBe("Relatório");
    expect(rotuloPeriodoTv("mes")).toBe("Este mês");
    expect(rotuloPeriodoTv(null)).toBe("Últimos 12 meses");
  });
});

describe("TVs — prévia", () => {
  it("período do relatório igual ao do banco (tv_rel_periodo)", () => {
    const hoje = new Date(2026, 9, 7); // 07/10/2026
    expect(periodoTv("mes", hoje)).toEqual({ de: "2026-10-01", ate: "2026-10-07" });
    expect(periodoTv("3m", hoje)).toEqual({ de: "2026-08-01", ate: "2026-10-07" });
    expect(periodoTv("6m", hoje)).toEqual({ de: "2026-05-01", ate: "2026-10-07" });
    expect(periodoTv("12m", hoje)).toEqual({ de: "2025-11-01", ate: "2026-10-07" });
    expect(periodoTv("ano", hoje)).toEqual({ de: "2026-01-01", ate: "2026-10-07" });
    expect(periodoTv(null, hoje)).toEqual({ de: "2025-11-01", ate: "2026-10-07" });
  });
});
