import { describe, it, expect } from "vitest";
import {
  naoLidas, rotuloContador, validarNovidade, paraBanco, selo, ehRecente,
  fmtQuando, FORM_VAZIO, TIPOS, type Novidade,
} from "@/lib/novidades";
import { CSS_NOVIDADES } from "@/components/novidades/estilos";

const nova = (id: number, extra: Partial<Novidade> = {}): Novidade => ({
  id, titulo: `Novidade ${id}`, descricao: "mudou isso", tipo: "NOVO",
  rota: null, publicado: true, publicado_em: "2026-08-20T12:00:00Z", ...extra,
});

describe("não lidas", () => {
  it("conta só o que a pessoa ainda não viu", () => {
    const lista = [nova(1), nova(2), nova(3)];
    expect(naoLidas(lista, [2]).map(n => n.id)).toEqual([1, 3]);
    expect(naoLidas(lista, [1, 2, 3])).toEqual([]);
    expect(naoLidas(lista, []).length).toBe(3);
  });

  it("rascunho não acende a bolinha de ninguém", () => {
    // Só quem publica enxerga o rascunho; ele não é novidade para o resto.
    const lista = [nova(1), nova(2, { publicado: false })];
    expect(naoLidas(lista, []).map(n => n.id)).toEqual([1]);
  });

  it("o contador para em 9+", () => {
    expect(rotuloContador(0)).toBe("0");
    expect(rotuloContador(9)).toBe("9");
    expect(rotuloContador(10)).toBe("9+");
    expect(rotuloContador(240)).toBe("9+");
  });
});

describe("validação do formulário", () => {
  const base = { ...FORM_VAZIO, titulo: "Novo módulo de Diárias", descricao: "Agora dá pra pedir diária." };

  it("aceita a novidade completa", () => {
    expect(validarNovidade(base)).toBeNull();
    expect(validarNovidade({ ...base, rota: "/app/rh/colaboradores" })).toBeNull();
  });

  it("cobra título e descrição", () => {
    expect(validarNovidade({ ...base, titulo: "   " })).toMatch(/título/i);
    expect(validarNovidade({ ...base, titulo: "Oi" })).toMatch(/curto/i);
    expect(validarNovidade({ ...base, descricao: "" })).toMatch(/mudou/i);
  });

  it("recusa link que não é rota interna do ERP", () => {
    // O "Saiba mais" navega dentro do ERP: link externo (ou javascript:) não
    // tem o que fazer no changelog interno.
    expect(validarNovidade({ ...base, rota: "https://exemplo.com" })).toMatch(/rota interna/i);
    expect(validarNovidade({ ...base, rota: "javascript:alert(1)" })).toMatch(/rota interna/i);
    expect(validarNovidade({ ...base, rota: "//evil.com" })).toMatch(/rota interna|externo/i);
    expect(validarNovidade({ ...base, rota: "app/rh" })).toMatch(/rota interna/i);
  });
});

describe("o que vai pro banco", () => {
  it("apara os campos e transforma rota vazia em null", () => {
    const linha = paraBanco({ ...FORM_VAZIO, titulo: "  Título  ", descricao: " texto ", rota: "   " }, " Pablo ");
    expect(linha).toEqual({
      titulo: "Título", descricao: "texto", tipo: "NOVO",
      rota: null, publicado: true, criado_por_nome: "Pablo",
    });
  });

  it("mantém a rota preenchida", () => {
    expect(paraBanco({ ...FORM_VAZIO, titulo: "t", descricao: "d", rota: "/app/novidades" }).rota)
      .toBe("/app/novidades");
  });
});

describe("selo do tipo", () => {
  it("acha o selo de cada tipo e cai no NOVO quando não conhece", () => {
    expect(selo("MELHORIA").rotulo).toBe("Melhoria");
    expect(selo("ajuste").rotulo).toBe("Ajuste");
    expect(selo("QUALQUER COISA").valor).toBe("NOVO");
    expect(selo(null).valor).toBe("NOVO");
    expect(TIPOS).toHaveLength(4);
  });
});

describe("datas", () => {
  const agora = new Date("2026-08-20T15:00:00Z");

  it("fala em dias enquanto é recente e vira data depois", () => {
    expect(fmtQuando("2026-08-20T09:00:00Z", agora)).toBe("hoje");
    expect(fmtQuando("2026-08-19T09:00:00Z", agora)).toBe("ontem");
    expect(fmtQuando("2026-08-17T09:00:00Z", agora)).toBe("há 3 dias");
    expect(fmtQuando("2026-07-01T09:00:00Z", agora)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(fmtQuando(null, agora)).toBe("—");
  });

  it("recente é até 7 dias — é o que acende o selo no menu", () => {
    expect(ehRecente("2026-08-19T15:00:00Z", agora)).toBe(true);
    expect(ehRecente("2026-08-13T16:00:00Z", agora)).toBe(true);
    expect(ehRecente("2026-08-01T15:00:00Z", agora)).toBe(false);
    expect(ehRecente("", agora)).toBe(false);
  });
});

// ── CSS: duas armadilhas que já morderam ────────────────────────────────

describe("CSS das novidades", () => {
  it("não tem crase dentro do template literal", () => {
    // Uma crase no comentário fecha a string e o arquivo inteiro deixa de
    // compilar. Aconteceu duas vezes escrevendo `backwards` no comentário.
    expect(CSS_NOVIDADES).not.toContain("`");
  });

  it("o label genérico do formulário não pega o interruptor", () => {
    // `.nov-fg label` tem especificidade 0,1,1 e vence `.nov-switch` (0,1,0).
    // Sem o :not(), o interruptor volta a display:block, o trilho vira inline
    // (onde width/height não valem) e a bolinha cai em cima do texto.
    const regra = CSS_NOVIDADES.split("\n").find(l => l.includes(".nov-fg label"));
    expect(regra).toBeDefined();
    expect(regra).toContain(":not(.nov-switch)");
  });

  it("o interruptor é flex e o trilho tem tamanho", () => {
    expect(CSS_NOVIDADES).toMatch(/\.nov-switch\{[^}]*display:flex/);
    expect(CSS_NOVIDADES).toMatch(/\.nov-switch-tr\{[^}]*width:38px/);
  });

  it("o cartão da lista nasce visível — animação só o traz de fora", () => {
    // Base opacity:0 + forwards deixaria o item invisível para sempre se a
    // animação não rodar (aba oculta, impressão, extensão que desliga).
    const regra = CSS_NOVIDADES.slice(CSS_NOVIDADES.indexOf(".nov-item{"));
    const corpo = regra.slice(0, regra.indexOf("}"));
    expect(corpo).not.toMatch(/opacity:0/);
    expect(corpo).toContain("backwards");
  });
});
