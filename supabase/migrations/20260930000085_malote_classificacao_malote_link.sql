-- SIS-2026-0374 (Iury): "Fazer com que seja possível ligar uma
-- classificação malote que não tenha nenhuma ligação com contrato ou
-- administrativo com outra classificação malote. EX: Pensão é uma
-- classificação malote que não tem nada ligado a ela, então preciso ligar
-- ela na classificação malote Salário."
--
-- Terceiro par de Ligação, mesmo padrão de malote_licitacao_classificacao_
-- link (SIS-2026-0084) e malote_administrativo_classificacao_link
-- (SIS-2026-0125): ORIGEM (a classificação sem orçamento próprio, ex.
-- Pensão) → DESTINO (a classificação com orçamento real, ex. Salário).
-- Cada origem só liga a um destino (1:1) — mesma regra das outras duas
-- ligações.
--
-- Diferente das outras duas, os dois lados aqui são o MESMO tipo de
-- entidade (Classificação Malote), o que abre risco de corrente
-- (A→B→C) e de origem/destino se misturarem — por isso o trigger de
-- validação abaixo, sem equivalente nas outras ligações.
--
-- Isto NÃO cria orçamento novo nem RPC — é resolvido inteiramente no
-- client (useOrcadoClassificacao/useUtilizadoOrcamento passam a resolver
-- a origem pelo destino antes de calcular Orçado/Utilizado). RLS só
-- protege leitura/escrita da tabela de ligação em si.

CREATE TABLE public.malote_classificacao_malote_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classificacao_malote_id uuid NOT NULL UNIQUE REFERENCES public.planejamento_orcamentario_classificacao(id),
  classificacao_malote_vinculada_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT malote_class_malote_link_nao_ela_mesma CHECK (classificacao_malote_id <> classificacao_malote_vinculada_id)
);

CREATE INDEX idx_malote_class_malote_link_vinculada ON public.malote_classificacao_malote_link(classificacao_malote_vinculada_id);

-- Validação de integridade (BEFORE, não é RLS): origem não pode já ter
-- orçamento próprio (contrato ou administrativo) — senão a Classificação
-- ficaria com DUAS fontes de orçado, ambíguo. E nem origem nem destino
-- podem já estar do outro lado de outra ligação — só 1 nível, sem
-- corrente (A→B→C ficaria impossível de resolver com um único map).
CREATE OR REPLACE FUNCTION public.malote_class_malote_link_valida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.malote_administrativo_classificacao_link
    WHERE classificacao_malote_id = NEW.classificacao_malote_id
  ) THEN
    RAISE EXCEPTION 'Esta Classificação Malote já está ligada a um Orçamento Administrativo — não pode também ligar a outra Classificação Malote.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.malote_licitacao_classificacao_link
    WHERE classificacao_malote_id = NEW.classificacao_malote_id
  ) THEN
    RAISE EXCEPTION 'Esta Classificação Malote já está ligada a rubricas de Licitação/Contrato — não pode também ligar a outra Classificação Malote.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.malote_classificacao_malote_link
    WHERE classificacao_malote_id = NEW.classificacao_malote_vinculada_id
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'A Classificação Malote de destino já é origem de outra ligação — só é permitido um nível de ligação (sem corrente).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.malote_classificacao_malote_link
    WHERE classificacao_malote_vinculada_id = NEW.classificacao_malote_id
      AND id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Esta Classificação Malote já é destino de outra ligação — não pode também ser origem.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS malote_class_malote_link_valida_trg ON public.malote_classificacao_malote_link;
CREATE TRIGGER malote_class_malote_link_valida_trg
  BEFORE INSERT OR UPDATE ON public.malote_classificacao_malote_link
  FOR EACH ROW EXECUTE FUNCTION public.malote_class_malote_link_valida();

ALTER TABLE public.malote_classificacao_malote_link ENABLE ROW LEVEL SECURITY;

-- Mesmo alcance de leitura das outras duas ligações (20260930000006):
-- Configurações (quem administra) + Criar Despesa (a tela de lançamento
-- também precisa ler pra resolver Orçado/Restante da classificação).
CREATE POLICY malote_class_malote_link_select ON public.malote_classificacao_malote_link FOR SELECT TO authenticated
  USING (
    public.can_access(auth.uid(), 'malote_configuracoes', 'visualizar'::public.app_acao)
    OR public.can_access(auth.uid(), 'malote_criar_despesa', 'visualizar'::public.app_acao)
  );

CREATE POLICY malote_class_malote_link_write ON public.malote_classificacao_malote_link FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'malote_configuracoes', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'malote_configuracoes', 'alterar'::public.app_acao));

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS malote_class_malote_link_valida_trg ON public.malote_classificacao_malote_link;
--   DROP FUNCTION IF EXISTS public.malote_class_malote_link_valida();
--   DROP TABLE IF EXISTS public.malote_classificacao_malote_link;
