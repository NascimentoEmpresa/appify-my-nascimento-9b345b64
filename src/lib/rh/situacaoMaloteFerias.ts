// =====================================================================
// RH › Gestão de Férias — SITUAÇÃO NO MALOTE (chamado #0865, Alessandra,
// 11/11/2026). Uma régua só para a coluna, o filtro e o drawer.
//
//   · Não enviado ao Malote;
//   · PENDENTE DE ANEXO DE DOCUMENTO — "Programar no malote" sem o recibo
//     (ferias_programar_malote): para finalizar o pagamento e estar de fato
//     no Malote, o recibo ainda é anexado e a despesa enviada;
//   · Enviado ao Malote — despesa ativa no Malote, aguardando o check final;
//   · ENVIADO PRA MENTORE — o check final (pago): conclui 100% as férias.
//
// "Despesa ativa" é a mesma regra do banco (ferias_malote_ativo: não
// excluída, não reprovada nem cancelada no Malote). Se o Malote excluir a
// despesa, as férias programadas voltam a "pendente de anexo".
// Mig 20261111235800.
// =====================================================================

export type SituacaoMaloteFerias = "nao_enviado" | "pendente_anexo" | "no_malote" | "mentore";

export interface FeriasNoMalote {
  malote_programado_em?: string | null;
  mentore_enviado_em?: string | null;
}

export function situacaoMaloteFerias(f: FeriasNoMalote, despesaAtiva: boolean): SituacaoMaloteFerias {
  if (f.mentore_enviado_em) return "mentore";
  if (despesaAtiva) return "no_malote";
  if (f.malote_programado_em) return "pendente_anexo";
  return "nao_enviado";
}

export const SITUACOES_MALOTE_FERIAS: { valor: SituacaoMaloteFerias; rotulo: string; filtro: string; cor: { bg: string; fg: string; bd: string } }[] = [
  { valor: "nao_enviado", rotulo: "Não enviado", filtro: "Não enviado ao Malote", cor: { bg: "#f8fafc", fg: "#64748b", bd: "#e2e8f0" } },
  { valor: "pendente_anexo", rotulo: "PENDENTE DE ANEXO DE DOCUMENTO", filtro: "Pendente de anexo de documento", cor: { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" } },
  { valor: "no_malote", rotulo: "Enviado ao Malote", filtro: "Enviado ao Malote (aguardando Mentore)", cor: { bg: "#eef4ff", fg: "#0f3171", bd: "#c7d7f5" } },
  { valor: "mentore", rotulo: "ENVIADO PRA MENTORE", filtro: "Enviado pra Mentore (concluídas)", cor: { bg: "#dcfce7", fg: "#15803d", bd: "#86efac" } },
];

export const rotuloSituacaoMalote = (s: SituacaoMaloteFerias): string =>
  SITUACOES_MALOTE_FERIAS.find(x => x.valor === s)?.rotulo ?? s;

/** Filtro da Gestão de Férias: "" = todas; "ja_foi" = qualquer uma que já passou pelo Malote. */
export function passaNoFiltroMalote(s: SituacaoMaloteFerias, filtro: string): boolean {
  if (!filtro) return true;
  if (filtro === "ja_foi") return s === "no_malote" || s === "mentore";
  return s === filtro;
}

/** O que cada situação deixa fazer (a tela; o banco confere o mesmo nas RPCs). */
export function acoesMaloteFerias(status: string, s: SituacaoMaloteFerias) {
  const aprovada = status === "Aprovada";
  return {
    programar: aprovada && s === "nao_enviado",
    desprogramar: s === "pendente_anexo",
    enviarMentore: s === "no_malote",
    desfazerMentore: s === "mentore",
  };
}
