---
description: Lista os chamados com plano já gerado aguardando sua revisão
---

Liste os planos de chamado que estão prontos e esperando revisão — gerados
automaticamente pelo worker (`worker/src/chamadosDev.js`) enquanto você não
estava por perto.

## O que fazer

1. Liste os arquivos `.md` em `worker/state/planos/`. Cada um é um chamado com
   plano pronto (o `.complexidade` ao lado guarda a classificação).
   Se a pasta não existir ou estiver vazia, diga que não há nada pendente e
   pare — não é erro.

2. Para cada um, monte uma linha com:
   - **número do chamado** (é o nome do arquivo);
   - **título** — a primeira linha `# ...` de dentro do plano;
   - **complexidade** — conteúdo do `.complexidade` correspondente;
   - **há quanto tempo espera** — a partir do `mtime` do arquivo (ex.
     "3 horas atrás", "ontem");
   - **se tem pergunta em aberto** — procure a seção "Perguntas em Aberto" no
     plano e sinalize se ela tem itens reais (algo além de "nenhuma pergunta
     em aberto"). Isso importa porque plano com pergunta aberta precisa de
     decisão sua antes de ir pro Codex.

3. Ordene do mais antigo pro mais recente (o que espera há mais tempo primeiro).

4. Confirme no banco o status atual de cada chamado antes de listar — um
   chamado pode ter sido concluído, reprovado ou redirecionado a outra pessoa
   depois que o plano foi gerado. Use `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
   de `worker/.env` (nunca imprima esses valores):
   ```
   curl -sS "$SUPABASE_URL/rest/v1/CHAMADO_SISTEMA?numero=eq.$NUMERO&select=numero,status,responsavel_id" \
     -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
   ```
   Se o chamado não estiver mais ativo (`concluido`/`reprovado`) ou não for
   mais seu, marque-o como **obsoleto** na lista e sugira apagar o plano —
   não o esconda silenciosamente.

5. Ao final, lembre que o próximo passo de cada um é `/codex-executar <numero>`.

## Formato

Tabela enxuta, uma linha por chamado. Se não houver nada pendente, uma frase
só — não invente seções vazias.
