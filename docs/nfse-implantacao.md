# NFS-e de Triunfo — implantação do piloto SIS-2026-0841

O piloto integra **Financeiro → Controle de Notas → Validação de Notas** ao
processamento no worker. Somente homologação é aceita. O resultado fiscal de
teste não altera número, valores ou estado de `nf_emissao`.

## Instância preparada para teste local — 10/11/2026

- ERP local: `http://127.0.0.1:5184/`. Entrar com a conta habitual do ERP.
- Caminho: **Financeiro → Controle de Notas → Validação de Notas**; abrir uma
  preparação **enviada** da HAAG e localizar **Emissão de NFS-e na prefeitura**.
- O banco do cluster recebeu as migrations da fila e das ações do painel.
  O acesso foi habilitado somente para o usuário Eduardo nesta implantação.
  Não houve concessão individual para outros operadores.
- O certificado atualizado está configurado em pasta privada fora do Git.
  A série configurada para esse teste é **1041**, município emissor **3542404**,
  IM da HAAG **3761**. Os demais dados devem ser revisados na preparação.
- O processador exclusivo de homologação está em execução nesta máquina,
  consultando a fila a cada 60 segundos. **Atualizar** na tela apenas consulta
  o resultado; uma solicitação nova exige a confirmação fiscal do formulário.
- A integração foi publicada pela PR #1188 em `https://app.grpnascimento.com.br`.
  A correção complementar de navegação precisa de publicação própria.

A instância local usa o banco real do ERP e envia documentos somente à API
de testes GOVBR. Preparações internas continuam sendo registros reais do ERP;
as solicitações e documentos fiscais de homologação são separados.

No cenário sintético de limpeza já autorizado foram usados serviço 071002,
NBS 118031000, indicador 020201 e endereço do imóvel. Isso é referência do
teste realizado; o formulário exige revisar o enquadramento da preparação.

O processo isolado pode ser iniciado com `npm run nfse:homologacao` na pasta
`worker` quando o worker completo não estiver ativo. `-- --uma-vez` executa
um ciclo para diagnóstico. O estado sem credenciais fica em
`worker/state/nfse-status.json`. O worker completo já chama a mesma fila.

## Instalação

1. A migration `20261110104100_sis_2026_0841_nfse_homologacao.sql` cria o menu
   fantasma `financeiro-nfse`, a numeração, a fila, suas RPCs e o bucket privado.
   O complemento `20261110150000_sis_2026_0841_nfse_acoes_painel.sql` cadastra
   visualizar/incluir/alterar/exportar no Gerenciamento de Acesso.
   Ela entra pelo aplicador do cluster após merge, conforme `CLAUDE.md`.
   O complemento `20261110190000_sis_2026_0841_controle_notas_navegacao.sql`
   alinha os nomes e a entrada das telas, preservando permissões existentes.
2. Publicar o frontend e instalar as dependências do worker com `npm ci` na
   pasta `worker`. O ciclo existente chama o novo processador; não há serviço
   HTTP adicional nem polling no navegador.
3. Copiar `worker/nfse-config.exemplo.json` para um arquivo **fora do
   repositório**, em pasta restrita à conta do worker. Preencher o CNPJ e o
   caminho do certificado; o caminho relativo é resolvido a partir desse JSON.
4. No `worker/.env` não versionado, configurar `NFSE_CONFIG_ARQUIVO`, a variável
   de senha indicada no JSON e, ao terminar as confirmações abaixo,
   `NFSE_HABILITADO=1`. A referência é `worker/nfse.env.example`.
5. Reiniciar o worker. Sem `NFSE_HABILITADO=1`, o módulo permanece inativo e
   não consulta a fila. Não copiar certificado ou senha para `VITE_*`/banco/Git.

O arquivo atualizado da HAAG já passou na validação de titular/chave/validade,
na consulta autenticada de XML/PDF em produção e no envio assíncrono de DPS
no ambiente genérico de testes GOVBR. As notas de homologação 1 e 3 tiveram
XML/PDF recuperados e valores conferidos. Isso não configura automaticamente
o worker nem libera emissão real em Triunfo.

## Confirmações antes de habilitar

- A documentação pública do provedor e o teste realizado confirmam
  `https://reformatributaria.cidade360.cloud/NFSe.Api.Teste`, com município
  emissor IBGE **3542404**, exclusivo para testes. A HAAG conseguiu transmitir
  e consultar nesse ambiente. Marcar `homologacao_confirmada` somente para
  essa configuração validada; isso não equivale a credenciamento de produção
  de Triunfo. Conferir a configuração específica de produção com GOVBR antes
  da etapa seguinte.
- Definir uma série exclusiva de DPS para o ERP no intervalo 1–49999, conferir
  que não foi usada por outro emissor e marcar `serie_confirmada`. O primeiro
  número reservado pelo ERP é 1. Não usar a série 49999 das amostras sem
  confirmação; a consulta de documentos antigos pode continuar usando-a.
- RSA-SHA1 e DPS nacional 1.01 foram aceitos no envio externo realizado.
  O adaptador também suporta SHA-256, validado localmente; sua aceitação
  externa não foi presumida.
