-- =====================================================================
-- SOLICITAR REEMBOLSO — Central de Serviços.
--
-- Porta do bot de Discord de reembolsos (`remb.js`, SQLite + DM) para dentro
-- do ERP. O fluxo de negócio é o mesmo: o colaborador informa a viagem (PIX,
-- distância, data, saída, chegada), lança uma despesa por tipo com valor e
-- comprovante obrigatórios, conclui, e a solicitação vai para aprovação do
-- líder do setor, que aprova ou reprova com motivo.
--
-- TRÊS DIFERENÇAS EM RELAÇÃO AO BOT, todas deliberadas:
--
-- 1. ACESSO POR USUÁRIO, não por cargo. No bot, quem tinha a role do Discord
--    aprovava (`SETOR_ROLE_MAP`, `hasRole`). Aqui cada capacidade é um menu em
--    `app_menu`, liberado em Administração › Acesso por Usuário — o padrão
--    deste ERP (ver README.md da raiz). Nada de `has_role`, nada de
--    `empresa_id = get_user_empresa(...)`.
--
-- 2. CATÁLOGO CONFIGURÁVEL. O bot tinha os seis tipos chumbados no código,
--    com o comentário literal "sem limite de valor". Aqui viram tabela, e cada
--    tipo carrega TETO DE VALOR e JANELA DE HORÁRIO. É o diferencial pedido:
--    almoço só vale se a viagem passou entre 11h e 13h; quem saiu às 14h não
--    pede almoço.
--
-- 3. VALOR EM CENTAVOS (bigint), não em REAL. O SQLite do bot guardava `total
--    REAL` e somava em float — reembolso que não fecha centavo vira discussão
--    no financeiro. A soma é feita por trigger, em inteiro.
--
-- A validação de janela/teto está TAMBÉM em `src/lib/reembolso/regras.ts`.
-- Não é duplicação por descuido: lá avisa o usuário antes de ele preencher
-- tudo; aqui é a barreira de verdade, porque o front fala direto com o
-- Supabase pela anon key e nada impede um POST na mão.
--
-- Tabelas em MAIÚSCULAS/citadas (padrão dos módulos: CS_FORMULARIOS,
-- CS_LIDERES_SETOR…). Funções/triggers/índices/policies em minúsculo.
-- =====================================================================

-- 1) Menus / permissões -------------------------------------------------
-- Três capacidades separadas, e é de propósito que sejam três:
--   ...reembolso            → solicitar e ver as PRÓPRIAS (todo colaborador)
--   ...reembolso_aprovacao  → a fila de aprovação (líder / RH / financeiro)
--   ...reembolso_config     → mexer nos tipos, tetos e janelas
-- Quem define a regra não é necessariamente quem aprova, e quem aprova não é
-- quem pede. Juntar as três num menu só obrigaria a dar tudo para dar um.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem
  FROM (VALUES
    ('central_servicos_reembolso',           'Solicitar Reembolso',              '/app/central-servicos/reembolso',              70),
    ('central_servicos_reembolso_aprovacao', 'Reembolso — Aprovação',            '/app/central-servicos/reembolso/aprovacao',    71),
    ('central_servicos_reembolso_config',    'Reembolso — Tipos e Limites',      '/app/central-servicos/reembolso/configuracao', 72)
  ) AS x(codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Garante ativo = true mesmo se a linha já existisse desativada: can_access()
-- devolve false para menu inativo ANTES de olhar perfil, e nem o
-- Administrador Geral escapa disso (J1.C das regras de revisão).
UPDATE public.app_menu SET ativo = true
 WHERE codigo IN ('central_servicos_reembolso',
                  'central_servicos_reembolso_aprovacao',
                  'central_servicos_reembolso_config');

-- 2) Tabelas ------------------------------------------------------------

