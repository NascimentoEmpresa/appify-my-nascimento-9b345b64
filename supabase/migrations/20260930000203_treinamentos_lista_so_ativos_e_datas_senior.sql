-- =========================================================================
-- Treinamentos › Alunos: lista abre só com quem não está inativo, e a
-- Admissão/Demissão do cadastro deixam de sair "Invalid Date"
--
-- Pedidos do Pablo em 22/09/2026:
--   • "tá uns 10 segundos carregando isso ... deixa só os com a situação
--     trabalhando carregando e os demitidos não precisa, só se filtrar pelos
--     cadastros inativos ou demitidos". trn_alunos_lista devolvia os 13,3 mil
--     alunos (14 páginas de 1000, 4 subconsultas por linha). Agora recebe
--     _incluir_inativos (padrão false): sem ele vêm só os não-inativos —
--     Trabalhando (~2,2 mil) + pendentes/bloqueados cadastrados à mão. A tela
--     só pede os inativos quando o filtro de status pede.
--     A assinatura muda (ganha parâmetro): a antiga sem parâmetro cai, senão
--     a chamada sem argumento ficaria ambígua.
--   • "admissão tá invalid date": EMPREGADOS."Admissão"/"Data Afastamento"
--     são texto, 10,8 mil em DD/MM/AAAA e 2,4 mil em ISO (mesma mistura do
--     "Nascimento"). trn_alunos_gerenciar devolvia o texto cru e o
--     new Date("01/02/2024") da tela dá Invalid Date. Agora devolve ISO via
--     rh_data_br_para_date() (lê os dois formatos; lixo vira NULL → "—").
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

DROP FUNCTION IF EXISTS public.trn_alunos_lista();

CREATE OR REPLACE FUNCTION public.trn_alunos_lista(_incluir_inativos boolean DEFAULT false)
RETURNS TABLE (
  id uuid, nome text, email text, telefone text, documento text, status text,
  acesso_completo boolean, expira_em date, created_at timestamptz, ultimo_acesso_em timestamptz,
  tags jsonb, tag_ids uuid[], cursos int, aulas_concluidas int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id, a.nome, a.email, a.telefone, a.documento, a.status,
         a.acesso_completo, a.expira_em, a.created_at, a.ultimo_acesso_em,
         coalesce((SELECT jsonb_agg(t.nome ORDER BY t.nome) FROM public."TRN_ALUNO_TAG" at JOIN public."TRN_TAG" t ON t.id = at.tag_id WHERE at.aluno_id = a.id), '[]'::jsonb),
         coalesce((SELECT array_agg(at.tag_id) FROM public."TRN_ALUNO_TAG" at WHERE at.aluno_id = a.id), '{}'::uuid[]),
         (SELECT count(*)::int FROM public."TRN_MATRICULA" m WHERE m.aluno_id = a.id),
         (SELECT count(*)::int FROM public."TRN_PROGRESSO" p WHERE p.aluno_id = a.id AND p.concluida)
    FROM public."TRN_ALUNO" a
   WHERE public.trn_ve_modulo()
     AND (_incluir_inativos OR a.status <> 'inativo')
   ORDER BY a.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.trn_alunos_lista(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_lista(boolean) TO authenticated;

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
         public.rh_data_br_para_date(e."Admissão")::text,
         public.rh_data_br_para_date(e."Data Afastamento")::text,
         p.email LIKE '%@colaborador.nascimento.local',
         p.total
    FROM pagina p
    LEFT JOIN LATERAL (SELECT count(*) n FROM public."TRN_MATRICULA" x WHERE x.aluno_id = p.id) m ON true
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = p.empregado_id
   ORDER BY (p.status = 'ativo') DESC, p.nome;
END $fn$;
REVOKE ALL ON FUNCTION public.trn_alunos_gerenciar(text, text, text, text[], int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trn_alunos_gerenciar(text, text, text, text[], int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.trn_alunos_lista(boolean);
-- reaplicar trn_alunos_lista() da 20260930000190 e trn_alunos_gerenciar da 20260930000195.
