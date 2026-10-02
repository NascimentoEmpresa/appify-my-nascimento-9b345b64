-- =========================================================================
-- Sistemas › Checklist de Módulos: ÁREA do módulo (02/10/2026)
--
-- O painel passou a ser o "Controle de Efetividade dos Módulos" do modelo
-- que o Pablo mandou: uma linha por MÓDULO com Área, status do
-- desenvolvimento, treinamento, validação, responsável e efetividade. A Área
-- (o setor dono do módulo — "Recursos Humanos", "Financeiro"…) não existe no
-- cadastro de módulos: fica no checklist do módulo (menu_id NULL), editável
-- pelo gerente. Vazia, a tela usa um padrão por código de módulo.
--
-- O status do MÓDULO é a própria linha do módulo (status_* com menu_id
-- NULL); vazio, a tela calcula pelas telas dele. A área entra no histórico.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SIS_CHECKLIST" ADD COLUMN IF NOT EXISTS area text;
COMMENT ON COLUMN public."SIS_CHECKLIST".area IS
  'Setor dono do módulo (linha do módulo, menu_id NULL). Vazio = padrão da tela por código do módulo. Mig 292.';

CREATE OR REPLACE FUNCTION public.sis_checklist_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_nome text := coalesce(public.sis_ck_nome_usuario(auth.uid()), 'Sistema');
  k text;
  v_de text;
  v_para text;
  v_campos text[] := ARRAY['status_dev', 'status_implantacao', 'status_treinamento', 'status_validacao',
                           'responsavel_id', 'usuario_chave_id', 'previsao_entrega', 'data_implantacao',
                           'data_treinamento', 'data_validacao', 'observacoes', 'area'];
BEGIN
  FOREACH k IN ARRAY v_campos LOOP
    v_para := to_jsonb(NEW) ->> k;
    v_de := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> k END;
    IF v_para IS DISTINCT FROM v_de AND NOT (TG_OP = 'INSERT' AND v_para IS NULL) THEN
      IF k IN ('responsavel_id', 'usuario_chave_id') THEN
        v_de := public.sis_ck_nome_usuario(v_de::uuid);
        v_para := public.sis_ck_nome_usuario(v_para::uuid);
      END IF;
      INSERT INTO public."SIS_CHECKLIST_HIST"(checklist_id, modulo_id, menu_id, campo, de, para, usuario_id, usuario_nome)
      VALUES (NEW.id, NEW.modulo_id, NEW.menu_id, k, left(v_de, 300), left(v_para, 300), auth.uid(), v_nome);
    END IF;
  END LOOP;
  RETURN NEW;
END $f$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SIS_CHECKLIST" DROP COLUMN IF EXISTS area;
-- Reaplicar sis_checklist_historico da 20260930000291 (sem 'area').
-- NOTIFY pgrst, 'reload schema';
