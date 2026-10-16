import { describe, expect, it } from "vitest";
import {
  FORM_VAZIO, avisoDoFormulario, botoesDoAviso, classeCaixaImagem, contagemPorBotao, erroDoFormulario,
  formDoAviso, alturaImagemLado, larguraColunaImagem, larguraJanelaAviso, posicaoImagemDe, respostaDe,
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

// Pedido do Pablo (16/10/2026): "escolher quais vão ser os botões, não só
// concordo ou discordo". O botão apertado fica gravado (resposta = texto).
describe("botões de resposta próprios", () => {
  const base = { ...FORM_VAZIO, titulo: "Confraternização", mensagem: "Sexta, às 18h, no pátio." };

  it("aviso antigo, sem botões, segue no Concordo/Discordo ou Estou ciente", () => {
    expect(botoesDoAviso({ botoes: null })).toEqual([]);
    expect(botoesDoAviso({ botoes: undefined })).toEqual([]);
  });

  it("botão sem texto some e estilo desconhecido vira principal", () => {
    expect(botoesDoAviso({ botoes: [{ rotulo: " Vou ", estilo: "neon" as never }, { rotulo: " ", estilo: "perigo" }] }))
      .toEqual([{ rotulo: "Vou", estilo: "principal" }]);
  });

  it("o formulário recusa texto vazio, repetido e mais que o máximo", () => {
    expect(erroDoFormulario({ ...base, botoes: [{ rotulo: "", estilo: "principal" }] })).toMatch(/texto/);
    expect(erroDoFormulario({ ...base, botoes: [{ rotulo: "Vou", estilo: "principal" }, { rotulo: "vou", estilo: "contorno" }] })).toMatch(/mesmo texto/);
    expect(erroDoFormulario({ ...base, botoes: Array.from({ length: 5 }, (_, i) => ({ rotulo: `B${i}`, estilo: "principal" as const })) })).toMatch(/máximo/);
    expect(erroDoFormulario({ ...base, botoes: [{ rotulo: "Vou", estilo: "principal" }, { rotulo: "Não vou", estilo: "perigo" }] })).toBeNull();
  });

  it("a prévia leva os botões; sem ciência, o formulário não reclama deles", () => {
    expect(avisoDoFormulario({ ...base, botoes: [{ rotulo: "Vou", estilo: "principal" }] }, null).botoes)
      .toEqual([{ rotulo: "Vou", estilo: "principal" }]);
    expect(erroDoFormulario({ ...base, exigir_ciencia: false, bloquear_acesso: false, botoes: [{ rotulo: "", estilo: "principal" }] })).toBeNull();
  });

  it("conta por botão, na ordem dos botões, e não perde resposta de botão renomeado", () => {
    const c = (resposta: string | null, escolha: "CIENTE" | "CONCORDO" = "CIENTE") =>
      ({ notificacao_id: 1, user_id: Math.random().toString(), escolha, respondido_em: "", resposta });
    const linhas = contagemPorBotao(
      [{ rotulo: "Vou", estilo: "principal" }, { rotulo: "Não vou", estilo: "perigo" }],
      [c("Não vou"), c("Vou"), c("Não vou"), c("Talvez")],
    );
    expect(linhas.map((l) => [l.rotulo, l.total])).toEqual([["Vou", 1], ["Não vou", 2], ["Talvez", 1]]);
    expect(respostaDe(c(null, "CONCORDO"))).toBe("Concordo");
  });
});

// Pedido do Pablo (16/10/2026), foto no notebook: imagem quadrada em cima
// obrigava a rolar. Imagem ao lado do texto, escolhível; aviso novo nasce assim.
describe("posição da imagem", () => {
  it("aviso antigo (NULL) fica com a imagem em cima; aviso novo nasce ao lado", () => {
    expect(posicaoImagemDe(null)).toBe("cima");
    expect(posicaoImagemDe("diagonal")).toBe("cima");
    expect(posicaoImagemDe("lado")).toBe("lado");
    expect(FORM_VAZIO.imagens_posicao).toBe("lado");
  });

  it("vai para a prévia e volta na edição", () => {
    const a = avisoDoFormulario({ ...FORM_VAZIO, titulo: "t", mensagem: "mensagem longa", imagens_posicao: "cima" }, null);
    expect(a.imagens_posicao).toBe("cima");
    expect(formDoAviso({ ...a, id: 2, imagens_posicao: "lado" } as Notificacao).imagens_posicao).toBe("lado");
    expect(formDoAviso({ ...a, id: 2, imagens_posicao: null } as Notificacao).imagens_posicao).toBe("cima");
  });

  it("ao lado, a janela alarga; o tamanho é o teto da altura e a tela é o chão", () => {
    expect(larguraJanelaAviso("", "lado")).toContain("max-w-4xl");
    expect(larguraJanelaAviso("grande", "lado")).toContain("max-w-5xl");
    expect(larguraJanelaAviso("", "cima")).toBe("max-w-lg");
    expect(alturaImagemLado("pequena")).toContain("20rem");
    expect(alturaImagemLado("total")).toContain("48rem");
    // Sempre presa à altura da tela; a prévia desconta a faixa do topo.
    expect(alturaImagemLado("")).toContain("100dvh - 19.5rem");
    expect(alturaImagemLado("", true)).toContain("100dvh - 22.5rem");
  });

  // Print do Pablo (16/10/2026): cartaz quadrado com faixa cinza dos lados.
  it("a coluna da imagem tem a largura da proporção da imagem, com limites", () => {
    const h = alturaImagemLado("");
    expect(larguraColunaImagem(h, null)).toBe("45%");
    expect(larguraColunaImagem(h, 1)).toBe(`clamp(15rem, calc(${h} * 1.0000 + 2rem), 58%)`);
    expect(larguraColunaImagem(h, 0.8)).toContain("* 0.8000");
    expect(larguraColunaImagem(h, Infinity)).toBe("45%");
  });

  it("toda caixa fixa tem a altura presa à tela (vh), para caber no notebook", () => {
    for (const t of ["pequena", "media", "grande", "total"] as const) expect(classeCaixaImagem(t)).toMatch(/vh/);
  });
});
