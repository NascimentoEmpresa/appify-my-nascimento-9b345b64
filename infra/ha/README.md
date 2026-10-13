# Alta disponibilidade do banco — fora da Supabase

O que existe aqui provisiona um Postgres **com troca automática de primário e
sem perder transação**, no lugar do banco hospedado na Supabase.

Não confundir com `infra/failover/`, que é a **cópia de leitura** de emergência
que já roda hoje na Render. Aquilo é plano B para consultar; isto é o banco
principal continuar de pé sozinho.

## As três máquinas, em três provedores diferentes

**Por que três provedores e não três máquinas no mesmo:** duas máquinas na
mesma empresa não protegem contra a empresa cair. Se a Vultr tem um incidente,
os dois bancos somem juntos — e o objetivo desde o começo era o contrário:
quando um fornecedor fica indisponível, outro assume e a produção continua.

**A regra que isso impõe:** nenhum provedor pode ter a maioria dos votos da
eleição, nem tudo que a aplicação precisa para funcionar.

| Papel | Provedor | Máquina | O que roda | US$/mês |
|---|---|---|---|---|
| `banco1` | **Vultr** São Paulo | `vc2-2c-4gb` | Postgres 17 + Patroni + etcd + API | 20,00 |
| `banco2` | **Linode** São Paulo (`br-gru`) | `g6-standard-2` | Postgres 17 + Patroni + etcd + API | 24,00 |
| `arbitro` | **AWS Lightsail** `sa-east-1` | bundle 0,5 GB | só etcd | 4,91 |
| | | | **total** | **48,91** |

R$ 244/mês ao câmbio de 06/10/2026. Hoje se paga R$ 287 (Supabase + container
da Render), e os dois saem no corte.

Qualquer provedor pode cair inteiro:

| Cai | Votos restantes | Resultado |
|---|---|---|
| Vultr | Linode + AWS = 2 de 3 | Linode promove a si mesmo e já tem a API |
| Linode | Vultr + AWS = 2 de 3 | Vultr segue |
| AWS | Vultr + Linode = 2 de 3 | ninguém sente |

Todos em **São Paulo** por latência, medida em 06/10/2026 do escritório: São
Paulo **23 ms**, Virgínia **140 ms**, Frankfurt **181 ms**. No modo síncrono o
banco *espera* a confirmação da réplica — réplica longe deixa o sistema lento
o tempo todo, não só na falha.

Descartados por não ter datacenter no Brasil: **DigitalOcean** e **Hetzner**.
Azure, Google e IBM têm São Paulo, mas cobram bem mais por VM pura.

### Por que o árbitro existe

Com dois nós só, se a rede entre eles cair cada um conclui que o outro morreu e
os dois viram primário. Dois primários aceitando escrita é a forma mais rápida
de perder dado que existe. Com três votos, só o lado que fica com dois assume.
O árbitro nunca guarda dado do ERP — por isso é a máquina mais barata, e por
isso mora num terceiro provedor.

### O túnel cifrado

Não existe rede privada entre provedores diferentes: o tráfego de replicação
iria pela internet aberta. O `gerar-tunel.sh` cria uma rede WireGuard
`10.77.0.0/24` que só existe dentro do túnel; o `instalar-tunel.sh` liga em cada
nó.

Do ponto de vista do Patroni e do etcd é como se as três máquinas estivessem na
mesma rede local — os scripts de instalação nem sabem que são provedores
diferentes, porque recebem sempre os endereços `10.77.0.x`.

No firewall de cada provedor, liberar **apenas a UDP 51820**, e só para os IPs
públicos dos outros dois. Postgres e etcd não escutam na internet.

### Por que o HAProxy fica junto da API

Ele escuta em `127.0.0.1:5000`, na mesma máquina de quem usa. Se ficasse numa
máquina própria viraria um ponto único de falha novo, e precisaria de IP
flutuante mais um script nosso remanejando endereço na troca — a parte frágil
do desenho. Morando junto da API, se ele cai a API já estava fora.
**Some a única peça que seria código nosso.**

O HAProxy sabe quem é o primário perguntando ao Patroni: `/primary` responde
200 só no líder e 503 na standby. Escrita nunca vai para a réplica.

## Como instalar

A ordem importa: **o túnel primeiro**. Sem ele os nós não se enxergam, e o
Patroni conclui que está sozinho.

### 1. Gerar o túnel (uma vez, na sua máquina)

