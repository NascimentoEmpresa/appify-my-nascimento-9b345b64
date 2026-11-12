-- =========================================================================
-- FORMULÁRIOS — SETOR COMPARADO SEM ACENTO (JURIDICO == JURÍDICO)
--
-- O INCIDENTE (12/11/2026, FEEDBACK GUIADO | LIDERANÇA)
--   "As respostas do jurídico só aparecem pra quem tiver permissão pra ver
--   TUDO." Quem tinha a leitura "Por setor" com JURIDICO não via as respostas
--   carimbadas como JURÍDICO. O setor carimbado em CS_FORM_RESPOSTAS.setor
--   vem do Setor_ERP de quem respondeu, e o cadastro tem as DUAS grafias
--   (JURIDICO/JURÍDICO, LICITACAO/LICITAÇÃO) — o filtro da tela de Respostas
--   listava as duas como setores diferentes.
--
--   O catálogo (cs_form_setores_catalogo, 20260801000005) já deduplicava sem
--   acento, mas TODAS as comparações de leitura eram `upper(btrim(a)) =
--   upper(btrim(b))` — o chip "JURIDICO" casava só com a metade das respostas
--   que estava sem acento. O mesmo valia para o setor-dono do formulário
--   (criar_setor) e para a liderança de setor (CS_LIDERES_SETOR /
--   RH_SETOR_DIRETOR).
--
-- A CORREÇÃO
--   Uma régua só, `cs_form_chave_setor(text)`: sem acento, maiúscula, espaços
--   colapsados. As quatro funções que comparam setor passam a usá-la. As
--   policies não mudam — elas chamam as funções. Nenhum dado é reescrito: a
--   grafia gravada continua a que veio da Senior, quem passa a ignorar o
--   acento é a comparação.
--
--   O catálogo passa a preferir a grafia ACENTUADA (é a que a tela mostra) e
--   também atende quem gerencia o acesso de algum formulário — o modal
--   "Acesso" do formulário usa a mesma RPC, e um Dono de formulário sem
--   administracao:alterar via "Carregando setores…" para sempre. A RPC só
--   devolve NOMES de setor, nada de resposta.
--
-- Idempotente (só CREATE OR REPLACE FUNCTION).
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) A régua ───────────────────────────────────────────────────────────
-- IMMUTABLE: só depende do argumento (translate/upper/regexp_replace, todos de
-- pg_catalog). Sem SET search_path DE PROPÓSITO: com ele o Postgres não faz
-- inline da função, e ela roda uma vez por linha dentro da RLS.
CREATE OR REPLACE FUNCTION public.cs_form_chave_setor(_s text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(upper(regexp_replace(translate(btrim(coalesce(_s, '')),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '\s+', ' ', 'g')), '');
$$;
GRANT EXECUTE ON FUNCTION public.cs_form_chave_setor(text) TO authenticated;

-- ── 2) ver_setor geral (era 20260715000003) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_cap_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."CS_FORM_ACESSOS" a
     WHERE a.papel = 'ver_setor'
       AND a.user_id = auth.uid()
       AND public.cs_form_chave_setor(a.setor) = public.cs_form_chave_setor(_setor));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_setor(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_setor(text) TO authenticated;

-- ── 3) ver_setor por formulário (era 20260921000002) ─────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_cap_setor_em(_form uuid, _setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN public.cs_form_regra_propria(_form) THEN _setor IS NOT NULL AND EXISTS (
      SELECT 1 FROM public."CS_FORM_ACESSOS" a
       WHERE a.user_id = auth.uid() AND a.formulario_id = _form AND a.papel = 'ver_setor'
         AND public.cs_form_chave_setor(a.setor) = public.cs_form_chave_setor(_setor))
    ELSE public.cs_form_cap_setor(_setor)
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_setor_em(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_setor_em(uuid, text) TO authenticated;

-- ── 4) setor-dono do formulário, criar_setor (era 20260731000001) ────────
CREATE OR REPLACE FUNCTION public.cs_form_cap_form_setor(_form_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
      JOIN public."CS_FORM_ACESSOS" a
        ON a.papel = 'criar_setor' AND a.user_id = auth.uid()
       AND public.cs_form_chave_setor(a.setor) = public.cs_form_chave_setor(f.setor)
     WHERE f.id = _form_id AND f.setor IS NOT NULL);
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_cap_form_setor(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_cap_form_setor(uuid) TO authenticated;

-- ── 5) liderança de setor (era 20260816000002) ───────────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_lidera_setor(_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _setor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public."EMPREGADOS" e
     WHERE e.auth_user_id = auth.uid()
       AND (
         EXISTS (SELECT 1 FROM public."CS_LIDERES_SETOR" l
                  WHERE l.empregado_id = e."ID"
                    AND public.cs_form_chave_setor(l.setor) = public.cs_form_chave_setor(_setor))
      OR EXISTS (SELECT 1 FROM public."RH_SETOR_DIRETOR" d
                  WHERE d.diretor_id = e."ID"
                    AND public.cs_form_chave_setor(d.setor) = public.cs_form_chave_setor(_setor))
       ));
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_lidera_setor(text) TO authenticated;

-- ── 6) catálogo de setores (era 20260809000016) ──────────────────────────
-- Uma linha por CHAVE; entre as grafias, a acentuada primeiro (a comparação
-- já não depende da grafia, então escolhe-se a que se lê melhor).
CREATE OR REPLACE FUNCTION public.cs_form_setores_catalogo()
RETURNS TABLE(setor text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH fonte AS (
    SELECT setor        AS s, 0 AS ordem FROM public."CS_FORM_RESPOSTAS"
    UNION ALL
    SELECT "Setor_ERP" AS s, 1 AS ordem FROM public."EMPREGADOS"
  ),
  norm AS (
    SELECT upper(regexp_replace(btrim(s), '\s+', ' ', 'g')) AS rotulo, ordem,
           public.cs_form_chave_setor(s) AS chave
      FROM fonte
     WHERE btrim(coalesce(s, '')) <> ''
  )
  SELECT DISTINCT ON (chave) rotulo
    FROM norm
   WHERE chave <> 'PADRAO'                                          -- placeholder de "sem setor"
     AND (public.can_access(auth.uid(), 'administracao', 'alterar') -- Acesso por Usuário
          OR public.cs_form_cap('ver_tudo')
          OR public.cs_form_cap('editar_criar')
          OR public.cs_form_cap('encerrar_excluir')
          OR EXISTS (SELECT 1 FROM public."CS_FORM_ACESSOS" a         -- botão Acesso do formulário
                      WHERE a.user_id = auth.uid()
                        AND a.papel IN ('form_dono','form_gerenciar')))
   ORDER BY chave, (rotulo = chave), ordem, rotulo;                 -- false (acentuada) primeiro
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_setores_catalogo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_setores_catalogo() TO authenticated;

-- ── 7) Conferência: setores com mais de uma grafia nas respostas ─────────
SELECT public.cs_form_chave_setor(setor) AS chave,
       string_agg(DISTINCT btrim(setor), ' | ') AS grafias,
       count(*) AS respostas
  FROM public."CS_FORM_RESPOSTAS"
 WHERE btrim(coalesce(setor, '')) <> ''
 GROUP BY 1
HAVING count(DISTINCT btrim(setor)) > 1;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   Recriar as cinco funções com a comparação `upper(btrim(a)) = upper(btrim(b))`
--   a partir dos arquivos citados em cada bloco (20260715000003,
--   20260921000002, 20260731000001, 20260816000002, 20260809000016) e:
--   DROP FUNCTION IF EXISTS public.cs_form_chave_setor(text);
-- =========================================================================
