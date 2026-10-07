-- =========================================================================
-- SISTEMAS › TV's — relatórios na TV e link fixo (07/10/2026)
--
-- PEDIDO (Pablo): "precisa ser algo bem completo, mais forte: elas ficam
-- desligando, e ao ligar, só de abrir o navegador já teria que conectar
-- automaticamente, nem que seja necessário baixar algo. E em cada TV tem que
-- ser possível selecionar qual relatório vai passar, compatível com TV —
-- tela cheia, sem precisar mexer nem descer."
--
-- O QUE MUDA (em cima da mig 20261007000012)
--   · LINK FIXO: tv_gerar_link(tv) cria uma CHAVE curta (12 caracteres, sem
--     letras que se confundem) para <app>/tv/<chave>. É o endereço que fica
--     como página inicial do navegador / app de quiosque da TV: ao ligar, a
--     TV já entra conectada, mesmo que o navegador tenha apagado os dados.
--     Gerar de novo troca a chave (a anterior para de funcionar). Vai para o
--     mesmo token_hash: a chave É o token do aparelho.
--   · RELATÓRIO como item de playlist: tipo 'relatorio' + relatorio (slug:
--     geral, recrutamento, demissoes, materiais, ferias, medida-disciplinar,
--     chamados, orientacoes, mudanca-funcao, colaboradores, turnover),
--     rel_periodo (mes, 3m, 6m, 12m, ano) e rel_contrato (opcional).
--   · tv_relatorio(token, item): a TV busca os números do relatório daquele
--     item — só se o item é de um relatório, está ativo e é da playlist DELA.
--     Usa dir_rel_dados (mig 20261007000013), a mesma conta da tela.
--     "geral" devolve o resumo dos 8 sistemas de solicitação.
-- Idempotente. Aplicar no banco do app — não se auto-aplica.
-- =========================================================================

ALTER TABLE public."TV_ITEM" ADD COLUMN IF NOT EXISTS relatorio text;
ALTER TABLE public."TV_ITEM" ADD COLUMN IF NOT EXISTS rel_periodo text;
ALTER TABLE public."TV_ITEM" ADD COLUMN IF NOT EXISTS rel_contrato uuid;
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS "TV_ITEM_tipo_check";
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT "TV_ITEM_tipo_check"
  CHECK (tipo IN ('imagem', 'video', 'url', 'youtube', 'aviso', 'relatorio'));
ALTER TABLE public."TV_ITEM" DROP CONSTRAINT IF EXISTS tv_item_relatorio_check;
ALTER TABLE public."TV_ITEM" ADD CONSTRAINT tv_item_relatorio_check CHECK (
  tipo <> 'relatorio' OR (
    relatorio IN ('geral', 'recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'chamados',
                  'orientacoes', 'mudanca-funcao', 'colaboradores', 'turnover')
    AND COALESCE(rel_periodo, '12m') IN ('mes', '3m', '6m', '12m', 'ano')));

-- ── tv_estado devolve também os campos de relatório ──────────────────────
CREATE OR REPLACE FUNCTION public.tv_estado(p_token text, p_tela text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE d public."TV_DISPOSITIVO"; v_cmd text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('desconhecida', true); END IF;

  v_cmd := CASE WHEN d.comando IS NOT NULL AND d.comando_em > now() - interval '10 minutes' THEN d.comando END;
  UPDATE public."TV_DISPOSITIVO"
     SET ultimo_ping = now(), tela = coalesce(left(p_tela, 30), tela), comando = NULL, comando_em = NULL
   WHERE id = d.id;

  IF d.pareado_em IS NULL THEN
    RETURN jsonb_build_object('pareada', false, 'codigo', d.codigo);
  END IF;

  RETURN jsonb_build_object(
    'pareada', true, 'nome', d.nome, 'local', d.local, 'ativa', d.ativo, 'comando', v_cmd,
    'itens', CASE WHEN NOT d.ativo THEN '[]'::jsonb ELSE (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'titulo', i.titulo, 'url', i.url, 'arquivo', i.arquivo,
                                                   'texto', i.texto, 'cor', i.cor, 'duracao_seg', i.duracao_seg,
                                                   'relatorio', i.relatorio, 'rel_periodo', i.rel_periodo) ORDER BY i.ordem, i.created_at), '[]'::jsonb)
        FROM public."TV_ITEM" i
       WHERE i.playlist_id = d.playlist_id AND i.ativo
         AND (i.valido_de IS NULL OR i.valido_de <= now()) AND (i.valido_ate IS NULL OR i.valido_ate > now())) END,
    'alerta', (SELECT jsonb_build_object('id', a.id, 'texto', a.texto, 'cor', a.cor, 'fim', a.fim)
                 FROM public."TV_ALERTA" a
                WHERE a.encerrado_em IS NULL AND a.inicio <= now() AND a.fim > now()
                  AND (a.todas OR d.id = ANY (a.dispositivos))
                ORDER BY a.created_at DESC LIMIT 1));
