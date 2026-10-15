// Exportação das telas de Início de Contrato (SIS-2026-0599).
// CSV com BOM e ponto-e-vírgula: é o que o Excel em pt-BR abre sem pedir
// assistente de importação, e o José abre tudo no Excel.
export function exportarCsv(nomeArquivo: string, linhas: Record<string, unknown>[]) {
  if (!linhas.length) return;
  const colunas = Object.keys(linhas[0]);
  const celula = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? v.toLocaleString("pt-BR") : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [colunas.join(";"), ...linhas.map((l) => colunas.map((c) => celula(l[c])).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nomeArquivo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
