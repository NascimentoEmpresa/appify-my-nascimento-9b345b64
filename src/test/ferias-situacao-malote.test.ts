import { describe, expect, it } from "vitest";
import { acoesMaloteFerias, passaNoFiltroMalote, rotuloSituacaoMalote, situacaoMaloteFerias } from "@/lib/rh/situacaoMaloteFerias";

// Chamado #0865 (Alessandra, 11/11/2026): Programar no malote sem documento,
// filtro do malote e o status final ENVIADO PRA MENTORE.
// 12/11/2026 (mig 20261112203700): o anexo é opcional no envio — a despesa
// vai ao Malote sem o recibo e fica PENDENTE DE ANEXO, com o pagamento
// travado no banco até alguém anexar.

describe("situação no Malote", () => {
  it("segue a ordem: Mentore > despesa ativa (com/sem recibo) > programada > nada", () => {
    expect(situacaoMaloteFerias({}, false)).toBe("nao_enviado");
    expect(situacaoMaloteFerias({ malote_programado_em: "2026-11-11" }, false)).toBe("pendente_anexo");
    expect(situacaoMaloteFerias({ malote_programado_em: "2026-11-11", recibo_path: "1/r.pdf" }, true)).toBe("no_malote");
    expect(situacaoMaloteFerias({ recibo_path: "1/r.pdf" }, true)).toBe("no_malote");
    expect(situacaoMaloteFerias({ mentore_enviado_em: "2026-11-20", recibo_path: "1/r.pdf" }, true)).toBe("mentore");
  });

  it("enviada ao Malote sem o recibo: pendente de anexo até anexar", () => {
    expect(situacaoMaloteFerias({ malote_programado_em: "2026-11-12" }, true)).toBe("pendente_anexo");
    expect(situacaoMaloteFerias({}, true)).toBe("pendente_anexo");
    expect(situacaoMaloteFerias({ malote_programado_em: "2026-11-12", recibo_path: "1/r.pdf" }, true)).toBe("no_malote");
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
  it("programar (enviar sem documento) só aprovada e fora do Malote; Mentore só com recibo", () => {
    expect(acoesMaloteFerias("Aprovada", "nao_enviado").programar).toBe(true);
    expect(acoesMaloteFerias("Pendente", "nao_enviado").programar).toBe(false);
    expect(acoesMaloteFerias("Aprovada", "no_malote", true).enviarMentore).toBe(true);
    expect(acoesMaloteFerias("Aprovada", "mentore", true)).toMatchObject({ enviarMentore: false, desfazerMentore: true });
  });

  it("pendente de anexo COM despesa: anexar depois; nada de Mentore nem de reprogramar", () => {
    expect(acoesMaloteFerias("Aprovada", "pendente_anexo", true))
      .toEqual({ programar: false, anexarDepois: true, desprogramar: false, enviarMentore: false, desfazerMentore: false });
  });

  it("programação antiga sem despesa: dá para enviar de verdade ou desfazer", () => {
    expect(acoesMaloteFerias("Aprovada", "pendente_anexo", false))
      .toMatchObject({ programar: true, anexarDepois: false, desprogramar: true, enviarMentore: false });
  });
});
