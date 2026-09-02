-- =====================================================================
-- REEMBOLSO — o setor passa a vir SÓ do cadastro de usuário.
--
-- Defeito visto em produção em 02/09/2026: a Natália, gerente do Jurídico,
-- tem `Juridico` marcado como setor que ela aprova, e mesmo assim os
-- reembolsos do Gustavo (Jurídico) não apareciam para ela.
--
-- Não era permissão. Era o CARIMBO. `cs_reembolso_meu_setor()` lia primeiro
-- `EMPREGADOS."Setor_ERP"`, que é espelho da Senior — e lá o Gustavo está
-- como `PADRAO`, o valor genérico que 547 das 630 pessoas carregam. As seis
-- solicitações dele nasceram com setor `PADRAO`, e ninguém aprova `PADRAO`
-- porque esse setor não existe no ERP. A solicitação ficava órfã: visível
-- para quem pediu, invisível para quem decide.
--
-- O MESMO desencontro estragava a lista de setores da tela de Acesso por
-- Usuário. `cs_reembolso_setores()` fazia UNION do catálogo do ERP com o que
-- existe em EMPREGADOS, e o dedupe por normalização não dava conta:
--
--   "Licitações"            → LICITACOES   ┐ plural x singular:
--   "LICITACAO"             → LICITACAO    ┘ passam como setores diferentes
--   "Diretor Adm"           → DIRETOR ADM  ┐ nomes de verdade diferentes:
--   "DIRETOR ADMINISTRATIVO"→ DIRETOR ...  ┘ idem
--
-- Daí a lista com `LICITACAO` e `Licitações` juntos, mais `PADRAO`,
-- `COMPRAS`, `PRESIDÊNCIA` e `SEGURANCA`, que não são setores do ERP.
--
-- A CORREÇÃO, pedida assim: "tem que puxar apenas os setores dos usuarios,
-- não precisa ser da tabela empregados". As duas funções passam a ler só o
-- que o ERP administra:
--
--   • a lista de opções sai de `setor_catalogo` (13 setores curados, os
--     mesmos que Administração › Setores mantém);
--   • o setor de quem pede sai de `user_setor`, que já usa exatamente esses
--     13 valores — conferido: nenhuma linha de `user_setor` está fora do
--     catálogo.
--
-- EMPREGADOS continua sendo a fonte de tudo mais (nome, cargo, admissão).
-- Só deixa de opinar sobre setor, porque para isso ela nunca serviu: o
-- Senior guarda o setor da FOLHA, não o do organograma do ERP.
-- =====================================================================

-- 1) A lista de opções: só o catálogo do ERP -----------------------------
CREATE OR REPLACE FUNCTION public.cs_reembolso_setores()
RETURNS TABLE(setor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT nome FROM public.setor_catalogo
   WHERE public.cs_reembolso_norm_setor(nome) IS NOT NULL
   ORDER BY nome;
$function$;

-- 2) O setor de quem pede: só o cadastro de usuário ----------------------
CREATE OR REPLACE FUNCTION public.cs_reembolso_meu_setor()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s text; n int;
BEGIN
  -- `user_setor` é o setor que o ERP administra (Acesso por Usuário), e é o
  -- que a tela mostra para a pessoa. EMPREGADOS saiu daqui em 02/09/2026:
  -- ver o cabeçalho desta migration.
  SELECT count(*) INTO n FROM public.user_setor WHERE user_id = auth.uid();

  -- Com mais de um setor marcado não há como escolher sem chutar. Devolver
  -- NULL faz a tela pedir que a pessoa acerte o cadastro, em vez de mandar a
  -- solicitação para o aprovador errado — que é o defeito que esta migration
  -- corrige, e seria burrice reintroduzi-lo por outro caminho.
  IF n <> 1 THEN RETURN NULL; END IF;

  SELECT setor INTO s FROM public.user_setor WHERE user_id = auth.uid();
  RETURN s;
END $function$;

