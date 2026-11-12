# NFS-e de Triunfo — implantação do piloto SIS-2026-0841

O piloto integra **Financeiro → Controle de Notas → Validação de Notas** ao
processamento no worker. Homologação e produção têm fila, configuração e
numeração separadas. Homologação está habilitada; produção depende da configuração
técnica e da revisão fiscal pelo operador. O resultado fiscal de teste não
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

O workflow **NFS-e - fila automática** (`nfse_homologacao.yml`) agenda
uma execução por hora, exclusivamente na `main` do
repositório oficial. Usa o mesmo processamento, reservas e proteção contra
duplicidade do worker local. Não inicia WhatsApp, e-mail ou os outros workers.
O estado e os documentos persistem no banco/storage do ERP; o runner é descartável.
Cada job fica ativo por até 340 minutos, com ciclos a cada 60 segundos, seguindo
o modelo de `espelho-mysql/rapida-continua.sh`. A próxima execução aguarda no
grupo; uma publicação substitui o processo anterior. Reservas e marcas de envio
persistidas preservam a reconciliação após uma interrupção.

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
**Run workflow**, com **continuo** marcado, inicia o processador na `main`.
Desmarcado, executa um diagnóstico de até dois ciclos quando a execução puder
entrar no grupo de concorrência. O workflow também
executa após publicação de alterações no próprio workflow ou no processador.
Uma execução verde confirma que o ciclo rodou; o resultado
fiscal de cada pedido deve ser conferido no painel do ERP.