-- 2.1) Catálogo de tipos — o diferencial mora aqui.
CREATE TABLE IF NOT EXISTS public."CS_REEMBOLSO_TIPO" (
  codigo                text PRIMARY KEY,
  nome                  text NOT NULL,
  -- NULL = sem teto, que era exatamente o comportamento do bot. Manter o NULL
  -- como "sem limite" deixa migrar tipo por tipo, sem precisar inventar um
  -- número alto e falso para os que não têm teto (estacionamento, hospedagem).
  valor_maximo_centavos bigint CHECK (valor_maximo_centavos IS NULL OR valor_maximo_centavos > 0),
  -- Janela em que a despesa é aceita. Os dois NULL = qualquer horário.
  -- Guardados como `time` para o banco validar o formato sozinho.
  hora_inicio           time,
  hora_fim              time,
  ativo                 boolean NOT NULL DEFAULT true,
  ordem                 integer NOT NULL DEFAULT 100,
  atualizado_por        uuid REFERENCES auth.users(id),
  atualizado_por_nome   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Ou os dois têm horário, ou nenhum tem. Um lado só é sempre erro de
  -- digitação e produziria "das 11:00 às (nada)" na tela.
  CONSTRAINT cs_reembolso_tipo_janela_completa
    CHECK ((hora_inicio IS NULL) = (hora_fim IS NULL))
);

-- Os seis tipos do bot, já com teto e janela plausíveis para o dia 1. São
-- ponto de partida editável na tela de configuração, não regra fixa.
INSERT INTO public."CS_REEMBOLSO_TIPO" (codigo, nome, valor_maximo_centavos, hora_inicio, hora_fim, ordem)
VALUES
  ('cafe_manha',     'Café da Manhã',   2000, '05:00', '09:00',  10),
  ('cafe_tarde',     'Café da Tarde',   2000, '15:00', '17:30',  20),
  ('almoco',         'Almoço',          3500, '11:00', '13:00',  30),
  ('janta',          'Janta',           3500, '18:00', '21:00',  40),
  ('estacionamento', 'Estacionamento',  5000, NULL,    NULL,     50),
  ('hospedagem',     'Hospedagem',      NULL, NULL,    NULL,     60)
ON CONFLICT (codigo) DO NOTHING;

-- 2.2) A solicitação.
CREATE TABLE IF NOT EXISTS public."CS_REEMBOLSO" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              text,
  solicitante_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  solicitante_nome    text,
  setor               text,
  -- Competência "AAAA-MM" derivada da data da viagem — é como o mês fecha, e
  -- é o recorte de todas as listagens (o bot chamava de `mes`).
  competencia         text NOT NULL,
  pix                 text NOT NULL,
  distancia_km        numeric(10,2) NOT NULL DEFAULT 0 CHECK (distancia_km >= 0),
  data_viagem         date NOT NULL,
  saida               time NOT NULL,
  chegada             time NOT NULL,
  observacoes         text,
  -- Mantido por trigger a partir dos itens. Nunca escrito pelo cliente: era
  -- por isso que o bot recalculava o total no `concluir`.
  total_centavos      bigint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente','aprovado','reprovado','cancelado')),
  decidido_por        uuid REFERENCES auth.users(id),
  decidido_por_nome   text,
  decidido_em         timestamptz,
  motivo_reprovacao   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_reembolso_solicitante  ON public."CS_REEMBOLSO"(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_cs_reembolso_status       ON public."CS_REEMBOLSO"(status);
CREATE INDEX IF NOT EXISTS idx_cs_reembolso_competencia  ON public."CS_REEMBOLSO"(competencia);
CREATE INDEX IF NOT EXISTS idx_cs_reembolso_setor        ON public."CS_REEMBOLSO"(setor);

-- 2.3) Uma despesa da solicitação. Um tipo por solicitação, como no bot
-- (lá o `ressarcimentos` era um array em JSON com no máximo um item por tipo).
CREATE TABLE IF NOT EXISTS public."CS_REEMBOLSO_ITEM" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reembolso_id   uuid NOT NULL REFERENCES public."CS_REEMBOLSO"(id) ON DELETE CASCADE,
  tipo_codigo    text NOT NULL REFERENCES public."CS_REEMBOLSO_TIPO"(codigo),
  valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
  -- Comprovante é obrigatório por despesa: o bot travava o "concluir" enquanto
  -- faltasse um anexo, e sem ele o financeiro não presta contas.
  storage_path   text NOT NULL,
  nome_arquivo   text,
  mime_type      text,
  tamanho_bytes  bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reembolso_id, tipo_codigo)
);
CREATE INDEX IF NOT EXISTS idx_cs_reembolso_item_reembolso ON public."CS_REEMBOLSO_ITEM"(reembolso_id);

