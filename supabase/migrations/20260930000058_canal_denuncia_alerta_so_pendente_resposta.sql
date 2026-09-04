-- =====================================================================
-- CANAL DE ÉTICA — o aviso passa a ser "pendente de resposta", só
--
-- O tick de 20260914000004 acendia quatro avisos, e dois deles alertavam
-- AUSÊNCIA de movimento: 'primeira_providencia' (ninguém registrou a
-- primeira providência) e 'parado' (ninguém encostou no caso há N dias).
-- Na prática viraram ruído — a tela abria com "2 alertas em aberto" sobre
-- um caso que ninguém precisava tocar naquele dia, e alerta que toca
-- sozinho todo dia deixa de ser lido. Se ninguém mexeu e ninguém está
-- esperando, está tudo certo; o painel já mostra "Sem movimentação" como
-- indicador, que é o lugar dessa informação.
--
-- Fica o que significa alguém esperando:
--   · prazo_vencido        — o prazo do caso estourou;
--   · providencia_vencida  — uma providência combinada passou do prazo;
--   · resposta_pendente    — NOVO: a última mensagem pública da conversa é
--                            do denunciante e o Comitê ainda não respondeu.
--
-- 'resposta_pendente' usa exatamente o mesmo critério do selo "aguardando
-- resposta do comitê" que a ficha já mostra (Conversa.tsx) — o que mudou é
-- que agora ele também chega sem alguém abrir o caso.
--
-- Dois ajustes que vêm junto, pelo mesmo motivo (barulho):
--   1. Nenhum tipo empilha: enquanto houver aviso ABERTO daquele tipo para
--      aquele caso, o tick do dia seguinte não cria outro. Dar baixa e o
--      problema continuar amanhã ainda levanta um aviso novo — a chave
--      única (denuncia_id, tipo, referencia) tem a data, e isso é de
--      propósito.
--   2. A RLS do alerta passa a seguir o recorte por empresa do caso-pai,
--      como as outras tabelas filhas já fazem desde a 20260914000005. Sem
--      isso, quem é restrito a uma empresa via "2 alertas em aberto" de
--      denúncias que a lista dele nem trazia — o protocolo no texto do
--      aviso já entrega que o caso existe.
--
-- Idempotente.
-- =====================================================================

-- ── 1. O tipo novo entra no CHECK ────────────────────────────────────
-- Os dois tipos aposentados continuam aceitos: as linhas antigas ficam no
-- histórico e um CHECK que as invalidasse travaria qualquer UPDATE nelas.
ALTER TABLE public."CANAL_DENUNCIA_ALERTA"
  DROP CONSTRAINT IF EXISTS "CANAL_DENUNCIA_ALERTA_tipo_check";
ALTER TABLE public."CANAL_DENUNCIA_ALERTA"
  ADD CONSTRAINT "CANAL_DENUNCIA_ALERTA_tipo_check"
  CHECK (tipo IN ('prazo_vencido','primeira_providencia','parado',
                  'providencia_vencida','resposta_pendente'));

-- ── 2. Baixa nos avisos aposentados que ficaram abertos ──────────────
-- Sem isto, os que já estão na tela hoje ficariam lá para sempre: quem os
-- criava não existe mais para dar baixa.
UPDATE public."CANAL_DENUNCIA_ALERTA"
   SET resolvido_em = now()
 WHERE resolvido_em IS NULL
   AND tipo IN ('primeira_providencia','parado');

