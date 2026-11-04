# Limite de tamanho em todo campo de anexo

> Item 10 do pedido de 03/11/2026. Regra: **10 MB por padrão, 25 MB para
> documentos e currículos.**

## Onde a regra mora

| Camada | O quê | Efeito |
|---|---|---|
| Banco (garantia) | `storage.buckets.file_size_limit`, migration `20261103009300` | o Storage responde **413** acima do limite, venha o upload de onde vier (tela, script, Edge Function) |
| Navegador (aviso) | `src/lib/limiteAnexo.ts`, instalado em `client.ts` com `limitarUploads(supabase.storage)` | recusa **antes de enviar**, com o nome do arquivo, o tamanho e o limite. Cobre os 63 `.upload(` do ERP sem mexer em nenhum |

Mensagem que o usuário vê, no toast que cada tela já tem:

> *contrato.pdf tem 34,2 MB e o limite deste anexo é 25 MB. Reduza o arquivo
> (PDF comprimido, foto em resolução menor) ou divida em partes.*

## Como ficou, bucket a bucket (levantado na produção em 03/11)

**Antes:** 19 dos 57 buckets **sem limite nenhum**, e 4 acima de 25 MB.

| Grupo | Buckets | Antes | Depois |
|---|---|---|---|
| Documentos sem limite | malote-anexos, curriculos, checklist-faturamento-anexos, solicitacoes-ajuste-anexos, juridico-docs, pre-titulos-fiscal, extrator-beneficios, fcr-uploads, cartao-faturas | sem limite | **25 MB** |
| Documentos acima de 25 MB | whatsapp-midia (100 MB), denuncia-evidencias (50 MB), caepi (60 MB), migracao-zero (1 GB) | 50 MB a 1 GB | **25 MB** |
| Imagem/foto/áudio sem limite | sup-comprovacoes, sup-crachas, avatars, cartao-logos, colaboradores-fotos, bi-capas, sup-veiculo-foto, nfe-xml, copiloto-audios, identidade-visual | sem limite | **10 MB** |
| Já tinham limite ≤ 25 MB | os outros 31 | 5 a 25 MB | **sem mudança** (a regra nunca aumenta um limite menor) |
| Bucket novo criado sem limite | — | sem limite | **10 MB** (a migration aplica o padrão a qualquer bucket sem limite) |

**Arquivos que já estão lá acima do novo limite continuam guardados.** O
limite vale para envio novo:

- `checklist-faturamento-anexos`: 29 acima de 10 MB e **5 acima de 25 MB** (o
  maior com **91 MB**). É o bucket que mais vai sentir. Se o faturamento
  precisar mandar arquivo assim, o caminho é comprimir o PDF.
- `juridico-docs`: 2 acima de 25 MB (maior 35 MB).
- `migracao-zero`: 4 acima de 25 MB (48 MB). Bucket da migração do sistema
  antigo, já concluída.

## Decisão pendente: vídeos

Três buckets guardam **vídeo**, e lá 25 MB quebra a função:

| Bucket | Limite hoje | Maior arquivo no ar |
|---|---|---|
| `trn-midia` (aulas da plataforma de treinamento) | 500 MB | **243 MB** |
| `treinamentos` | 200 MB | 67 MB |
| `tv-midia` | 200 MB | 2,7 MB |

Ficaram **como estavam**. Se o Eduardo quiser o limite também neles, o
caminho é vídeo fora do Storage (YouTube não listado ou Vimeo, só o link no
ERP), e não um limite que impeça subir aula.

## Teste

- `src/test/limite-anexo.test.ts`: 25/10 MB por bucket; padrão para bucket
  desconhecido; nenhum bucket fora os de vídeo acima de 25 MB; aceita no limite
  exato e recusa 1 byte acima; upload grande **não chega a chamar o
  servidor**; upload dentro do limite segue normal.
- Na produção, depois de aplicar a migration: a própria migration falha se
  sobrar bucket sem limite ou acima de 25 MB fora os de vídeo (bloco `DO` no
  fim).
