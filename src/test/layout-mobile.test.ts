import { describe, expect, it } from "vitest";
import { abaAtiva, abasDaNavegacao, atalhosVisiveis } from "@/lib/layoutMobile";
import { filtrarConversas } from "@/pages/whatsapp/filtroConversas";
import type { WaConversa } from "@/pages/whatsapp/types";

const tudo = () => true;

describe("barra inferior do celular", () => {
  const ids = (a: { id: string }[]) => a.map((x) => x.id);

  it("quem tem tudo vê as 5 abas, o limite para o rótulo caber em 320 px", () => {
    const abas = abasDaNavegacao({ externo: false, temAlcada: true, visivel: tudo });
    expect(ids(abas)).toEqual(["inicio", "whatsapp", "aprovacoes", "tarefas", "menu"]);
  });

  it("não oferece tela que o acesso não libera", () => {
    const abas = abasDaNavegacao({ externo: false, temAlcada: true, visivel: (r) => r !== "/app/whatsapp" });
    expect(ids(abas)).toEqual(["inicio", "aprovacoes", "tarefas", "menu"]);
  });

  it("Aprovar só para quem tem alçada", () => {
    expect(ids(abasDaNavegacao({ externo: false, temAlcada: false, visivel: tudo }))).not.toContain("aprovacoes");
  });

  it("encarregado externo fica só com Início e Menu, mesmo com rota visível", () => {
    expect(ids(abasDaNavegacao({ externo: true, temAlcada: true, visivel: tudo }))).toEqual(["inicio", "menu"]);
  });

  it("Menu não navega: abre a gaveta", () => {
    const menu = abasDaNavegacao({ externo: false, temAlcada: false, visivel: tudo }).at(-1);
    expect(menu).toMatchObject({ id: "menu", to: null });
  });
});

describe("aba acesa", () => {
  const abas = abasDaNavegacao({ externo: false, temAlcada: true, visivel: tudo });

  it("Início só no endereço exato: toda rota do ERP começa com /app", () => {
    expect(abaAtiva("/app", abas)).toBe("inicio");
    expect(abaAtiva("/app/rh/recrutamento", abas)).toBeNull();
  });

  it("sub-rota acende a aba do módulo, sem confundir prefixo parecido", () => {
    expect(abaAtiva("/app/whatsapp/chatbot", abas)).toBe("whatsapp");
    expect(abaAtiva("/app/whatsapp-antigo", abas)).toBeNull();
    expect(abaAtiva("/app/minhas-tarefas", abas)).toBe("tarefas");
  });
});

describe("atalhos do Início", () => {
  it("segue o acesso e a alçada", () => {
    const a = atalhosVisiveis({ temAlcada: false, visivel: (r) => r !== "/app/sistemas/hora-extra" }).map((x) => x.id);
    expect(a).toContain("whatsapp");
    expect(a).not.toContain("aprovacoes");
    expect(a).not.toContain("hora-extra");
  });
  it("nada liberado, nada na grade", () => {
    expect(atalhosVisiveis({ temAlcada: true, visivel: () => false })).toEqual([]);
  });
});

describe("lista de conversas", () => {
  const conversa = (id: string, x: Partial<WaConversa> = {}, etiquetas: string[] = [], nome = id): WaConversa => ({
    id, contato_id: `c${id}`, status: "aberta", bot_ativo: true, atendente_id: null,
    ultima_mensagem_em: "2026-11-06T10:00:00Z", ultima_mensagem_preview: null, ultima_direcao: null,
    nao_lidas: 0, pasta_codigo: null,
    contato: { id: `c${id}`, wa_id: `5511${id}`, nome, nome_manual: null, telefone: null, etiquetas, observacao: null },
    ...x,
  });
  const filtro = { busca: "", etiqueta: "", selecionada: null };

  it("o chip de etiqueta filtra de verdade (acendia e não fazia nada até 06/11/2026)", () => {
    const base = [conversa("a", {}, ["Candidato"]), conversa("b", {}, ["Fornecedor"]), conversa("c")];
    expect(filtrarConversas(base, { ...filtro, etiqueta: "Candidato" }).map((c) => c.id)).toEqual(["a"]);
  });

  it("etiqueta e busca valem juntas", () => {
    const base = [conversa("a", {}, ["Candidato"], "Maria"), conversa("b", {}, ["Candidato"], "João")];
    expect(filtrarConversas(base, { ...filtro, etiqueta: "Candidato", busca: "mari" }).map((c) => c.id)).toEqual(["a"]);
  });

  it("não lida no topo, a aberta não despenca, sem mensagem vai para o fim", () => {
    const base = [
      conversa("recente", { ultima_mensagem_em: "2026-11-06T12:00:00Z" }),
      conversa("nao-lida", { ultima_mensagem_em: "2026-11-01T12:00:00Z", nao_lidas: 2 }),
      conversa("aberta", { ultima_mensagem_em: "2026-11-02T12:00:00Z" }),
      conversa("vazia", { ultima_mensagem_em: null }),
    ];
    expect(filtrarConversas(base, { ...filtro, selecionada: "aberta" }).map((c) => c.id)).toEqual(["aberta", "nao-lida", "recente", "vazia"]);
  });

  it("não altera a lista recebida", () => {
    const base = [conversa("a", { ultima_mensagem_em: null }), conversa("b")];
    filtrarConversas(base, filtro);
    expect(base.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
