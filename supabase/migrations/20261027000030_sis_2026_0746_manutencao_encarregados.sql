-- ============================================================================
-- SIS-2026-0746 — Solicitação de manutenção para Encarregados e Almoxarifado
--
-- O formulário já existia na Central de Serviços. Esta migration cria a porta
-- equivalente no módulo Encarregados, libera os três responsáveis indicados e
-- mantém a criação da compra no Malote dentro da RPC transacional original.
--
-- ROLLBACK:
--   DELETE FROM public.screen_permission_user spu
--    USING public.profiles p
--    WHERE spu.user_id = p.id
--      AND p.display_name IN ('Bernardo Campos', 'Cassio Raphaelli Camargo Duarte', 'Cleidir Peixoto Goularte')
--      AND spu.menu_codigo IN ('central_servicos_solicitar_manutencao_equipamento',
--                              'encarregados_solicitar_manutencao_equipamento',
--                              'sup_solicitacoes_manutencoes');
--   DELETE FROM public.perfil_acesso_permissao
--    WHERE menu_codigo = 'encarregados_solicitar_manutencao_equipamento';
--   DELETE FROM public.app_menu
--    WHERE codigo = 'encarregados_solicitar_manutencao_equipamento';
--   DROP POLICY IF EXISTS sup_solicitacao_manutencao_insert ON public."SUP_SOLICITACAO_MANUTENCAO";
--   DROP POLICY IF EXISTS sup_solicitacao_manutencao_select ON public."SUP_SOLICITACAO_MANUTENCAO";
--   DROP POLICY IF EXISTS "sup solicitacoes manutencao storage select" ON storage.objects;
--   -- Recriar as três policies da migration 20261026000050 sem o menu de Encarregados.
-- ============================================================================

-- Porta própria: a sidebar e o RouteGuard casam o acesso pela rota, então
-- reutilizar o menu da Central faria o item aparecer no módulo errado.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id,
       'encarregados_solicitar_manutencao_equipamento',
       'Solicitar Manutenção de Equipamento',
       '/app/encarregados/solicitar-manutencao-equipamento',
       82,
       true
  FROM public.app_modulo m
 WHERE m.codigo = 'encarregados'
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'encarregados_solicitar_manutencao_equipamento', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES
   ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
   ('alterar'::public.app_acao), ('excluir'::public.app_acao)
 ) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO UPDATE SET allow = true;

-- O novo menu também é uma origem válida para a própria solicitação. A fila
-- do Almoxarifado permanece governada exclusivamente pelo menu de Suprimentos.
DROP POLICY IF EXISTS sup_solicitacao_manutencao_select ON public."SUP_SOLICITACAO_MANUTENCAO";
CREATE POLICY sup_solicitacao_manutencao_select
  ON public."SUP_SOLICITACAO_MANUTENCAO" FOR SELECT TO authenticated
  USING (
    (solicitante_id = auth.uid() AND (
      public.has_screen_access(auth.uid(), 'central_servicos_solicitar_manutencao_equipamento', 'visualizar')
      OR public.has_screen_access(auth.uid(), 'encarregados_solicitar_manutencao_equipamento', 'visualizar')
    ))
    OR public.has_screen_access(auth.uid(), 'sup_solicitacoes_manutencoes', 'visualizar')
  );

DROP POLICY IF EXISTS sup_solicitacao_manutencao_insert ON public."SUP_SOLICITACAO_MANUTENCAO";
CREATE POLICY sup_solicitacao_manutencao_insert
  ON public."SUP_SOLICITACAO_MANUTENCAO" FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND (
      public.has_screen_access(auth.uid(), 'central_servicos_solicitar_manutencao_equipamento', 'incluir')
      OR public.has_screen_access(auth.uid(), 'encarregados_solicitar_manutencao_equipamento', 'incluir')
    )
    AND status = 'aberta' AND respondida_por IS NULL AND respondida_em IS NULL
  );

DROP POLICY IF EXISTS "sup solicitacoes manutencao storage select" ON storage.objects;
CREATE POLICY "sup solicitacoes manutencao storage select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'sup-solicitacoes-manutencao'
    AND EXISTS (
      SELECT 1
        FROM public."SUP_SOLICITACAO_MANUTENCAO_ANEXO" a
        JOIN public."SUP_SOLICITACAO_MANUTENCAO" s ON s.id = a.solicitacao_id
       WHERE a.caminho = storage.objects.name
         AND (
           (s.solicitante_id = auth.uid() AND (
             public.has_screen_access(auth.uid(), 'central_servicos_solicitar_manutencao_equipamento', 'visualizar')
             OR public.has_screen_access(auth.uid(), 'encarregados_solicitar_manutencao_equipamento', 'visualizar')
           ))
           OR public.has_screen_access(auth.uid(), 'sup_solicitacoes_manutencoes', 'visualizar')
         )
    )
  );

-- Liberação solicitada: Bernardo (almoxarifado), Cássio e Cleidir podem abrir
-- e acompanhar pela Central/Encarregados e administrar a fila em Suprimentos.
-- Nomes completos tornam a migration determinística e impedem liberar homônimos.
DO $bloco$
DECLARE
  v_usuarios uuid[];
BEGIN
  SELECT array_agg(p.id ORDER BY p.display_name)
    INTO v_usuarios
    FROM public.profiles p
   WHERE p.ativo
     AND p.display_name IN (
       'Bernardo Campos',
       'Cassio Raphaelli Camargo Duarte',
       'Cleidir Peixoto Goularte'
     );

  IF COALESCE(array_length(v_usuarios, 1), 0) <> 3 THEN
    RAISE EXCEPTION
      'SIS-2026-0746: esperava os perfis Bernardo Campos, Cassio Raphaelli Camargo Duarte e Cleidir Peixoto Goularte; encontrou %.',
      COALESCE(array_length(v_usuarios, 1), 0);
  END IF;

  INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
  SELECT u.user_id, p.menu_codigo, p.acao, true, NULL
    FROM unnest(v_usuarios) AS u(user_id)
   CROSS JOIN (VALUES
     ('central_servicos_solicitar_manutencao_equipamento', 'visualizar'::public.app_acao),
     ('central_servicos_solicitar_manutencao_equipamento', 'incluir'::public.app_acao),
     ('encarregados_solicitar_manutencao_equipamento', 'visualizar'::public.app_acao),
     ('encarregados_solicitar_manutencao_equipamento', 'incluir'::public.app_acao),
     ('sup_solicitacoes_manutencoes', 'visualizar'::public.app_acao),
     ('sup_solicitacoes_manutencoes', 'alterar'::public.app_acao)
   ) AS p(menu_codigo, acao)
  ON CONFLICT (user_id, menu_codigo, acao, empresa_id)
    DO UPDATE SET allow = true, updated_at = now();
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
