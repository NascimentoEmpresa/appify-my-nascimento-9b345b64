# Os anexos não são replicados pelo banco — e o que fizemos

Medido em 13/10/2026, com a pilha do ERP já rodando nos dois bancos.

## O problema, exatamente como ele aparece

O banco é replicado de forma síncrona: transação confirmada está nos dois nós,
perda zero. **Os arquivos de anexo não.** O `storage-api` está com
`STORAGE_BACKEND=file`, e "file" quer dizer disco local do container.

Teste real, arquivo enviado pelo `banco1`:

| | |
|---|---|
| upload no `banco1` | **200** |
| download no `banco1` | **200** — `arquivo-criado-no-banco1` |
| a linha aparece na listagem pelo `banco2` | **sim** (o banco é compartilhado) |
| download do mesmo arquivo pelo `banco2` | **500** |

Repare no **500, não 404**. O anexo *aparece* na tela do ERP — porque a lista
vem do banco, que é compartilhado — e estoura ao abrir. Numa troca de primário,
todo anexo enviado pelo nó anterior viraria link quebrado, com a linha presente
para acusar que o arquivo *deveria* existir.

São **5.577 MB em 11.192 objetos, 51 buckets** na produção hoje. Os maiores:
`checklist-faturamento-anexos` (1.536 MB), `malote-anexos` (1.191 MB),
`treinamentos` (474 MB), `curriculos` (431 MB).

## O que fizemos: espelho pelo túnel, nos dois sentidos

`infra/ha/espelhar-anexos.sh` + timer de 1 minuto em cada nó. Cada máquina
*puxa* do par pelo WireGuard o que ela não tem.

Depois do espelho, o mesmo teste:

| | |
|---|---|
| download pelo `banco2` do arquivo criado no `banco1` | **200** |
| `content-type` que o navegador recebe | **`text/plain; charset=UTF-8`** |
| download pelo `banco1` do arquivo criado no `banco2` | **200** |

### As três decisões que importam

**`-X` (xattr) é obrigatório.** O `content-type` do anexo não mora no banco:
mora em atributo estendido no próprio arquivo.

```
user.supabase.content-type="application/pdf"
user.supabase.cache-control="no-cache"
```

Cópia sem `-X` entrega o byte certo e o download morre com `ENODATA`, num erro
que não fala de arquivo nenhum. Já aconteceu neste projeto, com `tar`.

**`--ignore-existing`, e nunca `--delete`.** O caminho de cada arquivo termina
na versão (`.../prova.txt/7b7a326b-…`), então o conteúdo de um caminho nunca
muda e não existe conflito a resolver. Sem `--delete` porque os dois nós rodam
isto um contra o outro: o nó que ainda não recebeu um arquivo novo apagaria o
original no outro. O custo é arquivo órfão ocupando disco depois de uma
exclusão — barato, e resolvível depois por uma faxina que confira contra
`storage.objects`.

**A chave do espelho não abre shell.** Ela é restrita por `from=10.77.0.x` (só
vale dentro do túnel, nem com o IP público na mão) e por `command=`, que ignora
o que o cliente pedir e roda um script que só aceita duas coisas: consultar o
caminho do volume, ou servir um `rsync` de leitura. Provado:

```
$ ssh -i /root/.ssh/espelho_anexos root@10.77.0.11 "id"
espelho: comando nao permitido
$ ssh -i /root/.ssh/espelho_anexos root@10.77.0.11 "cat /etc/shadow"
espelho: comando nao permitido
```

## O que isto não resolve

**A janela do intervalo.** Anexo enviado e provedor caindo no mesmo minuto =
arquivo só no nó que caiu, e ele volta quando o nó voltar. O banco tem perda
zero; o anexo tem até 1 minuto.

A alternativa é backend **S3 compartilhado**: elimina a janela e, em troca,
devolve ao desenho um fornecedor único para os anexos — exatamente o que este
projeto existe para evitar. Custo de um bucket desse tamanho: ~US$ 5/mês.

**Decisão:** ficamos com o espelho, que custa zero e mantém a independência de
fornecedor. Se um dia a janela de 1 minuto incomodar, trocar é mudar duas
variáveis no `docker-compose.cluster.yml` — não é refazer nada.
