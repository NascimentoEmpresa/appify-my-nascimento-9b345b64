import { describe, expect, it } from "vitest";
import { acoesMaloteFerias, passaNoFiltroMalote, rotuloSituacaoMalote, situacaoMaloteFerias } from "@/lib/rh/situacaoMaloteFerias";

// Chamado #0865 (Alessandra, 11/11/2026): Programar no malote sem documento,
// filtro do malote e o status final ENVIADO PRA MENTORE.

describe("situação no Malote", () => {
  it("segue a ordem: Mentore > despesa ativa > programada > nada", () => {
    expect(situacaoMaloteFerias({}, false)).toBe("nao_enviado");
    expect(situacaoMaloteFerias({ malote_programado_em: "2026-11-11" }, false)).toBe("pendente_anexo");
    expect(situacaoMaloteFerias({ malote_programado_em: "2026-11-11" }, true)).toBe("no_malote");
    expect(situacaoMaloteFerias({}, true)).toBe("no_malote");
    expect(situacaoMaloteFerias({ mentore_enviado_em: "2026-11-20" }, true)).toBe("mentore");
  });

  it("despesa excluída no Malote: a programada volta a pendente de anexo", () => {
    expect(situacaoMaloteFerias({ malote_programado_em: "2026-11-11" }, false)).toBe("pendente_anexo");
  });

  it("rótulos do chamado", () => {
    expect(rotuloSituacaoMalote("pendente_anexo")).toBe("PENDENTE DE ANEXO DE DOCUMENTO");
    expect(rotuloSituacaoMalote("mentore")).toBe("ENVIADO PRA MENTORE");
  });
});

describe("filtro do Malote", () => {
  it("vazio passa tudo; 'já foi' junta enviados e Mentore", () => {
    expect(passaNoFiltroMalote("nao_enviado", "")).toBe(true);
    expect(passaNoFiltroMalote("no_malote", "ja_foi")).toBe(true);
    expect(passaNoFiltroMalote("mentore", "ja_foi")).toBe(true);
    expect(passaNoFiltroMalote("pendente_anexo", "ja_foi")).toBe(false);
    expect(passaNoFiltroMalote("pendente_anexo", "pendente_anexo")).toBe(true);
    expect(passaNoFiltroMalote("mentore", "no_malote")).toBe(false);
  });
});

describe("ações", () => {
  it("programar só aprovada e fora do Malote; Mentore só com despesa ativa", () => {
    expect(acoesMaloteFerias("Aprovada", "nao_enviado").programar).toBe(true);
    expect(acoesMaloteFerias("Pendente", "nao_enviado").programar).toBe(false);
    expect(acoesMaloteFerias("Aprovada", "pendente_anexo")).toMatchObject({ programar: false, desprogramar: true, enviarMentore: false });
    expect(acoesMaloteFerias("Aprovada", "no_malote").enviarMentore).toBe(true);
    expect(acoesMaloteFerias("Aprovada", "mentore")).toMatchObject({ enviarMentore: false, desfazerMentore: true });
  });
});
