import { describe, it, expect, vi, beforeEach } from "vitest";

// Os comprovantes do reembolso viram anexo do Malote automaticamente. O que
// este arquivo trava é o que o FINANCEIRO vê: o nome do arquivo na lista de
// anexos, e o fato de um download quebrado não levar os outros junto.
//
// O caminho do storage não serve de nome — ele é
// "<uuid>/cafe_manha-1788358098564-01.09_caf_.pdf", com pasta e carimbo de
// tempo. Quem paga precisa ler "01.09 café.pdf".

const download = vi.fn();
const select = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: (...a: any[]) => select(...a) }),
    storage: { from: () => ({ download: (...a: any[]) => download(...a) }) },
  },
}));

const itens = (linhas: any[]) => {
  select.mockReturnValue({ eq: () => Promise.resolve({ data: linhas, error: null }) });
};

const blob = (txt = "x") => new Blob([txt], { type: "application/pdf" });

let comprovantesDoReembolso: typeof import("@/lib/reembolso/vinculoMalote").comprovantesDoReembolso;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ comprovantesDoReembolso } = await import("@/lib/reembolso/vinculoMalote"));
});

describe("comprovantesDoReembolso", () => {
  it("usa o nome ORIGINAL do arquivo, não o caminho do storage", async () => {
    itens([{
      storage_path: "abc/cafe_manha-1788358098564-01.09_caf_.pdf",
      nome_arquivo: "01.09 café.pdf",
      mime_type: "application/pdf",
    }]);
    download.mockResolvedValue({ data: blob(), error: null });

    const { arquivos, falhas } = await comprovantesDoReembolso("r1");
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0].name).toBe("01.09 café.pdf");
    expect(arquivos[0].type).toBe("application/pdf");
    expect(falhas).toBe(0);
  });

  it("sem nome gravado, cai no último pedaço do caminho — nunca no caminho inteiro", async () => {
    itens([{ storage_path: "abc/nota-123.pdf", nome_arquivo: null, mime_type: null }]);
    download.mockResolvedValue({ data: blob(), error: null });

    const { arquivos } = await comprovantesDoReembolso("r1");
    expect(arquivos[0].name).toBe("nota-123.pdf");
  });

  it("nome só com espaços não vale como nome", async () => {
    itens([{ storage_path: "abc/nota.pdf", nome_arquivo: "   ", mime_type: null }]);
    download.mockResolvedValue({ data: blob(), error: null });

    const { arquivos } = await comprovantesDoReembolso("r1");
    expect(arquivos[0].name).toBe("nota.pdf");
  });

  it("um download quebrado NÃO leva os outros junto", async () => {
    // O financeiro prefere a despesa com dois dos três comprovantes e um
    // aviso a nenhuma despesa.
    itens([
      { storage_path: "a/1.pdf", nome_arquivo: "1.pdf", mime_type: null },
      { storage_path: "a/2.pdf", nome_arquivo: "2.pdf", mime_type: null },
      { storage_path: "a/3.pdf", nome_arquivo: "3.pdf", mime_type: null },
    ]);
    download
      .mockResolvedValueOnce({ data: blob(), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "not found" } })
      .mockResolvedValueOnce({ data: blob(), error: null });

    const { arquivos, falhas } = await comprovantesDoReembolso("r1");
    expect(arquivos.map(a => a.name)).toEqual(["1.pdf", "3.pdf"]);
    expect(falhas).toBe(1);
  });

  it("reembolso sem item devolve vazio, sem estourar", async () => {
    itens([]);
    const { arquivos, falhas } = await comprovantesDoReembolso("r1");
    expect(arquivos).toEqual([]);
    expect(falhas).toBe(0);
    expect(download).not.toHaveBeenCalled();
  });

  it("erro ao listar os itens não derruba a tela do Malote", async () => {
    select.mockReturnValue({ eq: () => Promise.resolve({ data: null, error: { message: "rls" } }) });
    const { arquivos, falhas } = await comprovantesDoReembolso("r1");
    expect(arquivos).toEqual([]);
    expect(falhas).toBe(0);
  });
});
