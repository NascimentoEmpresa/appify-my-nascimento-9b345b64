// Jurídico › Controle de Notificações — as regras (21/09/2026).
//
// Vocabulário (espelha os CHECKs da mig 20260930000199 — mudar lá e aqui
// junto), leitura do prazo e os indicadores do painel. Fica fora da tela pra
// ter teste (src/test/juridicoNotificacoes.test.ts): prazo e "quanto a defesa
// economizou" são as duas contas que a Diretoria vai cobrar.

export const TIPOS = ["Multa", "Glosa", "Notificação", "Apontamento contratual", "Advertência contratual", "Outros"] as const;
/** Onde está o TRABALHO. Encerrada = nada mais a fazer. */
export const ETAPAS = ["Recebida", "Em análise", "Defesa em elaboração", "Defesa protocolada", "Em recurso", "Aguardando decisão", "Encerrada"] as const;
/** O que DECIDIRAM. */
export const RESULTADOS = ["Revertida", "Revertida parcialmente", "Mantida", "Sem defesa", "Cancelada pelo órgão"] as const;
/** O que aconteceu com o DINHEIRO. */
export const DESFECHOS = ["Aguardando desconto", "Descontada em fatura", "Paga", "Sem impacto financeiro"] as const;
export const INSTANCIAS = ["Defesa prévia", "Recurso", "Recurso — 2ª instância", "Pedido de reconsideração", "Outros"] as const;
export const RESULTADOS_DEFESA = ["Aguardando", "Deferida", "Parcialmente deferida", "Indeferida", "Não conhecida"] as const;
export const CATEGORIAS_ANEXO = ["Notificação recebida", "Defesa", "Recurso", "Decisão", "Comprovante de pagamento/desconto", "Evidência", "Outros"] as const;
export const SETORES = ["Jurídico", "Administrativo", "Operacional", "Recursos Humanos", "Diretoria", "Financeiro", "SST"] as const;

export interface Notificacao {
  id: number; protocolo: string; tipo: string; orgao?: string | null; contrato?: string | null;
  numero_documento?: string | null; data_ocorrencia?: string | null; data_recebimento: string; prazo_defesa?: string | null;
  assunto: string; descricao?: string | null; fundamentacao?: string | null; local_posto?: string | null;
  valor_original?: number | null; valor_final?: number | null; valor_descontado?: number | null;
  etapa: string; resultado?: string | null; desfecho_financeiro?: string | null; data_desfecho?: string | null;
  setor_responsavel?: string | null; responsavel_nome?: string | null;
  causa_raiz?: string | null; medida_preventiva?: string | null; medida_responsavel?: string | null;
  medida_prazo?: string | null; medida_concluida?: boolean | null; observacoes?: string | null;
  criado_por_nome?: string | null; created_at?: string; updated_at?: string; encerrada_em?: string | null;
}

export const encerrada = (n: Pick<Notificacao, "etapa">) => n.etapa === "Encerrada";
const num = (v: unknown) => { const x = Number(v); return v == null || v === "" || isNaN(x) ? 0 : x; };

