# banco1 de 2 para 4 vCPU na Vultr

> Item 11 do pedido de 03/11/2026.

## Por que você não achou a opção

A opção **existe**: no painel da Vultr, clique no servidor → aba **Settings** →
**Change Plan**. Ela só lista planos com **máquina livre na região**. Medido pela
API em 03/11/2026, às 20:41 (Brasília):

```
GET /v2/instances/f3b98878-…/upgrades?type=plans   ->  {"plans": []}
GET /v2/regions/sao/availability (família vc2)     ->  só vc2-1c-1gb
```

Hoje **não há `vc2-4c-8gb` (4 vCPU / 8 GB) em estoque em São Paulo**, então a
lista vem vazia. Não é permissão, nem conta, nem configuração. A capacidade da
Vultr em São Paulo oscila (em 08/10/2026 o `vc2-2c-4gb` sumiu de manhã e voltou
à tarde).

## Vale a pena?

Sim. O teste de carga (docs/infra/capacidade.md) mostrou que o teto de
**~85 req/s** é **CPU do Postgres** no banco1: a 90 req/s, os dois núcleos
ficaram em 97 %, e o Postgres tinha ~93 % do tempo de CPU dos processos. Com
4 núcleos, o esperado é perto do dobro. O número real se mede rodando o mesmo
`infra/carga/carga.mjs` depois.

| Plano | vCPU / RAM / disco | Preço base | Em São Paulo (+50 %) |
|---|---|---|---|
| hoje: `vc2-2c-4gb` | 2 / 4 GB / 80 GB | US$ 20 | ~US$ 30 |
| **`vc2-4c-8gb`** | 4 / 8 GB / 160 GB | US$ 40 | **~US$ 60** |
| `vhp-4c-8gb-amd` (High Performance) | 4 / 8 GB / 180 GB NVMe | US$ 48 | ~US$ 72 |

O "+50 %" é o acréscimo de região que a própria Vultr avisa na tela ("Region-
specific costs included"). Confira o valor final no Change Plan antes de
confirmar.

## Caminho A — esperar o estoque e trocar no lugar (recomendado)

1. **No terminal deste PC** (prompt do Claude Code), digite:

   ```
   ! bash infra/ha/vultr-upgrade-banco1.sh --vigiar
   ```

   Ele pergunta à Vultr a cada 10 min e para quando aparecer
   `upgrade oferecido ao banco1: SIM`.

2. **Fora do horário comercial** (o banco1 vai reiniciar), troque o líder para
   o banco2. No mesmo terminal:

   ```
   ! ssh -p 8443 root@216.238.120.171 '/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml switchover --leader banco1 --candidate banco2 --force'
   ```

   Custa ~48 s de erro para quem estiver usando. Por isso, fora do horário.

3. Peça o upgrade. Pode ser **pelo painel** (servidor **banco1** → **Settings**
   → **Change Plan** → escolha **4 vCPU / 8 GB** → **Upgrade**) ou pelo script:

   ```
   ! bash infra/ha/vultr-upgrade-banco1.sh --aplicar
   ```

   O script recusa se o líder ainda não for o banco2. A máquina reinicia
   sozinha, em 2 a 5 min.

4. Confira que voltou e virou réplica síncrona:

   ```
   ! bash infra/ha/estado-cluster.sh
   ```

   Procure `banco1 | Sync Standby | streaming`.

5. Devolva o líder ao banco1, que agora é o maior:

   ```
   ! ssh -p 8443 root@216.238.120.171 '/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml switchover --leader banco2 --candidate banco1 --force'
   ```

6. **Ajuste o Postgres à memória nova.** O `patroni.yml` foi feito para 4 GB
   (`shared_buffers: 1GB`, `effective_cache_size: 3GB`). Com 8 GB:
   `shared_buffers: 2GB`, `effective_cache_size: 6GB`. Exige reiniciar o
   Postgres (`patronictl edit-config` + `restart`), de novo fora do horário. O
   item 8 também precisa de um reinício (para ligar o `pg_stat_statements`):
   dá para fazer os dois na mesma janela.

## Caminho B — se o estoque não voltar: máquina nova + troca de líder

A família **`vhp`** (High Performance AMD) **tem** 4 vCPU disponível em São
Paulo hoje (`vhp-4c-8gb-amd`). A Vultr não muda de família no lugar, então
seria:

1. criar `banco3` (`vhp-4c-8gb-amd`, São Paulo) pela API com
   `infra/ha/modelos/boot-ssh-443.sh`, como foi feito com o banco1
   (`infra/ha/README.md`);
2. `instalar-banco.sh` e `instalar-tunel.sh` para ele entrar no cluster como
   réplica;
3. esperar `Sync Standby`, trocar o líder para ele (48 s, fora do horário);
4. tirar o banco1 antigo do cluster e destruí-lo.

O endereço da API (`api.grpnascimento.com.br`) aponta para o IP do banco1.
Para não mexer no DNS, converta antes o IP do banco1 em **Reserved IP** (painel
da Vultr → **Network** → **Reserved IPs** → *Convert*) e depois anexe esse IP
ao banco3. Leva umas 2 horas de trabalho, contra ~15 min do Caminho A.

## E o banco2?

Ele é quem assume se o banco1 cair, e hoje tem **1 vCPU / 2 GB**
(docs/infra/por-que-nao-houve-failover.md). Com o banco1 em 4 vCPU, a
distância fica maior. No Linode o redimensionamento é pelo painel: **Linodes →
banco2 → Resize**, e não tem esse problema de estoque.