-- 2.4) Trilha. O bot mandava DM e a decisão morria no chat de quem apagou a
-- conversa; aqui fica no banco.
CREATE TABLE IF NOT EXISTS public."CS_REEMBOLSO_EVENTO" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reembolso_id uuid NOT NULL REFERENCES public."CS_REEMBOLSO"(id) ON DELETE CASCADE,
  tipo         text NOT NULL,   -- criado | aprovado | reprovado | cancelado
  descricao    text,
  autor_id     uuid DEFAULT auth.uid(),
  autor_nome   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cs_reembolso_evento_reembolso ON public."CS_REEMBOLSO_EVENTO"(reembolso_id);

-- 3) Triggers -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cs_reembolso_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS cs_reembolso_touch_trg ON public."CS_REEMBOLSO";
CREATE TRIGGER cs_reembolso_touch_trg BEFORE UPDATE ON public."CS_REEMBOLSO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_touch();

DROP TRIGGER IF EXISTS cs_reembolso_tipo_touch_trg ON public."CS_REEMBOLSO_TIPO";
CREATE TRIGGER cs_reembolso_tipo_touch_trg BEFORE UPDATE ON public."CS_REEMBOLSO_TIPO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_touch();

-- 3.1) A REGRA DO DIFERENCIAL, no banco.
--
-- Espelha `podeLancar` de src/lib/reembolso/regras.ts. A ordem das checagens é
-- a mesma de lá, e por isso: reclamar do teto de um tipo que a pessoa nem
-- podia pedir manda ela corrigir a coisa errada.
--
-- A janela é INTERSEÇÃO com o período da viagem, não "a saída está dentro da
-- janela": quem saiu 09h e voltou 15h atravessou o almoço inteiro e tem
-- direito, apesar de a saída estar fora. E o período que cruza a meia-noite
-- (saiu 22h, chegou 02h) é tratado como dois trechos — comparar 1320..120
-- direto daria intervalo negativo e recusaria a janta de graça.
CREATE OR REPLACE FUNCTION public.cs_reembolso_item_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  t        public."CS_REEMBOLSO_TIPO"%ROWTYPE;
  r        public."CS_REEMBOLSO"%ROWTYPE;
  alcanca  boolean;
BEGIN
  SELECT * INTO t FROM public."CS_REEMBOLSO_TIPO" WHERE codigo = NEW.tipo_codigo;
  IF NOT FOUND OR NOT t.ativo THEN
    RAISE EXCEPTION 'Tipo de despesa "%" não está disponível.', NEW.tipo_codigo;
  END IF;

  SELECT * INTO r FROM public."CS_REEMBOLSO" WHERE id = NEW.reembolso_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de reembolso não encontrada.';
  END IF;

  -- Item só entra enquanto ninguém decidiu. Sem isto, dava para inflar uma
  -- solicitação DEPOIS de aprovada e o total mudaria por baixo do aprovador.
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

  IF t.valor_maximo_centavos IS NOT NULL AND NEW.valor_centavos > t.valor_maximo_centavos THEN
    RAISE EXCEPTION '% tem teto de R$ %. Você lançou R$ %.',
      t.nome,
      to_char(t.valor_maximo_centavos / 100.0, 'FM999G999D00'),
      to_char(NEW.valor_centavos      / 100.0, 'FM999G999D00');
  END IF;

  RETURN NEW;
END $$;

