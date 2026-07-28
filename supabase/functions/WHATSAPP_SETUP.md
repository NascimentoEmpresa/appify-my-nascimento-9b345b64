# WhatsApp — Chatbot (Meta Cloud API) — setup

Módulo de atendimento por WhatsApp com respostas por IA (Claude). Componentes:

- **Banco**: tabelas `WA_CONTATO`, `WA_CONVERSA`, `WA_MENSAGEM`, `WA_BOT_CONFIG`, `WA_BOT_CONHECIMENTO` (migration `20260807000001_whatsapp_chatbot.sql`, também no `aplicar_no_banco_do_app.sql`).
- **Edge Functions**: `whatsapp-webhook` (recebe da Meta + aciona o bot) e `whatsapp-enviar` (envio pelo atendente).
- **Front**: `/app/whatsapp` (Caixa de Entrada) e `/app/whatsapp/chatbot` (configuração).

## 1. Banco de dados

Aplicar o bloco `20260807000001_whatsapp_chatbot` do `supabase/aplicar_no_banco_do_app.sql` no **banco do app** (`fwmzeaztjxrxxzxzxmgc`).

## 2. Secrets (Supabase → Edge Functions → Secrets)

| Secret | Onde obter |
|---|---|
| `WHATSAPP_VERIFY_TOKEN` | string que você inventa; use a mesma no webhook da Meta |
| `WHATSAPP_APP_SECRET` | App da Meta → Configurações → Básico → Chave secreta do app |
| `WHATSAPP_TOKEN` | Token de acesso **permanente** do número (System User token) |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup → Phone number ID |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` já existem no ambiente.

## 3. Deploy das funções

```bash
supabase functions deploy whatsapp-webhook
supabase functions deploy whatsapp-enviar
```

O `verify_jwt=false` do webhook já está no `config.toml` (a Meta chama sem JWT; a autenticidade é validada pela assinatura `X-Hub-Signature-256`).

## 4. Webhook na Meta

App da Meta → WhatsApp → Configuration → Webhook:

- **Callback URL**: `https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/whatsapp-webhook`
- **Verify token**: igual ao `WHATSAPP_VERIFY_TOKEN`
- **Webhook fields**: inscrever `messages`.

## 5. Acesso

Liberar em **Acesso por Usuário** (fechado por padrão):

- `WhatsApp — Caixa de Entrada` (`whatsapp`)
- `WhatsApp — Chatbot` (`whatsapp_chatbot`)

## 6. Ligar o bot

Em `/app/whatsapp/chatbot`: ajustar persona/horário/base de conhecimento e clicar **Ligar**. Por conversa, o botão **Bot ativo / Atendimento humano** na Caixa de Entrada liga/desliga a resposta automática.

## Observações

- v1 trata **texto**. Mídia (imagem/áudio/documento) é registrada como `[tipo]` no histórico, sem download.
- O bot só responde dentro do horário configurado; fora disso envia a mensagem de fora do horário.
- As telas atualizam por polling (5s na conversa aberta, 8s na lista).
