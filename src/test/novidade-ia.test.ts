import { describe, it, expect } from "vitest";
import {
  decidir, descartePrevio, extrairJson, limparVazamentos, montarPrompt,
  SELO_SUGERIDO, TIPOS_NOVIDADE, type ChamadoParaNovidade,
} from "../../supabase/functions/_shared/novidade-ia.ts";

const chamado = (extra: Partial<ChamadoParaNovidade> = {}): ChamadoParaNovidade => ({
  id: "11111111-1111-1111-1111-111111111111",
  numero: "SIS-2026-0042",
  assunto: "Tela de colaboradores demora para abrir",
  tipo_solicitacao: "correcao",
  descricao: "Quando abro a lista de colaboradores ela fica carregando por quase um minuto.",
  categorias: ["desempenho"],
  modulo_sistema: "rh",
  modulo_sistema_outro: null,
  ambiente: "producao",
  status: "concluido",
  concluido_em: "2026-08-21T12:00:00Z",
  solicitante_nome: "Mariana Ferreira Lopes",
  setor: "Recursos Humanos",
  ...extra,
});

const respostaOk = {
  relevante: true,
  tipo: "AJUSTE",
  titulo: "Lista de colaboradores volta a abrir na hora",
  descricao: "A tela de colaboradores do RH carrega imediatamente, mesmo com o cadastro completo.",
};

describe("descarte antes da IA", () => {
  it("dúvida/orientação não vira novidade", () => {
    expect(descartePrevio(chamado({ tipo_solicitacao: "duvida" }))).toBe("duvida");
  });

  it("fora de produção não vira novidade", () => {
    expect(descartePrevio(chamado({ ambiente: "homologacao" }))).toBe("nao_producao");
    expect(descartePrevio(chamado({ ambiente: "teste" }))).toBe("nao_producao");
  });

  it("correção em produção passa", () => {
    expect(descartePrevio(chamado())).toBeNull();
    // ambiente ausente é tratado como produção (default da coluna)
    expect(descartePrevio(chamado({ ambiente: null }))).toBeNull();
  });
});

describe("prompt", () => {
  it("não leva nome de quem abriu, número do chamado nem setor", () => {
    const p = montarPrompt(chamado());
    expect(p).not.toContain("Mariana");
    expect(p).not.toContain("SIS-2026-0042");
    expect(p).not.toContain("Recursos Humanos");
  });

  it("leva assunto, módulo e o relato", () => {
    const p = montarPrompt(chamado());
    expect(p).toContain("Tela de colaboradores demora para abrir");
    expect(p).toContain("rh");
    expect(p).toContain("quase um minuto");
  });

  it("inclui o título da PR quando existe", () => {
    const p = montarPrompt(chamado(), "SIS-2026-0042 RH: paginação na lista de colaboradores");
    expect(p).toContain("paginação na lista de colaboradores");
  });

  it("sugere o selo pelo tipo do chamado", () => {
    expect(montarPrompt(chamado({ tipo_solicitacao: "melhoria" }))).toContain("MELHORIA");
    expect(SELO_SUGERIDO.correcao).toBe("AJUSTE");
  });

  it("usa o módulo digitado quando o chamado é 'outro'", () => {
    const p = montarPrompt(chamado({ modulo_sistema: "outro", modulo_sistema_outro: "Portal do Candidato" }));
    expect(p).toContain("Portal do Candidato");
  });
});

describe("extrair JSON", () => {
  it("lê JSON puro", () => {
    expect(extrairJson('{"relevante":true}')).toEqual({ relevante: true });
  });

  it("lê JSON embrulhado em cerca de código", () => {
    expect(extrairJson('```json\n{"relevante":false}\n```')).toEqual({ relevante: false });
  });

  it("lê JSON com conversa em volta", () => {
    expect(extrairJson('Claro! Aqui está:\n{"tipo":"NOVO"}\nEspero ter ajudado.')).toEqual({ tipo: "NOVO" });
  });

  it("devolve null quando não há JSON", () => {
    expect(extrairJson("desculpe, não consegui")).toBeNull();
    expect(extrairJson("")).toBeNull();
  });
});

