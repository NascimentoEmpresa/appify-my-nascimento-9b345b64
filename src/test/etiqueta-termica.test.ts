import { describe, expect, it } from "vitest";
import {
  MEDIDAS, TITULO_ENVIADOS, TITULO_PENDENTES, htmlEtiqueta, linhaItem, textoItens, urlRetirada,
  type DadosEtiqueta,
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
    { id: "i1", ordem: 1, nome_item: "BABUCHE - PRETO", tamanho: "40", quantidade: 2, litros: null },
    { id: "i2", ordem: 2, nome_item: "DETERGENTE", tamanho: null, quantidade: 1, litros: "5" },
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

/**
 * QR code de retirada: o supervisor da frota lê na rua, fora do horário, e
 * confirma que levou o volume. Sem ele na etiqueta padrão, a retirada volta a
 * não ter dono.
 */
describe("etiqueta térmica — QR code de retirada", () => {
  const qr = "data:image/png;base64,iVBORw0KGgo=";

  it("a etiqueta padrão imprime o QR quando ele vem pronto", () => {
    const html = htmlEtiqueta({ ...dados, qrDataUrl: qr }, "PADRAO", "");
    expect(html).toContain(`<img src="${qr}"`);
    expect(html).toContain("leia ao retirar");
  });

  it("sem QR gerado, a etiqueta sai normalmente — sem imagem quebrada", () => {
    const html = htmlEtiqueta({ ...dados, qrDataUrl: null }, "PADRAO", "");
    expect(html).not.toContain("<img");
    expect(html).toContain("PED-MTKBLVDD-W486CZ8");
  });

  it("a compacta não leva QR: em 4x5 cm ele tomaria o lugar do nome", () => {
    expect(htmlEtiqueta({ ...dados, qrDataUrl: qr }, "COMPACTO", "")).not.toContain("<img");
  });

  it("o QR aponta para a tela de retirada pelo id do pedido", () => {
    expect(urlRetirada("7b1e0c1a-0000-4000-8000-000000000001", "https://erp.exemplo"))
      .toBe("https://erp.exemplo/app/suprimentos/retirada/7b1e0c1a-0000-4000-8000-000000000001");
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

/**
 * A etiqueta saía com uma categoria só, e quem conferia o volume não
 * distinguia o que já tinha ido do que ainda faltava sem voltar ao sistema.
 * O que se garante aqui é que o pedido INTEIRO sai, nas duas seções, e que
 * seção vazia não vira título sozinho.
 */
describe("texto dos itens — enviados x pendentes", () => {
  it("sem etiqueta baixada, o pedido inteiro é pendente e sai uma seção só", () => {
    const texto = textoItens(dados);
    expect(texto).toBe(
      "ITENS PENDENTES DE ENVIO:\n" +
      "• BABUCHE - PRETO — Tam. 40 — Qtd. 2\n" +
      "• DETERGENTE — 5 L — Qtd. 1",
    );
    expect(texto).not.toContain(TITULO_ENVIADOS);
  });

  it("pedido todo despachado sai só como enviado", () => {
    const texto = textoItens(dados, [
      { pedido_item_id: "i1", quantidade: 2 },
      { pedido_item_id: "i2", quantidade: 1 },
    ]);
    expect(texto).toContain(TITULO_ENVIADOS);
    expect(texto).not.toContain(TITULO_PENDENTES);
    expect(texto).toContain("• BABUCHE - PRETO — Tam. 40 — Qtd. 2");
    expect(texto).toContain("• DETERGENTE — 5 L — Qtd. 1");
  });

  it("despacho parcial imprime as duas seções, sem misturar categorias", () => {
    const texto = textoItens(dados, [{ pedido_item_id: "i1", quantidade: 1 }]);
    const [secaoEnviados, secaoPendentes] = texto.split("\n\n");

    expect(secaoEnviados).toBe("ITENS ENVIADOS:\n• BABUCHE - PRETO — Tam. 40 — Qtd. 1");
    expect(secaoPendentes).toBe(
      "ITENS PENDENTES DE ENVIO:\n" +
      "• BABUCHE - PRETO — Tam. 40 — Qtd. 1\n" +
      "• DETERGENTE — 5 L — Qtd. 1",
    );
    // O item só do pendente não pode aparecer na seção de enviados.
    expect(secaoEnviados).not.toContain("DETERGENTE");
  });

  it("nenhuma linha do pedido some da etiqueta impressa", () => {
    const html = htmlEtiqueta(dados, "PADRAO", textoItens(dados, [{ pedido_item_id: "i2", quantidade: 1 }]));
    expect(html).toContain("BABUCHE - PRETO");
    expect(html).toContain("DETERGENTE");
    expect(html).toContain("ITENS ENVIADOS:");
    expect(html).toContain("ITENS PENDENTES DE ENVIO:");
  });

  it("item pedido a mais do que saiu não gera linha pendente negativa", () => {
    const texto = textoItens(dados, [{ pedido_item_id: "i1", quantidade: 5 }]);
    expect(texto).toContain("ITENS ENVIADOS:\n• BABUCHE - PRETO — Tam. 40 — Qtd. 5");
    expect(texto).not.toContain("Qtd. -");
  });
});
