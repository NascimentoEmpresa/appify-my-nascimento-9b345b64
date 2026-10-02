# Instalar o agente do GitHub no servidor da empresa

Passo a passo para o **servidor de arquivos** (o que fica na salinha com ar
condicionado e nobreak, onde mora o `S:`). Depois disso, o backup do ERP passa
a ser copiado para lá **todos os dias, sozinho**, sem depender do PC de
ninguém.

Leia o aviso de segurança no fim antes de começar — ele muda um passo.

---

## Antes de começar

Você vai precisar de:

- acesso de **Área de Trabalho Remota** (ou físico) ao servidor;
- ser administrador **nesse servidor** (só para instalar; o agente em si vai
  rodar como usuário comum);
- a pasta onde o histórico vai ficar, por exemplo `S:\1- SERVIDOR\Sistemas\Backup-ERP`.

A máquina precisa alcançar a internet. **Não é preciso abrir porta nenhuma no
firewall**: o agente liga para o GitHub de dentro para fora, igual a um
navegador.

---

## Passo 1 — Criar um usuário só para isto

Isto é o que impede que um problema no agente vire um problema no servidor
inteiro.

No servidor, abra o **PowerShell como administrador** (botão direito no menu
Iniciar → *Windows PowerShell (Admin)*) e digite:

```powershell
$senha = Read-Host "Senha para o usuario do agente" -AsSecureString
New-LocalUser -Name "runner-erp" -Password $senha -FullName "Agente GitHub do ERP" -Description "Copia o backup do ERP para o S:"
```

Guarde essa senha no gerenciador de senhas — você vai usá-la no passo 4.

**Não** adicione esse usuário ao grupo Administradores.

Agora dê a ele acesso **só** à pasta do histórico:

```powershell
# As aspas sao OBRIGATORIAS aqui: o caminho tem um espaco ("1- SERVIDOR") e,
# sem elas, o PowerShell corta no espaco e cria a pasta no lugar errado.
New-Item -ItemType Directory -Path "S:\1- SERVIDOR\Sistemas\Backup-ERP" -Force
icacls "S:\1- SERVIDOR\Sistemas\Backup-ERP" /grant "runner-erp:(OI)(CI)M"
```

O `M` é "modificar": ele pode criar e alterar arquivos ali dentro, e **nada
mais** no servidor.

---

## Passo 2 — Pegar o instalador no GitHub

No **seu PC**, abra:

```
https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64/settings/actions/runners/new
```

Escolha **Windows** e **x64**. A página mostra uma sequência de comandos com um
**token** no meio — ele vale por 1 hora, então faça os passos 3 e 4 na
sequência.

Deixe essa página aberta: você vai copiar comandos dela.

---

## Passo 3 — Baixar no servidor

No servidor, no PowerShell **como administrador**:

```powershell
mkdir C:\actions-runner
cd C:\actions-runner
```

Agora copie da página do GitHub as duas linhas que começam com
`Invoke-WebRequest` e `Add-Type` (download e descompactação) e cole aqui.
Elas mudam de versão em versão — por isso não estão escritas neste documento.

---

## Passo 4 — Configurar o agente

Ainda no servidor, copie da página do GitHub a linha que começa com
`./config.cmd --url ...`, e **acrescente no fim**:

```
--labels self-hosted,windows,servidor-arquivos --name servidor-arquivos --unattended
```

O trecho `--labels` é o que faz o workflow encontrar esta máquina. Ele precisa
bater exatamente com o que está em `historico_servidor.yml`:

```yaml
runs-on: [self-hosted, windows, servidor-arquivos]
```

Depois, instale como serviço do Windows — assim ele sobe sozinho quando a
máquina reinicia:

```powershell
./svc.sh install runner-erp
```

Se esse comando não existir na sua versão, use:

```powershell
.\config.cmd --runasservice --windowslogonaccount ".\runner-erp" --windowslogonpassword "<a senha do passo 1>"
```

Inicie:

```powershell
./svc.sh start
```

---

## Passo 5 — Dizer onde guardar

No **seu PC**, abra:

```
https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64/settings/variables/actions
```

Clique em **New repository variable**:

- **Name:** `CAMINHO_HISTORICO`
- **Value:** `S:\1- SERVIDOR\Sistemas\Backup-ERP`

