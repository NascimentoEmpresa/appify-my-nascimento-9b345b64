-- =========================================================================
-- EMPREGADOS.auth_user_id apontando para login APAGADO (05/11/2026)
--
-- O merge da #1130 (Bonificação Coletiva) não aplicou nada: o aplicador parou
-- na primeira pendente, 20261104009000_organograma_dinamico_empresa_toda.sql,
-- com
--   Key (user_id)=(e0bafcb5-...) is not present in table "users"
-- no INSERT de organograma_recalcular_interno() em "ORGANOGRAMA_NO".
--
-- Causa: EMPREGADOS.auth_user_id não tem FK. Quando um login é apagado em
-- auth.users, o vínculo fica para trás apontando para o nada, e a 9000 copia
-- esse uuid para ORGANOGRAMA_NO.user_id, que TEM FK para auth.users.
--
-- A 9000 já está na main e a portaria não deixa editar migration antiga.
-- Por isso esta roda ANTES dela (versão menor, ainda pendente): solta o
-- vínculo órfão. Vínculo para login inexistente não serve para nada — a
-- pessoa não consegue entrar com ele —, e o admin vincula de novo pela tela
-- se o login for recriado.
--
-- Os valores antigos ficam em EMPREGADOS_LOGIN_ORFAO_BKP (só infraestrutura,
-- sem acesso pela API) para o ROLLBACK.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public."EMPREGADOS_LOGIN_ORFAO_BKP" (
  empregado_id  bigint      NOT NULL,
  auth_user_id  uuid        NOT NULL,
  removido_em   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."EMPREGADOS_LOGIN_ORFAO_BKP" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EMPREGADOS_LOGIN_ORFAO_BKP" FROM PUBLIC, anon, authenticated;

INSERT INTO public."EMPREGADOS_LOGIN_ORFAO_BKP" (empregado_id, auth_user_id)
SELECT e."ID"::bigint, e.auth_user_id
  FROM public."EMPREGADOS" e
 WHERE e.auth_user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.auth_user_id);

UPDATE public."EMPREGADOS" e
   SET auth_user_id = NULL
 WHERE e.auth_user_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.auth_user_id);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- UPDATE public."EMPREGADOS" e SET auth_user_id = b.auth_user_id
--   FROM public."EMPREGADOS_LOGIN_ORFAO_BKP" b WHERE b.empregado_id = e."ID"::bigint;
-- DROP TABLE IF EXISTS public."EMPREGADOS_LOGIN_ORFAO_BKP";
-- NOTIFY pgrst, 'reload schema';
