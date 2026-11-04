// Férias — REFAZER a solicitação (16/09/2026).
//
// O encarregado corrige a solicitação (saída, dias, abono, observações) e
// ela volta pra fila do RH, que avalia e aprova ou reprova de novo. Vale
// por UMA SEMANA a partir da criação; depois disso não dá mais. Cancelada
// não se refaz — EXCETO a cancelada PELO RH (24/09/2026, mig 20260930000236):
// essa pode ser refeita a qualquer momento, porque o cancelamento costuma vir
// semanas depois da aprovação.
//
// Passou a semana (04/11/2026, print do Pablo — #323 LISIANE DA SILVA, o
// encarregado ficou travado em "Refazer indisponível"): o prazo continua 7
// dias, mas a tela diz com todas as letras o caminho — CANCELAR esta
// solicitação e fazer outra. E o encarregado ganhou o botão de cancelar
// (podeCancelarFerias + RPC ferias_cancelar_pelo_solicitante, mig
// 20261104002100), enquanto as férias não começaram.
//
// A mesma regra mora no banco: o refazer no trigger ferias_registrar_historico
// (mig 20260930000168), o cancelar na RPC. A tela explica e esconde, o banco
// recusa. Sem React e sem Supabase de propósito — é o que os testes carregam.

export const PRAZO_REFAZER_DIAS = 7;
const DIA_MS = 86400000;

/** Quantos dias inteiros ainda restam pra refazer (0 quando acabou). */
export function diasRestantesParaRefazer(criadoEm?: string | null, agora: number = Date.now()): number {
  const t = criadoEm ? +new Date(criadoEm) : NaN;
  if (isNaN(t)) return 0;
  const limite = t + PRAZO_REFAZER_DIAS * DIA_MS;
  return Math.max(0, Math.ceil((limite - agora) / DIA_MS));
}

export const PRAZO_REFAZER_ESGOTADO =
  "Já passou o prazo de 7 dias desde a solicitação: NÃO É MAIS POSSÍVEL REFAZER esta solicitação. " +
  "Para mudar as férias, CANCELE esta solicitação (botão \"Cancelar solicitação\") e faça uma nova.";

export function podeRefazerFerias(
  s: { criado_em?: string | null; status?: string | null; cancelada_pelo_rh?: boolean | null },
  agora: number = Date.now(),
): { ok: boolean; motivo: string } {
  const status = String(s.status ?? "").trim();
  if (status === "Cancelada" && s.cancelada_pelo_rh) return { ok: true, motivo: "" };
  if (status === "Cancelada") return { ok: false, motivo: "Solicitação cancelada não pode ser refeita — se ainda precisar das férias, faça uma nova solicitação." };
  const t = s.criado_em ? +new Date(s.criado_em) : NaN;
  if (isNaN(t)) return { ok: false, motivo: "Não foi possível conferir a data da solicitação." };
  if (agora - t > PRAZO_REFAZER_DIAS * DIA_MS) return { ok: false, motivo: PRAZO_REFAZER_ESGOTADO };
  return { ok: true, motivo: "" };
}

/**
 * Cancelar pelo próprio solicitante (04/11/2026): Pendente ou Aprovada, e só
 * enquanto as férias não começaram (venda sem data: só Pendente — a aprovada
 * já foi para a folha). Mesma regra na RPC ferias_cancelar_pelo_solicitante.
 * `hoje` em AAAA-MM-DD (data local).
 */
export function podeCancelarFerias(
  s: { status?: string | null; data_saida?: string | null; tipo?: string | null },
  hoje: string = new Date().toLocaleDateString("sv-SE"),
): { ok: boolean; motivo: string } {
  const status = String(s.status ?? "").trim();
  if (status !== "Pendente" && status !== "Aprovada") {
    return { ok: false, motivo: `Só dá para cancelar solicitação pendente ou aprovada (esta está "${status || "—"}").` };
  }
  const saida = String(s.data_saida ?? "").slice(0, 10);
  if (!saida) {
    return status === "Pendente" ? { ok: true, motivo: "" }
      : { ok: false, motivo: "Venda de férias já aprovada não pode ser cancelada por aqui — fale com o RH pela conversa." };
  }
  if (saida <= hoje) return { ok: false, motivo: "As férias já começaram — não dá mais para cancelar por aqui. Fale com o RH pela conversa." };
  return { ok: true, motivo: "" };
}

/** Aviso que a tela mostra antes de refazer. */
export const AVISO_REFAZER =
  "Ao refazer, a solicitação volta para o RH e será avaliada e aprovada ou reprovada novamente. " +
  "Só é possível refazer até 7 dias depois da solicitação — DEPOIS DESSE PRAZO NÃO SERÁ POSSÍVEL REFAZER: " +
  "será preciso cancelar a solicitação e fazer outra.";
