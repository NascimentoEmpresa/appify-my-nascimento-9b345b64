-- =========================================================================
-- CONFERÊNCIA DE DÉCIMO TERCEIRO (13º) — clone adaptado da Conferência de
-- Ponto (20260925000010 e seguintes), 12/11/2026
--
-- PEDIDO (Pablo): "replica o sistema de conferência de ponto, mas tira a
-- parte do operacional e encarregados, vai ser apenas do RH e depois
-- Financeiro. O décimo não depende do operacional."
--
-- DECISÕES (perguntadas ao Pablo antes de criar a tabela):
--   · Uma linha por CONTRATO (Empresa+Filial de CONTRATOS), igual ao ponto.
--   · 1ª e 2ª parcela SEPARADAS: cada contrato passa duas vezes pelo fluxo
--     no ano, cada parcela com valor e pagamento próprios.
--   · O valor o RH digita OU importa da planilha da Senior (a tela soma a
--     planilha por contrato e manda pronta para decimo_importar_valores).
--
-- FLUXO — só RH e Financeiro. Nada de encarregado, Operacional, OK do
-- encarregado, recorte por posto nem ponto_aprovar_contrato:
--
--   Pendente RH → Em Conferência RH → Conferido RH
--        → Liberado Financeiro → Pago
--        ↘ Devolvido RH (Financeiro devolve, com motivo)
--        ↘ Problema (Financeiro marca, com motivo; continua com ele)
--
-- DIFERENÇA DE DESENHO EM RELAÇÃO AO PONTO, de propósito:
--   No ponto a tabela é aberta para authenticated (USING true) e a regra do
--   fluxo vive só na tela. Aqui a tabela é SÓ LEITURA para quem tem uma das
--   telas, e toda escrita passa por RPC SECURITY DEFINER que confere a chave
--   e a transição no banco. É dinheiro saindo: um PATCH direto no PostgREST
--   não pode pular a conferência.
--
-- ACESSO (por usuário, Administração › Acesso por Usuário; nasce sem ninguém):
--   rh_conferencia_decimo          tela  /app/rh/conferencia-decimo-terceiro
--   financeiro_conferencia_decimo  tela  /app/financeiro/conferencia-decimo-terceiro
--   decimo_confirmar_conferencia   fantasma (RH)  conferir / confirmar / reabrir
--   decimo_informar_valor          fantasma (RH)  digitar/importar valor e liberar
--   decimo_marcar_pago             fantasma (Financeiro) pagar / devolver / problema
--
-- Idempotente. ROLLBACK no fim.
-- =========================================================================

-- ── 1) O andamento do contrato na parcela ────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_CONFERENCIA_DECIMO" (
  id                 BIGSERIAL PRIMARY KEY,
  contrato_empresa   BIGINT NOT NULL,
  contrato_filial    BIGINT NOT NULL,
  -- Desnormalizado como no ponto: o histórico não muda de nome depois.
  contrato_nome      TEXT,

  ano                INTEGER  NOT NULL,
  parcela            SMALLINT NOT NULL,          -- 1 = 1ª parcela, 2 = 2ª parcela

  status             TEXT NOT NULL DEFAULT 'Pendente RH',

  valor              NUMERIC(14,2),
  qtd_colaboradores  INTEGER,
  valor_origem       TEXT,                       -- 'manual' | 'planilha'
  planilha_nome      TEXT,                       -- arquivo da última importação

  devolucao_motivo   TEXT,

  conferindo_por     TEXT,  conferindo_em  TIMESTAMPTZ,
  confirmado_por     TEXT,  confirmado_em  TIMESTAMPTZ,
  valor_por          TEXT,  valor_em       TIMESTAMPTZ,
  liberado_por       TEXT,  liberado_em    TIMESTAMPTZ,
  pago_por           TEXT,  pago_em        TIMESTAMPTZ,

  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por     TEXT,

  CONSTRAINT scd_ano_valido     CHECK (ano BETWEEN 2000 AND 2100),
  CONSTRAINT scd_parcela_valida CHECK (parcela IN (1, 2)),
  CONSTRAINT scd_valor_positivo CHECK (valor IS NULL OR valor >= 0),
  CONSTRAINT scd_origem_valida  CHECK (valor_origem IS NULL OR valor_origem IN ('manual', 'planilha')),
  CONSTRAINT scd_status_conhecido CHECK (status IN (
    'Pendente RH', 'Em Conferência RH', 'Conferido RH',
    'Liberado Financeiro', 'Pago', 'Devolvido RH', 'Problema'
  )),
  CONSTRAINT scd_contrato_parcela_unico UNIQUE (contrato_empresa, contrato_filial, ano, parcela)
);

