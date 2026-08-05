-- =====================================================================
-- WHATSAPP — pasta "Atendimento Concluído" + Dashboard do chatbot
--
-- 1) A pasta é criada direto (e não por wa_pasta_criar): aquela RPC exige
--    has_role(auth.uid(),'admin') e no SQL Editor auth.uid() é NULL, então
--    ela sempre falharia aqui. O efeito é o mesmo: pasta + menu que a governa.
--
-- 2) WA_CONVERSA.concluida_em: sem um marco de "terminou", não existe tempo
--    de atendimento para medir. Preenchido por trigger quando a conversa cai
--    na pasta de concluídos, e zerado se ela sair de lá (reabertura) — assim
--    o número não depende de ninguém lembrar de marcar nada.
--
-- 3) wa_dashboard_metricas(): tudo agregado no banco numa chamada só. Fazer
--    isso no front exigiria baixar a tabela inteira de mensagens.
--
-- Idempotente.
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.wa_dashboard_metricas(date, date);
--   DROP TRIGGER IF EXISTS trg_wa_conversa_concluida ON public."WA_CONVERSA";
--   DROP FUNCTION IF EXISTS public.wa_marca_conclusao();
--   ALTER TABLE public."WA_CONVERSA" DROP COLUMN IF EXISTS concluida_em;
--   (a pasta sai por Chatbot › Pastas de atendimento)
-- =====================================================================

-- 1) Pasta de concluídos + permissão -------------------------------------
INSERT INTO public."WA_PASTA" (codigo, nome, menu_codigo, ordem)
SELECT 'atendimento_concluido', 'Atendimento Concluído',
       'whatsapp_pasta_atendimento_concluido',
       coalesce((SELECT max(ordem) FROM public."WA_PASTA"), 15) + 1
WHERE NOT EXISTS (SELECT 1 FROM public."WA_PASTA" WHERE codigo = 'atendimento_concluido');

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'whatsapp_pasta_atendimento_concluido',
       'WhatsApp — Pasta Atendimento Concluído', NULL,
       coalesce((SELECT max(ordem) FROM public."WA_PASTA"), 16)
  FROM public.app_modulo m WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Menu da tela nova de dashboard.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'whatsapp_dashboard', 'WhatsApp — Dashboard',
       '/app/whatsapp/dashboard', 5
  FROM public.app_modulo m WHERE m.codigo = 'whatsapp'
ON CONFLICT (modulo_id, codigo) DO UPDATE
   SET rota = EXCLUDED.rota, nome = EXCLUDED.nome;

-- 2) Marco de conclusão ---------------------------------------------------
ALTER TABLE public."WA_CONVERSA"
  ADD COLUMN IF NOT EXISTS concluida_em timestamptz;

CREATE OR REPLACE FUNCTION public.wa_marca_conclusao()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.pasta_codigo IS DISTINCT FROM OLD.pasta_codigo THEN
    IF NEW.pasta_codigo = 'atendimento_concluido' THEN
      NEW.concluida_em := coalesce(NEW.concluida_em, now());
    ELSE
      -- Saiu dos concluídos: voltou a ser atendimento aberto.
      NEW.concluida_em := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_conversa_concluida ON public."WA_CONVERSA";
CREATE TRIGGER trg_wa_conversa_concluida
  BEFORE UPDATE ON public."WA_CONVERSA"
  FOR EACH ROW EXECUTE FUNCTION public.wa_marca_conclusao();

