-- =====================================================================
-- CANAL DE ÉTICA — recorte por empresa conforme o nível de acesso
--
-- Fecha o último requisito do Bloco 1 que tinha ficado pela metade: os
-- relatórios POR empresa já existiam, mas quem tinha o menu do canal via
-- todas as empresas. Faltava o nível de acesso.
--
-- COMO, SEM MECANISMO NOVO
-- O ERP já responde "esta pessoa pode atuar nesta empresa?" em
-- public.user_pode_atuar_empresa(), que olha a flag `acessa_todas_empresas`
-- do perfil, a tabela `user_empresa` e a empresa do próprio perfil — e é o
-- que Administração já mantém. Aqui ela é plugada na RLS do canal; não há
-- cadastro novo de permissão (ver a regra do módulo de acesso).
--
-- A CAPACIDADE
--   comite_etica_todas_empresas → vê o consolidado, todas as empresas.
--   sem ela                     → vê só as empresas às quais está vinculada.
--
-- POR QUE A CAPACIDADE É "VÊ TODAS" E NÃO "É RESTRITO"
-- Porque o padrão seguro aqui não é o mais fechado: é o que não apaga o
-- canal. Restringir por padrão faria todo membro do Comitê com `user_empresa`
-- vazio deixar de enxergar qualquer caso no dia em que isto rodar — canal de
-- ética no escuro é pior do que canal largo. Por isso a migration CONCEDE a
-- capacidade a quem já tem o canal hoje: no dia 1 nada muda, e a restrição
-- passa a ser um ato deliberado, feito removendo a capacidade de alguém.
--
-- Idempotente.
-- =====================================================================

-- ── 1. A capacidade ──────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'comite_etica_todas_empresas', 'Vê denúncias de todas as empresas', NULL, 33, true
  FROM public.app_modulo m WHERE m.codigo = 'comite_etica'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Quem hoje enxerga o canal continua enxergando tudo. Mesma ação que o
-- toggle de "Acesso por Usuário" concede (`visualizar`), para o flag poder
-- ser tirado por lá depois.
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id)
SELECT DISTINCT s.user_id, 'comite_etica_todas_empresas', 'visualizar'::public.app_acao, true, NULL
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'central_servicos_canal_denuncias'
   AND s.allow = true
   AND s.empresa_id IS NULL
ON CONFLICT DO NOTHING;

-- ── 2. Ligar a opção do canal à empresa do cadastro ──────────────────
-- Sem este vínculo o recorte não tem como resolver: a denúncia aponta para a
-- OPÇÃO do canal, e o acesso da pessoa é por empresa do cadastro fiscal.
-- "Nascimento" é a HAGG, a matriz (confirmado pelo Pablo em 21/08/2026).
UPDATE public."CANAL_DENUNCIA_EMPRESA" ce
   SET empresa_id        = e.id,
       -- Casado contra EMPREGADOS."Nome da Empresa" para a lista de contratos
       -- daquela empresa deixar de oferecer os contratos do grupo inteiro.
       padrao_empregados = COALESCE(ce.padrao_empregados, '%' || e.codigo || '%')
  FROM public.empresas e
 WHERE ce.empresa_id IS NULL
   AND e.codigo = CASE ce.rotulo WHEN 'Nascimento' THEN 'HAGG' ELSE ce.rotulo END;