CREATE INDEX IF NOT EXISTS scd_ano_parcela_idx ON public."SISTEMA_CONFERENCIA_DECIMO"(ano, parcela);
CREATE INDEX IF NOT EXISTS scd_status_idx      ON public."SISTEMA_CONFERENCIA_DECIMO"(status);

DROP TRIGGER IF EXISTS trg_scd_atualizado ON public."SISTEMA_CONFERENCIA_DECIMO";
CREATE TRIGGER trg_scd_atualizado BEFORE UPDATE ON public."SISTEMA_CONFERENCIA_DECIMO"
  FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

-- ── 2) A trilha (append-only, só a RPC escreve) ──────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS" (
  id              BIGSERIAL PRIMARY KEY,
  conferencia_id  BIGINT NOT NULL REFERENCES public."SISTEMA_CONFERENCIA_DECIMO"(id) ON DELETE CASCADE,
  acao            TEXT NOT NULL,
  de_status       TEXT,
  para_status     TEXT,
  observacao      TEXT,
  usuario_id      UUID,
  usuario_nome    TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scde_conf_idx ON public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS"(conferencia_id, criado_em DESC);

-- ── 3) RLS: leitura para quem tem uma das duas telas; escrita só por RPC ──
ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."SISTEMA_CONFERENCIA_DECIMO"         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS" FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public."SISTEMA_CONFERENCIA_DECIMO"         TO authenticated;
GRANT SELECT ON public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS" TO authenticated;

DROP POLICY IF EXISTS scd_leitura ON public."SISTEMA_CONFERENCIA_DECIMO";
CREATE POLICY scd_leitura ON public."SISTEMA_CONFERENCIA_DECIMO" FOR SELECT TO authenticated
  USING (
    (SELECT public.can_access(auth.uid(), 'rh_conferencia_decimo', 'visualizar'::app_acao))
    OR (SELECT public.can_access(auth.uid(), 'financeiro_conferencia_decimo', 'visualizar'::app_acao))
  );

DROP POLICY IF EXISTS scde_leitura ON public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS";
CREATE POLICY scde_leitura ON public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS" FOR SELECT TO authenticated
  USING (
    (SELECT public.can_access(auth.uid(), 'rh_conferencia_decimo', 'visualizar'::app_acao))
    OR (SELECT public.can_access(auth.uid(), 'financeiro_conferencia_decimo', 'visualizar'::app_acao))
  );

-- CONTRATOS: a lista do 13º sai do cadastro. Policy À PARTE (permissivas se
-- somam por OR) em vez de reescrever contratos_gate — assim esta migration não
-- carrega uma cópia da lista de telas que outra migration pode mudar depois.
DROP POLICY IF EXISTS contratos_decimo_gate ON public."CONTRATOS";
CREATE POLICY contratos_decimo_gate ON public."CONTRATOS" FOR SELECT TO authenticated
  USING (
    (SELECT public.can_access(auth.uid(), 'rh_conferencia_decimo', 'visualizar'::app_acao))
    OR (SELECT public.can_access(auth.uid(), 'financeiro_conferencia_decimo', 'visualizar'::app_acao))
  );

