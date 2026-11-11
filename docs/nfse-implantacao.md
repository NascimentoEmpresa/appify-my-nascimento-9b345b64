# NFS-e de Triunfo — implantação do piloto SIS-2026-0841

O piloto integra **Financeiro → Controle de Notas → Validação de Notas** ao
processamento no worker. Homologação e produção têm fila, configuração e
numeração separadas. Homologação está habilitada; produção depende da série,
revisão fiscal e primeira preparação real. O resultado fiscal de teste não
altera número, valores ou estado de `nf_emissao`.

## Instâncias e hospedagem — 11/11/2026

- ERP local: `http://127.0.0.1:5184/`. Entrar com a conta habitual do ERP.
- Caminho: **Financeiro → Controle de Notas → Validação de Notas**; abrir uma
  preparação **enviada** da HAAG e localizar **Emissão de NFS-e na prefeitura**.
- O banco do cluster recebeu as migrations da fila e das ações do painel.
  O acesso foi habilitado somente para o usuário Eduardo nesta implantação.
  Não houve concessão individual para outros operadores.
- O certificado atualizado está configurado em pasta privada fora do Git.
  A série configurada para esse teste é **1041**, município emissor **3542404**,
  IM da HAAG **3761**. Os demais dados devem ser revisados na preparação.
- O processador de homologação foi transferido ao GitHub Actions pela PR
  #1199. O primeiro ciclo remoto foi concluído com sucesso e o processo local
  foi encerrado. **Atualizar** apenas consulta o resultado salvo; uma nova
  solicitação exige as confirmações fiscais do formulário.
- ERP online: `https://app.grpnascimento.com.br`. A integração foi publicada
  pela PR #1188 e a navegação pela PR #1191; os nomes dos menus já foram
  conferidos no cluster. A renumeração da migration está nesta atualização.

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
   O complemento `20261110203100_sis_2026_0841_controle_notas_navegacao.sql`
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

## Processamento temporário pelo GitHub Actions

O workflow **NFS-e - fila automática** (`nfse_homologacao.yml`) executa
um trabalho da fila a cada cinco minutos, exclusivamente na `main` do
repositório oficial. Usa o mesmo processamento, reservas e proteção contra
duplicidade do worker local. Não inicia WhatsApp, e-mail ou os outros workers.
O estado e os documentos persistem no banco/storage do ERP; o runner é descartável.

O ambiente GitHub `nfse-homologacao` deve permitir implantação somente da
branch `main`. A variável de repositório `NFSE_ACTIONS_HABILITADO=1` habilita
o job. Os secrets desse ambiente são:

| Secret | Conteúdo |
| --- | --- |
| `NFSE_SUPABASE_URL` | Endereço da API do cluster. |
| `NFSE_SUPABASE_SERVICE_ROLE_KEY` | Credencial de servidor usada pelo processador. |
| `NFSE_CONFIG_JSON` | Configuração da única empresa habilitada, série, algoritmo e URL de homologação. |
| `NFSE_CERTIFICADO_PFX_B64` | PFX codificado em base64, armazenado como secret. |
| `NFSE_CERTIFICADO_SENHA` | Senha do PFX. |

O processador substitui caminhos locais por arquivos privados no `RUNNER_TEMP`
e os remove ao terminar, inclusive em caso de erro. Certificado e senha não
entram no repositório, cache npm ou artefatos. A configuração e o próprio
conector exigem configuração separada para produção.

Depois do merge, conferir em **Actions → NFS-e - fila automática**.
**Run workflow** executa um ciclo manualmente na `main`; o cron dispensa essa
ação no uso normal. Uma execução verde confirma que o ciclo rodou; o resultado
fiscal de cada pedido deve ser conferido no painel do ERP.