END $$;

-- ── Período do item de relatório ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tv_rel_periodo(_p text, OUT de date, OUT ate date)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE COALESCE(_p, '12m')
           WHEN 'mes' THEN date_trunc('month', current_date)::date
           WHEN 'ano' THEN date_trunc('year', current_date)::date
           WHEN '3m'  THEN (date_trunc('month', current_date) - interval '2 months')::date
           WHEN '6m'  THEN (date_trunc('month', current_date) - interval '5 months')::date
           ELSE (date_trunc('month', current_date) - interval '11 months')::date END,
         current_date
$$;

-- ── A TV busca o relatório de um item da playlist dela ───────────────────
CREATE OR REPLACE FUNCTION public.tv_relatorio(p_token text, p_item uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE d public."TV_DISPOSITIVO"; i public."TV_ITEM"; v_de date; v_ate date; v_out jsonb; s text;
BEGIN
  SELECT * INTO d FROM public."TV_DISPOSITIVO"
   WHERE token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') AND pareado_em IS NOT NULL AND ativo;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não autorizada.'; END IF;
  SELECT * INTO i FROM public."TV_ITEM" WHERE id = p_item AND playlist_id = d.playlist_id AND ativo AND tipo = 'relatorio';
  IF NOT FOUND THEN RAISE EXCEPTION 'Relatório não está na playlist desta TV.'; END IF;

  SELECT p.de, p.ate INTO v_de, v_ate FROM public.tv_rel_periodo(i.rel_periodo) p;

  IF i.relatorio = 'geral' THEN
    v_out := jsonb_build_object('tipo', 'geral', 'periodo', jsonb_build_object('de', v_de, 'ate', v_ate), 'sistemas', '[]'::jsonb);
    FOREACH s IN ARRAY ARRAY['recrutamento', 'demissoes', 'materiais', 'ferias', 'medida-disciplinar', 'mudanca-funcao', 'chamados', 'orientacoes'] LOOP
      v_out := jsonb_set(v_out, '{sistemas}', (v_out->'sistemas') || jsonb_build_array(
        (SELECT jsonb_build_object('slug', s, 'titulo', r->>'titulo', 'kpis', r->'kpis', 'rotulo_item', r->>'rotulo_item',
                                   'mensal', r->'mensal')
           FROM (SELECT public.dir_rel_dados(s, v_de, v_ate, i.rel_contrato, NULL) r) x)));
    END LOOP;
  ELSE
    v_out := jsonb_build_object('tipo', 'sistema', 'slug', i.relatorio) || public.dir_rel_dados(i.relatorio, v_de, v_ate, i.rel_contrato, NULL);
  END IF;

  RETURN v_out || jsonb_build_object('contrato', (SELECT c.nome FROM public.contratos c WHERE c.id = i.rel_contrato), 'gerado_em', now());
END $$;

-- ── Link fixo: chave curta, fácil de digitar no controle da TV ───────────
CREATE OR REPLACE FUNCTION public.tv_gerar_link(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_alfa constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 símbolos, sem 0/O/1/I
  v_bytes bytea := gen_random_bytes(12);
  v_chave text := '';
  k int;
BEGIN
  IF NOT public.has_screen_access(auth.uid(), 'sistemas_tvs', 'alterar') THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  FOR k IN 0..11 LOOP
    v_chave := v_chave || substr(v_alfa, (get_byte(v_bytes, k) % 32) + 1, 1);
  END LOOP;
  UPDATE public."TV_DISPOSITIVO" SET token_hash = encode(digest(v_chave, 'sha256'), 'hex')
   WHERE id = p_id AND pareado_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV não encontrada.'; END IF;
  RETURN v_chave;
END $$;

REVOKE ALL ON FUNCTION public.tv_relatorio(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv_gerar_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tv_rel_periodo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_relatorio(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_gerar_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tv_rel_periodo(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP FUNCTION IF EXISTS public.tv_relatorio(text, uuid), public.tv_gerar_link(uuid), public.tv_rel_periodo(text);
-- tv_estado: reaplicar a da mig 20261007000012.
-- DELETE FROM "TV_ITEM" WHERE tipo = 'relatorio'; e o CHECK de tipo sem 'relatorio'.
-- ALTER TABLE "TV_ITEM" DROP COLUMN relatorio, DROP COLUMN rel_periodo, DROP COLUMN rel_contrato;