-- 3) Métricas -------------------------------------------------------------
-- SECURITY DEFINER porque agrega TODAS as conversas: a RLS por pasta faria o
-- número mudar conforme quem olha, e um indicador que muda por espectador não
-- serve para nada. O acesso é decidido pelo menu do dashboard.
CREATE OR REPLACE FUNCTION public.wa_dashboard_metricas(_de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_de  timestamptz := coalesce(_de, (now() - interval '30 days')::date);
  v_ate timestamptz := coalesce(_ate::timestamptz + interval '1 day', now() + interval '1 day');
  v_res jsonb;
BEGIN
  IF NOT public.tem_acesso_menu('whatsapp_dashboard') AND NOT public.tem_acesso_menu('whatsapp') THEN
    RAISE EXCEPTION 'Sem acesso ao dashboard do WhatsApp.';
  END IF;

  WITH msg AS (
    SELECT * FROM public."WA_MENSAGEM" WHERE criada_em >= v_de AND criada_em < v_ate
  ),
  -- Primeira mensagem do contato e primeira resposta nossa, por conversa.
  ciclo AS (
    SELECT c.id, c.pasta_codigo, c.concluida_em,
           (SELECT min(m.criada_em) FROM msg m WHERE m.conversa_id = c.id AND m.direcao = 'entrada') AS inicio,
           (SELECT min(m.criada_em) FROM msg m WHERE m.conversa_id = c.id AND m.direcao = 'saida'
              AND m.origem = 'atendente') AS primeira_humana
      FROM public."WA_CONVERSA" c
     WHERE EXISTS (SELECT 1 FROM msg m WHERE m.conversa_id = c.id)
  )
  SELECT jsonb_build_object(
    'pessoas',           (SELECT count(DISTINCT contato_id) FROM msg WHERE direcao = 'entrada'),
    'conversas',         (SELECT count(*) FROM ciclo),
    'concluidas',        (SELECT count(*) FROM ciclo WHERE concluida_em IS NOT NULL),
    'recebidas',         (SELECT count(*) FROM msg WHERE direcao = 'entrada'),
    'enviadas_bot',      (SELECT count(*) FROM msg WHERE direcao = 'saida' AND origem = 'bot'),
    'enviadas_humano',   (SELECT count(*) FROM msg WHERE direcao = 'saida' AND origem = 'atendente'),
    'falhas',            (SELECT count(*) FROM msg WHERE status = 'erro'),
    -- Minutos entre a primeira mensagem da pessoa e a conclusão.
    'tempo_medio_min',   (SELECT round(avg(EXTRACT(epoch FROM (concluida_em - inicio)) / 60)::numeric, 1)
                            FROM ciclo WHERE concluida_em IS NOT NULL AND inicio IS NOT NULL
                                         AND concluida_em > inicio),
    -- Quanto a pessoa espera até um humano falar (o bot responde na hora).
    'primeira_resposta_min', (SELECT round(avg(EXTRACT(epoch FROM (primeira_humana - inicio)) / 60)::numeric, 1)
                            FROM ciclo WHERE primeira_humana IS NOT NULL AND inicio IS NOT NULL
                                         AND primeira_humana > inicio),
    'atendidas_por_humano', (SELECT count(*) FROM ciclo WHERE primeira_humana IS NOT NULL),
    'por_pasta', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'nome')
        FROM (
          SELECT jsonb_build_object(
                   'codigo', coalesce(ci.pasta_codigo, '(sem pasta)'),
                   'nome',   coalesce(p.nome, 'Sem pasta — triagem'),
                   'conversas', count(*),
                   'concluidas', count(*) FILTER (WHERE ci.concluida_em IS NOT NULL),
                   'tempo_medio_min', round(avg(EXTRACT(epoch FROM (ci.concluida_em - ci.inicio)) / 60)
                                            FILTER (WHERE ci.concluida_em IS NOT NULL AND ci.inicio IS NOT NULL)::numeric, 1)
                 ) AS x
            FROM ciclo ci
            LEFT JOIN public."WA_PASTA" p ON p.codigo = ci.pasta_codigo
           GROUP BY ci.pasta_codigo, p.nome
        ) t), '[]'::jsonb),
    'por_dia', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'dia')
        FROM (
          SELECT jsonb_build_object(
                   'dia', to_char(date_trunc('day', criada_em), 'YYYY-MM-DD'),
                   'recebidas', count(*) FILTER (WHERE direcao = 'entrada'),
                   'enviadas',  count(*) FILTER (WHERE direcao = 'saida')
                 ) AS x
            FROM msg GROUP BY date_trunc('day', criada_em)
        ) t), '[]'::jsonb),
    'por_hora', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'hora')::int)
        FROM (
          SELECT jsonb_build_object(
                   'hora', EXTRACT(hour FROM criada_em)::int,
                   'mensagens', count(*)
                 ) AS x
            FROM msg WHERE direcao = 'entrada'
           GROUP BY EXTRACT(hour FROM criada_em)
        ) t), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_dashboard_metricas(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wa_dashboard_metricas(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.wa_dashboard_metricas(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
