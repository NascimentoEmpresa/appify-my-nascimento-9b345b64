-- =====================================================================
-- CONTROLE DE DIÁRIAS — Operacional (/app/operacional/diarias)
--
-- A tela existia só como frontend: contratos, postos, faltante, diarista e a
-- própria lista de solicitações vinham de constantes em
-- src/pages/operacional/diarias.ts. Esta migration cria o backend inteiro do
-- módulo — o que a tela mostra passa a sair do banco. Aprovar também cria,
-- na mesma transação, a despesa em rascunho que a pré-visualização anuncia
-- no Malote.
--
-- DE ONDE VEM CADA DROPDOWN (decisão desta migration, e o motivo):
--
--   Contrato → public.contratos (a tabela ALIMENTADA POR LICITAÇÕES, plural).
--     NÃO é public.contrato (singular), que é a base contábil/orçamentária de
--     Contratos ERP. As duas coexistem no projeto; quem o encarregado e o
--     Supply enxergam é `contratos`, e diária é fluxo de campo, do mesmo
--     mundo. Contrato é ESCOLHA do usuário, nunca derivado de EMPREGADOS:
--     um encarregado atende mais de um contrato.
--
--   Posto → public.sup_posto (ativo AND aprovado), o mesmo catálogo em
--     cascata que o encarregado já usa para pedir material. "Posto" é a mesma
--     coisa do mundo real nos dois módulos; criar uma segunda lista de postos
--     só para diárias faria o operacional cadastrar tudo duas vezes e as duas
--     divergirem na primeira semana.
--
--   Faltante / Diarista → public."EMPREGADOS", pela RPC
--     diaria_buscar_empregados() (busca por nome sem acento e por CPF pelos
--     dígitos, mesmo desenho de admin_buscar_empregados). O CPF do cadastro é
--     o que preenche o campo — digitar CPF na mão era a porta de entrada do
--     pagamento para a pessoa errada.
--
-- VALORES EM CENTAVOS (bigint), não em numeric/REAL: diária + VT são somados
-- por linha e por solicitação, e vão virar despesa no Malote. Total que não
-- fecha centavo vira discussão no financeiro. A soma é feita por trigger, em
-- inteiro — o cliente nunca escreve o total.
--
-- A REGRA DE DUPLICIDADE está TAMBÉM em src/pages/operacional/diarias.ts
-- (avaliarConflitos). Não é duplicação por descuido: lá avisa o usuário linha
-- a linha enquanto ele digita; aqui é a barreira de verdade, porque o front
-- fala direto com o Supabase pela anon key e nada impede um POST na mão.
--
-- Tabelas de domínio em MAIÚSCULAS/citadas; funções, triggers, índices e
-- policies em snake_case minúsculo.
-- =====================================================================

-- ── 1) Menu e permissões ─────────────────────────────────────────────
--
-- O menu 'operacional_diarias' já foi cadastrado em
-- 20260910000005_cadastra_rotas_orfas.sql — o INSERT abaixo existe só para
-- esta migration ser aplicável sozinha, num banco onde aquela não rodou.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, 'operacional_diarias', 'Diárias', '/app/operacional/diarias',
       COALESCE((SELECT max(am.ordem) FROM public.app_menu am WHERE am.modulo_id = mo.id), 0) + 10
  FROM public.app_modulo mo
 WHERE mo.nome = 'Operacional'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = 'operacional_diarias');

-- can_access() devolve false para menu inativo ANTES de olhar perfil, e nem o
-- Administrador Geral escapa disso.
UPDATE public.app_menu SET ativo = true WHERE codigo = 'operacional_diarias';

-- Aquela migration concedeu só 'visualizar' ao perfil Operacional. Sem
-- 'incluir' e 'aprovar' a tela abriria vazia e o botão de salvar bateria na
-- RLS — a permissão precisa nascer junto com a capacidade, não depois.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'operacional_diarias', v.acao::public.app_acao, true
  FROM public.perfil_acesso pa
  JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('aprovar')) AS v(acao) ON true
 WHERE pa.nome = 'Operacional' AND pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT DO NOTHING;

-- ── 2) Tabelas ───────────────────────────────────────────────────────

-- 2.1) A solicitação (o cabeçalho das seções 1 a 3 e 6 do modal).
--
-- Nome e CPF ficam GRAVADOS na linha, além do id do empregado: o cadastro de
-- EMPREGADOS muda (casamento, correção de digitação, desligamento) e uma
-- solicitação paga no mês passado tem que continuar mostrando para quem foi
-- pago naquele dia. O `*_empregado_id` serve para rastrear, não para exibir.
CREATE TABLE IF NOT EXISTS public."DIARIA_SOLICITACAO" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                text UNIQUE,               -- SD-2026-000123, por trigger
  status                text NOT NULL DEFAULT 'solicitada'
                          CHECK (status IN ('solicitada','aprovada','reprovada')),

  contrato_id           uuid NOT NULL REFERENCES public.contratos(id),
  -- Snapshot do contrato: a RLS de `contratos` ainda recorta por empresa e
  -- não pode fazer o nome sumir de uma diária que a pessoa pode visualizar.
  contrato_nome         text NOT NULL,
  contrato_cliente      text,
  contrato_empresa      text,
  -- Posto referencia o catálogo, mas o NOME também é gravado: posto renomeado
  -- ou desativado não pode reescrever o histórico da solicitação.
  posto_id              uuid REFERENCES public.sup_posto(id),
  posto_nome            text NOT NULL,

  faltante_empregado_id bigint,
  faltante_nome         text NOT NULL,
  faltante_cpf          text NOT NULL,

  diarista_empregado_id bigint,
  diarista_nome         text NOT NULL,
  diarista_cpf          text NOT NULL,
  pix                   text NOT NULL,

  observacoes           text,

  -- Mantido por trigger a partir das linhas. Nunca escrito pelo cliente.
  valor_total_centavos  bigint NOT NULL DEFAULT 0,

  solicitante_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  solicitante_nome      text,

  -- Seção 7 do modal — preenchida no ato da aprovação e usada para criar a
  -- despesa em rascunho no Malote.
  malote_motivo         text,
  malote_data_pagamento date,
  malote_despesa_id     uuid REFERENCES public.malote_despesa(id),
  enviado_malote_em     timestamptz,

  decidido_por          uuid REFERENCES auth.users(id),
  decidido_por_nome     text,
  decidido_em           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_solicitacao_status       ON public."DIARIA_SOLICITACAO"(status);
