-- =========================================================================
-- RH — situação com código novo na Senior não congela mais a antiga
--
-- 12/11/2026, caso FABIANA ROSA FREITAS (HAGG, cadastro 2174, filial 1097
-- ROSARIO DO SUL): no HCM da Senior ela está com a Situação 079 "Pedido
-- Rescisão Indireta" (afastamento 01/11/2026), mas em Diretoria Operacional ›
-- Colaboradores a situação não existe — nem no card "Por situação", nem na
-- linha dela.
--
-- Por quê: o sync (rh_sync_senior_pelo_espelho, pg_cron de 15 em 15 min)
-- monta a descrição com LEFT JOIN espelho."BiSituacoes" ON código = sitafa.
-- Código que a Senior acabou de criar e que ainda não está na BiSituacoes
-- (a camada Bi* é alimentada à parte, não é a R010SIT nativa) vem com
-- descrição NULL, e rh_sync_senior_empregados (mig 20260930000275) grava
--     "Situação"     = coalesce(r.situacao, x."Situação")      -- a ANTIGA
--     "Cod Situacao" = coalesce(r.cod_situacao, x."Cod Situacao") -- a nova
-- Ou seja: o código vira 79, o texto continua "Trabalhando", sem erro nenhum.
-- Todas as telas leem o TEXTO ("Situação"), então a pessoa some da situação
-- certa e conta como trabalhando. A mig 20260906000010 já previa "código novo
-- que o Senior criasse antes de a dimensão ser replicada" — só pensou na FK,
-- não no texto.
--
-- Correção (na causa, não na tela):
--   1. A descrição passa a ter recaída: BiSituacoes → public."SITUACOES"
--      (o que já foi replicado ou cadastrado aqui) → "Situação 079" (o código
--      aparece na tela em vez de mentir "Trabalhando"; quando a BiSituacoes
--      trouxer o nome, a rodada seguinte troca sozinha).
--   2. O 079 entra em SITUACOES com o nome do HCM (ON CONFLICT DO NOTHING: se
--      a réplica já trouxe, fica o da réplica; se trouxer depois, o upsert de
--      rh_sync_senior_situacoes sobrescreve).
-- Quem estava congelado se corrige na próxima rodada do cron: a descrição
-- passa a diferir da gravada e o UPDATE normal reescreve "Situação".
--
-- O patch é por TRECHO (pg_get_functiondef + replace), como a mig
-- 20261006000011: não reescreve a função inteira (insalubridade, escala e o
-- que mais tenha entrado nela continuam). Se o trecho não estiver lá, para
-- com erro em vez de passar calado. Idempotente.
--
-- ROLLBACK:
--   (reaplicar a função de 20261026000900_rh_insalubridade_e_ficha_completa_senior.sql)
--   DELETE FROM public."SITUACOES" WHERE codigo = 79 AND tipo IS NULL;  -- só se veio daqui
-- =========================================================================

-- ── 1) O código que motivou: 079 Pedido Rescisão Indireta ────────────────
INSERT INTO public."SITUACOES" (codigo, descricao, atualizado_em)
VALUES (79, 'Pedido Rescisão Indireta', now())
ON CONFLICT (codigo) DO NOTHING;

-- ── 2) Descrição com recaída no sync ────────────────────────────────────
DO $$
DECLARE
  f     constant text := 'public.rh_sync_senior_pelo_espelho()';
  velho constant text := $s$'situacao', nullif(btrim(coalesce(s.descricao, '')), ''),$s$;
  novo  constant text := $s$'situacao', coalesce(
                nullif(btrim(coalesce(s.descricao, '')), ''),
                (SELECT nullif(btrim(d.descricao), '') FROM public."SITUACOES" d WHERE d.codigo = b.sitafa),
                CASE WHEN b.sitafa IS NOT NULL THEN 'Situação ' || lpad(b.sitafa::text, 3, '0') END),$s$;
  v_def text;
BEGIN
  IF to_regprocedure(f) IS NULL THEN
    RAISE NOTICE '% não existe neste banco: nada a fazer.', f;
    RETURN;
  END IF;
  v_def := pg_get_functiondef(to_regprocedure(f));
  IF position('public."SITUACOES" d WHERE d.codigo = b.sitafa' IN v_def) > 0 THEN
    RETURN;  -- já aplicado
  END IF;
  IF position(velho IN v_def) = 0 THEN
    -- NOTICE, não EXCEPTION (guardião M6): abortar aqui deixaria a migration
    -- pendente e pararia a fila do time. Sem o trecho, não mexe na função.
    RAISE WARNING '% mudou: não achei o trecho da descrição da situação — função NÃO alterada.', f;
    RETURN;
  END IF;
  EXECUTE replace(v_def, velho, novo);
END $$;

REVOKE ALL ON FUNCTION public.rh_sync_senior_pelo_espelho() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rh_sync_senior_pelo_espelho() TO service_role;

NOTIFY pgrst, 'reload schema';
