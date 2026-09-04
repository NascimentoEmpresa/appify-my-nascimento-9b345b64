import type { AdaptadorBanco, LinhaBruta } from "./tipos";
import { extrairParcela, parseDataBRComAno, parseValorBR } from "./utils";

// Amostra real: extrato_empresarial_....xlsx (cartão final 0110, BANRI
// ANTONIO). Sheet "Extrato", 3-4 colunas, SEM cabeçalho de coluna nenhum —
// só um título na linha 0 ("ANTONIO NASCIMENTO - agosto/2026 - Fatura
// Atual (fechada)") e uma lista de transação crua:
//   ["12/10/2025", "EBN*CANVA0466       10/12               ", "R$ 24,15", ""]
// Footer (Saldo da Fatura Anterior, Pagamentos/Créditos, Encargos/IOF,
// conversão de dólar, Total da Fatura) não tem data em DD/MM/YYYY na 1ª
// coluna — filtrar só por esse formato já separa 100% das linhas de
// transação do resto, sem precisar achar onde a lista "acaba".
export const adaptadorBanrisul: AdaptadorBanco = {
  nomeBanco: "Banrisul",
  formatos: ["xlsx", "csv"],
  async parse({ arquivo }) {
    const XLSX = await import("xlsx");
    const buf = await arquivo.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

    const linhas: LinhaBruta[] = [];
    for (const row of aoa) {
      const col0 = String(row[0] ?? "").trim();
      const data = parseDataBRComAno(col0);
      if (!data) continue; // footer/linha em branco — sem data DD/MM/YYYY não é transação

      const descricaoBruta = String(row[1] ?? "").trim();
      const valor = parseValorBR(row[2]);
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