CREATE INDEX IF NOT EXISTS idx_diaria_solicitacao_contrato     ON public."DIARIA_SOLICITACAO"(contrato_id);
CREATE INDEX IF NOT EXISTS idx_diaria_solicitacao_solicitante  ON public."DIARIA_SOLICITACAO"(solicitante_id);
-- A checagem de duplicidade busca por CPF em dígitos; sem estes dois índices
-- ela faz seq scan a cada linha digitada no modal.
CREATE INDEX IF NOT EXISTS idx_diaria_solicitacao_faltante_cpf
  ON public."DIARIA_SOLICITACAO"((regexp_replace(faltante_cpf, '\D', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_diaria_solicitacao_diarista_cpf
  ON public."DIARIA_SOLICITACAO"((regexp_replace(diarista_cpf, '\D', '', 'g')));

-- 2.2) Uma diária da solicitação (a grade da seção 4).
CREATE TABLE IF NOT EXISTS public."DIARIA_LINHA" (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id         uuid NOT NULL REFERENCES public."DIARIA_SOLICITACAO"(id) ON DELETE CASCADE,
  data                   date NOT NULL,
  turno                  text NOT NULL
                           CHECK (turno IN ('manha','tarde','noite','dia_inteiro')),
  qt_vt                  integer NOT NULL DEFAULT 0 CHECK (qt_vt >= 0),
  valor_unit_vt_centavos bigint  NOT NULL DEFAULT 0 CHECK (valor_unit_vt_centavos >= 0),
  valor_diaria_centavos  bigint  NOT NULL DEFAULT 0 CHECK (valor_diaria_centavos >= 0),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_linha_solicitacao ON public."DIARIA_LINHA"(solicitacao_id);
CREATE INDEX IF NOT EXISTS idx_diaria_linha_data        ON public."DIARIA_LINHA"(data);

-- 2.3) Anexos (seção 5). Os dois são obrigatórios na tela; a obrigatoriedade
-- é validada na conclusão (RPC), não por NOT NULL, porque o upload acontece
-- depois de a solicitação existir — é dela que sai a pasta no bucket.
CREATE TABLE IF NOT EXISTS public."DIARIA_ANEXO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public."DIARIA_SOLICITACAO"(id) ON DELETE CASCADE,
  categoria      text NOT NULL CHECK (categoria IN ('comprovante_ponto','documento')),
  storage_path   text NOT NULL,
  nome_arquivo   text,
  mime_type      text,
  tamanho_bytes  bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_anexo_solicitacao ON public."DIARIA_ANEXO"(solicitacao_id);

-- 2.4) Trilha. Quem aprovou/reprovou e quando não pode depender de ninguém
-- lembrar — é dinheiro pago a pessoa física.
CREATE TABLE IF NOT EXISTS public."DIARIA_EVENTO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public."DIARIA_SOLICITACAO"(id) ON DELETE CASCADE,
  tipo           text NOT NULL,   -- criada | aprovada | reprovada
  descricao      text,
  autor_id       uuid DEFAULT auth.uid(),
  autor_nome     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_evento_solicitacao ON public."DIARIA_EVENTO"(solicitacao_id);

-- ── 3) Triggers ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.diaria_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS diaria_touch_trg ON public."DIARIA_SOLICITACAO";
CREATE TRIGGER diaria_touch_trg BEFORE UPDATE ON public."DIARIA_SOLICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_touch();

-- 3.1) Número legível, sequencial por ano: SD-2026-000123.
CREATE SEQUENCE IF NOT EXISTS public.diaria_solicitacao_seq;

CREATE OR REPLACE FUNCTION public.diaria_ao_criar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.numero IS NULL THEN
    NEW.numero := 'SD-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('public.diaria_solicitacao_seq')::text, 6, '0');
  END IF;
  IF NEW.solicitante_nome IS NULL THEN
    SELECT COALESCE(p.display_name, p.email) INTO NEW.solicitante_nome
      FROM public.profiles p WHERE p.id = NEW.solicitante_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS diaria_ao_criar_trg ON public."DIARIA_SOLICITACAO";
CREATE TRIGGER diaria_ao_criar_trg BEFORE INSERT ON public."DIARIA_SOLICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_ao_criar();

