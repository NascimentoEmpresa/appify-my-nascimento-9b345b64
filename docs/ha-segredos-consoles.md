# Os 13 segredos: onde clicar, campo por campo

> Para a pergunta *"como faço? onde pego?"*. Cada item diz **onde clicar** e
> **com que cara o valor aparece**, para você reconhecer que pegou o certo.

## Antes: por que não faço isto por você

Eu faço tudo que é no servidor, no banco e no GitHub — e fiz. Mas estes
valores moram em **contas suas** (Meta, Google, Groq, Lovable, Discord), atrás
do seu login e da sua verificação em duas etapas. Para entrar, eu precisaria da
sua senha, e **senha sua não passa por esta conversa**: ela fica gravada em
disco, em log e na sincronização. Foi por isso que recusei quando você ofereceu,
e continua valendo.

Também tentei **duas** formas de recuperar sem console, e as duas fecharam a
porta de vez:

1. **Por hash.** O resumo que a Supabase devolve é SHA256 puro do valor, então
   varri todo `.env`, log, dump e documento desta máquina comparando. Não achou
   nada.
2. **Pelo banco.** `WA_MENSAGEM` guarda payload de 4.085 mensagens — mas é o
   payload **interno do ERP**, não o cru da Meta: `phone_number_id` não aparece
   em nenhuma linha.

O que eu posso garantir é o outro lado: **você não precisa acertar de primeira.**
Como o resumo é SHA256 do valor, eu confiro cada linha que você trouxer e digo
`CONFERIDO igual a producao` ou `DIFERENTE`. Não existe "será que é essa?".

---

## Como anotar

Abra o Bloco de Notas e salve como `segredos.env` na sua pasta de usuário
(`C:\Users\Eduardo Monteiro\segredos.env`). Uma linha por valor, **sem aspas e
sem espaço** em volta do `=`:

```
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
```

Pode trazer só algumas e conferir; o que faltar aparece como pendente.

---

## 1. Meta — WhatsApp (6 valores, a visita mais longa)

**https://developers.facebook.com/apps** → entre → clique no app do WhatsApp do
grupo.

| Valor | Onde |
|---|---|
| `WHATSAPP_APP_ID` | **Configurações → Básico**, campo *ID do aplicativo*. Número de ~15 dígitos, fica no topo da página. |
| `WHATSAPP_APP_SECRET` | Mesma página, campo *Chave secreta do aplicativo*: clique em **Mostrar** e confirme a senha. ~32 caracteres hexadecimais. |
| `WHATSAPP_PHONE_NUMBER_ID` | **WhatsApp → Configuração da API**. Na caixa *De*, abaixo do número, aparece **Identificação do número de telefone**. Número longo — **não é o telefone**. |
| `WHATSAPP_WABA_ID` | Mesma página, **Identificação da conta do WhatsApp Business**. |
| `WHATSAPP_TOKEN` | Mesma página, *Token de acesso*. ⚠️ O token do topo é **temporário (24 h)**. O que serve é o **permanente**: **Configurações do negócio → Usuários → Usuários do sistema** → o usuário do sistema → **Gerar novo token** → marque `whatsapp_business_messaging` e `whatsapp_business_management` → sem expiração. Começa com `EAA...`. |
| `WHATSAPP_VERIFY_TOKEN` | **Este você inventa.** Qualquer frase sem espaços (ex.: `nascimento-webhook-2026`). Ele é só uma senha combinada entre nós e a Meta. |

> **Já que você vai estar lá, resolva o webhook na mesma visita.** Depois da
> virada, o endereço muda. Em **WhatsApp → Configuração → Webhook → Editar**:
>
> ```
> URL de retorno:  https://api.grpnascimento.com.br/functions/v1/whatsapp-webhook
> Token de verificação:  (o WHATSAPP_VERIFY_TOKEN que você acabou de inventar)
> ```
>
> **Mas só troque isso na hora da virada, não agora** — se trocar agora, as
> mensagens recebidas passam a ir para o cluster, que ainda não é a produção, e
> o chatbot fica mudo sem ninguém reclamar. Anote o valor hoje, troque a URL
> hoje à noite.

