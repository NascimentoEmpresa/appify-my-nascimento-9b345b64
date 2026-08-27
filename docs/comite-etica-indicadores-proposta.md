# Comitê de Ética — Proposta de indicadores e campos

**Assunto:** estruturação dos indicadores do Comitê de Ética
**Situação:** implementado e disponível no ERP, aguardando validação e parametrização

---

## 1. O que foi feito

Todos os campos e todos os indicadores solicitados já estão no sistema, no módulo
**Comitê de Ética**, em duas telas:

| Tela | Para que serve |
|---|---|
| **Denúncias** | Fila de trabalho e ficha de apuração — onde cada processo é registrado |
| **Indicadores** | Painel gerencial — tendências, reincidência, prazos e efetividade |

O painel não exige nenhuma carga ou digitação paralela: ele lê o que for preenchido na
ficha de cada denúncia. Preencheu a ficha, o indicador aparece.

Vale registrar o ponto de partida honesto: **hoje não há nenhuma denúncia registrada
no canal**. A estrutura está pronta e os números começam a existir a partir do primeiro
caso apurado. Os primeiros dois ou três meses servirão para calibrar — média de tempo e
percentual de procedência só ganham significado com alguma massa de casos.

---

## 2. Campos registrados por processo

Organizados exatamente nas categorias solicitadas. A coluna da direita explica por que
cada campo existe — nenhum deles está ali só para preencher cadastro.

### Identificação
| Campo | O que habilita |
|---|---|
| Nº do processo (protocolo) | Rastreio; gerado automaticamente (`DEN-AAAA-NNNNN`) |
| Data da denúncia | Marco zero de todos os prazos |
| Origem | Canal do site, presencial, e-mail, telefone, WhatsApp, carta, gestor, outro |

### Classificação
| Campo | O que habilita |
|---|---|
| Tipo informado pelo denunciante | Registro do que a pessoa entendeu ter acontecido |
| **Tipo segundo o comitê** | É esta leitura que vale no indicador — o denunciante frequentemente enquadra errado |
| Gravidade (baixa, média, alta, crítica) | Define o prazo de SLA do caso |
| Sigilo (sigilosa ou identificada) | Controle de circulação da apuração |

Tipos disponíveis: assédio moral, assédio sexual, discriminação, **desrespeito / conduta
inadequada**, fraude/corrupção, furto/desvio, conflito de interesses, uso indevido de
recursos, vazamento de informações, SST, meio ambiente, descumprimento de norma, outro.

### Pessoas e lotação
| Campo | O que habilita |
|---|---|
| Denunciante (quando identificado) | Já vinha do formulário |
| **Denunciado** (vinculado ao cadastro do RH) | Reincidência por colaborador |
| **Líder imediato** (vinculado ao RH) | Concentração de problemas por liderança |
| Diretoria | Recorte por diretoria |
| Contrato | Risco por contrato |
| Setor | Ranking de setores |
| Unidade / filial e cidade | Recorte geográfico |

Ao vincular o denunciado ao cadastro do RH, o sistema preenche sozinho setor, contrato e
unidade a partir da folha — evita que "Limpeza" e "LIMPEZA" virem dois setores diferentes
no gráfico.

### Investigação
Responsável pela apuração · data da primeira providência · início e conclusão da apuração ·
situação do processo.

**Situação** passou a ser separada do **resultado**. Antes, "procedente" era o próprio
status, e não havia como representar um caso já julgado procedente que continuava aberto
aguardando o cumprimento da medida. Agora:

- **Situação:** recebida → em análise → aguardando documentos → em investigação → julgada → encerrada
- **Resultado:** procedente, parcialmente procedente, improcedente, arquivada

### Reincidência

Não é campo digitado: o sistema apura sozinho. Ao abrir a ficha, o comitê vê, antes do
relato, se aquele **denunciado**, **líder**, **setor** ou **contrato** já respondeu a
casos anteriores — com quantos foram e quantos deram procedentes. Conta apenas o que veio
antes daquele processo, e a contagem por pessoa exige vínculo com o cadastro do RH.

### Desfecho
| Campo | O que habilita |
|---|---|
| Resultado | % de procedência |
| Medidas (múltipla escolha) | Advertência, suspensão, demissão, treinamento, orientação, melhoria de processo, nenhuma medida |
| Causa raiz | Separar falha de processo de desvio de comportamento |
| Ações corretivas e preventivas | Encaminhamentos |
| Houve recurso · resultado · data | Acompanhamento da segunda instância |
| Prazo específico do caso | Exceção pontual à régua geral de SLA |

---

## 3. Indicadores disponíveis

Todos os solicitados, mais dois que a estrutura permitiu.

