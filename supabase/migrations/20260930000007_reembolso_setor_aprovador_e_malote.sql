-- =====================================================================
-- REEMBOLSO — cascata de permissão por SETOR, e envio ao Malote.
--
-- Corrige o desenho que a 20260930000006 entregou. Lá o recorte da fila de
-- aprovação usava `cs_reembolso_lidera_setor`: quem liderava um setor via o
-- seu, e quem não liderava setor nenhum via TODAS. Isso é frouxo demais —
-- bastava ter a permissão e não ser líder para enxergar o reembolso da casa
-- inteira. A regra pedida é explícita:
--
--   "eu, Pablo, sou do setor de Sistemas; só quem tem permissão de aprovar
--    reembolso do setor de Sistemas pode aprovar o meu, e enviar pro malote."
--
-- Três partes:
--
-- 1. SETOR DO SOLICITANTE É AUTOMÁTICO E TRAVADO. Vem de EMPREGADOS
--    (`Setor_ERP`, o cadastro da Senior — é o que aparece em Meu Perfil) e,
--    se a pessoa não tiver vínculo lá, cai no setor do perfil (`user_setor`).
--    Gravado por trigger: o que o cliente mandar no campo é ignorado. Quem não
--    tem setor em lugar nenhum é barrado com a razão dita na mensagem, em vez
--    de abrir uma solicitação que ninguém pode aprovar.
--
-- 2. QUEM APROVA QUAL SETOR é `CS_REEMBOLSO_APROVADOR_SETOR`, configurada no
--    botão ao lado de "Reembolso — Aprovação" em Administração › Acesso por
--    Usuário — mesmo padrão de `malote_setor_visivel_usuario` (SIS-2026-0216),
--    inclusive no gate de escrita. Não é tela de permissão nova: é a de
--    sempre, com mais um painel.
--
--    Diferença de propósito em relação ao Malote: lá o modelo é opt-in (sem
--    linha, vê tudo). Aqui é opt-out — SEM linha, NÃO aprova nada. Reembolso é
--    dinheiro no nome de uma pessoa; "esqueci de configurar" não pode
--    significar "todo mundo aprova".
--
-- 3. ENVIO AO MALOTE. Reembolso aprovado vira despesa em `malote_despesa`,
--    com os padrões (empresa, classificação, forma de pagamento) definidos em
--    `CS_REEMBOLSO_CONFIG` — a despesa do Malote exige campos que o reembolso
--    não tem, e adivinhá-los criaria despesa torta.
--
-- ⚠️ NOME DE SETOR VEM DE DUAS FONTES COM CAIXA DIFERENTE: EMPREGADOS grava
-- "SISTEMAS" e `setor_catalogo` grava "Sistemas". Comparar cru faria a
-- cascata inteira falhar em silêncio — toda comparação passa por
-- `cs_reembolso_norm_setor`.
-- =====================================================================

-- 1) Normalização de nome de setor -------------------------------------
-- Sem `unaccent` (a extensão não está garantida neste projeto): translate
-- resolve os acentos que aparecem em nome de setor português.
CREATE OR REPLACE FUNCTION public.cs_reembolso_norm_setor(_setor text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT nullif(
    btrim(translate(upper(coalesce(_setor, '')),
                    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                    'AAAAAEEEEIIIIOOOOOUUUUC')),
    '');
$$;

-- 2) De onde sai o setor de quem pede ----------------------------------
-- EMPREGADOS primeiro (cadastro oficial da Senior, o que Meu Perfil mostra);
-- `user_setor` como reserva, para quem usa o ERP sem vínculo com a Senior.
-- Quando o perfil tem MAIS DE UM setor, não há como escolher por conta
-- própria sem chutar — devolve NULL e a tela pede que a pessoa acerte o
-- cadastro, em vez de mandar a solicitação para o aprovador errado.
CREATE OR REPLACE FUNCTION public.cs_reembolso_meu_setor()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s text; n int;
BEGIN
  SELECT e."Setor_ERP" INTO s
    FROM public.profiles p
    JOIN public."EMPREGADOS" e ON e."ID" = p.empregado_id
   WHERE p.id = auth.uid()
   LIMIT 1;
  IF public.cs_reembolso_norm_setor(s) IS NOT NULL THEN RETURN s; END IF;

  SELECT count(*) INTO n FROM public.user_setor WHERE user_id = auth.uid();
  IF n = 1 THEN
    SELECT setor INTO s FROM public.user_setor WHERE user_id = auth.uid();
    RETURN s;
  END IF;

  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cs_reembolso_meu_setor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_meu_setor() TO authenticated;