## 2. Google AI Studio — `GEMINI_API_KEY`

**https://aistudio.google.com/apikey** → **Criar chave de API**. Pode criar uma
nova sem medo: a antiga continua valendo até você apagá-la. Começa com `AIza`.

## 3. Groq — `GROQ_API_KEY`

**https://console.groq.com/keys** → **Create API Key**. ⚠️ O valor aparece
**uma vez só**; se fechar a janela sem copiar, crie outra. Começa com `gsk_`.

## 4. Lovable — `LOVABLE_API_KEY`

No painel da Lovable, menu da conta → **Settings** → **API Keys**. Se não
houver essa seção no seu plano, me avise: as seis functions que usam essa chave
são de I.A. e dá para medir exatamente o que para de funcionar sem ela.

## 5. Discord (3 valores)

**https://discord.com/developers/applications** → o aplicativo do grupo.

| Valor | Onde |
|---|---|
| `DISCORD_CLIENT_ID` | **OAuth2** (ou *General Information*), campo **Client ID**. Não é segredo — é o número do aplicativo. |
| `DISCORD_CLIENT_SECRET` | **OAuth2 → Client Secret → Reset Secret**. ⚠️ Resetar **invalida a atual**: o "vincular Discord" para de funcionar até a chave nova estar nos dois lados. Faça junto com o resto, não solto. |
| `DISCORD_REDIRECT_URIS` | **OAuth2 → Redirects**. Copie a(s) URL(s) que já estão lá, exatamente como estão. Se houver mais de uma, separe por vírgula sem espaço. |

> Na virada, acrescente aqui a URL nova (mantendo a antiga até ter certeza).

## 6. GitHub — `GITHUB_TOKEN`

**https://github.com/settings/tokens** → **Tokens (classic)** → **Generate new
token (classic)**. Marque `repo` e `workflow`. Começa com `ghp_` e aparece
**uma vez só**.

---

## Depois de preencher

```bash
SEGREDOS=~/segredos.env bash infra/ha/configurar-secrets.sh --conferir
```

Cada linha vira `CONFERIDO igual a producao`, `ATENCAO: DIFERENTE da producao`
ou continua como `SO na Supabase` (ainda não trazida). **Nenhum valor aparece
na tela, em nenhum momento** — nem truncado.

Quando estiver tudo conferido:

```bash
SEGREDOS=~/segredos.env bash infra/ha/configurar-secrets.sh --aplicar
```

E **apague o arquivo** — o lugar definitivo é o nó, com `chmod 600`:

```bash
shred -u ~/segredos.env
```

### Sobre o "DIFERENTE da produção"

Para `GEMINI_API_KEY`, `GROQ_API_KEY`, `GITHUB_TOKEN` e
`DISCORD_CLIENT_SECRET`, **DIFERENTE é esperado**: você está criando chave
nova, não recuperando a antiga. Nesse caso a chave nova precisa valer nos
**dois** lados — me avise e eu coloco a mesma na Supabase, para não ficar uma
em cada lugar.

Para `WHATSAPP_*` e `DISCORD_CLIENT_ID`, que são leitura e não criação,
**DIFERENTE significa que você copiou o campo errado** — quase sempre o
telefone no lugar do *phone number id*, ou o token temporário no lugar do
permanente.

---

## Os três que eu resolvo sem console nenhum

```
CHAMADOS_CI_SECRET   as duas pontas são nossas (Supabase + secret do GitHub)
VAPID_PRIVATE_KEY    par novo; só 3 assinaturas de push existem hoje
VAPID_PUBLIC_KEY     a pública vai para o build do Lovable (VITE_VAPID_PUBLIC_KEY)
```

São 16 no total: **13 seus, 3 meus.**
