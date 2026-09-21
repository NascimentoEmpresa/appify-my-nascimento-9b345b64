-- =========================================================================
-- Treinamentos › Gerenciar alunos: lista paginada no servidor + resumo
--
-- "Tá demorando demais pra carregar" (Pablo, 21/09/2026). Com 13 mil alunos
-- a tela puxava TUDO em 14 requisições de 1000 linhas largas, cada linha
-- com subquery de matrícula e o gate de acesso avaliado linha a linha. Agora:
--
--   trn_alunos_gerenciar_resumo()  → uma chamada com os números do topo,
--                                    a lista de contratos (com contagem) e
--                                    as situações — o que a tela precisa
--                                    antes de listar. "Sem e-mail no
--                                    cadastro" conta SÓ quem está
--                                    Trabalhando (pedido do Pablo).
--   trn_alunos_gerenciar(...)      → página de 25/50 com busca, status,
--                                    situação e contratos filtrados no banco;
--                                    devolve o total junto (count over()).
--                                    Gate avaliado uma vez (plpgsql).
--   trn_alunos_recorte()           → id/contrato/status de todos, num jsonb
--                                    só (sem o corte de 1000 linhas) — é o
--                                    que as Ações em massa usam pra montar o
--                                    recorte por contrato/status.
--
-- Assinatura da trn_alunos_gerenciar mudou: a antiga (sem parâmetros) cai.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP FUNCTION IF EXISTS public.trn_alunos_gerenciar();

CREATE INDEX IF NOT EXISTS idx_trn_aluno_status_nome ON public."TRN_ALUNO"(status, nome);
CREATE INDEX IF NOT EXISTS idx_trn_aluno_contrato    ON public."TRN_ALUNO"(contrato);
CREATE INDEX IF NOT EXISTS idx_trn_matricula_aluno   ON public."TRN_MATRICULA"(aluno_id);

CREATE OR REPLACE FUNCTION public.trn_alunos_gerenciar_resumo()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT (public.trn_acesso('treinamentos_alunos_novo') OR public.trn_acesso('treinamentos_alunos')) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'ativos',     (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'ativo'),
    'inativos',   (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'inativo'),
    'afastados',  (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'inativo' AND situacao IS DISTINCT FROM 'Demitido'),
    'demitidos',  (SELECT count(*) FROM public."TRN_ALUNO" WHERE situacao = 'Demitido'),
    'bloqueados', (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'bloqueado'),
    -- Só quem está Trabalhando: demitido sem e-mail não é pendência de ninguém.
    'sem_email_ativos', (SELECT count(*) FROM public."TRN_ALUNO" WHERE status = 'ativo' AND email LIKE '%@colaborador.nascimento.local'),
    'ultima_sync', (SELECT max(sincronizado_em) FROM public."TRN_ALUNO"),
    'contratos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', contrato, 'n', n, 'ativos', ativos) ORDER BY contrato), '[]'::jsonb)
                    FROM (SELECT contrato, count(*) n, count(*) FILTER (WHERE status = 'ativo') ativos
                            FROM public."TRN_ALUNO" WHERE contrato IS NOT NULL GROUP BY contrato) c),
    'situacoes', (SELECT coalesce(jsonb_agg(DISTINCT situacao ORDER BY situacao), '[]'::jsonb) FROM public."TRN_ALUNO" WHERE situacao IS NOT NULL)
  );
END $fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_gerenciar_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_gerenciar_resumo() TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_alunos_gerenciar(
  _busca text DEFAULT NULL, _status text DEFAULT NULL, _situacao text DEFAULT NULL,
  _contratos text[] DEFAULT NULL, _offset int DEFAULT 0, _limite int DEFAULT 25)
RETURNS TABLE (
  id uuid, nome text, email text, documento text, status text, situacao text, contrato text, cargo text,
  empregado_id bigint, origem text, acesso_completo boolean, cursos int, ultimo_acesso_em timestamptz,
  sincronizado_em timestamptz, admissao text, afastamento text, email_sintetico boolean, total bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
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
  ), pagina AS (
    SELECT b.*, count(*) OVER () AS total
      FROM base b
     ORDER BY (b.status = 'ativo') DESC, b.nome
     OFFSET greatest(_offset, 0) LIMIT least(greatest(_limite, 1), 200)
  )
  SELECT p.id, p.nome, p.email, p.documento, p.status, p.situacao, p.contrato, p.cargo,
         p.empregado_id, p.origem, p.acesso_completo,
         coalesce(m.n, 0)::int,
         p.ultimo_acesso_em, p.sincronizado_em,
         e."Admissão", e."Data Afastamento",
         p.email LIKE '%@colaborador.nascimento.local',
         p.total
    FROM pagina p
    LEFT JOIN LATERAL (SELECT count(*) n FROM public."TRN_MATRICULA" x WHERE x.aluno_id = p.id) m ON true
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = p.empregado_id
   ORDER BY (p.status = 'ativo') DESC, p.nome;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_gerenciar(text, text, text, text[], int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_gerenciar(text, text, text, text[], int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.trn_alunos_recorte()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.trn_acesso('treinamentos_alunos', 'alterar') THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'contrato', contrato, 'status', status)), '[]'::jsonb)
            FROM public."TRN_ALUNO");
END $fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_recorte() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_recorte() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.trn_alunos_recorte(), public.trn_alunos_gerenciar_resumo(),
--   public.trn_alunos_gerenciar(text, text, text, text[], int, int);
-- e reaplicar trn_alunos_gerenciar() da 20260930000193.
