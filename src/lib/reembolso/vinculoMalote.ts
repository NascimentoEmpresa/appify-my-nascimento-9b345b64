import { supabase } from "@/integrations/supabase/client";
import type { Reembolso } from "@/hooks/useReembolso";
import { fmtBRL } from "@/lib/reembolso/regras";

/**
 * Vínculo entre o reembolso aprovado e a despesa do Malote.
 *
 * "Enviar ao malote" não cria despesa nenhuma aqui: leva a pessoa ao
 * FORMULÁRIO do Malote com tudo preenchido. Ela confere, escolhe a
 * classificação — que é escolha por despesa, não configuração global — e
 * salva. O Malote então chama `vincularReembolsoAoMalote` e o reembolso vira
 * "Enviado ao malote".
 *
 * É o mesmo desenho de `pages/juridico/patrimonio/vinculoMalote.ts`, e de
 * propósito: as duas telas mandam para o mesmo formulário, pelo mesmo
 * mecanismo de querystring, e voltam pelo mesmo gancho.
 *
 * Mora aqui, e não na tela do Malote, para o módulo do Malote não precisar
 * conhecer as tabelas da Central de Serviços: lá é uma linha de import e uma
 * chamada.
 *
 * ANTES DISTO (e por poucas horas, em 02/09/2026) aprovar criava a despesa
 * sozinho, por RPC, a partir de uma classificação padrão configurada uma vez
 * para todo o módulo. Não existe uma classificação que sirva para todo
 * reembolso, então a fila do Jurídico travou inteira com "Aprovar está
 * bloqueado". Ver o cabeçalho da migration 20260930000046.
 */

/** Nome do parâmetro que o Malote lê para saber que veio de um reembolso. */
export const PARAM_ORIGEM_REEMBOLSO = "origem_reembolso";

export interface ResultadoVinculo { ok: boolean; erro?: string }

export async function vincularReembolsoAoMalote(
  reembolsoId: string | null | undefined,
  despesaId: string,
): Promise<ResultadoVinculo> {
  if (!reembolsoId || !despesaId) return { ok: false };
  // RPC, e não update direto: quem está no formulário do Malote pode não
  // passar pela RLS de CS_REEMBOLSO. A função confere a mesma autorização do
  // resto do módulo (menu de aprovação + aprovar aquele setor).
  const { error } = await (supabase as any)
    .rpc("cs_reembolso_vincular_despesa", { _id: reembolsoId, _despesa: despesaId });
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/**
 * O que "Tipos e Limites" sugere para o formulário do Malote.
 *
 * Tudo opcional, e SUGESTÃO — não regra. Foi por tratar isso como regra
 * (exigir uma classificação padrão para todo reembolso) que a fila travou.
 * `rubrica` é o NOME da classificação, porque é por nome que o formulário do
 * Malote a procura.
 */
export interface SugestoesMalote {
  rubrica?: string | null;
  formaPagamento?: string | null;
}

/**
 * A querystring que abre o formulário do Malote já preenchido.
 *
 * O que o reembolso sabe responder vai preenchido; o que ele não sabe fica em
 * branco para a pessoa escolher. A CLASSIFICAÇÃO é o caso limite: só vai se
 * alguém tiver configurado uma sugestão, e mesmo assim dá para trocar lá.
 */
export function urlDespesaDoReembolso(r: Reembolso, sugestoes?: SugestoesMalote): string {
  const q = new URLSearchParams({
    nome: `Reembolso ${r.numero ?? ""} — ${r.solicitante_nome ?? "colaborador"} (${r.setor ?? "—"})`.replace(/\s+/g, " ").trim(),
    valor: String((r.total_centavos ?? 0) / 100),
    // A competência do reembolso já é "AAAA-MM", o mesmo formato que o
    // formulário do Malote espera.
    competencia: r.competencia ?? "",
    forma: sugestoes?.formaPagamento || "PIX",
    // No Malote isto é "Informações de pagamento", que é onde o financeiro
    // procura a chave para pagar.
    info: `PIX: ${r.pix ?? ""}`,
    [PARAM_ORIGEM_REEMBOLSO]: r.id,
  });
  // Só entra na URL se existir: `rubrica=` vazio faria o formulário abrir com
  // uma classificação "escolhida" que não é nenhuma.
  if (sugestoes?.rubrica) q.set("rubrica", sugestoes.rubrica);
  return `/app/malote/criar-despesa?${q.toString()}`;
}

/** O que a tela de aprovação diz antes de mandar a pessoa para o Malote. */
export const avisoEnvioAoMalote = (r: Reembolso) =>
  `Confira a despesa no Malote e envie para aprovação — ${fmtBRL(r.total_centavos ?? 0)} de ${r.solicitante_nome ?? "colaborador"}. O reembolso só sai de "Aprovado" depois disso.`;
