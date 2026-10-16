import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimacaoAviso } from "@/components/notificacoes/AnimacaoAviso";
import { FORM_VAZIO, animacaoDe, avisoDoFormulario, formDoAviso, type Notificacao } from "@/lib/notificacoes";

// Pedido do Pablo (16/10/2026): animação comemorativa ao abrir o aviso
// (confetes, estrelas...), que aparece também na prévia. Aviso antigo sem.

function movimento(reduzido: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduzido && q.includes("reduce"), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
}

afterEach(() => vi.unstubAllGlobals());

describe("animação do aviso", () => {
  it("aviso antigo (NULL) e valor estranho ficam sem animação", () => {
    expect(animacaoDe(null)).toBe("");
    expect(animacaoDe("disco")).toBe("");
    expect(animacaoDe("confetes")).toBe("confetes");
  });

  it("vai do formulário para a prévia e volta na edição", () => {
    const a = avisoDoFormulario({ ...FORM_VAZIO, titulo: "t", mensagem: "mensagem longa", animacao: "estrelas" }, null);
    expect(a.animacao).toBe("estrelas");
    expect(formDoAviso({ ...a, id: 5 } as Notificacao).animacao).toBe("estrelas");
    expect(avisoDoFormulario({ ...FORM_VAZIO, titulo: "t", mensagem: "mensagem longa" }, null).animacao).toBeNull();
  });

  it("sem animação escolhida não desenha nada", () => {
    movimento(false);
    const { container } = render(<AnimacaoAviso tipo="" chave={1} />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("com prefers-reduced-motion não desenha nada", () => {
    movimento(true);
    const { container } = render(<AnimacaoAviso tipo="confetes" chave={1} />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("com movimento liberado, põe o canvas por cima sem pegar clique", () => {
    movimento(false);
    const { container } = render(<AnimacaoAviso tipo="confetes" chave={1} />);
    const c = container.querySelector("canvas");
    expect(c).not.toBeNull();
    expect(c!.className).toContain("pointer-events-none");
  });
});