-- 3) Tira do cadastro de aprovadores o que veio da lista suja ------------
-- Seis linhas, todas de um usuário só. Nenhuma perde alcance de verdade:
--   LICITACAO              → ele já tem "Licitações"
--   DIRETOR ADMINISTRATIVO → ele já tem "Diretor Adm"
--   PADRAO, COMPRAS, PRESIDÊNCIA, SEGURANCA → não existem no ERP, então
--   nenhuma solicitação poderia nascer com eles a partir de agora.
DELETE FROM public."CS_REEMBOLSO_APROVADOR_SETOR" a
 WHERE NOT EXISTS (
   SELECT 1 FROM public.setor_catalogo c
    WHERE public.cs_reembolso_norm_setor(c.nome)
          IS NOT DISTINCT FROM public.cs_reembolso_norm_setor(a.setor)
 );

-- 4) Reendereça as solicitações que nasceram órfãs -----------------------
-- As seis do Gustavo, carimbadas `PADRAO`. Só as PENDENTES: o que já foi
-- decidido fica com o setor de quando foi decidido, senão o histórico passa
-- a contar uma coisa que não aconteceu.
--
-- O guard sai do caminho porque ele proíbe justamente isto ("Solicitante e
-- setor não mudam depois de criada") e, numa migration, `auth.uid()` é NULL
-- — nem o atalho do aprovador o desarmaria. DISABLE/ENABLE em vez de
-- DROP/CREATE para que uma falha no meio não deixe a tabela desprotegida.
ALTER TABLE public."CS_REEMBOLSO" DISABLE TRIGGER cs_reembolso_guard_trg;

UPDATE public."CS_REEMBOLSO" r
   SET setor = us.setor
  FROM public.user_setor us
 WHERE us.user_id = r.solicitante_id
   AND r.status = 'pendente'
   AND NOT EXISTS (
     SELECT 1 FROM public.setor_catalogo c
      WHERE public.cs_reembolso_norm_setor(c.nome)
            IS NOT DISTINCT FROM public.cs_reembolso_norm_setor(r.setor)
   )
   -- Só quem tem UM setor: com dois, o carimbo certo é indefinido e a
   -- solicitação precisa de gente decidindo, não de migration adivinhando.
   AND (SELECT count(*) FROM public.user_setor u2 WHERE u2.user_id = r.solicitante_id) = 1;

ALTER TABLE public."CS_REEMBOLSO" ENABLE TRIGGER cs_reembolso_guard_trg;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- -- O setor das solicitações reendereçadas não volta: não há registro do
-- -- valor antigo. Era 'PADRAO' em todas as seis (02/09/2026).
-- -- UPDATE precisa do mesmo DISABLE/ENABLE do bloco 4.
--
-- CREATE OR REPLACE FUNCTION public.cs_reembolso_setores()
-- RETURNS TABLE(setor text)
-- LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
-- AS $f$
--   SELECT DISTINCT ON (public.cs_reembolso_norm_setor(s)) s
--     FROM (SELECT nome AS s FROM public.setor_catalogo
--           UNION
--           SELECT DISTINCT "Setor_ERP" FROM public."EMPREGADOS" WHERE "Setor_ERP" IS NOT NULL) t
--    WHERE public.cs_reembolso_norm_setor(s) IS NOT NULL
--    ORDER BY public.cs_reembolso_norm_setor(s), s;
-- $f$;
--
-- CREATE OR REPLACE FUNCTION public.cs_reembolso_meu_setor()
-- RETURNS text
-- LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
-- AS $f$
-- DECLARE s text; n int;
-- BEGIN
--   SELECT e."Setor_ERP" INTO s FROM public."EMPREGADOS" e
--    WHERE e.auth_user_id = auth.uid() LIMIT 1;
--   IF public.cs_reembolso_norm_setor(s) IS NOT NULL THEN RETURN s; END IF;
--   SELECT count(*) INTO n FROM public.user_setor WHERE user_id = auth.uid();
--   IF n = 1 THEN
--     SELECT setor INTO s FROM public.user_setor WHERE user_id = auth.uid();
--     RETURN s;
--   END IF;
--   RETURN NULL;
-- END $f$;
-- NOTIFY pgrst, 'reload schema';
