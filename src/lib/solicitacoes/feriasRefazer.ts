// Férias — REFAZER a solicitação (16/09/2026).
//
// O encarregado corrige a solicitação (saída, dias, abono, observações) e
// ela volta pra fila do RH, que avalia e aprova ou reprova de novo. Vale
// por UMA SEMANA a partir da criação; depois disso não dá mais. Cancelada
// não se refaz.
//
// A mesma regra mora no trigger ferias_registrar_historico (mig
// 20260930000168): a tela explica e esconde, o banco recusa. Sem React e
// sem Supabase de propósito — é o que os testes carregam.

export const PRAZO_REFAZER_DIAS = 7;
const DIA_MS = 86400000;

/** Quantos dias inteiros ainda restam pra refazer (0 quando acabou). */
export function diasRestantesParaRefazer(criadoEm?: string | null, agora: number = Date.now()): number {
  const t = criadoEm ? +new Date(criadoEm) : NaN;
  if (isNaN(t)) return 0;
  const limite = t + PRAZO_REFAZER_DIAS * DIA_MS;
  return Math.max(0, Math.ceil((limite - agora) / DIA_MS));
}

export function podeRefazerFerias(
  s: { criado_em?: string | null; status?: string | null },
  agora: number = Date.now(),
): { ok: boolean; motivo: string } {
  const status = String(s.status ?? "").trim();
  if (status === "Cancelada") return { ok: false, motivo: "Solicitação cancelada não pode ser refeita." };
  const t = s.criado_em ? +new Date(s.criado_em) : NaN;
  if (isNaN(t)) return { ok: false, motivo: "Não foi possível conferir a data da solicitação." };
  if (agora - t > PRAZO_REFAZER_DIAS * DIA_MS) {
    return { ok: false, motivo: "Já passou uma semana da solicitação — não é mais possível refazê-la. Se precisar mudar, fale com o RH pela conversa ao lado ou abra uma nova solicitação." };
  }
  return { ok: true, motivo: "" };
}

/** Aviso que a tela mostra antes de refazer. */
export const AVISO_REFAZER =
  "Ao refazer, a solicitação volta para o RH e será avaliada e aprovada ou reprovada novamente. " +
  "Só é possível refazer até uma semana depois da solicitação.";
