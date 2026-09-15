import { describe, expect, it } from "vitest";
import { nomeArquivoCracha, origemFotoCracha } from "@/lib/suprimentos/fotoCracha";

describe("origemFotoCracha", () => {
  it("sem foto não tem origem", () => {
    expect(origemFotoCracha(null)).toBeNull();
    expect(origemFotoCracha(undefined)).toBeNull();
    expect(origemFotoCracha("   ")).toBeNull();
  });

  it("URL do sistema antigo abre direto", () => {
    const url = "https://api.mustaches.com.br/uploads/crachas/PED-MT02NAX0-9YHU5CD.png";
    expect(origemFotoCracha(url)).toEqual({ tipo: "url", url });
  });

  it("caminho gravado pelo ERP vai para o bucket", () => {
    expect(origemFotoCracha("ab3bb5c2-1deb-4954-ba6f-10dbceec2049.png"))
      .toEqual({ tipo: "bucket", caminho: "ab3bb5c2-1deb-4954-ba6f-10dbceec2049.png" });
    expect(origemFotoCracha("admissoes/tok123/foto.jpg"))
      .toEqual({ tipo: "bucket", caminho: "admissoes/tok123/foto.jpg" });
  });
});

describe("nomeArquivoCracha", () => {
  it("usa o protocolo e mantém a extensão", () => {
    expect(nomeArquivoCracha("PED-20260911-0013", "ab3bb5c2.png")).toBe("cracha-PED-20260911-0013.png");
  });

  it("sem extensão reconhecível cai para jpg", () => {
    expect(nomeArquivoCracha("PED-1", "arquivo")).toBe("cracha-PED-1.jpg");
  });
});
