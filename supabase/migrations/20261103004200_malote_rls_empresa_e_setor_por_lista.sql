-- ============================================================================
--  Malote: empresa e setor resolvidos por LISTA no RLS (03/11/2026)
--
--  POR QUE ESTA MIGRATION EXISTE
--  Terceira recaida do dia. Depois da 20261103002000 (Fluxo de Caixa),
--  da 20261103002200 (32 tabelas) e da 20261103004100 (WhatsApp), a producao
--  voltou a ficar lenta entre 17:00 e 18:10 UTC -- CPU de usuario em 60% com
--  13,9% de ociosidade, sem failover e sem reboot.
--
--  Amostrando pg_stat_activity 20 vezes, UMA consulta aparecia em quase todas:
--  a leitura de "malote_despesa_rateio_linha" (747 chamadas em 11 min no log do
--  Kong). A tabela e pequena -- 4.598 linhas, 1.320 kB, indexada -- mas tinha
--  **71.239.173 varreduras de indice** acumuladas.
--
--  O CUSTO DEPENDE DE QUEM PERGUNTA, e e isso que escondia o problema
--  As policies de "malote_despesa" e "malote_despesa_rateio_linha" ja tinham
--  passado pelo tratamento de InitPlan: `has_role`, `can_access` e
--  `malote_gerente_financeiro` estao todas dentro de `(SELECT ...)`. O que
--  sobrou sao as duas funcoes que **recebem uma coluna**, e para essas nenhum
--  `(SELECT ...)` resolve:
--
--      user_pode_ver_empresa(auth.uid(), empresa_id)
--      malote_despesa_visivel_por_setor(auth.uid(), classificacao_id)
--
--  Quem tem `can_access('malote_pagamento','aprovar')` curto-circuita no OR
--  antes de chegar nelas e le em 40 ms. Quem NAO tem cai nas duas e paga por
--  linha. Medido na producao, mesma sessao, com ROLLBACK:
--
--      usuario      malote_despesa (antes -> depois)
--      205bcc4d       878,364 ms  ->   65,241 ms     13x
--      7615dc92     3.402,463 ms  ->   41,678 ms     81x
--
--  Ou seja: 3,4 SEGUNDOS por leitura para usuario sem privilegio de aprovacao.
--  Com 747 chamadas em 11 minutos, um endpoint sozinho consumia ~10% dos dois
--  nucleos do banco1.
--
--  A TECNICA (a mesma da 20261103004100)
--  Em vez de chamar a funcao por linha, resolve-se UMA VEZ o conjunto de
--  valores permitidos e casa-se por lista. Cardinalidade medida hoje:
--
--      empresa_id        ->  4 valores distintos em uso, 6 empresas cadastradas
--      classificacao_id  -> 97 valores distintos em uso, 190 cadastradas
--
--  As funcoes passam de 3.477 chamadas (uma por linha de malote_despesa) para
--  ~196 (uma por empresa + uma por classificacao). Ambas sao STABLE.
--
--  A ARMADILHA DO NULL -- por que ha um ramo explicito
--  `NULL IN (...)` nunca e verdadeiro, mas
--  `malote_despesa_visivel_por_setor(uid, NULL)` **nao e falso**: medido, ela
--  devolve TRUE para o usuario 7615dc92. E existem **19 linhas** com
--  classificacao_id nulo. Sem o ramo `IS NULL` escrito a mao, essas 19 sumiriam
--  da tela em silencio, so para alguns usuarios. Foi exatamente o erro que a
--  primeira versao da 20261103004100 cometeu com "WA_CONVERSA" (745 linhas no
--  lugar de 1.180) e que o teste pegou antes de aplicar.
--  `user_pode_ver_empresa(uid, NULL)` devolve FALSE para os tres usuarios
--  testados, e nao existe linha com empresa_id nulo (0 de 3.477), entao ali o
--  `IN` ja e equivalente -- mas o ramo foi escrito tambem, para nao depender
--  dessa coincidencia no futuro.
--
--  ORFAO SERIA PERDA SILENCIOSA, E FOI CONFERIDO
--  Casar por lista perde a linha cujo id nao existe na tabela de referencia.
--  Conferido antes de escrever: 0 linhas com empresa_id orfao e 0 com
--  classificacao_id orfao.
--
--  GARANTIA DE QUE NADA MUDA DE SEMANTICA
--  Expressao antiga e nova contadas lado a lado, na mesma foto do banco:
--
--      malote_despesa        205bcc4d 1880/1880  7615dc92 3382/3382
--                            301bfa45 3477/3477  b0c15700 3477/3477
--                            28843933 3382/3382  a240e3b5 1880/1880
--                            0a2fa617 1867/1867  481e4d6a 3382/3382
--
--      rateio_linha          205bcc4d 2525/2525  7615dc92 4456/4456
--                            301bfa45 4598/4598  0a2fa617 2490/2490
--                            a240e3b5 2525/2525  481e4d6a 4456/4456
--
--  Identico em todos, com numeros variados (1867, 1880, 2490, 2525, 3382,
--  3477, 4456, 4598) -- o que mostra que o predicado continua discriminando, e
--  nao que todos viram tudo.
--
--  ESCOPO: so os dois caminhos de LEITURA. As policies de insert/update/delete
--  de "malote_despesa" tambem tem `malote_supervisor_por_cargo(auth.uid())`
--  fora de `(SELECT ...)`, mas rodam sobre uma linha por vez numa escrita, onde
--  a diferenca e de microssegundos. Mexer nelas aqui seria risco sem ganho.
--
--  ALTER POLICY (e nao DROP/CREATE) preserva nome, comando, papeis e
--  PERMISSIVE, e nao disputa lock com tabela em trafego vivo.
-- ============================================================================