-- ── 4) A regra do fluxo, no banco ────────────────────────────────────────
-- Espelho de src/lib/conferenciaDecimo/conferencia.ts (ORIGENS/DESTINO/
-- MENU_DA_ACAO). Mudou lá, muda aqui — os testes de lá descrevem os dois.

-- A chave de ação vale com visualizar OU alterar, igual ao `pode()` da tela
-- do ponto (o resíduo legado de ~20/08 gravou só visualizar).
CREATE OR REPLACE FUNCTION public.decimo_tem_chave(_menu text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.can_access(auth.uid(), _menu, 'visualizar'::app_acao)
      OR public.can_access(auth.uid(), _menu, 'alterar'::app_acao);
$$;

CREATE OR REPLACE FUNCTION public.decimo_agir(
  p_empresa          bigint,
  p_filial           bigint,
  p_ano              integer,
  p_parcela          integer,
  p_acao             text,
  p_valor            numeric DEFAULT NULL,
  p_observacao       text    DEFAULT NULL,
  p_status_esperado  text    DEFAULT NULL
)
RETURNS public."SISTEMA_CONFERENCIA_DECIMO"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nome    text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  v_linha   public."SISTEMA_CONFERENCIA_DECIMO";
  v_menu    text;
  v_origens text[];
  v_destino text;
  v_de      text;
  v_obs     text := nullif(btrim(coalesce(p_observacao, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501'; END IF;
  IF p_parcela NOT IN (1, 2) THEN RAISE EXCEPTION 'Parcela inválida: %', p_parcela; END IF;

  CASE p_acao
    WHEN 'andamento'      THEN v_menu := 'decimo_confirmar_conferencia'; v_origens := ARRAY['Pendente RH','Devolvido RH'];                                   v_destino := 'Em Conferência RH';
    WHEN 'confirmar'      THEN v_menu := 'decimo_confirmar_conferencia'; v_origens := ARRAY['Pendente RH','Em Conferência RH','Devolvido RH'];              v_destino := 'Conferido RH';
    WHEN 'reabrir'        THEN v_menu := 'decimo_confirmar_conferencia'; v_origens := ARRAY['Conferido RH'];                                                v_destino := 'Em Conferência RH';
    WHEN 'informar_valor' THEN v_menu := 'decimo_informar_valor';        v_origens := ARRAY['Pendente RH','Em Conferência RH','Conferido RH','Devolvido RH']; v_destino := NULL; -- não mexe no status
    WHEN 'liberar'        THEN v_menu := 'decimo_informar_valor';        v_origens := ARRAY['Conferido RH'];                                                v_destino := 'Liberado Financeiro';
    WHEN 'marcar_pago'    THEN v_menu := 'decimo_marcar_pago';           v_origens := ARRAY['Liberado Financeiro','Problema'];                              v_destino := 'Pago';
    WHEN 'devolver_rh'    THEN v_menu := 'decimo_marcar_pago';           v_origens := ARRAY['Liberado Financeiro','Problema'];                              v_destino := 'Devolvido RH';
    WHEN 'problema'       THEN v_menu := 'decimo_marcar_pago';           v_origens := ARRAY['Liberado Financeiro'];                                         v_destino := 'Problema';
    ELSE RAISE EXCEPTION 'Ação desconhecida: %', p_acao;
  END CASE;

  IF NOT public.decimo_tem_chave(v_menu) THEN
    RAISE EXCEPTION 'Você não tem a permissão para esta ação (%).', v_menu USING ERRCODE = '42501';
  END IF;

  IF p_acao IN ('devolver_rh', 'problema') AND length(coalesce(v_obs, '')) < 10 THEN
    RAISE EXCEPTION 'Escreva o motivo (mín. 10 caracteres).';
  END IF;
  IF p_valor IS NOT NULL AND p_valor <= 0 THEN
    RAISE EXCEPTION 'Informe um valor maior que zero.';
  END IF;
  IF p_acao = 'informar_valor' AND p_valor IS NULL THEN
    RAISE EXCEPTION 'Informe o valor.';
  END IF;

  -- A linha nasce na primeira ação (como no ponto): contrato sem linha na
  -- parcela é "Pendente RH" na tela. Só contrato do cadastro.
  INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO" (contrato_empresa, contrato_filial, contrato_nome, ano, parcela, atualizado_por)
  SELECT c."Empresa", c."Filial", c."NOME CONTRATO", p_ano, p_parcela, v_nome
    FROM public."CONTRATOS" c
   WHERE c."Empresa" = p_empresa AND c."Filial" = p_filial
   LIMIT 1
  ON CONFLICT (contrato_empresa, contrato_filial, ano, parcela) DO NOTHING;

  SELECT * INTO v_linha FROM public."SISTEMA_CONFERENCIA_DECIMO"
   WHERE contrato_empresa = p_empresa AND contrato_filial = p_filial AND ano = p_ano AND parcela = p_parcela
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato %/% não está no cadastro de contratos.', p_empresa, p_filial; END IF;

  v_de := v_linha.status;
  -- Trava de concorrência: alguém decidiu enquanto a tela estava aberta.
  IF p_status_esperado IS NOT NULL AND p_status_esperado <> v_de THEN
    RAISE EXCEPTION 'Alguém mexeu neste contrato enquanto você olhava (agora: %). Recarregue.', v_de USING ERRCODE = '40001';
  END IF;
  IF NOT (v_de = ANY (v_origens)) THEN
    RAISE EXCEPTION 'Esta ação não vale no estado atual do contrato (%).', v_de;
  END IF;

  IF p_valor IS NOT NULL THEN
    v_linha.valor := p_valor; v_linha.valor_origem := 'manual';
    v_linha.valor_por := v_nome; v_linha.valor_em := now();
  END IF;
  IF p_acao = 'liberar' AND coalesce(v_linha.valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe o valor do 13º antes de liberar ao Financeiro.';
  END IF;

  CASE p_acao
    WHEN 'andamento'   THEN v_linha.conferindo_por := v_nome; v_linha.conferindo_em := now();
    WHEN 'reabrir'     THEN v_linha.confirmado_por := NULL;   v_linha.confirmado_em := NULL;
    WHEN 'confirmar'   THEN v_linha.confirmado_por := v_nome; v_linha.confirmado_em := now();
    WHEN 'liberar'     THEN v_linha.liberado_por   := v_nome; v_linha.liberado_em   := now();
    WHEN 'marcar_pago' THEN v_linha.pago_por       := v_nome; v_linha.pago_em       := now();
    WHEN 'devolver_rh' THEN v_linha.devolucao_motivo := v_obs;
                            v_linha.confirmado_por := NULL; v_linha.confirmado_em := NULL;
                            v_linha.liberado_por   := NULL; v_linha.liberado_em   := NULL;
    WHEN 'problema'    THEN v_linha.devolucao_motivo := v_obs;
    ELSE NULL;
  END CASE;

  UPDATE public."SISTEMA_CONFERENCIA_DECIMO" SET
    status           = coalesce(v_destino, status),
    valor            = v_linha.valor,
    valor_origem     = v_linha.valor_origem,
    valor_por        = v_linha.valor_por,        valor_em      = v_linha.valor_em,
    devolucao_motivo = v_linha.devolucao_motivo,
    conferindo_por   = v_linha.conferindo_por,   conferindo_em = v_linha.conferindo_em,
    confirmado_por   = v_linha.confirmado_por,   confirmado_em = v_linha.confirmado_em,
    liberado_por     = v_linha.liberado_por,     liberado_em   = v_linha.liberado_em,
    pago_por         = v_linha.pago_por,         pago_em       = v_linha.pago_em,
    atualizado_por   = v_nome
   WHERE id = v_linha.id
  RETURNING * INTO v_linha;

  INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS"
    (conferencia_id, acao, de_status, para_status, observacao, usuario_id, usuario_nome)
  VALUES (v_linha.id, p_acao, v_de, v_linha.status,
          coalesce(v_obs, CASE WHEN p_valor IS NOT NULL THEN 'Valor: ' || to_char(p_valor, 'FM999G999G990D00') END),
          auth.uid(), v_nome);

  RETURN v_linha;
END $$;

-- Importação da planilha da Senior. A tela lê o arquivo, soma por contrato e
-- manda [{empresa, filial, valor, qtd}]. Grava só o que ainda está com o RH:
-- contrato já liberado/pago/com problema volta em `travados` — reimportar não
-- pode mudar o valor que o Financeiro já está pagando.
CREATE OR REPLACE FUNCTION public.decimo_importar_valores(
  p_ano      integer,
  p_parcela  integer,
  p_linhas   jsonb,
  p_arquivo  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nome      text := (SELECT coalesce(display_name, email) FROM public.profiles WHERE id = auth.uid());
  r           record;
  v_linha     public."SISTEMA_CONFERENCIA_DECIMO";
  v_gravados  int := 0;
  v_travados  jsonb := '[]'::jsonb;
  v_fora      jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão expirada.' USING ERRCODE = '42501'; END IF;
  IF NOT public.decimo_tem_chave('decimo_informar_valor') THEN
    RAISE EXCEPTION 'Você não tem a permissão para esta ação (decimo_informar_valor).' USING ERRCODE = '42501';
  END IF;
  IF p_parcela NOT IN (1, 2) THEN RAISE EXCEPTION 'Parcela inválida: %', p_parcela; END IF;
  IF jsonb_typeof(p_linhas) <> 'array' THEN RAISE EXCEPTION 'p_linhas tem que ser uma lista.'; END IF;

  FOR r IN
    SELECT (e->>'empresa')::bigint AS empresa, (e->>'filial')::bigint AS filial,
           (e->>'valor')::numeric AS valor, nullif(e->>'qtd', '')::int AS qtd
      FROM jsonb_array_elements(p_linhas) e
  LOOP
    IF r.valor IS NULL OR r.valor <= 0 THEN CONTINUE; END IF;

    INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO" (contrato_empresa, contrato_filial, contrato_nome, ano, parcela, atualizado_por)
    SELECT c."Empresa", c."Filial", c."NOME CONTRATO", p_ano, p_parcela, v_nome
      FROM public."CONTRATOS" c WHERE c."Empresa" = r.empresa AND c."Filial" = r.filial LIMIT 1
    ON CONFLICT (contrato_empresa, contrato_filial, ano, parcela) DO NOTHING;

    SELECT * INTO v_linha FROM public."SISTEMA_CONFERENCIA_DECIMO"
     WHERE contrato_empresa = r.empresa AND contrato_filial = r.filial AND ano = p_ano AND parcela = p_parcela
     FOR UPDATE;
    IF NOT FOUND THEN
      v_fora := v_fora || jsonb_build_object('empresa', r.empresa, 'filial', r.filial);
      CONTINUE;
    END IF;
    IF v_linha.status NOT IN ('Pendente RH', 'Em Conferência RH', 'Conferido RH', 'Devolvido RH') THEN
      v_travados := v_travados || jsonb_build_object('empresa', r.empresa, 'filial', r.filial,
                                                     'contrato', v_linha.contrato_nome, 'status', v_linha.status);
      CONTINUE;
    END IF;
    IF v_linha.valor IS NOT DISTINCT FROM round(r.valor, 2) AND v_linha.qtd_colaboradores IS NOT DISTINCT FROM r.qtd THEN
      CONTINUE;  -- nada mudou: nem grava nem enche a trilha
    END IF;

    UPDATE public."SISTEMA_CONFERENCIA_DECIMO" SET
      valor = round(r.valor, 2), qtd_colaboradores = r.qtd,
      valor_origem = 'planilha', planilha_nome = p_arquivo,
      valor_por = v_nome, valor_em = now(), atualizado_por = v_nome
     WHERE id = v_linha.id;

    INSERT INTO public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS"
      (conferencia_id, acao, de_status, para_status, observacao, usuario_id, usuario_nome)
    VALUES (v_linha.id, 'importar_planilha', v_linha.status, v_linha.status,
            'Planilha' || coalesce(' ' || p_arquivo, '') || ': ' || to_char(round(r.valor, 2), 'FM999G999G990D00')
              || coalesce(' (' || r.qtd || ' colaboradores)', ''),
            auth.uid(), v_nome);
    v_gravados := v_gravados + 1;
  END LOOP;

  RETURN jsonb_build_object('gravados', v_gravados, 'travados', v_travados, 'fora_do_cadastro', v_fora);
END $$;

REVOKE ALL ON FUNCTION public.decimo_tem_chave(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decimo_agir(bigint, bigint, integer, integer, text, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decimo_importar_valores(integer, integer, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decimo_agir(bigint, bigint, integer, integer, text, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decimo_importar_valores(integer, integer, jsonb, text) TO authenticated;

-- ── 5) Telas e chaves ────────────────────────────────────────────────────
-- Cada chave no módulo de quem a usa (lição da 20260930000283). Nomes com
-- escape Unicode para não depender da codificação de quem aplica.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota,
       COALESCE((SELECT max(y.ordem) FROM public.app_menu y WHERE y.modulo_id = m.id), 0) + x.ordem,
       true
  FROM (VALUES
    ('rh',         'rh_conferencia_decimo',         U&'Confer\00EAncia de 13\00BA',                       '/app/rh/conferencia-decimo-terceiro',         1),
    ('rh',         'decimo_confirmar_conferencia',  U&'13\00BA \2014 confirmar a confer\00EAncia',        NULL,                                          2),
    ('rh',         'decimo_informar_valor',         U&'13\00BA \2014 informar valor e liberar ao financeiro', NULL,                                      3),
    ('financeiro', 'financeiro_conferencia_decimo', U&'Confer\00EAncia de 13\00BA',                       '/app/financeiro/conferencia-decimo-terceiro', 1),
    ('financeiro', 'decimo_marcar_pago',            U&'13\00BA \2014 marcar como pago',                   NULL,                                          2)
  ) AS x(modulo, codigo, nome, rota, ordem)
  JOIN public.app_modulo m ON m.codigo = x.modulo
 WHERE NOT EXISTS (SELECT 1 FROM public.app_menu z WHERE z.codigo = x.codigo);

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DO MERGE: liberar em Administração › Acesso por Usuário.
--   rh_conferencia_decimo / financeiro_conferencia_decimo → quem participa
--   decimo_confirmar_conferencia, decimo_informar_valor   → RH
--   decimo_marcar_pago                                    → Financeiro
-- =========================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo IN ('rh_conferencia_decimo','financeiro_conferencia_decimo',
--     'decimo_confirmar_conferencia','decimo_informar_valor','decimo_marcar_pago');
--   DROP POLICY IF EXISTS contratos_decimo_gate ON public."CONTRATOS";
--   DROP FUNCTION IF EXISTS public.decimo_importar_valores(integer, integer, jsonb, text);
--   DROP FUNCTION IF EXISTS public.decimo_agir(bigint, bigint, integer, integer, text, numeric, text, text);
--   DROP FUNCTION IF EXISTS public.decimo_tem_chave(text);
--   DROP TABLE IF EXISTS public."SISTEMA_CONFERENCIA_DECIMO_EVENTOS";
--   DROP TABLE IF EXISTS public."SISTEMA_CONFERENCIA_DECIMO";
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