-- 3.2) Total = soma das linhas, em inteiro. Cada linha vale
-- valor_diaria + qt_vt * valor_unit_vt (é a conta de valorTotalLinha no front).
--
-- O recálculo é feito por trigger e precisa atravessar o guard de 3.4, que
-- proíbe o CLIENTE de digitar o total. A marca é uma GUC de transação, setada
-- só aqui dentro — uma coluna-bandeira não serviria, porque o guard roda no
-- mesmo UPDATE que a mudaria.
CREATE OR REPLACE FUNCTION public.diaria_recalculando() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$ SELECT COALESCE(current_setting('diaria.recalculando', true), '') = '1' $$;

CREATE OR REPLACE FUNCTION public.diaria_recalcula_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE alvo uuid;
BEGIN
  alvo := COALESCE(NEW.solicitacao_id, OLD.solicitacao_id);
  PERFORM set_config('diaria.recalculando', '1', true);
  UPDATE public."DIARIA_SOLICITACAO" s
     SET valor_total_centavos = COALESCE((
           SELECT sum(l.valor_diaria_centavos + l.qt_vt * l.valor_unit_vt_centavos)
             FROM public."DIARIA_LINHA" l WHERE l.solicitacao_id = alvo), 0)
   WHERE s.id = alvo;
  PERFORM set_config('diaria.recalculando', '0', true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS diaria_total_trg ON public."DIARIA_LINHA";
CREATE TRIGGER diaria_total_trg
  AFTER INSERT OR UPDATE OR DELETE ON public."DIARIA_LINHA"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_recalcula_total();

-- 3.3) Duplicidade de escala — a barreira de verdade.
--
-- "Dia Inteiro" cobre os três turnos, então conflita com qualquer um deles;
-- os demais só conflitam entre iguais. Idêntico a turnosConflitam() no front.
CREATE OR REPLACE FUNCTION public.diaria_turnos_conflitam(a text, b text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$ SELECT a = b OR a = 'dia_inteiro' OR b = 'dia_inteiro' $$;

-- Solicitação REPROVADA não ocupa escala (o front já pensa assim) — bater com
-- ela seria impedir de refazer a solicitação corrigida, que é o caso normal
-- depois de uma reprovação.
CREATE OR REPLACE FUNCTION public.diaria_linha_valida() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  s        public."DIARIA_SOLICITACAO"%ROWTYPE;
  conflito record;
BEGIN
  SELECT * INTO s FROM public."DIARIA_SOLICITACAO" WHERE id = NEW.solicitacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de diária não encontrada.';
  END IF;

  -- Linha só entra/muda enquanto ninguém decidiu. Sem isto, dava para inflar
  -- o valor DEPOIS de aprovado e o total mudaria por baixo do aprovador.
  IF s.status <> 'solicitada' THEN
    RAISE EXCEPTION 'Solicitação já foi % — não aceita mais diárias.', s.status;
  END IF;

  -- Note que a subquery qualifica TODAS as colunas com o alias (o2/l2): sem
  -- isso, `id` dentro do EXISTS se ligaria à tabela de dentro e o filtro
  -- "menos a própria linha" viraria sempre verdadeiro.
  SELECT o2.numero AS numero, l2.data AS data, l2.turno AS turno,
         (regexp_replace(o2.faltante_cpf, '\D', '', 'g')
            = regexp_replace(s.faltante_cpf, '\D', '', 'g')) AS bate_faltante,
         (regexp_replace(o2.diarista_cpf, '\D', '', 'g')
            = regexp_replace(s.diarista_cpf, '\D', '', 'g')) AS bate_diarista
    INTO conflito
    FROM public."DIARIA_LINHA" l2
    JOIN public."DIARIA_SOLICITACAO" o2 ON o2.id = l2.solicitacao_id
   WHERE l2.id <> NEW.id
     AND l2.data = NEW.data
     AND public.diaria_turnos_conflitam(l2.turno, NEW.turno)
     AND o2.status <> 'reprovada'
     AND (   regexp_replace(o2.faltante_cpf, '\D', '', 'g')
               = regexp_replace(s.faltante_cpf, '\D', '', 'g')
          OR regexp_replace(o2.diarista_cpf, '\D', '', 'g')
               = regexp_replace(s.diarista_cpf, '\D', '', 'g'))
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Duplicidade no %: já existe diária em % (%) na solicitação %.',
      CASE WHEN conflito.bate_faltante AND conflito.bate_diarista THEN 'faltante e diarista'
           WHEN conflito.bate_faltante THEN 'faltante'
           ELSE 'diarista' END,
      to_char(conflito.data, 'DD/MM/YYYY'),
      conflito.turno,
      COALESCE(conflito.numero, '(em edição)');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS diaria_linha_valida_trg ON public."DIARIA_LINHA";
CREATE TRIGGER diaria_linha_valida_trg
  BEFORE INSERT OR UPDATE ON public."DIARIA_LINHA"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_linha_valida();

-- 3.4) Guard de campo: quem solicita não decide a própria solicitação.
--
-- A policy de UPDATE precisa deixar o dono entrar (ele corrige a solicitação
-- enquanto está 'solicitada'); sem este guard, entrar seria o bastante para
-- ele mesmo gravar status='aprovada'. Mesmo desenho de cs_reembolso_guard().
CREATE OR REPLACE FUNCTION public.diaria_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa_id       uuid;
  v_classificacao_id uuid;
  v_competencia      text;
  v_malote_id        uuid;
