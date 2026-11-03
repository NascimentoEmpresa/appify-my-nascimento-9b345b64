// =====================================================================
// SAUDAÇÃO FORA DA JANELA — qual template sai, e quando NÃO sair (03/11/2026)
//
// Pedido do Pablo (print da conversa ADRIEL JOSE S.L RIO GRANDE, recrutadora
// PAMELA): a saudação "Olá! Somos do Grupo Nascimento, como você está?" com o
// botão "Pode falar!" levou 131049 três dias seguidos (10:04, 14:29, 08:12),
// e o ASO agendado, o "Bom dia" e o prazo de retorno da vaga ficaram presos
// como pendentes — o candidato nunca recebeu nada.
//
// Por quê: o botão aparecia, então saiu pelo saudacao_contato_util — o
// "UTILITY" de 14/10. A Meta o RECLASSIFICOU como MARKETING (texto que não
// cita assunto nenhum + "como você está?" = abordagem, para ela). Marketing
// tem limite por pessoa (131049/130472) e a recusa só chega depois, pelo
// webhook. E o ERP mandava a mesma saudação todo dia, batendo de novo no
// mesmo limite.
//
// Regra daqui:
//   1) Sai o primeiro template que a META diz ser UTILITY e APROVADO, na
//      ordem de `opcoes` (o chamador põe na frente os ligados à candidatura,
//      que é o que a Meta aceita como utilidade).
//   2) Nenhum UTILITY aprovado: marketing ainda pode sair — mas nunca para
//      quem já levou 131049/130472 nas últimas 24h. Reenviar só gasta a
//      tentativa e empurra o limite para frente.
// =====================================================================

const GRAPH = "https://graph.facebook.com/v21.0";

/** Os erros do limite por pessoa que a Meta aplica a template de marketing. */
export const CODIGOS_LIMITE_MARKETING = [131049, 130472];

export interface StatusTemplate { status: string; motivo?: string; categoria?: string }

/** Status e categoria (a que a META deu, não a pedida) de cada template da conta, por nome. */
export async function statusNaMeta(token: string, waba: string): Promise<Record<string, StatusTemplate>> {
  const out: Record<string, StatusTemplate> = {};
  let url = `${GRAPH}/${waba}/message_templates?limit=200&fields=name,status,category,rejected_reason`;
  for (let pagina = 0; pagina < 10 && url; pagina++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) break;
    for (const t of d?.data ?? []) out[t.name] = { status: t.status, motivo: t.rejected_reason, categoria: t.category };
    url = d?.paging?.next ?? "";
  }
  return out;
}

export const utilityAprovado = (s?: StatusTemplate) => s?.status === "APPROVED" && s?.categoria === "UTILITY";

/**
 * A conversa levou o limite de marketing nas últimas 24h? Lê as mensagens com
 * erro (poucas) e confere o código no payload, gravado pelo whatsapp-webhook.
 */
// deno-lint-ignore no-explicit-any
export async function barradoPorMarketing(db: any, conversaId: string): Promise<boolean> {
  const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db.from("WA_MENSAGEM")
    .select("payload").eq("conversa_id", conversaId).eq("status", "erro").gt("criada_em", limite).limit(50);
  return (data ?? []).some((m: { payload?: { erro?: { codigo?: unknown } } }) =>
    CODIGOS_LIMITE_MARKETING.includes(Number(m?.payload?.erro?.codigo)));
}

/** "MARIA DA SILVA" → "Maria": o nome do cadastro vem em caixa alta. */
export function primeiroNome(nome: string): string {
  const p = nome.trim().split(/\s+/)[0] ?? "";
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : "";
}