**Volume e distribuição**
1. Total de denúncias por mês (evolução com linha de tendência)
2. Denúncias por tipo
3. Denúncias por contrato
4. Denúncias por setor (+ ranking)
5. Denúncias por líder
6. Denúncias por cidade / unidade
7. Denúncias por gravidade
8. Denúncias por origem *(adicional)*

**Prazo e produtividade**
9. Tempo médio de conclusão
10. Percentual dentro do SLA
11. Tempo médio entre a denúncia e a primeira providência
12. Casos pendentes e vencidos (fila ordenada do mais atrasado)

**Desfecho**
13. Percentual de procedentes
14. Percentual de improcedentes
15. Quantidade de medidas disciplinares aplicadas
16. Quantidade de treinamentos decorrentes das denúncias
17. Principais causas raiz
18. Percentual de causas sistêmicas × comportamentais *(adicional)*

**Reincidência**
19. Reincidência por colaborador
20. Reincidência por líder
21. Reincidência por contrato
22. Índice de reincidência após a aplicação das medidas

### Como cada número é calculado

Para não haver dúvida na leitura do relatório:

- **Tempo de conclusão:** dias corridos entre a data da denúncia e o encerramento. Caso
  ainda aberto conta até hoje — processo esquecido aparece como vencido em vez de sumir
  da conta.
- **Dentro do SLA:** o caso concluído levou menos dias que o prazo da sua gravidade.
  Casos ainda abertos não entram nesta média.
- **% procedentes:** sobre os casos **com resultado lançado**, não sobre o total. Casos em
  apuração não contam como improcedentes.
- **Reincidência:** duas ou mais ocorrências para a mesma pessoa, líder ou contrato. Para
  colaborador, exige vínculo com o cadastro do RH — contar por nome digitado inflaria o
  número com grafias diferentes.
- **Reincidência após medida:** casos abertos **depois** da conclusão de um processo
  anterior que aplicou medida disciplinar. É este o número que responde se a punição
  funcionou.
- **Causa sistêmica:** falha de liderança, comunicação, treinamento, processo ou clima
  organizacional — em oposição a comportamento individual.

---

## 4. Decisões que dependem da sua validação

Estes pontos foram implementados com um valor inicial de trabalho. São ajustáveis no
sistema, sem necessidade de desenvolvimento.

### 4.1 Prazos de SLA por gravidade

| Gravidade | Conclusão | Primeira providência |
|---|---|---|
| Crítica | 10 dias | 1 dia |
| Alta | 20 dias | 2 dias |
| Média | 30 dias | 3 dias |
| Baixa | 45 dias | 5 dias |

São proposta, não regra definida. O percentual de SLA do relatório depende inteiramente
desses números — vale a validação antes do primeiro fechamento.

### 4.2 Critério de gravidade

Hoje a gravidade é atribuída pelo comitê caso a caso. Se houver preferência por um
critério objetivo (por exemplo: assédio sexual e fraude acima de determinado valor entram
automaticamente como crítica), isso pode ser parametrizado.

### 4.3 Quem acessa o quê

O painel de indicadores tem liberação de acesso **separada** da tela de denúncias. É
possível dar à diretoria a visão gerencial completa sem dar acesso ao conteúdo dos
relatos. A liberação é feita em Administração › Acesso por Usuário.

---

## 5. Limitações que vale conhecer

Ditas com clareza para não gerarem surpresa na primeira reunião de análise:

1. **Indicador é reflexo do preenchimento.** Ficha sem contrato não aparece no indicador de
   contrato. A ficha avisa quais campos estão faltando e o que cada ausência custa, mas
   não bloqueia o salvamento — apuração em andamento tem campo vazio por natureza.
2. **Reincidência de colaborador exige vínculo com o RH.** Terceirizados, fornecedores e
   ex-colaboradores não estão no cadastro da folha e ficam fora dessa contagem específica.
3. **"Os treinamentos reduziram as ocorrências?" ainda não é resposta automática.** O
   sistema mostra quantos treinamentos foram aplicados e a série mensal antes e depois;
   a leitura causal continua sendo do comitê. Com massa suficiente de casos, esse
   cruzamento pode ser automatizado.
4. **Percentuais com poucos casos enganam.** Com três denúncias, uma procedente vira "33%".
   O painel mostra o tamanho da amostra ao lado de cada percentual justamente por isso.

---

## 6. Próximos passos sugeridos

1. Validação dos prazos de SLA e do critério de gravidade.
2. Definição de quem terá acesso ao painel e quem terá acesso aos relatos.
3. Divulgação do canal — o link público de denúncia já está funcionando.
4. Primeira leitura gerencial após 60 dias de operação, para calibrar as metas.
