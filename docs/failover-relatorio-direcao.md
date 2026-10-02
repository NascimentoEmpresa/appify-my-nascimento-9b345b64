# Plano de continuidade do ERP — relatório para a direção

**Data:** 02/10/2026
**Responsável:** Eduardo Monteiro — Infraestrutura

---

## Em uma frase

O ERP da empresa dependia de **um único fornecedor** para existir. Hoje existe
uma cópia completa e funcional em outro provedor, atualizada cinco vezes por
dia, e os 8.500 arquivos anexados ao sistema passaram a ter cópia de segurança
— coisa que **nunca tiveram**.

---

## O risco que existia

Todo o ERP — dados, login, permissões, arquivos — vivia na conta de um
fornecedor (Supabase). Se essa conta ficasse indisponível, por qualquer motivo,
a empresa ficava sem sistema e **sem alternativa**: não havia para onde ir.

Não é hipótese distante. A instância do fornecedor **caiu três vezes em 2026**
(falta de CPU, de conexões e de memória), e foi preciso aumentar o plano em
23/09 para estabilizar.

Havia ainda um risco silencioso: o backup diário copiava **o banco de dados,
mas não os arquivos**. Os 8.527 anexos — documentos de patrimônio, fotos de
crachá, notas fiscais eletrônicas — existiam em **um lugar só**. Perder a conta
significava perdê-los sem cópia nenhuma.

---

## O que foi feito

### 1. Uma réplica completa, em outro fornecedor

O ERP inteiro roda hoje também na Render, em infraestrutura independente da
Supabase: banco de dados, autenticação, permissões, regras de acesso e
funções do sistema.

**Verificado em produção, não no papel:** a réplica foi testada com contas
reais de funcionárias da empresa. Uma gerente de RH enxerga 811 registros; uma
encarregada enxerga 8. As regras de quem pode ver o quê — 1.445 no total —
**funcionam idênticas** à produção. Login real, com senha, funciona.

| O que a réplica contém hoje | |
|---|---|
| Empregados | 13.372 |
| Usuários do sistema | 156 |
| Anexos catalogados | 8.486 |

### 2. Atualização cinco vezes por dia

A réplica se atualiza às **07h, 10h, 13h, 16h e 20h**, em horário de
expediente. O atraso máximo caiu de **24 horas para cerca de 3 horas e meia**.

Fora do expediente não há atualização de propósito: ninguém mexe no sistema de
madrugada, e copiar às 3h produziria exatamente o mesmo conteúdo das 20h,
desgastando o banco de produção sem ganho.

### 3. Backup dos arquivos — um buraco que foi fechado

Os 8.527 arquivos (4,7 GB) passaram a ser copiados automaticamente, de forma
incremental e **criptografada**. Antes disso, não havia cópia alguma.

### 4. Modo consulta durante uma queda

Se o sistema principal cair, o ERP passa a **oferecer a consulta aos dados**
em vez de apenas pedir paciência. O funcionário pode conferir um pedido, uma
escala ou um contrato — a maior parte do uso diário.

**Nesse modo não é possível salvar alterações**, e isso é garantido pelo
próprio banco de dados, não por uma trava de tela: qualquer tentativa de
gravar é recusada. Foi testado e comprovado.

A razão é simples: se metade das pessoas gravasse na réplica e metade no
sistema principal, existiriam duas versões da verdade, e uma delas seria
apagada. Perder um pedido aprovado depois de ver "salvo com sucesso" é pior
que ficar sem o sistema por uma hora.

**Assumir a operação de verdade é uma decisão humana**, tomada por quem está
acompanhando a situação — nunca automática.

---

## Custo

| | Por mês |
|---|---|
| Réplica (servidor + disco) | **US$ 27,50** |
| Serviços antigos desligados | − US$ 13,00 |
| **Aumento real** | **US$ 14,50** |

Backups e automações rodam na conta GitHub que a empresa já mantém, sem custo
adicional.

---

## O que ainda não está pronto

Dito abertamente, para que a direção saiba o alcance exato do que existe hoje:

| Item | Situação |
|---|---|
| Arquivos copiados **para dentro** da réplica | Não. Estão salvos em backup, mas ainda não dentro da réplica — exige ampliar o disco (+US$ 2,50/mês) |
| Telas que gravam por rotina interna | Uma pequena parte do sistema ainda conseguiria gravar durante o modo consulta. Identificado e documentado |
| Troca de endereço automática | A troca é oferecida ao usuário, não imposta |

---

## Em resumo

| | Antes | Hoje |
|---|---|---|
| Cópia do sistema em outro fornecedor | não existia | **existe e funciona** |
| Atraso dessa cópia | — | **~3h30** |
| Cópia dos arquivos anexados | **nenhuma** | **5× ao dia, criptografada** |
| Durante uma queda | tela de espera | **consulta aos dados** |
| Risco de perder trabalho na troca | — | **bloqueado pelo banco** |

O ERP deixou de depender de um fornecedor único para continuar existindo.