-- Interseção de dois períodos de relógio, cada um podendo cruzar a meia-noite.
-- Separada da trigger porque é a única parte com risco real de erro sutil, e
-- assim dá para conferir no SQL Editor sem montar uma solicitação inteira:
--
--   SELECT public.cs_reembolso_periodos_cruzam('14:00','18:00','11:00','13:00'); -- f
--   SELECT public.cs_reembolso_periodos_cruzam('09:00','15:00','11:00','13:00'); -- t
--   SELECT public.cs_reembolso_periodos_cruzam('22:00','02:00','18:00','23:00'); -- t
--
-- Em vez de quebrar cada período em trechos, o fim que "passou da meia-noite"
-- ganha 1440 minutos e a janela é testada nos três dias vizinhos. Dá o mesmo
-- resultado com metade do código e sem laço aninhado.
CREATE OR REPLACE FUNCTION public.cs_reembolso_periodos_cruzam(
  a_ini time, a_fim time, b_ini time, b_fim time
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $$
DECLARE
  ai int; af int; bi int; bf int; d int;
BEGIN
  ai := EXTRACT(HOUR FROM a_ini)::int * 60 + EXTRACT(MINUTE FROM a_ini)::int;
  af := EXTRACT(HOUR FROM a_fim)::int * 60 + EXTRACT(MINUTE FROM a_fim)::int;
  bi := EXTRACT(HOUR FROM b_ini)::int * 60 + EXTRACT(MINUTE FROM b_ini)::int;
  bf := EXTRACT(HOUR FROM b_fim)::int * 60 + EXTRACT(MINUTE FROM b_fim)::int;

  IF af < ai THEN af := af + 1440; END IF;   -- viagem virou o dia
  IF bf < bi THEN bf := bf + 1440; END IF;   -- janela vira o dia (ceia 23h-01h)

  FOREACH d IN ARRAY ARRAY[-1440, 0, 1440] LOOP
    IF ai <= bf + d AND bi + d <= af THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

DROP TRIGGER IF EXISTS cs_reembolso_item_valida_trg ON public."CS_REEMBOLSO_ITEM";
CREATE TRIGGER cs_reembolso_item_valida_trg
  BEFORE INSERT OR UPDATE ON public."CS_REEMBOLSO_ITEM"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_item_valida();

-- 3.2) Total sempre igual à soma dos itens, em inteiro.
CREATE OR REPLACE FUNCTION public.cs_reembolso_recalcula_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE alvo uuid;
BEGIN
  alvo := COALESCE(NEW.reembolso_id, OLD.reembolso_id);
  UPDATE public."CS_REEMBOLSO" r
     SET total_centavos = COALESCE((
           SELECT sum(i.valor_centavos) FROM public."CS_REEMBOLSO_ITEM" i
            WHERE i.reembolso_id = alvo), 0)
   WHERE r.id = alvo;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cs_reembolso_total_trg ON public."CS_REEMBOLSO_ITEM";
CREATE TRIGGER cs_reembolso_total_trg
  AFTER INSERT OR UPDATE OR DELETE ON public."CS_REEMBOLSO_ITEM"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_recalcula_total();

-- 3.3) Número legível e evento de abertura.
--
-- O bot numerava por apelido do Discord (`PABLO12.pdf`) escaneando o
-- filesystem. Aqui é sequência por competência: REEMB-2026-08-0001.
CREATE SEQUENCE IF NOT EXISTS public.cs_reembolso_seq;

