// SIS-2026-0614: os relatórios (Relatório de Serviços, Notas Concluídas, Controle de Faturamento)
// listavam as NFs pela data em que o ANALISTA as criou; a ordem certa é a da CONCLUSÃO pelo
// Financeiro (a mais recente primeiro). Nota ainda não concluída (rascunho/enviada) e nota
// importada da planilha sem registro de conclusão usam a data de criação como referência.
export interface NfComOrdem {
  concluida_em?: string | null;
  created_at: string;
}

const chave = (n: NfComOrdem) => n.concluida_em ?? n.created_at;

// Mais recente primeiro. Sort estável: empate mantém a ordem de chegada.
export function ordenarPorConclusao<T extends NfComOrdem>(nfs: T[]): T[] {
  return [...nfs].sort((a, b) => chave(b).localeCompare(chave(a)));
}
