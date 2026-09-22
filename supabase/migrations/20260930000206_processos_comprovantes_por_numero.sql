-- =========================================================================
-- Processos › Comprovantes: ancorados no NÚMERO do processo, não no id da
-- linha — "Salvar processo" apagava os anexos
--
-- Incidente de 22/09/2026 (Pablo: "quando eu anexo um comprovante e salvo,
-- quando volto não tem nada, não tá salvando de verdade"). O "Salvar
-- processo" (Processos.tsx) não faz UPDATE: APAGA todas as linhas do número
-- e insere de novo (uma por motivo) — as linhas renascem com id novo. A
-- 20260930000193 ligou JUR_PROCESSO_COMPROVANTE e JUR_PROCESSO_MALOTE_VINCULO
-- em JUR_PROCESSOS(id) com ON DELETE CASCADE: todo salvar levava junto os
-- comprovantes anexados e os vínculos manuais com o Malote. O arquivo ficava
-- órfão no bucket (5 órfãos em 22/09, de 3 tentativas em 2 processos).
--
-- Agora as duas tabelas guardam numero_processo (o que a tela já usa pra
-- consolidar as linhas) e não têm mais FK pro id. processo_id fica só como
-- registro de onde foi anexado. Processo excluído de vez deixa os anexos
-- (inofensivo; voltam se o número for recadastrado).
--
--   • jur_processo_pagamentos / jur_processo_vincular_despesa ganham
--     _numero (opcional): a tela manda o número, e o id vira fallback — o id
--     que a tela tem pode ter acabado de sumir num salvar.
--   • Trigger preenche numero_processo pelo processo_id quando o cliente
--     antigo (produção, até o rebuild) não mandar.
--   • Os 5 arquivos órfãos de 22/09 voltam a aparecer (identificados pelo
--     horário do upload × horário do salvar e pelo nome do reclamante no
--     arquivo). As pastas 1038 e 2869 têm os MESMOS dois PDFs (a pessoa
--     anexou de novo quando o primeiro sumiu): só os da 2869 são religados.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- 1) Coluna nova + backfill + sem FK pro id -------------------------------
ALTER TABLE public."JUR_PROCESSO_COMPROVANTE"   ADD COLUMN IF NOT EXISTS numero_processo text;
ALTER TABLE public."JUR_PROCESSO_MALOTE_VINCULO" ADD COLUMN IF NOT EXISTS numero_processo text;

UPDATE public."JUR_PROCESSO_COMPROVANTE" c SET numero_processo = p.numero_processo
  FROM public."JUR_PROCESSOS" p WHERE p.id = c.processo_id AND c.numero_processo IS NULL;
UPDATE public."JUR_PROCESSO_MALOTE_VINCULO" v SET numero_processo = p.numero_processo
  FROM public."JUR_PROCESSOS" p WHERE p.id = v.processo_id AND v.numero_processo IS NULL;

ALTER TABLE public."JUR_PROCESSO_COMPROVANTE"   DROP CONSTRAINT IF EXISTS "JUR_PROCESSO_COMPROVANTE_processo_id_fkey";
ALTER TABLE public."JUR_PROCESSO_MALOTE_VINCULO" DROP CONSTRAINT IF EXISTS "JUR_PROCESSO_MALOTE_VINCULO_processo_id_fkey";
ALTER TABLE public."JUR_PROCESSO_COMPROVANTE"   ALTER COLUMN processo_id DROP NOT NULL;
ALTER TABLE public."JUR_PROCESSO_MALOTE_VINCULO" ALTER COLUMN processo_id DROP NOT NULL;

-- Vínculo único por número (o antigo era por id da linha).
ALTER TABLE public."JUR_PROCESSO_MALOTE_VINCULO" DROP CONSTRAINT IF EXISTS "JUR_PROCESSO_MALOTE_VINCULO_processo_id_despesa_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS uq_jur_processo_malote_vinculo_numero ON public."JUR_PROCESSO_MALOTE_VINCULO" (numero_processo, despesa_id);
CREATE INDEX IF NOT EXISTS jur_processo_comprovante_numero_idx ON public."JUR_PROCESSO_COMPROVANTE" (numero_processo, id);

