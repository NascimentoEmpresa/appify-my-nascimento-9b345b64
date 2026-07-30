import { describe, it, expect } from "vitest";
import {
  rotearBot, inferirModo, type BotConfig,
} from "../../supabase/functions/_shared/whatsapp-bot.ts";

// Config mínima do bot com um menu de 3 opções (texto / ia / humano). O reducer
// e o inferidor de modo são puros, então dá para exercitar o fluxo inteiro sem
// banco, sem WhatsApp e sem IA.
const cfg = (menu: BotConfig["menu"]): BotConfig => ({
  ativo: true,
  persona: "p",
  fallback: "fb",
  atende_24h: true,
  horario_inicio: "08:00",
  horario_fim: "18:00",
  dias_semana: [0, 1, 2, 3, 4, 5, 6],
  fora_horario_msg: "fora",
  provedor: "groq",
  modelo: "m",
  max_tokens: 512,
  menu,
});

const MENU = {
  titulo: "Selecione uma opção",
  opcoes: [
    { id: "vagas", titulo: "Vagas", acao: "texto" as const, valor: "acesse o site" },
    { id: "ia", titulo: "Atendimento por I.A", acao: "ia" as const, valor: "" },
    { id: "humano", titulo: "Falar com atendente", acao: "humano" as const, valor: "" },
  ],
};

const base = cfg(MENU);

describe("rotearBot — fluxo único guiado por menu", () => {
  it("fora do horário responde o aviso e para", () => {
    const r = rotearBot(base, { modo: "menu", texto: "oi", replyId: null, dentroHorario: false });
    expect(r.tipo).toBe("fora_horario");
  });

  it("texto livre em modo menu só reapresenta o menu (nunca cai direto na IA)", () => {
    const r = rotearBot(base, { modo: "menu", texto: "tem vaga?", replyId: null, dentroHorario: true });
    expect(r).toMatchObject({ tipo: "menu", modo: "menu" });
  });

  it("clique numa opção de texto envia a resposta pronta e mantém o modo menu", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "vagas", dentroHorario: true });
    expect(r).toMatchObject({ tipo: "texto", texto: "acesse o site", modo: "menu" });
  });

  it("clique na opção de IA entra na IA com um aviso e muda o modo", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "ia", dentroHorario: true });
    expect(r.tipo).toBe("ia_intro");
    expect(r.modo).toBe("ia");
  });

  it("clique em atendente encaminha para humano", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "humano", dentroHorario: true });
    expect(r.tipo).toBe("humano");
    expect(r.modo).toBe("menu");
  });

  it("texto livre em modo IA vai para a IA", () => {
    const r = rotearBot(base, { modo: "ia", texto: "tem vaga de cozinheiro?", replyId: null, dentroHorario: true });
    expect(r).toMatchObject({ tipo: "ia", modo: "ia" });
  });

  it('digitar "menu" em modo IA volta para o menu', () => {
    const r = rotearBot(base, { modo: "ia", texto: "menu", replyId: null, dentroHorario: true });
    expect(r).toMatchObject({ tipo: "menu", modo: "menu" });
  });

  it("sem menu configurado a IA atende direto (não deixa a conversa muda)", () => {
    const r = rotearBot(cfg({ titulo: "", opcoes: [] }), { modo: "menu", texto: "oi", replyId: null, dentroHorario: true });
    expect(r.tipo).toBe("ia");
  });

  it("opção que não existe mais reapresenta o menu", () => {
    const r = rotearBot(base, { modo: "menu", texto: null, replyId: "inexistente", dentroHorario: true });
    expect(r.tipo).toBe("menu");
  });
});

describe("inferirModo — reconstrói o modo a partir do histórico", () => {
  it("sem eventos definidores fica no menu", () => {
    expect(inferirModo(base, [{ direcao: "entrada", texto: "oi", payload: null }])).toBe("menu");
  });

  it("depois de clicar na opção de IA a conversa está em modo IA", () => {
    const hist = [
      { direcao: "entrada", texto: "oi", payload: null },
      { direcao: "saida", texto: "Selecione uma opção", payload: null },
      { direcao: "entrada", texto: "Atendimento por I.A", payload: { reply_id: "ia" } },
      { direcao: "saida", texto: "Perfeito!", payload: null },
      { direcao: "entrada", texto: "tem vaga?", payload: null },
    ];
    expect(inferirModo(base, hist)).toBe("ia");
  });

  it('digitar "menu" depois do clique de IA volta o modo para menu', () => {
    const hist = [
      { direcao: "entrada", texto: "Atendimento por I.A", payload: { reply_id: "ia" } },
      { direcao: "entrada", texto: "menu", payload: null },
    ];
    expect(inferirModo(base, hist)).toBe("menu");
  });

  it("um clique em opção de texto mantém o modo menu", () => {
    const hist = [
      { direcao: "entrada", texto: "Atendimento por I.A", payload: { reply_id: "ia" } },
      { direcao: "entrada", texto: "Vagas", payload: { reply_id: "vagas" } },
    ];
    expect(inferirModo(base, hist)).toBe("menu");
  });
});
