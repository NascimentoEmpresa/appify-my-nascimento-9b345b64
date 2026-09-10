-- =========================================================================
-- Quadro de Avisos: a imagem do aviso
--
-- As colunas `anexo_url` / `anexo_nome` nasceram na 078 e nunca receberam
-- nada: a tela não tinha por onde subir arquivo. Aqui elas ganham o bucket
-- que faltava — e é só isso que falta, o resto é frontend.
--
-- BUCKET PÚBLICO, IGUAL AO bi-capas (migration 20260930000079).
--   A imagem aparece dentro do aviso que PARA A TELA de todo mundo. URL
--   assinada ali significa uma assinatura por aviso por carregamento, e um
--   aviso que trava a tela com a imagem quebrada porque a assinatura venceu
--   é o pior lugar possível para esse tipo de falha. Nada sigiloso entra
--   aqui: é ilustração de comunicado interno, o mesmo conteúdo que o aviso
--   já mostra em texto para o mesmo público.
--
-- MIME e tamanho travados NO BUCKET, não só na tela.
--   O upload vai direto do navegador para o storage — validar apenas no
--   React é validar do lado de quem envia.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".anexo_url IS
  'Imagem do aviso. URL pública do bucket avisos-anexos, ou um link de fora colado à mão.';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".anexo_nome IS
  'O nome do arquivo como a pessoa subiu — serve para a tela dizer o que está anexado.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avisos-anexos', 'avisos-anexos', true, 5242880,
        ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Ler é de todo mundo porque o aviso é de todo mundo: quem recebe a caixa na
-- frente da tela tem de enxergar a imagem dela.
DROP POLICY IF EXISTS avisos_anexos_ler ON storage.objects;
CREATE POLICY avisos_anexos_ler ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avisos-anexos');

-- Subir é de quem publica aviso. `incluir` OU `alterar`: a imagem entra tanto
-- no aviso que está nascendo quanto no que está sendo corrigido, e exigir as
-- duas capacidades deixaria quem só cria sem conseguir ilustrar o próprio.
DROP POLICY IF EXISTS avisos_anexos_subir ON storage.objects;
CREATE POLICY avisos_anexos_subir ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avisos-anexos' AND (
    public.pode_gerir_avisos(auth.uid(), 'incluir'::app_acao)
    OR public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao)));

DROP POLICY IF EXISTS avisos_anexos_trocar ON storage.objects;
CREATE POLICY avisos_anexos_trocar ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avisos-anexos' AND public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));

DROP POLICY IF EXISTS avisos_anexos_apagar ON storage.objects;
CREATE POLICY avisos_anexos_apagar ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avisos-anexos' AND public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));

-- ── O alvo do aviso recém-criado ─────────────────────────────────────────
-- A 081 pediu `alterar` para gravar linha em SISTEMA_NOTIFICACAO_ALVO, mas
-- escolher o público faz parte de CRIAR o aviso: quem tem só `incluir`
-- gravava a notificação e levava 403 na linha seguinte, deixando um aviso
-- salvo e publicado com o recorte que a pessoa escolheu jogado fora, sem
-- nenhum sinal na tela além de "não deu para gravar".
DROP POLICY IF EXISTS sistema_notif_alvo_incluir ON public."SISTEMA_NOTIFICACAO_ALVO";
CREATE POLICY sistema_notif_alvo_incluir ON public."SISTEMA_NOTIFICACAO_ALVO" FOR INSERT TO authenticated
  WITH CHECK (public.pode_gerir_avisos(auth.uid(), 'incluir'::app_acao)
           OR public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));

-- Mesma história do outro lado: salvar reescreve os alvos apagando os
-- antigos, então o DELETE tem de alcançar quem o INSERT alcança.
DROP POLICY IF EXISTS sistema_notif_alvo_excluir ON public."SISTEMA_NOTIFICACAO_ALVO";
CREATE POLICY sistema_notif_alvo_excluir ON public."SISTEMA_NOTIFICACAO_ALVO" FOR DELETE TO authenticated
  USING (public.pode_gerir_avisos(auth.uid(), 'incluir'::app_acao)
      OR public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP POLICY IF EXISTS avisos_anexos_apagar ON storage.objects;
-- DROP POLICY IF EXISTS avisos_anexos_trocar ON storage.objects;
-- DROP POLICY IF EXISTS avisos_anexos_subir  ON storage.objects;
-- DROP POLICY IF EXISTS avisos_anexos_ler    ON storage.objects;
-- DELETE FROM storage.objects WHERE bucket_id = 'avisos-anexos';
-- DELETE FROM storage.buckets WHERE id = 'avisos-anexos';
--
-- DROP POLICY IF EXISTS sistema_notif_alvo_incluir ON public."SISTEMA_NOTIFICACAO_ALVO";
-- CREATE POLICY sistema_notif_alvo_incluir ON public."SISTEMA_NOTIFICACAO_ALVO" FOR INSERT TO authenticated
--   WITH CHECK (public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));
-- DROP POLICY IF EXISTS sistema_notif_alvo_excluir ON public."SISTEMA_NOTIFICACAO_ALVO";
-- CREATE POLICY sistema_notif_alvo_excluir ON public."SISTEMA_NOTIFICACAO_ALVO" FOR DELETE TO authenticated
--   USING (public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));
-- NOTIFY pgrst, 'reload schema';
