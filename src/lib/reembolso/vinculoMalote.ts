import { supabase } from "@/integrations/supabase/client";
import { BUCKET_REEMBOLSO, type Reembolso } from "@/hooks/useReembolso";
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

/**
 * Os comprovantes do reembolso, como `File`, prontos para o anexo do Malote.
 *
 * Vêm do bucket `reembolsos` (privado) e entram no MESMO estado de arquivos
 * que o formulário do Malote já usa — de lá o `uploadAnexosMalote` os grava em
 * `malote-anexos` no salvar, junto com o que a pessoa tiver adicionado à mão.
 * Nenhum caminho novo de upload: o comprovante segue exatamente a rota de
 * qualquer outro anexo do Malote.
 *
 * Por que COPIAR e não referenciar: são dois buckets, com políticas
 * diferentes, e `malote_despesa.arquivos` guarda caminho dentro de
 * `malote-anexos`. Apontar para fora faria o anexo abrir para quem aprova
 * reembolso e falhar para quem paga — que é justamente quem precisa vê-lo.
 *
 * Falha de um arquivo não derruba os outros: o financeiro prefere a despesa
 * com dois dos três comprovantes (e um aviso) a nenhuma despesa.
 */
export async function comprovantesDoReembolso(
  reembolsoId: string,
): Promise<{ arquivos: File[]; falhas: number }> {
  const sb = supabase as any;
  const { data: itens, error } = await sb
    .from("CS_REEMBOLSO_ITEM")
    .select("storage_path, nome_arquivo, mime_type")
    .eq("reembolso_id", reembolsoId);
  if (error || !itens?.length) return { arquivos: [], falhas: 0 };

  const arquivos: File[] = [];
  let falhas = 0;
  for (const item of itens as Array<{
    storage_path: string; nome_arquivo: string | null; mime_type: string | null;
  }>) {
    const { data, error: erroDownload } = await supabase.storage
      .from(BUCKET_REEMBOLSO).download(item.storage_path);
    if (erroDownload || !data) { falhas++; continue; }
    // O nome do arquivo é o que o financeiro lê na lista de anexos; o do
    // storage tem prefixo de pasta e carimbo de tempo.
    const nome = item.nome_arquivo?.trim()
      || item.storage_path.split("/").pop()
      || "comprovante";
    arquivos.push(new File([data], nome, { type: item.mime_type || data.type }));
  }
  return { arquivos, falhas };
}