BEGIN
  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND NOT public.diaria_recalculando() THEN
    RAISE EXCEPTION 'O total é calculado pelas diárias, não pode ser digitado.';
  END IF;
  IF NEW.valor_total_centavos IS DISTINCT FROM OLD.valor_total_centavos
     AND public.diaria_recalculando() THEN
    RETURN NEW;
  END IF;
  IF NEW.solicitante_id IS DISTINCT FROM OLD.solicitante_id THEN
    RAISE EXCEPTION 'O solicitante não muda.';
  END IF;
  IF NEW.numero IS DISTINCT FROM OLD.numero THEN
    RAISE EXCEPTION 'O número da solicitação não muda.';
  END IF;

  IF public.can_access(auth.uid(), 'operacional_diarias', 'aprovar') THEN
    -- Ter a permissão de aprovar não autoriza reescrever o lançamento. Este
    -- ramo só aceita a decisão e os dois campos que a acompanham no Malote.
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[]) THEN
      RAISE EXCEPTION 'A aprovação não pode alterar os dados da solicitação.';
    END IF;

    -- Quem decidiu é sempre quem está logado, não o que o cliente mandou:
    -- decidido_por é a assinatura da aprovação de um pagamento.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status <> 'solicitada' THEN
        RAISE EXCEPTION 'A solicitação já foi % e não pode ser decidida novamente.', OLD.status;
      END IF;
      IF NEW.status NOT IN ('aprovada', 'reprovada') THEN
        RAISE EXCEPTION 'Decisão inválida para a solicitação.';
      END IF;
      IF OLD.solicitante_id = auth.uid() THEN
        RAISE EXCEPTION 'Quem solicitou a diária não pode aprovar ou reprovar a própria solicitação.';
      END IF;
      IF NEW.status = 'aprovada'
         AND (btrim(coalesce(NEW.malote_motivo, '')) = ''
              OR NEW.malote_data_pagamento IS NULL) THEN
        RAISE EXCEPTION 'Nome/motivo e data de pagamento são obrigatórios para aprovar.';
      END IF;
      IF NEW.status = 'aprovada' THEN
        SELECT c.empresa_id INTO v_empresa_id
          FROM public.contratos c WHERE c.id = OLD.contrato_id;
        IF v_empresa_id IS NULL THEN
          RAISE EXCEPTION 'O contrato da diária não possui empresa para gerar a despesa do Malote.';
        END IF;

        -- A classificação é o catálogo global do Planejamento. Se "Diária"
        -- ainda não estiver cadastrada, a despesa nasce sem classificação e
        -- o Malote exige o preenchimento antes de sair do rascunho.
        SELECT c.id INTO v_classificacao_id
          FROM public.planejamento_orcamentario_classificacao c
         WHERE c.ativo = true
           AND lower(public.unaccent_safe(btrim(c.nome))) = 'diaria'
         ORDER BY c.created_at
         LIMIT 1;

        SELECT to_char(min(l.data), 'YYYY-MM') INTO v_competencia
          FROM public."DIARIA_LINHA" l WHERE l.solicitacao_id = OLD.id;

        INSERT INTO public.malote_despesa (
          empresa_id, classificacao_id, origem, status, nome, valor_total,
          motivo, descricao, tipo_movimento, tipo, contrato_id,
          data_pagamento, competencia, informacoes_pagamento, created_by
        ) VALUES (
          v_empresa_id, v_classificacao_id, 'despesa_unica', 'rascunho',
          btrim(NEW.malote_motivo), OLD.valor_total_centavos / 100.0,
          'Pagamento de diária ' || coalesce(OLD.numero, OLD.id::text),
          'Gerado automaticamente pelo Controle de Diárias. Faltante: ' ||
            OLD.faltante_nome || '; diarista: ' || OLD.diarista_nome ||
            '; posto: ' || OLD.posto_nome || '.',
          'saida', 'contrato', OLD.contrato_id,
          NEW.malote_data_pagamento, v_competencia,
          'PIX: ' || OLD.pix, auth.uid()
        ) RETURNING id INTO v_malote_id;

        NEW.malote_despesa_id := v_malote_id;
        NEW.enviado_malote_em := now();
      END IF;
      IF NEW.status = 'reprovada' THEN
        NEW.malote_motivo := NULL;
        NEW.malote_data_pagamento := NULL;
      END IF;
      NEW.decidido_por := auth.uid();
      NEW.decidido_em  := now();
      SELECT COALESCE(p.display_name, p.email) INTO NEW.decidido_por_nome
        FROM public.profiles p WHERE p.id = auth.uid();
    ELSIF NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
       OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
       OR NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
       OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
       OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em THEN
      RAISE EXCEPTION 'Os dados da decisão só mudam junto com o status.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação.';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['observacoes', 'updated_at']::text[])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['observacoes', 'updated_at']::text[]) THEN
    RAISE EXCEPTION 'Depois de criada, somente a observação da solicitação pode ser corrigida.';
  END IF;
  IF NEW.decidido_por IS DISTINCT FROM OLD.decidido_por
     OR NEW.decidido_por_nome IS DISTINCT FROM OLD.decidido_por_nome
     OR NEW.decidido_em IS DISTINCT FROM OLD.decidido_em
     OR NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
     OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
     OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
     OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em THEN
    RAISE EXCEPTION 'Só quem aprova preenche os dados do Malote.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS diaria_guard_trg ON public."DIARIA_SOLICITACAO";