-- ── 3. O tick ────────────────────────────────────────────────────────
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
     AND NOT EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA_ALERTA" a
                      WHERE a.denuncia_id = b.id AND a.tipo = 'prazo_vencido'
                        AND a.resolvido_em IS NULL)
  ON CONFLICT (denuncia_id, tipo, referencia) DO NOTHING;
  GET DIAGNOSTICS v_novos = ROW_COUNT;

  -- 3.2 Pendente de resposta: a última mensagem PÚBLICA da conversa é do
  -- denunciante. Nota interna não conta — ela não é resposta a ninguém.
  WITH ultima AS (
    SELECT DISTINCT ON (m.denuncia_id) m.denuncia_id, m.autor
      FROM public."CANAL_DENUNCIA_MENSAGEM" m
     WHERE m.interna = false
     ORDER BY m.denuncia_id, m.created_at DESC
  )
  INSERT INTO public."CANAL_DENUNCIA_ALERTA"(denuncia_id, tipo, mensagem)
  SELECT d.id, 'resposta_pendente',
         'Denunciante aguarda resposta do Comitê — ' || d.protocolo
    FROM public."CANAL_DENUNCIA" d
    JOIN ultima u ON u.denuncia_id = d.id
   WHERE d.status NOT IN ('concluida','arquivada')
     AND u.autor = 'denunciante'
     AND NOT EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA_ALERTA" a
                      WHERE a.denuncia_id = d.id AND a.tipo = 'resposta_pendente'
                        AND a.resolvido_em IS NULL)
  ON CONFLICT (denuncia_id, tipo, referencia) DO NOTHING;
  GET DIAGNOSTICS v_parcial = ROW_COUNT;
  v_novos := v_novos + v_parcial;

  -- 3.3 Providência com prazo vencido.
  INSERT INTO public."CANAL_DENUNCIA_ALERTA"(denuncia_id, tipo, mensagem)
  SELECT DISTINCT ON (p.denuncia_id) p.denuncia_id, 'providencia_vencida',
         'Providência vencida em ' || to_char(p.prazo, 'DD/MM/YYYY') || ': ' || left(p.descricao, 80)
    FROM public."CANAL_DENUNCIA_PROVIDENCIA" p
   WHERE p.situacao IN ('pendente','em_andamento')
     AND p.prazo IS NOT NULL AND p.prazo < current_date
     AND NOT EXISTS (SELECT 1 FROM public."CANAL_DENUNCIA_ALERTA" a
                      WHERE a.denuncia_id = p.denuncia_id AND a.tipo = 'providencia_vencida'
                        AND a.resolvido_em IS NULL)
   ORDER BY p.denuncia_id, p.prazo
  ON CONFLICT (denuncia_id, tipo, referencia) DO NOTHING;
  GET DIAGNOSTICS v_parcial = ROW_COUNT;
  v_novos := v_novos + v_parcial;

  -- 3.4 Baixa automática do 'resposta_pendente' assim que o Comitê responde.
  -- O aviso existe enquanto a bola estiver com o Comitê; respondeu, some —
  -- ninguém precisa dar baixa à mão no que já foi feito.
  WITH ultima AS (
    SELECT DISTINCT ON (m.denuncia_id) m.denuncia_id, m.autor
      FROM public."CANAL_DENUNCIA_MENSAGEM" m
     WHERE m.interna = false
     ORDER BY m.denuncia_id, m.created_at DESC
  )
  UPDATE public."CANAL_DENUNCIA_ALERTA" a
     SET resolvido_em = now()
   WHERE a.tipo = 'resposta_pendente'
     AND a.resolvido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM ultima u
                      WHERE u.denuncia_id = a.denuncia_id AND u.autor = 'denunciante');
  GET DIAGNOSTICS v_fechados = ROW_COUNT;

  -- 3.5 Baixa automática: caso encerrado não deixa alerta aberto atrás de si.
  UPDATE public."CANAL_DENUNCIA_ALERTA" a
     SET resolvido_em = now()
    FROM public."CANAL_DENUNCIA" d
   WHERE d.id = a.denuncia_id
     AND a.resolvido_em IS NULL
     AND d.status IN ('concluida','arquivada');
  GET DIAGNOSTICS v_parcial = ROW_COUNT;
  v_fechados := v_fechados + v_parcial;

  RETURN jsonb_build_object('novos', v_novos, 'fechados', v_fechados);
END $$;

REVOKE ALL ON FUNCTION public.comite_etica_apurar_alertas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comite_etica_apurar_alertas() TO service_role;

-- ── 4. O alerta segue o recorte por empresa do caso-pai ──────────────
-- Pela FUNÇÃO, nunca por `EXISTS (SELECT ... FROM "CANAL_DENUNCIA")`:
-- `authenticated` não tem SELECT naquela tabela, e policy que a consulta
-- direto estoura `permission denied` — foi assim que a 20260914000005
-- derrubou o Malote inteiro (ver 20260916000001).
DROP POLICY IF EXISTS canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
         AND public.canal_denuncia_visivel_por_id(denuncia_id));

DROP POLICY IF EXISTS canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA";
CREATE POLICY canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
         AND public.canal_denuncia_visivel_por_id(denuncia_id))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias')
         AND public.canal_denuncia_visivel_por_id(denuncia_id));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   -- volta o tick anterior por inteiro:
--   -- reexecute o bloco 3 de 20260914000004_canal_denuncia_alertas.sql
--   ALTER TABLE public."CANAL_DENUNCIA_ALERTA"
--     DROP CONSTRAINT IF EXISTS "CANAL_DENUNCIA_ALERTA_tipo_check";
--   ALTER TABLE public."CANAL_DENUNCIA_ALERTA"
--     ADD CONSTRAINT "CANAL_DENUNCIA_ALERTA_tipo_check"
--     CHECK (tipo IN ('prazo_vencido','primeira_providencia','parado','providencia_vencida'));
--   DROP POLICY IF EXISTS canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA";
--   CREATE POLICY canal_alerta_select ON public."CANAL_DENUNCIA_ALERTA" FOR SELECT TO authenticated USING (public.tem_acesso_menu('central_servicos_canal_denuncias'));
--   DROP POLICY IF EXISTS canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA";
--   CREATE POLICY canal_alerta_update ON public."CANAL_DENUNCIA_ALERTA" FOR UPDATE TO authenticated USING (public.tem_acesso_menu('central_servicos_canal_denuncias')) WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));
-- =====================================================================