-- 2) Cliente antigo manda só processo_id: o trigger completa o número -------
CREATE OR REPLACE FUNCTION public.jur_processo_anexo_numero() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF nullif(btrim(coalesce(NEW.numero_processo, '')), '') IS NULL THEN
    SELECT numero_processo INTO NEW.numero_processo FROM public."JUR_PROCESSOS" WHERE id = NEW.processo_id;
  END IF;
  IF NEW.numero_processo IS NULL THEN
    RAISE EXCEPTION 'Processo não encontrado — feche e abra o processo de novo antes de anexar.';
  END IF;
  NEW.numero_processo := btrim(NEW.numero_processo);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_jur_processo_comprovante_numero ON public."JUR_PROCESSO_COMPROVANTE";
CREATE TRIGGER trg_jur_processo_comprovante_numero BEFORE INSERT ON public."JUR_PROCESSO_COMPROVANTE"
  FOR EACH ROW EXECUTE FUNCTION public.jur_processo_anexo_numero();
DROP TRIGGER IF EXISTS trg_jur_processo_malote_vinculo_numero ON public."JUR_PROCESSO_MALOTE_VINCULO";
CREATE TRIGGER trg_jur_processo_malote_vinculo_numero BEFORE INSERT ON public."JUR_PROCESSO_MALOTE_VINCULO"
  FOR EACH ROW EXECUTE FUNCTION public.jur_processo_anexo_numero();

ALTER TABLE public."JUR_PROCESSO_COMPROVANTE"   ALTER COLUMN numero_processo SET NOT NULL;
ALTER TABLE public."JUR_PROCESSO_MALOTE_VINCULO" ALTER COLUMN numero_processo SET NOT NULL;

-- 3) Lista e vínculo por número --------------------------------------------
DROP FUNCTION IF EXISTS public.jur_processo_pagamentos(bigint);
CREATE OR REPLACE FUNCTION public.jur_processo_pagamentos(_processo_id bigint DEFAULT NULL, _numero text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_num text := nullif(btrim(coalesce(_numero, '')), '');
  v_out jsonb;
BEGIN
  IF NOT has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos processos.';
  END IF;
  IF v_num IS NULL THEN
    SELECT numero_processo INTO v_num FROM public."JUR_PROCESSOS" WHERE id = _processo_id;
  END IF;
  IF v_num IS NULL THEN RAISE EXCEPTION 'Processo #% não existe.', _processo_id; END IF;

  WITH desp AS (
    SELECT d.*,
           CASE WHEN v.id IS NOT NULL THEN 'malote_manual' ELSE 'malote_auto' END AS origem_vinculo,
           v.id AS vinculo_id
      FROM public.malote_despesa d
      LEFT JOIN public."JUR_PROCESSO_MALOTE_VINCULO" v ON v.despesa_id = d.id AND v.numero_processo = v_num
     WHERE d.deleted_at IS NULL
       AND (v.id IS NOT NULL
            OR (v_num = ANY (
                 -- todo número CNJ que aparece no texto da despesa
                 ARRAY(SELECT m[1] FROM regexp_matches(
                    coalesce(d.nome, '') || ' ' || coalesce(d.descricao, '') || ' ' || coalesce(d.motivo, '') || ' ' || coalesce(d.observacao_pagamento, ''),
                    '(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})', 'g') AS m))))
  )
  SELECT jsonb_build_object(
    'numero_processo', v_num,
    'malote', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'despesa_id', d.id, 'numero', d.numero, 'nome', d.nome, 'status', d.status,
        'valor_total', d.valor_total, 'valor_aprovado', d.valor_aprovado,
        'data_pagamento', d.data_pagamento, 'pago_em', d.pago_em,
        'forma_pagamento', d.forma_pagamento,
        'comprovante_path', d.comprovante_pagamento_path,
        'observacao_pagamento', d.observacao_pagamento,
        'origem', d.origem_vinculo, 'vinculo_id', d.vinculo_id,
        'parcelas', coalesce((
          SELECT jsonb_agg(jsonb_build_object('numero_parcela', p.numero_parcela, 'valor', p.valor, 'data_vencimento', p.data_vencimento,
                                              'status', p.status, 'comprovante_path', p.comprovante_pagamento_path, 'pago_em', p.pago_em, 'data_pagamento_real', p.data_pagamento_real)
                           ORDER BY p.numero_parcela)
            FROM public.malote_despesa_parcela p WHERE p.despesa_id = d.id), '[]'::jsonb)
      ) ORDER BY coalesce(d.pago_em, d.data_pagamento::timestamptz, d.created_at) DESC)
      FROM desp d), '[]'::jsonb),
    'anexos', coalesce((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id DESC) FROM public."JUR_PROCESSO_COMPROVANTE" c
       WHERE c.numero_processo = v_num), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $fn$;
