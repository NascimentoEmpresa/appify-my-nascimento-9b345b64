-- SIS-2026-0572 (Iury): novo tipo "Folha" no Bloqueio de Dias do Malote —
-- diferente dos tipos atuais (Feriado/Recesso/Ponto Facultativo/Outros,
-- que bloqueiam o dia pra todo mundo), este permite escolher QUAIS
-- classificações continuam liberadas pra lançar naquele dia (ex.:
-- "SALARIO"), pra fechar o Malote geral num dia de folha sem travar quem
-- precisa lançar exatamente a despesa de folha.
--
-- malote_dia_bloqueado.tipo já é FK pra malote_tipo_bloqueio(nome)
-- (20260827000002) — "Folha" é só mais uma linha desse catálogo, mesmo
-- mecanismo de "criar novo tipo" que a própria tela já usa.
--
-- Escopo confirmado com o usuário: a exceção por classificação só vale
-- pra despesa com classificacao_id direto no cabeçalho (não-rateio).
-- Despesa de rateio (classificacao_id NULL no cabeçalho) continua
-- bloqueada por inteiro num dia "Folha" — o header é gravado com
-- data_pagamento já preenchido ANTES de qualquer malote_despesa_rateio_
-- linha existir (2 inserts client-side separados em useSalvarDespesa),
-- então o trigger do cabeçalho não tem como saber a classificação de
-- rateio no momento em que dispara. Mesma classe de problema já vista
-- (e resolvida só pra RLS de leitura, não pra este bloqueio) em
-- 20260930000264/20260930000271 desta mesma sessão — fica pra um chamado
-- à parte se precisar valer pra rateio também.

INSERT INTO public.malote_tipo_bloqueio (nome) VALUES ('Folha') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.malote_dia_bloqueado_classificacao_liberada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_bloqueado_id uuid NOT NULL REFERENCES public.malote_dia_bloqueado(id) ON DELETE CASCADE,
  classificacao_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id) ON DELETE CASCADE,
  UNIQUE (dia_bloqueado_id, classificacao_id)
);

ALTER TABLE public.malote_dia_bloqueado_classificacao_liberada ENABLE ROW LEVEL SECURITY;

-- Leitura aberta a qualquer autenticado, mesmo padrão de
-- malote_dia_bloqueado_select_geral (20260914000002) — precisa disso pra
-- o calendário de qualquer solicitante saber quais classificações valem
-- num dia "Folha".
DROP POLICY IF EXISTS mdbcl_select ON public.malote_dia_bloqueado_classificacao_liberada;
CREATE POLICY mdbcl_select ON public.malote_dia_bloqueado_classificacao_liberada
  FOR SELECT TO authenticated USING (true);

-- Escrita restrita às mesmas 3 roles de malote_dia_bloqueado_write
-- (20260827000002) — não cria um padrão de permissão diferente do resto
-- da tabela-mãe.
DROP POLICY IF EXISTS mdbcl_write ON public.malote_dia_bloqueado_classificacao_liberada;
CREATE POLICY mdbcl_write ON public.malote_dia_bloqueado_classificacao_liberada
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'controladoria') OR has_role(auth.uid(), 'diretor_adm'));

-- Segunda assinatura (overload) de malote_dia_esta_bloqueado — a de 1
-- argumento fica intacta (malote_prazo_normal_inclusao e qualquer outro
-- chamador que não conhece classificação continuam funcionando igual).
-- Dia sem nenhuma linha em malote_dia_bloqueado_classificacao_liberada se
-- comporta exatamente como hoje (bloqueia todo mundo) — só muda
-- comportamento pros dias que o admin explicitamente marcar exceções.
CREATE OR REPLACE FUNCTION public.malote_dia_esta_bloqueado(_data date, _classificacao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.malote_dia_esta_bloqueado(_data) THEN false
    WHEN _classificacao_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.malote_dia_bloqueado d
      JOIN public.malote_dia_bloqueado_classificacao_liberada l ON l.dia_bloqueado_id = d.id
      WHERE d.data = _data AND l.classificacao_id = _classificacao_id
    ) THEN false
    ELSE true
  END;
$$;

REVOKE ALL ON FUNCTION public.malote_dia_esta_bloqueado(date, uuid) FROM PUBLIC, anon;

-- Trigger passa a chamar a versão de 2 argumentos, passando a
-- classificação do cabeçalho (NULL em rateio — cai no ELSE true de cima,
-- mantendo o bloqueio total de hoje pra rateio).
CREATE OR REPLACE FUNCTION public.malote_bloqueia_dia_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_impedir boolean;
BEGIN
  IF NEW.data_pagamento IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_pagamento IS NOT DISTINCT FROM NEW.data_pagamento THEN RETURN NEW; END IF;

  IF NEW.status = 'despesa_paga' THEN RETURN NEW; END IF;

  IF NEW.excecao THEN RETURN NEW; END IF;

  SELECT bloqueio_impedir_lancamento INTO v_impedir FROM public.malote_config WHERE id = true;

  IF v_impedir AND public.malote_dia_esta_bloqueado(NEW.data_pagamento, NEW.classificacao_id) THEN
    RAISE EXCEPTION 'Data de pagamento % está bloqueada no Malote (dia bloqueado, feriado ou fim de semana).', NEW.data_pagamento;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.malote_dia_esta_bloqueado(date, uuid);
--   Reverter malote_bloqueia_dia_pagamento pro CREATE OR REPLACE de
--   20260915000001_malote_excecao_dia_bloqueado.sql (chamada de 1 argumento);
--   DROP TABLE IF EXISTS public.malote_dia_bloqueado_classificacao_liberada;
--   DELETE FROM public.malote_tipo_bloqueio WHERE nome = 'Folha';
--   NOTIFY pgrst, 'reload schema';