CREATE OR REPLACE FUNCTION public.cs_reembolso_ao_criar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'REEMB-' || replace(NEW.competencia, '-', '') || '-' ||
                  lpad(nextval('public.cs_reembolso_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cs_reembolso_ao_criar_trg ON public."CS_REEMBOLSO";
CREATE TRIGGER cs_reembolso_ao_criar_trg BEFORE INSERT ON public."CS_REEMBOLSO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_ao_criar();

-- Evento gravado por trigger SECURITY DEFINER: a RLS de EVENTO é só leitura
-- para o solicitante, então quem insere é o banco (mesmo padrão de
-- CHAMADO_SISTEMA_EVENTO).
CREATE OR REPLACE FUNCTION public.cs_reembolso_evento_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."CS_REEMBOLSO_EVENTO" (reembolso_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, 'criado', 'Solicitação registrada.', NEW.solicitante_id, NEW.solicitante_nome);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."CS_REEMBOLSO_EVENTO" (reembolso_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, NEW.status,
            CASE WHEN NEW.status = 'reprovado'
                 THEN COALESCE(NEW.motivo_reprovacao, 'Sem motivo informado.')
                 ELSE NULL END,
            auth.uid(), NEW.decidido_por_nome);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cs_reembolso_evento_auto_trg ON public."CS_REEMBOLSO";
CREATE TRIGGER cs_reembolso_evento_auto_trg
  AFTER INSERT OR UPDATE ON public."CS_REEMBOLSO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_evento_auto();

-- 3.4) Guard de campo: o solicitante não decide a própria solicitação.
--
-- Sem isto, a policy de UPDATE do dono (que existe para ele CANCELAR) seria
-- suficiente para ele mesmo gravar status='aprovado'. É o mesmo desenho de
-- chamado_sistema_guard().
CREATE OR REPLACE FUNCTION public.cs_reembolso_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar') THEN
    RETURN NEW;  -- quem tem a chave de decidir passa direto
  END IF;

  -- Para todo o resto, a ÚNICA transição permitida é pendente → cancelado.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pendente' AND NEW.status = 'cancelado') THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
  END IF;

  IF NEW.total_centavos IS DISTINCT FROM OLD.total_centavos THEN
    RAISE EXCEPTION 'O total é calculado pelas despesas, não pode ser digitado.';
  END IF;
  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id THEN
    RAISE EXCEPTION 'O solicitante não muda.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.motivo_reprovacao IS DISTINCT FROM OLD.motivo_reprovacao THEN
    RAISE EXCEPTION 'Só quem aprova preenche a decisão.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cs_reembolso_guard_trg ON public."CS_REEMBOLSO";
CREATE TRIGGER cs_reembolso_guard_trg BEFORE UPDATE ON public."CS_REEMBOLSO"
  FOR EACH ROW EXECUTE FUNCTION public.cs_reembolso_guard();

-- 4) Quem enxerga a fila de aprovação -----------------------------------
--
-- No bot, a solicitação era enviada por DM ao líder do setor
-- (`SETOR_ROLE_MAP` → `leaderRoleId`). Aqui a PERMISSÃO decide se a pessoa
-- aprova, e este recorte decide QUAIS ela vê:
--
--   • quem lidera setor em CS_LIDERES_SETOR vê as do SEU setor;
--   • quem tem a permissão e não lidera setor nenhum vê TODAS — é o caso do
--     RH e do financeiro, que acompanham a casa inteira.
--
-- O recorte é de VISIBILIDADE, nunca de autorização: sem o menu liberado, não
-- ver nada continua sendo o resultado, líder ou não.
CREATE OR REPLACE FUNCTION public.cs_reembolso_lidera_setor(_setor text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- Não lidera setor nenhum → enxerga tudo (perfil central).
    WHEN NOT EXISTS (
      SELECT 1 FROM public."CS_LIDERES_SETOR" l
        JOIN public."EMPREGADOS" e ON e."ID" = l.empregado_id
        JOIN public.profiles p ON p.empregado_id = e."ID"
       WHERE p.id = auth.uid()
    ) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public."CS_LIDERES_SETOR" l
        JOIN public."EMPREGADOS" e ON e."ID" = l.empregado_id
        JOIN public.profiles p ON p.empregado_id = e."ID"
       WHERE p.id = auth.uid() AND l.setor = _setor
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.cs_reembolso_lidera_setor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_lidera_setor(text) TO authenticated;

-- 5) RLS ----------------------------------------------------------------
ALTER TABLE public."CS_REEMBOLSO"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_REEMBOLSO_ITEM"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_REEMBOLSO_TIPO"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."CS_REEMBOLSO_EVENTO" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public."CS_REEMBOLSO"        FROM PUBLIC, anon;
REVOKE ALL ON public."CS_REEMBOLSO_ITEM"   FROM PUBLIC, anon;
REVOKE ALL ON public."CS_REEMBOLSO_TIPO"   FROM PUBLIC, anon;
REVOKE ALL ON public."CS_REEMBOLSO_EVENTO" FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE         ON public."CS_REEMBOLSO"        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."CS_REEMBOLSO_ITEM"   TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public."CS_REEMBOLSO_TIPO"   TO authenticated;
GRANT SELECT                         ON public."CS_REEMBOLSO_EVENTO" TO authenticated;

