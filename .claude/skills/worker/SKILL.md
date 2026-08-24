---
name: worker
description: Convenções do processo worker/ (Node.js separado, roda localmente, alertas de WhatsApp/e-mail/Discord e polling de chamados). Use ao criar ou alterar qualquer módulo em worker/src/.
---

# worker/ — processo Node separado

Roda **localmente** (não em nuvem — confirmado pela presença de
`worker/.wwebjs_auth/session`, git-ignorado, só existe rodando de verdade
nesta máquina), fora do app Vite (`vite.config.ts` ignora `**/worker/**` no
watcher). `package.json` próprio, `npm start` roda `src/index.js`.

## Estrutura

```
worker/src/index.js          # entrypoint, loop de polling (CICLO_MS = 60_000)
worker/src/supabaseClient.js # client com SUPABASE_SERVICE_ROLE_KEY (ignora RLS)
worker/src/whatsapp.js       # whatsapp-web.js — precisa de sessão QR já autenticada
worker/src/lembreteWhatsapp.js
worker/src/emailAta.js
worker/src/email.js          # nodemailer
worker/src/discordAlert.js   # enviarAlertaDiscord(mensagem) — canal genérico de alerta
worker/.env                  # não versionado — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_*, SMTP_*
```

## Padrão de um módulo novo

Uma função `async function algumaCoisa(supabase, ...outrosClientes)` — recebe
`supabase` como parâmetro (não importa um singleton próprio), exportada e
plugada manualmente no `rodarCiclo()` de `index.js` dentro de um `try/catch`
isolado (erro num módulo não derruba os outros). Referência:
`lembreteWhatsapp.js` → `enviarLembretes10min(supabase, waClient)`: busca
itens numa janela de tempo, itera, cada envio individual tem seu próprio
`try/catch` (falha numa pessoa não trava as demais), marca como processado
mesmo se algum envio falhar (não reprocessa nem fica retentando pra sempre).

## Notificação

`enviarAlertaDiscord(mensagem)` (`discordAlert.js`) é genérica e reaproveitável
— DM real via bot do Discord (`DISCORD_BOT_TOKEN` + `DISCORD_USER_ID`), não
webhook de canal. Prefira reaproveitar em vez de criar canal de notificação
novo.

## Não óbvio

- `SUPABASE_SERVICE_ROLE_KEY` ignora toda RLS — qualquer query aqui já enxerga
  tudo, não precisa (e não deve) tentar simular sessão de usuário.
- Estado local entre ciclos (cursor, contador etc.) não tem convenção
  estabelecida ainda além do padrão "marcar como processado na tabela" — ao
  introduzir estado que não cabe numa coluna do banco, um arquivo JSON simples
  em `worker/state/` é aceitável.
