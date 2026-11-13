import { describe, it, expect } from "vitest";
import {
  podeEditarMensagem, podeApagarMensagem, ehMensagemDeGente,
  rotuloMensagemApagada, rotuloEditada, dicaEditada, textoParaRelatorio,
  type MensagemChat,
} from "@/lib/chamados/mensagemEditavel";

// Espelho de chamado_mensagem_checar_autor (mig 20261115000600).

const msg = (over: Partial<MensagemChat> = {}): MensagemChat => ({
  autor_id: "eu", tipo: "comentario", meta: null, apagado_em: null, ...over,
});

describe("quem pode editar/apagar", () => {
  it("o autor pode, nas duas ações", () => {
    expect(podeEditarMensagem(msg(), "eu")).toBe(true);
    expect(podeApagarMensagem(msg(), "eu")).toBe(true);
    expect(podeEditarMensagem(msg({ tipo: "observacao_interna" }), "eu")).toBe(true);
  });

  it("outra pessoa (inclusive gestão) não pode", () => {
    expect(podeEditarMensagem(msg(), "gestor")).toBe(false);
    expect(podeApagarMensagem(msg(), "gestor")).toBe(false);
    expect(podeApagarMensagem(msg(), null)).toBe(false);
  });

  it("mensagem já apagada não volta nem é editada", () => {
    expect(podeEditarMensagem(msg({ apagado_em: "2026-11-13T14:10:00Z" }), "eu")).toBe(false);
    expect(podeApagarMensagem(msg({ apagado_em: "2026-11-13T14:10:00Z" }), "eu")).toBe(false);
  });

  it("aviso do sistema e mensagem de robô não são editáveis", () => {
    expect(podeEditarMensagem(msg({ tipo: "evento" }), "eu")).toBe(false);
    expect(podeEditarMensagem(msg({ tipo: "solicitar_info" }), "eu")).toBe(false);
    // Resumo da I.A no merge: comentario com o autor do dev.
    expect(podeEditarMensagem(msg({ meta: { canal: "github", origem: "resumo_pr" } }), "eu")).toBe(false);
    expect(podeApagarMensagem(msg({ tipo: "observacao_interna", meta: { canal: "whatsapp" } }), "eu")).toBe(false);
    expect(ehMensagemDeGente({ tipo: "comentario", meta: {} })).toBe(true);
  });

  it("conversa fechada só deixa mexer na interna", () => {
    expect(podeEditarMensagem(msg(), "eu", "cancelado")).toBe(false);
    expect(podeApagarMensagem(msg(), "eu", "reprovado")).toBe(false);
    expect(podeEditarMensagem(msg({ tipo: "observacao_interna" }), "eu", "cancelado")).toBe(true);
    expect(podeEditarMensagem(msg(), "eu", "concluido")).toBe(true);
  });
});

describe("rótulos", () => {
  it("apagada: nome + data/hora", () => {
    const r = rotuloMensagemApagada("Pablo", "2026-11-13T14:10:00");
    expect(r).toMatch(/^Mensagem apagada por Pablo em 13\/11\/2026/);
    expect(r).toContain("14:10");
    expect(rotuloMensagemApagada("", "inválida")).toBe("Mensagem apagada por Usuário");
  });

  it("editada: selo só quando houve edição", () => {
    expect(rotuloEditada(null)).toBeNull();
    expect(rotuloEditada(undefined)).toBeNull();
    expect(rotuloEditada("2026-11-13T14:10:00Z")).toBe("(editada)");
    expect(dicaEditada("2026-11-13T14:10:00")).toMatch(/^Editada em 13\/11\/2026.*ver o original$/);
  });

  it("relatórios não mostram o conteúdo apagado como atual", () => {
    const nome = (uid: string | null) => (uid === "eu" ? "Pablo" : "Usuário");
    expect(textoParaRelatorio({ texto: null, apagado_em: "2026-11-13T14:10:00", apagado_por: "eu" }, nome))
      .toMatch(/^Mensagem apagada por Pablo em /);
    // Mesmo se viesse texto (não deveria: o gatilho zera), a marca vence.
    expect(textoParaRelatorio({ texto: "segredo", apagado_em: "2026-11-13T14:10:00", apagado_por: "eu" }, nome))
      .not.toContain("segredo");
    expect(textoParaRelatorio({ texto: "novo", editado_em: "2026-11-13T14:10:00Z" }, nome)).toBe("novo (editada)");
    expect(textoParaRelatorio({ texto: "oi" }, nome)).toBe("oi");
  });
});
