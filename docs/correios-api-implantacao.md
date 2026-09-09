# Correios — como colocar no ar

Complementa [`integracao-api-correios.md`](integracao-api-correios.md), que
explica a API. Aqui está só o que precisa ser feito **uma vez** para estas três
funcionalidades funcionarem em produção:

- situação do objeto no card de Pedidos de Materiais (API SRO Rastro);
- endereço preenchido pelo CEP na Declaração de Conteúdo (API CEP);
- cotação de frete e prazo na Declaração de Conteúdo (APIs Preço e Prazo).
- mapa do trajeto do objeto no modal de despacho (API SRO Rastro + OpenStreetMap).

Nada disso escreve nos Correios — as três APIs são somente de leitura.

## 1. Rodar a migration

Duas, na ordem, no SQL Editor do projeto:

1. `20260930000061_correios_token_cache.sql` — cria a tabela `correios_token`.
2. `20260930000062_correio_declaracao_cotacao.sql` — acrescenta dimensões,
   valor declarado e o resultado da cotação à declaração, e atualiza a RPC
   `sup_correio_declaracao_salvar` para gravar esses campos.

3. `20260930000082_correios_geo_cidade.sql` — cria `correios_geo_cidade`, o
   cache de coordenada por município que alimenta o mapa do trajeto.

A `correios_token` nasce com RLS ligada e **sem nenhuma policy**, de propósito: só a
service_role (usada dentro da Edge Function) alcança o conteúdo. O que está lá
é uma credencial de sessão do contrato dos Correios — se chegasse ao browser,
qualquer usuário do ERP poderia consultar e postar no contrato da empresa por
24 horas.

## 2. Cadastrar os três secrets

No painel do Supabase: **Edge Functions → Secrets** (ou Settings → Edge
Functions, conforme a versão do painel). Três variáveis:

| Nome | Onde encontrar |
| --- | --- |
| `CORREIOS_API_USUARIO` | o idCorreios — o CNPJ da empresa, só dígitos |
| `CORREIOS_API_CODIGO` | gerado em `cws.correios.com.br` → **Gestão de acesso a API's** |
| `CORREIOS_CARTAO_POSTAGEM` | número do cartão de postagem, visível no Correios Empresas |

O código de acesso **não expira** ("validade indeterminada", diz a própria tela
do CWS). Ele só morre quando alguém clica em **Regerar código de acesso** —
e aí o anterior para de funcionar na hora. Se isso acontecer, atualize o
secret: a function passa a responder com a mensagem pedindo exatamente isso.

Os mesmos valores ficam em `worker/.env` (git-ignorado) para testes por linha
de comando. O `.env` não é lido pela Edge Function — os secrets do painel são
a fonte em produção.

## 3. Publicar a Edge Function `correios`

A função é auto-contida de propósito: **não importa nada de `_shared`**, porque
o editor web do Supabase quebra com import relativo para fora da pasta da
função. Então dá para publicar pelos dois caminhos.

**Pelo painel** (não exige CLI logado):
Edge Functions → **Deploy a new function** → nome `correios` → cole o conteúdo
de `supabase/functions/correios/index.ts` → Deploy.

**Pelo CLI**, se estiver logado:

```
supabase functions deploy correios --project-ref fwmzeaztjxrxxzxzxmgc
```

Não existe `supabase functions logs`; os logs ficam no painel, na aba da
própria função.

## 4. Conferir

Com um pedido despachado via Correio e com código de rastreio preenchido, abra
`/app/suprimentos/pedidos-materiais`. O card deve mostrar um badge com a
situação ("Entregue", "Em trânsito", "Aguardando retirada"…).

Na Declaração de Conteúdo, digite um CEP de 8 dígitos e saia do campo:
logradouro, bairro, cidade e UF se preenchem. CEP único (terminado em `000`,
como o `95840000` de Triunfo) não tem logradouro na base dos Correios — só
cidade e UF vêm, e o que já estava digitado é preservado.

No bloco "Frete e prazo", preencha peso e as três dimensões e clique em
**Cotar frete e prazo**. O botão fica desabilitado até faltar nada, e diz o
que falta.

Se o badge não aparecer, veja os logs da função no painel. As mensagens de erro
são específicas — dizem se falta secret, se o código de acesso foi recusado, ou
se os Correios responderam algo inesperado.

## O que isto NÃO faz

- **Não notifica ninguém.** Não há worker, e-mail ou WhatsApp envolvido. A
  consulta acontece quando alguém abre a tela, e o resultado fica em cache por
  30 minutos no navegador de quem abriu.
- **Não cria postagem.** A pré-postagem (gerar o código de rastreio pelo ERP,
  em vez de pegá-lo no balcão) é uma etapa própria, e é a única que escreve nos
  Correios.


## Sobre a cotação

É **simulação**, não o valor faturado — a tela diz isso. O produto é fixo em
`03220` (SEDEX Contrato AG), que é o que a empresa usa em 100% das postagens
conforme os cupons da agência de Triunfo. Um código de produto que o contrato
não tem é recusado com erro obscuro, então ele é constante no código, não
campo de tela.

O adicional **019 (Valor Declarado)** entra sempre que houver valor declarado.
Todo envio da empresa usa esse adicional, e ele é cobrado à parte: ignorá-lo
faria a cotação errar para menos em todos os casos reais.

Validado em 04/09/2026 contra o cupom do objeto AD867127447BR (4,1 kg,
36x38x38, Triunfo->Realeza, declarado R$ 450): a API devolveu
125,23 + 4,24 = **129,47**, os três idênticos ao impresso na agência.

## Sobre o mapa do trajeto

O botão de mapa fica ao lado do campo **ID de Rastreio Correio**, no modal de
despacho. Ele abre os pontos por onde o objeto passou, ligados na ordem.

**Não é rastreamento por satélite, e a tela diz isso.** Os Correios registram o
objeto quando ele é bipado numa unidade — o que existe é "passou por esta
cidade nesta hora", nunca a posição do veículo. A linha entre dois pinos liga
as cidades em reta; não é a estrada percorrida. Prometer mais que isso levaria
o Compras a tratar o mapa como localização ao vivo, que ele não é.

As coordenadas NÃO vêm dos Correios (eles não devolvem nenhuma). Vêm do
Nominatim (OpenStreetMap): gratuito, sem chave e sem cadastro, em troca de no
máximo uma consulta por segundo. Por isso cada município é resolvido **uma vez
só** e guardado em `correios_geo_cidade` para a empresa inteira — as unidades
de tratamento se repetem em todas as postagens, então a tabela para de crescer
depois das primeiras dezenas de objetos.

Município que o Nominatim não achar fica sem pino, e a tela lista quais foram:
os eventos continuam aparecendo na coluna ao lado, que é onde está a
informação. Um mapa incompleto é melhor que um mapa que inventa a posição.

Os ladrilhos vêm de `tile.openstreetmap.org`, como no mapa do Patrimônio.

## Limites que valem lembrar

- A API de token aceita **3 requisições por segundo**. Por isso o token é
  guardado em `correios_token` e reaproveitado por ~23h30 — nunca peça um token
  por chamada.
- O SRO aceita **50 códigos por consulta**. O hook já divide em lotes, e a tela
  rastreia apenas os pedidos filtrados na hora, não a fila inteira.
- O Rastro só devolve objetos **do contrato do remetente**. Código de terceiro
  volta com `mensagem`, não com eventos — a tela mostra isso em cinza.
