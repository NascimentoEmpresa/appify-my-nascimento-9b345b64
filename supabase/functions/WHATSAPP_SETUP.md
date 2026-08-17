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
supabase functions deploy whatsapp-abertura
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

## 7. Template de abertura (conversas que NÓS começamos)

O botão **Nova conversa** da Caixa de Entrada fala com quem nunca escreveu para
a gente. Fora da janela de 24h a Meta só entrega **template aprovado**, então o
template precisa existir antes:

1. Rodar a migration `20260906000003_wa_nova_conversa` (cria `abertura_texto`,
   `abertura_botao` e `abertura_template` em `WA_BOT_CONFIG`).
2. Abrir **Nova conversa** e clicar em **Criar template na Meta** no aviso que
   aparece quando o envio falha — ou chamar direto:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/whatsapp-abertura" \
  -H "Authorization: Bearer $SEU_JWT" -H "Content-Type: application/json" \
  -d '{"acao":"criar_template"}'
```

3. Esperar a revisão da Meta (`PENDING` → `APPROVED`). Costuma levar de alguns
   minutos a um dia.

O texto vive em `WA_BOT_CONFIG.abertura_texto` porque três pontas precisam do
mesmo conteúdo: a prévia na tela, o envio dentro da janela de 24h e o template.
**Editar o texto não muda o template já aprovado** — template aprovado é
imutável na Meta. Depois de editar, é preciso criar um template novo (outro
nome em `abertura_template`) e esperar nova aprovação.

## Observações

- v1 trata **texto**. Mídia (imagem/áudio/documento) é registrada como `[tipo]` no histórico, sem download.
- O bot só responde dentro do horário configurado; fora disso envia a mensagem de fora do horário.
- As telas atualizam por polling (5s na conversa aberta, 8s na lista).
