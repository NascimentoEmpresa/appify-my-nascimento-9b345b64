-- SIS-2026-0668 (fase 1): submódulo "Solicitação de Exceção" do Malote.
--
-- ANTES: a despesa era marcada "Lançar como exceção" por quem a criava (checkbox) e só depois passava por
-- N1 e N2. Qualquer pessoa podia marcar. AGORA a exceção é pedida ANTES de lançar:
--   1. o solicitante pede a exceção (classificação, valor, data prevista, justificativa);
--   2. o N2 da classificação aprova (ou reprova); ao aprovar o banco gera uma SENHA única de 24 h;
--   3. na criação da despesa o solicitante informa a senha; só ela libera dia bloqueado / fora do prazo;
--   4. a senha vale uma vez, só para quem pediu, só para a data e a classificação pedidas e até o valor pedido.
-- A despesa lançada com a senha segue o fluxo normal de aprovação (decisão do usuário).
--
-- A regra mora no BANCO (gatilho em malote_despesa): nenhuma tela consegue marcar exceção sem a senha.
-- Despesas que JÁ são exceção continuam valendo; só a transição "não era exceção → virou" exige a senha.
--
-- DE PASSAGEM — recompõe o gatilho malote_bloqueia_dia_pagamento. A 20260930000274 (dia tipo Folha)
-- reescreveu a função a partir da versão da 20260915000001 e deixou de fora o piso de data passada
-- (20260930000084, SIS-2026-0361) e as regras 1.1/2.1 (20260930000010, SIS-2026-0250). Esta migration
-- reúne tudo: piso + regras 1.1/2.1 + liberação por classificação (Folha). A regra 1.1 é ignorada quando
-- não há sessão (auth.uid() nulo = rolagem automática, SIS-2026-0664), senão ela travaria o job.
--
-- Migrations não se auto-aplicam: rodar no SQL Editor, um BLOCO por vez (BLOCO 1 a 6).

-- BLOCO 1 ─ tabelas
CREATE SEQUENCE IF NOT EXISTS public.malote_excecao_solicitacao_seq;

CREATE TABLE IF NOT EXISTS public.malote_excecao_solicitacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  solicitante_id uuid NOT NULL REFERENCES auth.users(id),
  tipo text NOT NULL CHECK (tipo IN ('administrativo', 'contrato', 'dispensa_cotacao')),
  classificacao_id uuid NOT NULL REFERENCES public.planejamento_orcamentario_classificacao(id),
  contrato_id uuid REFERENCES public.contratos(id),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  valor numeric(14,2) NOT NULL CHECK (valor > 0),
  data_pagamento date NOT NULL,
  descricao text NOT NULL,
  justificativa text NOT NULL,
  status text NOT NULL DEFAULT 'em_analise'
    CHECK (status IN ('em_analise', 'aprovada', 'reprovada', 'utilizada', 'cancelada')),
  decidido_por uuid REFERENCES auth.users(id),
  decidido_em timestamptz,
  motivo_decisao text,
  senha text UNIQUE,
  senha_expira_em timestamptz,
  usada_em timestamptz,
  despesa_id uuid,                -- sem FK de propósito: a linha é marcada dentro do gatilho de INSERT da própria despesa
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_malote_excecao_sol_solicitante ON public.malote_excecao_solicitacao (solicitante_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_malote_excecao_sol_status ON public.malote_excecao_solicitacao (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_malote_excecao_sol_classificacao ON public.malote_excecao_solicitacao (classificacao_id);

CREATE TABLE IF NOT EXISTS public.malote_excecao_solicitacao_evento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public.malote_excecao_solicitacao(id) ON DELETE CASCADE,
  tipo_evento text NOT NULL CHECK (tipo_evento IN ('solicitada', 'aprovada', 'reprovada', 'senha_utilizada', 'cancelada')),
  ator_user_id uuid REFERENCES auth.users(id),
  descricao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_malote_excecao_sol_evento ON public.malote_excecao_solicitacao_evento (solicitacao_id, created_at);

ALTER TABLE public.malote_despesa
  ADD COLUMN IF NOT EXISTS excecao_solicitacao_id uuid REFERENCES public.malote_excecao_solicitacao(id);

-- BLOCO 2 ─ quem aprova e quem enxerga
-- N2 da classificação (aprovador2_user_ids) + GERENTE FINANCEIRO quando a chave de Configurações está ligada.
CREATE OR REPLACE FUNCTION public.malote_excecao_pode_decidir(_classificacao_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.planejamento_orcamentario_classificacao c
       WHERE c.id = _classificacao_id AND _user_id = ANY(c.aprovador2_user_ids)
    )
    OR public.malote_gerente_financeiro(_user_id)
    OR public.has_role(_user_id, 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_pode_decidir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_pode_decidir(uuid, uuid) TO authenticated;

ALTER TABLE public.malote_excecao_solicitacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.malote_excecao_solicitacao_evento ENABLE ROW LEVEL SECURITY;

-- Lê: quem pediu e quem pode decidir aquela classificação. Escrita só pelas funções abaixo (sem policy de escrita).
DROP POLICY IF EXISTS malote_excecao_sol_select ON public.malote_excecao_solicitacao;
CREATE POLICY malote_excecao_sol_select ON public.malote_excecao_solicitacao
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR (SELECT public.malote_excecao_pode_decidir(classificacao_id, auth.uid()))
  );

DROP POLICY IF EXISTS malote_excecao_sol_evento_select ON public.malote_excecao_solicitacao_evento;
CREATE POLICY malote_excecao_sol_evento_select ON public.malote_excecao_solicitacao_evento
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.malote_excecao_solicitacao s WHERE s.id = solicitacao_id));