-- 5.1) CS_REEMBOLSO
-- Ter o menu liberado NÃO basta para ver a solicitação de outra pessoa: sem o
-- `solicitante_id = auth.uid()` no primeiro ramo, todo mundo com a tela veria
-- o PIX e o gasto de todo mundo.
DROP POLICY IF EXISTS cs_reembolso_select ON public."CS_REEMBOLSO";
CREATE POLICY cs_reembolso_select ON public."CS_REEMBOLSO"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR (
      public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'visualizar')
      AND public.cs_reembolso_lidera_setor(setor)
    )
  );

DROP POLICY IF EXISTS cs_reembolso_insert ON public."CS_REEMBOLSO";
CREATE POLICY cs_reembolso_insert ON public."CS_REEMBOLSO"
  FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND public.can_access(auth.uid(), 'central_servicos_reembolso', 'incluir')
  );

-- O dono entra aqui para CANCELAR; o aprovador, para decidir. Qual dos dois
-- está agindo é a trigger cs_reembolso_guard() que separa — policy não
-- consegue olhar coluna a coluna.
DROP POLICY IF EXISTS cs_reembolso_update ON public."CS_REEMBOLSO";
CREATE POLICY cs_reembolso_update ON public."CS_REEMBOLSO"
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid() AND status = 'pendente')
    OR (
      public.can_access(auth.uid(), 'central_servicos_reembolso_aprovacao', 'aprovar')
      AND public.cs_reembolso_lidera_setor(setor)
    )
  );

-- 5.2) CS_REEMBOLSO_ITEM — segue a visibilidade da solicitação-mãe.
DROP POLICY IF EXISTS cs_reembolso_item_select ON public."CS_REEMBOLSO_ITEM";
CREATE POLICY cs_reembolso_item_select ON public."CS_REEMBOLSO_ITEM"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CS_REEMBOLSO" r WHERE r.id = reembolso_id));

DROP POLICY IF EXISTS cs_reembolso_item_insert ON public."CS_REEMBOLSO_ITEM";
CREATE POLICY cs_reembolso_item_insert ON public."CS_REEMBOLSO_ITEM"
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."CS_REEMBOLSO" r
     WHERE r.id = reembolso_id AND r.solicitante_id = auth.uid() AND r.status = 'pendente'
  ));

-- Corrigir a despesa antes de alguém decidir é parte do fluxo (o bot deixava
-- "limpar despesas" e começar de novo).
DROP POLICY IF EXISTS cs_reembolso_item_update ON public."CS_REEMBOLSO_ITEM";
CREATE POLICY cs_reembolso_item_update ON public."CS_REEMBOLSO_ITEM"
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."CS_REEMBOLSO" r
     WHERE r.id = reembolso_id AND r.solicitante_id = auth.uid() AND r.status = 'pendente'
  ));

DROP POLICY IF EXISTS cs_reembolso_item_delete ON public."CS_REEMBOLSO_ITEM";
CREATE POLICY cs_reembolso_item_delete ON public."CS_REEMBOLSO_ITEM"
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."CS_REEMBOLSO" r
     WHERE r.id = reembolso_id AND r.solicitante_id = auth.uid() AND r.status = 'pendente'
  ));

-- 5.3) CS_REEMBOLSO_TIPO — todo mundo LÊ (a tela de solicitar precisa da
-- janela e do teto para avisar antes), mas só a permissão de configuração
-- ESCREVE. É a resposta a "quem pode mudar essas regras".
DROP POLICY IF EXISTS cs_reembolso_tipo_select ON public."CS_REEMBOLSO_TIPO";
CREATE POLICY cs_reembolso_tipo_select ON public."CS_REEMBOLSO_TIPO"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cs_reembolso_tipo_insert ON public."CS_REEMBOLSO_TIPO";
CREATE POLICY cs_reembolso_tipo_insert ON public."CS_REEMBOLSO_TIPO"
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access(auth.uid(), 'central_servicos_reembolso_config', 'incluir'));

