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

// Biblioteca, avaliação obrigatória e dashboard (17/09/2026, mig 176).
import { diasParaResponder, entraNaBiblioteca, pendentesDeAvaliacao, podePerguntarNova, resumoDashboard, type Duvida } from "@/lib/juridico/duvidas";

const dv = (p: Partial<Duvida>): Duvida => ({ id: 1, titulo: "t", pergunta: "p", status: "Respondida", ...p });

describe("biblioteca e avaliação obrigatória", () => {
  it("'Não resolveu' fica fora da biblioteca; as outras respondidas entram", () => {
    expect(entraNaBiblioteca(dv({ avaliacao: null }))).toBe(true);
    expect(entraNaBiblioteca(dv({ avaliacao: "resolveu" }))).toBe(true);
    expect(entraNaBiblioteca(dv({ avaliacao: "parcial" }))).toBe(true);
    expect(entraNaBiblioteca(dv({ avaliacao: "nao_resolveu" }))).toBe(false);
    expect(entraNaBiblioteca(dv({ status: "Aprovada" }))).toBe(false);
  });
  it("perguntar de novo exige avaliar as respondidas do próprio autor", () => {
    const lista = [
      dv({ id: 1, autor_id: "u1", avaliacao: null }),
      dv({ id: 2, autor_id: "u1", avaliacao: "resolveu" }),
      dv({ id: 3, autor_id: "u2", avaliacao: null }),
      dv({ id: 4, autor_id: "u1", status: "Aprovada" }),
    ];
    expect(pendentesDeAvaliacao(lista, "u1").map(d => d.id)).toEqual([1]);
    expect(podePerguntarNova(lista, "u1")).toBe(false);
    expect(podePerguntarNova(lista, "u2")).toBe(false);
    expect(podePerguntarNova(lista, "u3")).toBe(true);
    expect(podePerguntarNova(lista, null)).toBe(true);
  });
});

describe("dashboard do Parecer Jurídico", () => {
  it("dias para responder", () => {
    expect(diasParaResponder({ created_at: "2026-09-01T10:00:00Z", respondido_em: "2026-09-03T22:00:00Z" })).toBe(2.5);
    expect(diasParaResponder({ created_at: "2026-09-01T10:00:00Z", respondido_em: undefined })).toBeNull();
  });
  it("soma por categoria com satisfação só entre as avaliadas", () => {
    const r = resumoDashboard([
      dv({ id: 1, categoria: "Trabalhista", avaliacao: "resolveu", created_at: "2026-09-01T00:00:00Z", respondido_em: "2026-09-02T00:00:00Z" }),
      dv({ id: 2, categoria: "Trabalhista", avaliacao: "nao_resolveu", created_at: "2026-09-01T00:00:00Z", respondido_em: "2026-09-04T00:00:00Z" }),
      dv({ id: 3, categoria: "Trabalhista", avaliacao: null }),
      dv({ id: 4, categoria: "LGPD", status: "Aberta" }),
    ]);
    expect(r.total).toBe(4); expect(r.respondidas).toBe(3); expect(r.avaliadas).toBe(2);
    expect(r.satisfacao).toBe(50); expect(r.semAvaliacao).toBe(1); expect(r.tempoMedioDias).toBe(2);
    const trab = r.porCategoria.find(c => c.categoria === "Trabalhista")!;
    expect(trab).toMatchObject({ total: 3, respondidas: 3, resolveu: 1, nao_resolveu: 1, sem_avaliacao: 1, satisfacao: 50 });
    expect(r.porCategoria.find(c => c.categoria === "LGPD")!.satisfacao).toBeNull();
    expect(r.naoResolvidas.map(d => d.id)).toEqual([2]);
  });
});
