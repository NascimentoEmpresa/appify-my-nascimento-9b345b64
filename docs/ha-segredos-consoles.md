# Os 13 segredos: onde clicar, campo por campo

> ## ✅ FECHADO em 16/10/2026
>
> Os 11 que faltavam estão nos dois nós. O container das Edge Functions saiu de
> **10 para 35 variáveis**, e o que ainda falta nele são exatamente as **9 que
> também não existem na produção** — ou seja, **paridade**.
>
> O trio do WhatsApp foi provado contra a própria API da Meta, não por hash:
>
> ```
> phone_number_id 1218636128000287 -> +55 51 9156-1344 "Recrutamento Nascimento", GREEN
> waba_id         909474664895017  -> "Recrutamento Nascimento"
> debug_token     type=SYSTEM_USER, expires_at=0 (nunca expira), is_valid=true
>                 scopes: whatsapp_business_messaging, whatsapp_business_management
> ```
>
> `expires_at: 0` é o que importa: é o token **permanente**, não o de 24 h.
>
> O texto abaixo fica porque ele erra em dois pontos que custaram tempo, e os
> erros estão corrigidos no lugar — apagar não ensina ninguém.

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
grupo (o nosso é o **"hagg"**, id `1751833982487578`).

> ⚠️ **A Meta tirou "WhatsApp" do menu lateral.** Esta página mandava procurar
> um item que não existe mais, e foi por isso que o Eduardo não achou nada em
> 16/10. Na interface atual, o que era o menu *WhatsApp* virou **Casos de uso**:
> no Painel do app, o card de baixo —
> **"Casos de uso neste app → Conectar-se com clientes pelo WhatsApp ›"** — é a
> porta de entrada. Clique nele (ou em **Casos de uso**, no menu da esquerda).
> É lá dentro que ficam a *Identificação do número de telefone* e a
> *Identificação da conta do WhatsApp Business*.

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

## 5. Discord — ✅ resolvido em 16/10, e eu tinha complicado à toa

**Qual aplicativo é o do ERP, sem precisar adivinhar:** o token do bot em
`worker/.env` **carrega o id do aplicativo dentro dele** (um token do Discord é
`base64url(app_id).carimbo.assinatura`). Decodificando o primeiro trecho sai
`1524116324182396978` — que é o **"Notif de Erro Agend Reunião"**. O outro
aplicativo da conta ("Prs Criadas") é o notificador de PR e não entra nisto.

```bash
BT=$(grep -m1 '^DISCORD_BOT_TOKEN=' worker/.env | cut -d= -f2-)
P=${BT%%.*}; case $(( ${#P} % 4 )) in 2) P="$P==";; 3) P="$P=";; esac
printf '%s' "$P" | tr '_-' '/+' | base64 -d     # -> o id do aplicativo
```

| Valor | De onde veio |
|---|---|
| `DISCORD_CLIENT_ID` | **é esse id** — `1524116324182396978`. Não é segredo. |
| `DISCORD_CLIENT_SECRET` | único que exige o painel: entre no **aplicativo** → menu da esquerda → **OAuth2** → *Client Secret*. ⚠️ **"OAuth2" não aparece na lista de aplicativos** — só dentro de um deles. Foi onde o Eduardo travou, e a culpa é desta página. |
| `DISCORD_REDIRECT_URIS` | **não é segredo e não se copia de painel**: é a lista branca que a function aceita, e o navegador manda `origin + /app/meu-perfil/discord`. O `--derivados` monta. |

> **"Se eu resetar o secret, perco as conexões?" — não.** Os vínculos moram na
> tabela `public.usuario_discord`, no banco. Medido em 16/10: **65 pessoas, as
> 65 verificadas por OAuth**. O secret só serve para vínculos **novos**;
> resetar não apaga uma linha. O que para, até a chave nova estar nos dois
> lados, é alguém vincular pela primeira vez ou atualizar o avatar.

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