CREATE TRIGGER diaria_guard_trg BEFORE UPDATE ON public."DIARIA_SOLICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_guard();

-- 3.5) Trilha automática. A RLS de EVENTO é só leitura, então quem insere é
-- o banco (mesmo padrão de CHAMADO_SISTEMA_EVENTO).
CREATE OR REPLACE FUNCTION public.diaria_evento_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."DIARIA_EVENTO" (solicitacao_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, 'criada', 'Solicitação registrada.', NEW.solicitante_id, NEW.solicitante_nome);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."DIARIA_EVENTO" (solicitacao_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, NEW.status,
            CASE WHEN NEW.status = 'aprovada'
                 THEN 'Enviada para o Malote: ' || COALESCE(NEW.malote_motivo, '(sem motivo)')
                 ELSE NULL END,
            auth.uid(), NEW.decidido_por_nome);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS diaria_evento_auto_trg ON public."DIARIA_SOLICITACAO";
CREATE TRIGGER diaria_evento_auto_trg
  AFTER INSERT OR UPDATE ON public."DIARIA_SOLICITACAO"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_evento_auto();

-- ── 4) RLS ───────────────────────────────────────────────────────────
ALTER TABLE public."DIARIA_SOLICITACAO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_LINHA"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_ANEXO"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_EVENTO"      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public."DIARIA_SOLICITACAO" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_LINHA"       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_ANEXO"       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_EVENTO"      FROM PUBLIC, anon, authenticated;
-- INSERT do conjunto inteiro é exclusivamente pela RPC atômica. A tela não
-- edita linhas/anexos depois de salvar; não há motivo para expor essas
-- escritas pelo PostgREST e permitir contornar as validações da RPC.
GRANT SELECT, UPDATE ON public."DIARIA_SOLICITACAO" TO authenticated;
GRANT SELECT         ON public."DIARIA_LINHA"       TO authenticated;
GRANT SELECT         ON public."DIARIA_ANEXO"       TO authenticated;
GRANT SELECT         ON public."DIARIA_EVENTO"      TO authenticated;

-- 4.1) DIARIA_SOLICITACAO
--
-- Diária não é dado pessoal do solicitante: é escala e pagamento do contrato,
-- e a tela é uma lista de trabalho compartilhada (o operacional confere o que
-- o colega lançou, e o conflito de escala só faz sentido se todos enxergam
-- todos). Por isso o SELECT é por MENU, não por dono — o dono aparece no OR
-- só para quem lançou continuar vendo o próprio lançamento se a permissão de
-- visualizar for revogada dele depois.
DROP POLICY IF EXISTS diaria_solicitacao_select ON public."DIARIA_SOLICITACAO";
CREATE POLICY diaria_solicitacao_select ON public."DIARIA_SOLICITACAO"
  FOR SELECT TO authenticated
  USING (
    solicitante_id = auth.uid()
    OR public.can_access(auth.uid(), 'operacional_diarias', 'visualizar')
  );

DROP POLICY IF EXISTS diaria_solicitacao_insert ON public."DIARIA_SOLICITACAO";
CREATE POLICY diaria_solicitacao_insert ON public."DIARIA_SOLICITACAO"
  FOR INSERT TO authenticated
  WITH CHECK (
    solicitante_id = auth.uid()
    AND public.can_access(auth.uid(), 'operacional_diarias', 'incluir')
  );

-- O dono entra para corrigir enquanto está 'solicitada'; o aprovador, para
-- decidir. Qual dos dois está agindo é diaria_guard() que separa — policy não
-- consegue olhar coluna a coluna.
DROP POLICY IF EXISTS diaria_solicitacao_update ON public."DIARIA_SOLICITACAO";
CREATE POLICY diaria_solicitacao_update ON public."DIARIA_SOLICITACAO"
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid() AND status = 'solicitada')
    OR public.can_access(auth.uid(), 'operacional_diarias', 'aprovar')
  );

-- 4.2) DIARIA_LINHA / DIARIA_ANEXO — seguem a visibilidade da solicitação-mãe
-- (o EXISTS reaplica a policy de SELECT dela). Escrita só do dono, e só
-- enquanto ninguém decidiu.
DROP POLICY IF EXISTS diaria_linha_select ON public."DIARIA_LINHA";
CREATE POLICY diaria_linha_select ON public."DIARIA_LINHA"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."DIARIA_SOLICITACAO" s WHERE s.id = solicitacao_id));

DROP POLICY IF EXISTS diaria_linha_insert ON public."DIARIA_LINHA";
CREATE POLICY diaria_linha_insert ON public."DIARIA_LINHA"
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."DIARIA_SOLICITACAO" s
     WHERE s.id = solicitacao_id AND s.solicitante_id = auth.uid() AND s.status = 'solicitada'
  ));

DROP POLICY IF EXISTS diaria_linha_update ON public."DIARIA_LINHA";
CREATE POLICY diaria_linha_update ON public."DIARIA_LINHA"
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."DIARIA_SOLICITACAO" s
     WHERE s.id = solicitacao_id AND s.solicitante_id = auth.uid() AND s.status = 'solicitada'
  ));

