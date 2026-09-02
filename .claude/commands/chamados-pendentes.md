---
description: Lista seus chamados em andamento, marcando quais já têm plano gerado
---

Liste **todos os chamados de desenvolvimento que estão abertos na sua mão** —
não só os que já têm plano gerado pelo worker. O banco é a fonte da verdade:
chamado concluído, reprovado ou passado pra outra pessoa **não aparece** nessa
lista.

## O que fazer

1. Descubra quem é "você": leia `CHAMADOS_DEV_USER_ID` do `worker/.env`
   (é o `responsavel_id` usado nos chamados). Nunca imprima os valores do
   `.env` — nem a URL, nem a chave, nem o id.

2. Busque no banco os chamados ativos sob sua responsabilidade. Ativo =
   status `em_andamento` ou `aguardando_retorno` (os outros três valores
   possíveis são `aberto` — ainda sem responsável —, `concluido` e
   `reprovado`, e nenhum entra na lista):

   ```
   curl -sS "$SUPABASE_URL/rest/v1/CHAMADO_SISTEMA?responsavel_id=eq.$MEU_ID&status=in.(em_andamento,aguardando_retorno)&select=numero,assunto,status,prioridade,urgencia,solicitante_nome,modulo_sistema,created_at&order=created_at.asc" \
     -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
   ```

   Se a resposta vier vazia, diga que não há chamado em andamento com você e
   pare — não é erro, e não invente seções vazias.

   Também vale uma segunda consulta por chamados `aberto` **sem responsável**
   no setor SISTEMAS: eles não são seus ainda, mas é útil citá-los em uma
   linha solta no final ("X chamados abertos ainda sem responsável"), sem
   entrar na tabela.

3. Para cada chamado ativo, veja se já existe plano em
   `worker/state/planos/<numero>.md` (o `.complexidade` ao lado guarda a
   classificação). Isso define a coluna **Plano** e o próximo passo:
   - **plano pronto** → complexidade + há quanto tempo espera (`mtime` do
     arquivo, ex. "3 horas atrás", "ontem") + se a seção "Perguntas em
     Aberto" tem itens reais (algo além de "nenhuma pergunta em aberto").
     Plano com pergunta aberta precisa de decisão sua antes de ir pro Codex.
   - **sem plano** → o próximo passo é gerar o plano, não executar.

4. Faça o caminho inverso também: se houver `.md` em `worker/state/planos/`
   cujo chamado **não** apareceu na consulta do passo 2, ele está **obsoleto**
   (foi concluído, reprovado ou redirecionado depois de o plano ser gerado).
   Liste esses separadamente, com o status real, e sugira apagar o arquivo —
   não os esconda silenciosamente.

5. Ordene do mais antigo pro mais recente (`created_at` do chamado), pra quem
   espera há mais tempo aparecer primeiro.

## Formato

Tabela enxuta, uma linha por chamado, com: número, assunto, prioridade/prazo,
status, e a coluna **Plano** (`—` quando não tem, ou complexidade + idade +
aviso de pergunta aberta).

Depois da tabela, o próximo passo de cada um em uma linha:
`/chamado <numero>` pros que ainda não têm plano, `/codex-executar <numero>`
pros que já têm plano aprovado.
