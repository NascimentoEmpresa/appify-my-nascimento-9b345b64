import { describe, it, expect } from "vitest";
import { sanitizarNomeArquivo, proximoNomeArquivoLivre } from "@/hooks/useMaloteDespesa";

// SIS-2026-0291 (Iury): anexo e comprovante do Malote passam a subir com
// nome legível ("Nome da despesa" / "Nome da despesa - Comprovante") em vez
// do UUID cru que sempre foi usado. Exemplo real do chamado: despesa
// "RGE - JOÃO PESSOA 172" (DM-2026-0164).
describe("sanitizarNomeArquivo", () => {
  it("mantém nome já válido como está", () => {
    expect(sanitizarNomeArquivo("RGE - JOÃO PESSOA 172")).toBe("RGE - JOÃO PESSOA 172");
  });

  it("troca caracteres reservados de path/Windows por hífen", () => {
    expect(sanitizarNomeArquivo('NF 123/2026: "urgente" <pago>')).toBe("NF 123-2026- -urgente- -pago-");
  });

  it("colapsa espaços múltiplos e tira espaço nas pontas", () => {
    expect(sanitizarNomeArquivo("  RGE   -   JOÃO PESSOA   172  ")).toBe("RGE - JOÃO PESSOA 172");
  });

  it("nunca devolve string vazia (cai pra 'arquivo')", () => {
    expect(sanitizarNomeArquivo("   ")).toBe("arquivo");
    expect(sanitizarNomeArquivo("")).toBe("arquivo");
  });
});

describe("proximoNomeArquivoLivre", () => {
  it("usa o nome-base puro quando não há colisão", () => {
    const usados = new Set<string>();
    expect(proximoNomeArquivoLivre("RGE - JOÃO PESSOA 172", "pdf", usados)).toBe("RGE - JOÃO PESSOA 172.pdf");
  });

  it("numera a partir de (2) quando já existe um arquivo com esse nome", () => {
    const usados = new Set<string>(["RGE - JOÃO PESSOA 172.pdf"]);
    expect(proximoNomeArquivoLivre("RGE - JOÃO PESSOA 172", "pdf", usados)).toBe("RGE - JOÃO PESSOA 172 (2).pdf");
  });

  it("pula números já ocupados em sequência (2), (3)...", () => {
    const usados = new Set<string>(["Nome.pdf", "Nome (2).pdf", "Nome (3).pdf"]);
    expect(proximoNomeArquivoLivre("Nome", "pdf", usados)).toBe("Nome (4).pdf");
  });

  it("extensões diferentes não colidem entre si", () => {
    const usados = new Set<string>(["Nome.pdf"]);
    expect(proximoNomeArquivoLivre("Nome", "docx", usados)).toBe("Nome.docx");
  });

  it("numera corretamente uma leva de vários arquivos com o mesmo nome-base em sequência (mesmo Set mutado a cada chamada)", () => {
    const usados = new Set<string>();
    const nomes = [
      proximoNomeArquivoLivre("Nome", "pdf", usados),
      proximoNomeArquivoLivre("Nome", "pdf", usados),
      proximoNomeArquivoLivre("Nome", "pdf", usados),
    ];
    expect(nomes).toEqual(["Nome.pdf", "Nome (2).pdf", "Nome (3).pdf"]);
  });

  it("marca o nome escolhido como usado (não devolve o mesmo nome duas vezes)", () => {
    const usados = new Set<string>();
    const primeiro = proximoNomeArquivoLivre("Nome", "pdf", usados);
    expect(usados.has(primeiro)).toBe(true);
  });
});
