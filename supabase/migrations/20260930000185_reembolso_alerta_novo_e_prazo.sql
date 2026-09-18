-- =====================================================================
-- REEMBOLSO — alerta de solicitação nova, prazo por tipo e meta de 24h.
--
-- Três pedidos de 17/09/2026, todos sobre o mesmo problema: reembolso entra
-- e ninguém percebe. A fila só é vista por quem lembra de abrir a tela, e
-- não existe regra dizendo até quando uma despesa pode ser lançada.
--
-- 1. ALERTA DE ENTRADA. Quando uma solicitação nasce, quem aprova aquele
--    setor recebe uma notificação no sininho (public.notificacoes), e a
--    bolinha vermelha da sidebar acende enquanto houver pendente na alçada
--    dele (RPC `cs_reembolso_alcada_resumo`, lida pelo hook
--    useReembolsoNotif). Vai SÓ para quem aprova o setor do solicitante —
--    o mesmo par (menu de aprovação + `CS_REEMBOLSO_APROVADOR_SETOR`) que
--    a fila usa — e nunca para o próprio solicitante, mesmo que ele aprove
--    o próprio setor: aviso do que a própria pessoa acabou de fazer é ruído.
--
--    O gatilho é o PRIMEIRO ITEM, não o cabeçalho. O front cria o cabeçalho,
--    sobe o comprovante e só então insere o item; se o item falhar, o
--    cabeçalho é apagado (ver useCriarReembolso). Avisar no cabeçalho
--    mandaria notificação de solicitação que nunca existiu.
--
-- 2. PRAZO PARA LANÇAR, POR TIPO. `CS_REEMBOLSO_TIPO.prazo_dias`: quantos
--    dias depois da viagem a despesa daquele tipo ainda pode ser lançada.
--    NULL = liberado (o padrão — nada muda para quem já usa). Com prazo,
--    passar dele é só AVISO ("fora do prazo", nas duas telas), a menos que
--    `prazo_bloqueia` esteja ligado: aí a trigger recusa, igual à janela
--    de horário. Mesmo desenho do teto (20260930000027): a regra vale
--    como informação para o aprovador, e vira barreira só se quem
--    configura pedir.
--
--    "Dias depois da viagem" conta em data local (America/Sao_Paulo): às
--    22h de Brasília o `current_date` do servidor já é amanhã, e a pessoa
--    perderia o último dia do prazo sem entender por quê.
--
-- 3. META DE 24H PARA DECIDIR. Não é coluna nem trigger: pendente há mais
--    de 24h aparece como "atrasado" na fila e conta separado no resumo da
--    alçada. Sinaliza, não bloqueia — atrasar a decisão não pode punir
--    quem pediu.
-- =====================================================================

-- 1) Prazo por tipo ------------------------------------------------------
ALTER TABLE public."CS_REEMBOLSO_TIPO"
  ADD COLUMN IF NOT EXISTS prazo_dias     integer
    CHECK (prazo_dias IS NULL OR prazo_dias > 0),
  ADD COLUMN IF NOT EXISTS prazo_bloqueia boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."CS_REEMBOLSO_TIPO".prazo_dias IS
  'Dias depois da data da viagem em que a despesa ainda pode ser lançada. NULL = sem prazo.';
COMMENT ON COLUMN public."CS_REEMBOLSO_TIPO".prazo_bloqueia IS
  'true = fora do prazo a trigger recusa o item; false (padrão) = só avisa nas telas.';

-- Quantos dias entre a viagem e o lançamento. Uma função só, para a trigger
-- e o resumo usarem a mesma conta — e para conferir no SQL Editor:
--   SELECT public.cs_reembolso_dias_desde('2026-09-01', now());
CREATE OR REPLACE FUNCTION public.cs_reembolso_dias_desde(_data_viagem date, _em timestamptz)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT ((_em AT TIME ZONE 'America/Sao_Paulo')::date - _data_viagem);
$$;

-- Mesma função da 20260930000027 mais o bloco do prazo, no fim: a ordem das
-- checagens continua sendo "o que pode ser pedido" antes de "quando".
CREATE OR REPLACE FUNCTION public.cs_reembolso_item_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  t        public."CS_REEMBOLSO_TIPO"%ROWTYPE;
  r        public."CS_REEMBOLSO"%ROWTYPE;
  alcanca  boolean;
  dias     integer;
