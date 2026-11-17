// Arquivo: supabase/functions/_shared/whatsapp-canal.ts
//
// SIS-2026-0929 — um número da Meta por canal (WA_CANAL).
//
// Até aqui toda função mandava pelo secret WHATSAPP_PHONE_NUMBER_ID. Com o
// canal dos supervisores existe um SEGUNDO número, e a resposta tem que sair
// pelo mesmo número em que a pessoa escreveu — senão o colaborador recebe a
// resposta do supervisor vindo do número do Recrutamento.
//
// FALHA PARA O PADRÃO: se a consulta der erro (ex.: Edge Function publicada
// antes da migration 20261118130000, coluna canal_codigo ainda inexistente),
// devolve o número do secret — exatamente o comportamento de antes.

// deno-lint-ignore no-explicit-any
type Db = any;

export interface CanalInfo {
  codigo: string;
  phone_number_id: string | null;
  finalidade: string;
  ativo: boolean;
  ia_ativa: boolean;
  pasta_padrao: string | null;
  provedor: string | null;
  modelo: string | null;
  max_tokens: number | null;
  persona: string | null;
  aviso_abertura: string | null;
  msg_encaminhado: string | null;
  msg_negado: string | null;
}

export const CANAL_PRINCIPAL: CanalInfo = {
  codigo: "principal", phone_number_id: null, finalidade: "geral", ativo: true, ia_ativa: false,
  pasta_padrao: null, provedor: null, modelo: null, max_tokens: null, persona: null,
  aviso_abertura: null, msg_encaminhado: null, msg_negado: null,
};

const COLUNAS_CANAL =
  "codigo, phone_number_id, finalidade, ativo, ia_ativa, pasta_padrao, provedor, modelo, max_tokens, persona, aviso_abertura, msg_encaminhado, msg_negado";

// Canal de uma mensagem recebida, pelo metadata.phone_number_id do webhook.
// Número que não está em WA_CANAL é o principal (o de sempre).
export async function canalDoNumero(db: Db, phoneNumberId: string | null | undefined): Promise<CanalInfo> {
  const pid = String(phoneNumberId ?? "").trim();
  if (!pid) return CANAL_PRINCIPAL;
  const { data, error } = await db.from("WA_CANAL").select(COLUNAS_CANAL).eq("phone_number_id", pid).maybeSingle();
  if (error || !data) return CANAL_PRINCIPAL;
  return data as CanalInfo;
}

// Número (phone_number_id) pelo qual responder numa conversa.
export async function numeroDaConversa(db: Db, conversaId: string, padrao: string): Promise<string> {
  const { data: conv, error } = await db.from("WA_CONVERSA").select("canal_codigo").eq("id", conversaId).maybeSingle();
  if (error || !conv?.canal_codigo || conv.canal_codigo === "principal") return padrao;
  const { data: canal } = await db.from("WA_CANAL").select("phone_number_id").eq("codigo", conv.canal_codigo).maybeSingle();
  return canal?.phone_number_id || padrao;
}

// Acha ou cria a conversa do contato NAQUELE canal. Sem upsert por
// onConflict de propósito: a constraint mudou de (contato_id) para
// (contato_id, canal_codigo) na 20261118130000, e um INSERT simples funciona
// com as duas — o código pode ir ao ar antes ou depois da migration.
export async function obterConversa(
  db: Db, contatoId: string, canal: string,
): Promise<{ id: string; bot_ativo: boolean } | null> {
  const sel = () => db.from("WA_CONVERSA").select("id, bot_ativo")
    .eq("contato_id", contatoId).eq("canal_codigo", canal).maybeSingle();
  let { data, error } = await sel();
  if (error) {
    // 42703 = coluna canal_codigo ainda não existe → regra antiga (um por contato).
    if (canal !== "principal") { console.error("Canal sem suporte no banco ainda:", error.message); return null; }
    await db.from("WA_CONVERSA").upsert({ contato_id: contatoId }, { onConflict: "contato_id", ignoreDuplicates: true });
    const r = await db.from("WA_CONVERSA").select("id, bot_ativo").eq("contato_id", contatoId).maybeSingle();
    return r.data ?? null;
  }
  if (data) return data;
  const ins = await db.from("WA_CONVERSA").insert({ contato_id: contatoId, canal_codigo: canal }).select("id, bot_ativo").maybeSingle();
  if (ins.data) return ins.data;
  // 23505: outra entrega criou no mesmo instante.
  ({ data, error } = await sel());
  if (error) console.error("Falha ao criar a conversa:", JSON.stringify(ins.error ?? error));
  return data ?? null;
}
