// 03/11/2026 (item 10): 10 MB por padrão, 25 MB para documentos e
// currículos, conferido antes do envio (src/lib/limiteAnexo.ts).
import { describe, expect, it, vi } from "vitest";
import { conferirTamanho, limitarUploads, limiteDoBucketMb, LIMITE_POR_BUCKET_MB } from "@/lib/limiteAnexo";

const MB = 1024 * 1024;
const arquivo = (mb: number, nome = "nota.pdf") => new File([new Uint8Array(Math.round(mb * MB))], nome);

describe("limite de anexo", () => {
  it("documento e currículo: 25 MB; padrão: 10 MB; bucket desconhecido: padrão", () => {
    expect(limiteDoBucketMb("malote-anexos")).toBe(25);
    expect(limiteDoBucketMb("curriculos")).toBe(25);
    expect(limiteDoBucketMb("avatars")).toBe(10);
    expect(limiteDoBucketMb("bucket-que-nao-existe")).toBe(10);
  });

  it("nenhum bucket fora dos de vídeo passa de 25 MB", () => {
    const fora = Object.entries(LIMITE_POR_BUCKET_MB)
      .filter(([id, mb]) => mb > 25 && !["treinamentos", "trn-midia", "tv-midia"].includes(id));
    expect(fora).toEqual([]);
  });

  it("aceita no limite exato e recusa 1 byte acima, com nome, tamanho e limite na mensagem", () => {
    expect(conferirTamanho("avatars", arquivo(10))).toBeNull();
    const recusa = conferirTamanho("avatars", new File([new Uint8Array(10 * MB + 1)], "foto.png"));
    expect(recusa).toContain("foto.png");
    expect(recusa).toContain("10 MB");
  });

  it("upload acima do limite NÃO chama o servidor e devolve erro no formato do supabase-js", async () => {
    const upload = vi.fn(async (_caminho: string, _corpo: unknown) => ({ data: { path: "x" }, error: null }));
    const storage = { from: (_b: string) => ({ upload, update: upload }) };
    limitarUploads(storage);
    const r = await storage.from("malote-anexos").upload("a/b.pdf", arquivo(30));
    expect(upload).not.toHaveBeenCalled();
    expect(r.data).toBeNull();
    expect(r.error?.message).toContain("25 MB");
  });

  it("upload dentro do limite segue normal", async () => {
    const upload = vi.fn(async (_caminho: string, _corpo: unknown) => ({ data: { path: "x" }, error: null }));
    const storage = { from: (_b: string) => ({ upload, update: upload }) };
    limitarUploads(storage);
    const r = await storage.from("malote-anexos").upload("a/b.pdf", arquivo(2));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(r.error).toBeNull();
  });
});
