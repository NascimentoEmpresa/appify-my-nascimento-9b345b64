import { describe, expect, it } from "vitest";
import {
  CAMPOS_PLANILHA, PREFIXO_PROPOSTA, campoPorId, limparTextoCampo, montarPedidoCampo, validarCampo, vereditoDe,
} from "../../supabase/functions/_shared/denuncia-parecer-ia.ts";

const campo = (id: string) => campoPorId(id)!;

describe("campos da planilha de pareceres", () => {
  it("tem os seis botões, com o nome exato das colunas e na ordem da planilha", () => {
    expect(CAMPOS_PLANILHA.map((c) => c.rotulo)).toEqual([
      "Resumo objetivo",
      "Resultado",
      "Medida principal",
      "Pendência atual/Acompanhamento",
      "Decisão final da Presidência da Empresa",
      "Fundamentação da decisão da Presidência da Empresa",
    ]);
  });

  it("só os dois últimos são da Presidência", () => {
    expect(CAMPOS_PLANILHA.filter((c) => c.daPresidencia).map((c) => c.id))
      .toEqual(["decisao_presidencia", "fundamentacao_presidencia"]);
  });

  it("campo desconhecido não existe", () => {
    expect(campoPorId("salario")).toBeUndefined();
  });
});

describe("montarPedidoCampo", () => {
  it("pede um parágrafo sem markdown e manda não inventar", () => {
    const p = montarPedidoCampo(campo("resumo_objetivo"), false);
    expect(p).toContain('"Resumo objetivo"');
    expect(p).toMatch(/Sem markdown/);
    expect(p).toMatch(/em vez de inventar/);
  });

  it("Resultado exige o veredito na frente", () => {
    expect(montarPedidoCampo(campo("resultado"), true)).toMatch(/Procedente parcial, Procedente, Improcedente, Inconclusivo/);
  });

  it("campo da Presidência sem decisão vira pedido de PROPOSTA", () => {
    expect(montarPedidoCampo(campo("decisao_presidencia"), false)).toContain(PREFIXO_PROPOSTA.trim());
    expect(montarPedidoCampo(campo("decisao_presidencia"), true)).not.toContain("PROPOSTA");
  });

  it("campo do Comitê não fala em proposta da Presidência", () => {
    expect(montarPedidoCampo(campo("resumo_objetivo"), false)).not.toContain(PREFIXO_PROPOSTA.trim());
  });

  it("os exemplos de estilo não levam nomes dos casos da planilha", () => {
    const todos = CAMPOS_PLANILHA.map((c) => c.exemplo).join(" ");
    for (const nome of ["Daison", "Marcelo", "Talita", "Eduarda", "Diana"]) expect(todos).not.toContain(nome);
  });
});

describe("limparTextoCampo", () => {
  it("tira markdown, rótulo, aspas e junta em um parágrafo", () => {
    const t = limparTextoCampo('**Resumo objetivo:** "O relato atribui\n\n- contatos sem consentimento."', campo("resumo_objetivo"));
    expect(t).toBe("O relato atribui contatos sem consentimento.");
  });
});

describe("vereditoDe", () => {
  it("normaliza para a grafia da planilha", () => {
    expect(vereditoDe("Parcialmente procedente - x")).toBe("Procedente parcial");
    expect(vereditoDe("Procedente parcial - x")).toBe("Procedente parcial");
    expect(vereditoDe("procedente - x")).toBe("Procedente");
    expect(vereditoDe("Inconclusivo - x")).toBe("Inconclusivo");
    expect(vereditoDe("O caso é procedente")).toBeNull();
  });
});

describe("validarCampo", () => {
  it("Resultado sem veredito é recusado", () => {
    const v = validarCampo("Ficou confirmado que a comunicação foi inadequada entre as áreas.", campo("resultado"), false);
    expect(v.ok).toBe(false);
  });

  it("Resultado sai como 'Veredito - justificativa'", () => {
    const v = validarCampo("Parcialmente procedente: confirmada a inadequação da forma de comunicação.", campo("resultado"), false);
    expect(v).toEqual({ ok: true, texto: "Procedente parcial - confirmada a inadequação da forma de comunicação." });
  });

  it("Decisão sem decisão registrada ganha o prefixo de proposta se a I.A esquecer", () => {
    const v = validarCampo("A Presidência acolhe a recomendação do Comitê e determina advertência.", campo("decisao_presidencia"), false);
    expect(v.ok && v.texto.startsWith(PREFIXO_PROPOSTA)).toBe(true);
  });

  it("não duplica o prefixo quando a I.A já escreveu 'Proposta'", () => {
    const v = validarCampo("Proposta (não há decisão registrada da Presidência): acolher a recomendação.", campo("fundamentacao_presidencia"), false);
    expect(v.ok && v.texto.match(/Proposta/g)?.length).toBe(1);
  });

  it("com decisão registrada não há prefixo", () => {
    const v = validarCampo("A Presidência acolheu integralmente a recomendação do Comitê.", campo("decisao_presidencia"), true);
    expect(v.ok && v.texto.startsWith("A Presidência")).toBe(true);
  });

  it("texto curto demais é recusado", () => {
    expect(validarCampo("ok", campo("medida_principal"), true).ok).toBe(false);
  });

  it("texto longo é cortado na última frase inteira", () => {
    const frase = "Esta é uma frase de teste com tamanho razoável para encher o campo. ";
    const v = validarCampo(frase.repeat(40), campo("medida_principal"), true);
    expect(v.ok && v.texto.length <= campo("medida_principal").max && v.texto.endsWith(".")).toBe(true);
  });
});