```bash
IP_PUB_BANCO1=<ip público da Vultr> \
IP_PUB_BANCO2=<ip público do Linode> \
IP_PUB_ARBITRO=<ip público do Lightsail> \
  bash gerar-tunel.sh
```

Sai `tunel/banco1.conf`, `tunel/banco2.conf` e `tunel/arbitro.conf`. Copie cada
um para a sua máquina por `scp`. **As chaves privadas estão dentro desses
arquivos — nunca mandar por chat, e-mail ou commit.**

### 2. Ligar o túnel em cada nó

```bash
CONF=/root/banco1.conf bash instalar-tunel.sh    # e assim nos outros dois
```

Conferir antes de seguir: `wg show` tem que listar **dois** pares com handshake
recente, e `ping 10.77.0.12` tem que responder de dentro de qualquer nó.

### 3. Instalar banco e árbitro

Repare que os endereços são sempre os **do túnel**, nunca os públicos:

```bash
# banco1, na Vultr
NOME=banco1 IP_PROPRIO=10.77.0.11 IP_BANCO1=10.77.0.11 IP_BANCO2=10.77.0.12 \
IP_ARBITRO=10.77.0.13 SENHA_SUPER='...' SENHA_REPL='...' \
  bash instalar-banco.sh

# banco2, no Linode: igual, trocando NOME=banco2 e IP_PROPRIO=10.77.0.12

# arbitro, no Lightsail
IP_PROPRIO=10.77.0.13 IP_BANCO1=10.77.0.11 IP_BANCO2=10.77.0.12 \
  bash instalar-arbitro.sh
```

### 4. Conferir

```bash
/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list
```

Tem que aparecer um `Leader` e um `Sync Standby` com `Lag 0`. **Se aparecer
`Replica` em vez de `Sync Standby`, a replicação síncrona não subiu e a
garantia de não perder transação não vale** — não seguir adiante assim.

### 5. Restaurar o schema da produção

```bash
SENHA_SUPABASE=... SENHA_DESTINO=... DESTINO_HOST=10.77.0.12 \
  bash restaurar-schema.sh
```

Ele já chama, na ordem, o `preparar-destino.sql`, o `pos-restauracao.sql`, o
**`papeis-atributos.sql`** e a conferência contra a produção viva. Os três
primeiros não são opcionais nem intercambiáveis:

| Arquivo | O que carrega | O que acontece sem ele |
|---|---|---|
| `preparar-destino.sql` | os 16 papéis, schemas e extensões | entra **1 política de RLS de 1.432** e o banco sobe sem controle de acesso, em silêncio |
| `pos-restauracao.sql` | donos de `auth`/`storage`, `search_path`, timeouts | GoTrue e Storage em laço de reinício |
| `papeis-atributos.sql` | `BYPASSRLS` e participações de papel | o storage recusa **toda** chamada, culpando a RLS por um erro que é de `set_config` |

O terceiro existe porque **`pg_dump` não carrega atributo de papel**: ele
exporta objetos e GRANTs; `pg_authid` e `pg_auth_members` ficam fora.

### 6. Subir a pilha do ERP nos dois nós

```bash
# em cada banco, com /opt/erp/infra/failover/.env já no lugar
cd /opt/erp/infra/failover
docker compose -p erp-pilha -f docker-compose.cluster.yml up -d
```

**A versão das imagens é amarrada ao nível de migration do banco restaurado**,
não é "pegar a mais nova" — conferir a contagem de migrations da tag antes de
atualizar qualquer uma. O caso real está em
[`docs/ha-pilha-nos-dois-nos.md`](../../docs/ha-pilha-nos-dois-nos.md).

### 7. Ligar o espelho de anexos

```bash
bash instalar-espelho-anexos.sh <ip público banco1> <ip público banco2>
```

O banco é replicado; **os arquivos de anexo não**. Sem este passo, anexo
enviado num nó responde 500 no outro depois de uma troca de primário — com a
linha presente no banco para acusar que o arquivo deveria existir. Por quê e o
que isso não resolve: [`docs/ha-anexos-entre-nos.md`](../../docs/ha-anexos-entre-nos.md).

### 8. Conferir contra a produção, sempre antes de virar

```bash
SENHA_SUPABASE=... SENHA_DESTINO=... bash conferir-contra-producao.sh
```

Compara contagens, **índices**, **restrições** e **atributos de papel** com a
produção viva. Não usa número anotado: lê os dois lados na hora, porque a
produção recebe migration quase todo dia — em quatro dias de outubro ela ganhou
2 funções, 1 índice e mudou 1 CHECK.

