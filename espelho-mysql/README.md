# Espelho MySQL do cliente → Supabase

Copia todo dia as tabelas do MySQL do cliente para o Supabase deste projeto,
dentro de um schema separado chamado `espelho`.

> **Este repositório é público.** Por isso host, usuário e senha reais não
> aparecem em lugar nenhum aqui — ficam só em `credenciais.json`, que o
> `.gitignore` barra. Onde você ler `IP_DO_SERVIDOR` abaixo, use o IP que está
> nesse arquivo.

## Antes de tudo: o DBeaver não participa disso

O DBeaver **não guarda dado nenhum**. Ele é só uma tela para olhar o MySQL do
cliente — como o WhatsApp Web é só uma tela para o WhatsApp. Quem tem os dados
é o MySQL lá no servidor, e o DBeaver chega até ele abrindo um túnel SSH.

Por isso não existe "exportar do DBeaver para o Supabase": o certo é fazer o
mesmo túnel que o DBeaver faz, e ler o MySQL direto. É isso que o `espelho.mjs`
faz. Vantagem: funciona com o DBeaver fechado, e até com o seu PC desligado (se
rodar em servidor).

O caminho é:

```
   este script  ──SSH──►  IP_DO_SERVIDOR  ──►  MySQL (localhost:3306)
                                                    │
                                                    ▼
                                          Supabase, schema "espelho"
```

## Situação atual (18/08/2026)

O script está pronto e testado, **menos o primeiro salto**:

| Etapa | Situação |
|---|---|
| Conexão com o Supabase | ✅ funciona, com permissão de criar schema |
| Script de carga | ✅ escrito, sintaxe e libs conferidas |
| Túnel SSH → `IP_DO_SERVIDOR:22` | ❌ **timeout** |

### A causa: esta rede bloqueia a porta 22 na saída

Não é o firewall do cliente. Foi medido assim:

| Teste | Resultado |
|---|---|
| `IP_DO_SERVIDOR` porta 22 | falha |
| `github.com` porta 22 | **falha também** |
| `gitlab.com` porta 22 | **falha também** |
| `ssh.github.com` porta **443** | funciona |
| Firewall do Windows deste PC | limpo (só regras da Cortana) |

GitHub e GitLab aceitam SSH de qualquer pessoa do mundo na porta 22. Se nem
eles respondem, o bloqueio está **saindo daqui** — na rede da empresa ou no
provedor de internet. E como a 443 funciona, não é "internet ruim": é a porta
22 especificamente que está barrada.

Ou seja: pedir liberação de IP ao pessoal do cliente **não resolveria nada**.

## Passo 1 — desbloquear a porta 22

Há três caminhos. O primeiro que for possível resolve.

**a) Liberar a saída na rede da empresa** — falar com o TI/rede *da sua
empresa* (não com o do cliente):

> "Preciso liberar saída (outbound) TCP na porta 22 para o IP `IP_DO_SERVIDOR`.
> Hoje a porta 22 está bloqueada para qualquer destino nesta rede."

**b) Pedir ao cliente uma porta alternativa** — se o TI daqui não liberar, o
pessoal que administra o `IP_DO_SERVIDOR` pode fazer o SSH escutar também em
outra porta (2222 ou 443, que passam). Aí é só trocar `"porta"` dentro de
`ssh` no `credenciais.json` — o script já aceita qualquer porta.

**c) Rodar de outra máquina** — se existe um computador onde o DBeaver conecta
nesse banco hoje, aquela rede não tem o bloqueio. Rodar o script de lá não
exige mudança nenhuma de firewall.

Para conferir se já desbloquearam: abra o **PowerShell** (tecla Windows,
digite `powershell`, Enter) e digite:

```powershell
Test-NetConnection IP_DO_SERVIDOR -Port 22
```

Na resposta, procure a linha `TcpTestSucceeded`. Se estiver `False`, ainda está
bloqueado. Quando virar `True`, siga para o passo 2.

## Passo 2 — testar as conexões

No **terminal do VS Code** (menu `Terminal` → `New Terminal`), digite:

