-- =========================================================================
-- ANIVERSARIANTES — só quem de fato usa o ERP, com nome completo e setor
--
-- Três correções na rh_aniversariantes (20260930000024), todas pedidas
-- depois de ver o cartão com dado real na tela.
--
-- 1) "SOMENTE QUEM ACESSA O SISTEMA".
--    O filtro antigo era `auth_user_id IS NOT NULL` — ou seja, "tem login
--    vinculado". Não é a mesma coisa que usar o sistema: o vínculo é criado
--    pelo RH em lote, e sobra gente de obra que nunca abriu o ERP. Foi assim
--    que um MEIO OFICIAL - PEDREIRO virou o aniversariante em destaque de uma
--    tela que é dos colegas de escritório.
--
--    O critério passa a ser auth.users.last_sign_in_at IS NOT NULL: entrou
--    pelo menos uma vez. É o único sinal no banco que separa "tem conta" de
--    "usa". Quem for vinculado hoje e logar amanhã entra sozinho na lista, sem
--    ninguém precisar manter uma lista de exceção.
--
--    Ler auth.users aqui é seguro: a função já era SECURITY DEFINER e o
--    last_sign_in_at NÃO sai no retorno — ele só filtra. A tela não fica
--    sabendo quem entrou quando.
--
-- 2) NOME COMPLETO.
--    Vinha `coalesce(display_name, "Nome")` — o display_name na frente. Mas o
--    display_name só recebe o Nome oficial NO MOMENTO do vínculo
--    (20260716000003); depois a pessoa edita o perfil e ele vira apelido.
--    Resultado na tela: "GIOVANNA NOG". Invertido: o "Nome" do cadastro
--    (Senior) manda, e o display_name só cobre quem não tem Nome preenchido.
--
-- 3) SETOR SEMPRE QUE HOUVER.
--    A coluna continua a mesma ("Setor_ERP"); o que muda é o cartão passar a
--    mostrá-la em todas as linhas, não só nas de hoje. Onde ela vier vazia é
--    lacuna de CADASTRO, não de código — some com o preenchimento em
--    RH › Colaboradores. O front cai para o cargo nesses casos.
--
-- Idempotente. Aplicar no banco do app (fwmzeaztjxrxxzxzxmgc).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.rh_aniversariantes(_dias integer DEFAULT 15)
RETURNS TABLE (
  user_id    uuid,
  nome       text,
  avatar_url text,
  cargo      text,
  setor      text,
  dia        integer,
  mes        integer,
  dias_ate   integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  WITH base AS (
    SELECT e.auth_user_id                                   AS user_id,
           -- O "Nome" do Senior na frente: e o nome completo e oficial.
           -- display_name so cobre quem nao tem Nome no cadastro.
           btrim(coalesce(nullif(btrim(e."Nome"), ''),
                          p.display_name, ''))              AS nome,
           p.avatar_url                                     AS avatar_url,
           btrim(coalesce(e."Título do Cargo", ''))         AS cargo,
           btrim(coalesce(e."Setor_ERP", ''))               AS setor,
           public.rh_data_br_para_date(e."Nascimento")      AS nasc
      FROM public."EMPREGADOS" e
      JOIN public.profiles p ON p.id = e.auth_user_id
      -- So quem ja entrou no sistema alguma vez. Ver bloco 1 do cabecalho.
      JOIN auth.users au ON au.id = e.auth_user_id
     WHERE e.auth_user_id IS NOT NULL
       AND au.last_sign_in_at IS NOT NULL
       AND coalesce(p.ativo, true)
       AND coalesce(e."Situação", '') !~* 'demitid'
       AND public.rh_data_br_para_date(e."Nascimento") IS NOT NULL
  ),
  calc AS (
    SELECT b.*,
           CASE
             WHEN public.rh_aniversario_no_ano(b.nasc, extract(year from public.rh_hoje_br())::int)
                  >= public.rh_hoje_br()
             THEN public.rh_aniversario_no_ano(b.nasc, extract(year from public.rh_hoje_br())::int)
             ELSE public.rh_aniversario_no_ano(b.nasc, extract(year from public.rh_hoje_br())::int + 1)
           END AS proximo
      FROM base b
  )
  SELECT c.user_id,
         c.nome,
         c.avatar_url,
         c.cargo,
         c.setor,
         extract(day   from c.nasc)::int,
         extract(month from c.nasc)::int,
         (c.proximo - public.rh_hoje_br())::int
    FROM calc c
   WHERE c.nome <> ''
     AND (c.proximo - public.rh_hoje_br()) <= GREATEST(coalesce(_dias, 15), 0)
   ORDER BY (c.proximo - public.rh_hoje_br()), c.nome;
$fn$;

REVOKE ALL ON FUNCTION public.rh_aniversariantes(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rh_aniversariantes(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK — volta a versao da 20260930000024 (login vinculado basta,
-- display_name na frente do Nome). Reaplique aquele arquivo, ou:
--   Trocar o JOIN auth.users + last_sign_in_at por nada, e o coalesce do
--   nome de volta para coalesce(nullif(btrim(p.display_name),''), e."Nome").
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
