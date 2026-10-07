import { describe, it, expect } from "vitest";
import { corAviso, duracaoTotal, haQuanto, statusTv, urlValida, youtubeEmbed } from "@/lib/tv/tv";

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
