import type { AdaptadorBanco, LinhaBruta } from "./tipos";
import { extrairParcela, parseDataBRSemAno, parseValorBR } from "./utils";

// Amostra real: extrato do internet banking salvo como HTML (cartão final
// 1905, BRADESCO HAGG) — único formato aceito do Bradesco (o outro é PDF,
// sem lib de extração confiável no projeto). Tabela limpa
// `table.tabelaListagem.detalhamento`: colunas Data (DD/MM, sem ano) /
// Histórico (descrição com parcela embutida no fim, ex. "COMMCENTER
// 012/012") / US$ / R$. Linha final com class="bordaTotal" é o total, não
// lançamento.
//
// Cuidado: a mesma página tem uma 2ª tabela ("Taxas Mensais") com classes
// CSS quase idênticas — identificar a tabela certa pelo CABEÇALHO (1ª
// coluna = "Data"), não só pela classe.
export const adaptadorBradesco: AdaptadorBanco = {
  nomeBanco: "Bradesco",
  formatos: ["html"],
  async parse({ arquivo, competenciaAno, competenciaMes }) {
    const texto = await arquivo.text();
    const doc = new DOMParser().parseFromString(texto, "text/html");

    const tabelas = Array.from(doc.querySelectorAll("table"));
    const tabelaExtrato = tabelas.find((t) => {
      const th0 = t.querySelector("thead th");
      return th0 && /data/i.test(th0.textContent ?? "");
    });
    if (!tabelaExtrato) {
      throw new Error('Não encontrei a tabela de lançamentos no HTML (procurei um <table> com cabeçalho "Data").');
    }

    const linhas: LinhaBruta[] = [];
    const linhasTabela = Array.from(tabelaExtrato.querySelectorAll("tbody tr"));
    for (const tr of linhasTabela) {
      if (tr.className.includes("bordaTotal")) continue; // linha de total, não lançamento

      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length < 4) continue;

      const dataTexto = (tds[0].textContent ?? "").trim();
      const data = parseDataBRSemAno(dataTexto, competenciaAno, competenciaMes);
      if (!data) continue;

      const descricaoBruta = (tds[1].textContent ?? "").replace(/\s+/g, " ").trim();
      const valor = parseValorBR((tds[3].textContent ?? "").trim());
      const parcela = extrairParcela(descricaoBruta);

      linhas.push({
        data,
        descricao: parcela?.descricaoLimpa ?? descricaoBruta,
        valor,
        parcelaAtual: parcela?.atual ?? null,
        parcelaTotal: parcela?.total ?? null,
      });
    }
    return linhas;
  },
};