O envio e a consulta podem precisar de execuções diferentes: com fila vazia
antes do pedido, normalmente há um ciclo para envio e outro para consulta,
cerca de 5–10 minutos, além de atrasos do agendador ou espera por outros pedidos.
**Atualizar** no ERP apenas relê o resultado salvo; não dispara o Actions.
O [GitHub documenta intervalo mínimo de cinco minutos e possíveis atrasos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

O primeiro ciclo remoto já foi conferido; o processador local foi encerrado.
A reserva no banco protege contra disputa caso duas instâncias se sobreponham.
Para migrar depois ao servidor do ERP: configurar os mesmos arquivos privados,
iniciar somente o processador NFS-e como serviço, verificar o ciclo e definir
`NFSE_ACTIONS_HABILITADO=0`. A migração de hospedagem não habilita emissão real.

## ERP online e ambiente fiscal de produção

O ERP online já é o sistema de uso da empresa. O ambiente fiscal selecionado
pelo piloto continua sendo a homologação GOVBR; publicar uma PR não transforma
os documentos de teste em notas reais de Triunfo.

O fluxo definitivo de emissão real será: operador revisa no ERP → processador
transmite à API de produção → consulta protocolo/DPS → ERP mostra autorização
ou rejeição, número/chave e XML/PDF oficiais. Receber um lote ou HTTP 200 não
equivale a autorizar a nota. A resposta fiscal vem da API oficial, sem automação
do login do portal. O código separa os dois ambientes, mas a habilitação real
depende da configuração fiscal e da validação operacional abaixo.

Para liberar produção, confirmar a série exclusiva e a preparação nova a
transmitir com o Financeiro. O ambiente GitHub `nfse-producao`, restrito à main,
usa os mesmos cinco nomes de secrets, mas a configuração JSON contém
`ambiente: producao`, `producao_confirmada: true`, a série real e os campos
`municipio_emissor`/`inscricao_municipal` conferidos. A URL é exclusivamente
`https://webapp1-triunfo.cidade360.cloud/NFSe.Api`.

A migration `20261111140000_sis_2026_0841_nfse_producao.sql` cria a configuração
por empresa/ambiente e mantém produção desabilitada por padrão. A equipe técnica
deve preencher a série e restringir `nf_piloto_id` à preparação da primeira
validação antes de habilitar a empresa. A variável GitHub
`NFSE_ACTIONS_PRODUCAO_HABILITADO=1` libera o job de produção; esse job também
exige `NFSE_PRODUCAO_HABILITADA=1` no processo. O usuário revisa os dados e marca
as duas confirmações no formulário. A produção recusa preparações que já têm
número de NF informado, prevenindo reenvio inadvertido de documento anterior.

Validar a primeira emissão real de um serviço efetivo, conferindo a mesma
chave/documento no ERP e na consulta da prefeitura. Somente após essa conferência
retirar a restrição da preparação piloto para o uso regular autorizado.
O certificado já permitiu consultar documentos antigos em produção, mas
nenhuma DPS foi enviada em produção. Não reutilizar automaticamente o município
emissor genérico 3542404 nem a série de teste como configuração de Triunfo.

O acompanhamento implementado cobre o processamento da emissão e a recuperação
dos documentos. Ainda não monitora cancelamento/substituição realizados no
portal, nem importa todo o histórico externo. O resultado fiscal de homologação
permanece separado do número e da conclusão interna da preparação do ERP.

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

Abrir
`https://app.grpnascimento.com.br/app/financeiro/emissao-nf/` apresenta as opções
**Emissão de NF** e **Validação de Notas** autorizadas para o usuário. As duas
telas também oferecem botões no topo para alternar entre as etapas.
Na sidebar, ficam no grupo **Financeiro → Controle de Notas**. No Gerenciamento
de Acesso, procurar **Controle de Notas**, **Emissão de NF** e **Validação de Notas**
no módulo Financeiro. O endereço da validação continua sendo
`/app/financeiro/emissao-nf/controle-notas`.

O administrador controla a permissão `NFS-e — integração com a prefeitura` no
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
3. Usar **Atualizar** para acompanhar. No Actions, o agendamento é a cada
   cinco minutos; no processador contínuo local, a cada 60 segundos. O envio
   e a consulta de resultado podem ocorrer em ciclos diferentes.
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
numeração e documentos para auditoria. A produção exige configuração explícita
por empresa e no processador; mudar apenas a URL não habilita emissão real.

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