-- 3) Quem aprova qual setor --------------------------------------------
CREATE TABLE IF NOT EXISTS public."CS_REEMBOLSO_APROVADOR_SETOR" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setor      text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, setor)
);
CREATE INDEX IF NOT EXISTS idx_cs_reembolso_aprovador_user
  ON public."CS_REEMBOLSO_APROVADOR_SETOR"(user_id);

ALTER TABLE public."CS_REEMBOLSO_APROVADOR_SETOR" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_REEMBOLSO_APROVADOR_SETOR" FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public."CS_REEMBOLSO_APROVADOR_SETOR" TO authenticated;

-- Ver a própria configuração é útil (a tela mostra "você aprova: X, Y"); ver a
-- dos outros é assunto de quem administra acesso.
DROP POLICY IF EXISTS cs_reembolso_aprovador_select ON public."CS_REEMBOLSO_APROVADOR_SETOR";
CREATE POLICY cs_reembolso_aprovador_select ON public."CS_REEMBOLSO_APROVADOR_SETOR"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_access(auth.uid(), 'administracao', 'alterar'));

-- Mesmo gate que já protege a tela de Gerenciamento de Acesso inteira
-- (`podeGerenciar` em ModulosMenusTab.tsx).
DROP POLICY IF EXISTS cs_reembolso_aprovador_write ON public."CS_REEMBOLSO_APROVADOR_SETOR";
CREATE POLICY cs_reembolso_aprovador_write ON public."CS_REEMBOLSO_APROVADOR_SETOR"
  FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'administracao', 'alterar'))
  WITH CHECK (public.can_access(auth.uid(), 'administracao', 'alterar'));

/**
 * Esta pessoa aprova reembolso deste setor?
 *
 * Opt-OUT, ao contrário do recorte do Malote: sem linha configurada, não
 * aprova nada. Ver o item 2 do cabeçalho.
 */
CREATE OR REPLACE FUNCTION public.cs_reembolso_aprova_setor(_setor text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."CS_REEMBOLSO_APROVADOR_SETOR" a
     WHERE a.user_id = auth.uid()
       AND public.cs_reembolso_norm_setor(a.setor)
           IS NOT DISTINCT FROM public.cs_reembolso_norm_setor(_setor)
  );
$$;
REVOKE ALL ON FUNCTION public.cs_reembolso_aprova_setor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_aprova_setor(text) TO authenticated;

-- 4) O setor da solicitação é do banco, não do cliente ------------------
CREATE OR REPLACE FUNCTION public.cs_reembolso_carimba_setor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE s text;
BEGIN
  s := public.cs_reembolso_meu_setor();
  IF public.cs_reembolso_norm_setor(s) IS NULL THEN
    RAISE EXCEPTION 'Seu cadastro não tem setor definido, então não há para quem enviar o reembolso. Peça ao RH para preencher o setor no seu cadastro.';
  END IF;
  -- Sobrescreve o que veio do cliente de propósito: o setor decide QUEM
  -- aprova, então deixá-lo editável seria deixar a pessoa escolher o próprio
  -- aprovador.
  NEW.setor := s;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cs_reembolso_carimba_setor_trg ON public."CS_REEMBOLSO";
CREATE TRIGGER cs_reembolso_carimba_setor_trg BEFORE INSERT ON public."CS_REEMBOLSO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_carimba_setor();

-- 5) Status e vínculo com o Malote --------------------------------------
ALTER TABLE public."CS_REEMBOLSO" DROP CONSTRAINT IF EXISTS "CS_REEMBOLSO_status_check";
ALTER TABLE public."CS_REEMBOLSO" ADD CONSTRAINT "CS_REEMBOLSO_status_check"
  CHECK (status IN ('pendente','aprovado','reprovado','cancelado','enviado_malote'));

ALTER TABLE public."CS_REEMBOLSO"
  ADD COLUMN IF NOT EXISTS malote_despesa_id uuid,
  ADD COLUMN IF NOT EXISTS enviado_malote_em timestamptz;

