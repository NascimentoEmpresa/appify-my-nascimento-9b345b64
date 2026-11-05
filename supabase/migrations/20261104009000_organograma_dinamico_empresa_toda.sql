-- =========================================================================
-- ORGANOGRAMA 100% DINÂMICO — A EMPRESA TODA, LIGADA AO CADASTRO (04/11/2026)
--
-- CHAMADO (a dona, por intermédio do Pablo): o organograma é desenhado à mão,
-- não conversa com o cadastro; toda contratação, desligamento ou promoção
-- vira trabalho da TI; não dá para ver quem está em qual contrato nem o
-- histórico de lideranças; e o RH/lideranças não têm onde decidir movimentação
-- com base no desempenho por contrato. Pablo: "ao criar um usuário tem que
-- definir o que ele faz e onde ele fica no organograma também, e no organograma
-- vincula cada usuário a ele".
--
-- O QUE JÁ EXISTIA (e continua): ORGANOGRAMA_NO (mig 277) com "reporta a",
-- pares no mesmo nível, cor e trava de ciclo — mas só aceitava USUÁRIO do ERP,
-- e são ~2.500 colaboradores ativos, a maioria sem login. Hierarquia de Postos
-- da Senior (mig 20261007000024), posto efetivo (mig 20261008000005).
--
-- DESENHO
--   · Um nó por pessoa, venha do cadastro (empregado_id), do login (user_id) ou
--     dos dois. A árvore continua UMA só: nada de segundo organograma.
--   · Foto, nome, cargo, posto, setor e contrato NÃO são copiados: saem na
--     leitura do cadastro. Só "reporta a", função escrita à mão e contratos
--     extras moram no nó — por isso a sincronia da Senior não desfaz nada.
--   · Gatilho em EMPREGADOS: contratou → entra; desligou → sai e a equipe sobe
--     para o chefe dele; trocou cargo/posto/contrato → fica no histórico. Erro
--     no gatilho vira WARNING: organograma nunca pode travar a carga da Senior.
--   · O superior é definido UMA vez (pelo operador) e fica. Enquanto ninguém
--     define, o sistema tenta deduzir: 1º o ocupante do posto líder acima na
--     Hierarquia de Postos (só se for UM); 2º o responsável único do contrato.
--     Sem certeza não chuta: a pessoa fica em "Sem superior" (Pendências), para
--     o operador escolher — sozinha ou em lote.
--   · Líder mudou de posição: quem moveu escolhe se a equipe direta acompanha,
--     volta para o chefe anterior ou passa para um novo líder. A trava de ciclo
--     e o "apagar sobe os subordinados" continuam valendo.
--   · Contrato: o da pessoa é (Empresa, Filial) do cadastro; contratos extras em
--     ORGANOGRAMA_NO_CONTRATO cobrem quem lidera mais de uma operação.
--   · Histórico: ORGANOGRAMA_MOVIMENTACAO (mudanças e feedback), lido junto com
--     Advertências (Jurídico) e Troca de Função (RH) — essas duas são lidas ao
--     vivo, sem copiar e sem gatilho nas tabelas delas.
--
-- ACESSO
--   organograma        visualizar = ver a árvore; incluir/alterar = montar;
--                      excluir = tirar pessoa (como já era — mig 277).
--   organograma_gestao menu NOVO (/app/organograma/gestao): visualizar = Dashboard
--                      e histórico de qualquer pessoa; incluir = registrar
--                      feedback em qualquer pessoa. Nasce só para o Pablo; o resto
--                      se libera em Administração › Acesso por Usuário (o toggle
--                      já concede as duas ações).
--   Líder vê o histórico e registra feedback de quem está ABAIXO dele na árvore,
--   sem precisar do menu.
--   Definir a posição também vale para quem cria usuário (administracao) e para
--   quem edita o cadastro (colaboradores/alterar), senão o campo obrigatório
--   travaria quem tem essas telas e não o Organograma.
--
-- Idempotente. Rodou em banco descartável com cadastro de teste (ver PR).
-- ROLLBACK no fim.
-- =========================================================================

-- ── 1) Menu ──────────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'organograma_gestao', 'Dashboard de Gestão', '/app/organograma/gestao', 15, true
  FROM public.app_modulo m WHERE m.codigo = 'organograma'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'organograma_gestao', a::public.app_acao
  FROM unnest(ARRAY['visualizar','incluir']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

INSERT INTO public.screen_permission_user (user_id, menu_codigo, acao, allow, empresa_id, motivo)
SELECT p.id, 'organograma_gestao', a.acao::public.app_acao, true, NULL, 'Organograma dinâmico: primeiro acesso, libera os demais'
  FROM public.profiles p
 CROSS JOIN (VALUES ('visualizar'), ('incluir')) AS a(acao)
 WHERE p.ativo AND upper(btrim(p.display_name)) = 'PABLO FLORES SANTAREM'
ON CONFLICT (user_id, menu_codigo, acao, empresa_id) DO NOTHING;

-- ── 2) O nó passa a aceitar colaborador sem login ────────────────────────
ALTER TABLE public."ORGANOGRAMA_NO" ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public."ORGANOGRAMA_NO" ADD COLUMN IF NOT EXISTS empregado_id bigint;          -- EMPREGADOS."ID". Sem FK: a sincronia apaga linhas de lá (ver mig 20261008000005).
ALTER TABLE public."ORGANOGRAMA_NO" ADD COLUMN IF NOT EXISTS superior_pendente boolean NOT NULL DEFAULT false;
ALTER TABLE public."ORGANOGRAMA_NO" ADD COLUMN IF NOT EXISTS superior_origem text NOT NULL DEFAULT 'manual';

ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT IF EXISTS organograma_no_superior_origem;
ALTER TABLE public."ORGANOGRAMA_NO"
  ADD CONSTRAINT organograma_no_superior_origem CHECK (superior_origem IN ('manual', 'posto', 'contrato', 'sem'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_organograma_no_empregado
  ON public."ORGANOGRAMA_NO"(empregado_id) WHERE empregado_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organograma_no_pendente
  ON public."ORGANOGRAMA_NO"(superior_pendente) WHERE superior_pendente;

-- Excluir o login de um colaborador ativo não pode tirá-lo da árvore: troca o
-- CASCADE da mig 277 por SET NULL (o gatilho abaixo apaga quem ficou sem nada).
-- O nome da constraint é procurado: o banco veio de replicação (mig 20261030000100).
DO $$
DECLARE v_c record;
BEGIN
  FOR v_c IN
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = 'public."ORGANOGRAMA_NO"'::regclass AND c.contype = 'f'
       AND c.confrelid = 'auth.users'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT %I', v_c.conname);
  END LOOP;
END $$;
ALTER TABLE public."ORGANOGRAMA_NO"
  ADD CONSTRAINT organograma_no_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- A busca do superior pelo posto olha um posto de cada vez.
CREATE INDEX IF NOT EXISTS idx_empregados_posto ON public."EMPREGADOS" ("Posto");

-- Quem lidera mais de um contrato. O contrato do cadastro não entra aqui.
CREATE TABLE IF NOT EXISTS public."ORGANOGRAMA_NO_CONTRATO" (
  no_id       uuid NOT NULL REFERENCES public."ORGANOGRAMA_NO"(id) ON DELETE CASCADE,
  empresa     bigint NOT NULL,
  filial      bigint NOT NULL,
  criado_por  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (no_id, empresa, filial)
);
CREATE INDEX IF NOT EXISTS idx_organograma_no_contrato_no ON public."ORGANOGRAMA_NO_CONTRATO" (no_id);
CREATE INDEX IF NOT EXISTS idx_organograma_no_contrato_filial ON public."ORGANOGRAMA_NO_CONTRATO" (empresa, filial);

ALTER TABLE public."ORGANOGRAMA_NO_CONTRATO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ORGANOGRAMA_NO_CONTRATO" FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS organograma_no_contrato_select ON public."ORGANOGRAMA_NO_CONTRATO";
CREATE POLICY organograma_no_contrato_select ON public."ORGANOGRAMA_NO_CONTRATO" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'organograma', 'visualizar'::public.app_acao)));
GRANT SELECT ON public."ORGANOGRAMA_NO_CONTRATO" TO authenticated;

