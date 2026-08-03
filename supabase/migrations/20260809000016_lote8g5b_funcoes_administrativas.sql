-- Lote 8g, bloco 5b: funções administrativas com has_role(admin) direto,
-- todas ligadas a telas de /app/administracao já migradas (Lote 8a/8b) —
-- reaproveita o mesmo menu 'administracao', com a mesma ação que a tela que
-- as chama já usa (conferido em cada tab: LogsTab='visualizar',
-- SessoesTab='alterar', ModulosMenusTab='alterar', UsuariosReal ainda não
-- migrado — permanece 'alterar' pra manter equivalente ao has_role(admin)
-- que tinha antes).
-- Corpo de cada função copiado verbatim da última definição viva (conferido
-- lendo os arquivos-fonte, não resumo): admin_vincular/desvincular_empregado
-- de 20260716000006 (reverteu a delegação por usuário — voltou a ser só
-- admin), admin_buscar_empregados de 20260720000002, admin_exec_dml de
-- 20260508042642, admin_list_active_sessions/admin_list_auth_logs de
-- 20260513192434, admin_alterar_empresa_cc de 20260520163846,
-- cs_form_setores_catalogo de 20260801000005.
--
-- ROLLBACK: recriar cada função com has_role(auth.uid(),'admin'::app_role)
-- (ou has_role(auth.uid(),'admin') sem cast, conforme original) nas linhas
-- indicadas, usando os arquivos-fonte citados acima.