// ── Prazo ────────────────────────────────────────────────────────────
export type NivelPrazo = "encerrada" | "sem_prazo" | "vencido" | "hoje" | "urgente" | "atencao" | "ok";
/** Dias corridos entre duas datas ISO (AAAA-MM-DD), sem fuso atrapalhar. */
export const diasEntre = (de: string, ate: string) =>
  Math.round((Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 86400000);

/**
 * A régua do prazo de defesa. Só conta enquanto a ocorrência está aberta E
 * a defesa ainda não foi protocolada — depois de protocolar, o prazo cumpriu
 * o papel dele e continuar pintando de vermelho seria alarme falso.
 */
export function situacaoPrazo(n: Pick<Notificacao, "etapa" | "prazo_defesa">, hoje: string): { nivel: NivelPrazo; dias: number | null; rotulo: string } {
  if (encerrada(n)) return { nivel: "encerrada", dias: null, rotulo: "Encerrada" };
  if (["Defesa protocolada", "Em recurso", "Aguardando decisão"].includes(n.etapa)) return { nivel: "ok", dias: null, rotulo: "Defesa protocolada" };
  if (!n.prazo_defesa) return { nivel: "sem_prazo", dias: null, rotulo: "Sem prazo informado" };
  const d = diasEntre(hoje, n.prazo_defesa.slice(0, 10));
  if (d < 0) return { nivel: "vencido", dias: d, rotulo: `Vencido há ${-d} dia(s)` };
  if (d === 0) return { nivel: "hoje", dias: 0, rotulo: "Vence hoje" };
  if (d <= 3) return { nivel: "urgente", dias: d, rotulo: `Vence em ${d} dia(s)` };
  if (d <= 7) return { nivel: "atencao", dias: d, rotulo: `Vence em ${d} dias` };
  return { nivel: "ok", dias: d, rotulo: `Vence em ${d} dias` };
}
export const COR_PRAZO: Record<NivelPrazo, { bg: string; fg: string }> = {
  vencido: { bg: "#fee2e2", fg: "#b91c1c" }, hoje: { bg: "#fee2e2", fg: "#b91c1c" },
  urgente: { bg: "#ffedd5", fg: "#c2410c" }, atencao: { bg: "#fef9c3", fg: "#a16207" },
  ok: { bg: "#dcfce7", fg: "#15803d" }, sem_prazo: { bg: "#f1f5f9", fg: "#64748b" }, encerrada: { bg: "#f1f5f9", fg: "#475569" },
};
export const COR_ETAPA: Record<string, { bg: string; fg: string }> = {
  "Recebida": { bg: "#e0f2fe", fg: "#0369a1" }, "Em análise": { bg: "#ede9fe", fg: "#6d28d9" },
  "Defesa em elaboração": { bg: "#fef9c3", fg: "#a16207" }, "Defesa protocolada": { bg: "#dbeafe", fg: "#1d4ed8" },
  "Em recurso": { bg: "#ffedd5", fg: "#c2410c" }, "Aguardando decisão": { bg: "#fae8ff", fg: "#a21caf" },
  "Encerrada": { bg: "#f1f5f9", fg: "#475569" },
};
export const COR_RESULTADO: Record<string, { bg: string; fg: string }> = {
  "Revertida": { bg: "#dcfce7", fg: "#15803d" }, "Revertida parcialmente": { bg: "#ecfccb", fg: "#4d7c0f" },
  "Mantida": { bg: "#fee2e2", fg: "#b91c1c" }, "Sem defesa": { bg: "#f1f5f9", fg: "#475569" },
  "Cancelada pelo órgão": { bg: "#dcfce7", fg: "#15803d" },
};

// ── Valores ──────────────────────────────────────────────────────────
/**
 * O valor que vale hoje: o final (depois da defesa/recurso) quando já foi
 * lançado; senão, o original. Revertida/cancelada sem valor final = zero.
 */
export function valorVigente(n: Pick<Notificacao, "valor_original" | "valor_final" | "resultado">): number {
  if (n.valor_final != null && String(n.valor_final) !== "") return num(n.valor_final);
  if (n.resultado === "Revertida" || n.resultado === "Cancelada pelo órgão") return 0;
  return num(n.valor_original);
}
/** Quanto a defesa evitou: original − vigente (nunca negativo). */
export const valorEvitado = (n: Pick<Notificacao, "valor_original" | "valor_final" | "resultado">) =>
  Math.max(0, num(n.valor_original) - valorVigente(n));

// ── Indicadores ──────────────────────────────────────────────────────
export interface Indicadores {
  total: number; abertas: number; encerradas: number;
  vencidas: number; vencendo7: number; semResponsavel: number;
  valorAplicado: number; valorVigente: number; valorEvitado: number; valorDescontado: number;
  /** % das que tiveram decisão (revertida/parcial/mantida/cancelada) que foram revertidas no todo ou em parte. */
  taxaExito: number | null;
  medidasPendentes: number;
  porTipo: { nome: string; qtd: number; valor: number }[];
  porContrato: { nome: string; qtd: number; valor: number }[];
  porEtapa: { nome: string; qtd: number }[];
  porMes: { mes: string; qtd: number; valor: number }[];
}

export function indicadores(lista: Notificacao[], hoje: string): Indicadores {
  const agrupa = (chave: (n: Notificacao) => string) => {
    const m = new Map<string, { qtd: number; valor: number }>();
    for (const n of lista) { const k = chave(n) || "Não informado"; const x = m.get(k) ?? { qtd: 0, valor: 0 }; x.qtd++; x.valor += num(n.valor_original); m.set(k, x); }
    return [...m.entries()].map(([nome, v]) => ({ nome, ...v }));
  };
  const prazos = lista.map(n => situacaoPrazo(n, hoje).nivel);
  const decididas = lista.filter(n => ["Revertida", "Revertida parcialmente", "Mantida", "Cancelada pelo órgão"].includes(n.resultado ?? ""));
  const exito = decididas.filter(n => n.resultado !== "Mantida").length;
  const porMes = agrupa(n => (n.data_recebimento ?? "").slice(0, 7)).filter(x => x.nome !== "Não informado")
    .sort((a, b) => a.nome.localeCompare(b.nome)).slice(-12)
    .map(x => ({ mes: `${x.nome.slice(5, 7)}/${x.nome.slice(2, 4)}`, qtd: x.qtd, valor: x.valor }));
  return {
    total: lista.length,
    abertas: lista.filter(n => !encerrada(n)).length,
    encerradas: lista.filter(encerrada).length,
    vencidas: prazos.filter(p => p === "vencido").length,
    vencendo7: prazos.filter(p => p === "hoje" || p === "urgente" || p === "atencao").length,
    semResponsavel: lista.filter(n => !encerrada(n) && !(n.responsavel_nome ?? "").trim()).length,
    valorAplicado: lista.reduce((s, n) => s + num(n.valor_original), 0),
    valorVigente: lista.reduce((s, n) => s + valorVigente(n), 0),
    valorEvitado: lista.reduce((s, n) => s + valorEvitado(n), 0),
    valorDescontado: lista.reduce((s, n) => s + num(n.valor_descontado), 0),
    taxaExito: decididas.length ? Math.round((exito / decididas.length) * 100) : null,
    medidasPendentes: lista.filter(n => (n.medida_preventiva ?? "").trim() && !n.medida_concluida).length,
    porTipo: agrupa(n => n.tipo).sort((a, b) => b.qtd - a.qtd),
    porContrato: agrupa(n => n.contrato ?? "").sort((a, b) => b.valor - a.valor || b.qtd - a.qtd).slice(0, 10),
    porEtapa: ETAPAS.map(e => ({ nome: e, qtd: lista.filter(n => n.etapa === e).length })),
    porMes,
  };
}

/** Ordem da fila: o que vence primeiro no topo; encerradas por último. */
export function ordemDaFila(a: Notificacao, b: Notificacao, hoje: string): number {
  const peso = (n: Notificacao) => ({ vencido: 0, hoje: 1, urgente: 2, atencao: 3, sem_prazo: 4, ok: 5, encerrada: 6 })[situacaoPrazo(n, hoje).nivel];
  return peso(a) - peso(b)
    || (a.prazo_defesa ?? "9999").localeCompare(b.prazo_defesa ?? "9999")
    || (b.data_recebimento ?? "").localeCompare(a.data_recebimento ?? "");
}