-- ── 3) Histórico de movimentações ────────────────────────────────────────
-- Contrato e setor ficam congelados: a movimentação pesa no contrato em que a
-- pessoa estava naquele dia, mesmo que ela saia de lá depois.
CREATE TABLE IF NOT EXISTS public."ORGANOGRAMA_MOVIMENTACAO" (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empregado_id   bigint,
  user_id        uuid,
  pessoa_nome    text NOT NULL,
  tipo           text NOT NULL,
  natureza       text NOT NULL DEFAULT 'neutra',
  titulo         text NOT NULL,
  descricao      text,
  valor_antes    text,
  valor_depois   text,
  empresa        bigint,
  filial         bigint,
  contrato_nome  text,
  setor          text,
  data_evento    date NOT NULL DEFAULT current_date,
  origem         text NOT NULL DEFAULT 'automatico',
  autor_id       uuid,
  autor_nome     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organograma_mov_natureza CHECK (natureza IN ('positiva', 'negativa', 'neutra')),
  CONSTRAINT organograma_mov_origem   CHECK (origem IN ('automatico', 'manual')),
  CONSTRAINT organograma_mov_tipo     CHECK (tipo IN (
    'admissao', 'readmissao', 'desligamento', 'transferencia', 'troca_superior', 'troca_cargo',
    'troca_funcao', 'troca_posto', 'troca_contrato', 'promocao', 'transferencia_escopo',
    'elogio', 'feedback', 'ocorrencia', 'outro'))
);
CREATE INDEX IF NOT EXISTS idx_organograma_mov_empregado ON public."ORGANOGRAMA_MOVIMENTACAO" (empregado_id, data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_organograma_mov_user      ON public."ORGANOGRAMA_MOVIMENTACAO" (user_id, data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_organograma_mov_contrato  ON public."ORGANOGRAMA_MOVIMENTACAO" (empresa, filial, data_evento DESC);
CREATE INDEX IF NOT EXISTS idx_organograma_mov_data      ON public."ORGANOGRAMA_MOVIMENTACAO" (data_evento DESC);

-- Leitura e escrita só pelas RPCs: nelas mora a regra "o líder vê a própria
-- equipe". A policy existe para quem tem o menu; não há policy de escrita.
ALTER TABLE public."ORGANOGRAMA_MOVIMENTACAO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."ORGANOGRAMA_MOVIMENTACAO" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."ORGANOGRAMA_MOVIMENTACAO" TO authenticated;
DROP POLICY IF EXISTS organograma_mov_select ON public."ORGANOGRAMA_MOVIMENTACAO";
CREATE POLICY organograma_mov_select ON public."ORGANOGRAMA_MOVIMENTACAO" FOR SELECT TO authenticated
  USING ((SELECT public.can_access(auth.uid(), 'organograma_gestao', 'visualizar'::public.app_acao)));

-- ── 4) Ajudantes ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organograma_ativo(_situacao text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT upper(btrim(coalesce(_situacao, ''))) NOT IN ('DEMITIDO', 'DEMITIDA', 'RESCISÃO', 'RESCISAO', 'DESLIGADO', 'DESLIGADA')
$$;

CREATE OR REPLACE FUNCTION public.organograma_so_digitos(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(regexp_replace(coalesce(_t, ''), '\D', '', 'g'), '')
$$;

-- "1109 - POLICIA CIVIL..." — com o código na frente, como no resto do RH
-- (colaboradoresUtils.nomeContratoDe).
CREATE OR REPLACE FUNCTION public.organograma_contrato_rotulo(_filial bigint, _nome text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN nullif(btrim(_nome), '') IS NULL THEN _filial::text
    WHEN _filial IS NULL OR btrim(_nome) ~ '^\d+\s*-' THEN btrim(_nome)
    ELSE _filial::text || ' - ' || btrim(_nome)
  END
$$;

CREATE OR REPLACE FUNCTION public.organograma_contrato_nome(_empresa bigint, _filial bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.organograma_contrato_rotulo(_filial, coalesce(
    (SELECT c."NOME CONTRATO" FROM public."CONTRATOS" c
      WHERE c."Empresa" = _empresa AND c."Filial" = _filial
      ORDER BY (c."ATIVO" = 'SIM') DESC NULLS LAST LIMIT 1),
    (SELECT max(e."Nome Filial")::text FROM public."EMPREGADOS" e
      WHERE e."Empresa" = _empresa AND e."Filial" = _filial)))
$$;

CREATE OR REPLACE FUNCTION public.organograma_nome_no(_no uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT nullif(btrim(e."Nome"), '') FROM public."EMPREGADOS" e WHERE e."ID" = o.empregado_id),
    (SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) FROM public.profiles p WHERE p.id = o.user_id),
    'Pessoa')
    FROM public."ORGANOGRAMA_NO" o WHERE o.id = _no
$$;

-- O posto vale o do ERP se houver ajuste, senão o da Senior (mig 20261008000005).
CREATE OR REPLACE FUNCTION public.organograma_posto_efetivo(_empregado bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN a.empregado_id IS NOT NULL THEN a.posto_codigo ELSE e."Posto"::text END
    FROM public."EMPREGADOS" e
    LEFT JOIN public."RH_POSTO_OCUPANTE_ERP" a ON a.empregado_id = e."ID"
   WHERE e."ID" = _empregado
$$;

-- Anotar movimentação. Autor: quem está logado ou, vindo da Edge Function
-- (service_role, sem auth.uid()), o que ela informou.
CREATE OR REPLACE FUNCTION public.organograma_mov_inserir(
  _empregado bigint, _user uuid, _tipo text, _natureza text, _titulo text, _descricao text,
  _antes text, _depois text, _data date DEFAULT NULL, _origem text DEFAULT 'automatico', _nome text DEFAULT NULL,
  _empresa bigint DEFAULT NULL, _filial bigint DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nome text := _nome; v_emp bigint := _empresa; v_fil bigint := _filial; v_setor text;
  v_autor uuid := coalesce(auth.uid(), nullif(current_setting('organograma.autor', true), '')::uuid);
  v_autor_nome text;
BEGIN
  IF _empregado IS NOT NULL THEN
    SELECT coalesce(v_nome, e."Nome"::text), coalesce(v_emp, e."Empresa"::bigint), coalesce(v_fil, e."Filial"::bigint),
           nullif(btrim(e."Setor_ERP"::text), '')
      INTO v_nome, v_emp, v_fil, v_setor
      FROM public."EMPREGADOS" e WHERE e."ID" = _empregado;
  END IF;
  IF v_nome IS NULL AND _user IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) INTO v_nome FROM public.profiles p WHERE p.id = _user;
  END IF;
  IF v_setor IS NULL AND _user IS NOT NULL THEN
    SELECT min(us.setor) INTO v_setor FROM public.user_setor us WHERE us.user_id = _user;
  END IF;
  IF v_autor IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) INTO v_autor_nome FROM public.profiles p WHERE p.id = v_autor;
  END IF;
  INSERT INTO public."ORGANOGRAMA_MOVIMENTACAO"
    (empregado_id, user_id, pessoa_nome, tipo, natureza, titulo, descricao, valor_antes, valor_depois,
     empresa, filial, contrato_nome, setor, data_evento, origem, autor_id, autor_nome)
  VALUES
    (_empregado, _user, coalesce(v_nome, 'Pessoa'), _tipo, _natureza, _titulo, nullif(btrim(coalesce(_descricao, '')), ''),
     _antes, _depois, v_emp, v_fil,
     CASE WHEN v_fil IS NOT NULL THEN public.organograma_contrato_nome(v_emp, v_fil) END,
     v_setor, coalesce(_data, current_date), _origem, v_autor,
     coalesce(v_autor_nome, CASE WHEN _origem = 'automatico' THEN 'Sistema' END));
END $$;

-- ── 5) Gatilhos no nó: pendência, sobra, histórico ───────────────────────
CREATE OR REPLACE FUNCTION public.organograma_no_normaliza()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    IF NEW.parent_id IS NOT NULL THEN
      NEW.superior_pendente := false;
      -- Quem deduz (recálculo) grava a origem; o resto é decisão de alguém.
      IF coalesce(current_setting('organograma.auto', true), '') = '' THEN
        NEW.superior_origem := 'manual';
      END IF;
    ELSIF coalesce(current_setting('organograma.topo', true), '') = '' THEN
      -- O chefe saiu e não havia ninguém acima: não vira topo da empresa por
      -- acidente, vai para as Pendências. "Fica no topo" é escolha explícita.
      NEW.superior_pendente := true;
      NEW.superior_origem := 'sem';
    ELSE
      NEW.superior_pendente := false;
      NEW.superior_origem := 'manual';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_organograma_no_normaliza ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_normaliza
  BEFORE UPDATE OF parent_id ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_no_normaliza();

-- Excluíram o login de quem não tem cadastro: sem nada que o identifique.
CREATE OR REPLACE FUNCTION public.organograma_no_sem_pessoa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.empregado_id IS NULL THEN
    DELETE FROM public."ORGANOGRAMA_NO" WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_organograma_no_sem_pessoa ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_sem_pessoa
  AFTER UPDATE OF user_id ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_no_sem_pessoa();

-- Toda troca de superior e de função fica no perfil do liderado. É daqui que
-- sai o "histórico das lideranças diretas" do chamado, qualquer que seja o
-- caminho da mudança (tela, arrastar, equipe que subiu porque o chefe saiu).
CREATE OR REPLACE FUNCTION public.organograma_no_registrar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_motivo text := nullif(current_setting('organograma.motivo', true), '');
BEGIN
  IF coalesce(current_setting('organograma.silencio', true), '') = '1' THEN RETURN NULL; END IF;
  -- Equipe que responde a um GRUPO de pares só trocou de "ponteiro" entre os
  -- pares (mig 20261030000100): a liderança real não mudou.
  IF NEW.parent_id IS DISTINCT FROM OLD.parent_id AND NOT (OLD.do_grupo AND NEW.do_grupo) THEN
    PERFORM public.organograma_mov_inserir(
      NEW.empregado_id, NEW.user_id, 'troca_superior', 'neutra',
      CASE WHEN NEW.parent_id IS NULL THEN 'Ficou sem superior imediato'
           WHEN OLD.parent_id IS NULL THEN 'Superior imediato definido'
           ELSE 'Mudança de superior imediato' END,
      v_motivo,
      coalesce(public.organograma_nome_no(OLD.parent_id), '—'),
      coalesce(public.organograma_nome_no(NEW.parent_id), '—'));
  END IF;
  IF nullif(btrim(coalesce(NEW.funcao, '')), '') IS DISTINCT FROM nullif(btrim(coalesce(OLD.funcao, '')), '') THEN
    PERFORM public.organograma_mov_inserir(
      NEW.empregado_id, NEW.user_id, 'troca_funcao', 'neutra', 'Função no organograma alterada', v_motivo,
      coalesce(nullif(btrim(coalesce(OLD.funcao, '')), ''), '—'),
      coalesce(nullif(btrim(coalesce(NEW.funcao, '')), ''), '—'));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_organograma_no_registrar ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_registrar
  AFTER UPDATE OF parent_id, funcao ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_no_registrar();

-- ── 6) Deduzir o superior ────────────────────────────────────────────────
-- Sobe a Hierarquia de Postos a partir do posto da pessoa até o primeiro posto
-- OCUPADO. Um ocupante: é ele. Vários: fica com o do mesmo contrato, se isso
-- deixar um só; senão devolve NULL — sem certeza, não chuta.
CREATE OR REPLACE FUNCTION public.organograma_superior_por_posto(_empregado bigint)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_posto text := public.organograma_posto_efetivo(_empregado);
  v_emp bigint; v_fil bigint; v_ids uuid[]; v_mesmo uuid[]; n int := 0;
BEGIN
  IF v_posto IS NULL THEN RETURN NULL; END IF;
  SELECT e."Empresa"::bigint, e."Filial"::bigint INTO v_emp, v_fil FROM public."EMPREGADOS" e WHERE e."ID" = _empregado;
  LOOP
    SELECT h.pai_codigo INTO v_posto FROM public."RH_POSTO_HIERARQUIA" h WHERE h.posto_codigo = v_posto;
    n := n + 1;
    IF v_posto IS NULL OR n > 20 THEN RETURN NULL; END IF;

    SELECT array_agg(x.id), array_agg(x.id) FILTER (WHERE x.emp = v_emp AND x.fil = v_fil)
      INTO v_ids, v_mesmo
      FROM (
        SELECT o.id, e."Empresa"::bigint AS emp, e."Filial"::bigint AS fil
          FROM public."EMPREGADOS" e
          JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = e."ID"
         WHERE e."Posto" = v_posto AND e."ID" <> _empregado AND public.organograma_ativo(e."Situação"::text)
           AND NOT EXISTS (SELECT 1 FROM public."RH_POSTO_OCUPANTE_ERP" a WHERE a.empregado_id = e."ID")
        UNION
        SELECT o.id, e."Empresa"::bigint, e."Filial"::bigint
          FROM public."RH_POSTO_OCUPANTE_ERP" a
          JOIN public."EMPREGADOS" e ON e."ID" = a.empregado_id
          JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = e."ID"
         WHERE a.posto_codigo = v_posto AND e."ID" <> _empregado AND public.organograma_ativo(e."Situação"::text)
      ) x;

    IF coalesce(array_length(v_ids, 1), 0) = 1 THEN RETURN v_ids[1]; END IF;
    IF coalesce(array_length(v_ids, 1), 0) > 1 THEN
      RETURN CASE WHEN coalesce(array_length(v_mesmo, 1), 0) = 1 THEN v_mesmo[1] END;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.organograma_fecha_ciclo(_no uuid, _parent uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid := _parent; n int := 0;
BEGIN
  WHILE v IS NOT NULL AND n < 500 LOOP
    IF v = _no THEN RETURN true; END IF;
    SELECT o.parent_id INTO v FROM public."ORGANOGRAMA_NO" o WHERE o.id = v;
    n := n + 1;
  END LOOP;
  RETURN false;
END $$;

-- Liga quem está pendente pela dedução. Silencioso: é a estrutura se montando,
-- e não um fato da vida da pessoa — senão o histórico nasce com 2.500 linhas.
CREATE OR REPLACE FUNCTION public.organograma_tentar_ligar(_no uuid, _parent uuid, _origem text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF _parent IS NULL OR _parent = _no OR public.organograma_fecha_ciclo(_no, _parent) THEN RETURN false; END IF;
  PERFORM set_config('organograma.auto', '1', true);
  PERFORM set_config('organograma.silencio', '1', true);
  UPDATE public."ORGANOGRAMA_NO"
     SET parent_id = _parent, superior_origem = _origem,
         ordem = (SELECT count(*) FROM public."ORGANOGRAMA_NO" i WHERE i.parent_id = _parent)
   WHERE id = _no;
  PERFORM set_config('organograma.auto', '', true);
  PERFORM set_config('organograma.silencio', '', true);
  RETURN true;
END $$;

-- ── 7) Cadastro → organograma ────────────────────────────────────────────
-- Login e cadastro são a mesma pessoa: se havia um nó de cada, junta no do
-- login (é o que alguém montou à mão) e leva a equipe junto.
CREATE OR REPLACE FUNCTION public.organograma_vincular_login(_empregado bigint, _user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e public."ORGANOGRAMA_NO"%ROWTYPE; v_u public."ORGANOGRAMA_NO"%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM public."ORGANOGRAMA_NO" WHERE empregado_id = _empregado;
  IF _user IS NULL THEN
    -- Desvinculou: o nó fica com o cadastro e o login sai dele.
    IF v_e.id IS NOT NULL AND v_e.user_id IS NOT NULL THEN
      UPDATE public."ORGANOGRAMA_NO" SET user_id = NULL WHERE id = v_e.id;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO v_u FROM public."ORGANOGRAMA_NO" WHERE user_id = _user;

  IF v_e.id IS NOT NULL AND v_u.id IS NOT NULL AND v_e.id <> v_u.id THEN
    PERFORM set_config('organograma.silencio', '1', true);
    UPDATE public."ORGANOGRAMA_NO" SET parent_id = v_u.id WHERE parent_id = v_e.id AND id <> v_u.id;
    DELETE FROM public."ORGANOGRAMA_NO" WHERE id = v_e.id;
    UPDATE public."ORGANOGRAMA_NO" SET empregado_id = _empregado WHERE id = v_u.id;
    PERFORM set_config('organograma.silencio', '', true);
  ELSIF v_e.id IS NOT NULL THEN
    UPDATE public."ORGANOGRAMA_NO" SET user_id = _user WHERE id = v_e.id;
  ELSIF v_u.id IS NOT NULL THEN
    UPDATE public."ORGANOGRAMA_NO" SET empregado_id = _empregado WHERE id = v_u.id;
  END IF;
END $$;

-- Pessoa ficou ativa: entra na árvore. Mesmo CPF com nó em outro cadastro é a
-- mesma pessoa (transferência entre empresas abre novo "ID"): o nó acompanha.
CREATE OR REPLACE FUNCTION public.organograma_empregado_entrou(_id bigint, _insert boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_e public."EMPREGADOS"%ROWTYPE; v_no uuid; v_cpf text; v_outro uuid; v_sup uuid; v_mudou boolean := false;
BEGIN
  SELECT * INTO v_e FROM public."EMPREGADOS" WHERE "ID" = _id;
  IF NOT FOUND OR coalesce(v_e."Nome"::text, '') ILIKE '%teste%' THEN RETURN; END IF;

  SELECT id INTO v_no FROM public."ORGANOGRAMA_NO" WHERE empregado_id = _id;
  IF v_no IS NULL THEN
    v_cpf := public.organograma_so_digitos(v_e."CPF"::text);
    IF v_cpf IS NOT NULL THEN
      SELECT o.id INTO v_outro
        FROM public."EMPREGADOS" x JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = x."ID"
       WHERE x."ID" <> _id AND public.organograma_so_digitos(x."CPF"::text) = v_cpf
         AND NOT public.organograma_ativo(x."Situação"::text)
       LIMIT 1;
      IF v_outro IS NOT NULL THEN
        UPDATE public."ORGANOGRAMA_NO" SET empregado_id = _id WHERE id = v_outro;
        v_no := v_outro; v_mudou := true;
      END IF;
    END IF;
  END IF;
  IF v_no IS NULL AND v_e.auth_user_id IS NOT NULL THEN
    UPDATE public."ORGANOGRAMA_NO" SET empregado_id = _id
     WHERE user_id = v_e.auth_user_id AND empregado_id IS NULL RETURNING id INTO v_no;
  END IF;
  IF v_no IS NULL THEN
    INSERT INTO public."ORGANOGRAMA_NO" (empregado_id, user_id, superior_pendente, superior_origem, ordem)
    VALUES (_id, v_e.auth_user_id, true, 'sem', 0)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_no;
  END IF;

  PERFORM public.organograma_mov_inserir(_id, v_e.auth_user_id,
    CASE WHEN v_mudou THEN 'transferencia' WHEN _insert THEN 'admissao' ELSE 'readmissao' END, 'neutra',
    CASE WHEN v_mudou THEN 'Transferência de cadastro' WHEN _insert THEN 'Entrou na empresa' ELSE 'Voltou à ativa' END,
    NULL, NULL, v_e."Título do Cargo"::text);

  IF v_no IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."ORGANOGRAMA_NO" o WHERE o.id = v_no AND o.superior_pendente) THEN
      v_sup := public.organograma_superior_por_posto(_id);
      PERFORM public.organograma_tentar_ligar(v_no, v_sup, 'posto');
    END IF;
    -- Chegou um líder: quem esperava alguém naquele ramo já se liga a ele.
    PERFORM public.organograma_tentar_ligar(o.id, public.organograma_superior_por_posto(o.empregado_id), 'posto')
       FROM public.rh_hier_descendentes(public.organograma_posto_efetivo(_id)) d
       JOIN public."EMPREGADOS" e ON e."Posto" = d.codigo
       JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = e."ID" AND o.superior_pendente AND o.id <> v_no;
  END IF;
END $$;

-- Pessoa saiu: a equipe sobe (organograma_no_sobe_filhos) e cada liderado
-- fica sabendo o motivo no próprio histórico.
CREATE OR REPLACE FUNCTION public.organograma_empregado_saiu(
  _id bigint, _nome text, _cpf text, _user uuid, _empresa bigint, _filial bigint, _cargo text, _removido boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no uuid; v_cpf text := public.organograma_so_digitos(_cpf); v_outro bigint; v_outro_no uuid;
BEGIN
  SELECT id INTO v_no FROM public."ORGANOGRAMA_NO" WHERE empregado_id = _id;
  IF v_no IS NULL THEN RETURN; END IF;

  IF v_cpf IS NOT NULL THEN
    SELECT x."ID"::bigint INTO v_outro FROM public."EMPREGADOS" x
     WHERE x."ID" <> _id AND public.organograma_so_digitos(x."CPF"::text) = v_cpf
       AND public.organograma_ativo(x."Situação"::text)
     ORDER BY x."ID" DESC LIMIT 1;
  END IF;
  IF v_outro IS NOT NULL THEN
    SELECT id INTO v_outro_no FROM public."ORGANOGRAMA_NO" WHERE empregado_id = v_outro;
    PERFORM set_config('organograma.silencio', '1', true);
    IF v_outro_no IS NOT NULL THEN
      -- O cadastro novo já tinha nó (entrou antes de o velho sair): o que vale
      -- é a posição que alguém definiu, a do cadastro que está saindo.
      UPDATE public."ORGANOGRAMA_NO" SET parent_id = v_no WHERE parent_id = v_outro_no;
      DELETE FROM public."ORGANOGRAMA_NO" WHERE id = v_outro_no;
    END IF;
    UPDATE public."ORGANOGRAMA_NO" SET empregado_id = v_outro WHERE id = v_no;
    PERFORM set_config('organograma.silencio', '', true);
    RETURN;
  END IF;

  PERFORM set_config('organograma.motivo',
    'Superior anterior ' || CASE WHEN _removido THEN 'saiu do cadastro' ELSE 'desligado' END || ': ' || coalesce(_nome, '—'), true);
  IF NOT _removido THEN
    PERFORM public.organograma_mov_inserir(_id, _user, 'desligamento', 'neutra', 'Desligado da empresa', NULL, _cargo, NULL,
      NULL, 'automatico', _nome, _empresa, _filial);
  END IF;
  DELETE FROM public."ORGANOGRAMA_NO" WHERE id = v_no;
  PERFORM set_config('organograma.motivo', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.organograma_empregado_gatilho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id bigint; v_antes boolean; v_agora boolean; v_no public."ORGANOGRAMA_NO"%ROWTYPE; v_sup uuid; v_pa text; v_pd text;
BEGIN
  -- O cadastro manda: organograma nenhum pode travar a carga da Senior.
  BEGIN
    IF TG_OP = 'DELETE' THEN
      PERFORM public.organograma_empregado_saiu(OLD."ID"::bigint, OLD."Nome"::text, OLD."CPF"::text, OLD.auth_user_id,
        OLD."Empresa"::bigint, OLD."Filial"::bigint, OLD."Título do Cargo"::text, NOT public.organograma_ativo(OLD."Situação"::text));
      RETURN NULL;
    END IF;

    v_id := NEW."ID"::bigint;
    v_agora := public.organograma_ativo(NEW."Situação"::text);
    v_antes := TG_OP = 'UPDATE' AND public.organograma_ativo(OLD."Situação"::text);

    IF v_agora AND NOT v_antes THEN
      PERFORM public.organograma_empregado_entrou(v_id, TG_OP = 'INSERT');
      RETURN NULL;
    END IF;
    IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;
    IF v_antes AND NOT v_agora THEN
      PERFORM public.organograma_empregado_saiu(v_id, NEW."Nome"::text, NEW."CPF"::text, NEW.auth_user_id,
        NEW."Empresa"::bigint, NEW."Filial"::bigint, NEW."Título do Cargo"::text, false);
      RETURN NULL;
    END IF;
    IF NOT v_agora THEN RETURN NULL; END IF;

    IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
      PERFORM public.organograma_vincular_login(v_id, NEW.auth_user_id);
    END IF;

    IF upper(btrim(coalesce(NEW."Título do Cargo"::text, ''))) IS DISTINCT FROM upper(btrim(coalesce(OLD."Título do Cargo"::text, ''))) THEN
      PERFORM public.organograma_mov_inserir(v_id, NEW.auth_user_id, 'troca_cargo', 'neutra', 'Mudança de cargo', NULL,
        coalesce(nullif(btrim(OLD."Título do Cargo"::text), ''), '—'), coalesce(nullif(btrim(NEW."Título do Cargo"::text), ''), '—'));
    END IF;

    v_pa := nullif(btrim(coalesce(OLD."Posto"::text, '')), ''); v_pd := nullif(btrim(coalesce(NEW."Posto"::text, '')), '');
    IF v_pa IS DISTINCT FROM v_pd THEN
      PERFORM public.organograma_mov_inserir(v_id, NEW.auth_user_id, 'troca_posto', 'neutra', 'Mudança de posto', NULL,
        coalesce(v_pa, '—'), coalesce(v_pd, '—'));
    END IF;

    IF NEW."Filial" IS DISTINCT FROM OLD."Filial" OR NEW."Empresa" IS DISTINCT FROM OLD."Empresa" THEN
      PERFORM public.organograma_mov_inserir(v_id, NEW.auth_user_id, 'troca_contrato', 'neutra', 'Mudança de contrato', NULL,
        coalesce(public.organograma_contrato_nome(OLD."Empresa"::bigint, OLD."Filial"::bigint), '—'),
        coalesce(public.organograma_contrato_nome(NEW."Empresa"::bigint, NEW."Filial"::bigint), '—'));
    END IF;

    -- Superior DEDUZIDO acompanha o posto/contrato novo. O definido por alguém
    -- fica: "deve ser vinculado a primeira vez" — só muda quando mudarem.
    IF v_pa IS DISTINCT FROM v_pd OR NEW."Filial" IS DISTINCT FROM OLD."Filial" OR NEW."Empresa" IS DISTINCT FROM OLD."Empresa" THEN
      SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE empregado_id = v_id;
      IF v_no.id IS NOT NULL AND (v_no.superior_pendente OR v_no.superior_origem IN ('posto', 'contrato')) THEN
        v_sup := public.organograma_superior_por_posto(v_id);
        IF v_sup IS DISTINCT FROM v_no.parent_id THEN
          PERFORM public.organograma_tentar_ligar(v_no.id, v_sup, 'posto');
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Organograma não acompanhou o cadastro %: %', coalesce(v_id, OLD."ID"::bigint), SQLERRM;
  END;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_organograma_empregado_ins ON public."EMPREGADOS";
CREATE TRIGGER trg_organograma_empregado_ins
  AFTER INSERT ON public."EMPREGADOS"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_empregado_gatilho();

DROP TRIGGER IF EXISTS trg_organograma_empregado_upd ON public."EMPREGADOS";
CREATE TRIGGER trg_organograma_empregado_upd
  AFTER UPDATE ON public."EMPREGADOS"
  FOR EACH ROW WHEN (
    OLD."Situação" IS DISTINCT FROM NEW."Situação"
    OR OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id
    OR OLD."Título do Cargo" IS DISTINCT FROM NEW."Título do Cargo"
    OR OLD."Posto" IS DISTINCT FROM NEW."Posto"
    OR OLD."Filial" IS DISTINCT FROM NEW."Filial"
    OR OLD."Empresa" IS DISTINCT FROM NEW."Empresa")
  EXECUTE FUNCTION public.organograma_empregado_gatilho();

DROP TRIGGER IF EXISTS trg_organograma_empregado_del ON public."EMPREGADOS";
CREATE TRIGGER trg_organograma_empregado_del
  AFTER DELETE ON public."EMPREGADOS"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_empregado_gatilho();

-- ── 8) Carga e recálculo: garante todo ativo na árvore ───────────────────
-- Nunca mexe em posição que alguém definiu; só em nó pendente.
CREATE OR REPLACE FUNCTION public.organograma_recalcular_interno()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_r record; v_sup uuid; v_novos int := 0; v_posto int := 0; v_contrato int := 0; v_saiu int := 0; v_ok boolean;
BEGIN
  PERFORM set_config('organograma.silencio', '1', true);

  -- a) Nó de login ganha o cadastro correspondente.
  UPDATE public."ORGANOGRAMA_NO" o
     SET empregado_id = x."ID"
    FROM (
      SELECT DISTINCT ON (e.auth_user_id) e.auth_user_id, e."ID"::bigint AS "ID"
        FROM public."EMPREGADOS" e
       WHERE e.auth_user_id IS NOT NULL AND public.organograma_ativo(e."Situação"::text)
       ORDER BY e.auth_user_id, (e."Situação" = 'Trabalhando') DESC NULLS LAST, e."ID" DESC
    ) x
   WHERE o.user_id = x.auth_user_id AND o.empregado_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public."ORGANOGRAMA_NO" i WHERE i.empregado_id = x."ID");

  -- b) Quem saiu do cadastro sem o gatilho ver (carga direta, gatilho desligado).
  WITH fora AS (
    DELETE FROM public."ORGANOGRAMA_NO" o
     WHERE o.empregado_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e
                        WHERE e."ID" = o.empregado_id AND public.organograma_ativo(e."Situação"::text))
    RETURNING 1
  ) SELECT count(*) INTO v_saiu FROM fora;

  -- c) Todo ativo tem nó. Login já usado em outro nó fica sem (ON CONFLICT).
  WITH ins AS (
    INSERT INTO public."ORGANOGRAMA_NO" (empregado_id, user_id, superior_pendente, superior_origem, ordem)
    SELECT e."ID"::bigint, e.auth_user_id, true, 'sem', 0
      FROM public."EMPREGADOS" e
     WHERE public.organograma_ativo(e."Situação"::text)
       AND coalesce(e."Nome"::text, '') NOT ILIKE '%teste%'
       AND NOT EXISTS (SELECT 1 FROM public."ORGANOGRAMA_NO" o WHERE o.empregado_id = e."ID")
    ON CONFLICT DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_novos FROM ins;

  -- d) Pendentes: primeiro pelo posto, depois pelo responsável único do contrato.
  CREATE TEMP TABLE IF NOT EXISTS tmp_org_resp (empresa bigint, filial bigint, no_id uuid) ON COMMIT DROP;
  TRUNCATE tmp_org_resp;
  INSERT INTO tmp_org_resp
  SELECT r.empresa, r.filial, min(o.id::text)::uuid
    FROM public.rh_hier_responsaveis() r
    JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = r.empregado_id
   GROUP BY r.empresa, r.filial
  HAVING count(DISTINCT o.id) = 1;

  FOR v_r IN
    SELECT o.id, o.empregado_id, e."Empresa"::bigint AS empresa, e."Filial"::bigint AS filial
      FROM public."ORGANOGRAMA_NO" o
      JOIN public."EMPREGADOS" e ON e."ID" = o.empregado_id
     WHERE o.superior_pendente
  LOOP
    v_sup := public.organograma_superior_por_posto(v_r.empregado_id);
    v_ok := public.organograma_tentar_ligar(v_r.id, v_sup, 'posto');
    IF v_ok THEN v_posto := v_posto + 1; CONTINUE; END IF;
    SELECT t.no_id INTO v_sup FROM tmp_org_resp t WHERE t.empresa = v_r.empresa AND t.filial = v_r.filial;
    IF public.organograma_tentar_ligar(v_r.id, v_sup, 'contrato') THEN v_contrato := v_contrato + 1; END IF;
  END LOOP;

  PERFORM set_config('organograma.silencio', '', true);
  DROP TABLE IF EXISTS tmp_org_resp;

  RETURN jsonb_build_object(
    'novos', v_novos, 'removidos', v_saiu, 'ligados_posto', v_posto, 'ligados_contrato', v_contrato,
    'pendentes', (SELECT count(*) FROM public."ORGANOGRAMA_NO" o WHERE o.superior_pendente));