Enquanto o job está ativo, novos pedidos, protocolos e PDFs pendentes são
processados nos ciclos de 60 segundos, respeitando a reserva e o prazo do banco.
Falhas de infraestrutura avulsas não encerram o serviço; três consecutivas
encerram com erro. Ao atingir o prazo, o job termina e remove os arquivos privados.
**Atualizar** no ERP apenas relê o resultado salvo; não dispara o Actions.
O [GitHub documenta intervalo mínimo de cinco minutos e possíveis atrasos](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Na conferência de 11/11, o disparo após merge autorizou a DPS 2 de homologação,
mas não foram observadas execuções fiscais do tipo `schedule`, inclusive após
reativar o workflow. O próprio espelho do ponto já documenta atrasos de horas
nesse repositório. O modo contínuo reduz a dependência do cron durante o job;
não garante disponibilidade sem interrupção se não houver outra execução na
fila quando ele terminar. Conferir os jobs ativos/pendentes em Actions e usar
**Run workflow** se necessário. A hospedagem definitiva continua sendo o servidor.

O primeiro ciclo remoto já foi conferido; o processador local foi encerrado.
A reserva no banco protege contra disputa caso duas instâncias se sobreponham.
Para migrar depois ao servidor do ERP: configurar os mesmos arquivos privados,
iniciar somente o processador NFS-e como serviço, verificar o ciclo e definir
as duas variáveis `NFSE_ACTIONS_HABILITADO=0` e
`NFSE_ACTIONS_PRODUCAO_HABILITADO=0`, cancelando também execuções ativas do Actions.
As variáveis impedem novos jobs; não encerram um job contínuo já em andamento.
A migração de hospedagem não habilita emissão real.

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

Para liberar produção, parametrizar a série reservada ao ERP para a empresa.
O Financeiro escolhe a preparação e confirma a emissão real diretamente no ERP;
não precisa informar antecipadamente sua identificação à equipe técnica.
O ambiente GitHub `nfse-producao`, restrito à main,
usa os mesmos cinco nomes de secrets, mas a configuração JSON contém
`ambiente: producao`, `producao_confirmada: true`, a série real e os campos
`municipio_emissor`/`inscricao_municipal` conferidos. A URL é exclusivamente
`https://webapp1-triunfo.cidade360.cloud/NFSe.Api`.

A migration `20261111140000_sis_2026_0841_nfse_producao.sql` cria a configuração
por empresa/ambiente e mantém produção desabilitada por padrão. A equipe técnica
deve preencher a série antes de habilitar a empresa. `nf_piloto_id` é opcional;
nulo permite ao Financeiro escolher qualquer preparação apta da empresa.
A variável GitHub
`NFSE_ACTIONS_PRODUCAO_HABILITADO=1` libera o job de produção; esse job também
exige `NFSE_PRODUCAO_HABILITADA=1` no processo. O usuário revisa os dados e marca
as duas confirmações no formulário. A produção recusa preparações que já têm
número de NF informado, prevenindo reenvio inadvertido de documento anterior.

Validar a primeira emissão real de um serviço efetivo, conferindo a mesma
chave/documento no ERP e na consulta da prefeitura.
O certificado já permitiu consultar documentos antigos em produção, mas
nenhuma DPS foi enviada em produção. Não reutilizar automaticamente o município
emissor genérico 3542404 nem a série de teste como configuração de Triunfo.

O acompanhamento implementado cobre o processamento da emissão e a recuperação
dos documentos. Ainda não monitora cancelamento/substituição realizados no
portal, nem importa todo o histórico externo. O resultado fiscal de homologação
permanece separado do número e da conclusão interna da preparação do ERP.

## Retorno do primeiro pedido pela tela — 11/11/2026

A primeira solicitação do Financeiro, DPS 1 / série 1041 em homologação,
tinha o local da prestação como nome da cidade e CEP com sete dígitos.
O desenvolvedor confirmou o CEP **95840-000**. Antes do envio, a correção
técnica foi registrada no snapshot com auditoria: local da prestação 4322004,
município emissor de testes 3542404 e CEP 95840000. Valores e enquadramentos
fiscais foram preservados.

O lote foi recebido e o protocolo consultado. O retorno oficial foi
**P9022: O XML deve ser enviado sem quebras de linha (sem identação)**, com
`id: null`. A solicitação foi reconciliada como rejeitada, sem retransmissão.
O adaptador agora substitui quebras nos textos por espaços **antes** de assinar,
mantendo assinatura e XSD válidos. Erro sem Id só é associado ao protocolo já
persistido quando há um único item rejeitado sem chave/XML; não autoriza nota.

O formulário passa a validar CEP e formatos dos códigos antes de criar o
pedido. Série, município emissor e IM configurados são somente leitura.
Em erro anterior ao envio, **Corrigir dados** encerra a tentativa sem transmissão
e reabre seus campos para revisão; exige alterar e incluir. Após início do
envio, continua disponível somente a consulta. Rejeição definitiva permite
preparar outro pedido com nova DPS, preservando o histórico anterior.

Após o merge da PR #1208, a DPS 2 foi autorizada como NFS-e 4 em homologação.
O job 43059515284 foi disparado automaticamente pelo merge e recuperou XML/PDF,
com bruto R$ 1.500,00 e líquido R$ 1.188,00 conferidos. O PDF enviado pelo
Financeiro é idêntico ao arquivo do provedor e identifica homologação, sem
validade jurídica. A validação real de produção ainda não foi feita.

Em 11/11, o processador de produção foi preparado para HAAG, série 1041,
município 4322004 e IM 3761. O job 43066664230 passou com a fila vazia, validando
certificado/configuração e acesso ao banco. A consulta de DPS 1 / série 1041
em produção não encontrou nota. Isso não é uma auditoria completa de histórico.
A configuração do ERP permanece desabilitada até publicar o modo contínuo e
conferir o processador ativo; nenhuma solicitação real foi criada nessa etapa.

O arquivo atualizado da HAAG já passou na validação de titular/chave/validade,
na consulta autenticada de XML/PDF em produção e no envio assíncrono de DPS
no ambiente genérico de testes GOVBR. As notas de homologação 1 e 3 tiveram
XML/PDF recuperados e valores conferidos. Isso não configura automaticamente
o worker nem libera emissão real em Triunfo.

## Serviço municipal e rejeição P5006

A DPS 2 de produção, série 1041, foi recebida e rejeitada por P5006: o serviço
nacional 170501 tem mais de uma correspondência municipal vigente em Triunfo.
O retorno indicou 7830200, 8111700 e 8630502 e exigiu o campo `cIntContrib`.
Nenhuma NFS-e foi autorizada nessa tentativa.

O campo **Código do serviço na prefeitura** envia `codigo_integracao_municipal`
para `cServ/cIntContrib`, após `cNBS`, conforme o XSD nacional. Aceita de 1 a
20 letras/números, sem separadores. O campo anterior foi renomeado para
**Desdobramento municipal, se aplicável** e continua enviando `cTribMun`, de
três dígitos. Os dois códigos são distintos e não devem ser substituídos um
pelo outro. Para serviço 170501, município emissor 4322004, em produção, o
formulário e o processador exigem o código do serviço da prefeitura antes do envio.

O código não é escolhido automaticamente. A nota anterior 1442 da HAAG traz
170501 com `cIntContrib=8111700`, mas é de outro contrato. O Financeiro deve
confirmar o enquadramento da prestação atual no portal ou com o responsável
fiscal. Após publicar a correção, usar **Preparar emissão em produção** na
mesma preparação apta, informar o código confirmado, revisar e confirmar uma
nova solicitação/DPS. Preservar a tentativa rejeitada e não retransmiti-la.

O ensaio desta correção usa XML e assinaturas locais, sem criar pedido nem
transmitir outra DPS fiscal.

## Alíquota parametrizada e rejeição P3070

Na DPS 3 de produção, o código municipal 8111700 foi informado e o provedor
retornou P3070, vedando a alíquota explícita no cenário declarado: não optante,
regime especial nenhum e municípios de emissão, prestação e tomador em Triunfo.
O gerador passa a omitir somente `pAliq` nessa combinação local em produção.
O XSD nacional declara o campo opcional e informa que a alíquota do município
participante é fornecida pelo sistema. Homologação, Simples Nacional e cenários
com prestação ou tomador fora de Triunfo mantêm o comportamento anterior.

A alíquota de conferência de 5%, o ISS de R$ 75,00 e o líquido de R$ 1.188,00
permanecem no snapshot. O retorno oficial continua sendo confrontado com os
valores salvos; uma divergência não é aceita automaticamente. A DPS 3 permanece
rejeitada no histórico. Após publicar o ajuste, o operador deve revisar e
confirmar uma nova solicitação; não zerar os valores para contornar a rejeição.

## Inscrição municipal do tomador e rejeição P4016

A DPS 4 de produção foi rejeitada por P4016: o tomador possui mais de um
cadastro de contribuinte no município, e o provedor exige sua inscrição
municipal para identificar o cadastro correto. O formulário e o XML ainda
não transportavam esse dado do tomador.

O grupo **Tomador** passa a oferecer **Inscrição municipal do tomador**,
enviada em `toma/IM`, antes de `xNome`, conforme o XSD nacional. Preservar
zeros iniciais e o identificador confirmado pelo Financeiro no cadastro da
prefeitura; não copiar a inscrição do prestador. O campo aceita até 15
caracteres e continua opcional nos casos em que a prefeitura não o exige.
Após uma rejeição P4016, o painel exige seu preenchimento e nova revisão.

Após a publicação, abrir a preparação em Validação de Notas, selecionar
Produção e Preparar emissão em produção. Preencher a inscrição correta no
grupo Tomador, revisar os dados e confirmar uma nova solicitação. A DPS 4
rejeitada permanece no histórico e não é retransmitida automaticamente.

## Assinatura da DPS dentro da NFS-e e consulta no ADN

A C14N inclusiva considera os namespaces dos elementos ancestrais. A GOVBR
inclui `xmlns:xsd` e `xmlns:xsi` no elemento NFSe. Sem declarar esses mesmos
namespaces antes de assinar a DPS, sua assinatura pode conferir isoladamente
e falhar dentro da NFS-e, embora a assinatura municipal externa seja válida.
O assinador agora declara os dois namespaces antes de calcular digest e
SignedInfo. Mantém os algoritmos SHA-1/SHA-256 configurados e os dados fiscais.
O teste de regressão confere ambos os algoritmos com a DPS separada e aninhada
no mesmo contexto XML usado pelo provedor.

Autorização municipal não comprova, por si só, o recebimento pelo Ambiente
de Dados Nacional. A API de envio de Triunfo retorna protocolo e sucesso
municipal; `dadosExtras` oferece somente notificações por e-mail, sem opção
de compartilhamento ao ADN. A confirmação nacional deve ser obtida por
consulta oficial, com certificado do próprio contribuinte, ou por comprovante
de compartilhamento fornecido pelo município/provedor.

A correção vale para novos documentos assinados. Não alterar ou reassinar uma
NFS-e já emitida no armazenamento do ERP. Em caso de ausência no ADN, solicitar
ao município/provedor o recibo ou a rejeição do compartilhamento e a análise
do reprocessamento da mesma nota. Não retransmitir uma nova DPS para suprir
essa pendência, pois isso pode criar outra nota fiscal.

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
