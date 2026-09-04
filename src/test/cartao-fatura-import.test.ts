import { describe, it, expect } from "vitest";

// jsdom 20 (versão instalada no projeto) ainda não implementa
// File.prototype.arrayBuffer()/text() (só chegou em versões mais novas) —
// os adaptadores usam os dois pra ler o arquivo de fatura de verdade no
// navegador. Polyfill só pro ambiente de teste, via FileReader (que o
// jsdom já suporta), sem mexer em setup global nem em código de produção.
if (!File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = function (this: File) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
if (!File.prototype.text) {
  File.prototype.text = function (this: File) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
import { extrairParcela, parseDataBRComAno, parseDataBRSemAno, parseValorBR } from "@/lib/cartaoFatura/utils";
import { reconciliar, type ItemExistente } from "@/lib/cartaoFatura/reconciliar";
import { adaptadorPorNomeBanco, extensaoAceita } from "@/lib/cartaoFatura/adaptadores";
import { adaptadorBanrisul } from "@/lib/cartaoFatura/adaptadorBanrisul";
import { adaptadorBancoBrasil } from "@/lib/cartaoFatura/adaptadorBancoBrasil";
import { adaptadorBradesco } from "@/lib/cartaoFatura/adaptadorBradesco";

// SIS-2026-0255: cobre a lógica de parsing/reconciliação de import de
// fatura — as amostras usadas nos adaptadores são as mesmas 3 faturas
// reais inspecionadas com o usuário (Banrisul, Banco do Brasil, Bradesco).

describe("parseValorBR", () => {
  it("valores simples com R$", () => {
    expect(parseValorBR("R$ 24,15")).toBeCloseTo(24.15);
  });
  it("valores negativos (estorno/pagamento)", () => {
    expect(parseValorBR("R$ -149,90")).toBeCloseTo(-149.9);
  });
  it("valores com separador de milhar", () => {
    expect(parseValorBR("-15.925,62")).toBeCloseTo(-15925.62);
    expect(parseValorBR("R$ 1.753,79")).toBeCloseTo(1753.79);
  });
  it("valor numérico já pronto (célula xlsx numérica)", () => {
    expect(parseValorBR(65632.31)).toBe(65632.31);
  });
  it("vazio/nulo vira 0", () => {
    expect(parseValorBR("")).toBe(0);
    expect(parseValorBR(null)).toBe(0);
    expect(parseValorBR(undefined)).toBe(0);
  });
});

describe("parseDataBRComAno", () => {
  it("DD/MM/YYYY vira ISO", () => {
    expect(parseDataBRComAno("12/10/2025")).toBe("2025-10-12");
  });
  it("formato inválido vira null (linha de footer, sem data)", () => {
    expect(parseDataBRComAno("Saldo da Fatura Anterior")).toBeNull();
    expect(parseDataBRComAno("")).toBeNull();
  });
});

describe("parseDataBRSemAno", () => {
  it("mês igual ou anterior ao da competência fica no mesmo ano", () => {
    expect(parseDataBRSemAno("05/08", 2026, 8)).toBe("2026-08-05");
    expect(parseDataBRSemAno("16/07", 2026, 8)).toBe("2026-07-16");
  });
  it("mês posterior ao da competência é do ano anterior (fatura nunca lista transação do futuro)", () => {
    expect(parseDataBRSemAno("25/09", 2026, 8)).toBe("2025-09-25");
    expect(parseDataBRSemAno("27/11", 2026, 8)).toBe("2025-11-27");
  });
});

describe("extrairParcela", () => {
  it("padrão 'PARC NN/NN' (Compras parceladas do Banco do Brasil)", () => {
    const r = extrairParcela("DELL          PARC 11/12 ELDORADO DO");
    expect(r).toEqual({ atual: 11, total: 12, descricaoLimpa: "DELL ELDORADO DO" });
  });
  it("padrão genérico 'NN/NN' solto no fim (Banrisul, Bradesco)", () => {
    const r = extrairParcela("EBN*CANVA0466       10/12               ");
    expect(r?.atual).toBe(10);
    expect(r?.total).toBe(12);
    expect(r?.descricaoLimpa).toBe("EBN*CANVA0466");
  });
  it("compra não parcelada não acha padrão nenhum", () => {
    expect(extrairParcela("MERCADO*MERCADOLIVRE SAO JOSE DO R BRA")).toBeNull();
  });
  it("não confunde CNPJ/código solto com parcela (total > 48)", () => {
    expect(extrairParcela("DEB 0949/06.14217006")).toBeNull();
  });
  it("pega a ÚLTIMA ocorrência plausível, não a primeira", () => {
    const r = extrairParcela("PDV*IRMAOS JOUGLARD 02/02               ");
    expect(r).toEqual({ atual: 2, total: 2, descricaoLimpa: "PDV*IRMAOS JOUGLARD" });
  });
});

describe("adaptadores — registro por banco", () => {
  it("acha o adaptador pelo nome (case-insensitive)", () => {
    expect(adaptadorPorNomeBanco("banrisul")?.nomeBanco).toBe("Banrisul");
    expect(adaptadorPorNomeBanco("Banco do Brasil")?.nomeBanco).toBe("Banco do Brasil");
    expect(adaptadorPorNomeBanco("BRADESCO")?.nomeBanco).toBe("Bradesco");
  });
  it("banco sem adaptador (Sicredi passa pelo Malote, resto sem amostra) devolve undefined", () => {
    expect(adaptadorPorNomeBanco("Sicredi")).toBeUndefined();
    expect(adaptadorPorNomeBanco("Itaú")).toBeUndefined();
    expect(adaptadorPorNomeBanco(null)).toBeUndefined();
  });
  it("extensaoAceita valida o formato certo por adaptador", () => {
    expect(extensaoAceita(adaptadorBanrisul, "extrato.xlsx")).toBe(true);
    expect(extensaoAceita(adaptadorBanrisul, "extrato.html")).toBe(false);
    expect(extensaoAceita(adaptadorBradesco, "fatura.html")).toBe(true);
    expect(extensaoAceita(adaptadorBradesco, "fatura.htm")).toBe(true);
    expect(extensaoAceita(adaptadorBradesco, "fatura.xlsx")).toBe(false);
  });
});

// Recria em memória (via xlsx) o mesmo shape de linha das 2 amostras reais
// (Banrisul: extrato_empresarial_....xlsx / Banco do Brasil: Fatura.xlsx),
// só com um recorte pequeno — cobre metadado + seção de ruído + transação
// real + parcela, exatamente como inspecionado com o usuário.
async function arquivoXlsxDeLinhas(linhas: any[][], nome: string): Promise<File> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Extrato");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([buf], nome, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

describe("adaptadorBanrisul — amostra real (extrato_empresarial_..., cartão final 0110)", () => {
  it("filtra só linhas com DD/MM/YYYY, ignora footer, extrai parcela e valor negativo", async () => {
    const arquivo = await arquivoXlsxDeLinhas(
      [
        ["ANTONIO NASCIMENTO - agosto/2026 - Fatura Atual (fechada)", "", "", ""],
        ["", "", "", ""],
        ["12/10/2025", "EBN*CANVA0466       10/12               ", "R$ 24,15", ""],
        ["27/05/2026", "MERCADO*MERCADOLIVRE SAO JOSE DO R BRA  ", "R$ -149,90", ""],
        ["", "", "", ""],
        ["Saldo da Fatura Anterior", " 15.925,62", "", ""],
        ["Total da Fatura", " 9.719,09", "", ""],
      ],
      "extrato.xlsx",
    );

    const linhas = await adaptadorBanrisul.parse({ arquivo, competenciaAno: 2026, competenciaMes: 8 });

    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toEqual({ data: "2025-10-12", descricao: "EBN*CANVA0466", valor: 24.15, parcelaAtual: 10, parcelaTotal: 12 });
    expect(linhas[1]).toEqual({
      data: "2026-05-27",
      descricao: "MERCADO*MERCADOLIVRE SAO JOSE DO R BRA",
      valor: -149.9,
      parcelaAtual: null,
      parcelaTotal: null,
    });
  });
});

describe("adaptadorBancoBrasil — amostra real (Fatura.xlsx, cartão final 9697)", () => {
  it("ignora metadado/seção/subtotal (mesmo tendo valor na coluna), pega transação e Compras parceladas", async () => {
    const arquivo = await arquivoXlsxDeLinhas(
      [
        ["Razao Social", "NASCIMENTO S L LTDA", "", ""],
        ["Cartao", "4984311106709697", "", ""],
        ["Data Vencimento", "16/08/2026", "", ""],
        ["", "", "", ""],
        ["Data", "Lancamentos", "", "Valor"],
        ["", "", "", ""],
        ["", "SALDO FATURA ANTERIOR", "R$", "66.240,21"],
        ["16/07", "PGTO DEBITO CONTA 8326 000000000  2002", "R$", "-66.240,21"],
        ["", "SubTotal", "", "9,95"],
        ["19/07", "GITHUB, INC.           GITHUB.COM    ", "R$", "53,22"],
        ["", "*** 10,00 DOLAR AMERICANO", "", ""],
        ["", "Compras parceladas", "", ""],
        ["25/09", "DELL          PARC 11/12 ELDORADO DO ", "R$", "238,50"],
        ["", "Total", "", "65.632,31"],
      ],
      "fatura.xlsx",
    );

    const linhas = await adaptadorBancoBrasil.parse({ arquivo, competenciaAno: 2026, competenciaMes: 8 });

    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toEqual({ data: "2026-07-16", descricao: "PGTO DEBITO CONTA 8326 000000000  2002", valor: -66240.21, parcelaAtual: null, parcelaTotal: null });
    expect(linhas[1]).toEqual({ data: "2026-07-19", descricao: "GITHUB, INC.           GITHUB.COM", valor: 53.22, parcelaAtual: null, parcelaTotal: null });
    // "25/09" com competência agosto/2026 → mês da linha (9) > mês da competência (8) → ano anterior.
    expect(linhas[2]).toEqual({ data: "2025-09-25", descricao: "DELL ELDORADO DO", valor: 238.5, parcelaAtual: 11, parcelaTotal: 12 });
  });
});

describe("adaptadorBradesco — amostra real (HTML do internet banking, cartão final 1905)", () => {
  const HTML_AMOSTRA = `<!DOCTYPE html><html><body>
    <table class="tabelaListagem ne-tabela-expansivel detalhamento mb10">
      <thead><tr>
        <th><div class="alignLeft pl10">     </div></th>
        <th><div class="alignLeft pl10">Taxa ao Mês</div></th>
      </tr></thead>
      <tbody><tr><td>Pagamento de Contas</td><td>1,99%</td></tr></tbody>
    </table>
    <table class="tabelaListagem detalhamento mb10">
      <thead><tr>
        <th><div class="alignLeft pl10">Data</div></th>
        <th><div class="alignLeft pl10">Histórico</div></th>
        <th><div class="alignRight pr10">US$</div></th>
        <th><div class="alignRight pr10">R$</div></th>
      </tr></thead>
      <tbody>
        <tr class="ico_1line_Tip cursorSimples">
          <td align="left"><div class="pl10 tabindex">02/08</div></td>
          <td><div class="pl10">COMMCENTER        012/012</div></td>
          <td align="right"><div class="alignRight valor pr10">0,00</div></td>
          <td align="right"><div class="alignRight valor pr10">159,41</div></td>
        </tr>
        <tr class="ico_1line_Tip cursorSimples odd">
          <td align="left"><div class="pl10 tabindex">07/08</div></td>
          <td><div class="pl10">MERCADOLIVRE 2ELE 012/012</div></td>
          <td align="right"><div class="alignRight valor pr10">0,00</div></td>
          <td align="right"><div class="alignRight valor pr10">106,24</div></td>
        </tr>
        <tr class="bordaTotal">
          <td colspan="2"><div class="pl10"><b>Total:</b></div></td>
          <td class="titulo_destaque" align="right"><div class="mr10"><b>0,00</b></div></td>
          <td class="titulo_destaque" align="right"><div class="mr10"><b>940,73</b></div></td>
        </tr>
      </tbody>
    </table>
  </body></html>`;

  it("acha a tabela certa pelo cabeçalho (ignora a de 'Taxas Mensais'), pula a linha de total", async () => {
    const arquivo = new File([HTML_AMOSTRA], "fatura.html", { type: "text/html" });
    const linhas = await adaptadorBradesco.parse({ arquivo, competenciaAno: 2026, competenciaMes: 8 });

    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toEqual({ data: "2026-08-02", descricao: "COMMCENTER", valor: 159.41, parcelaAtual: 12, parcelaTotal: 12 });
    expect(linhas[1]).toEqual({ data: "2026-08-07", descricao: "MERCADOLIVRE 2ELE", valor: 106.24, parcelaAtual: 12, parcelaTotal: 12 });
  });
});

describe("reconciliar", () => {
  const parcelaProjetada: ItemExistente = {
    id: "item-1",
    compra_id: "compra-parcelada",
    descricao: "LOJA X",
    data_compra: "2026-08-05",
    valor: 100,
    parcela_atual: 2,
    parcela_total: 3,
    origem: "projetado",
    status: "pendente_confirmacao",
  };

  it("linha nova sem candidato vira 'novo'", () => {
    const r = reconciliar([{ data: "2026-09-10", descricao: "FARMACIA Z", valor: 30, parcelaAtual: null, parcelaTotal: null }], []);
    expect(r).toHaveLength(1);
    expect(r[0].statusRevisao).toBe("novo");
    expect(r[0].id).toBeNull();
  });

  it("casa parcela projetada com a linha nova do mesmo compra (mesma parcela esperada), sem mudança de valor", () => {
    const r = reconciliar(
      [{ data: "2026-09-05", descricao: "LOJA X", valor: 100, parcelaAtual: 2, parcelaTotal: 3 }],
      [parcelaProjetada],
    );
    expect(r).toHaveLength(1);
    expect(r[0].statusRevisao).toBe("confirmado_sem_mudanca");
    expect(r[0].id).toBe("item-1");
    expect(r[0].compraId).toBe("compra-parcelada");
  });

  it("valor diferente do esperado vira 'valor_mudou', guardando o valor anterior", () => {
    const r = reconciliar(
      [{ data: "2026-09-05", descricao: "LOJA X", valor: 120, parcelaAtual: 2, parcelaTotal: 3 }],
      [parcelaProjetada],
    );
    expect(r[0].statusRevisao).toBe("valor_mudou");
    expect(r[0].valor).toBe(120);
    expect(r[0].valorAnterior).toBe(100);
  });

  it("item esperado que NÃO veio no arquivo novo vira 'nao_encontrada' (nunca some sozinho)", () => {
    const r = reconciliar([], [parcelaProjetada]);
    expect(r).toHaveLength(1);
    expect(r[0].statusRevisao).toBe("nao_encontrada");
    expect(r[0].id).toBe("item-1");
  });

  it("ambíguo (2 candidatos plausíveis, descrição não desempata) falha pro lado seguro: nenhum casa", () => {
    const candidatos: ItemExistente[] = [
      { ...parcelaProjetada, id: "item-1", compra_id: "compra-1", descricao: "AMAZON COMPRA A" },
      { ...parcelaProjetada, id: "item-2", compra_id: "compra-2", descricao: "AMAZON COMPRA B" },
    ];
    const r = reconciliar(
      [{ data: "2026-09-05", descricao: "AMAZON COMPRA C", valor: 100, parcelaAtual: 2, parcelaTotal: 3 }],
      candidatos,
    );
    // a linha nova não casa com nenhum (vira "novo"), e os 2 candidatos ficam "não encontrada".
    expect(r.filter((x) => x.statusRevisao === "novo")).toHaveLength(1);
    expect(r.filter((x) => x.statusRevisao === "nao_encontrada")).toHaveLength(2);
  });

  it("descrição idêntica desempata entre candidatos plausíveis", () => {
    const candidatos: ItemExistente[] = [
      { ...parcelaProjetada, id: "item-1", compra_id: "compra-1", descricao: "AMAZON COMPRA A" },
      { ...parcelaProjetada, id: "item-2", compra_id: "compra-2", descricao: "AMAZON COMPRA B" },
    ];
    const r = reconciliar(
      [{ data: "2026-09-05", descricao: "AMAZON COMPRA A", valor: 100, parcelaAtual: 2, parcelaTotal: 3 }],
      candidatos,
    );
    const casado = r.find((x) => x.statusRevisao === "confirmado_sem_mudanca");
    expect(casado?.id).toBe("item-1");
    expect(r.filter((x) => x.statusRevisao === "nao_encontrada")).toHaveLength(1);
  });
});