```powershell
cd espelho-mysql
node espelho.mjs testar
```

Deve aparecer `ok` nas três etapas. Se parar na 1, o IP ainda não está liberado.

## Passo 3 — ver quais tabelas existem

No mesmo terminal:

```powershell
node espelho.mjs descobrir
```

Como o campo "Banco de dados" está em branco no DBeaver, na primeira vez ele
mostra a **lista de bancos**. Escolha o do cliente, abra o arquivo
`espelho-mysql/credenciais.json` no VS Code, escreva o nome dele em `"banco"`,
salve, e rode `descobrir` de novo.

Aí ele lista as tabelas e grava tudo em `tabelas.descobertas.json`.

## Passo 4 — teste de ponta a ponta com UMA tabela

O banco do cliente é grande, então não comece copiando tudo. Escolha **uma**
tabela pequena da lista, abra `espelho-mysql/tabelas.json` no VS Code e deixe
só ela:

```json
{ "tabelas": ["nome_da_tabela_escolhida"] }
```

Rode primeiro **em simulação** — faz o caminho inteiro e desfaz no fim, sem
gravar nada:

```powershell
node espelho.mjs sincronizar --limite 100
```

Se os números fizerem sentido, grave essas 100 linhas de verdade:

```powershell
node espelho.mjs sincronizar --commit --limite 100
```

Agora confira no Supabase: **Table Editor**, e no seletor de schema no topo da
tela troque `public` por `espelho`. A tabela deve estar lá com as 100 linhas.

Isso prova a integração inteira — túnel, MySQL, tipos de coluna, gravação —
gastando segundos em vez de horas.

## Passo 5 — soltar para valer

Com o teste aprovado, tire o `--limite` (ele deixa o espelho pela metade) e
acrescente em `tabelas.json` as outras tabelas que interessam:

```powershell
node espelho.mjs sincronizar --commit
```

Daí em diante o Agendador de Tarefas faz isso sozinho todo dia (seção abaixo).

## A execução automática de todo dia

Já está registrada no **Agendador de Tarefas do Windows**, com o nome
`EspelhoMySQL`:

| | |
|---|---|
| Roda | todo dia às **07:00** |
| O que executa | `espelho-mysql\sincronizar.bat` |
| Se o PC estiver desligado às 07:00 | roda sozinha assim que o PC ligar |
| Registro de cada execução | `espelho-mysql\logs\AAAA-MM-DD.log` |

Ela já está ativa e **vai falhar todo dia até o IP ser liberado** — a falha fica
registrada no log, não quebra nada.

Para ver a tarefa na tela: tecla Windows, digite `Agendador de Tarefas`, Enter.
Ela aparece em **Biblioteca do Agendador de Tarefas**, na lista do meio.

Para mudar o horário, clique com o botão direito nela → `Propriedades` → aba
`Disparadores` → `Editar`.

Para rodar na hora, sem esperar as 07:00: botão direito na tarefa → `Executar`.

⚠️ Como isso roda **neste PC**, ele precisa estar ligado. Se um dia a
sincronização precisar acontecer com o PC desligado, o certo é mudar para um
servidor com IP fixo — o script é o mesmo, muda só quem o chama.

## Como a carga funciona

Cada tabela é **recarregada inteira** dentro de uma transação. Isso significa:

- rodar duas vezes seguidas dá o mesmo resultado (não duplica);
- linha apagada no cliente some do espelho também;
- se cair a conexão no meio, o Supabase fica com os dados de ontem, nunca
  pela metade.

O schema `espelho` é separado de propósito. **Nada aqui escreve em tabela do
ERP** — se algum dia o ERP for consumir esses dados, é com `SELECT` a partir do
`espelho`.

## Segurança das senhas

As senhas ficam em `espelho-mysql/credenciais.json`, que está no `.gitignore`.

⚠️ **Não coloque essas senhas no `.env` do projeto.** O `.env` daqui é
versionado e vai para o GitHub e para o Lovable — qualquer um que abrir o
bundle leria.

As senhas deste projeto foram enviadas por print numa conversa. Vale pedir a
troca delas depois que a integração estiver rodando.