-- 6) Padrões para a despesa do Malote -----------------------------------
-- A despesa do Malote exige empresa e classificação; o reembolso não tem
-- esses campos e não há como derivá-los da viagem. Ficam aqui, uma linha só,
-- editáveis por quem já mexe nos tipos e limites.
CREATE TABLE IF NOT EXISTS public."CS_REEMBOLSO_CONFIG" (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  empresa_id          uuid,
  classificacao_id    uuid,
  forma_pagamento     text,
  tipo_movimento      text,
  atualizado_por      uuid REFERENCES auth.users(id),
  atualizado_por_nome text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public."CS_REEMBOLSO_CONFIG" (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public."CS_REEMBOLSO_CONFIG" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CS_REEMBOLSO_CONFIG" FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public."CS_REEMBOLSO_CONFIG" TO authenticated;

DROP POLICY IF EXISTS cs_reembolso_config_select ON public."CS_REEMBOLSO_CONFIG";
CREATE POLICY cs_reembolso_config_select ON public."CS_REEMBOLSO_CONFIG"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cs_reembolso_config_update ON public."CS_REEMBOLSO_CONFIG";
CREATE POLICY cs_reembolso_config_update ON public."CS_REEMBOLSO_CONFIG"
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'central_servicos_reembolso_config', 'alterar'));

-- 7) RLS: troca lidera_setor por aprova_setor ---------------------------
-- A policy antiga (20260930000006) deixava quem não lidera setor nenhum ver
-- tudo. Recriada aqui com a regra explícita.
DROP POLICY IF EXISTS cs_reembolso_select ON public."CS_REEMBOLSO";
CREATE POLICY cs_reembolso_select ON public."CS_REEMBOLSO"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR (
      public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'visualizar')
      AND public.cs_reembolso_aprova_setor(setor)
    )
  );

DROP POLICY IF EXISTS cs_reembolso_update ON public."CS_REEMBOLSO";
CREATE POLICY cs_reembolso_update ON public."CS_REEMBOLSO"
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid() AND status = 'pendente')
    OR (
      public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
      AND public.cs_reembolso_aprova_setor(setor)
    )
  );

-- O guard de campo também: quem "tem a chave de decidir" agora precisa da
-- chave DAQUELE setor. Sem isto, um aprovador de Sistemas passaria o guard
-- numa solicitação do Jurídico (a policy o barraria, mas duas camadas
-- discordando é o tipo de coisa que confunde na hora do incidente).
CREATE OR REPLACE FUNCTION public.cs_reembolso_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
     AND public.cs_reembolso_aprova_setor(OLD.setor) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pendente' AND NEW.status = 'cancelado') THEN
    RAISE EXCEPTION 'Você não aprova reembolso do setor %.', OLD.setor;
  END IF;

  IF NEW.total_centavos IS DISTINCT FROM OLD.total_centavos THEN
    RAISE EXCEPTION 'O total é calculado pelas despesas, não pode ser digitado.';
  END IF;
  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id
     OR NEW.setor IS DISTINCT FROM OLD.setor THEN
    RAISE EXCEPTION 'Solicitante e setor não mudam depois de criada.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao THEN
    RAISE EXCEPTION 'Só quem aprova preenche a decisão.';
  END IF;

  RETURN NEW;
END $$;

-- A antiga fica no banco sem uso: outra migration pode tê-la referenciado, e
-- derrubar função em uso quebra policy alheia. Só deixa de ser chamada aqui.
COMMENT ON FUNCTION public.cs_reembolso_lidera_setor(text) IS
  'OBSOLETA desde 20260930000007 — o recorte agora é cs_reembolso_aprova_setor.';

-- 8) Envio ao Malote ----------------------------------------------------
/**
 * Cria a despesa do Malote a partir de um reembolso APROVADO.
 *
 * SECURITY DEFINER porque insere em `malote_despesa`, cujas policies falam de
 * empresa e classificação — o aprovador do reembolso não é necessariamente
 * alguém que lança no Malote, e não deveria precisar ser. A autorização é
 * checada aqui dentro, na marra: mesma dupla da policy (menu de aprovação +
 * aprovar aquele setor).
 *
 * Idempotente pelo `malote_despesa_id`: chamar duas vezes não gera duas
 * despesas — reembolso pago em dobro é o pior erro possível deste módulo.
 */
