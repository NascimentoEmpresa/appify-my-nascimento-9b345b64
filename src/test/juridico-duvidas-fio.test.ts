import { describe, it, expect } from "vitest";
import { agruparComplementos, complementoPendente, infoAvaliacao, podeAvaliar, podeComplementar, type Complemento } from "@/lib/juridico/duvidas";

// Parecer Jurídico (17/09/2026): depois da resposta, quem perguntou avalia e
// continua perguntando no mesmo fio. O que este arquivo trava: quem pode o
// quê, e quando o Jurídico "deve" um complemento.
const c = (id: number, duvida_id: number, tipo: Complemento["tipo"]): Complemento => ({ id, duvida_id, tipo, texto: "x" });

describe("fio de complementos", () => {
  it("o Jurídico deve complemento quando o último item do fio é uma pergunta", () => {
    expect(complementoPendente([])).toBe(false);
    expect(complementoPendente([c(1, 9, "pergunta")])).toBe(true);
    expect(complementoPendente([c(1, 9, "pergunta"), c(2, 9, "resposta")])).toBe(false);
    expect(complementoPendente([c(1, 9, "pergunta"), c(2, 9, "resposta"), c(3, 9, "pergunta")])).toBe(true);
  });

  it("agrupa por dúvida na ordem do fio, mesmo recebendo do mais novo pro mais velho", () => {
    const m = agruparComplementos([c(3, 9, "pergunta"), c(2, 9, "resposta"), c(1, 9, "pergunta"), c(4, 7, "pergunta")]);
    expect(m.get(9)!.map(x => x.id)).toEqual([1, 2, 3]);
    expect(m.get(7)!.map(x => x.id)).toEqual([4]);
    expect(m.get(5)).toBeUndefined();
  });
});

describe("quem pode avaliar e perguntar mais", () => {
  const d = { autor_id: "u1", status: "Respondida" };
  it("só o autor, e só depois de respondida", () => {
    expect(podeComplementar(d, "u1")).toBe(true);
    expect(podeAvaliar(d, "u1")).toBe(true);
    expect(podeComplementar(d, "u2")).toBe(false);
    expect(podeComplementar({ ...d, status: "Aprovada" }, "u1")).toBe(false);
    expect(podeComplementar(d, null)).toBe(false);
  });
  it("avaliação desconhecida não vira etiqueta", () => {
    expect(infoAvaliacao("resolveu")?.rotulo).toBe("Resolveu minha dúvida");
    expect(infoAvaliacao(null)).toBeNull();
  });
});
