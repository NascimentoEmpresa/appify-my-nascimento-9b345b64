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
--      AND (   (p.display_name ILIKE '%Bernardo%' AND p.display_name ILIKE '%Campos%')
--           OR p.display_name ILIKE '%Raphaelli%'
--           OR p.display_name ILIKE '%Cleidir%')
--      AND p.display_name NOT ILIKE '%teste%'
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
--
-- 27/10/2026 — ESTA PARTE BARROU A FILA DE MIGRATIONS INTEIRA.
-- A versão anterior casava `profiles.display_name` por igualdade exata com os
-- três nomes completos e abortava se não achasse exatamente 3:
--
--   ERROR: SIS-2026-0746: esperava os perfis Bernardo Campos, Cassio Raphaelli
--          Camargo Duarte e Cleidir Peixoto Goularte; encontrou 0.
--
-- Encontrou ZERO dos três. Nome digitado num chamado não é chave: acento
-- ("Cássio"), nome do meio, caixa e espaço sobrando fazem a igualdade falhar
-- sem que ninguém esteja errado. E como o aplicador roda numa transação única
-- e para no primeiro erro, um nome fora de forma deixou de ser um detalhe de
-- permissão e passou a barrar as migrations de todo mundo em cada merge.
--
-- Duas mudanças:
--   1. a busca segue a convenção do repositório para casar pessoa por nome
--      (`display_name ILIKE '%fragmento%'`, excluindo as contas de teste, que
--      duplicam nome oficial) e exige UM perfil ativo por pessoa — se o
--      fragmento casar mais de um, ninguém é liberado às cegas;
--   2. perfil que não aparece é AVISO, não exceção. Permissão de um usuário é
--      ajustável em /app/administracao?tab=modulos em dez segundos; fila de
--      migration parada bloqueia o banco para o time inteiro. O aviso sai no
--      log do merge dizendo exatamente quem ficou de fora.
DO $bloco$
DECLARE
  v_liberados int := 0;
  v_falta text;
  v_ambiguo text;
BEGIN
  CREATE TEMP TABLE _sis0746_alvo (rotulo text, frag1 text, frag2 text) ON COMMIT DROP;
  INSERT INTO _sis0746_alvo VALUES
    ('Bernardo Campos',                 '%bernardo%',  '%campos%'),
    ('Cassio Raphaelli Camargo Duarte', '%raphaelli%', '%'),
    ('Cleidir Peixoto Goularte',        '%cleidir%',   '%');

  CREATE TEMP TABLE _sis0746_achado ON COMMIT DROP AS
  SELECT a.rotulo,
         p.id AS user_id,
         p.display_name,
         count(*) OVER (PARTITION BY a.rotulo) AS quantos
    FROM _sis0746_alvo a
    JOIN public.profiles p
      ON p.ativo
     AND lower(coalesce(p.display_name, '')) LIKE a.frag1
     AND lower(coalesce(p.display_name, '')) LIKE a.frag2
     -- Conta de teste duplica o nome oficial e casaria junto.
     AND coalesce(p.display_name, '') NOT ILIKE '%teste%';

  INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
  SELECT ac.user_id, m.menu_codigo, m.acao, true, NULL
    FROM _sis0746_achado ac
   CROSS JOIN (VALUES
     ('central_servicos_solicitar_manutencao_equipamento', 'visualizar'::public.app_acao),
     ('central_servicos_solicitar_manutencao_equipamento', 'incluir'::public.app_acao),
     ('encarregados_solicitar_manutencao_equipamento', 'visualizar'::public.app_acao),
     ('encarregados_solicitar_manutencao_equipamento', 'incluir'::public.app_acao),
     ('sup_solicitacoes_manutencoes', 'visualizar'::public.app_acao),
     ('sup_solicitacoes_manutencoes', 'alterar'::public.app_acao)
   ) AS m(menu_codigo, acao)
   WHERE ac.quantos = 1
  ON CONFLICT (user_id, menu_codigo, acao, empresa_id)
    DO UPDATE SET allow = true, updated_at = now();

  SELECT count(*) INTO v_liberados FROM _sis0746_achado WHERE quantos = 1;

  SELECT string_agg(a.rotulo, '; ' ORDER BY a.rotulo) INTO v_falta
    FROM _sis0746_alvo a
   WHERE NOT EXISTS (SELECT 1 FROM _sis0746_achado ac WHERE ac.rotulo = a.rotulo);

  SELECT string_agg(DISTINCT ac.rotulo || ' -> ' || ac.display_name, '; ') INTO v_ambiguo
    FROM _sis0746_achado ac
   WHERE ac.quantos > 1;

  RAISE NOTICE 'SIS-2026-0746: % de 3 perfis liberados na manutenção de equipamento.', v_liberados;

  IF v_falta IS NOT NULL THEN
    RAISE WARNING 'SIS-2026-0746: perfil ativo não encontrado para: %. Libere à mão em /app/administracao?tab=modulos (menus central_servicos_solicitar_manutencao_equipamento, encarregados_solicitar_manutencao_equipamento e sup_solicitacoes_manutencoes). A migration NÃO falha por isso.', v_falta;
  END IF;

  IF v_ambiguo IS NOT NULL THEN
    RAISE WARNING 'SIS-2026-0746: mais de um perfil ativo casou o mesmo nome e nenhum deles foi liberado, para não acertar homônimo: %.', v_ambiguo;
  END IF;
END;
$bloco$;

NOTIFY pgrst, 'reload schema';
