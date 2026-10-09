-- =========================================================================
-- TREINAMENTOS › GERENCIAR ALUNOS — RELATÓRIO DO FILTRO (08/10/2026)
--
-- PEDIDO (Pablo): "preciso conseguir tirar um relatório do filtro aqui:
-- quando eu seleciono os contratos, por exemplo, e todos inativos ou ativos,
-- preciso tirar um relatório de todos os dados filtrados".
--
-- A lista da tela vem de trn_alunos_gerenciar, que é PAGINADA (no máximo
-- 200 por chamada) e ordena só pelo nome — buscar o filtro inteiro página a
-- página podia repetir ou pular gente com o mesmo nome na virada da página.
-- trn_alunos_gerenciar_exportar é a irmã para o relatório: os MESMOS
-- filtros (busca, status, situação, contratos), a MESMA porta de acesso
-- (trn_acesso de Gerenciar ou de Visualizar alunos), TODAS as linhas, em
-- ordem fixa (a da tela + id para desempatar). Nada muda na tela de hoje.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trn_alunos_gerenciar_exportar(
  _busca text DEFAULT NULL, _status text DEFAULT NULL, _situacao text DEFAULT NULL, _contratos text[] DEFAULT NULL)
RETURNS TABLE(id uuid, nome text, email text, documento text, status text, situacao text, contrato text, cargo text,
              empregado_id bigint, origem text, acesso_completo boolean, cursos integer, ultimo_acesso_em timestamptz,
              sincronizado_em timestamptz, admissao text, afastamento text, email_sintetico boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_busca text := nullif(btrim(coalesce(_busca, '')), '');
BEGIN
  IF NOT (public.trn_acesso('treinamentos_alunos_novo') OR public.trn_acesso('treinamentos_alunos')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT a.*
      FROM public."TRN_ALUNO" a
     WHERE (_status IS NULL OR a.status = _status)
       AND (_situacao IS NULL OR a.situacao = _situacao)
       AND (_contratos IS NULL OR array_length(_contratos, 1) IS NULL OR a.contrato = ANY(_contratos))
       AND (v_busca IS NULL
            OR a.nome ILIKE '%' || v_busca || '%'
            OR a.email ILIKE '%' || v_busca || '%'
            OR coalesce(a.documento, '') LIKE '%' || regexp_replace(v_busca, '\D', '', 'g') || '%' AND regexp_replace(v_busca, '\D', '', 'g') <> ''
            OR coalesce(a.cargo, '') ILIKE '%' || v_busca || '%'
            OR coalesce(a.contrato, '') ILIKE '%' || v_busca || '%')
  ), matriculas AS (
    SELECT x.aluno_id, count(*)::int AS n
      FROM public."TRN_MATRICULA" x
     WHERE x.aluno_id IN (SELECT b.id FROM base b)
     GROUP BY x.aluno_id
  )
  SELECT b.id, b.nome, b.email, b.documento, b.status, b.situacao, b.contrato, b.cargo,
         b.empregado_id, b.origem, b.acesso_completo,
         coalesce(m.n, 0),
         b.ultimo_acesso_em, b.sincronizado_em,
         public.rh_data_br_para_date(e."Admissão")::text,
         public.rh_data_br_para_date(e."Data Afastamento")::text,
         b.email LIKE '%@colaborador.nascimento.local'
    FROM base b
    LEFT JOIN matriculas m ON m.aluno_id = b.id
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = b.empregado_id
   ORDER BY (b.status = 'demitido'), (b.status = 'ativo') DESC, b.nome, b.id;
END $$;
REVOKE ALL ON FUNCTION public.trn_alunos_gerenciar_exportar(text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_gerenciar_exportar(text, text, text, text[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.trn_alunos_gerenciar_exportar(text, text, text, text[]);
