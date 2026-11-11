// =====================================================================
// Solicitações de Demissão › Exportar Excel (11/11/2026)
//
// Pablo: "coloca um botão exportar Excel, com opção de exportar tudo ou
// exportar como tá filtrado". Uma linha por solicitação, as colunas que a
// tela mostra mais as que o RH usa fora dela (CPF, cargo, motivo,
// justificativa, aviso). Data sai como data e nº como número — dá para
// filtrar e ordenar no Excel.
// =====================================================================

import * as XLSX from "xlsx";
import type { SolicitacaoDemissao } from "./solicitacao";

const paraData = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  if (iso) { const [a, m, d] = iso.split("-").map(Number); return new Date(a, m - 1, d); }
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1])) : null;
};

export type LinhaExcelDemissao = Record<string, string | number | Date | null>;

export function linhasExcelDemissoes(lista: SolicitacaoDemissao[], statusRescisao?: Map<number, string>): LinhaExcelDemissao[] {
  return lista.map((s) => {
    const l: LinhaExcelDemissao = {
      "Nº": s.id,
      "Aberta em": paraData((s as { criado_em?: string | null }).criado_em ?? s.data_solicitacao),
      "Colaborador": s.colaborador_nome,
      "CPF": s.colaborador_cpf,
      "Cargo": s.colaborador_cargo,
      "Posto": s.colaborador_posto,
      "Contrato": s.contrato,
      "Filial": s.colaborador_filial,
      "Admissão": paraData(s.colaborador_admissao),
      "Solicitante": s.solicitante_nome,
      "Motivo": s.motivo_solicitacao,
      "Justificativa do desligamento": s.justificativa_desligamento ?? null,
      "Complemento da justificativa": s.justificativa_complemento ?? null,
      "Data do aviso": paraData(s.data_aviso),
      "Modelo do aviso": s.modelo_aviso,
      "Última data trabalhada": paraData(s.rh_ultima_data_trabalhada ?? null),
      "Status": s.status,
      "Devolvida em": paraData((s as { devolvido_em?: string | null }).devolvido_em ?? null),
      "Cancelada em": paraData(s.cancelado_em ?? null),
      "Motivo do cancelamento": s.cancelado_motivo ?? null,
    };
    if (statusRescisao) l["Rescisão"] = s.status === "Cancelada" ? null : statusRescisao.get(s.id) ?? "Ainda não liberada";
    return l;
  });
}

/** Monta e baixa o .xlsx (aba "Demissões", filtro no cabeçalho, largura pelo conteúdo). */
export function baixarExcelDemissoes(lista: SolicitacaoDemissao[], nomeArquivo: string, statusRescisao?: Map<number, string>) {
  const linhas = linhasExcelDemissoes(lista, statusRescisao);
  const ws = XLSX.utils.json_to_sheet(linhas, { cellDates: true, dateNF: "dd/mm/yyyy" });
  const cols = Object.keys(linhas[0] ?? { "Nº": "" });
  ws["!cols"] = cols.map((c) => ({
    wch: Math.min(50, Math.max(c.length + 2, ...linhas.map((l) => (l[c] instanceof Date ? 10 : String(l[c] ?? "").length + 1)))),
  }));
  if (linhas.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: cols.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Demissões");
  XLSX.writeFile(wb, nomeArquivo, { cellDates: true });
}
