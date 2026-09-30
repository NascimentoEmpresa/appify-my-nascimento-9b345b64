-- =========================================================================
-- Nascimento Formulários no módulo ENCARREGADOS + setor "Visitante" vira
-- "Encarregados" (30/09/2026)
--
-- PEDIDO (Pablo): "duplica a rota de /app/central-servicos/formularios pro
-- módulo dos encarregados, mas os encarregados só têm acesso APENAS A ALGUNS
-- FORMULÁRIOS e ... ELES SÓ PODEM ABRIR OS FORMULÁRIOS e ver as PRÓPRIAS
-- RESPOSTAS, NADA MAIS! e lá na central de serviços temos que conseguir
-- liberar por setor. o setor dos encarregados é VISITANTE (TROCA O NOME PRA:
-- ENCARREGADOS). liberando o formulário pro setor ENCARREGADOS, todos vão
-- poder ver nos formulários do Encarregados."
--
-- 1. SETOR. O setor dos encarregados mora em user_setor ("Visitante", 91
--    pessoas) — NÃO em EMPREGADOS."Setor_ERP" (80 deles nem têm). Renomeia
--    no setor_catalogo (user_setor segue por ON UPDATE CASCADE) e nas duas
--    tabelas que guardam o nome sem FK: malote_setor_visivel_usuario (12) e
--    CS_REEMBOLSO_APROVADOR_SETOR (1). "visitante" do handle_new_user é o
--    PAPEL (user_roles), outra coisa — não muda.
-- 2. LIBERAR POR SETOR. Os formulários decidem o setor da pessoa só pelo
--    Setor_ERP (cs_form_alvo). Entra o setor ENCARREGADOS (grafia do
--    público-alvo, em maiúsculas como os demais): quem está em user_setor
--    "Encarregados" responde formulário restrito liberado para ENCARREGADOS.
--    Só esse setor passa a valer pela user_setor — os outros continuam pelo
--    Setor_ERP, como antes (não amplia o alvo de formulário nenhum existente).
-- 3. A TELA DOS ENCARREGADOS (/app/encarregados/formularios, menu
--    encarregados_formularios): só os formulários publicados e liberados
--    para ENCARREGADOS; ações: RESPONDER e ver AS PRÓPRIAS respostas. Tudo por
--    RPC SECURITY DEFINER — o encarregado não ganha nenhuma capacidade
--    (ver_proprias etc.) nos formulários em geral.
-- 4. A resposta de encarregado sem setor no cadastro é carimbada com
--    ENCARREGADOS — é por esse setor que o painel, o filtro e o "ver por
--    setor" da Central de Serviços enxergam as respostas deles.
-- 5. Menu nasce com quem já tem o módulo: perfil "Encarregados" (86) e as
--    exceções individuais de encarregados_minhas_solicitacoes (18).
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
-- =========================================================================

-- ── 1. Setor: Visitante → Encarregados ───────────────────────────────────
UPDATE public.setor_catalogo SET nome = 'Encarregados' WHERE nome = 'Visitante'
  AND NOT EXISTS (SELECT 1 FROM public.setor_catalogo WHERE nome = 'Encarregados');
UPDATE public.malote_setor_visivel_usuario SET setor = 'Encarregados' WHERE setor = 'Visitante';
UPDATE public."CS_REEMBOLSO_APROVADOR_SETOR" SET setor = 'Encarregados' WHERE setor = 'Visitante';

-- ── 2. Setor ENCARREGADOS no público-alvo dos formulários ────────────────
-- A pessoa é do setor dos encarregados? (user_setor, sem acento/caixa)
CREATE OR REPLACE FUNCTION public.cs_form_eh_encarregado(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_setor us
     WHERE us.user_id = _uid AND upper(btrim(us.setor)) = 'ENCARREGADOS');
$$;
REVOKE ALL ON FUNCTION public.cs_form_eh_encarregado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_eh_encarregado(uuid) TO authenticated;

-- O formulário foi liberado para o setor ENCARREGADOS?
CREATE OR REPLACE FUNCTION public.cs_form_para_encarregados(_setores text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(_setores, '{}'::text[])) s WHERE upper(btrim(s)) = 'ENCARREGADOS');
$$;

