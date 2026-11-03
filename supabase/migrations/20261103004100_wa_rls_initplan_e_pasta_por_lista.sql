-- ============================================================================
-- WhatsApp: permissão em InitPlan e pasta por lista (03/11/2026)
--
-- POR QUE ESTA MIGRATION EXISTE
-- Hoje às 13:38 UTC a produção saiu do ar por ~45 min. A causa, apurada nos
-- logs do Kong e confirmada no código: a tela WhatsApp Inbox
-- (src/pages/whatsapp/WhatsAppInbox.tsx) tem refetchInterval de 8 s e relê a
-- lista inteira de conversas a cada ciclo. UMA aba aberta gerava 232
-- requisições por minuto. O banco1 tem 2 núcleos; a CPU de usuário foi de
-- 19,88% para 72,68% e tudo passou a estourar statement_timeout.
--
-- A tela foi corrigida em separado (1 requisição no lugar de 31), mas a
-- consulta em si também estava cara, e por um motivo que vale consertar:
--
--   EXPLAIN ANALYZE de SELECT * FROM "WA_CONVERSA" como authenticated:
--     Seq Scan ... Filter: (tem_acesso_menu('whatsapp') AND
--                           wa_pode_ver_pasta(pasta_codigo))
--     Execution Time: 923,882 ms   <- para 1.180 linhas (0,78 ms por linha)
--
-- São duas causas somadas, e a segunda é a que a 20261103002200 não alcança:
--
--   1. `tem_acesso_menu('whatsapp')` não depende da linha, mas sem
--      `(SELECT ...)` em volta é reavaliada em todas. É exatamente o caso
--      tratado na 20261103002000 e na 20261103002200 — "WA_CONVERSA" e
--      "WA_CONTATO" ficaram de fora daquelas duas listas.
--
--   2. `wa_pode_ver_pasta(pasta_codigo)` RECEBE UMA COLUNA, então nenhum
--      `(SELECT ...)` resolve: ela roda 1.180 vezes. Só que existem **7
--      pastas** em "WA_PASTA" e 5 valores distintos em uso. Perguntar "quais
--      pastas eu posso ver" uma vez e depois casar por lista faz a função
--      rodar 7 vezes em vez de 1.180, e ainda deixa o planejador usar o
--      índice idx_wa_conversa_ultima no lugar de Seq Scan + Sort.
--
-- MEDIDO NA PRÓPRIA PRODUÇÃO, mesma sessão, REPEATABLE READ e ROLLBACK:
--     antes:  923,882 ms  (Seq Scan + Sort)
--     depois:  21,285 ms  (Index Scan + InitPlan + SubPlan hasheado)
--   = 44x, com o MESMO resultado.
--
-- A ARMADILHA DO NULL -- por que o predicado não é só um IN
-- A primeira versão desta mudança usava apenas
--   `pasta_codigo IN (SELECT codigo FROM "WA_PASTA" WHERE wa_pode_ver_pasta(codigo))`
-- e devolvia 745 linhas no lugar de 1.180. Faltavam exatamente as **435
-- conversas com pasta_codigo NULL** (conversa que ainda não foi triada para
-- nenhuma pasta): `NULL IN (...)` nunca é verdadeiro. E `wa_pode_ver_pasta(NULL)`
-- NÃO é falso — o corpo dela é
--   `tem_acesso_menu('whatsapp_todas') OR EXISTS (... p.codigo = _pasta ...)`,
-- e com _pasta NULL o EXISTS é sempre falso, sobrando `tem_acesso_menu('whatsapp_todas')`.
-- Ou seja: conversa sem pasta é visível para quem tem 'whatsapp_todas'. Esse
-- ramo tem que estar escrito, senão 435 conversas somem da tela em silêncio,
-- sem erro nenhum, e só para alguns usuários.
--
-- GARANTIA DE QUE NADA MUDA DE SEMÂNTICA
-- Antes de escrever esta migration, a expressão antiga e a nova foram contadas
-- lado a lado na mesma foto do banco, para 8 usuários diferentes do módulo:
--   205bcc4d ->   38 /   38      7615dc92 ->    0 /    0   (sem acesso)
--   b0c15700 -> 1180 / 1180      28843933 ->    0 /    0   (sem acesso)
--   301bfa45 -> 1180 / 1180      481e4d6a -> 1180 / 1180
--   0a2fa617 -> 1180 / 1180      a240e3b5 -> 1180 / 1180
-- Idêntico nos oito, incluindo o usuário restrito a uma pasta e os dois sem
-- acesso nenhum. ALTER POLICY (e não DROP/CREATE) preserva nome, comando,
-- papéis e PERMISSIVE, e não disputa lock com a tabela em tráfego vivo.
-- ============================================================================

SET lock_timeout = '5s';

-- "WA_CONTATO": só o embrulho da permissão; não há função por linha aqui.
ALTER POLICY wa_contato_rw ON public."WA_CONTATO"
  USING ((SELECT public.tem_acesso_menu('whatsapp'::text)))
  WITH CHECK ((SELECT public.tem_acesso_menu('whatsapp'::text)));

-- "WA_CONVERSA": embrulho da permissão + pasta resolvida por lista.
ALTER POLICY wa_conversa_rw ON public."WA_CONVERSA"
  USING (
    (SELECT public.tem_acesso_menu('whatsapp'::text))
    AND (
         (pasta_codigo IS NULL AND (SELECT public.wa_pode_ver_pasta(NULL::text)))
      OR pasta_codigo IN (SELECT p.codigo
                            FROM public."WA_PASTA" p
                           WHERE public.wa_pode_ver_pasta(p.codigo))
    )
  )
  WITH CHECK (
    (SELECT public.tem_acesso_menu('whatsapp'::text))
    AND (
         (pasta_codigo IS NULL AND (SELECT public.wa_pode_ver_pasta(NULL::text)))
      OR pasta_codigo IN (SELECT p.codigo
                            FROM public."WA_PASTA" p
                           WHERE public.wa_pode_ver_pasta(p.codigo))
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (as expressões originais, exatamente como estavam):
--
-- ALTER POLICY wa_contato_rw ON public."WA_CONTATO"
--   USING (tem_acesso_menu('whatsapp'::text))
--   WITH CHECK (tem_acesso_menu('whatsapp'::text));
--
-- ALTER POLICY wa_conversa_rw ON public."WA_CONVERSA"
--   USING (tem_acesso_menu('whatsapp'::text) AND wa_pode_ver_pasta(pasta_codigo))
--   WITH CHECK (tem_acesso_menu('whatsapp'::text) AND wa_pode_ver_pasta(pasta_codigo));
--
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
