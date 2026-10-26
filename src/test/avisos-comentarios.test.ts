import { describe, expect, it } from "vitest";
import {
  FORM_VAZIO, autorDoComentario, avisoDoFormulario, formDoAviso, resumoReacoes, type Notificacao,
} from "@/lib/notificacoes";

// Pedido do Pablo (16/10/2026): "liberar as pessoas pra comentar, se quiser
// comentar anonimamente também [...] podendo reagir com emojis". O anonimato
// de verdade é do banco (gatilho); aqui fica o que a tela decide.

describe("comentários do aviso", () => {
  it("anônimo aparece como Anônimo, mesmo que algum nome tivesse vindo", () => {
    expect(autorDoComentario({ anonimo: true, autor_nome: "Fulano" })).toBe("Anônimo");
    expect(autorDoComentario({ anonimo: false, autor_nome: " Ana " })).toBe("Ana");
    expect(autorDoComentario({ anonimo: false, autor_nome: null })).toBe("(usuário removido)");
  });

  it("anônimo sem comentários ligados não vale (prévia e edição)", () => {
    const base = { ...FORM_VAZIO, titulo: "t", mensagem: "mensagem longa" };
    const a = avisoDoFormulario({ ...base, permitir_comentarios: false, permitir_anonimo: true }, null);
    expect(a.permitir_anonimo).toBe(false);
    const n = { ...a, id: 3, permitir_comentarios: false, permitir_anonimo: true } as Notificacao;
    expect(formDoAviso(n).permitir_anonimo).toBe(false);
    expect(formDoAviso({ ...n, permitir_comentarios: null, permitir_anonimo: null }).permitir_comentarios).toBe(false);
  });
});

describe("resumoReacoes", () => {
  const r = (emoji: string, user_id: string, comentario_id: number | null = null) => ({ emoji, user_id, comentario_id });

  it("conta por emoji, só do alvo pedido, na ordem fixa, e marca a minha", () => {
    const lista = [r("🎉", "a"), r("👍", "b"), r("👍", "eu"), r("👍", "c", 9), r("❤️", "eu", 9)];
    expect(resumoReacoes(lista, null, "eu")).toEqual([
      { emoji: "👍", total: 2, minha: true },
      { emoji: "🎉", total: 1, minha: false },
    ]);
    expect(resumoReacoes(lista, 9, "eu")).toEqual([
      { emoji: "👍", total: 1, minha: false },
      { emoji: "❤️", total: 1, minha: true },
    ]);
  });

  it("sem usuário logado nada é 'minha'", () => {
    expect(resumoReacoes([r("👍", "eu")], null, null)[0].minha).toBe(false);
  });
});