describe("limpar vazamentos", () => {
  it("tira o número do chamado", () => {
    const t = limparVazamentos("Conforme o SIS-2026-0042, a tela foi corrigida", chamado());
    expect(t).not.toContain("SIS-2026-0042");
    expect(t).toContain("a tela foi corrigida");
  });

  it("tira qualquer número de chamado, não só o do próprio", () => {
    expect(limparVazamentos("Resolvido no SIS-2025-0009", chamado())).not.toContain("SIS-2025-0009");
  });

  it("tira o nome completo e o primeiro nome de quem abriu", () => {
    expect(limparVazamentos("Pedido de Mariana Ferreira Lopes atendido", chamado())).not.toMatch(/Mariana/i);
    expect(limparVazamentos("Conforme relatado por Mariana, já funciona", chamado())).not.toMatch(/Mariana/i);
    expect(limparVazamentos("mariana pediu isso", chamado())).not.toMatch(/mariana/i);
  });

  it("não come o texto quando não há nome para limpar", () => {
    const c = chamado({ solicitante_nome: null, numero: null });
    expect(limparVazamentos("A tela carrega na hora.", c)).toBe("A tela carrega na hora.");
  });
});

describe("decidir o que publicar", () => {
  it("publica uma resposta boa", () => {
    const r = decidir(respostaOk, chamado());
    expect(r.publicar).toBe(true);
    if (r.publicar) {
      expect(r.novidade.tipo).toBe("AJUSTE");
      expect(r.novidade.titulo).toBe("Lista de colaboradores volta a abrir na hora");
    }
  });

  it("respeita o descarte prévio mesmo com resposta boa da IA", () => {
    const r = decidir(respostaOk, chamado({ tipo_solicitacao: "duvida" }));
    expect(r).toEqual({ publicar: false, motivo: "duvida" });
  });

  it("não publica quando a IA marca relevante = false", () => {
    const r = decidir({ ...respostaOk, relevante: false }, chamado());
    expect(r).toEqual({ publicar: false, motivo: "ia_descartou" });
  });

  it("não publica com tipo fora dos quatro selos", () => {
    const r = decidir({ ...respostaOk, tipo: "URGENTE" }, chamado());
    expect(r.publicar).toBe(false);
    if (!r.publicar) expect(r.motivo).toBe("resposta_invalida");
  });

  it("aceita o tipo em minúsculas", () => {
    const r = decidir({ ...respostaOk, tipo: "melhoria" }, chamado());
    expect(r.publicar).toBe(true);
    if (r.publicar) expect(TIPOS_NOVIDADE).toContain(r.novidade.tipo);
  });

  it("não publica título ou descrição vazios", () => {
    expect(decidir({ ...respostaOk, titulo: "" }, chamado()).publicar).toBe(false);
    expect(decidir({ ...respostaOk, descricao: "ok" }, chamado()).publicar).toBe(false);
  });

  it("não publica lixo", () => {
    expect(decidir(null, chamado()).publicar).toBe(false);
    expect(decidir("não sei", chamado()).publicar).toBe(false);
  });

  it("limpa o vazamento antes de publicar, em vez de descartar", () => {
    const r = decidir({
      ...respostaOk,
      titulo: "SIS-2026-0042 corrigido",
      descricao: "Conforme Mariana relatou, a lista de colaboradores agora abre na hora.",
    }, chamado());
    expect(r.publicar).toBe(true);
    if (r.publicar) {
      expect(r.novidade.titulo).not.toContain("SIS-2026-0042");
      expect(r.novidade.descricao).not.toMatch(/Mariana/i);
      expect(r.novidade.descricao).toContain("abre na hora");
    }
  });

  it("corta texto longo demais para o card", () => {
    const r = decidir({
      ...respostaOk,
      titulo: "T".repeat(200),
      descricao: "D".repeat(900),
    }, chamado());
    expect(r.publicar).toBe(true);
    if (r.publicar) {
      expect(r.novidade.titulo.length).toBeLessThanOrEqual(90);
      expect(r.novidade.descricao.length).toBeLessThanOrEqual(400);
    }
  });

  it("tira o ponto final do título (o card não usa)", () => {
    const r = decidir({ ...respostaOk, titulo: "A lista abre na hora." }, chamado());
    if (r.publicar) expect(r.novidade.titulo).toBe("A lista abre na hora");
  });
});