CREATE OR REPLACE FUNCTION public.cs_reembolso_enviar_ao_malote(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r   public."CS_REEMBOLSO"%ROWTYPE;
  cfg public."CS_REEMBOLSO_CONFIG"%ROWTYPE;
  nova_id uuid;
  nome_despesa text;
BEGIN
  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reembolso não encontrado.'; END IF;

  IF NOT (public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
          AND public.cs_reembolso_aprova_setor(r.setor)) THEN
    RAISE EXCEPTION 'Você não aprova reembolso do setor %.', r.setor;
  END IF;

  IF r.malote_despesa_id IS NOT NULL THEN
    RETURN r.malote_despesa_id;   -- já foi; devolve o mesmo
  END IF;

  IF r.status <> 'aprovado' THEN
    RAISE EXCEPTION 'Só reembolso aprovado vai para o malote (este está %).', r.status;
  END IF;

  SELECT * INTO cfg FROM public."CS_REEMBOLSO_CONFIG" WHERE id;
  IF cfg.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Configure a empresa padrão do reembolso em Tipos e Limites antes de enviar ao malote.';
  END IF;

  nome_despesa := 'Reembolso ' || coalesce(r.numero, '') || ' — ' ||
                  coalesce(r.solicitante_nome, 'colaborador') || ' (' || coalesce(r.setor, '—') || ')';

  INSERT INTO public.malote_despesa (
    empresa_id, classificacao_id, origem, status, nome, valor_total,
    descricao, competencia, forma_pagamento, tipo_movimento,
    informacoes_pagamento, created_by
  ) VALUES (
    cfg.empresa_id, cfg.classificacao_id, 'reembolso', 'rascunho',
    nome_despesa, (r.total_centavos / 100.0),
    'Gerado do Reembolso ' || coalesce(r.numero, r.id::text) ||
      '. Viagem em ' || to_char(r.data_viagem, 'DD/MM/YYYY') ||
      ', das ' || to_char(r.saida, 'HH24:MI') || ' às ' || to_char(r.chegada, 'HH24:MI') || '.',
    r.competencia, cfg.forma_pagamento, cfg.tipo_movimento,
    'PIX: ' || r.pix, auth.uid()
  ) RETURNING id INTO nova_id;

  UPDATE public."CS_REEMBOLSO"
     SET malote_despesa_id = nova_id,
         enviado_malote_em = now(),
         status = 'enviado_malote'
   WHERE id = _id;

  RETURN nova_id;
END $$;
REVOKE ALL ON FUNCTION public.cs_reembolso_enviar_ao_malote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_enviar_ao_malote(uuid) TO authenticated;

-- 9) Catálogo de setores para as telas ----------------------------------
-- Junta as duas fontes (EMPREGADOS e setor_catalogo) já normalizadas, para o
-- painel de Acesso por Usuário oferecer a mesma lista que o carimbo usa. Sem
-- isto, o admin marcaria "Sistemas" e a solicitação chegaria como "SISTEMAS".
CREATE OR REPLACE FUNCTION public.cs_reembolso_setores()
RETURNS TABLE(setor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (public.cs_reembolso_norm_setor(s)) s
    FROM (
      SELECT nome AS s FROM public.setor_catalogo
      UNION
      SELECT DISTINCT "Setor_ERP" FROM public."EMPREGADOS" WHERE "Setor_ERP" IS NOT NULL
    ) t
   WHERE public.cs_reembolso_norm_setor(s) IS NOT NULL
   ORDER BY public.cs_reembolso_norm_setor(s), s;
$$;
REVOKE ALL ON FUNCTION public.cs_reembolso_setores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_setores() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP TRIGGER IF EXISTS cs_reembolso_carimba_setor_trg ON public."CS_REEMBOLSO";
-- DROP FUNCTION IF EXISTS public.cs_reembolso_carimba_setor();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_enviar_ao_malote(uuid);
-- DROP FUNCTION IF EXISTS public.cs_reembolso_setores();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_aprova_setor(text);
-- DROP FUNCTION IF EXISTS public.cs_reembolso_meu_setor();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_norm_setor(text);
-- DROP TABLE IF EXISTS public."CS_REEMBOLSO_APROVADOR_SETOR";
-- DROP TABLE IF EXISTS public."CS_REEMBOLSO_CONFIG";
-- ALTER TABLE public."CS_REEMBOLSO" DROP COLUMN IF EXISTS malote_despesa_id,
--   DROP COLUMN IF EXISTS enviado_malote_em;
-- (as policies cs_reembolso_select/update voltam pela 20260930000006)
-- NOTIFY pgrst, 'reload schema';
