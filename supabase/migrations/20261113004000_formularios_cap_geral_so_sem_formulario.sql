-- =========================================================================
-- FORMULÁRIOS — CAPACIDADE GERAL É SÓ A LINHA SEM FORMULÁRIO
--
-- O FURO (achado em 12/11/2026, ao corrigir o setor sem acento)
--   `cs_form_cap(_cap)` (20260801000004) pergunta "existe linha com este
--   papel para mim?" sem olhar `formulario_id`. Desde 20260921000002 existem
--   linhas de LEITURA POR FORMULÁRIO (ver_tudo/ver_proprias/ver_setor com
--   formulario_id preenchido), e elas passaram a contar como capacidade
--   GERAL: "Todas as respostas" dado no botão Acesso de UM formulário abria,
--   no banco, as respostas de TODOS os formulários sem regra própria. O mesmo
--   em `cs_form_cap_setor` para ver_setor. A tela (useFormPerms) separa os
--   dois mundos e não mostrava nada disso — só a RLS deixava passar.
--
-- POR QUE NÃO BASTA FILTRAR
--   20261030001000 (Pesquisa de Permanência) deu `ver_tudo` SÓ no formulário
--   6990cfd5… SEM o marcador `ver_regra_form`. Sem marcador,
--   `cs_form_cap_ver` caía na capacidade geral — e era o próprio furo que
--   fazia essas pessoas lerem a Permanência. Fechar o furo sozinho tiraria
--   delas justamente o formulário que receberam.
--
--   Então a regra própria passa a ligar com o marcador OU com qualquer linha
--   de leitura do formulário — que é exatamente o que a tela já considera
--   (useFormPerms e ModulosMenusTab montam a regra com as duas). Marcador
--   continua sendo o jeito de dizer "regra própria sem nada marcado".
--
-- O QUE MUDA PARA AS PESSOAS
--   Quem tinha leitura só por formulário perde a leitura dos OUTROS
--   formulários que vinha pelo furo. É a regra decidida em 20260921000002
--   ("a regra do formulário SUBSTITUI a geral, não soma") valendo de fato.
--   A conferência no fim lista quantas pessoas estão nessa situação.
--
-- Idempotente (só CREATE OR REPLACE FUNCTION).
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 0) Conferência ANTES: quem lia pelo furo ─────────────────────────────
-- Tem leitura por formulário e NÃO tem a mesma capacidade geral.
SELECT a.papel, count(DISTINCT a.user_id) AS pessoas_que_perdem_a_leitura_geral
  FROM public."CS_FORM_ACESSOS" a
 WHERE a.formulario_id IS NOT NULL
   AND a.papel IN ('ver_tudo','ver_proprias','ver_setor')
   AND NOT EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" g
                    WHERE g.user_id = a.user_id AND g.papel = a.papel AND g.formulario_id IS NULL)
 GROUP BY a.papel;

-- ── 1) Capacidade geral: só a linha sem formulário ───────────────────────
-- Os papéis da lista (form_dono…) e os de leitura podem ter formulário; todos
-- os outros são proibidos de ter pela constraint cs_form_acessos_form_por_papel,
-- então o filtro só muda o resultado para os de leitura.
CREATE OR REPLACE FUNCTION public.cs_form_cap(_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _cap = 'responder'
      OR EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a
                  WHERE a.papel = _cap AND a.user_id = auth.uid()
                    AND a.formulario_id IS NULL);
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap(text) TO authenticated;

-- ── 2) ver_setor geral: idem (era 20261113003000) ────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_cap_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."CS_FORM_ACESSOS" a
     WHERE a.papel = 'ver_setor'
       AND a.user_id = auth.uid()
       AND a.formulario_id IS NULL
       AND public.cs_form_chave_setor(a.setor) = public.cs_form_chave_setor(_setor));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_setor(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_setor(text) TO authenticated;

-- ── 3) Regra própria: marcador OU qualquer leitura do formulário ─────────
-- (era 20260921000002). Ver "POR QUE NÃO BASTA FILTRAR" no cabeçalho.
CREATE OR REPLACE FUNCTION public.cs_form_regra_propria(_form uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _form IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."CS_FORM_ACESSOS" a
     WHERE a.user_id = auth.uid()
       AND a.formulario_id = _form
       AND a.papel IN ('ver_regra_form','ver_tudo','ver_proprias','ver_setor'));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_regra_propria(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_regra_propria(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK (reabre o furo — só para voltar atrás em emergência)
--   CREATE OR REPLACE FUNCTION public.cs_form_cap(_cap text) ... sem
--     `AND a.formulario_id IS NULL` (como em 20260801000004);
--   CREATE OR REPLACE FUNCTION public.cs_form_cap_setor(_setor text) ... sem
--     `AND a.formulario_id IS NULL` (como em 20261113003000);
--   CREATE OR REPLACE FUNCTION public.cs_form_regra_propria(_form uuid) ...
--     só com `a.papel = 'ver_regra_form'` (como em 20260921000002).
-- =========================================================================
