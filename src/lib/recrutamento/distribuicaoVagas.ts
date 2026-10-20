// =====================================================================
// Recrutamento — distribuição das vagas entre as recrutadoras e
// encaminhamento para a Admissão (mig 20261020000050, 19/10/2026).
// Com teste em src/test/recrutamento-distribuicao-vagas.test.ts.
//
// Pedido (chamado): a gestão (Alessandra, Maiara) escolhe a "Responsável
// pelo recrutamento" de cada vaga; cada recrutadora trabalha SÓ nas vagas
// dela — as da colega ficam em cinza, só consulta, com as ações bloqueadas
// de verdade (o banco recusa: rec_vaga_bloqueio). A Admissão (Giovana)
// trabalha os candidatos que o recrutamento encaminhou a ela.
//
// bloqueioDaVaga é o espelho, na tela, de rec_vaga_bloqueio — mudou lá,
// muda aqui.
// =====================================================================

export interface PapelRecrutamento {
  /** recrutamento_distribuir: define a recrutadora e mexe em todas. */
  gestor: boolean;
  /** alterar na Gestão Recrutamento sem ser gestão. */
  recrutadora: boolean;
  /** recrutamento_admissao: recebe a fila da Admissão. */
  admissao: boolean;
}

export const PAPEL_NENHUM: PapelRecrutamento = { gestor: false, recrutadora: false, admissao: false };

export interface ResponsavelDistribuicao {
  responsavel_id: string | null;
  responsavel_nome: string;
  origem: string;
}

/** Candidatos da vaga encaminhados à Admissão (resumo por vaga). */
export interface AdmissaoDaVaga {
  /** Encaminhados e ainda não admitidos (sem desistência). */
  aguardando: number;
  /** Encaminhados no total (admitidos ou não). */
  encaminhados: number;
  responsavel: string | null;
  recrutadora: string | null;
  enviado_em: string | null;
}

export const vagaDistribuida = (r: Pick<ResponsavelDistribuicao, "origem"> | null | undefined) => r?.origem === "distribuida";

/**
 * Quem está logado NÃO pode mexer na vaga? Devolve o nome da dona (para a
 * mensagem "só consulta") ou null quando pode.
 */
export function bloqueioDaVaga(
  r: ResponsavelDistribuicao | null | undefined,
  papel: PapelRecrutamento,
  meuId: string | null | undefined,
  admissao: Pick<AdmissaoDaVaga, "encaminhados"> | null | undefined,
): string | null {
  if (!meuId || !r || !vagaDistribuida(r) || r.responsavel_id === meuId) return null;
  if (papel.gestor || !papel.recrutadora) return null;
  if (papel.admissao && (admissao?.encaminhados ?? 0) > 0) return null;
  return r.responsavel_nome || "outra recrutadora";
}

/** "Responsável atual" da listagem: a Admissão, enquanto houver candidato esperando por ela. */
export function responsavelAtual(
  r: Pick<ResponsavelDistribuicao, "responsavel_nome"> | null | undefined,
  admissao: AdmissaoDaVaga | null | undefined,
): { nome: string | null; etapa: "admissao" | "recrutamento" | null; recrutadora: string | null } {
  if (admissao && admissao.aguardando > 0) {
    return { nome: admissao.responsavel, etapa: "admissao", recrutadora: admissao.recrutadora ?? r?.responsavel_nome ?? null };
  }
  return { nome: r?.responsavel_nome ?? null, etapa: r ? "recrutamento" : null, recrutadora: r?.responsavel_nome ?? null };
}

/** Desistência sem motivo vira "Não informado" (pedido do chamado). */
export const motivoDesistencia = (m: string | null | undefined) => String(m ?? "").trim() || "Não informado";

/** Primeiro nome legível: "THAIMIANI SILVA" → "Thaimiani". */
export function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!p) return "";
  if (p.includes("@")) return p.split("@")[0];
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/** Resumo por vaga a partir dos candidatos encaminhados (linhas de WA_CURRICULOS). */
export function resumirAdmissao(cands: {
  vaga_id: number | null; enviado_admissao_em: string | null; admitido_em: string | null; desistiu?: boolean | null;
  admissao_responsavel_nome?: string | null; recrutadora_nome?: string | null;
}[]): Record<number, AdmissaoDaVaga> {
  const out: Record<number, AdmissaoDaVaga> = {};
  for (const c of cands) {
    if (c.vaga_id == null || !c.enviado_admissao_em || c.desistiu) continue;
    const a = (out[c.vaga_id] ??= { aguardando: 0, encaminhados: 0, responsavel: null, recrutadora: null, enviado_em: null });
    a.encaminhados += 1;
    if (!c.admitido_em) a.aguardando += 1;
    a.responsavel = a.responsavel ?? c.admissao_responsavel_nome ?? null;
    a.recrutadora = a.recrutadora ?? c.recrutadora_nome ?? null;
    if (!a.enviado_em || c.enviado_admissao_em < a.enviado_em) a.enviado_em = c.enviado_admissao_em;
  }
  return out;
}