DROP POLICY IF EXISTS cs_reembolso_tipo_update ON public."CS_REEMBOLSO_TIPO";
CREATE POLICY cs_reembolso_tipo_update ON public."CS_REEMBOLSO_TIPO"
  FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'central_servicos_reembolso_config', 'alterar'));

-- 5.4) CS_REEMBOLSO_EVENTO — leitura acompanha a solicitação; escrita é só
-- das triggers SECURITY DEFINER, então não há policy de INSERT de propósito.
DROP POLICY IF EXISTS cs_reembolso_evento_select ON public."CS_REEMBOLSO_EVENTO";
CREATE POLICY cs_reembolso_evento_select ON public."CS_REEMBOLSO_EVENTO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."CS_REEMBOLSO" r WHERE r.id = reembolso_id));

-- 6) Storage ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('reembolsos', 'reembolsos', false, 20971520) -- 20 MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "reembolso comprovante select" ON storage.objects;
CREATE POLICY "reembolso comprovante select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reembolsos');

DROP POLICY IF EXISTS "reembolso comprovante insert" ON storage.objects;
CREATE POLICY "reembolso comprovante insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reembolsos');

-- Trocar o comprovante errado antes de enviar faz parte do fluxo.
DROP POLICY IF EXISTS "reembolso comprovante delete" ON storage.objects;
CREATE POLICY "reembolso comprovante delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reembolsos' AND owner = auth.uid());

-- 7) RPCs ---------------------------------------------------------------
-- Cards de "Minhas solicitações". Uma ida ao banco em vez de quatro counts.
CREATE OR REPLACE FUNCTION public.cs_reembolso_meus_stats()
RETURNS TABLE(pendentes int, aprovados int, reprovados int, total_aprovado_centavos bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'pendente')::int,
    count(*) FILTER (WHERE status = 'aprovado')::int,
    count(*) FILTER (WHERE status = 'reprovado')::int,
    COALESCE(sum(total_centavos) FILTER (WHERE status = 'aprovado'), 0)::bigint
  FROM public."CS_REEMBOLSO"
 WHERE solicitante_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.cs_reembolso_meus_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cs_reembolso_meus_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP TRIGGER IF EXISTS cs_reembolso_evento_auto_trg ON public."CS_REEMBOLSO";
-- DROP TRIGGER IF EXISTS cs_reembolso_guard_trg       ON public."CS_REEMBOLSO";
-- DROP TRIGGER IF EXISTS cs_reembolso_ao_criar_trg    ON public."CS_REEMBOLSO";
-- DROP TRIGGER IF EXISTS cs_reembolso_touch_trg       ON public."CS_REEMBOLSO";
-- DROP TRIGGER IF EXISTS cs_reembolso_tipo_touch_trg  ON public."CS_REEMBOLSO_TIPO";
-- DROP TRIGGER IF EXISTS cs_reembolso_total_trg       ON public."CS_REEMBOLSO_ITEM";
-- DROP TRIGGER IF EXISTS cs_reembolso_item_valida_trg ON public."CS_REEMBOLSO_ITEM";
-- DROP FUNCTION IF EXISTS public.cs_reembolso_meus_stats();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_lidera_setor(text);
-- DROP FUNCTION IF EXISTS public.cs_reembolso_evento_auto();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_guard();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_ao_criar();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_recalcula_total();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_item_valida();
-- DROP FUNCTION IF EXISTS public.cs_reembolso_periodos_cruzam(time,time,time,time);
-- DROP FUNCTION IF EXISTS public.cs_reembolso_touch();
-- DROP SEQUENCE IF EXISTS public.cs_reembolso_seq;
-- DROP TABLE IF EXISTS public."CS_REEMBOLSO_EVENTO";
-- DROP TABLE IF EXISTS public."CS_REEMBOLSO_ITEM";
-- DROP TABLE IF EXISTS public."CS_REEMBOLSO";
-- DROP TABLE IF EXISTS public."CS_REEMBOLSO_TIPO";
-- DELETE FROM public.app_menu WHERE codigo IN ('central_servicos_reembolso',
--   'central_servicos_reembolso_aprovacao','central_servicos_reembolso_config');
-- NOTIFY pgrst, 'reload schema';
