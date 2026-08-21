-- =====================================================================
-- CANAL DE ÉTICA — alertas de prazo e de procedimento parado
--
-- O painel já CALCULAVA "fora do prazo", mas só via quem abrisse a tela.
-- Alerta que depende de alguém lembrar de olhar não é alerta.
--
-- Duas contagens diferentes, de propósito:
--   · PRAZO   — desde a abertura, pela gravidade (COMITE_ETICA_SLA). Responde
--               "este caso já demorou demais?".
--   · PARADO  — desde a última movimentação (qualquer mudança, mensagem,
--               providência ou anexo). Responde "ninguém toca nisto há quanto
--               tempo?". Um caso mexido ontem não é o mesmo que um esquecido
--               há um mês, e o SLA sozinho não separa os dois.
--
-- Idempotente.
-- =====================================================================

-- ── 1. Quantos dias sem movimentação já é "parado" ───────────────────
ALTER TABLE public."COMITE_ETICA_SLA"
  ADD COLUMN IF NOT EXISTS dias_sem_movimentacao integer NOT NULL DEFAULT 10;

COMMENT ON COLUMN public."COMITE_ETICA_SLA".dias_sem_movimentacao IS
  'Dias sem nenhuma movimentacao ate o procedimento ser sinalizado como parado. Por gravidade: critica nao espera o mesmo que baixa.';

UPDATE public."COMITE_ETICA_SLA" SET dias_sem_movimentacao =
  CASE gravidade WHEN 'critica' THEN 2 WHEN 'alta' THEN 5 WHEN 'media' THEN 10 ELSE 15 END
 WHERE dias_sem_movimentacao = 10;

-- ── 2. O alerta ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_ALERTA" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id  uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  tipo         text NOT NULL
               CHECK (tipo IN ('prazo_vencido','primeira_providencia','parado','providencia_vencida')),
  mensagem     text NOT NULL,
  -- Dia da apuração do alerta. Faz parte da chave única: o tick roda todo dia
  -- e não pode empilhar o mesmo aviso; mas se o caso continuar parado amanhã,
  -- um aviso novo é legítimo.
  referencia   date NOT NULL DEFAULT current_date,
  resolvido_em timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (denuncia_id, tipo, referencia)
);

CREATE INDEX IF NOT EXISTS idx_canal_alerta_abertos
  ON public."CANAL_DENUNCIA_ALERTA"(created_at DESC) WHERE resolvido_em IS NULL;

ALTER TABLE public."CANAL_DENUNCIA_ALERTA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_ALERTA" FROM anon;
GRANT SELECT, UPDATE ON TABLE public."CANAL_DENUNCIA_ALERTA" TO authenticated;

DROP POLICY IF EXISTS canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- Dar baixa no aviso é permitido; criar, não — quem cria é o tick.
DROP POLICY IF EXISTS canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- ── 3. Quem apura os alertas ─────────────────────────────────────────
-- Roda como definer e é chamada pela edge function com service_role. A conta
-- inteira é feita aqui, no banco, para não trafegar o cadastro de denúncias
-- para dentro da função só para comparar datas.
CREATE OR REPLACE FUNCTION public.comite_etica_apurar_alertas()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_novos    integer := 0;
  v_fechados integer := 0;
  -- GET DIAGNOSTICS so ATRIBUI: "v_novos = v_novos + ROW_COUNT" e erro de
  -- sintaxe. O acumulado passa por uma variavel de apoio.
  v_parcial  integer := 0;