O caminho fica aqui, e não dentro do código, por dois motivos: dá para mudar a
pasta sem mexer em arquivo nenhum, e o caminho interno da empresa não vai parar
num repositório público.

---

## Passo 6 — Ajustar a segurança do repositório

Abra:

```
https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64/settings/actions
```

Em **Fork pull request workflows from outside collaborators**, marque:

> **Require approval for all external contributors**

Isso é o que impede que alguém de fora dispare algo no servidor abrindo um PR.

---

## Passo 7 — Testar

No seu PC:

```
https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64/actions/workflows/historico_servidor.yml
```

Clique em **Run workflow**. Na primeira vez pode deixar `dias` em `30`.

A primeira execução copia uns **5 GB** e demora. As seguintes copiam só o que é
novo e terminam em segundos.

Quando acabar, confira no servidor:

```powershell
Get-ChildItem S:\1- SERVIDOR\Sistemas\Backup-ERP -Recurse -Filter *.zip |
  Group-Object { $_.Directory.Name } |
  Select-Object Name, Count, @{n='GB';e={[math]::Round(($_.Group | Measure-Object Length -Sum).Sum/1GB,2)}}
```

---

## Como achar um anexo antigo depois

É o fluxo que o Eduardo desenhou: o usuário encontra o arquivo **no ERP**, e
quem procura vai no `S:` com esse nome.

1. no ERP, abra o anexo e copie o nome do arquivo;
2. no servidor, procure por ele:

```powershell
# Os backups sao ZIPs cifrados; esta busca encontra o BACKUP que contem a data,
# nao o arquivo solto. Para extrair, veja "Recuperar" abaixo.
Get-ChildItem S:\1- SERVIDOR\Sistemas\Backup-ERP -Recurse -Filter "storage-arquivos*" |
  Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime, @{n='MB';e={[math]::Round($_.Length/1MB)}}
```

### Recuperar de verdade

Os arquivos estão **cifrados com GPG**, e a chave privada **não fica no
servidor** — isso é de propósito: quem comprometer o servidor leva arquivos que
não consegue abrir.

Para extrair, no PC que tem a chave:

```powershell
# 1. descompactar o ZIP do GitHub
Expand-Archive "S:\1- SERVIDOR\Sistemas\Backup-ERP\2026-10\storage-arquivos-XXXX.zip" -DestinationPath .\tmp
# 2. decifrar e extrair (pede a senha da chave)
gpg --decrypt .\tmp\storage-arquivos.tar.gpg | tar -xf -
```

Os arquivos saem em `arquivos/<balde>/<caminho original>`, com os nomes de
verdade preservados.

---

## Aviso de segurança — por que o passo 1 não é opcional

O repositório do ERP é **público**. O próprio GitHub desaconselha agentes
self-hosted em repositórios públicos, porque um workflow disparado por
terceiros rodaria código **dentro da rede da empresa**.

Quatro coisas tornam este caso seguro, e todas precisam valer:

| | |
|---|---|
| O workflow **não roda em Pull Request** | só `schedule` e `workflow_dispatch`, que existem apenas na branch principal |
| Trava de fork | `if: github.repository == '...'` — se alguém copiar o repositório, não roda |
| **Usuário sem poderes** | passo 1: `runner-erp` não é administrador e só enxerga a pasta de backup |
| Aprovação para gente de fora | passo 6 |

Com isso, quem poderia rodar algo no servidor é quem já tem acesso de escrita
ao repositório — a própria equipe, o mesmo nível de confiança de quem já faz
deploy em produção.

**Se algum dia este repositório deixar de ser público, nada aqui muda** — só
fica mais folgado.

---

## Se der problema

| Sintoma | O que olhar |
|---|---|
| O workflow fica "Queued" e não anda | O agente está parado. No servidor: `Get-Service actions.runner.*` e `Start-Service` |
| `CAMINHO_HISTORICO nao definida` | Passo 5 |
| `Menos de 20 GB livres` | O volume encheu — é uma trava de propósito, para não derrubar o servidor |
| `Acesso negado` ao gravar | O `icacls` do passo 1 não pegou, ou a pasta é outra |
| Falhou e ninguém viu | Chega DM no Discord do Eduardo; o canal não é usado para isto |