REVOKE ALL ON FUNCTION public.jur_processo_pagamentos(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_processo_pagamentos(bigint, text) TO authenticated;

DROP FUNCTION IF EXISTS public.jur_processo_vincular_despesa(bigint, text, text);
CREATE OR REPLACE FUNCTION public.jur_processo_vincular_despesa(
  _processo_id bigint DEFAULT NULL, _numero_despesa text DEFAULT NULL, _observacao text DEFAULT NULL, _numero text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_desp public.malote_despesa%ROWTYPE;
  v_nome text;
  v_num text := nullif(btrim(coalesce(_numero, '')), '');
BEGIN
  IF NOT has_screen_access(auth.uid(), 'processos', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso aos processos.';
  END IF;
  IF v_num IS NULL THEN
    SELECT numero_processo INTO v_num FROM public."JUR_PROCESSOS" WHERE id = _processo_id;
  END IF;
  IF v_num IS NULL THEN RAISE EXCEPTION 'Processo não encontrado — feche e abra o processo de novo.'; END IF;
  SELECT * INTO v_desp FROM public.malote_despesa WHERE upper(btrim(numero)) = upper(btrim(_numero_despesa)) AND deleted_at IS NULL;
  IF v_desp.id IS NULL THEN RAISE EXCEPTION 'Despesa % não encontrada no Malote.', _numero_despesa; END IF;
  SELECT coalesce(display_name, email) INTO v_nome FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public."JUR_PROCESSO_MALOTE_VINCULO" (processo_id, numero_processo, despesa_id, observacao, criado_por_nome)
  VALUES (_processo_id, v_num, v_desp.id, nullif(btrim(coalesce(_observacao, '')), ''), v_nome)
  ON CONFLICT (numero_processo, despesa_id) DO NOTHING;
  RETURN jsonb_build_object('despesa_id', v_desp.id, 'numero', v_desp.numero, 'nome', v_desp.nome, 'status', v_desp.status, 'tem_comprovante', v_desp.comprovante_pagamento_path IS NOT NULL);
END $fn$;
REVOKE ALL ON FUNCTION public.jur_processo_vincular_despesa(bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_processo_vincular_despesa(bigint, text, text, text) TO authenticated;

-- 4) Religa os órfãos de 22/09/2026 ----------------------------------------
INSERT INTO public."JUR_PROCESSO_COMPROVANTE"
  (processo_id, numero_processo, nome, storage_path, tipo, tamanho, descricao, criado_por, criado_por_nome, created_at)
SELECT NULL, x.numero, regexp_replace(split_part(o.name, '/', 2), '^\d+_', ''), o.name,
       o.metadata->>'mimetype', (o.metadata->>'size')::bigint,
       'Anexo recuperado (tinha sumido ao salvar o processo em 22/09/2026)',
       o.owner, (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = o.owner), o.created_at
  FROM storage.objects o
  JOIN (VALUES ('2830', '0020813-65.2026.5.04.0401'),
               ('2869', '0020769-21.2023.5.04.0023')) AS x(pasta, numero)
    ON split_part(o.name, '/', 1) = x.pasta
 WHERE o.bucket_id = 'juridico-comprovantes'
   AND EXISTS (SELECT 1 FROM public."JUR_PROCESSOS" p WHERE p.numero_processo = x.numero)
   AND NOT EXISTS (SELECT 1 FROM public."JUR_PROCESSO_COMPROVANTE" c WHERE c.storage_path = o.name);

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DELETE FROM public."JUR_PROCESSO_COMPROVANTE" WHERE descricao LIKE 'Anexo recuperado%';
-- DROP TRIGGER IF EXISTS trg_jur_processo_comprovante_numero ON public."JUR_PROCESSO_COMPROVANTE";
-- DROP TRIGGER IF EXISTS trg_jur_processo_malote_vinculo_numero ON public."JUR_PROCESSO_MALOTE_VINCULO";
-- DROP FUNCTION IF EXISTS public.jur_processo_anexo_numero();
-- DROP FUNCTION IF EXISTS public.jur_processo_pagamentos(bigint, text), public.jur_processo_vincular_despesa(bigint, text, text, text);
-- reaplicar as funções da 20260930000193; a FK processo_id → JUR_PROCESSOS(id) NÃO deve voltar (é o bug).
