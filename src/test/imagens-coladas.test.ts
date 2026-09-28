import { describe, expect, it } from "vitest";
import { imagensDoClipboard } from "@/lib/imagensColadas";

const item = (f: File | null, kind = "file") =>
  ({ kind, type: f?.type ?? "text/plain", getAsFile: () => f }) as unknown as DataTransferItem;
const dados = (...itens: DataTransferItem[]) => ({ items: itens as unknown as DataTransferItemList });
const agora = new Date("2026-09-28T14:05:09Z");

describe("imagensDoClipboard", () => {
  it("só pega imagem — texto colado passa reto", () => {
    expect(imagensDoClipboard(dados(item(null, "string")), agora)).toEqual([]);
    expect(imagensDoClipboard(dados(item(new File(["x"], "a.pdf", { type: "application/pdf" }))), agora)).toEqual([]);
    expect(imagensDoClipboard(null, agora)).toEqual([]);
  });

  it("print sem nome ganha data/hora; jpeg vira .jpg", () => {
    const [f] = imagensDoClipboard(dados(item(new File(["x"], "image.png", { type: "image/jpeg" }))), agora);
    expect(f.name).toBe("print-20260928140509.jpg");
    expect(f.type).toBe("image/jpeg");
  });

  it("vários de uma vez não repetem nome; nome real é mantido", () => {
    const fs = imagensDoClipboard(dados(
      item(new File(["x"], "image.png", { type: "image/png" })),
      item(new File(["y"], "", { type: "image/png" })),
      item(new File(["z"], "tela-erro.png", { type: "image/png" })),
    ), agora);
    expect(fs.map((f) => f.name)).toEqual(["print-20260928140509-1.png", "print-20260928140509-2.png", "tela-erro.png"]);
  });
});