## O que foi medido, não prometido

Ensaios de 06/10/2026: cluster real, cliente gravando a cada 50 ms, queda seca
sem aviso.

| Ensaio | Confirmadas | **Perdidas** | **Fora do ar** |
|---|---|---|---|
| `psycopg2` (libpq — PostgREST e GoTrue), máquina morta | 1031 | **0** | 20,37 s |
| `node-postgres` (Storage API), máquina morta | 1023 | **0** | 20,17 s |
| **Provedor inteiro derrubado**, com túnel cifrado | 1254 | **0** | **18,92 s** |

O terceiro responde à pergunta que importa: *a Vultr cai inteira — banco, etcd
e API juntos — quanto tempo até o Linode estar gravando?* Resposta medida:
**18,92 segundos, sem perder nada**.

As outras duas coisas que isso prova:

1. **Nenhuma transação confirmada se perdeu**, em nenhum dos três. Tudo que o
   sistema disse que salvou estava no banco novo depois da troca.
2. **O Storage sobrevive sem código especial.** O `pg` do Node não aceita vários
   hosts nem `target_session_attrs` — era o risco do desenho. O `Pool`
   reconectou sozinho pelo HAProxy.

### Por que 20 segundos, e por que não dá para reduzir

É o `ttl` do Patroni: o tempo que a standby espera para ter certeza de que o
primário morreu. Tentei 8 segundos e o Patroni recusou:

```
WARNING: ttl=15 can't be smaller than 20, adjusting...
```

**20 é piso de projeto.** Encurtar é o que causa dois primários. Para
comparação, a AWS documenta **60 a 120 segundos** para o failover do RDS
Multi-AZ, que custaria R$ 1.110/mês.

## Ensaiar sem gastar

Dois ensaios, nenhum deles precisa de máquina criada:

**`testar-em-containers.sh`** — sobe três containers Ubuntu 24.04 com systemd de
verdade e roda **os mesmos scripts** de produção. Pega pacote que mudou de nome,
caminho errado e modelo com variável não substituída.

**`testar-multiprovedor.sh`** — o ensaio que vale. Cada container é um provedor,
só se enxergam por uma rede que simula a internet, e todo o tráfego do cluster
passa pelo túnel cifrado. Depois **derruba um provedor inteiro** (banco, etcd e
API de uma vez) e mede quanto tempo até o outro estar gravando, e se perdeu
alguma transação.

## O que já está provado em cima do cluster

Medido em 13/10/2026, com a pilha de pé nos **dois** bancos:

- **O schema é idêntico ao da produção**: 656 tabelas, 1.432 políticas de RLS,
  1.487 funções, 558 tabelas em que o `anon` tem SELECT, **1.874 índices**,
  **2.514 restrições**, 28 papéis. Comparado contra a produção viva, não contra
  número anotado.
- **Login de verdade**: usuário criado pela API de admin, login com senha
  devolvendo token, `/auth/v1/user` aceitando o token, e `auth.uid()`,
  `auth.role()` e `auth.email()` respondendo certo dentro do banco — é o elo
  que sustenta as 1.432 políticas.
- **Os dois nós respondem igual** na bateria de seis chamadas pelo Kong.
- **Anexo atravessa de um nó para o outro** com `content-type` preservado.
- **4 dias sem um único reinício do Patroni** depois da correção das
  atualizações automáticas (antes: 7 reinícios e um failover às 3h50).

## O que ainda NÃO está provado

- O corte em si (copiar os dados, ligar a replicação lógica, virar a chave).
  Fase seguinte, com ensaio e plano de volta atrás.
- `synchronous_mode_strict`. Com ele o banco prefere **recusar escrita** a
  aceitar sem réplica confirmada. É mais seguro contra perda e mais frágil
  contra indisponibilidade: se a standby cair, o sistema para de gravar.
  A documentação do Patroni é explícita de que nem assim a garantia é absoluta
  (há um caso de borda com backend cancelado). Decidir junto antes de ligar.
- Backup. Hoje o backup cifrado continua valendo; no corte ele passa a sair
  daqui.
- **A janela de 1 minuto do espelho de anexos.** O banco tem perda zero; o
  anexo tem até um minuto. Ver `docs/ha-anexos-entre-nos.md`.

O roteiro do corte (fases, comandos e volta atrás) está em
[`docs/ha-corte-roteiro.md`](../../docs/ha-corte-roteiro.md).