- O conector mantém PIS, COFINS e CSLL separados no ERP, mas envia a soma das
  contribuições retidas em `vRetCSLL`, mantendo o detalhamento `vPis/vCofins`.
  Esse comportamento específico GOVBR foi comprovado na homologação e coincide
  com os XMLs recebidos. Enviar somente CSLL nesse campo resultou em líquido
  incorreto, detectado e bloqueado pelo conector. A DPS corrigida resultou na
  nota 3: bruto R$ 100,00; ISS R$ 3,00; INSS R$ 11,00; IR R$ 4,80; PIS
  R$ 0,65; COFINS R$ 3,00; CSLL R$ 1,00; líquido **R$ 76,55**. Revisar os
  enquadramentos com o Financeiro antes de produção.
- O pacote XSD usado é o nacional 1.01 de 09/02/2026. Versões posteriores de
  produção restrita não são presumidas como adotadas pelo município. A nota
  de compatibilidade do pattern da série está em `worker/src/nfse/esquemas`.

## Uso

Após publicar a correção de navegação, abrir
`https://app.grpnascimento.com.br/app/financeiro/emissao-nf/` apresenta as opções
**Emissão de NF** e **Validação de Notas** autorizadas para o usuário. As duas
telas também oferecem botões no topo para alternar entre as etapas.
Na sidebar, ficam no grupo **Financeiro → Controle de Notas**. No Gerenciamento
de Acesso, procurar **Controle de Notas**, **Emissão de NF** e **Validação de Notas**
no módulo Financeiro. O endereço da validação continua sendo
`/app/financeiro/emissao-nf/controle-notas`.

O administrador controla a permissão `NFS-e — integração e homologação` no
Financeiro. Visualização, inclusão, alteração e exportação são verificadas
também no banco. O perfil do módulo Financeiro recebe as ações pelo mesmo
padrão das outras funcionalidades desse módulo; exceções individuais continuam
sob controle do administrador.

No diálogo de conferência de uma preparação enviada ao Financeiro:

1. Abrir **Preparar emissão em homologação** e revisar prestador, tomador,
   serviço, retenções, classificação de IBS/CBS e imóvel da prestação quando
   aplicável. Os valores vêm da preparação
   salva no banco, não de totais enviados pelo navegador.
2. Confirmar a revisão fiscal e solicitar. Se houve alterações locais nos
   valores da conferência, salvar a preparação na tela de Emissão antes.
3. Usar **Atualizar** para acompanhar. O worker processa uma solicitação por
   ciclo de 60 segundos e consulta o resultado no ciclo seguinte.
4. Baixar XML/PDF oficiais quando disponíveis, mediante permissão de exportar.

O piloto cobre emissão regular de serviços nacionais para tomador identificado,
com endereço de imóvel quando exigido por IBS/CBS, sem obra, intermediário,
substituição ou evento fiscal de cancelamento.
O município de incidência é determinado pelo provedor a partir do serviço e
local de prestação informados; não se copia automaticamente o município do
prestador para o tomador ou para a prestação. Situações fora desse recorte
devem permanecer no portal até a próxima etapa da integração.

## Falhas e recuperação

- **Erro antes do envio:** corrigir dados/configuração e retomar, ou descartar a
  solicitação antes de iniciar o envio. A numeração consumida não é reciclada.
- **Timeout/queda depois de iniciar envio:** o marcador está no banco. O worker
  consulta protocolo/DPS e não retransmite automaticamente, mesmo após reinício.
- **Rejeição fiscal:** os erros retornados ficam visíveis; corrigir e criar uma
  nova solicitação, com nova DPS. HTTP 200 do lote não significa autorização.
- **Autorizada sem PDF:** o XML e a autorização são preservados; o worker tenta
  obter o PDF sem reenviar a DPS.
- **Reserva expirada:** outra instância retoma após 3 minutos. O resultado de
  uma reserva antiga é rejeitado. Há limite de 30 consultas; a retomada manual
  mantém a distinção entre preparar e consultar um envio já iniciado.
- **Resultado com CNPJ, DPS, ambiente, chave ou valores divergentes:** fica em
  consulta/revisão; não é associado automaticamente como autorização válida.

Para parar a integração, desabilitar `NFSE_HABILITADO`. Preservar fila,
numeração e documentos para auditoria. A produção exige uma próxima liberação
explícita: SQL, geração e cliente HTTP atualmente bloqueiam esse ambiente.

## Verificação

`npm run test -- --run src/test/nfse-integracao.test.ts` verifica documento,
assinaturas, XSD, certificado, bloqueio de produção e recuperação de falhas.
Instalar também as dependências de `worker` antes dos testes. O job de testes
do CI foi ajustado para fazer essa instalação.

`worker/test/nfse-fila.sql` aplica a migration em um PostgreSQL 18 descartável
chamado `nfse_0841_teste` e testa permissões, RLS, valores canônicos, duplo
clique, reserva e proteção contra resultado de worker antigo. O complemento
`worker/test/nfse-concorrencia.cjs` usa o mesmo banco local em
`127.0.0.1:58441`, com `NFSE_TESTE_PSQL` apontando para o executável `psql`,
para duas transações e dois workers realmente concorrentes. Não usar esses
scripts no cluster do ERP.
