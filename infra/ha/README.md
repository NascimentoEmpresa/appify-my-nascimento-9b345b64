# Alta disponibilidade do banco — fora da Supabase

O que existe aqui provisiona um Postgres **com troca automática de primário e
sem perder transação**, no lugar do banco hospedado na Supabase.

Não confundir com `infra/failover/`, que é a **cópia de leitura** de emergência
que já roda hoje na Render. Aquilo é plano B para consultar; isto é o banco
principal continuar de pé sozinho.

## As quatro máquinas

Vultr, região **São Paulo** (`sao`). A escolha da região é por latência, medida
em 06/10/2026 a partir do escritório: São Paulo **23 ms**, Virgínia **140 ms**,
Frankfurt **181 ms**. O preço da Vultr é igual em todas as regiões, então sair
do Brasil não economiza nada — só custa tempo de resposta em cada tela.

| Máquina | Plano | O que roda | US$/mês |
|---|---|---|---|
| `banco1` | `vc2-2c-4gb` | Postgres 17 + Patroni + etcd | 20 |
| `banco2` | `vc2-2c-4gb` | Postgres 17 + Patroni + etcd | 20 |
| `arbitro` | `vc2-1c-1gb` | só etcd | 5 |
| `api` | `vc2-2c-4gb` | GoTrue, PostgREST, Storage, Edge, nginx + HAProxy | 20 |
| | | **total** | **65** |

### Por que o árbitro existe

Com dois nós só, se a rede entre eles cair cada um conclui que o outro morreu e
os dois viram primário. Dois primários aceitando escrita é a forma mais rápida
de perder dado que existe. Com três votos, só o lado que fica com dois assume —
o outro se rebaixa sozinho. O árbitro nunca guarda dado do ERP, por isso é a
máquina mais barata.

### Por que o HAProxy fica na máquina da API

Ele escuta em `127.0.0.1:5000`, junto de quem usa. Se ficasse numa máquina
própria viraria um ponto único de falha novo, e precisaria de IP flutuante mais
um script nosso remanejando endereço na hora da troca — a parte frágil do
desenho. Morando junto da API, se ele cai a API já estava fora de qualquer
jeito. **Some a única peça que seria código nosso.**

O HAProxy sabe quem é o primário perguntando ao Patroni: `/primary` responde
200 só no líder e 503 na standby. Então escrita nunca vai para a réplica.

## Como instalar

Nas duas máquinas de banco, e depois no árbitro:

```bash
# banco1
NOME=banco1 IP_PROPRIO=10.0.0.11 IP_BANCO1=10.0.0.11 IP_BANCO2=10.0.0.12 \
IP_ARBITRO=10.0.0.13 SENHA_SUPER='...' SENHA_REPL='...' \
  bash instalar-banco.sh

# banco2: igual, trocando NOME e IP_PROPRIO

# arbitro
IP_PROPRIO=10.0.0.13 IP_BANCO1=10.0.0.11 IP_BANCO2=10.0.0.12 \
  bash instalar-arbitro.sh
```

Conferir:

```bash
/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml list
```

Tem que aparecer um `Leader` e um `Sync Standby` com `Lag 0`. **Se aparecer
`Replica` em vez de `Sync Standby`, a replicação síncrona não subiu e a
garantia de não perder transação não vale** — não seguir adiante assim.

## O que foi medido, não prometido

Ensaios de 06/10/2026: cluster real, cliente gravando a cada 50 ms, primário
morto a seco (`kill -9` no container, sem aviso).

| Ensaio | Confirmadas | **Perdidas** | **Fora do ar** |
|---|---|---|---|
| `psycopg2` (libpq — PostgREST e GoTrue) | 1031 | **0** | 20,37 s |
| `node-postgres` (Storage API) | 1023 | **0** | 20,17 s |

As duas coisas que isso prova:

1. **Nenhuma transação confirmada se perdeu.** Tudo que o sistema disse que
   salvou estava no banco novo depois da troca.
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

`testar-em-containers.sh` sobe três containers Ubuntu 24.04 com systemd de
verdade e roda **os mesmos scripts** de produção. Pega pacote que mudou de
nome, caminho errado e modelo com variável não substituída antes de qualquer
máquina ser criada.

## O que ainda NÃO está provado

- O corte em si (carregar o schema da Supabase, ligar a replicação lógica,
  virar a chave). Fase seguinte, com ensaio e plano de volta atrás.
- `synchronous_mode_strict`. Com ele o banco prefere **recusar escrita** a
  aceitar sem réplica confirmada. É mais seguro contra perda e mais frágil
  contra indisponibilidade: se a standby cair, o sistema para de gravar.
  A documentação do Patroni é explícita de que nem assim a garantia é absoluta
  (há um caso de borda com backend cancelado). Decidir junto antes de ligar.
- Backup. Hoje o backup cifrado continua valendo; no corte ele passa a sair
  daqui.
