-- =========================================================================
-- RH › Colaboradores: DEMITIDOS = demissão com data de afastamento no mês
-- RH › Ativos/Contratos: ATESTADO também é afastado (06/10/2026)
--
-- PEDIDO (Pablo):
--  1. "em Colaboradores os demitidos aparecem diferentes nos lugares, um tem
--     que estar correto: tem que pegar quantos demitidos tem pelo afastamento
--     da tabela EMPREGADOS, pela data do afastamento de demissão do mês".
--     SET/2026 mostrava "Desligados no mês" 119 e, em Por situação,
--     "Demitido" 123. Dois motivos:
--       · Por situação usava a situação DE HOJE de quem esteve no mês: os 4
--         demitidos em 01–06/10 trabalharam em setembro e já apareciam
--         como "Demitido" lá (119 + 4 = 123);
--       · a regra de saída (eh_saida) incluía "Aposentadoria", que na Senior
--         é afastamento, não demissão (13 pessoas ativas).
--     Agora: saída = Situação "Demitido" (DESLIG/RESCIS por garantia); e,
--     no quadro do mês, quem foi demitido DEPOIS do mês aparece como
--     "Trabalhando" naquele mês — então Demitido em Por situação = demissões
--     com Data Afastamento dentro do mês = card "Desligados no mês".
--     A lista (rh_colaboradores_lista) recebe a mesma regra, para o filtro
--     de situação e os números baterem.
--  2. "nos números em amarelo (afastados) do Ativos/Contratos deve aparecer
--     quem está de atestado também — atestado filho, atestado, qualquer
--     afastamento. Ex.: 318 trabalhando e 5 de atestado, os números têm que
--     bater". rh_ac_conta_no_posto passa a contar SÓ "Trabalhando".
--
-- As duas funções do Colaboradores têm a troca feita no corpo vigente
-- (replace), como em 20261006000007 — só os trechos da regra mudam.
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- =========================================================================

-- ── 1) Ativos/Contratos: só "Trabalhando" ocupa o posto ──────────────────
CREATE OR REPLACE FUNCTION public.rh_ac_conta_no_posto(_situacao text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 06/10/2026: atestado (dias, filho…) deixou de contar — é afastamento
  -- como auxílio-doença, licença e férias, e aparece na coluna Afastados.
  SELECT COALESCE(btrim(_situacao), '') = 'Trabalhando';
$function$;

-- ── 2) Colaboradores: demitido do mês ────────────────────────────────────
DO $$
DECLARE
  f text; v_def text; v_novo text;
  saida_velha constant text := $s$(btrim(coalesce(e."Situação", '')) ~* '(DEMIT|DESLIG|RESCIS|APOSENT)') AS eh_saida,$s$;
  saida_nova  constant text := $s$(btrim(coalesce(e."Situação", '')) ~* '^(DEMIT|DESLIG|RESCIS)') AS eh_saida,$s$;
  sit_velha   constant text := $s$btrim(coalesce(e."Situação", ''))                                 AS situacao,$s$;
  -- Demitido depois do mês olhado ainda trabalhava naquele mês.
  sit_nova    constant text := $s$CASE WHEN btrim(coalesce(e."Situação", '')) ~* '^(DEMIT|DESLIG|RESCIS)'
                AND public.rh_data(e."Data Afastamento"::text) > v_fim
           THEN 'Trabalhando' ELSE btrim(coalesce(e."Situação", '')) END AS situacao,$s$;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.rh_colaboradores_dashboard(integer,integer,text,text,text,text,text)',
    'public.rh_colaboradores_lista(integer,integer,text,text,text,text,integer,integer,text,text)'] LOOP
    v_def := pg_get_functiondef(f::regprocedure);
    IF v_def LIKE '%^(DEMIT|DESLIG|RESCIS)%' THEN CONTINUE; END IF;  -- já aplicado
    IF position(saida_velha IN v_def) = 0 OR position(sit_velha IN v_def) = 0 THEN
      RAISE EXCEPTION '% mudou: não achei os trechos de situação/saída.', f;
    END IF;
    v_novo := replace(replace(v_def, saida_velha, saida_nova), sit_velha, sit_nova);
    EXECUTE v_novo;
  END LOOP;
END $$;

-- A lista tinha um atalho: filtrando uma situação de saída (Demitido), ela
-- trazia TODO demitido da história (10.908), apesar do comentário dizer
-- "quem saiu no mês". Com a situação do mês acima, o recorte normal já
-- traz exatamente os demitidos com afastamento no mês — o atalho sai.
DO $$
DECLARE v_def text;
  velho constant text := $s$v_saida boolean := EXISTS (SELECT 1 FROM unnest(v_sits) s WHERE s ~* '(DEMIT|DESLIG|RESCIS|APOSENT)');$s$;
  novo  constant text := $s$v_saida boolean := false;  -- 06/10/2026 (mig 20261006000011): saída segue o mês como o resto.$s$;
BEGIN
  v_def := pg_get_functiondef('public.rh_colaboradores_lista(integer,integer,text,text,text,text,integer,integer,text,text)'::regprocedure);
  IF position(novo IN v_def) > 0 THEN RETURN; END IF;
  IF position(velho IN v_def) = 0 THEN RAISE EXCEPTION 'rh_colaboradores_lista mudou: não achei o v_saida.'; END IF;
  EXECUTE replace(v_def, velho, novo);
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- rh_ac_conta_no_posto: voltar a "= 'Trabalhando' OR ILIKE 'atestado%'" (mig 20261005000001).
-- rh_colaboradores_dashboard/lista: replace inverso dos dois trechos acima.