BEGIN
  -- 3.1 Prazo total estourado.
  WITH base AS (
    SELECT d.id, d.protocolo,
           COALESCE(d.sla_dias_override, s.dias, 30) AS dias
      FROM public."CANAL_DENUNCIA" d
      LEFT JOIN public."COMITE_ETICA_SLA" s ON s.gravidade = d.gravidade
     WHERE d.status NOT IN ('concluida','arquivada')
  )
  INSERT INTO public."CANAL_DENUNCIA_ALERTA"(denuncia_id, tipo, mensagem)
  SELECT b.id, 'prazo_vencido',
         'Prazo de ' || b.dias || ' dias estourado — ' || b.protocolo
    FROM base b
    JOIN public."CANAL_DENUNCIA" d ON d.id = b.id
   WHERE d.created_at + (b.dias || ' days')::interval < now()
  ON CONFLICT (denuncia_id, tipo, referencia) DO NOTHING;
  GET DIAGNOSTICS v_novos = ROW_COUNT;

  -- 3.2 Primeira providência não registrada dentro do prazo da gravidade.
  INSERT INTO public."CANAL_DENUNCIA_ALERTA"(denuncia_id, tipo, mensagem)
  SELECT d.id, 'primeira_providencia',
         'Sem primeira providência registrada — ' || d.protocolo
    FROM public."CANAL_DENUNCIA" d
    LEFT JOIN public."COMITE_ETICA_SLA" s ON s.gravidade = d.gravidade
   WHERE d.status NOT IN ('concluida','arquivada')
     AND d.primeira_providencia_em IS NULL
     AND d.created_at + (COALESCE(s.dias_primeira_providencia, 3) || ' days')::interval < now()
  ON CONFLICT (denuncia_id, tipo, referencia) DO NOTHING;
  GET DIAGNOSTICS v_parcial = ROW_COUNT;
  v_novos := v_novos + v_parcial;

  -- 3.3 Parado: ninguém encostou no procedimento.
  INSERT INTO public."CANAL_DENUNCIA_ALERTA"(denuncia_id, tipo, mensagem)
  SELECT d.id, 'parado',
         'Sem movimentação há ' ||
         floor(extract(epoch FROM (now() - d.ultima_movimentacao_em)) / 86400)::int ||
         ' dias — ' || d.protocolo
    FROM public."CANAL_DENUNCIA" d
    LEFT JOIN public."COMITE_ETICA_SLA" s ON s.gravidade = d.gravidade
   WHERE d.status NOT IN ('concluida','arquivada')
     AND d.ultima_movimentacao_em + (COALESCE(s.dias_sem_movimentacao, 10) || ' days')::interval < now()
  ON CONFLICT (denuncia_id, tipo, referencia) DO NOTHING;
  GET DIAGNOSTICS v_parcial = ROW_COUNT;
  v_novos := v_novos + v_parcial;

  -- 3.4 Providência com prazo vencido.
  INSERT INTO public."CANAL_DENUNCIA_ALERTA"(denuncia_id, tipo, mensagem)
  SELECT p.denuncia_id, 'providencia_vencida',
         'Providência vencida em ' || to_char(p.prazo, 'DD/MM/YYYY') || ': ' || left(p.descricao, 80)
    FROM public."CANAL_DENUNCIA_PROVIDENCIA" p
   WHERE p.situacao IN ('pendente','em_andamento')
     AND p.prazo IS NOT NULL AND p.prazo < current_date
  ON CONFLICT (denuncia_id, tipo, referencia) DO NOTHING;
  GET DIAGNOSTICS v_parcial = ROW_COUNT;
  v_novos := v_novos + v_parcial;

  -- 3.5 Baixa automática: caso encerrado não deixa alerta aberto atrás de si.
  UPDATE public."CANAL_DENUNCIA_ALERTA" a
     SET resolvido_em = now()
    FROM public."CANAL_DENUNCIA" d
   WHERE d.id = a.denuncia_id
     AND a.resolvido_em IS NULL
     AND d.status IN ('concluida','arquivada');
  GET DIAGNOSTICS v_fechados = ROW_COUNT;

  RETURN jsonb_build_object('novos', v_novos, 'fechados', v_fechados);
END $$;

REVOKE ALL ON FUNCTION public.comite_etica_apurar_alertas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comite_etica_apurar_alertas() TO service_role;

-- A edge function de anexos precisa conferir credencial com service_role.
GRANT EXECUTE ON FUNCTION public.denuncia_autenticar(text, text) TO service_role;

-- ── 4. O relógio ─────────────────────────────────────────────────────
-- Mesmo padrão dos outros ticks (ver 20260730000001): o cron chama a edge
-- function, que roda com service_role. UPDATE direto pelo cron não funciona
-- aqui — não existe auth.uid() dentro do cron, e a RLS filtraria tudo.
DO $$
BEGIN
  PERFORM cron.unschedule('comite-etica-alertas');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'comite-etica-alertas',
  '0 8 * * 1-5',   -- dias úteis, 8h (05h UTC-3 = 08h no servidor UTC)
  $$
  SELECT net.http_post(
    url := 'https://fwmzeaztjxrxxzxzxmgc.supabase.co/functions/v1/comite-etica-alertas-tick',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI"}'::jsonb,
    body := jsonb_build_object('tick_at', now())
  );
  $$
);

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   SELECT cron.unschedule('comite-etica-alertas');
--   DROP FUNCTION IF EXISTS public.comite_etica_apurar_alertas();
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_ALERTA";
--   ALTER TABLE public."COMITE_ETICA_SLA" DROP COLUMN dias_sem_movimentacao;
-- =====================================================================