-- ── 3. Quem pode ver este caso ───────────────────────────────────────
-- Fica numa função só, e não repetida em cada policy: a regra de quem
-- enxerga o quê num canal de ética não pode divergir entre duas cópias.
CREATE OR REPLACE FUNCTION public.canal_denuncia_visivel(_empresa_opcao uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT public.tem_acesso_menu('central_servicos_canal_denuncias')
     AND (
       -- Consolidado.
       public.tem_acesso_menu('comite_etica_todas_empresas')
       -- Ou vinculada à empresa daquele caso.
       OR EXISTS (
         SELECT 1
           FROM public."CANAL_DENUNCIA_EMPRESA" ce
          WHERE ce.id = _empresa_opcao
            AND ce.empresa_id IS NOT NULL
            AND public.user_pode_atuar_empresa(auth.uid(), ce.empresa_id)
       )
     );
$$;

COMMENT ON FUNCTION public.canal_denuncia_visivel(uuid) IS
  'Quem enxerga uma denuncia: quem tem o canal E (ve todas as empresas OU esta vinculada a empresa do caso). Denuncia sem empresa so aparece para quem ve todas.';

REVOKE ALL ON FUNCTION public.canal_denuncia_visivel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canal_denuncia_visivel(uuid) TO authenticated;

-- Denúncia com `empresa_id` nulo — as anteriores a esta entrega, e as que
-- vierem de uma opção ainda não ligada ao cadastro — só aparece para quem vê
-- todas. É o lado certo para errar: caso não classificado ficar visível a um
-- recorte que não devia é pior do que ficar invisível a quem tem o consolidado.

-- ── 4. RLS ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS canal_denuncia_select ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_select ON public."CANAL_DENUNCIA"
  FOR SELECT TO authenticated
  USING (public.canal_denuncia_visivel(empresa_id));

DROP POLICY IF EXISTS canal_denuncia_update ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_update ON public."CANAL_DENUNCIA"
  FOR UPDATE TO authenticated
  USING (public.canal_denuncia_visivel(empresa_id))
  WITH CHECK (public.canal_denuncia_visivel(empresa_id));

-- As tabelas filhas seguem o pai. Sem isto, alguém restrito a uma empresa
-- leria a conversa, os anexos e o histórico de um caso que não pode abrir —
-- e a lista de anexos sozinha já entrega do que o caso trata.
DROP POLICY IF EXISTS canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_select ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                  WHERE d.id = "CANAL_DENUNCIA_MENSAGEM".denuncia_id
                    AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_insert ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR INSERT TO authenticated
  WITH CHECK (autor = 'comite'
              AND autor_user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                           WHERE d.id = "CANAL_DENUNCIA_MENSAGEM".denuncia_id
                             AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE POLICY canal_denuncia_msg_update ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                  WHERE d.id = "CANAL_DENUNCIA_MENSAGEM".denuncia_id
                    AND public.canal_denuncia_visivel(d.empresa_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                       WHERE d.id = "CANAL_DENUNCIA_MENSAGEM".denuncia_id
                         AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO";
CREATE POLICY canal_denuncia_evento_select ON public."CANAL_DENUNCIA_EVENTO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                  WHERE d.id = "CANAL_DENUNCIA_EVENTO".denuncia_id
                    AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_anexo_select ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_select ON public."CANAL_DENUNCIA_ANEXO"
  FOR SELECT TO authenticated
  USING ((NOT sensivel OR public.tem_acesso_menu('comite_etica_sigilo'))
         AND EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                      WHERE d.id = "CANAL_DENUNCIA_ANEXO".denuncia_id
                        AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_anexo_insert ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_insert ON public."CANAL_DENUNCIA_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (origem <> 'denunciante'
              AND EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                           WHERE d.id = "CANAL_DENUNCIA_ANEXO".denuncia_id
                             AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_anexo_update ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_update ON public."CANAL_DENUNCIA_ANEXO"
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                  WHERE d.id = "CANAL_DENUNCIA_ANEXO".denuncia_id
                    AND public.canal_denuncia_visivel(d.empresa_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                       WHERE d.id = "CANAL_DENUNCIA_ANEXO".denuncia_id
                         AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_prov_todas ON public."CANAL_DENUNCIA_PROVIDENCIA";
CREATE POLICY canal_prov_todas ON public."CANAL_DENUNCIA_PROVIDENCIA"
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                  WHERE d.id = "CANAL_DENUNCIA_PROVIDENCIA".denuncia_id
                    AND public.canal_denuncia_visivel(d.empresa_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                       WHERE d.id = "CANAL_DENUNCIA_PROVIDENCIA".denuncia_id
                         AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                  WHERE d.id = "CANAL_DENUNCIA_ALERTA".denuncia_id
                    AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA"
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                  WHERE d.id = "CANAL_DENUNCIA_ALERTA".denuncia_id
                    AND public.canal_denuncia_visivel(d.empresa_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                       WHERE d.id = "CANAL_DENUNCIA_ALERTA".denuncia_id
                         AND public.canal_denuncia_visivel(d.empresa_id)));

-- Storage: o arquivo mora em `<denuncia_id>/...`, então o primeiro pedaço do
-- caminho diz de que caso ele é. Sem isto, o recorte valeria para a linha do
-- anexo e não para o binário — e a URL assinada continuaria saindo.
DROP POLICY IF EXISTS denuncia_evid_select ON storage.objects;
CREATE POLICY denuncia_evid_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'denuncia-evidencias'
         AND EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                      WHERE d.id::text = split_part(storage.objects.name, '/', 1)
                        AND public.canal_denuncia_visivel(d.empresa_id)));

DROP POLICY IF EXISTS denuncia_evid_insert ON storage.objects;
CREATE POLICY denuncia_evid_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'denuncia-evidencias'
              AND EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA" d
                           WHERE d.id::text = split_part(storage.objects.name, '/', 1)
                             AND public.canal_denuncia_visivel(d.empresa_id)));

-- ── 5. Índice do recorte ─────────────────────────────────────────────
-- A policy filtra por empresa_id em toda leitura da lista; o índice já existe
-- desde a 20260914000002 (idx_canal_denuncia_empresa).

NOTIFY pgrst, 'reload schema';

-- ── 6. Conferência ───────────────────────────────────────────────────
SELECT (SELECT count(*) FROM public."CANAL_DENUNCIA_EMPRESA" WHERE empresa_id IS NOT NULL) AS opcoes_ligadas,
       (SELECT count(*) FROM public."CANAL_DENUNCIA_EMPRESA")                              AS opcoes_total,
       (SELECT count(*) FROM public.screen_permission_user
         WHERE menu_codigo = 'comite_etica_todas_empresas' AND allow)                       AS com_consolidado;

-- =====================================================================
-- ROLLBACK
--   Restaurar canal_denuncia_select/update da 20260812000001 e as policies
--   das tabelas filhas da 20260914000002/4 (todas usando apenas
--   tem_acesso_menu('central_servicos_canal_denuncias'));
--   DROP FUNCTION IF EXISTS public.canal_denuncia_visivel(uuid);
--   DELETE FROM public.screen_permission_user WHERE menu_codigo = 'comite_etica_todas_empresas';
--   DELETE FROM public.app_menu WHERE codigo = 'comite_etica_todas_empresas';
-- =====================================================================
