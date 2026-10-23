# Automação de agentes de IA para chamados — histórico de reconstrução

Registro deste pedido e da implementação local feita em 22/10/2026. Este
histórico é versionado para orientar a reconstrução manual em outro computador;
ele não contém scripts executáveis, credenciais ou configuração local.

## Fluxo analisado em produção

- `/app/central-servicos/chamados/novo` cria `CHAMADO_SISTEMA`, envia anexos
  privados ao bucket `chamados-sistemas` e o banco grava o evento de abertura.
- `/app/sistemas/chamados/painel` distribui pelo RPC `chamado_direcionar`, que
  registra o evento “Chamado direcionado a…”.
- `/app/sistemas/chamados/dev` lista apenas os chamados cujo `responsavel_id`
  é o usuário logado. Reaberturas voltam à fila dele quando conservam o
  responsável e registram “Chamado reaberto…”.

## Implementação

O `worker` local passou a consumir ambos os eventos para o usuário configurado
em `CHAMADOS_DEV_USER_ID`. Esse consumo é o webhook durável: não perde eventos
enquanto o computador está desligado e não expõe uma porta pública. Quando ele
liga, o worker retoma os eventos pendentes.

Com `CHAMADOS_DEV_AGENTE_AUTOMATICO=1`, para cada atribuição/reabertura o
worker:

1. Baixa os anexos para `worker/state/agentes/<SIS-ID>/anexos/`.
2. Cria uma worktree detached por chamado. Não cria branch: a única branch de
   publicação continua sendo `eduardo`.
3. Abre uma janela PowerShell intitulada com o ID do chamado.
4. Inicia Codex Terra com capacidade low (baixa/média) ou high (alta). Caso o
   Codex termine com falha/limite, inicia Claude Code: Sonnet/xhigh ou
   Opus/high, respectivamente.
5. Entrega instruções para classificar bug/criação/ajuste, reproduzir bugs,
   validar imagens de referência no navegador, testar antes de publicar e não
   ampliar o escopo.
6. Exige que uma dúvida chame `notificar-duvida-agente.ps1`, que mostra uma
   notificação do Windows; Eduardo responde no mesmo terminal e o contexto
   permanece na sessão.
7. Serializa publicação com mutex local e consulta de PR aberta da branch
   `eduardo`. O segundo agente espera a primeira PR ser fechada, integra seu
   commit sobre `origin/eduardo` sem rebase/force e abre sua PR.

## Limite técnico importante

GitHub não consegue abrir um terminal nesta máquina nem usar assinaturas locais
de Codex/Claude por conta própria. O código fica no repositório GitHub, mas o
executor precisa ser este worker local (ou, no futuro, um GitHub Actions
self-hosted runner instalado neste computador). O computador desligado encerra
naturalmente a automação, como solicitado.

## Como usar este histórico em outro computador

Os scripts e a configuração que executam os agentes permanecem locais nesta
máquina e não fazem parte desta PR. Em outra máquina, use este registro e o
guia complementar para recriar os scripts localmente, configurar as variáveis
em `worker/.env`, autenticar Codex, Claude Code e GitHub CLI, e iniciar o
worker. Não copie credenciais entre computadores nem as inclua no repositório.

## Arquivos alterados nesta implementação

- `worker/src/agentesChamados.js`
- `worker/src/chamadosDev.js`
- `worker/scripts/notificar-duvida-agente.ps1`
- `worker/scripts/encerrar-agente.ps1`
- `worker/scripts/publicar-pr-agente.ps1`
- `worker/.env.example`
