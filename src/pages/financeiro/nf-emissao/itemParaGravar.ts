// Gravação dos itens de uma NF (nf_emissao_item).
//
// Incidente de 06/10/2026 (NF 1416 do SAMU e uma NF cancelada, Ana/Ruan): o item
// calculado em memória (ItemCalculado) carrega campos que NÃO são coluna da
// tabela — `valores_legados`, entregue pelo Controle de Notas desde 05/10 — e o
// payload do insert era `...it`. O PostgREST rejeita coluna desconhecida; como a
// validação marcava a nota como concluída e apagava os itens ANTES de reinseri-
// los, o insert falhava com a nota já concluída e SEM itens (e sem histórico).
// Por isso: (1) só as colunas abaixo vão para o banco, e (2) a troca de itens
// guarda os antigos e os devolve se o insert falhar. Campo novo de cálculo em
// memória nunca mais derruba a gravação; coluna nova da tabela entra aqui.
export const COLUNAS_ITEM_NF = [
  "valor_contrato_exec",
  "vlr_va",
  "vlr_vt",
  "vlr_materiais",
  "faltas",
  "posto_nao_implementado",
  "multas",
  "glosas",
  "outros_descontos",
  "multas_pos_emissao",
  "glosas_pos_emissao",
  "outros_descontos_pos_emissao",
  "justificativa_multas",
  "justificativa_glosas",
  "justificativa_outros_descontos",
  "qtd_colaboradores",
  "vlr_bruto",
  "total_descontos",
  "vlr_mao_obra",
  "vlr_liquido",
  "issqn",
  "inss",
  "ir",
  "cofins",
  "pis",
  "csll",
  "inss_categoria",
  "issqn_pct",
  "ir_pct",
  "cofins_pct",
  "pis_pct",
  "csll_pct",
] as const;

export function itemParaGravar(it: Record<string, any>, nfId: string, idx: number): Record<string, unknown> {
  const linha: Record<string, unknown> = {
    nf_emissao_id: nfId,
    ordem: idx + 1,
    identificacao: it.identificacao || `Item ${idx + 1}`,
  };
  for (const coluna of COLUNAS_ITEM_NF) {
    if (it[coluna] !== undefined) linha[coluna] = it[coluna];
  }
  return linha;
}

// Troca os itens da NF sem deixá-la sem itens se algo falhar: lê os antigos,
// apaga, insere os novos e, se o insert falhar, devolve os antigos e propaga o
// erro. `db` é o cliente do Supabase (injetado pra poder testar).
export async function substituirItensNf(db: any, nfId: string, itens: Record<string, any>[]): Promise<void> {
  const { data: antigos, error: eLer } = await db.from("nf_emissao_item").select("*").eq("nf_emissao_id", nfId);
  if (eLer) throw eLer;

  const { error: eDel } = await db.from("nf_emissao_item").delete().eq("nf_emissao_id", nfId);
  if (eDel) throw eDel;

  if (itens.length === 0) return;
  const { error: eIns } = await db.from("nf_emissao_item").insert(itens.map((it, idx) => itemParaGravar(it, nfId, idx)));
  if (eIns) {
    if (antigos && antigos.length > 0) {
      // Melhor esforço: o erro que importa para quem chamou é o do insert novo.
      await db.from("nf_emissao_item").insert(antigos);
    }
    throw eIns;
  }
}