BEGIN
  SELECT * INTO t FROM public."CS_REEMBOLSO_TIPO" WHERE codigo = NEW.tipo_codigo;
  IF NOT FOUND OR NOT t.ativo THEN
    RAISE EXCEPTION 'Tipo de despesa "%" não está disponível.', NEW.tipo_codigo;
  END IF;

  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = NEW.reembolso_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de reembolso não encontrada.';
  END IF;

  IF r.status <> 'pendente' THEN
    RAISE EXCEPTION 'Solicitação já foi % — não aceita mais despesas.', r.status;
  END IF;

  IF t.hora_inicio IS NOT NULL AND t.hora_fim IS NOT NULL THEN
    alcanca := public.cs_reembolso_periodos_cruzam(r.saida, r.chegada, t.hora_inicio, t.hora_fim);
    IF NOT alcanca THEN
      RAISE EXCEPTION '% vale para viagem que passe entre % e %. A sua foi de % às %.',
        t.nome, to_char(t.hora_inicio,'HH24:MI'), to_char(t.hora_fim,'HH24:MI'),
        to_char(r.saida,'HH24:MI'), to_char(r.chegada,'HH24:MI');
    END IF;
  END IF;

  -- Prazo só barra quando o tipo pede (`prazo_bloqueia`). Sem isso, o item
  -- entra e as telas marcam "fora do prazo" — o aprovador decide, como no
  -- teto. O espelho está em `avisoDePrazo`/`podeLancar` (regras.ts).
  IF t.prazo_dias IS NOT NULL AND t.prazo_bloqueia THEN
    dias := public.cs_reembolso_dias_desde(r.data_viagem, now());
    IF dias > t.prazo_dias THEN
      RAISE EXCEPTION '% só pode ser lançado até % dia(s) depois da viagem. A viagem foi em % (há % dias).',
        t.nome, t.prazo_dias, to_char(r.data_viagem, 'DD/MM/YYYY'), dias;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- 2) Resumo da alçada: o que acende a bolinha -----------------------------
-- Um par de números para a sidebar, em vez de puxar a fila inteira a cada
-- navegação. Mesmo recorte da `cs_reembolso_fila` (menu + aprova o setor),
-- sem o ramo do dono. Quem não tem a tela recebe 0/0 — nada vaza.
CREATE OR REPLACE FUNCTION public.cs_reembolso_alcada_resumo()
RETURNS TABLE(pendentes integer, atrasados integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int AS pendentes,
         (count(*) FILTER (WHERE r.created_at < now() - interval '24 hours'))::int AS atrasados
    FROM public."CS_REEMBOLSO" r
   WHERE r.status = 'pendente'
     AND public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'visualizar')
     AND public.cs_reembolso_aprova_setor(r.setor)
     -- Solicitação sem nenhuma despesa é envio que falhou no meio (ver
     -- 20260930000027, item 2): não é trabalho para ninguém.
     AND EXISTS (SELECT 1 FROM public."CS_REEMBOLSO_ITEM" i WHERE i.reembolso_id = r.id);
$$;
REVOKE ALL ON FUNCTION public.cs_reembolso_alcada_resumo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_alcada_resumo() TO authenticated;

-- 3) Sininho: aviso para quem aprova o setor ------------------------------
CREATE OR REPLACE FUNCTION public.cs_reembolso_notifica_novo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r public."CS_REEMBOLSO"%ROWTYPE;
BEGIN
  -- Só no primeiro item: é ele que faz a solicitação existir de verdade
  -- (ver o item 1 do cabeçalho). Do segundo em diante é a mesma solicitação.
  IF (SELECT count(*) FROM public."CS_REEMBOLSO_ITEM" WHERE reembolso_id = NEW.reembolso_id) <> 1 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = NEW.reembolso_id;
  IF NOT FOUND OR r.status <> 'pendente' THEN RETURN NEW; END IF;

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT DISTINCT a.user_id,
         'Novo reembolso para aprovar',
         COALESCE(r.numero, 'Reembolso') || ' de ' || COALESCE(r.solicitante_nome, 'colaborador')
           || ' (' || COALESCE(r.setor, '—') || ') aguarda sua aprovação.',
         'reembolso_pendente',
         '/app/central-servicos/reembolso/aprovacao'
    FROM public."CS_REEMBOLSO_APROVADOR_SETOR" a
   WHERE public.cs_reembolso_norm_setor(a.setor)
         IS NOT DISTINCT FROM public.cs_reembolso_norm_setor(r.setor)
     AND a.user_id IS DISTINCT FROM r.solicitante_id
     AND public.can_access(a.user_id, 'central_servicos_reembolso_aprovacao', 'visualizar');

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cs_reembolso_notifica_novo_trg ON public."CS_REEMBOLSO_ITEM";
CREATE TRIGGER cs_reembolso_notifica_novo_trg
  AFTER INSERT ON public."CS_REEMBOLSO_ITEM"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_notifica_novo();

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP TRIGGER IF EXISTS cs_reembolso_notifica_novo_trg ON public."CS_REEMBOLSO_ITEM";
-- DROP FUNCTION IF EXISTS public.cs_reembolso_notifica_novo();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_alcada_resumo();
-- -- Volta a validação sem prazo: reaplique o bloco 1 da 20260930000027.
-- DROP FUNCTION IF EXISTS public.cs_reembolso_dias_desde(date, timestamptz);
-- ALTER TABLE public."CS_REEMBOLSO_TIPO" DROP COLUMN IF EXISTS prazo_bloqueia, DROP COLUMN IF EXISTS prazo_dias;
-- DELETE FROM public.notificacoes WHERE tipo = 'reembolso_pendente';
-- NOTIFY pgrst, 'reload schema';
