-- =========================================================================
-- Sistemas › Checklist de Módulos: RESPONSÁVEIS PELO TREINAMENTO (02/10/2026)
--
-- Pedido do Pablo: "quando for definir o treinamento tem que ter um
-- responsável ou responsáveis pelo treinamento". Nova coluna com UMA OU MAIS
-- pessoas (profiles), obrigatória sempre que a etapa Treinamento tiver
-- status — menos "Não se aplica" (não há treinamento a conduzir).
--
-- A trava fica também no banco (CHECK), não só na tela. NOT VALID: as 4
-- linhas já marcadas "Treinado" sem responsável não quebram a migration,
-- mas a próxima gravação delas exige o responsável — que é a regra.
--
-- O histórico (SIS_CHECKLIST_HIST) passa a registrar a troca, com os nomes.
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SIS_CHECKLIST" ADD COLUMN IF NOT EXISTS treinamento_responsaveis uuid[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public."SIS_CHECKLIST".treinamento_responsaveis IS
  'Quem conduz o treinamento (profiles.id). Obrigatório com status_treinamento preenchido, exceto nao_se_aplica. Mig 20261002000006.';

ALTER TABLE public."SIS_CHECKLIST" DROP CONSTRAINT IF EXISTS sis_checklist_treinamento_responsavel_ck;
ALTER TABLE public."SIS_CHECKLIST" ADD CONSTRAINT sis_checklist_treinamento_responsavel_ck CHECK (
  status_treinamento IS NULL OR status_treinamento = 'nao_se_aplica'
  OR coalesce(cardinality(treinamento_responsaveis), 0) > 0
) NOT VALID;

CREATE OR REPLACE FUNCTION public.sis_checklist_historico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_nome text := coalesce(public.sis_ck_nome_usuario(auth.uid()), 'Sistema');
  k text;
  v_de text;
  v_para text;
  v_campos text[] := ARRAY['status_dev', 'status_implantacao', 'status_treinamento', 'status_validacao',
                           'responsavel_id', 'usuario_chave_id', 'previsao_entrega', 'data_implantacao',
                           'data_treinamento', 'data_validacao', 'observacoes', 'area', 'treinamento_responsaveis'];
BEGIN
  FOREACH k IN ARRAY v_campos LOOP
    v_para := to_jsonb(NEW) ->> k;
    v_de := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ->> k END;
    -- Lista vazia conta como vazio (não registra "[] → []" na criação).
    IF k = 'treinamento_responsaveis' THEN
      v_para := nullif(v_para, '[]');
      v_de := nullif(v_de, '[]');
    END IF;
    IF v_para IS DISTINCT FROM v_de AND NOT (TG_OP = 'INSERT' AND v_para IS NULL) THEN
      IF k IN ('responsavel_id', 'usuario_chave_id') THEN
        v_de := public.sis_ck_nome_usuario(v_de::uuid);
        v_para := public.sis_ck_nome_usuario(v_para::uuid);
      ELSIF k = 'treinamento_responsaveis' THEN
        v_de := (SELECT string_agg(public.sis_ck_nome_usuario(x::uuid), ', ') FROM jsonb_array_elements_text(to_jsonb(OLD) -> k) x WHERE TG_OP = 'UPDATE');
        v_para := (SELECT string_agg(public.sis_ck_nome_usuario(x::uuid), ', ') FROM jsonb_array_elements_text(to_jsonb(NEW) -> k) x);
      END IF;
      INSERT INTO public."SIS_CHECKLIST_HIST"(checklist_id, modulo_id, menu_id, campo, de, para, usuario_id, usuario_nome)
      VALUES (NEW.id, NEW.modulo_id, NEW.menu_id, k, left(v_de, 300), left(v_para, 300), auth.uid(), v_nome);
    END IF;
  END LOOP;
  RETURN NEW;
END $f$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- ALTER TABLE public."SIS_CHECKLIST" DROP CONSTRAINT IF EXISTS sis_checklist_treinamento_responsavel_ck;
-- ALTER TABLE public."SIS_CHECKLIST" DROP COLUMN IF EXISTS treinamento_responsaveis;
-- Reaplicar sis_checklist_historico da 20260930000292 (sem treinamento_responsaveis).
-- NOTIFY pgrst, 'reload schema';
