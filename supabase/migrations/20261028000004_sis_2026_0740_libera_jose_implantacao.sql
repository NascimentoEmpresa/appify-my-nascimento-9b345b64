-- ============================================================================
-- SIS-2026-0740 — libera José Carlos Ferreira Ebert para preencher o checklist
-- de Implantação de Contratos.
--
-- A correção da policy do checklist já foi aplicada, mas o usuário informado
-- no chamado possui somente visualização da tela. Como cada resposta inédita
-- é um INSERT do UPSERT, ele precisa das ações `incluir` e `alterar` no menu
-- ativo da rota, além de `visualizar` para a tela permanecer acessível.
--
-- A liberação é individual, por nome de perfil validado de forma exata. Não
-- amplia a escrita para os demais usuários que possuem apenas visualização.
-- ============================================================================

DO $$
DECLARE
  v_usuario_id uuid;
  v_total integer;
BEGIN
  SELECT count(*)
    INTO v_total
    FROM public.profiles
   WHERE upper(btrim(display_name)) = 'JOSE CARLOS FERREIRA EBERT'
     AND ativo;

  IF v_total <> 1 THEN
    RAISE EXCEPTION
      'SIS-2026-0740: esperado 1 perfil ativo de José Carlos Ferreira Ebert; encontrados %',
      v_total;
  END IF;

  SELECT id
    INTO v_usuario_id
    FROM public.profiles
   WHERE upper(btrim(display_name)) = 'JOSE CARLOS FERREIRA EBERT'
     AND ativo;

  INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, motivo)
  SELECT
    v_usuario_id,
    'licitacoes.implantacao',
    acao,
    true,
    'SIS-2026-0740: liberação individual para preencher e salvar o checklist de Implantação de Contratos'
  FROM unnest(ARRAY['visualizar', 'incluir', 'alterar']::public.app_acao[]) AS acao
  ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO UPDATE
    SET allow = EXCLUDED.allow,
        motivo = EXCLUDED.motivo,
        updated_at = now();
END
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK — remove apenas a liberação individual criada por esta migration.
--
-- DELETE FROM public.screen_permission_user spu
--  USING public.profiles p
--  WHERE p.id = spu.user_id
--    AND upper(btrim(p.display_name)) = 'JOSE CARLOS FERREIRA EBERT'
--    AND spu.menu_codigo = 'licitacoes.implantacao'
--    AND spu.motivo = 'SIS-2026-0740: liberação individual para preencher e salvar o checklist de Implantação de Contratos';
-- NOTIFY pgrst, 'reload schema';
-- ============================================================================
