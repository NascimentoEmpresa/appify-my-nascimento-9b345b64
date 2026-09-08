import { describe, expect, it } from "vitest";
import {
  MEDIDAS, htmlEtiqueta, linhaItem, textoItens, type DadosEtiqueta,
} from "@/lib/suprimentos/etiquetaTermica";

/**
 * A etiqueta reproduz a do sistema antigo. O que se testa aqui é o CONTEÚDO:
 * que nenhum dos campos daquela etiqueta tenha sumido de novo, e que o modelo
 * compacto corte o que foi decidido cortar — não o que sobrou por acidente.
 *
 * Os valores vêm da etiqueta antiga fotografada pelo Compras em 04/09/2026.
 */

const dados: DadosEtiqueta = {
  pedido_id: "PED-MTKBLVDD-W486CZ8",
  status: "AGUARDANDO COMPRA",
  statusRotulo: "Aguardando compra",
  nome_colaborador: "MARCIO AURELIO MEDEIROS DE LIMA",
  matricula_colaborador: "000",
  solicitante: "TIAGO COELHO NUNES",
  funcao_nome: "COLETOR",
  contrato_nome: "TRIUNFO COLETA DE LIXO - 89.2026",
  posto_nome: "COLETOR/GARI",
  itens: [
    { nome_item: "BABUCHE - PRETO", tamanho: "40", quantidade: 2, litros: null },
    { nome_item: "DETERGENTE", tamanho: null, quantidade: 1, litros: "5" },
  ],
};

describe("etiqueta térmica — padrão", () => {
  const html = htmlEtiqueta(dados, "PADRAO", textoItens(dados));

  it("traz todos os campos da etiqueta antiga", () => {
    for (const esperado of [
      "GRUPO NASCIMENTO - COMPRAS",
      "PED-MTKBLVDD-W486CZ8",
      "Aguardando compra",
      "COLABORADOR", "MARCIO AURELIO MEDEIROS DE LIMA",
      "MATRÍCULA", "000",
      "SOLICITANTE", "TIAGO COELHO NUNES",
      "FUNÇÃO", "COLETOR",
      "CONTRATO", "TRIUNFO COLETA DE LIXO - 89.2026",
      "POSTO", "COLETOR/GARI",
    ]) {
      expect(html).toContain(esperado);
    }
  });

  /** Matrícula e solicitante sumiram na primeira versão. Não podem sumir de novo. */
  it("solicitante não se confunde com colaborador", () => {
    expect(html).toContain("TIAGO COELHO NUNES");
    expect(html).toContain("MARCIO AURELIO MEDEIROS DE LIMA");
  });

  it("colaborador sem matrícula ainda imprime o rótulo", () => {
    const semMatricula = htmlEtiqueta({ ...dados, matricula_colaborador: null }, "PADRAO", "");
    expect(semMatricula).toContain("MATRÍCULA");
    expect(semMatricula).toContain("—");
  });

  it("rodapé declara a medida real", () => {
    expect(html).toContain("98x150mm");
    expect(MEDIDAS.PADRAO).toEqual({ largura: 98, altura: 150 });
  });

  it("texto livre entra na etiqueta", () => {
    expect(htmlEtiqueta(dados, "PADRAO", "Entregar ao encarregado")).toContain("Entregar ao encarregado");
  });

  /** Nome com & ou < quebraria o HTML da janela de impressão. */
  it("escapa caracteres de HTML", () => {
    const html = htmlEtiqueta({ ...dados, contrato_nome: "PREF. <SUL> & CIA" }, "PADRAO", "");
    expect(html).toContain("PREF. &lt;SUL&gt; &amp; CIA");
    expect(html).not.toContain("<SUL>");
  });
});

describe("etiqueta térmica — compacta", () => {
  const html = htmlEtiqueta(dados, "COMPACTO", textoItens(dados));

  it("mantém o essencial: protocolo, colaborador, contrato e posto", () => {
    for (const esperado of [
      "PED-MTKBLVDD-W486CZ8",
      "MARCIO AURELIO MEDEIROS DE LIMA",
      "TRIUNFO COLETA DE LIXO - 89.2026",
      "COLETOR/GARI",
    ]) {
      expect(html).toContain(esperado);
    }
  });

  /** Em 40x50 mm cabeçalho, status e itens roubariam o lugar do que se procura. */
  it("corta cabeçalho, status, solicitante e texto livre", () => {
    expect(html).not.toContain("GRUPO NASCIMENTO");
    expect(html).not.toContain("Aguardando compra");
    expect(html).not.toContain("TIAGO COELHO NUNES");
    expect(html).not.toContain("BABUCHE");
  });
});

describe("linha de item", () => {
  it("mostra tamanho e quantidade", () => {
    expect(linhaItem(dados.itens[0])).toBe("• BABUCHE - PRETO — Tam. 40 — Qtd. 2");
  });

  it("troca tamanho por litros quando é o caso", () => {
    expect(linhaItem(dados.itens[1])).toBe("• DETERGENTE — 5 L — Qtd. 1");
  });

  it("pedido sem item não gera cabeçalho de itens vazio", () => {
    expect(textoItens({ ...dados, itens: [] })).toBe("");
  });
});