DROP POLICY IF EXISTS diaria_linha_delete ON public."DIARIA_LINHA";
CREATE POLICY diaria_linha_delete ON public."DIARIA_LINHA"
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."DIARIA_SOLICITACAO" s
     WHERE s.id = solicitacao_id AND s.solicitante_id = auth.uid() AND s.status = 'solicitada'
  ));

DROP POLICY IF EXISTS diaria_anexo_select ON public."DIARIA_ANEXO";
CREATE POLICY diaria_anexo_select ON public."DIARIA_ANEXO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."DIARIA_SOLICITACAO" s WHERE s.id = solicitacao_id));

DROP POLICY IF EXISTS diaria_anexo_insert ON public."DIARIA_ANEXO";
CREATE POLICY diaria_anexo_insert ON public."DIARIA_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."DIARIA_SOLICITACAO" s
     WHERE s.id = solicitacao_id AND s.solicitante_id = auth.uid() AND s.status = 'solicitada'
  ));

DROP POLICY IF EXISTS diaria_anexo_delete ON public."DIARIA_ANEXO";
CREATE POLICY diaria_anexo_delete ON public."DIARIA_ANEXO"
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public."DIARIA_SOLICITACAO" s
     WHERE s.id = solicitacao_id AND s.solicitante_id = auth.uid() AND s.status = 'solicitada'
  ));

-- 4.3) DIARIA_EVENTO — leitura acompanha a solicitação; escrita é só das
-- triggers SECURITY DEFINER, então não há policy de INSERT de propósito.
DROP POLICY IF EXISTS diaria_evento_select ON public."DIARIA_EVENTO";
CREATE POLICY diaria_evento_select ON public."DIARIA_EVENTO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."DIARIA_SOLICITACAO" s WHERE s.id = solicitacao_id));

-- ── 5) Storage ───────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('diarias', 'diarias', false, 10485760) -- 10 MB (o modal já avisa isso)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "diaria anexo select" ON storage.objects;
CREATE POLICY "diaria anexo select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'diarias'
    AND public.can_access(auth.uid(), 'operacional_diarias', 'visualizar')
  );

DROP POLICY IF EXISTS "diaria anexo insert" ON storage.objects;
CREATE POLICY "diaria anexo insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'diarias'
    AND public.can_access(auth.uid(), 'operacional_diarias', 'incluir')
  );

-- Trocar o arquivo errado antes de enviar faz parte do fluxo.
DROP POLICY IF EXISTS "diaria anexo delete" ON storage.objects;
CREATE POLICY "diaria anexo delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'diarias'
    AND owner = auth.uid()
    AND public.can_access(auth.uid(), 'operacional_diarias', 'incluir')
  );

-- ── 6) RPCs de apoio aos dropdowns ───────────────────────────────────

