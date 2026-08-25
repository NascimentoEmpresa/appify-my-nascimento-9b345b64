// =====================================================================
// O ID DA CONTA DO WHATSAPP (WABA) — um lugar só
//
// Criar template na Meta é sempre POST /{waba_id}/message_templates, então
// as três functions que fazem isso (whatsapp-abertura, whatsapp-templates,
// whatsapp-template-enviar) precisavam descobrir o WABA. As três faziam:
//
//     GET /{PHONE_NUMBER_ID}?fields=whatsapp_business_account
//
// com o comentário "a WABA sai do próprio número — evita mais um secret".
// Só que esse campo NÃO EXISTE no nó do phone number: a Graph responde
// "(#100) Tried accessing nonexisting field (whatsapp_business_account)".
// Ou seja, nenhum caminho de criar template jamais funcionou — o que
// explica a mensagem pronta parada em "não enviada" desde sempre.
//
// Conferido em 25/08/2026, com o token real (System User válido, escopo
// whatsapp_business_management):
//   GET /{phone_number_id}                              → 200, sem WABA
//   GET /{system_user_id}/assigned_whatsapp_business_accounts → 200, lista VAZIA
//   GET /{system_user_id}/businesses                    → 400 Missing Permission
//   GET /{app_id}/whatsapp_business_accounts            → 400 campo inexistente
//
// Não há rota que devolva o WABA a partir do que temos. Por isso ele passa
// a vir do secret WHATSAPP_WABA_ID, copiado uma vez do Business Manager.
// O ID não é segredo (aparece na URL do painel da Meta), mas é
// configuração de instalação e não entra no código versionado.
// =====================================================================

const GRAPH = "https://graph.facebook.com/v21.0";

export interface Waba {
  id: string | null;
  /** Em português, para a tela poder mostrar em vez de "não consegui". */
  erro?: string;
}

/**
 * O WABA da instalação.
 *
 * Ordem: o secret primeiro (é o que funciona); o campo do phone number
 * depois, só para o dia em que a Meta passar a expô-lo — assim quem já
 * tiver o secret não precisa mexer em nada, e quem não tiver ainda tem
 * uma chance antes do erro.
 */
export async function descobrirWaba(token: string, phoneNumberId: string): Promise<Waba> {
  const doSecret = (Deno.env.get("WHATSAPP_WABA_ID") ?? "").trim();
  if (doSecret) return { id: doSecret };

  const res = await fetch(`${GRAPH}/${phoneNumberId}?fields=whatsapp_business_account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await res.json().catch(() => ({}));
  const id = d?.whatsapp_business_account?.id;
  if (res.ok && id) return { id };

  return {
    id: null,
    erro: "O ID da conta do WhatsApp (WABA) não está configurado no servidor. "
        + "Pegue em Business Manager › Contas do WhatsApp e grave no secret WHATSAPP_WABA_ID.",
  };
}