END $$;

-- ── 9) Permissões do organograma ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.organograma_pode_montar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND (
       public.can_access(auth.uid(), 'organograma', 'incluir'::public.app_acao)
    OR public.can_access(auth.uid(), 'organograma', 'alterar'::public.app_acao)
    OR public.can_access(auth.uid(), 'administracao', 'incluir'::public.app_acao)
    OR public.can_access(auth.uid(), 'administracao', 'alterar'::public.app_acao)
    OR public.can_access(auth.uid(), 'colaboradores', 'alterar'::public.app_acao))
$$;

-- O logado está acima dessa pessoa na árvore?
CREATE OR REPLACE FUNCTION public.organograma_sou_superior(_no uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_eu uuid; v uuid; n int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT o.id INTO v_eu FROM public."ORGANOGRAMA_NO" o WHERE o.user_id = auth.uid();
  IF v_eu IS NULL OR v_eu = _no THEN RETURN false; END IF;
  SELECT o.parent_id INTO v FROM public."ORGANOGRAMA_NO" o WHERE o.id = _no;
  WHILE v IS NOT NULL AND n < 500 LOOP
    IF v = v_eu THEN RETURN true; END IF;
    SELECT o.parent_id INTO v FROM public."ORGANOGRAMA_NO" o WHERE o.id = v;
    n := n + 1;
  END LOOP;
  RETURN false;
END $$;

-- ── 10) Mudar de posição ─────────────────────────────────────────────────
-- Fim do chamado: "se um líder mudar de posição, todos os seus liderados
-- diretos devem ser reorganizados na árvore de forma automática".
--   p_destino_equipe: 'acompanha'      a equipe vai junto (só o líder muda de pai);
--                     'chefe_anterior' a equipe fica e passa a responder a quem
--                                      era o chefe dele;
--                     'novo_lider'     a equipe fica e passa para p_novo_lider
--                                      (que assume o lugar do que saiu).
CREATE OR REPLACE FUNCTION public.organograma_mover_interno(
  p_no uuid, p_parent uuid, p_do_grupo boolean, p_topo boolean,
  p_destino_equipe text, p_novo_lider uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_no public."ORGANOGRAMA_NO"%ROWTYPE; v_nome text; v_destino text := coalesce(p_destino_equipe, 'acompanha');
BEGIN
  SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE id = p_no;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada no organograma.'; END IF;
  IF p_parent IS NULL AND NOT coalesce(p_topo, false) THEN RAISE EXCEPTION 'Escolha o superior imediato, ou marque que a pessoa fica no topo.'; END IF;
  IF v_destino NOT IN ('acompanha', 'chefe_anterior', 'novo_lider') THEN RAISE EXCEPTION 'Destino da equipe inválido: %', v_destino; END IF;
  IF v_destino = 'novo_lider' AND (p_novo_lider IS NULL OR p_novo_lider = p_no) THEN
    RAISE EXCEPTION 'Escolha quem assume a equipe.';
  END IF;

  v_nome := public.organograma_nome_no(p_no);

  IF v_destino <> 'acompanha' THEN
    PERFORM set_config('organograma.motivo',
      'Reorganização automática: ' || v_nome || ' mudou de posição' || coalesce(' — ' || nullif(btrim(p_motivo), ''), ''), true);
    IF v_no.parent_id IS NULL THEN PERFORM set_config('organograma.topo', '1', true); END IF;

    IF v_destino = 'novo_lider' THEN
      -- Quem assume vai para o lugar do líder; só depois recebe a equipe,
      -- para o ciclo não acusar (ele costuma estar dentro da própria equipe).
      UPDATE public."ORGANOGRAMA_NO" SET parent_id = v_no.parent_id, do_grupo = v_no.do_grupo
       WHERE id = p_novo_lider AND parent_id IS DISTINCT FROM v_no.parent_id;
      UPDATE public."ORGANOGRAMA_NO" SET parent_id = p_novo_lider
       WHERE parent_id = p_no AND NOT do_grupo AND id <> p_novo_lider;
    ELSE
      UPDATE public."ORGANOGRAMA_NO" SET parent_id = v_no.parent_id, do_grupo = v_no.do_grupo AND v_no.parent_id IS NOT NULL
       WHERE parent_id = p_no AND NOT do_grupo;
    END IF;
    PERFORM set_config('organograma.topo', '', true);
  END IF;

  PERFORM set_config('organograma.motivo', coalesce(nullif(btrim(p_motivo), ''), ''), true);
  IF coalesce(p_topo, false) THEN PERFORM set_config('organograma.topo', '1', true); END IF;
  UPDATE public."ORGANOGRAMA_NO"
     SET parent_id = CASE WHEN coalesce(p_topo, false) THEN NULL ELSE p_parent END,
         do_grupo = coalesce(p_do_grupo, false) AND NOT coalesce(p_topo, false),
         par_grupo = NULL,
         superior_pendente = false,
         superior_origem = 'manual',
         ordem = (SELECT count(*) FROM public."ORGANOGRAMA_NO" i
                   WHERE i.parent_id IS NOT DISTINCT FROM (CASE WHEN coalesce(p_topo, false) THEN NULL ELSE p_parent END) AND i.id <> p_no)
   WHERE id = p_no;
  PERFORM set_config('organograma.topo', '', true);
  PERFORM set_config('organograma.motivo', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.organograma_mover(
  p_no uuid, p_parent uuid, p_do_grupo boolean DEFAULT false, p_topo boolean DEFAULT false,
  p_destino_equipe text DEFAULT 'acompanha', p_novo_lider uuid DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão para mudar o organograma.' USING ERRCODE = '42501'; END IF;
  PERFORM public.organograma_mover_interno(p_no, p_parent, p_do_grupo, p_topo, p_destino_equipe, p_novo_lider, p_motivo);
END $$;

-- Definir a posição da pessoa, vindo do cadastro, do usuário ou do organograma.
-- NULL = não mexe; '' em função/posto = limpa; contratos = lista final.
CREATE OR REPLACE FUNCTION public.organograma_salvar_interno(
  p_no uuid, p_empregado bigint, p_user uuid, p_parent uuid, p_topo boolean,
  p_funcao text, p_posto text, p_contratos jsonb, p_autor uuid DEFAULT NULL, p_do_grupo boolean DEFAULT false,
  p_destino_equipe text DEFAULT 'acompanha', p_novo_lider uuid DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_no public."ORGANOGRAMA_NO"%ROWTYPE; v_emp public."EMPREGADOS"%ROWTYPE; v_id uuid := p_no;
  v_empregado bigint := p_empregado; v_user uuid := p_user; v_antes text; v_senior text; v_autor_nome text;
BEGIN
  IF p_autor IS NOT NULL THEN PERFORM set_config('organograma.autor', p_autor::text, true); END IF;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada no organograma.'; END IF;
    v_empregado := coalesce(v_empregado, v_no.empregado_id);
    v_user := coalesce(v_user, v_no.user_id);
  END IF;
  IF v_empregado IS NULL AND v_user IS NULL THEN RAISE EXCEPTION 'Escolha a pessoa.'; END IF;

  -- Vincular login ao cadastro: mesmas regras de admin_vincular_empregado. O
  -- gatilho de EMPREGADOS junta os nós.
  IF v_empregado IS NOT NULL THEN
    SELECT * INTO v_emp FROM public."EMPREGADOS" WHERE "ID" = v_empregado;
    IF NOT FOUND THEN RAISE EXCEPTION 'Colaborador não encontrado no cadastro.'; END IF;
    IF NOT public.organograma_ativo(v_emp."Situação"::text) THEN
      RAISE EXCEPTION 'Colaborador desligado — não entra no organograma.';
    END IF;
    IF v_user IS NOT NULL AND v_emp.auth_user_id IS DISTINCT FROM v_user THEN
      IF v_emp.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'Este colaborador já está vinculado a outro usuário.'; END IF;
      UPDATE public."EMPREGADOS" SET auth_user_id = NULL WHERE auth_user_id = v_user AND "ID" <> v_empregado;
      UPDATE public."EMPREGADOS" SET auth_user_id = v_user WHERE "ID" = v_empregado;
    END IF;
  END IF;

  v_id := NULL;
  IF v_empregado IS NOT NULL THEN SELECT id INTO v_id FROM public."ORGANOGRAMA_NO" WHERE empregado_id = v_empregado; END IF;
  IF v_id IS NULL AND v_user IS NOT NULL THEN SELECT id INTO v_id FROM public."ORGANOGRAMA_NO" WHERE user_id = v_user; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public."ORGANOGRAMA_NO" (empregado_id, user_id, superior_pendente, superior_origem, ordem)
    VALUES (v_empregado, v_user, true, 'sem', 0) RETURNING id INTO v_id;
  ELSE
    UPDATE public."ORGANOGRAMA_NO"
       SET empregado_id = coalesce(empregado_id, v_empregado), user_id = coalesce(user_id, v_user)
     WHERE id = v_id AND (empregado_id IS NULL OR user_id IS NULL);
  END IF;

  IF p_parent IS NOT NULL OR coalesce(p_topo, false) THEN
    SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE id = v_id;
    IF coalesce(p_topo, false) AND v_no.parent_id IS NULL AND NOT v_no.superior_pendente THEN
      NULL;  -- já está no topo por escolha
    ELSIF coalesce(p_topo, false) OR p_parent IS DISTINCT FROM v_no.parent_id OR coalesce(p_do_grupo, false) <> v_no.do_grupo THEN
      PERFORM public.organograma_mover_interno(v_id, p_parent, p_do_grupo, p_topo, p_destino_equipe, p_novo_lider, p_motivo);
    ELSIF v_no.superior_origem <> 'manual' THEN
      -- Confirmou o superior que o sistema deduziu: passa a ser decisão de alguém.
      UPDATE public."ORGANOGRAMA_NO" SET superior_origem = 'manual' WHERE id = v_id;
    END IF;
  END IF;

  IF p_funcao IS NOT NULL THEN
    UPDATE public."ORGANOGRAMA_NO" SET funcao = nullif(btrim(p_funcao), '') WHERE id = v_id
       AND nullif(btrim(p_funcao), '') IS DISTINCT FROM nullif(btrim(coalesce(funcao, '')), '');
  END IF;

  IF p_posto IS NOT NULL AND v_empregado IS NOT NULL THEN
    v_antes := public.organograma_posto_efetivo(v_empregado);
    IF nullif(btrim(p_posto), '') IS DISTINCT FROM v_antes THEN
      IF nullif(btrim(p_posto), '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."RH_POSTO_TRABALHO" t WHERE t.codigo = p_posto) THEN
        RAISE EXCEPTION 'Posto % não existe.', p_posto;
      END IF;
      SELECT e."Posto"::text INTO v_senior FROM public."EMPREGADOS" e WHERE e."ID" = v_empregado;
      SELECT coalesce(nullif(btrim(p.display_name), ''), p.email) INTO v_autor_nome FROM public.profiles p
       WHERE p.id = coalesce(auth.uid(), p_autor);
      -- O ajuste mora em RH_POSTO_OCUPANTE_ERP, não em EMPREGADOS: a Senior
      -- reescreve "Posto" a cada carga (mig 20261008000005).
      INSERT INTO public."RH_POSTO_OCUPANTE_ERP" (empregado_id, posto_codigo, posto_senior, motivo, alterado_por, alterado_em)
      VALUES (v_empregado, nullif(btrim(p_posto), ''), v_senior, 'Definido na posição do organograma', v_autor_nome, now())
      ON CONFLICT (empregado_id) DO UPDATE
        SET posto_codigo = EXCLUDED.posto_codigo, posto_senior = EXCLUDED.posto_senior, motivo = EXCLUDED.motivo,
            alterado_por = EXCLUDED.alterado_por, alterado_em = now();
      INSERT INTO public."RH_POSTO_HIERARQUIA_HIST"
        (posto_codigo, tipo, empregado_id, empregado_nome, valor_antes, valor_depois, motivo, autor_id, autor_nome)
      VALUES (coalesce(nullif(btrim(p_posto), ''), v_antes, '—'), 'ocupante', v_empregado, v_emp."Nome"::text, v_antes,
              nullif(btrim(p_posto), ''), 'Definido na posição do organograma', coalesce(auth.uid(), p_autor), v_autor_nome);
      PERFORM public.organograma_mov_inserir(v_empregado, v_user, 'troca_posto', 'neutra', 'Mudança de posto', NULL,
        coalesce(v_antes, '—'), coalesce(nullif(btrim(p_posto), ''), '—'));
    END IF;
  END IF;

  IF p_contratos IS NOT NULL THEN
    DELETE FROM public."ORGANOGRAMA_NO_CONTRATO" c WHERE c.no_id = v_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_contratos) x
                        WHERE (x->>'empresa')::bigint = c.empresa AND (x->>'filial')::bigint = c.filial);
    INSERT INTO public."ORGANOGRAMA_NO_CONTRATO" (no_id, empresa, filial, criado_por)
    SELECT v_id, (x->>'empresa')::bigint, (x->>'filial')::bigint, coalesce(auth.uid(), p_autor)
      FROM jsonb_array_elements(p_contratos) x
    ON CONFLICT (no_id, empresa, filial) DO NOTHING;
  END IF;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.organograma_salvar_posicao(
  p_no uuid DEFAULT NULL, p_empregado bigint DEFAULT NULL, p_user uuid DEFAULT NULL,
  p_parent uuid DEFAULT NULL, p_topo boolean DEFAULT false, p_funcao text DEFAULT NULL,
  p_posto text DEFAULT NULL, p_contratos jsonb DEFAULT NULL, p_do_grupo boolean DEFAULT false,
  p_destino_equipe text DEFAULT 'acompanha', p_novo_lider uuid DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão para definir a posição no organograma.' USING ERRCODE = '42501'; END IF;
  RETURN public.organograma_salvar_interno(p_no, p_empregado, p_user, p_parent, p_topo, p_funcao, p_posto, p_contratos,
    NULL, p_do_grupo, p_destino_equipe, p_novo_lider, p_motivo);
END $$;

-- Pendências em lote: mesmo superior para muitos, sem uma requisição por pessoa.
CREATE OR REPLACE FUNCTION public.organograma_definir_superior_lote(p_nos uuid[], p_parent uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid; v_ok int := 0; v_falhas int := 0;
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão para mudar o organograma.' USING ERRCODE = '42501'; END IF;
  IF p_parent IS NULL THEN RAISE EXCEPTION 'Escolha o superior imediato.'; END IF;
  PERFORM set_config('organograma.motivo', coalesce(p_motivo, ''), true);
  FOREACH v IN ARRAY coalesce(p_nos, '{}') LOOP
    IF v = p_parent OR public.organograma_fecha_ciclo(v, p_parent) THEN v_falhas := v_falhas + 1; CONTINUE; END IF;
    UPDATE public."ORGANOGRAMA_NO" SET parent_id = p_parent, do_grupo = false,
           ordem = (SELECT count(*) FROM public."ORGANOGRAMA_NO" i WHERE i.parent_id = p_parent)
     WHERE id = v;
    v_ok := v_ok + 1;
  END LOOP;
  PERFORM set_config('organograma.motivo', '', true);
  RETURN jsonb_build_object('ok', v_ok, 'falhas', v_falhas);
END $$;

-- "Tirar" colaborador ativo não existe mais: ele pertence à árvore enquanto
-- estiver no cadastro. A equipe sobe e ele volta para as Pendências.
CREATE OR REPLACE FUNCTION public.organograma_tirar(p_no uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no public."ORGANOGRAMA_NO"%ROWTYPE; v_ativo boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'organograma', 'excluir'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para tirar pessoa do organograma.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE id = p_no;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT public.organograma_ativo(e."Situação"::text) INTO v_ativo FROM public."EMPREGADOS" e WHERE e."ID" = v_no.empregado_id;
  PERFORM set_config('organograma.motivo', 'Superior anterior saiu desta posição: ' || coalesce(public.organograma_nome_no(p_no), '—'), true);
  IF coalesce(v_ativo, false) THEN
    UPDATE public."ORGANOGRAMA_NO" SET parent_id = v_no.parent_id, do_grupo = false WHERE parent_id = p_no;
    UPDATE public."ORGANOGRAMA_NO" SET parent_id = NULL, par_grupo = NULL, do_grupo = false, superior_pendente = true, superior_origem = 'sem' WHERE id = p_no;
  ELSE
    DELETE FROM public."ORGANOGRAMA_NO" WHERE id = p_no;
  END IF;
  PERFORM set_config('organograma.motivo', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.organograma_recalcular()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'organograma', 'alterar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem permissão para recalcular o organograma.' USING ERRCODE = '42501';
  END IF;
  RETURN public.organograma_recalcular_interno();
END $$;

-- ── 11) Leitura da árvore ────────────────────────────────────────────────
-- jsonb, e não RETURNS TABLE: são ~2.500 linhas e o PostgREST corta conjunto de
-- linhas em db-max-rows. Linha como array (como rh_hier_painel) para não
-- repetir os nomes das colunas 2.500 vezes.
DROP FUNCTION IF EXISTS public.organograma_nos();
DROP FUNCTION IF EXISTS public.organograma_usuarios();

CREATE OR REPLACE FUNCTION public.organograma_arvore()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'organograma', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH contrato AS (
      SELECT DISTINCT ON (c."Empresa", c."Filial") c."Empresa"::bigint AS empresa, c."Filial"::bigint AS filial,
             c."NOME CONTRATO"::text AS nome, c."ATIVO" = 'SIM' AS ativo
        FROM public."CONTRATOS" c
       WHERE c."Filial" IS NOT NULL
       ORDER BY c."Empresa", c."Filial", (c."ATIVO" = 'SIM') DESC NULLS LAST
    ),
    extra AS (
      SELECT x.no_id, jsonb_agg(jsonb_build_array(x.empresa, x.filial)) AS lista
        FROM public."ORGANOGRAMA_NO_CONTRATO" x GROUP BY x.no_id
    )
    SELECT jsonb_build_object(
      -- [id, user_id, empregado_id, parent_id, ordem, funcao, nome, email, avatar, cargo, setor, ativo, cor,
      --  par_grupo, do_grupo, pendente, origem, posto_codigo, posto_nome, empresa, filial, contrato, extras]
      'nos', coalesce((
        SELECT jsonb_agg(jsonb_build_array(
                 o.id, o.user_id, o.empregado_id, o.parent_id, o.ordem, nullif(btrim(o.funcao), ''),
                 coalesce(nullif(btrim(e."Nome"::text), ''), nullif(btrim(p.display_name), ''), p.email, 'Pessoa'),
                 p.email, p.avatar_url,
                 coalesce(nullif(btrim(e."Título do Cargo"::text), ''), nullif(btrim(p.cargo), '')),
                 coalesce(nullif(btrim(e."Setor_ERP"::text), ''), (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = o.user_id AND e."ID" IS NULL)),
                 CASE WHEN e."ID" IS NOT NULL THEN public.organograma_ativo(e."Situação"::text) ELSE coalesce(p.ativo, false) END,
                 o.cor, nullif(btrim(o.par_grupo), ''), o.do_grupo, o.superior_pendente, o.superior_origem,
                 v.posto, coalesce(nullif(btrim(t.titulo), ''), nullif(btrim(e."Nome do Posto"::text), '')),
                 e."Empresa"::bigint, e."Filial"::bigint,
                 CASE WHEN e."Filial" IS NOT NULL THEN public.organograma_contrato_rotulo(e."Filial"::bigint, coalesce(nullif(btrim(e."Nome Filial"::text), ''), c.nome)) END,
                 coalesce(ex.lista, '[]'::jsonb))
                 ORDER BY o.ordem)
          FROM public."ORGANOGRAMA_NO" o
          LEFT JOIN public.profiles p ON p.id = o.user_id
          LEFT JOIN public."EMPREGADOS" e ON e."ID" = o.empregado_id
          LEFT JOIN public."RH_POSTO_OCUPANTE_ERP" a ON a.empregado_id = o.empregado_id
          LEFT JOIN LATERAL (SELECT CASE WHEN a.empregado_id IS NOT NULL THEN a.posto_codigo ELSE e."Posto"::text END AS posto) v ON true
          LEFT JOIN public."RH_POSTO_TRABALHO" t ON t.codigo = v.posto
          LEFT JOIN contrato c ON c.empresa = e."Empresa"::bigint AND c.filial = e."Filial"::bigint
          LEFT JOIN extra ex ON ex.no_id = o.id
      ), '[]'::jsonb),
      -- [empresa, filial, rótulo]
      'contratos', coalesce((
        SELECT jsonb_agg(jsonb_build_array(c.empresa, c.filial, public.organograma_contrato_rotulo(c.filial, c.nome)) ORDER BY c.filial)
          FROM contrato c WHERE c.ativo
      ), '[]'::jsonb)));
END $$;

-- Autocompletar por nome: quem é a pessoa e o que o cadastro já sabe dela. Sem
-- CPF, telefone nem salário — só o que o organograma mostra.
CREATE OR REPLACE FUNCTION public.organograma_buscar_pessoas(p_termo text, p_so_no boolean DEFAULT false, p_limite integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tokens text[]; v_lim int := least(greatest(coalesce(p_limite, 20), 1), 50);
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  v_tokens := array_remove(string_to_array(public.org_proc_norm(p_termo), ' '), '');
  IF coalesce(array_length(v_tokens, 1), 0) = 0 OR length(array_to_string(v_tokens, '')) < 2 THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.nome)
      FROM (
        SELECT e."ID"::bigint AS empregado_id, coalesce(e.auth_user_id, o.user_id) AS user_id, o.id AS no_id,
               e."Nome"::text AS nome, nullif(btrim(e."Título do Cargo"::text), '') AS cargo,
               public.organograma_posto_efetivo(e."ID"::bigint) AS posto_codigo,
               nullif(btrim(e."Nome do Posto"::text), '') AS posto_nome,
               e."Empresa"::bigint AS empresa, e."Filial"::bigint AS filial,
               public.organograma_contrato_rotulo(e."Filial"::bigint, e."Nome Filial"::text) AS contrato,
               nullif(btrim(e."Setor_ERP"::text), '') AS setor,
               o.parent_id AS superior_id, public.organograma_nome_no(o.parent_id) AS superior_nome,
               coalesce(o.superior_pendente, false) AS pendente, o.funcao
          FROM public."EMPREGADOS" e
          LEFT JOIN public."ORGANOGRAMA_NO" o ON o.empregado_id = e."ID"
         WHERE public.organograma_ativo(e."Situação"::text)
           AND (NOT coalesce(p_so_no, false) OR o.id IS NOT NULL)
           AND public.org_proc_norm(e."Nome"::text) LIKE ALL (SELECT '%' || t || '%' FROM unnest(v_tokens) t)
        UNION ALL
        SELECT NULL, p.id, o.id, coalesce(nullif(btrim(p.display_name), ''), p.email), nullif(btrim(p.cargo), ''),
               NULL, NULL, NULL, NULL, NULL,
               (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = p.id),
               o.parent_id, public.organograma_nome_no(o.parent_id), coalesce(o.superior_pendente, false), o.funcao
          FROM public.profiles p
          LEFT JOIN public."ORGANOGRAMA_NO" o ON o.user_id = p.id
         WHERE p.ativo
           AND (NOT coalesce(p_so_no, false) OR o.id IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" x WHERE x.auth_user_id = p.id AND public.organograma_ativo(x."Situação"::text))
           AND public.org_proc_norm(coalesce(p.display_name, p.email)) LIKE ALL (SELECT '%' || t || '%' FROM unnest(v_tokens) t)
        ORDER BY 4
        LIMIT v_lim
      ) r), '[]'::jsonb);
END $$;

-- A posição atual, para abrir o formulário já preenchido.
CREATE OR REPLACE FUNCTION public.organograma_posicao(p_empregado bigint DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no public."ORGANOGRAMA_NO"%ROWTYPE; v_emp bigint := p_empregado;
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF v_emp IS NOT NULL THEN SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE empregado_id = v_emp; END IF;
  IF v_no.id IS NULL AND p_user IS NOT NULL THEN
    SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE user_id = p_user;
    v_emp := coalesce(v_emp, v_no.empregado_id);
    IF v_emp IS NULL THEN
      SELECT e."ID"::bigint INTO v_emp FROM public."EMPREGADOS" e
       WHERE e.auth_user_id = p_user AND public.organograma_ativo(e."Situação"::text) ORDER BY e."ID" DESC LIMIT 1;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'no_id', v_no.id, 'parent_id', v_no.parent_id, 'parent_nome', public.organograma_nome_no(v_no.parent_id),
    'do_grupo', coalesce(v_no.do_grupo, false), 'pendente', coalesce(v_no.superior_pendente, v_no.id IS NULL),
    'origem', v_no.superior_origem, 'funcao', v_no.funcao,
    'no_topo', v_no.id IS NOT NULL AND v_no.parent_id IS NULL AND NOT v_no.superior_pendente,
    'equipe_direta', (SELECT count(*) FROM public."ORGANOGRAMA_NO" i WHERE i.parent_id = v_no.id),
    'empregado_id', v_emp,
    'nome', (SELECT e."Nome"::text FROM public."EMPREGADOS" e WHERE e."ID" = v_emp),
    'cargo', (SELECT nullif(btrim(e."Título do Cargo"::text), '') FROM public."EMPREGADOS" e WHERE e."ID" = v_emp),
    'posto_codigo', CASE WHEN v_emp IS NOT NULL THEN public.organograma_posto_efetivo(v_emp) END,
    'empresa', (SELECT e."Empresa"::bigint FROM public."EMPREGADOS" e WHERE e."ID" = v_emp),
    'filial', (SELECT e."Filial"::bigint FROM public."EMPREGADOS" e WHERE e."ID" = v_emp),
    'contrato', (SELECT public.organograma_contrato_rotulo(e."Filial"::bigint, e."Nome Filial"::text) FROM public."EMPREGADOS" e WHERE e."ID" = v_emp),
    'contratos_extras', coalesce((
      SELECT jsonb_agg(jsonb_build_object('empresa', x.empresa, 'filial', x.filial, 'nome', public.organograma_contrato_nome(x.empresa, x.filial)))
        FROM public."ORGANOGRAMA_NO_CONTRATO" x WHERE x.no_id = v_no.id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.organograma_opcoes_posto(p_empresa bigint, p_filial bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('codigo', t.codigo, 'titulo', coalesce(nullif(btrim(t.titulo), ''), t.descricao)) ORDER BY t.titulo)
      FROM public."RH_POSTO_TRABALHO" t
     WHERE t.ativo AND t.empresa = p_empresa AND t.filial = p_filial), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.organograma_contratos_opcoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.organograma_pode_montar() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('empresa', c.empresa, 'filial', c.filial, 'nome', public.organograma_contrato_rotulo(c.filial, c.nome)) ORDER BY c.filial)
      FROM (SELECT DISTINCT ON (x."Empresa", x."Filial") x."Empresa"::bigint AS empresa, x."Filial"::bigint AS filial, x."NOME CONTRATO"::text AS nome
              FROM public."CONTRATOS" x
             WHERE x."ATIVO" = 'SIM' AND x."Filial" IS NOT NULL
             ORDER BY x."Empresa", x."Filial") c), '[]'::jsonb);
END $$;

-- ── 12) Histórico: tudo que aconteceu com a pessoa ───────────────────────
-- Advertência e Troca de Função são lidas das tabelas delas (sem cópia nem
-- gatilho: o fluxo do Jurídico/RH não passa a depender do organograma).
-- Reprovada não aconteceu, então não conta contra ninguém.
CREATE OR REPLACE FUNCTION public.organograma_mov_base()
RETURNS TABLE (
  chave text, empregado_id bigint, user_id uuid, pessoa_nome text, tipo text, natureza text, titulo text,
  descricao text, valor_antes text, valor_depois text, empresa bigint, filial bigint, contrato_nome text,
  setor text, data_evento date, origem text, autor_nome text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT 'm' || m.id, m.empregado_id, m.user_id, m.pessoa_nome, m.tipo, m.natureza, m.titulo, m.descricao,
         m.valor_antes, m.valor_depois, m.empresa, m.filial, m.contrato_nome, m.setor, m.data_evento, m.origem, m.autor_nome, m.created_at
    FROM public."ORGANOGRAMA_MOVIMENTACAO" m
  UNION ALL
  SELECT 'a' || a.id, a.colaborador_id, e.auth_user_id, a.colaborador_nome, 'advertencia',
         CASE WHEN coalesce(a.resultado, '') ILIKE 'arquiv%' THEN 'neutra' ELSE 'negativa' END,
         'Advertência' || coalesce(' ' || lower(nullif(btrim(a.tipo_advertencia), '')), '') || coalesce(' · grau ' || lower(nullif(btrim(a.grau), '')), ''),
         a.descricao_ocorrido, NULL, a.status, e."Empresa"::bigint, e."Filial"::bigint,
         coalesce(nullif(btrim(a.contrato), ''), a.colaborador_filial),
         nullif(btrim(e."Setor_ERP"::text), ''), coalesce(a.data_ocorrido::date, a.created_at::date), 'advertencia',
         a.solicitante_nome, a.created_at
    FROM public."SISTEMA_SOLICITACOES_ADVERTENCIA" a
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = a.colaborador_id
   WHERE a.status <> 'Reprovada'
  UNION ALL
  SELECT 't' || t.id, t.colaborador_id, e.auth_user_id, coalesce(t.colaborador_nome, e."Nome"::text, 'Pessoa'), 'troca_funcao', 'neutra',
         'Troca de função concluída', t.motivo, t.cargo_atual, t.cargo_novo, e."Empresa"::bigint, e."Filial"::bigint,
         coalesce(nullif(btrim(t.filial), ''), e."Nome Filial"::text),
         nullif(btrim(e."Setor_ERP"::text), ''), coalesce(t.rh_em::date, t.atualizado_em::date), 'troca_funcao',
         coalesce(t.rh_por, t.aprovador_nome), t.criado_em
    FROM public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" t
    LEFT JOIN public."EMPREGADOS" e ON e."ID" = t.colaborador_id
   WHERE t.status = 'Concluída'
$$;

-- O perfil: quem é, linha de comando, equipe e o histórico (para quem pode).
CREATE OR REPLACE FUNCTION public.organograma_perfil(p_no uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_no public."ORGANOGRAMA_NO"%ROWTYPE; v_ver boolean; v_reg boolean; v_lider boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'organograma', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE id = p_no;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada no organograma.'; END IF;

  v_lider := public.organograma_sou_superior(p_no);
  v_ver := v_lider OR public.can_access(auth.uid(), 'organograma_gestao', 'visualizar'::public.app_acao);
  v_reg := v_lider OR public.can_access(auth.uid(), 'organograma_gestao', 'incluir'::public.app_acao);

  RETURN jsonb_build_object(
    'bio', (SELECT nullif(btrim(p.bio), '') FROM public.profiles p WHERE p.id = v_no.user_id),
    'pode_ver_historico', v_ver,
    'pode_registrar', v_reg,
    'contratos_extras', coalesce((
      SELECT jsonb_agg(public.organograma_contrato_nome(x.empresa, x.filial))
        FROM public."ORGANOGRAMA_NO_CONTRATO" x WHERE x.no_id = p_no), '[]'::jsonb),
    'cadeia', coalesce((
      WITH RECURSIVE c AS (
        SELECT o.parent_id AS id, 1 AS d FROM public."ORGANOGRAMA_NO" o WHERE o.id = p_no AND o.parent_id IS NOT NULL
        UNION ALL
        SELECT o.parent_id, c.d + 1 FROM c JOIN public."ORGANOGRAMA_NO" o ON o.id = c.id WHERE o.parent_id IS NOT NULL AND c.d < 50
      )
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', public.organograma_nome_no(c.id)) ORDER BY c.d DESC) FROM c
    ), '[]'::jsonb),
    'liderados', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', i.id, 'nome', public.organograma_nome_no(i.id)))
        FROM public."ORGANOGRAMA_NO" i WHERE i.parent_id = p_no
    ), '[]'::jsonb),
    'historico', CASE WHEN NOT v_ver THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(h) ORDER BY h.data_evento DESC, h.created_at DESC)
        FROM (
          SELECT b.* FROM public.organograma_mov_base() b
           WHERE (v_no.empregado_id IS NOT NULL AND b.empregado_id = v_no.empregado_id)
              OR (v_no.user_id IS NOT NULL AND b.user_id = v_no.user_id)
           ORDER BY b.data_evento DESC, b.created_at DESC LIMIT 200
        ) h), '[]'::jsonb) END);