SET lock_timeout = '5s';

-- Conjunto de empresas que o usuario ve: 6 chamadas em vez de uma por linha.
-- Conjunto de classificacoes visiveis: 190 chamadas em vez de uma por linha.
ALTER POLICY malote_despesa_select ON public.malote_despesa
  USING (
       (created_by = auth.uid())
    OR (SELECT public.has_role(auth.uid(), 'admin'::app_role))
    OR (    empresa_id IN (SELECT e.id FROM public.empresas e
                            WHERE public.user_pode_ver_empresa(auth.uid(), e.id))
        AND (   (classificacao_id IS NULL
                 AND (SELECT public.malote_despesa_visivel_por_setor(auth.uid(), NULL)))
             OR classificacao_id IN (SELECT c.id FROM public.planejamento_orcamentario_classificacao c
                                      WHERE public.malote_despesa_visivel_por_setor(auth.uid(), c.id))))
    OR (    classificacao_id IS NULL
        AND empresa_id IN (SELECT e.id FROM public.empresas e
                            WHERE public.user_pode_ver_empresa(auth.uid(), e.id))
        AND public.malote_despesa_visivel_por_rateio(auth.uid(), id))
    OR (    (SELECT public.can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao))
        AND public.malote_despesa_escopo_cotacao(status, origem, deleted_at))
    OR (SELECT public.can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao))
    OR (    excecao AND status = 'pendente_aprovacao'::text
        AND (SELECT public.malote_gerente_financeiro(auth.uid())))
    OR (    origem = 'solicitacao'::text
        AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c
                     WHERE c.id = malote_despesa.classificacao_id
                       AND auth.uid() = ANY (c.lancador_despesa_user_ids)))
  );

-- A policy do rateio delega no EXISTS contra malote_despesa, entao carregava as
-- MESMAS duas funcoes por linha -- e ainda uma terceira vez, sobre
-- r.classificacao_id no ramo de classificacao nula.
ALTER POLICY malote_rateio_linha_all ON public.malote_despesa_rateio_linha
  USING (
    EXISTS (
      SELECT 1 FROM public.malote_despesa d
       WHERE d.id = malote_despesa_rateio_linha.despesa_id
         AND (
              (d.created_by = auth.uid())
           OR (SELECT public.has_role(auth.uid(), 'admin'::app_role))
           OR (    d.empresa_id IN (SELECT e.id FROM public.empresas e
                                     WHERE public.user_pode_ver_empresa(auth.uid(), e.id))
               AND (   (d.classificacao_id IS NULL
                        AND (SELECT public.malote_despesa_visivel_por_setor(auth.uid(), NULL)))
                    OR d.classificacao_id IN (SELECT c.id FROM public.planejamento_orcamentario_classificacao c
                                               WHERE public.malote_despesa_visivel_por_setor(auth.uid(), c.id))))
           OR (    d.classificacao_id IS NULL
               AND d.empresa_id IN (SELECT e.id FROM public.empresas e
                                     WHERE public.user_pode_ver_empresa(auth.uid(), e.id))
               AND (   (malote_despesa_rateio_linha.classificacao_id IS NULL
                        AND (SELECT public.malote_despesa_visivel_por_setor(auth.uid(), NULL)))
                    OR malote_despesa_rateio_linha.classificacao_id IN
                         (SELECT c.id FROM public.planejamento_orcamentario_classificacao c
                           WHERE public.malote_despesa_visivel_por_setor(auth.uid(), c.id))))
           OR (SELECT public.can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao))
           OR (    (SELECT public.can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao))
               AND public.malote_despesa_escopo_cotacao(d.status, d.origem, d.deleted_at))
           OR (    d.excecao AND d.status = 'pendente_aprovacao'::text
               AND (SELECT public.malote_gerente_financeiro(auth.uid())))
           OR (    d.origem = 'solicitacao'::text
               AND (d.nivel_aprovacao_atual IS NULL OR d.status = 'necessidade_de_ajuste'::text)
               AND EXISTS (SELECT 1 FROM public.planejamento_orcamentario_classificacao c
                            WHERE c.id = d.classificacao_id
                              AND auth.uid() = ANY (c.lancador_despesa_user_ids)))
         )
    )
  );

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (as expressoes originais, exatamente como estavam):
--
-- ALTER POLICY malote_despesa_select ON public.malote_despesa
--   USING (((created_by = auth.uid()) OR ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) OR (user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_setor(auth.uid(), classificacao_id)) OR ((classificacao_id IS NULL) AND user_pode_ver_empresa(auth.uid(), empresa_id) AND malote_despesa_visivel_por_rateio(auth.uid(), id)) OR (( SELECT can_access(auth.uid(), 'sup_cotacoes_malote'::text, 'visualizar'::app_acao) AS can_access) AND malote_despesa_escopo_cotacao(status, origem, deleted_at)) OR ( SELECT can_access(auth.uid(), 'malote_pagamento'::text, 'aprovar'::app_acao) AS can_access) OR (excecao AND (status = 'pendente_aprovacao'::text) AND ( SELECT malote_gerente_financeiro(auth.uid()) AS malote_gerente_financeiro)) OR ((origem = 'solicitacao'::text) AND (EXISTS ( SELECT 1 FROM planejamento_orcamentario_classificacao c WHERE ((c.id = malote_despesa.classificacao_id) AND (auth.uid() = ANY (c.lancador_despesa_user_ids))))))));
--
-- (para malote_rateio_linha_all, o USING original esta no historico desta
--  migration no git; era o mesmo EXISTS com as duas funcoes recebendo coluna.)
--
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
