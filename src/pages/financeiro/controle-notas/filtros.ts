import { situacaoEspecial } from "@/pages/financeiro/nf-emissao/shared";

export type FiltroStatusValidacao = "todos" | "concluida" | "cancelada";

interface NotaParaFiltro {
  status: string;
  empresa_id: string;
  contrato_id: string;
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  contrato?: { id: string; nome: string } | null;
}

// SIS-2026-0697: o banco guarda "concluida" também para notas do relatório
// legado que na origem já eram CANCELADA/SUBSTITUIDA (o badge da tela mostra
// "Cancelada"). O filtro olhava só `status` e deixava a NF 35 (Guaporé) passar
// em "Concluída". Aqui o status é o mesmo que o badge exibe: Concluída é só a
// nota concluída sem situação especial; a substituída aparece só em "Todos".
export function statusExibidoNaValidacao(n: NotaParaFiltro): "concluida" | "cancelada" | "substituida" | "outro" {
  if (n.status === "cancelada") return "cancelada";
  if (n.status !== "concluida") return "outro";
  const esp = situacaoEspecial(n);
  if (esp === "CANCELADA") return "cancelada";
  if (esp === "SUBSTITUIDA") return "substituida";
  return "concluida";
}

export function notaCombinaComStatus(n: NotaParaFiltro, filtro: FiltroStatusValidacao): boolean {
  if (filtro === "todos") return true;
  return statusExibidoNaValidacao(n) === filtro;
}

// Contratos (com nota) da empresa escolhida; sem empresa, todos. A lista sai das
// próprias notas, então empresa e contrato sempre concordam com o filtro da tabela.
export function contratosDasNotasDaEmpresa<T extends NotaParaFiltro>(
  notas: T[],
  empresaId: string,
): { id: string; nome: string }[] {
  const porId = new Map<string, string>();
  for (const n of notas) {
    if (empresaId !== "todas" && n.empresa_id !== empresaId) continue;
    if (!porId.has(n.contrato_id)) porId.set(n.contrato_id, n.contrato?.nome ?? "-");
  }
  return Array.from(porId, ([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function contratoCombinaComEmpresa(
  contratos: { id: string }[],
  contratoId: string,
): boolean {
  return contratoId === "todos" || contratos.some((c) => c.id === contratoId);
}