-- 6.1) Busca de empregado para Faltante e Diarista.
--
-- Mesma mecânica de admin_buscar_empregados (sem acento, por palavras em
-- qualquer ordem, CPF pelos dígitos), com três diferenças: quem pode chamar é
-- quem tem a TELA DE DIÁRIAS (não 'admin'), o filtro de desligado é o mesmo,
-- e devolve só o que a tela precisa preencher — nome, CPF e cargo.
--
-- Contas de teste ficam de fora: "Iury Silva - Testes" colide com o nome
-- oficial e já apareceu como sósia em outras buscas por nome.
CREATE OR REPLACE FUNCTION public.diaria_buscar_empregados(p_termo text)
RETURNS TABLE (
  empregado_id bigint,
  nome         text,
  cpf          text,
  cargo        text,
  situacao     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_q      text   := btrim(coalesce(p_termo, ''));
  v_digits text   := regexp_replace(v_q, '\D', '', 'g');
  v_tokens text[];
  v_bloq   text[] := ARRAY['DEMITIDO','DEMITIDA','RESCISÃO','DESLIGADO','DESLIGADA'];
BEGIN
  IF NOT public.can_access(auth.uid(), 'operacional_diarias', 'visualizar') THEN
    RETURN;  -- sem a tela liberada → sem resultados
  END IF;
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  v_tokens := ARRAY(
    SELECT regexp_replace(lower(unaccent_safe(w)), '[^a-z0-9]+', '', 'g')
      FROM regexp_split_to_table(v_q, '\s+') AS w
  );

  RETURN QUERY
  SELECT e."ID", e."Nome", e."CPF", e."Título do Cargo", e."Situação"
    FROM public."EMPREGADOS" e
   WHERE upper(coalesce(e."Situação", '')) <> ALL (v_bloq)
     AND coalesce(e."Nome", '') NOT ILIKE '%teste%'
     AND (
       ( EXISTS (SELECT 1 FROM unnest(v_tokens) t WHERE t <> '')
         AND NOT EXISTS (
           SELECT 1 FROM unnest(v_tokens) t
            WHERE t <> ''
              AND regexp_replace(lower(unaccent_safe(coalesce(e."Nome", ''))), '[^a-z0-9]+', '', 'g')
                  NOT LIKE '%' || t || '%'
         )
       )
       OR ( length(v_digits) >= 3
            AND regexp_replace(coalesce(e."CPF", ''), '\D', '', 'g') LIKE '%' || v_digits || '%' )
     )
   ORDER BY e."Nome"
   LIMIT 30;
END $$;
REVOKE ALL ON FUNCTION public.diaria_buscar_empregados(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_buscar_empregados(text) TO authenticated;

-- 6.2) Contratos e postos do dropdown, numa RPC só.
--
-- Existe porque a RLS de `contratos` recorta por user_empresa e a de
-- sup_posto por empresa/aprovação: sem isto a tela teria que adivinhar as
-- duas regras no cliente, e um contrato sem posto aprovado sumiria em vez de
-- aparecer com a lista vazia (que é a informação útil — falta cadastrar posto).
CREATE OR REPLACE FUNCTION public.diaria_contratos()
RETURNS TABLE (
  contrato_id uuid,
  nome        text,
  cliente     text,
  empresa     text,
  status      text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.nome, c.cliente,
         COALESCE(e.nome_fantasia, e.razao_social), c.status
    FROM public.contratos c
    LEFT JOIN public.empresas e ON e.id = c.empresa_id
   WHERE public.can_access(auth.uid(), 'operacional_diarias', 'visualizar')
     AND c.status = 'ativo'
   ORDER BY c.nome;
$$;
REVOKE ALL ON FUNCTION public.diaria_contratos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_contratos() TO authenticated;

CREATE OR REPLACE FUNCTION public.diaria_postos(p_contrato_id uuid)
RETURNS TABLE (
  posto_id uuid,
  nome     text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.nome
    FROM public.sup_posto p
   WHERE public.can_access(auth.uid(), 'operacional_diarias', 'visualizar')
     AND p.contrato_id = p_contrato_id
     AND p.ativo = true
     AND p.aprovado = true
   ORDER BY p.nome;
$$;
REVOKE ALL ON FUNCTION public.diaria_postos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_postos(uuid) TO authenticated;

-- 6.3) Criação da solicitação inteira numa transação só.
--
-- Cabeçalho, diárias e anexos entram juntos ou não entram. Sem isto, a
-- duplicidade barrada pela trigger na 3ª diária deixaria no banco uma
-- solicitação com duas linhas e nenhum anexo — e o cliente não tem DELETE em
-- DIARIA_SOLICITACAO para desfazer (de propósito: solicitação não some, é
-- reprovada).
--
-- O ID vem DO CLIENTE (p_dados->>'id'): os arquivos são enviados para
-- diarias/<id>/... ANTES desta chamada, porque o caminho no bucket precisa do
-- id e o upload é o passo que mais falha. Se esta RPC recusar, o hook tenta
-- remover os objetos que acabou de enviar; a validação de caminho abaixo
-- impede associar à solicitação arquivo de outra pasta.
--
-- Formato de p_dados:
--   { id, contrato_id, posto_id, posto_nome, faltante_*, diarista_*, pix,
--     observacoes,
--     diarias: [{ data, turno, qt_vt, valor_unit_vt_centavos,
--                 valor_diaria_centavos }],
--     anexos:  [{ categoria, storage_path, nome_arquivo, mime_type,
--                 tamanho_bytes }] }
CREATE OR REPLACE FUNCTION public.diaria_criar_solicitacao(p_dados jsonb)
RETURNS TABLE (id uuid, numero text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id      uuid := COALESCE((p_dados->>'id')::uuid, gen_random_uuid());
  v_numero  text;
  v_nome    text;
  v_empresa_nome text;
  v_contrato public.contratos%ROWTYPE;
  v_posto    public.sup_posto%ROWTYPE;
  v_faltante_id bigint := NULLIF(p_dados->>'faltante_empregado_id', '')::bigint;
  v_diarista_id bigint := NULLIF(p_dados->>'diarista_empregado_id', '')::bigint;
  v_faltante_nome text := btrim(coalesce(p_dados->>'faltante_nome', ''));
  v_faltante_cpf  text := btrim(coalesce(p_dados->>'faltante_cpf', ''));
  v_diarista_nome text := btrim(coalesce(p_dados->>'diarista_nome', ''));
  v_diarista_cpf  text := btrim(coalesce(p_dados->>'diarista_cpf', ''));
  n_ponto   int;
  n_doc     int;
BEGIN
  IF NOT public.can_access(auth.uid(), 'operacional_diarias', 'incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para lançar diárias.';
  END IF;

  IF jsonb_array_length(COALESCE(p_dados->'diarias', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma diária.';
  END IF;

  SELECT * INTO v_contrato
    FROM public.contratos c
   WHERE c.id = (p_dados->>'contrato_id')::uuid
     AND c.status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ativo não encontrado.';
  END IF;
  SELECT COALESCE(e.nome_fantasia, e.razao_social) INTO v_empresa_nome
    FROM public.empresas e WHERE e.id = v_contrato.empresa_id;

  SELECT * INTO v_posto
    FROM public.sup_posto p
   WHERE p.id = NULLIF(p_dados->>'posto_id', '')::uuid
     AND p.contrato_id = v_contrato.id
     AND p.ativo = true
     AND p.aprovado = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posto ativo e aprovado não encontrado neste contrato.';
  END IF;

  -- Quando a pessoa veio do dropdown, nome e CPF saem de EMPREGADOS no
  -- servidor. O cliente não consegue trocar o CPF mantendo o mesmo id.
  IF v_faltante_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_faltante_nome, v_faltante_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_faltante_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Faltante não encontrado em EMPREGADOS.'; END IF;
  END IF;
  IF v_diarista_id IS NOT NULL THEN
    SELECT e."Nome", e."CPF" INTO v_diarista_nome, v_diarista_cpf
      FROM public."EMPREGADOS" e WHERE e."ID" = v_diarista_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Diarista não encontrado em EMPREGADOS.'; END IF;
  END IF;

  IF v_faltante_nome = '' OR length(regexp_replace(v_faltante_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do faltante.';
  END IF;
  IF v_diarista_nome = '' OR length(regexp_replace(v_diarista_cpf, '\D', '', 'g')) <> 11 THEN
    RAISE EXCEPTION 'Informe nome e CPF válido do diarista.';
  END IF;
  IF regexp_replace(v_faltante_cpf, '\D', '', 'g') = regexp_replace(v_diarista_cpf, '\D', '', 'g') THEN
    RAISE EXCEPTION 'Faltante e diarista precisam ser pessoas diferentes.';
  END IF;
  IF btrim(coalesce(p_dados->>'pix', '')) = '' THEN
    RAISE EXCEPTION 'Informe a chave Pix do diarista.';
  END IF;

  -- Os dois anexos são obrigatórios na tela; aqui é onde a regra vale mesmo.
  SELECT count(*) FILTER (WHERE a->>'categoria' = 'comprovante_ponto'),
         count(*) FILTER (WHERE a->>'categoria' = 'documento')
    INTO n_ponto, n_doc
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a;
  IF n_ponto = 0 OR n_doc = 0 THEN
    RAISE EXCEPTION 'Anexe o comprovante do ponto e ao menos um documento.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a
     WHERE coalesce(a->>'categoria', '') NOT IN ('comprovante_ponto', 'documento')
        OR coalesce(a->>'storage_path', '') NOT LIKE
             v_id::text || '/' || (a->>'categoria') || '/%'
        OR coalesce(a->>'nome_arquivo', '') = ''
        OR NOT CASE
             WHEN coalesce(a->>'tamanho_bytes', '') ~ '^[0-9]+$'
             THEN (a->>'tamanho_bytes')::bigint BETWEEN 1 AND 10485760
             ELSE false
           END
  ) THEN
    RAISE EXCEPTION 'Metadados de anexo inválidos.';
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."DIARIA_SOLICITACAO" (
    id, contrato_id, contrato_nome, contrato_cliente, contrato_empresa, posto_id, posto_nome,
    faltante_empregado_id, faltante_nome, faltante_cpf,
    diarista_empregado_id, diarista_nome, diarista_cpf, pix,
    observacoes, solicitante_id, solicitante_nome
  ) VALUES (
    v_id,
    v_contrato.id, v_contrato.nome, v_contrato.cliente, v_empresa_nome,
    v_posto.id, v_posto.nome,
    v_faltante_id, v_faltante_nome, v_faltante_cpf,
    v_diarista_id, v_diarista_nome, v_diarista_cpf,
    btrim(p_dados->>'pix'),
    NULLIF(p_dados->>'observacoes', ''),
    auth.uid(), v_nome
  )
  RETURNING "DIARIA_SOLICITACAO".numero INTO v_numero;

  INSERT INTO public."DIARIA_LINHA" (
    solicitacao_id, data, turno, qt_vt, valor_unit_vt_centavos, valor_diaria_centavos
  )
  SELECT v_id, (d->>'data')::date, d->>'turno',
         COALESCE((d->>'qt_vt')::int, 0),
         COALESCE((d->>'valor_unit_vt_centavos')::bigint, 0),
         COALESCE((d->>'valor_diaria_centavos')::bigint, 0)
    FROM jsonb_array_elements(p_dados->'diarias') d;

  INSERT INTO public."DIARIA_ANEXO" (
    solicitacao_id, categoria, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'categoria', a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(p_dados->'anexos') a;

  RETURN QUERY SELECT v_id, v_numero;
END $$;
REVOKE ALL ON FUNCTION public.diaria_criar_solicitacao(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_criar_solicitacao(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP FUNCTION IF EXISTS public.diaria_criar_solicitacao(jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_postos(uuid);
-- DROP FUNCTION IF EXISTS public.diaria_contratos();
-- DROP FUNCTION IF EXISTS public.diaria_buscar_empregados(text);
-- DROP POLICY IF EXISTS "diaria anexo delete" ON storage.objects;
-- DROP POLICY IF EXISTS "diaria anexo insert" ON storage.objects;
-- DROP POLICY IF EXISTS "diaria anexo select" ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'diarias';
-- DROP TABLE IF EXISTS public."DIARIA_EVENTO", public."DIARIA_ANEXO",
--   public."DIARIA_LINHA", public."DIARIA_SOLICITACAO" CASCADE;
-- DROP FUNCTION IF EXISTS public.diaria_evento_auto(), public.diaria_guard(),
--   public.diaria_recalcula_total(), public.diaria_recalculando(),
--   public.diaria_linha_valida(), public.diaria_turnos_conflitam(text, text),
--   public.diaria_ao_criar(), public.diaria_touch();
-- DROP SEQUENCE IF EXISTS public.diaria_solicitacao_seq;
-- DELETE FROM public.perfil_acesso_permissao
--   WHERE menu_codigo = 'operacional_diarias' AND acao <> 'visualizar';
