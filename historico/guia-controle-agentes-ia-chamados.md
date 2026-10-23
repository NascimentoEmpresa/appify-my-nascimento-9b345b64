# Como reconstruir, iniciar e encerrar os agentes de IA

Este guia é versionado como referência de reconstrução. Os scripts, credenciais
e o arquivo `worker/.env` permanecem locais e não são incluídos neste histórico.

## Preparar uma vez

No arquivo `worker/.env`, configure somente nomes/caminhos, sem expor valores
de credenciais em chats:

```dotenv
CHAMADOS_DEV_USER_ID=<id do perfil de Eduardo Jeiel Padilha Monteiro Vaz>
CHAMADOS_DEV_REPO_PATH=C:\Users\Eduardo Monteiro\desktop\projeto_erp_lovable
CHAMADOS_DEV_AGENTE_AUTOMATICO=1
CHAMADOS_DEV_AGENTE_PREFERIDO=codex
CHAMADOS_DEV_MAX_CONCORRENTES=2
```

Confirme que `codex login`, `claude login` e `gh auth status` estão prontos na
conta local. O worker já precisa ser iniciado pela rotina
normal da máquina.

## Iniciar

1. Defina `CHAMADOS_DEV_AGENTE_AUTOMATICO=1`.
2. Inicie o worker: dentro de `worker`, use `npm start` (ou o serviço local já
   configurado para o worker).
3. A partir do marco inicial do worker, direcione ou reabra um chamado de
   Eduardo. Em até um ciclo do worker, aparecerá uma janela de terminal chamada
   `SIS-AAAA-NNNN`.

O GitHub permanece o local da PR. Para iniciar remotamente via GitHub no futuro,
instale um runner self-hosted Windows neste computador e dispare o worker por
um workflow manual; não use runner hospedado no GitHub, pois ele não enxerga
este terminal, os anexos privados locais nem as sessões de Codex/Claude.

## Intervir em um atendimento

Escreva a orientação diretamente na aba do terminal daquele chamado e envie.
Para dúvida levantada pelo agente, a mensagem do Windows identifica o ID;
responda nessa mesma aba. Não abra uma segunda sessão para o mesmo chamado.

## Encerrar

- Para impedir novos atendimentos, altere `CHAMADOS_DEV_AGENTE_AUTOMATICO=0`
  e reinicie o worker.
- Para parar um atendimento em andamento, foque a aba `SIS-...` e pressione
  `Ctrl+C`; depois feche a aba. Não apague a worktree enquanto estiver nela.
- Para encerrar todos, pare o processo `npm start`/serviço do worker e feche
  as abas `SIS-...`. Desligar o computador também encerra todos os agentes.

Um agente que criou a PR encerra automaticamente a própria aba. A PR não é
mergeada pelo agente; o merge continua sujeito à revisão e às regras do GitHub.

## Retomar depois

Ligue novamente `CHAMADOS_DEV_AGENTE_AUTOMATICO=1` e inicie o worker. O cursor
persistido em `worker/state/chamados-dev.json` evita reprocessar eventos já
aceitos. Se quiser conscientemente retomar um evento que foi ignorado, não
edite o cursor às cegas: reatribua ou reabra o chamado pelo ERP, gerando um
novo evento auditável.

## Segurança e fila de PR

Nunca use `push --force`, reset ou uma branch nova. Cada agente trabalha em
worktree detached; o publicador aguarda não existir PR aberta da `eduardo`,
faz cherry-pick do commit validado sobre a ponta remota da `eduardo`, publica
sem force e cria a próxima PR. Se houver conflito, ele para e mostra uma
notificação para decisão humana.
