-- =========================================================================
-- TVs GERENCIAIS: "DE ONDE VEM ESTE NÚMERO?" PARA A I.A (14/10/2026)
--
-- PEDIDO (Pablo, na prévia "Ver como na TV"): "preciso que ao clicar com o
-- mouse em cima de cada um uma I.A diga da onde vem cada informação, e
-- consiga perguntar mais coisas".
--
-- tvg_fonte(codigo) entrega à Edge tvg-ia o que ela precisa para explicar
-- sem inventar: a regra escrita do indicador, a fonte (calculado / espelho /
-- soma), e o TRECHO DE SQL que calcula o número — recortado da própria
-- tvg_calc / tvg_calc_extra (o código em produção, não uma descrição à mão
-- que envelhece). Espelho segue para o original; soma lista os componentes.
-- Portão: o mesmo de tvg_painel (tvs_gerenciais ou sistemas_tvs).
--
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

-- O bloco IF/ELSIF da função que trata o código (o primeiro que o cita entre aspas).
CREATE OR REPLACE FUNCTION public.tvg_trecho_calculo(p_funcao text, p_codigo text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  src text; partes text[]; p text; achado text := '';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
   WHERE p.proname = p_funcao AND p.pronamespace = 'public'::regnamespace LIMIT 1;
  IF src IS NULL THEN RETURN NULL; END IF;
  -- Cada ramo começa em "IF p_codigo" ou "ELSIF p_codigo".
  partes := regexp_split_to_array(src, E'\\n\\s*(?=(ELS)?IF p_codigo )');
  -- Junta todos os ramos que citam o código: o bloco de fora (que prepara
  -- variáveis, ex. a competência do DRE) e o de dentro (que faz a conta).
  FOREACH p IN ARRAY partes LOOP
    IF split_part(p, E'\n', 1) ~ ('''' || p_codigo || '''') THEN
      achado := achado || E'\n' || p;
    END IF;
  END LOOP;
  RETURN nullif(left(btrim(achado), 7000), '');
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_trecho_calculo(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tvg_fonte(p_codigo text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  i public."TVG_INDICADOR"; alvo text; trecho text; ajudantes jsonb := '[]'::jsonb; h text;
BEGIN
  IF NOT (public.has_screen_access(auth.uid(), 'tvs_gerenciais', 'visualizar') OR public.has_screen_access(auth.uid(), 'sistemas_tvs', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem acesso aos Indicadores gerenciais das TVs.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO i FROM public."TVG_INDICADOR" WHERE codigo = p_codigo;
  IF NOT FOUND THEN RETURN NULL; END IF;

  alvo := CASE WHEN i.fonte = 'espelho' THEN i.espelho_de ELSE i.codigo END;
  trecho := coalesce(public.tvg_trecho_calculo('tvg_calc', alvo), public.tvg_trecho_calculo('tvg_calc_extra', alvo));

  -- Funções de apoio que o trecho usa: vão junto, para a I.A dizer a tabela real.
  FOREACH h IN ARRAY ARRAY['tvg_quadro_contratos', 'tvg_dre_contratos', 'tvg_dre_competencia', 'dir_turnover_painel_dados'] LOOP
    IF trecho ~ h THEN
      ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', h, 'definicao',
        left((SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = h AND p.pronamespace = 'public'::regnamespace LIMIT 1), 2500)));
    END IF;
  END LOOP;
  IF trecho ~ 'tvg_dre_contratos' THEN
    ajudantes := ajudantes || jsonb_build_array(jsonb_build_object('funcao', 'tvg_dre_mv',
      'definicao', 'Visão materializada (cache, atualizada a cada 6 h) que soma mz_60_view_dre_gerencial_competencia — o DRE gerencial carregado na migração contábil — por competência e contrato: RECEITA, CUSTO e DESPESA.'));
  END IF;

  RETURN jsonb_build_object(
    'codigo', i.codigo, 'nome', i.nome, 'painel', i.painel, 'fonte', i.fonte, 'regra', i.regra, 'identificar', i.identificar,
    'unidade', i.unidade, 'sentido', i.sentido, 'meta', i.meta, 'alerta', i.alerta, 'parametro', i.parametro,
    'parametro_rotulo', i.parametro_rotulo, 'responsavel', i.responsavel,
    'espelho_de', i.espelho_de,
    'espelho_regra', (SELECT o.regra FROM public."TVG_INDICADOR" o WHERE o.codigo = i.espelho_de),
    'componentes', (SELECT jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nome', c.nome, 'regra', c.regra))
                      FROM public."TVG_INDICADOR" c WHERE c.codigo = ANY (coalesce(i.componentes, ARRAY[]::text[]))),
    'calculo_sql', trecho,
    'funcoes_de_apoio', ajudantes);
END $fn$;
REVOKE ALL ON FUNCTION public.tvg_fonte(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tvg_fonte(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tvg_fonte(text);
-- DROP FUNCTION IF EXISTS public.tvg_trecho_calculo(text, text);
