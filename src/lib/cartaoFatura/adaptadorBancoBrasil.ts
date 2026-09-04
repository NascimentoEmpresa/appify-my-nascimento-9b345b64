import type { AdaptadorBanco, LinhaBruta } from "./tipos";
import { extrairParcela, parseDataBRSemAno, parseValorBR } from "./utils";

// Amostra real: Fatura.xlsx (cartão final 9697, BB HAGG). Sheet "Extrato",
// 4 colunas. Linhas 0-7 são metadados (Razão Social, Nome Cliente, Centro
// de Custo, Cartão, Limite, Vencimento, Valor Total) — sem uso aqui
// (Cartão/Competência já vêm escolhidos no passo 1 do modal). Linha 9 é o
// cabeçalho "Data | Lancamentos | | Valor", mas MISTURADO com linhas de
// seção/subtotal/informativas que teriam que ser filtradas uma a uma:
//   ["", "SALDO FATURA ANTERIOR", "R$", "66.240,21"]   ← ruído
//   ["", "SubTotal", "", "9,95"]                        ← ruído
//   ["", "*** 10,00 DOLAR AMERICANO", "", ""]            ← ruído
//   ["16/07", "PGTO DEBITO CONTA 8326...", "R$", "-66.240,21"]  ← real
//
// Achado ao inspecionar TODAS as linhas: toda linha de ruído tem a coluna
// Data (col0) VAZIA — inclusive as de subtotal, que "parecem" transação por
// terem valor na col3. Filtrar só por "col0 bate com DD/MM" já separa
// 100% das transações reais do resto, e cobre também a seção "Compras
// parceladas" no fim do arquivo (mesma forma de linha, só que a descrição
// tem "PARC NN/NN" explícito em vez do padrão genérico).
export const adaptadorBancoBrasil: AdaptadorBanco = {
  nomeBanco: "Banco do Brasil",
  formatos: ["xlsx", "csv"],
  async parse({ arquivo, competenciaAno, competenciaMes }) {
    const XLSX = await import("xlsx");
    const buf = await arquivo.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

    const linhas: LinhaBruta[] = [];
    for (const row of aoa) {
      const col0 = String(row[0] ?? "").trim();
      const data = parseDataBRSemAno(col0, competenciaAno, competenciaMes);
      if (!data) continue; // linha de metadado/seção/subtotal — sem DD/MM não é transação

      const descricaoBruta = String(row[1] ?? "").trim();
      const valor = parseValorBR(row[3] ?? row[2]);
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
