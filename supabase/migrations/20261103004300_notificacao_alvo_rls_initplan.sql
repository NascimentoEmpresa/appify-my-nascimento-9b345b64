-- ============================================================================
--  SISTEMA_NOTIFICACAO_ALVO: permissão em InitPlan (03/11/2026, 19:00 UTC)
--
--  Quarta recaída do dia. Com a produção em 6.810 respostas 503 por minuto e
--  carga 20 em 2 núcleos (0% de CPU ociosa), a amostragem de pg_stat_activity
--  apontou uma consulta nova dominando: a leitura de
--  "SISTEMA_NOTIFICACAO_ALVO".
--
--  A tabela tem **86 linhas / 64 kB**. Medido na produção, como authenticated:
--
--      usuário 7615dc92:  2.451,528 ms  para devolver ZERO linhas
--      usuário 205bcc4d:    549,846 ms  para devolver 7
--
--  2,4 segundos em 86 linhas porque `pode_gerir_avisos(auth.uid(),
--  'visualizar')` estava FORA de `(SELECT ...)` e era reavaliada em cada linha
--  — ~28 ms por chamada, 86 vezes. É exatamente o caso que a 20261103002000 e a
--  20261103002200 tratam; esta tabela só não estava na lista das 32 (ela é
--  pequena, e o critério de lá foi "linhas lidas", não custo por chamada — o
--  que esconde justamente a tabela pequena com função caríssima por linha).
--
--  Os argumentos são `auth.uid()` e um literal: não dependem da linha, então o
--  embrulho é semanticamente idêntico por construção. As outras duas pernas do
--  OR (`user_id = auth.uid()` e o `setor IN (SELECT ...)`) ficam como estão —
--  a primeira é comparação de coluna e a segunda já é subconsulta.
--
--  Conferido antes de aplicar, expressão antiga x nova na mesma foto do banco:
--      7615dc92  0/0      205bcc4d  7/7
--      301bfa45  86/86    0a2fa617  7/7
--  Idêntico nos quatro, com números diferentes entre si (0, 7, 86) — ou seja o
--  predicado continua discriminando, e não que todos passaram a ver tudo.
--
--  Ganho medido no usuário que levava 2,4 s:  2.451,528 ms -> 113,614 ms (22x).
--
--  Completado na revisão da PR (03/11/2026, item 2): auth.uid() também vai
--  em (SELECT ...) nas três pernas — é o que o guardião do CI (regra M1)
--  passou a exigir. Mesmo resultado nos quatro usuários (0/7/7/86 linhas) e,
--  medido à noite sem carga, 3–27 ms -> 0,2–0,6 ms por leitura.
--
--  ALTER POLICY preserva nome, comando, papéis e PERMISSIVE, e não disputa lock
--  com a tabela em tráfego vivo.
-- ============================================================================

SET lock_timeout = '5s';

ALTER POLICY sistema_notif_alvo_ler ON public."SISTEMA_NOTIFICACAO_ALVO"
  USING (
       (SELECT public.pode_gerir_avisos((SELECT auth.uid()), 'visualizar'::app_acao))
    OR (user_id = (SELECT auth.uid()))
    OR (setor IN (SELECT u.setor FROM public.user_setor u WHERE u.user_id = (SELECT auth.uid())))
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (a expressão original, exatamente como estava):
--
-- ALTER POLICY sistema_notif_alvo_ler ON public."SISTEMA_NOTIFICACAO_ALVO"
--   USING ((pode_gerir_avisos(auth.uid(), 'visualizar'::app_acao)
--           OR (user_id = auth.uid())
--           OR (setor IN ( SELECT u.setor FROM user_setor u WHERE (u.user_id = auth.uid())))));
--
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