-- BLOCO 3 ─ solicitar, decidir, cancelar, validar a senha
CREATE OR REPLACE FUNCTION public.malote_excecao_solicitar(
  _tipo text,
  _classificacao_id uuid,
  _contrato_id uuid,
  _empresa_id uuid,
  _valor numeric,
  _data_pagamento date,
  _descricao text,
  _justificativa text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_numero text;
  v_aprovadores uuid[];
  v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  IF NOT public.can_access(auth.uid(), 'malote_excecao_solicitar', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para solicitar exceção.';
  END IF;
  IF _classificacao_id IS NULL OR _empresa_id IS NULL OR _data_pagamento IS NULL OR COALESCE(_valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Preencha classificação, empresa, valor e data prevista do pagamento.';
  END IF;
  IF btrim(COALESCE(_descricao, '')) = '' OR btrim(COALESCE(_justificativa, '')) = '' THEN
    RAISE EXCEPTION 'Informe a descrição da despesa e a justificativa da exceção.';
  END IF;
  -- Mesma regra do piso absoluto da despesa: data no passado nunca, nem como exceção (SIS-2026-0361).
  IF _data_pagamento < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'A data prevista do pagamento é anterior a hoje — não é permitido, nem como exceção.';
  END IF;

  SELECT c.aprovador2_user_ids INTO v_aprovadores
    FROM public.planejamento_orcamentario_classificacao c WHERE c.id = _classificacao_id;
  IF COALESCE(array_length(v_aprovadores, 1), 0) = 0 THEN
    RAISE EXCEPTION 'A classificação escolhida não tem Aprovador Nível 2 configurado — ajuste em Classificações Malote antes de pedir a exceção.';
  END IF;

  v_numero := 'EXC-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY') || '-' || lpad(nextval('public.malote_excecao_solicitacao_seq')::text, 4, '0');

  INSERT INTO public.malote_excecao_solicitacao
    (numero, solicitante_id, tipo, classificacao_id, contrato_id, empresa_id, valor, data_pagamento, descricao, justificativa)
  VALUES
    (v_numero, auth.uid(), _tipo, _classificacao_id, _contrato_id, _empresa_id, round(_valor, 2), _data_pagamento, btrim(_descricao), btrim(_justificativa))
  RETURNING id INTO v_id;

  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (v_id, 'solicitada', auth.uid(), 'Exceção solicitada.');

  SELECT COALESCE(p.display_name, p.email) INTO v_nome FROM public.profiles p WHERE p.id = auth.uid();
  PERFORM public.malote_notificar_usuarios(
    v_aprovadores, _empresa_id,
    'Nova solicitação de exceção no Malote',
    format('%s pediu a exceção %s (R$ %s, pagamento em %s). Analise em Malote › Aprovar Exceções.',
           COALESCE(v_nome, 'Um usuário'), v_numero, to_char(round(_valor, 2), 'FM999G999G990D00'), to_char(_data_pagamento, 'DD/MM/YYYY')),
    'malote_excecao', '/app/malote/excecao/aprovar'
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_excecao_decidir(_id uuid, _aprovar boolean, _motivo text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
  v_senha text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF s.status <> 'em_analise' THEN RAISE EXCEPTION 'Esta solicitação já foi decidida (%).', s.status; END IF;
  IF NOT public.malote_excecao_pode_decidir(s.classificacao_id, auth.uid()) THEN
    RAISE EXCEPTION 'Só o Aprovador Nível 2 da classificação pode decidir esta exceção.';
  END IF;
  IF s.solicitante_id = auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Você não pode decidir a própria solicitação.';
  END IF;
  IF NOT _aprovar AND btrim(COALESCE(_motivo, '')) = '' THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.';
  END IF;

  IF _aprovar THEN
    LOOP
      v_senha := 'EXC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.malote_excecao_solicitacao WHERE senha = v_senha);
    END LOOP;
    UPDATE public.malote_excecao_solicitacao
       SET status = 'aprovada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = NULLIF(btrim(COALESCE(_motivo, '')), ''),
           senha = v_senha, senha_expira_em = now() + interval '24 hours', updated_at = now()
     WHERE id = _id;
    INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
    VALUES (_id, 'aprovada', auth.uid(), 'Exceção aprovada. Senha gerada, válida por 24 horas.');
    PERFORM public.malote_notificar_usuarios(
      ARRAY[s.solicitante_id], s.empresa_id,
      'Exceção aprovada — senha liberada',
      format('A exceção %s foi aprovada. Use a senha na criação da despesa em até 24 horas. Veja em Malote › Solicitar Exceção.', s.numero),
      'malote_excecao', '/app/malote/excecao/solicitar'
    );
    RETURN v_senha;
  END IF;

  UPDATE public.malote_excecao_solicitacao
     SET status = 'reprovada', decidido_por = auth.uid(), decidido_em = now(), motivo_decisao = btrim(_motivo), updated_at = now()
   WHERE id = _id;
  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'reprovada', auth.uid(), 'Exceção reprovada: ' || btrim(_motivo));
  PERFORM public.malote_notificar_usuarios(
    ARRAY[s.solicitante_id], s.empresa_id,
    'Exceção reprovada',
    format('A exceção %s foi reprovada. Motivo: %s', s.numero, btrim(_motivo)),
    'malote_excecao', '/app/malote/excecao/solicitar'
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.malote_excecao_cancelar(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
  IF s.solicitante_id <> auth.uid() THEN RAISE EXCEPTION 'Só quem pediu pode cancelar.'; END IF;
  IF s.status NOT IN ('em_analise', 'aprovada') THEN RAISE EXCEPTION 'Esta solicitação não pode mais ser cancelada (%).', s.status; END IF;
  UPDATE public.malote_excecao_solicitacao SET status = 'cancelada', updated_at = now() WHERE id = _id;
  INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
  VALUES (_id, 'cancelada', auth.uid(), 'Solicitação cancelada por quem pediu.');
END;
$$;

-- Confere a senha digitada na criação da despesa (só devolve os dados; quem consome é o gatilho do BLOCO 4).
CREATE OR REPLACE FUNCTION public.malote_excecao_validar_senha(_senha text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão ausente.'; END IF;
  SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE senha = upper(btrim(COALESCE(_senha, '')));
  IF NOT FOUND THEN RAISE EXCEPTION 'Senha de exceção não encontrada.'; END IF;
  IF s.solicitante_id <> auth.uid() THEN RAISE EXCEPTION 'Esta senha pertence a outro solicitante.'; END IF;
  IF s.status = 'utilizada' THEN RAISE EXCEPTION 'Esta senha já foi utilizada.'; END IF;
  IF s.status <> 'aprovada' THEN RAISE EXCEPTION 'Esta senha não está ativa (%).', s.status; END IF;
  IF now() > s.senha_expira_em THEN RAISE EXCEPTION 'Esta senha expirou (valia 24 horas a partir da aprovação). Faça uma nova solicitação.'; END IF;
  RETURN jsonb_build_object(
    'id', s.id, 'numero', s.numero, 'tipo', s.tipo, 'classificacao_id', s.classificacao_id, 'contrato_id', s.contrato_id,
    'empresa_id', s.empresa_id, 'valor', s.valor, 'data_pagamento', s.data_pagamento, 'descricao', s.descricao,
    'justificativa', s.justificativa, 'senha_expira_em', s.senha_expira_em
  );
END;
$$;

REVOKE ALL ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.malote_excecao_decidir(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.malote_excecao_cancelar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.malote_excecao_validar_senha(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.malote_excecao_decidir(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.malote_excecao_cancelar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.malote_excecao_validar_senha(text) TO authenticated;

-- BLOCO 4 ─ a despesa só vira exceção com a senha (gatilho roda ANTES do de bloqueio: "0_" ordena primeiro)
CREATE OR REPLACE FUNCTION public.malote_despesa_exige_senha_excecao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s public.malote_excecao_solicitacao%ROWTYPE;
BEGIN
  IF NEW.excecao_solicitacao_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.excecao_solicitacao_id IS DISTINCT FROM NEW.excecao_solicitacao_id) THEN
    SELECT * INTO s FROM public.malote_excecao_solicitacao WHERE id = NEW.excecao_solicitacao_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação de exceção não encontrada.'; END IF;
    IF s.status <> 'aprovada' THEN RAISE EXCEPTION 'A exceção % não está ativa (%).', s.numero, s.status; END IF;
    IF now() > s.senha_expira_em THEN RAISE EXCEPTION 'A senha da exceção % expirou. Faça uma nova solicitação.', s.numero; END IF;
    IF auth.uid() IS NOT NULL AND s.solicitante_id <> auth.uid() THEN
      RAISE EXCEPTION 'A exceção % foi pedida por outro usuário.', s.numero;
    END IF;
    IF NEW.data_pagamento IS DISTINCT FROM s.data_pagamento THEN
      RAISE EXCEPTION 'A exceção % libera só a data % — a despesa está com outra data.', s.numero, to_char(s.data_pagamento, 'DD/MM/YYYY');
    END IF;
    IF NEW.valor_total > s.valor + 0.005 THEN
      RAISE EXCEPTION 'A exceção % libera até R$ % — a despesa passa desse valor.', s.numero, to_char(s.valor, 'FM999G999G990D00');
    END IF;
    IF NEW.classificacao_id IS NOT NULL AND NEW.classificacao_id <> s.classificacao_id THEN
      RAISE EXCEPTION 'A exceção % é de outra classificação.', s.numero;
    END IF;

    UPDATE public.malote_excecao_solicitacao
       SET status = 'utilizada', usada_em = now(), despesa_id = NEW.id, updated_at = now()
     WHERE id = s.id;
    INSERT INTO public.malote_excecao_solicitacao_evento (solicitacao_id, tipo_evento, ator_user_id, descricao)
    VALUES (s.id, 'senha_utilizada', auth.uid(), 'Senha utilizada na criação de uma despesa do Malote.');

    NEW.excecao := true;
    NEW.justificativa_excecao := COALESCE(NULLIF(btrim(COALESCE(NEW.justificativa_excecao, '')), ''), s.justificativa);
  ELSIF NEW.excecao AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.excecao, false)) AND NEW.excecao_solicitacao_id IS NULL THEN
    RAISE EXCEPTION 'Lançar como exceção exige a senha de uma solicitação de exceção aprovada (Malote › Solicitar Exceção).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS malote_despesa_0_excecao_senha ON public.malote_despesa;
CREATE TRIGGER malote_despesa_0_excecao_senha
  BEFORE INSERT OR UPDATE ON public.malote_despesa
  FOR EACH ROW EXECUTE FUNCTION public.malote_despesa_exige_senha_excecao();

-- BLOCO 5 ─ gatilho de bloqueio de data completo (piso + 1.1 + 2.1 + liberação por classificação)
CREATE OR REPLACE FUNCTION public.malote_bloqueia_dia_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_impedir boolean;
  v_prazo_normal date;
  v_limite_excecao time;
  v_agora_local timestamp;
BEGIN
  IF NEW.data_pagamento IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data_pagamento IS NOT DISTINCT FROM NEW.data_pagamento THEN RETURN NEW; END IF;

  -- data_pagamento é também a data REAL do pagamento confirmado (despesa_paga): fora das checagens.
  IF NEW.status = 'despesa_paga' THEN RETURN NEW; END IF;

  v_agora_local := now() AT TIME ZONE 'America/Sao_Paulo';

  -- SIS-2026-0361: piso absoluto — data no passado nunca, nem como exceção.
  IF NEW.data_pagamento < v_agora_local::date THEN
    RAISE EXCEPTION 'Data de pagamento % é anterior a hoje (%) — não é permitido, nem como exceção. Se a despesa já existe com essa data, use "Pedir ajuste" para corrigir.', NEW.data_pagamento, v_agora_local::date;
  END IF;

  IF NEW.excecao THEN
    -- Regra 2.1: mesmo como exceção, pagamento para HOJE depois do horário-limite de inclusão não passa.
    IF NEW.data_pagamento = v_agora_local::date THEN
      SELECT excecao_limite_inclusao_horario INTO v_limite_excecao FROM public.malote_config WHERE id = true;
      IF v_agora_local::time > v_limite_excecao THEN
        RAISE EXCEPTION 'Já passou do horário limite (%) para incluir exceção com pagamento hoje.', v_limite_excecao;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Regra 1.1 (SIS-2026-0250): data mais cedo que o prazo normal exige exceção. Sem sessão (job de rolagem,
  -- SIS-2026-0664) a regra não se aplica: o job só empurra a data para a frente.
  IF auth.uid() IS NOT NULL THEN
    v_prazo_normal := public.malote_prazo_normal_inclusao();
    IF NEW.data_pagamento < v_prazo_normal THEN
      RAISE EXCEPTION 'Data de pagamento % está fora do prazo normal de inclusão (regra 1.1 das Configurações do Malote; hoje o prazo normal é %) — peça uma exceção em Malote › Solicitar Exceção.', NEW.data_pagamento, v_prazo_normal;
    END IF;
  END IF;

  SELECT bloqueio_impedir_lancamento INTO v_impedir FROM public.malote_config WHERE id = true;

  IF v_impedir AND public.malote_dia_esta_bloqueado(NEW.data_pagamento, NEW.classificacao_id) THEN
    RAISE EXCEPTION 'Data de pagamento % está bloqueada no Malote (dia bloqueado, feriado ou fim de semana) — peça uma exceção em Malote › Solicitar Exceção.', NEW.data_pagamento;
  END IF;

  RETURN NEW;
END;
$$;

-- BLOCO 6 ─ menus (fase 1: Solicitar e Aprovar; a fase 2 traz Autorizações e Minhas Solicitações)
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_excecao_solicitar', 'Malote — Solicitar Exceção', '/app/malote/excecao/solicitar', 20
  FROM public.app_modulo m WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, 'malote_excecao_aprovar', 'Malote — Aprovar Exceções', '/app/malote/excecao/aprovar', 21
  FROM public.app_modulo m WHERE m.codigo = 'malote'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, mc.menu_codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('malote_excecao_solicitar'), ('malote_excecao_aprovar')) AS mc(menu_codigo)
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao), ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DROP TRIGGER IF EXISTS malote_despesa_0_excecao_senha ON public.malote_despesa;
--   DROP FUNCTION IF EXISTS public.malote_despesa_exige_senha_excecao();
--   ALTER TABLE public.malote_despesa DROP COLUMN IF EXISTS excecao_solicitacao_id;
--   DROP FUNCTION IF EXISTS public.malote_excecao_validar_senha(text);
--   DROP FUNCTION IF EXISTS public.malote_excecao_cancelar(uuid);
--   DROP FUNCTION IF EXISTS public.malote_excecao_decidir(uuid, boolean, text);
--   DROP FUNCTION IF EXISTS public.malote_excecao_solicitar(text, uuid, uuid, uuid, numeric, date, text, text);
--   DROP FUNCTION IF EXISTS public.malote_excecao_pode_decidir(uuid, uuid);
--   DROP TABLE IF EXISTS public.malote_excecao_solicitacao_evento;
--   DROP TABLE IF EXISTS public.malote_excecao_solicitacao;
--   DROP SEQUENCE IF EXISTS public.malote_excecao_solicitacao_seq;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('malote_excecao_solicitar', 'malote_excecao_aprovar');
--   DELETE FROM public.app_menu WHERE codigo IN ('malote_excecao_solicitar', 'malote_excecao_aprovar');
--   (a função malote_bloqueia_dia_pagamento volta ao CREATE OR REPLACE de 20260930000274)
--   NOTIFY pgrst, 'reload schema';