END $$;

-- Atitude positiva ou negativa, no perfil do liderado.
CREATE OR REPLACE FUNCTION public.organograma_registrar_mov(
  p_no uuid, p_tipo text, p_natureza text, p_titulo text, p_descricao text DEFAULT NULL, p_data date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_no public."ORGANOGRAMA_NO"%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão inválida.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_no FROM public."ORGANOGRAMA_NO" WHERE id = p_no;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pessoa não encontrada no organograma.'; END IF;
  IF NOT (public.organograma_sou_superior(p_no) OR public.can_access(auth.uid(), 'organograma_gestao', 'incluir'::public.app_acao)) THEN
    RAISE EXCEPTION 'Só a liderança da pessoa ou quem tem o Dashboard de Gestão registra aqui.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo NOT IN ('promocao', 'transferencia_escopo', 'elogio', 'feedback', 'ocorrencia', 'outro') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo;
  END IF;
  IF nullif(btrim(coalesce(p_titulo, '')), '') IS NULL THEN RAISE EXCEPTION 'Diga o que aconteceu.'; END IF;
  IF p_data > current_date THEN RAISE EXCEPTION 'A data não pode estar no futuro.'; END IF;
  PERFORM public.organograma_mov_inserir(v_no.empregado_id, v_no.user_id, p_tipo, p_natureza, btrim(p_titulo), p_descricao,
    NULL, NULL, p_data, 'manual');
END $$;

-- Dashboard: os totais vêm prontos do banco (regra J9: KPI não é calculado no
-- navegador sobre a lista inteira).
CREATE OR REPLACE FUNCTION public.organograma_gestao_painel(
  p_de date DEFAULT NULL, p_ate date DEFAULT NULL, p_empresa bigint DEFAULT NULL, p_filial bigint DEFAULT NULL,
  p_setor text DEFAULT NULL, p_natureza text DEFAULT NULL, p_tipo text DEFAULT NULL, p_busca text DEFAULT NULL,
  p_offset integer DEFAULT 0, p_limite integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_busca text := nullif(public.org_proc_norm(p_busca), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_access(auth.uid(), 'organograma_gestao', 'visualizar'::public.app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Dashboard de Gestão.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH b AS MATERIALIZED (
      SELECT x.* FROM public.organograma_mov_base() x
       WHERE (p_de IS NULL OR x.data_evento >= p_de)
         AND (p_ate IS NULL OR x.data_evento <= p_ate)
         AND (p_filial IS NULL OR (x.filial = p_filial AND x.empresa IS NOT DISTINCT FROM coalesce(p_empresa, x.empresa)))
         AND (p_setor IS NULL OR coalesce(x.setor, 'Sem setor') = p_setor)
         AND (p_natureza IS NULL OR x.natureza = p_natureza)
         AND (p_tipo IS NULL OR x.tipo = p_tipo)
         AND (v_busca IS NULL OR public.org_proc_norm(x.pessoa_nome) LIKE '%' || v_busca || '%')
    )
    SELECT jsonb_build_object(
      'kpis', (SELECT jsonb_build_object(
                 'total', count(*), 'positivas', count(*) FILTER (WHERE natureza = 'positiva'),
                 'negativas', count(*) FILTER (WHERE natureza = 'negativa'),
                 'neutras', count(*) FILTER (WHERE natureza = 'neutra'),
                 'pessoas', count(DISTINCT coalesce(empregado_id::text, user_id::text, pessoa_nome))) FROM b),
      'estrutura', (SELECT jsonb_build_object(
                 'pessoas', count(*), 'pendentes', count(*) FILTER (WHERE superior_pendente)) FROM public."ORGANOGRAMA_NO"),
      'por_contrato', coalesce((
        SELECT jsonb_agg(to_jsonb(q) ORDER BY q.negativas DESC, q.total DESC) FROM (
          SELECT b.empresa, b.filial, coalesce(max(b.contrato_nome), 'Sem contrato') AS contrato, count(*) AS total,
                 count(*) FILTER (WHERE natureza = 'positiva') AS positivas,
                 count(*) FILTER (WHERE natureza = 'negativa') AS negativas,
                 count(*) FILTER (WHERE natureza = 'neutra') AS neutras
            FROM b GROUP BY b.empresa, b.filial LIMIT 300) q), '[]'::jsonb),
      'por_setor', coalesce((
        SELECT jsonb_agg(to_jsonb(q) ORDER BY q.negativas DESC, q.total DESC) FROM (
          SELECT coalesce(b.setor, 'Sem setor') AS setor, count(*) AS total,
                 count(*) FILTER (WHERE natureza = 'positiva') AS positivas,
                 count(*) FILTER (WHERE natureza = 'negativa') AS negativas,
                 count(*) FILTER (WHERE natureza = 'neutra') AS neutras
            FROM b GROUP BY coalesce(b.setor, 'Sem setor') LIMIT 100) q), '[]'::jsonb),
      'por_tipo', coalesce((
        SELECT jsonb_agg(to_jsonb(q) ORDER BY q.total DESC) FROM (SELECT b.tipo, count(*) AS total FROM b GROUP BY b.tipo) q), '[]'::jsonb),
      'lista', coalesce((
        SELECT jsonb_agg(to_jsonb(q) ORDER BY q.data_evento DESC, q.created_at DESC) FROM (
          SELECT b.* FROM b ORDER BY b.data_evento DESC, b.created_at DESC
           OFFSET greatest(coalesce(p_offset, 0), 0) LIMIT least(greatest(coalesce(p_limite, 50), 1), 100)) q), '[]'::jsonb),
      'setores', coalesce((
        SELECT jsonb_agg(s ORDER BY s) FROM (
          SELECT DISTINCT nullif(btrim(e."Setor_ERP"::text), '') AS s FROM public."EMPREGADOS" e
           WHERE public.organograma_ativo(e."Situação"::text)) z WHERE s IS NOT NULL), '[]'::jsonb),
      'contratos', coalesce((
        SELECT jsonb_agg(jsonb_build_object('empresa', c.empresa, 'filial', c.filial, 'nome', public.organograma_contrato_rotulo(c.filial, c.nome)) ORDER BY c.filial)
          FROM (SELECT DISTINCT ON (x."Empresa", x."Filial") x."Empresa"::bigint AS empresa, x."Filial"::bigint AS filial, x."NOME CONTRATO"::text AS nome
                  FROM public."CONTRATOS" x WHERE x."ATIVO" = 'SIM' AND x."Filial" IS NOT NULL
                 ORDER BY x."Empresa", x."Filial") c), '[]'::jsonb)));
END $$;

-- ── 13) Quem pode chamar o quê ───────────────────────────────────────────
-- Internas: só outras funções (e a Edge Function, no caso do salvar_interno).
REVOKE ALL ON FUNCTION public.organograma_mov_inserir(bigint, uuid, text, text, text, text, text, text, date, text, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_vincular_login(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_empregado_entrou(bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_empregado_saiu(bigint, text, text, uuid, bigint, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_empregado_gatilho() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_no_registrar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_no_sem_pessoa() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_superior_por_posto(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_fecha_ciclo(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_tentar_ligar(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_recalcular_interno() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_mover_interno(uuid, uuid, boolean, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_salvar_interno(uuid, bigint, uuid, uuid, boolean, text, text, jsonb, uuid, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_mov_base() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_posto_efetivo(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_contrato_nome(bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.organograma_nome_no(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_salvar_interno(uuid, bigint, uuid, uuid, boolean, text, text, jsonb, uuid, boolean, text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.organograma_pode_montar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_sou_superior(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_mover(uuid, uuid, boolean, boolean, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_salvar_posicao(uuid, bigint, uuid, uuid, boolean, text, text, jsonb, boolean, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_definir_superior_lote(uuid[], uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_tirar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_recalcular() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_arvore() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_buscar_pessoas(text, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_posicao(bigint, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_opcoes_posto(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_contratos_opcoes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_perfil(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_registrar_mov(uuid, text, text, text, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.organograma_gestao_painel(date, date, bigint, bigint, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organograma_pode_montar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_sou_superior(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_mover(uuid, uuid, boolean, boolean, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_salvar_posicao(uuid, bigint, uuid, uuid, boolean, text, text, jsonb, boolean, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_definir_superior_lote(uuid[], uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_tirar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_recalcular() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_arvore() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_buscar_pessoas(text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_posicao(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_opcoes_posto(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_contratos_opcoes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_perfil(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_registrar_mov(uuid, text, text, text, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.organograma_gestao_painel(date, date, bigint, bigint, text, text, text, text, integer, integer) TO authenticated;

-- ── 14) Carga inicial: a empresa toda entra na árvore ────────────────────
SELECT public.organograma_recalcular_interno();

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP TRIGGER IF EXISTS trg_organograma_empregado_ins ON public."EMPREGADOS";
-- DROP TRIGGER IF EXISTS trg_organograma_empregado_upd ON public."EMPREGADOS";
-- DROP TRIGGER IF EXISTS trg_organograma_empregado_del ON public."EMPREGADOS";
-- DROP TRIGGER IF EXISTS trg_organograma_no_registrar ON public."ORGANOGRAMA_NO";
-- DROP TRIGGER IF EXISTS trg_organograma_no_sem_pessoa ON public."ORGANOGRAMA_NO";
-- DROP TRIGGER IF EXISTS trg_organograma_no_normaliza ON public."ORGANOGRAMA_NO";
-- DELETE FROM public."ORGANOGRAMA_NO" WHERE user_id IS NULL;   -- só os colaboradores sem login que esta carga criou
-- ALTER TABLE public."ORGANOGRAMA_NO" ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT organograma_no_user_id_fkey;
-- ALTER TABLE public."ORGANOGRAMA_NO" ADD CONSTRAINT organograma_no_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
-- (reexecutar o CREATE de organograma_nos() da 20261030000100 e o de organograma_usuarios() da 20260930000277)
-- DROP TABLE public."ORGANOGRAMA_NO_CONTRATO"; DROP TABLE public."ORGANOGRAMA_MOVIMENTACAO";
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP COLUMN empregado_id, DROP COLUMN superior_pendente, DROP COLUMN superior_origem;
-- DELETE FROM public.screen_permission_user WHERE menu_codigo = 'organograma_gestao';
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'organograma_gestao';
-- DELETE FROM public.app_menu WHERE codigo = 'organograma_gestao';
-- NOTIFY pgrst, 'reload schema';
