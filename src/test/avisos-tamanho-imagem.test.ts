import { describe, expect, it } from "vitest";
import {
  FORM_VAZIO, avisoDoFormulario, classeCaixaImagem, formDoAviso, larguraJanelaAviso,
  tamanhoImagemDe, type Notificacao,
} from "@/lib/notificacoes";

// Pedido do Pablo (16/10/2026), com o print do "3 Anos de Empresa": o cartaz
// quadrado saía pequeno na caixa 16:9 do modal. Quem publica escolhe o tamanho,
// e confere numa prévia antes de lançar. Aviso antigo (coluna NULL) não muda.

describe("tamanho da imagem do aviso", () => {
  it("aviso antigo (NULL) e valor estranho caem no padrão de sempre", () => {
    expect(tamanhoImagemDe(null)).toBe("");
    expect(tamanhoImagemDe(undefined)).toBe("");
    expect(tamanhoImagemDe("gigante")).toBe("");
    expect(classeCaixaImagem(tamanhoImagemDe(null))).toBe("aspect-video w-full");
    expect(larguraJanelaAviso("")).toBe("max-w-lg");
  });

  it("os tamanhos conhecidos passam e mudam a caixa", () => {
    expect(tamanhoImagemDe("grande")).toBe("grande");
    expect(classeCaixaImagem("pequena")).not.toBe(classeCaixaImagem("grande"));
    expect(larguraJanelaAviso("total")).toBe("max-w-3xl");
  });

  it("editar um aviso traz o tamanho gravado de volta para o formulário", () => {
    const n = { ...avisoDoFormulario({ ...FORM_VAZIO, titulo: "t", mensagem: "mensagem longa" }, null), id: 7, imagens_tamanho: "media" } as Notificacao;
    expect(formDoAviso(n).imagens_tamanho).toBe("media");
    expect(formDoAviso({ ...n, imagens_tamanho: null }).imagens_tamanho).toBe("");
  });
});

describe("avisoDoFormulario (pré-visualização)", () => {
  it("monta o aviso como o salvar normaliza: imagem vazia e link sem URL saem", () => {
    const a = avisoDoFormulario({
      ...FORM_VAZIO,
      titulo: "  3 Anos de Empresa ",
      mensagem: "Parabéns pelos 3 anos!",
      imagens: [{ url: " https://x/cartaz.png ", nome: "cartaz.png" }, { url: "  ", nome: "" }],
      imagens_tamanho: "total",
      links: [{ rotulo: "", url: "https://x" }, { rotulo: "vazio", url: " " }],
    }, "Pablo");
    expect(a.titulo).toBe("3 Anos de Empresa");
    expect(a.imagens).toEqual([{ url: "https://x/cartaz.png", nome: "cartaz.png" }]);
    expect(a.anexo_url).toBe("https://x/cartaz.png");
    expect(a.imagens_tamanho).toBe("total");
    expect(a.links).toEqual([{ rotulo: "Link", url: "https://x" }]);
    expect(a.criado_por_nome).toBe("Pablo");
  });

  it("bloquear sem exigir ciência não trava a prévia (igual ao salvar)", () => {
    const a = avisoDoFormulario({ ...FORM_VAZIO, exigir_ciencia: false, bloquear_acesso: true }, null);
    expect(a.bloquear_acesso).toBe(false);
    expect(a.imagens_tamanho).toBeNull();
  });
});