-- cs_form_alvo: corpo da versão no ar + o setor ENCARREGADOS pela user_setor.
CREATE OR REPLACE FUNCTION public.cs_form_alvo(_form_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_FORMULARIOS" f
     WHERE f.id = _form_id
       AND (
         f.seguranca = 'liberado'
         OR (auth.uid() IS NOT NULL AND (
           -- restrito sem filtro nenhum = qualquer usuário logado do ERP
           (COALESCE(array_length(f.setores_acesso, 1), 0) = 0
            AND NOT EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u WHERE u.formulario_id = f.id))
           -- união: do setor liberado OU escolhido a dedo
           OR EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                       WHERE e.auth_user_id = auth.uid()
                         AND e."Setor_ERP" = ANY (f.setores_acesso))
           -- Setor ENCARREGADOS (30/09/2026, mig 276): o setor deles está na
           -- user_setor, não no Setor_ERP.
           OR (public.cs_form_para_encarregados(f.setores_acesso) AND public.cs_form_eh_encarregado())
           OR EXISTS (SELECT 1 FROM public."CS_FORM_ALVO_USUARIOS" u
                       WHERE u.formulario_id = f.id AND u.user_id = auth.uid())
           -- quem administra ou lê pela lista do botão "Acesso" também
           -- responde, esteja ou não no público-alvo.
           OR public.cs_form_papel_no_form(f.id) IS NOT NULL
         ))
       ));
$function$;

-- ── 3. RPCs da tela dos encarregados ─────────────────────────────────────
-- Quem pode abrir a tela: encarregado (setor) ou quem tem o menu (admin/gestão
-- conferindo o que eles veem).
CREATE OR REPLACE FUNCTION public.cs_form_enc_pode_ver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.cs_form_eh_encarregado()
      OR public.can_access(auth.uid(), 'encarregados_formularios', 'visualizar'::app_acao);
$$;
REVOKE ALL ON FUNCTION public.cs_form_enc_pode_ver() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_enc_pode_ver() TO authenticated;