CREATE OR REPLACE FUNCTION public.admin_vincular_empregado(
  p_user_id     uuid,
  p_empregado_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp  public."EMPREGADOS"%ROWTYPE;
  v_bloq text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem vincular.');
  END IF;
  IF p_user_id IS NULL OR p_empregado_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário e colaborador são obrigatórios.');
  END IF;

  SELECT * INTO v_emp FROM public."EMPREGADOS" WHERE "ID" = p_empregado_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cadastro não encontrado.');
  END IF;

  IF upper(coalesce(v_emp."Situação",'')) = ANY (v_bloq) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Colaborador desligado — não pode ser vinculado.');
  END IF;

  IF v_emp.auth_user_id IS NOT NULL AND v_emp.auth_user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este cadastro já está vinculado a outro usuário.');
  END IF;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = NULL
   WHERE auth_user_id = p_user_id AND "ID" <> p_empregado_id;

  UPDATE public."EMPREGADOS"
     SET auth_user_id = p_user_id,
         "email" = CASE
                     WHEN coalesce(btrim("email"), '') = ''
                     THEN (SELECT u.email FROM auth.users u WHERE u.id = p_user_id)
                     ELSE "email"
                   END
   WHERE "ID" = p_empregado_id;

  UPDATE public.profiles SET display_name = v_emp."Nome" WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'empregado', jsonb_build_object(
    'id', v_emp."ID", 'nome', coalesce(v_emp."Nome",''), 'cargo', coalesce(v_emp."Título do Cargo",''),
    'setor', coalesce(v_emp."Setor_ERP",''), 'situacao', coalesce(v_emp."Situação",'')));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conflito de vínculo — recarregue e tente de novo.');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_vincular_empregado(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_vincular_empregado(uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_desvincular_empregado(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas administradores podem desvincular.');
  END IF;
  UPDATE public."EMPREGADOS" SET auth_user_id = NULL WHERE auth_user_id = p_user_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_desvincular_empregado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desvincular_empregado(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_buscar_empregados(p_termo text)
RETURNS TABLE (
  "ID"               bigint,
  "Nome"             text,
  "CPF"              text,
  "Título do Cargo"  text,
  "Setor_ERP"        text,
  "Situação"         text,
  auth_user_id       uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q      text   := btrim(coalesce(p_termo, ''));
  v_digits text   := regexp_replace(v_q, '\D', '', 'g');
  v_tokens text[];
  v_bloq   text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RETURN;  -- sem permissão → sem resultados
  END IF;
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  -- Palavras da busca, normalizadas (sem acento, minúsculas, só alfanumérico).
  v_tokens := ARRAY(
    SELECT regexp_replace(lower(unaccent_safe(w)), '[^a-z0-9]+', '', 'g')
    FROM regexp_split_to_table(v_q, '\s+') AS w
  );

  RETURN QUERY
  SELECT e."ID", e."Nome", e."CPF", e."Título do Cargo", e."Setor_ERP", e."Situação", e.auth_user_id
  FROM public."EMPREGADOS" e
  WHERE upper(coalesce(e."Situação", '')) <> ALL (v_bloq)
    AND (
      -- Casa por NOME: existe token não-vazio e NENHUM token falta no nome.
      ( EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE t <> '')
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_tokens) t
          WHERE t <> ''
            AND regexp_replace(lower(unaccent_safe(coalesce(e."Nome", ''))), '[^a-z0-9]+', '', 'g')
                NOT LIKE '%' || t || '%'
        )
      )
      OR
      -- Casa por CPF pelos dígitos (mín. 3 para não trazer todo mundo).
      ( length(v_digits) >= 3
        AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') LIKE '%' || v_digits || '%'
      )
    )
  ORDER BY e."Nome"
  LIMIT 30;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_buscar_empregados(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_buscar_empregados(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_exec_dml(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Permite execução quando chamada via service_role (edge functions confiáveis)
  -- ou quando o usuário autenticado tem acesso de administração.
  IF current_setting('role', true) = 'service_role'
     OR (auth.uid() IS NOT NULL AND public.can_access(auth.uid(), 'administracao', 'alterar')) THEN
    EXECUTE p_sql;
    RETURN;
  END IF;
  RAISE EXCEPTION 'apenas administradores podem executar admin_exec_dml';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_active_sessions()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  ip text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT
    s.id,
    s.user_id,
    u.email::text,
    p.display_name,
    s.created_at,
    s.refreshed_at,
    s.user_agent,
    host(s.ip)::text
  FROM auth.sessions s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN public.profiles p ON p.id = s.user_id
  WHERE public.can_access(auth.uid(), 'administracao', 'alterar')
    AND (s.not_after IS NULL OR s.not_after > now())
  ORDER BY COALESCE(s.refreshed_at, s.created_at) DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.admin_list_active_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_active_sessions() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_auth_logs(_limit int DEFAULT 100)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  ip_address text,
  payload jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT a.id, a.created_at, a.ip_address, a.payload
  FROM auth.audit_log_entries a
  WHERE public.can_access(auth.uid(), 'administracao', 'visualizar')
  ORDER BY a.created_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 500));
$$;
REVOKE ALL ON FUNCTION public.admin_list_auth_logs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_logs(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_alterar_empresa_cc(
  _cc_id uuid,
  _nova_empresa_id uuid,
  _motivo text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cenario text;
  v_empresa_atual uuid;
BEGIN
  IF NOT public.can_access(auth.uid(), 'administracao', 'alterar') THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar a empresa de um CC.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.tem_permissao_especial(auth.uid(), 'alterar_empresa_cc') THEN
    RAISE EXCEPTION 'Você não possui a permissão especial "alterar_empresa_cc". Solicite a um administrador em Administração → Alçadas → Saúde.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(length(trim(_motivo)),0) < 5 THEN
    RAISE EXCEPTION 'Motivo obrigatório (mínimo 5 caracteres).' USING ERRCODE = 'check_violation';
  END IF;

  SELECT empresa_id INTO v_empresa_atual FROM public.centros_custo WHERE id = _cc_id;
  IF v_empresa_atual IS NULL THEN
    RAISE EXCEPTION 'CC não encontrado.';
  END IF;
  IF v_empresa_atual = _nova_empresa_id THEN
    RAISE EXCEPTION 'A nova empresa deve ser diferente da atual.';
  END IF;

  v_cenario := public.pode_alterar_empresa_cc(_cc_id);
  IF v_cenario = 'bloqueado' THEN
    RAISE EXCEPTION 'Troca bloqueada: existem movimentos vinculados a este CC.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.motivo_troca_empresa_cc', _motivo, true);

  UPDATE public.centros_custo
    SET empresa_id = _nova_empresa_id
    WHERE id = _cc_id;

  RETURN jsonb_build_object('ok', true, 'cenario', v_cenario);
END;
$$;

CREATE OR REPLACE FUNCTION public.cs_form_setores_catalogo()
RETURNS TABLE(setor text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fonte AS (
    -- ordem = prioridade da grafia: a da resposta manda (ver_setor casa nela).
    SELECT setor        AS s, 0 AS ordem FROM public."CS_FORM_RESPOSTAS"
    UNION ALL
    SELECT "Setor_ERP" AS s, 1 AS ordem FROM public."EMPREGADOS"
  ),
  norm AS (
    SELECT btrim(s) AS rotulo, ordem,
           upper(translate(btrim(s),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS chave
      FROM fonte
     WHERE btrim(coalesce(s, '')) <> ''
  )
  SELECT DISTINCT ON (chave) rotulo
    FROM norm
   WHERE chave <> 'PADRAO'                              -- placeholder de "sem setor"
     AND public.can_access(auth.uid(), 'administracao', 'alterar')  -- só quem gerencia módulos/menus lista o catálogo
   ORDER BY chave, ordem, rotulo;
$$;
REVOKE EXECUTE ON FUNCTION public.cs_form_setores_catalogo() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cs_form_setores_catalogo() TO authenticated;

NOTIFY pgrst, 'reload schema';