CREATE OR REPLACE FUNCTION public.cs_form_encarregados_lista()
RETURNS TABLE (
  id uuid, titulo text, descricao text, slug text, imagem_capa_url text,
  inicia_em timestamptz, encerra_em timestamptz, aberto boolean,
  minhas_respostas integer, ultima_resposta timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.cs_form_enc_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso aos formulários dos encarregados.';
  END IF;
  RETURN QUERY
  SELECT f.id, f.titulo, f.descricao, f.slug, f.imagem_capa_url, f.inicia_em, f.encerra_em,
         public.cs_form_aberto(f.id),
         (SELECT count(*)::int FROM public."CS_FORM_RESPOSTAS" r WHERE r.formulario_id = f.id AND r.criado_por = auth.uid()),
         (SELECT max(r.enviado_em) FROM public."CS_FORM_RESPOSTAS" r WHERE r.formulario_id = f.id AND r.criado_por = auth.uid())
    FROM public."CS_FORMULARIOS" f
   WHERE f.deleted_at IS NULL
     AND f.status = 'publicado'
     AND public.cs_form_para_encarregados(f.setores_acesso)
   ORDER BY public.cs_form_aberto(f.id) DESC, f.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.cs_form_encarregados_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_encarregados_lista() TO authenticated;

-- As MINHAS respostas de um formulário dos encarregados (+ as perguntas, para
-- a tela mostrar o título de cada uma). Só as enviadas identificado: a
-- anônima não guarda quem respondeu.
CREATE OR REPLACE FUNCTION public.cs_form_encarregados_minhas_respostas(_form_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE f public."CS_FORMULARIOS"%ROWTYPE;
BEGIN
  IF NOT public.cs_form_enc_pode_ver() THEN
    RAISE EXCEPTION 'Sem acesso aos formulários dos encarregados.';
  END IF;
  SELECT * INTO f FROM public."CS_FORMULARIOS" WHERE id = _form_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.cs_form_para_encarregados(f.setores_acesso) THEN
    RAISE EXCEPTION 'Formulário não disponível para os encarregados.';
  END IF;
  RETURN jsonb_build_object(
    'titulo', f.titulo,
    'perguntas', coalesce(f.perguntas, '[]'::jsonb),
    'respostas', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', r.id, 'enviado_em', r.enviado_em, 'itens', r.itens) ORDER BY r.enviado_em DESC)
        FROM public."CS_FORM_RESPOSTAS" r
       WHERE r.formulario_id = f.id AND r.criado_por = auth.uid()), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.cs_form_encarregados_minhas_respostas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_form_encarregados_minhas_respostas(uuid) TO authenticated;

-- ── 4. Resposta de encarregado carimbada com o setor ─────────────────────
CREATE OR REPLACE FUNCTION public.cs_form_resposta_setor_encarregado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF btrim(coalesce(NEW.setor, '')) = '' AND NEW.criado_por IS NOT NULL
     AND public.cs_form_eh_encarregado(NEW.criado_por) THEN
    NEW.setor := 'ENCARREGADOS';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cs_form_resposta_setor_encarregado() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_cs_form_resposta_setor_encarregado ON public."CS_FORM_RESPOSTAS";
CREATE TRIGGER trg_cs_form_resposta_setor_encarregado
  BEFORE INSERT ON public."CS_FORM_RESPOSTAS"
  FOR EACH ROW EXECUTE FUNCTION public.cs_form_resposta_setor_encarregado();

-- ── 5. Menu no módulo Encarregados ───────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'encarregados_formularios', 'Nascimento Formulários', '/app/encarregados/formularios', 45, true
  FROM public.app_modulo m WHERE m.codigo = 'encarregados'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'encarregados_formularios', 'visualizar'::app_acao, true
  FROM public.perfil_acesso_permissao p
 WHERE p.menu_codigo = 'encarregados_minhas_solicitacoes' AND p.acao = 'visualizar'::app_acao AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT s.user_id, 'encarregados_formularios', 'visualizar'::app_acao, true, s.empresa_id,
       'Formulários dos Encarregados (mig 276): herdado de encarregados_minhas_solicitacoes'
  FROM public.screen_permission_user s
 WHERE s.menu_codigo = 'encarregados_minhas_solicitacoes' AND s.acao = 'visualizar'::app_acao AND s.allow
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

-- ── 6. Todo o setor Encarregados vê a tela ───────────────────────────────
-- 5 dos 91 do setor não estão no perfil "Encarregados": liberação individual
-- ("liberando o formulário pro setor ENCARREGADOS, todos vão poder ver").
INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT us.user_id, 'encarregados_formularios', 'visualizar'::app_acao, true, NULL,
       'Formulários dos Encarregados (mig 276): setor Encarregados'
  FROM public.user_setor us
 WHERE upper(btrim(us.setor)) = 'ENCARREGADOS'
   AND NOT public.can_access(us.user_id, 'encarregados_formularios', 'visualizar'::app_acao)
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DELETE FROM public.screen_permission_user  WHERE menu_codigo = 'encarregados_formularios';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'encarregados_formularios';
-- DELETE FROM public.app_menu WHERE codigo = 'encarregados_formularios';
-- DROP TRIGGER IF EXISTS trg_cs_form_resposta_setor_encarregado ON public."CS_FORM_RESPOSTAS";
-- DROP FUNCTION IF EXISTS public.cs_form_resposta_setor_encarregado();
-- DROP FUNCTION IF EXISTS public.cs_form_encarregados_minhas_respostas(uuid);
-- DROP FUNCTION IF EXISTS public.cs_form_encarregados_lista();
-- DROP FUNCTION IF EXISTS public.cs_form_enc_pode_ver();
-- -- cs_form_alvo: recriar sem a linha do setor ENCARREGADOS (versão acima menos o OR).
-- DROP FUNCTION IF EXISTS public.cs_form_para_encarregados(text[]);
-- DROP FUNCTION IF EXISTS public.cs_form_eh_encarregado(uuid);
-- UPDATE public."CS_REEMBOLSO_APROVADOR_SETOR" SET setor = 'Visitante' WHERE setor = 'Encarregados';
-- UPDATE public.malote_setor_visivel_usuario SET setor = 'Visitante' WHERE setor = 'Encarregados';
-- UPDATE public.setor_catalogo SET nome = 'Visitante' WHERE nome = 'Encarregados';
-- NOTIFY pgrst, 'reload schema';
