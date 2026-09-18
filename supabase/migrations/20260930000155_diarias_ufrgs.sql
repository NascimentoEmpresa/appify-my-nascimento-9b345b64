-- =====================================================================
-- DIÁRIAS UFRGS — segundo tipo de diária, rota espelho no Financeiro e os
-- flags de acesso que o pedido de 17/09/2026 descreve.
--
-- O QUE FOI PEDIDO
--
-- 1) O botão de criar diária vira um menu com dois caminhos: "Diárias de
--    diaristas" (o fluxo que já existe, inalterado) e "Diárias UFRGS"
--    (novo), mais um filtro para alternar entre os dois nas listas.
--
-- 2) A diária UFRGS tem os MESMOS CAMPOS da planilha que hoje é preenchida
--    à mão (1789651523607-RETIFICADO__1_.xlsx, aba "DIARIAS 09.2025",
--    cabeçalho na linha 7): Item, Cod. Fornecedor, Matr., Motorista,
--    Sindicato, Lotação, N° Ofício, Saída, Retorno, Destino, Data de
--    Depósito, Posto, Valor Posto C/ Variável, Qt. Hosp., Qt. Café,
--    Qt. Alm., Qt. Janta, Valor Total, Valor VA, Valor Líquido, Tributos,
--    Valor à Faturar, Fiscal.
--    O objetivo declarado: o sistema GERAR aquele Excel, para ninguém mais
--    digitar a planilha por fora — com histórico e rastreabilidade.
--
-- 3) Rota nova /app/financeiro/diarias, espelho das outras duas.
--
-- 4) Flags de acesso em Diárias: incluir/editar, excluir, aprovar e enviar
--    para malote (o valor novo do enum vem na 20260930000154).
--
-- 5) Status único entre as rotas: solicitada, em ajuste, aprovada, paga,
--    reprovada, excluída. "Paga" continua aparecendo depois do pagamento
--    no Malote, em qualquer rota.
--
-- 6) Rodapé com quem abriu a diária (usuário, dia e hora), como a diária de
--    diarista já faz desde a 20260930000153.
--
-- AS FÓRMULAS SÃO DA PLANILHA, não inventadas aqui. Transcrição direta das
-- células (linha 8 como exemplo; tarifas nas linhas 5 e 6):
--
--   Valor Total   R8 = ($N$6*N8)+($O$6*O8)+($P$6*P8)+($Q$6*Q8)
--                    = hospedagem*Qt.Hosp + cafe*Qt.Cafe
--                      + almoco*Qt.Alm + janta*Qt.Janta
--   Valor VA      S8 = 31.69*2   → tarifa de VA x dias de VA. A coluna Y da
--                      planilha é literalmente =S8/31.69, o número de dias
--                      que ninguém guardava em lugar nenhum; aqui ele passa
--                      a ser um campo (qt_va) e o valor é derivado dele.
--   Valor Líquido T8 = R8-S8
--   Tributos      U8 = (T8*0.0674/(1-0.0674))  → gross-up da alíquota.
--                      0.0674 = PIS 0,31% + COFINS 1,43% + ISS 5%, que é o
--                      bloco "RESUMO DOS TRIBUTOS" em P139:R144.
--   Valor à Fat.  V8 = T8+U8
--   Matr.         C8 = XLOOKUP(Motorista, 'Base de Dados'!L:L, K:K)
--                      → EMPREGADOS."Cadastro", que é a matrícula
--   Fiscal        W8 = VLOOKUP(Lotação, 'Base de Dados'!A:B, 2, FALSE)
--
-- QUAL TARIFA VALE: a planilha tem DUAS linhas de tarifa e cada linha de
-- dado aponta para uma. Linha 5 = SINECARGA/RS (66,07 / 13,89 / 26,09 /
-- 26,09; VA 16,52); linha 6 = SINDIRODOSUL/RS (173,77 / 20,75 / 30,77 /
-- 30,77; VA 31,69). Confirmado na linha 69, a única SINECARGA do mês e a
-- única que usa $N$5. Aqui isso vira "DIARIA_UFRGS_TARIFA" COM VIGÊNCIA:
-- dissídio muda os valores (o bloco C140:K143 da planilha mostra a tabela
-- anterior, com outra DATA BASE) e diária de janeiro tem que continuar
-- mostrando a tarifa de janeiro. Recalcular o passado com tarifa nova
-- mudaria um valor já faturado.
--
-- VALOR LÍQUIDO PODE SER NEGATIVO e não é bug: linha 12 da planilha tem
-- 30,77 de almoço menos 31,69 de VA = -0,92. Por isso nenhum CHECK >= 0
-- nas colunas derivadas.
--
-- DINHEIRO EM CENTAVOS (bigint), como na diária de diarista: os valores
-- somam por linha e por relatório e viram despesa no Malote. Total que não
-- fecha centavo vira discussão no financeiro.
--
-- PRÉ-REQUISITO: 20260930000154 ('enviar_malote' no enum app_acao) tem que
-- estar aplicada ANTES desta — o INSERT em app_menu_acao aqui usa o valor.
-- Backend da diária de diarista: 20260930000019 (+33/35/36/65/151/152/153).
-- =====================================================================

-- ── 1) Menu novo: /app/financeiro/diarias ────────────────────────────
--
-- Rota própria com menu próprio, pelo mesmo motivo documentado na
-- 20260930000065 para Encarregados: a sidebar casa permissão por ROTA, e um
-- item do Financeiro apontando para /app/operacional/diarias seria
-- governado por `operacional_diarias` — liberá-lo arrastaria o módulo
-- Operacional inteiro para a sidebar de quem só precisa das diárias.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, 'financeiro_diarias', 'Controle de Diárias', '/app/financeiro/diarias',
       COALESCE((SELECT max(am.ordem) FROM public.app_menu am WHERE am.modulo_id = mo.id), 0) + 10
  FROM public.app_modulo mo
 WHERE mo.codigo = 'financeiro'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = 'financeiro_diarias');

-- can_access() devolve false para menu inativo ANTES de olhar perfil.
UPDATE public.app_menu SET ativo = true WHERE codigo = 'financeiro_diarias';

-- ── 2) Os flags do Gerenciamento de Acesso ───────────────────────────
--
-- A tela de acesso só desenha um switch se existir linha em app_menu_acao
-- (20260910000002 — "fonte da verdade para quais switches a tela deve
-- mostrar"). O pedido lista quatro flags; o mapa para as ações do enum:
--
--   incluir/editar     → incluir  (um flag só, como pedido: quem lança
--                        também corrige. O rótulo composto é do painel,
--                        ver ACAO_LABEL_POR_MENU em ModulosMenusTab.tsx)
--   excluir            → excluir
--   aprovar            → aprovar
--   enviar para malote → enviar_malote   (20260930000154)
--
-- `encarregados_diarias` fica com 'incluir' e nada mais: decidir, excluir e
-- despachar pagamento são do Operacional/Financeiro. Não é confiança no
-- frontend — diaria_decide() nem olha aquele menu.
INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('operacional_diarias',  'incluir'),
  ('operacional_diarias',  'excluir'),
  ('operacional_diarias',  'aprovar'),
  ('operacional_diarias',  'enviar_malote'),
  ('financeiro_diarias',   'incluir'),
  ('financeiro_diarias',   'excluir'),
  ('financeiro_diarias',   'aprovar'),
  ('financeiro_diarias',   'enviar_malote'),
  ('encarregados_diarias', 'incluir')
ON CONFLICT DO NOTHING;

-- O perfil "Financeiro" recebe o pacote de trabalho; as duas decisões ficam
-- em switch individual, como já é em Diárias do Operacional (ver
-- ACOES_FORA_DO_TOGGLE em src/lib/acoesDoToggleAcesso.ts).
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro_diarias', v.acao::public.app_acao, true
  FROM public.perfil_acesso pa
  JOIN (VALUES ('visualizar'), ('incluir'), ('alterar'), ('exportar')) AS v(acao) ON true
 WHERE pa.nome = 'Financeiro' AND pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- O Operacional já tinha visualizar/incluir/alterar/aprovar (20260930000019)
-- e excluir (20260930000153); falta enviar_malote. É ele quem já despachava
-- para o Malote antes de a ação existir — nascer sem ela quebraria em
-- produção um fluxo que está funcionando.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'operacional_diarias', 'enviar_malote'::public.app_acao, true
  FROM public.perfil_acesso pa
 WHERE pa.nome = 'Operacional' AND pa.ativo = true AND pa.concede_tudo = false
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 3) Os três gates ─────────────────────────────────────────────────
--
-- diaria_pode()    leitura e lançamento. Vale para os TRÊS menus, com a
--                  ressalva histórica: encarregados_diarias nunca concede
--                  decisão, tenha o que tiver gravado.
-- diaria_ve_tudo() quem enxerga a base inteira. SEPARADA de propósito: a
--                  policy diaria_solicitacao_select é o que mantém "o
--                  encarregado vê só as dele", e a 20260930000065 é
--                  explícita — ampliar ali abriria CPF, PIX e valores de
--                  todos os contratos. Então ela não pode usar
--                  diaria_pode(), que inclui o menu de Encarregados.
-- diaria_decide()  aprovar, reprovar, excluir e enviar para malote. Só
--                  Operacional e Financeiro.
CREATE OR REPLACE FUNCTION public.diaria_pode(_acao public.app_acao)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT public.can_access(auth.uid(), 'operacional_diarias', _acao)
      OR public.can_access(auth.uid(), 'financeiro_diarias',  _acao)
      OR ( _acao NOT IN ('aprovar'::public.app_acao, 'enviar_malote'::public.app_acao)
           AND public.can_access(auth.uid(), 'encarregados_diarias', _acao) );
$fn$;
REVOKE ALL ON FUNCTION public.diaria_pode(public.app_acao) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_pode(public.app_acao) TO authenticated;

CREATE OR REPLACE FUNCTION public.diaria_ve_tudo()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT public.can_access(auth.uid(), 'operacional_diarias', 'visualizar')
      OR public.can_access(auth.uid(), 'financeiro_diarias',  'visualizar');
$fn$;
REVOKE ALL ON FUNCTION public.diaria_ve_tudo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ve_tudo() TO authenticated;

CREATE OR REPLACE FUNCTION public.diaria_decide(_acao public.app_acao)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT public.can_access(auth.uid(), 'operacional_diarias', _acao)
      OR public.can_access(auth.uid(), 'financeiro_diarias',  _acao);
$fn$;
REVOKE ALL ON FUNCTION public.diaria_decide(public.app_acao) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_decide(public.app_acao) TO authenticated;

-- A leitura da diária de diarista passa a incluir o Financeiro. O primeiro
-- ramo (dono) e a ausência de encarregados_diarias aqui são o que preserva
-- "o encarregado vê só as dele".
DROP POLICY IF EXISTS diaria_solicitacao_select ON public."DIARIA_SOLICITACAO";
CREATE POLICY diaria_solicitacao_select ON public."DIARIA_SOLICITACAO"
  FOR SELECT TO authenticated
  USING (solicitante_id = auth.uid() OR public.diaria_ve_tudo());

-- Update: dono enquanto está solicitada/em ajuste, ou quem decide. Qual dos
-- dois está agindo é diaria_guard() que separa, coluna a coluna.
DROP POLICY IF EXISTS diaria_solicitacao_update ON public."DIARIA_SOLICITACAO";
CREATE POLICY diaria_solicitacao_update ON public."DIARIA_SOLICITACAO"
  FOR UPDATE TO authenticated
  USING (
    (solicitante_id = auth.uid() AND status IN ('solicitada', 'em_ajuste'))
    OR public.diaria_decide('aprovar')
  );

-- ── 4) Diária de diarista: o Financeiro entra nas decisões ───────────
--
-- Corpos idênticos aos de 20260930000153; muda SÓ a linha do gate, de
-- can_access(..., 'operacional_diarias', X) para diaria_decide(X). Sem
-- isto, a rota espelho do Financeiro mostraria os botões de decisão (o
-- React pergunta pelo menu da rota) e o banco recusaria o clique.

-- 4.1) O guard do UPDATE.
CREATE OR REPLACE FUNCTION public.diaria_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- SIS-2026-0287: apagar a despesa no Malote desfaz a aprovação.
  IF public.diaria_desfazendo_aprovacao() THEN
    RETURN NEW;
  END IF;

  -- Devolver para ajuste, reenviar depois de ajustado e excluir logicamente.
  -- Quem liga esta GUC são as RPCs, cada uma com o seu próprio gate e a sua
  -- própria checagem de estado.
  IF public.diaria_em_transicao() THEN
    RETURN NEW;
  END IF;

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

  IF public.diaria_decide('aprovar') THEN
    IF (to_jsonb(NEW) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY[
          'status', 'malote_motivo', 'malote_data_pagamento',
          'malote_despesa_id', 'enviado_malote_em',
          'decidido_por', 'decidido_por_nome', 'decidido_em', 'updated_at'
        ]::text[]) THEN
      RAISE EXCEPTION 'A aprovação não pode alterar os dados da solicitação.';
    END IF;

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
      IF NEW.status = 'aprovada' AND NEW.malote_despesa_id IS NULL THEN
        RAISE EXCEPTION 'A diária só pode ser aprovada pela RPC que cria a despesa do Malote.';
      END IF;
      IF NEW.status = 'reprovada' THEN
        NEW.malote_motivo := NULL;
        NEW.malote_data_pagamento := NULL;
      END IF;
      NEW.decidido_por := auth.uid();
      NEW.decidido_em := now();
      SELECT COALESCE(p.display_name, p.email) INTO NEW.decidido_por_nome
        FROM public.profiles p WHERE p.id = auth.uid();
    ELSIF NEW.malote_motivo IS DISTINCT FROM OLD.malote_motivo
       OR NEW.malote_data_pagamento IS DISTINCT FROM OLD.malote_data_pagamento
       OR NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
       OR NEW.enviado_malote_em IS DISTINCT FROM OLD.enviado_malote_em
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
END $fn$;

-- 4.2) Registrar visualização — a condição repete a policy de SELECT à mão
-- porque a função é SECURITY DEFINER e não passa por RLS.
CREATE OR REPLACE FUNCTION public.diaria_registrar_visualizacao(p_solicitacao_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."DIARIA_SOLICITACAO" s
     WHERE s.id = p_solicitacao_id
       AND (s.solicitante_id = auth.uid() OR public.diaria_ve_tudo())
  ) THEN
    RETURN;  -- silencioso: é telemetria de leitura, não operação do usuário
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."DIARIA_VISUALIZACAO" (solicitacao_id, user_id, user_nome)
  VALUES (p_solicitacao_id, auth.uid(), v_nome)
  ON CONFLICT (solicitacao_id, user_id) DO NOTHING;
END $fn$;

-- 4.3) Devolver para ajuste.
CREATE OR REPLACE FUNCTION public.diaria_solicitar_ajuste(
  p_solicitacao_id uuid,
  p_motivo         text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_s      public."DIARIA_SOLICITACAO"%ROWTYPE;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF NOT public.diaria_decide('aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para devolver esta solicitação para ajuste.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Diga o que precisa ser ajustado — é o que o solicitante vai ler.';
  END IF;

  SELECT * INTO v_s FROM public."DIARIA_SOLICITACAO" WHERE id = p_solicitacao_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação de diária não encontrada.';
  END IF;
  IF v_s.status NOT IN ('solicitada', 'reprovada') THEN
    RAISE EXCEPTION 'Só uma solicitação Solicitada ou Reprovada pode ser devolvida para ajuste (esta está %).', v_s.status;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria.transicao', '1', true);
  UPDATE public."DIARIA_SOLICITACAO"
     SET status                 = 'em_ajuste',
         ajuste_motivo          = v_motivo,
         ajuste_pedido_por      = auth.uid(),
         ajuste_pedido_por_nome = v_nome,
         ajuste_pedido_em       = now(),
         decidido_por           = NULL,
         decidido_por_nome      = NULL,
         decidido_em            = NULL
   WHERE id = p_solicitacao_id;
  PERFORM set_config('diaria.transicao', '0', true);

  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT v_s.solicitante_id,
         'Diária devolvida para ajuste',
         'A solicitação ' || COALESCE(v_s.numero, '') || ' precisa de ajuste: ' || v_motivo,
         'diaria_ajuste',
         '/app/encarregados/diarias?solicitacao=' || p_solicitacao_id::text
   WHERE v_s.solicitante_id IS DISTINCT FROM auth.uid();
END $fn$;

-- ── 5) Catálogos da planilha ─────────────────────────────────────────

-- 5.1) Tarifa por sindicato, com vigência. É o bloco "TABELA DE REFERÊNCIA
-- PARA O PAGAMENTO DE DIÁRIAS CONFORME CONTRATO 034/2022" (C140:K143) e as
-- linhas 5/6 da planilha, que são a versão em vigor.
CREATE TABLE IF NOT EXISTS public."DIARIA_UFRGS_TARIFA" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sindicato            text NOT NULL,
  -- Data BASE da tabela. A tarifa que vale numa diária é a de maior
  -- vigencia_inicio <= data de saída dela.
  vigencia_inicio      date NOT NULL,
  hospedagem_centavos  bigint NOT NULL CHECK (hospedagem_centavos >= 0),
  cafe_centavos        bigint NOT NULL CHECK (cafe_centavos       >= 0),
  almoco_centavos      bigint NOT NULL CHECK (almoco_centavos     >= 0),
  janta_centavos       bigint NOT NULL CHECK (janta_centavos      >= 0),
  va_centavos          bigint NOT NULL CHECK (va_centavos         >= 0),
  -- As três alíquotas do "RESUMO DOS TRIBUTOS". Ficam na tarifa porque a
  -- planilha tem DOIS resumos (ISS 5% em P139:R144 e ISS 3% em P146:R151) e
  -- o que muda entre eles é o município do serviço, que acompanha a
  -- vigência/contrato — não a linha da diária.
  aliquota_pis         numeric(6,4) NOT NULL DEFAULT 0.0031,
  aliquota_cofins      numeric(6,4) NOT NULL DEFAULT 0.0143,
  aliquota_iss         numeric(6,4) NOT NULL DEFAULT 0.0500,
  ativo                boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sindicato, vigencia_inicio)
);

-- Tarifas em vigor na planilha entregue (linhas 5 e 6 da aba).
INSERT INTO public."DIARIA_UFRGS_TARIFA"
  (sindicato, vigencia_inicio, hospedagem_centavos, cafe_centavos, almoco_centavos, janta_centavos, va_centavos)
VALUES
  ('SINDIRODOSUL/RS', DATE '2026-01-01', 17377, 2075, 3077, 3077, 3169),
  ('SINECARGA/RS',    DATE '2026-01-01',  6607, 1389, 2609, 2609, 1652)
ON CONFLICT (sindicato, vigencia_inicio) DO NOTHING;

-- A tabela anterior (bloco C140:K143, "DATA BASE" antiga). Entra para a
-- diária retroativa continuar batendo com o que já foi faturado.
INSERT INTO public."DIARIA_UFRGS_TARIFA"
  (sindicato, vigencia_inicio, hospedagem_centavos, cafe_centavos, almoco_centavos, janta_centavos, va_centavos)
VALUES
  ('SINDIRODOSUL/RS', DATE '2025-01-01', 15943, 1904, 2823, 2823, 2962),
  ('SINECARGA/RS',    DATE '2025-01-01',  6607, 1389, 2609, 2609, 1652)
ON CONFLICT (sindicato, vigencia_inicio) DO NOTHING;

-- 5.2) Lotação → Fiscal. É a VLOOKUP(F, 'Base de Dados'!A:B, 2, FALSE) da
-- coluna Fiscal: o fiscal do contrato é de quem responde pela lotação, não
-- de quem lança a diária. DITRAN não estava na tabela de apoio (o fiscal
-- dela aparece digitado à mão na linha 8) e entra aqui com aquele nome.
CREATE TABLE IF NOT EXISTS public."DIARIA_UFRGS_LOTACAO" (
  lotacao    text PRIMARY KEY,
  fiscal     text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  ordem      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."DIARIA_UFRGS_LOTACAO" (lotacao, fiscal, ordem) VALUES
  ('FROTA',   'MARCIANA DEMARCHI',                 10),
  ('FAVET',   'PAULO RICARDO BRAGA',               20),
  ('EEA',     'RAFAEL DIIONELLO',                  30),
  ('IPH',     'TAYNA MIOLO',                       40),
  ('SUINFRA', 'CARLOS EDUARDO DOS SANTOS',         50),
  ('DITRAN',  'CARLOS AUGUSTO DOS SANTOS CASTILHO', 60)
ON CONFLICT (lotacao) DO NOTHING;

-- 5.3) Posto/Cargo. É o bloco P154:U182 da planilha — o código que vai na
-- coluna "Posto" das linhas, a descrição do posto no contrato e a
-- localidade, que é o que agrupa os totais do relatório (TOTAL - PORTO
-- ALEGRE, TOTAL - ELDORADO DO SUL, TOTAL - IMBÉ, TOTAL - TRAMANDAÍ).
CREATE TABLE IF NOT EXISTS public."DIARIA_UFRGS_POSTO" (
  codigo     text PRIMARY KEY,
  descricao  text NOT NULL,
  localidade text NOT NULL,
  ativo      boolean NOT NULL DEFAULT true,
  ordem      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."DIARIA_UFRGS_POSTO" (codigo, descricao, localidade, ordem) VALUES
  ('B1', 'Motorista categoria B1, 44 horas semanais, 5 dias por semana, 2 horas noturnas mensais,13 horas extras mensais, 2 hospedagens, 3 cafés, 7 almoços e 4 jantares, Porto Alegre RS', 'PORTO ALEGRE', 10),
  ('B3', 'Motorista categoria B3, 44 horas semanais, 5 dias por semana, 1 hora noturna mensal , 1 hora extra mensal, 1 hospedagem, 1 café, 1 almoço e 1 jantar, Porto Alegre RS', 'PORTO ALEGRE', 20),
  ('B4', 'Motorista Categoria B4, 44 horas mensais, 5 dias por semana, 1 hora noturna mensal, 10 horas extras mensais, 1 hospedagem, 2 cafés, 4 almoços e 2 jantares, com insalubridade média (Favet), Porto Alegre RS', 'PORTO ALEGRE', 30),
  ('D6', 'Motorista categoria D6, 44 horas semanais, 5 dias por semana, 2 horas noturnas mensais, 7 horas extras mensais, 1 hospedagem, 2 cafés, 3 almoços, 2 jantares, Porto Alegre RS', 'PORTO ALEGRE', 40),
  ('E4', 'Operador de Retroescavadeira 44 horas semanais, 5 dias por semana, insalubridade máxima, Porto Alegre RS', 'PORTO ALEGRE', 50),
  ('C1', 'Motorista categoria C, 44 horas semanais, 5 dias por semana, 1 hora noturna mensal, 1 hora extra mensal, 1 café, 1 almoço e 1 jantar, Porto Alegre RS', 'PORTO ALEGRE', 60),
  ('F1', 'Supervisor, 44 horas semanais, 5 dias por semana, com duas horas extras mensais, Porto Alegre', 'PORTO ALEGRE', 70),
  ('D1', 'Motorista categoria D, 30 horas semanais, 5 dias por semana, Porto Alegre', 'PORTO ALEGRE', 80),
  ('D4', 'Motorista categoria D4, 44 horas semanais, 5 dias por semana, 3 horas noturnas mensais, 20 horas extras mensais, 1 hospedagem, 1 café, 1 almoço e 1 janta, Porto Alegre RS', 'PORTO ALEGRE', 90),
  ('D2', 'Motorista categoria D2, 30 horas semanais, 5 dias por semana, 1 hora noturna mensal, Porto Alegre RS', 'PORTO ALEGRE', 100),
  ('C2', 'Motorista categoria C, 44 horas semanais, 5 dias por semana, 1 hora  noturna mensal, 1 hora extra mensal, Munck com periculosidade, SUINFRA, Porto Alegre RS', 'PORTO ALEGRE', 110),
  ('D3', 'Motorista categoria D3, 44 horas semanais, 5 dias por semana, 2 horas noturnas mensais, 11 horas extras mensais, 1 hospedagem, 8 cafés, 3 almoços e 2 jantares, com insalubridade média, Eldorado do Sul', 'ELDORADO DO SUL', 120),
  ('C4', 'Motorista categoria C4, 44 horas semanais, 5dias por semana, 1  hora noturna mensal, 3 horas extras mensais, 1 hospedagem, 1 café, 1 almoço, 1 jantar e 1 ceia, Imbé RS', 'IMBÉ', 130),
  ('D5', 'Motorista categoria D5, 44 horas semanais, 5 dias por semana, 3 horas noturnas mensais, 10 horas extras mensais, 1 hospedagem, 3 cafés, 4 almoços e 2 jantares, Imbé RS', 'IMBÉ', 140),
  ('B2', 'Motorista categoria B2, 44 horas semanais, 5 dias por semana, 1 hora noturna mensal, 8 horas extras mensais,1 hospedagem, 2 cafés, 3 almoços e 1 jantar, Tramandaí RS', 'TRAMANDAÍ', 150)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public."DIARIA_UFRGS_TARIFA"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_UFRGS_LOTACAO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_UFRGS_POSTO"   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."DIARIA_UFRGS_TARIFA"  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_UFRGS_LOTACAO" FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_UFRGS_POSTO"   FROM PUBLIC, anon, authenticated;
-- Só leitura pelo cliente: tarifa e tabela de postos são do contrato, não da
-- tela. Mudança de dissídio entra por migration/SQL, com data de vigência.
GRANT SELECT ON public."DIARIA_UFRGS_TARIFA"  TO authenticated;
GRANT SELECT ON public."DIARIA_UFRGS_LOTACAO" TO authenticated;
GRANT SELECT ON public."DIARIA_UFRGS_POSTO"   TO authenticated;

DROP POLICY IF EXISTS diaria_ufrgs_tarifa_select ON public."DIARIA_UFRGS_TARIFA";
CREATE POLICY diaria_ufrgs_tarifa_select ON public."DIARIA_UFRGS_TARIFA"
  FOR SELECT TO authenticated USING (public.diaria_pode('visualizar'));

DROP POLICY IF EXISTS diaria_ufrgs_lotacao_select ON public."DIARIA_UFRGS_LOTACAO";
CREATE POLICY diaria_ufrgs_lotacao_select ON public."DIARIA_UFRGS_LOTACAO"
  FOR SELECT TO authenticated USING (public.diaria_pode('visualizar'));

DROP POLICY IF EXISTS diaria_ufrgs_posto_select ON public."DIARIA_UFRGS_POSTO";
CREATE POLICY diaria_ufrgs_posto_select ON public."DIARIA_UFRGS_POSTO"
  FOR SELECT TO authenticated USING (public.diaria_pode('visualizar'));

-- ── 6) A diária UFRGS ────────────────────────────────────────────────
--
-- UMA LINHA = UMA LINHA DA PLANILHA. Diferente da diária de diarista, que
-- é um cabeçalho com N dias (DIARIA_LINHA): na UFRGS cada viagem é um
-- ofício, com saída, retorno, destino e posto próprios, e é assim que ela
-- aparece no relatório que a UFRGS recebe. Duas tabelas aninhadas aqui só
-- criariam um cabeçalho de um filho.
--
-- "Item" NÃO é coluna: é a posição da linha no relatório exportado, e
-- gravá-lo faria a exclusão de uma diária deixar buraco na numeração de
-- todo mês seguinte. Ele é calculado na exportação, na ordem de criação.
--
-- Nome e matrícula do motorista ficam GRAVADOS junto com o id do empregado,
-- pelo mesmo motivo da diária de diarista: o cadastro muda (casamento,
-- correção, desligamento) e o relatório de janeiro tem que continuar
-- mostrando para quem foi pago em janeiro.
CREATE TABLE IF NOT EXISTS public."DIARIA_UFRGS" (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero                text UNIQUE,            -- DU-2026-000123, por trigger
  status                text NOT NULL DEFAULT 'solicitada'
                          CHECK (status IN ('solicitada','em_ajuste','aprovada','reprovada','excluida')),

  contrato_id           uuid NOT NULL REFERENCES public.contratos(id),
  contrato_nome         text NOT NULL,
  contrato_cliente      text,
  contrato_empresa      text,

  -- Cabeçalho do relatório (ANO/MÊS em V2:W3 e o "Período de ... A ...").
  -- Mantida pela trigger a partir da saída: é o mês de referência, e a aba
  -- da planilha é uma por mês.
  competencia           date NOT NULL,

  -- As colunas da planilha, na ordem dela.
  cod_fornecedor        text,                   -- col. B (vazia no mês entregue)
  matricula             text,                   -- col. C, de EMPREGADOS."Cadastro"
  motorista_empregado_id bigint,
  motorista_nome        text NOT NULL,          -- col. D
  sindicato             text NOT NULL,          -- col. E
  lotacao               text NOT NULL REFERENCES public."DIARIA_UFRGS_LOTACAO"(lotacao),
  numero_oficio         text NOT NULL,          -- col. G
  saida                 date NOT NULL,          -- col. H
  retorno               date NOT NULL,          -- col. I
  destino               text NOT NULL,          -- col. J
  -- col. K. NÃO é digitada: se preenche no dia em que a diária é paga no
  -- malote. Coluna derivada na leitura (diaria_ufrgs_data_deposito), mesmo
  -- desenho de malote_despesa_paga na 20260930000151 — assim o estorno do
  -- pagamento também desfaz o depósito, sem trigger de duas mãos.
  posto                 text REFERENCES public."DIARIA_UFRGS_POSTO"(codigo),  -- col. L
  valor_posto_variavel_centavos bigint NOT NULL DEFAULT 0
                          CHECK (valor_posto_variavel_centavos >= 0),         -- col. M
  qt_hospedagem         integer NOT NULL DEFAULT 0 CHECK (qt_hospedagem >= 0),-- col. N
  qt_cafe               integer NOT NULL DEFAULT 0 CHECK (qt_cafe       >= 0),-- col. O
  qt_almoco             integer NOT NULL DEFAULT 0 CHECK (qt_almoco     >= 0),-- col. P
  qt_janta              integer NOT NULL DEFAULT 0 CHECK (qt_janta      >= 0),-- col. Q
  -- Dias de VA. Na planilha isto nunca foi um campo: a coluna S trazia
  -- "=31.69*2" escrito à mão e a coluna Y recuperava o 2 dividindo de volta.
  qt_va                 integer NOT NULL DEFAULT 0 CHECK (qt_va >= 0),
  fiscal                text,                   -- col. W, de LOTACAO.fiscal

  -- Tarifa CONGELADA no lançamento, além do valor. Sem isto, a diária
  -- reexportada depois de um dissídio mostraria outro Valor Total — e o
  -- relatório precisa reproduzir o que foi faturado.
  tarifa_id             uuid REFERENCES public."DIARIA_UFRGS_TARIFA"(id),
  aliquota_total        numeric(6,4) NOT NULL DEFAULT 0,

  -- Derivadas pela trigger. O cliente nunca escreve nenhuma delas.
  valor_total_centavos   bigint NOT NULL DEFAULT 0,
  valor_va_centavos      bigint NOT NULL DEFAULT 0,
  valor_liquido_centavos bigint NOT NULL DEFAULT 0,  -- pode ser negativo
  tributos_centavos      bigint NOT NULL DEFAULT 0,
  valor_faturar_centavos bigint NOT NULL DEFAULT 0,

  observacoes           text,

  solicitante_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  solicitante_nome      text,

  malote_motivo         text,
  malote_data_pagamento date,
  malote_despesa_id     uuid REFERENCES public.malote_despesa(id),
  enviado_malote_em     timestamptz,

  decidido_por          uuid REFERENCES auth.users(id),
  decidido_por_nome     text,
  decidido_em           timestamptz,

  ajuste_motivo          text,
  ajuste_pedido_por      uuid REFERENCES auth.users(id),
  ajuste_pedido_por_nome text,
  ajuste_pedido_em       timestamptz,

  exclusao_motivo       text,
  excluida_por          uuid REFERENCES auth.users(id),
  excluida_por_nome     text,
  excluida_em           timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT diaria_ufrgs_periodo_valido CHECK (retorno >= saida)
);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_status      ON public."DIARIA_UFRGS"(status);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_competencia ON public."DIARIA_UFRGS"(competencia);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_contrato    ON public."DIARIA_UFRGS"(contrato_id);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_solicitante ON public."DIARIA_UFRGS"(solicitante_id);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_motorista   ON public."DIARIA_UFRGS"(motorista_empregado_id);
-- O aviso de duplicidade procura o mesmo motorista no mesmo ofício/período.
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_oficio      ON public."DIARIA_UFRGS"(numero_oficio);

-- Anexos. Bucket reaproveitado ('diarias', criado na 20260930000019, limite
-- de 10 MB por arquivo): as policies de lá já passam por diaria_pode(), e um
-- bucket novo só duplicaria três policies idênticas. O caminho começa com
-- 'ufrgs/<id>/' para as duas famílias não se misturarem na pasta.
CREATE TABLE IF NOT EXISTS public."DIARIA_UFRGS_ANEXO" (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id      uuid NOT NULL REFERENCES public."DIARIA_UFRGS"(id) ON DELETE CASCADE,
  storage_path   text NOT NULL,
  nome_arquivo   text,
  mime_type      text,
  tamanho_bytes  bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_anexo_diaria ON public."DIARIA_UFRGS_ANEXO"(diaria_id);

CREATE TABLE IF NOT EXISTS public."DIARIA_UFRGS_EVENTO" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diaria_id  uuid NOT NULL REFERENCES public."DIARIA_UFRGS"(id) ON DELETE CASCADE,
  tipo       text NOT NULL,
  descricao  text,
  autor_id   uuid DEFAULT auth.uid(),
  autor_nome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_evento_diaria ON public."DIARIA_UFRGS_EVENTO"(diaria_id);

-- "mostre nos logs os usuários que visualizaram aquela diária, independente
-- da rota" — uma linha por pessoa, com a PRIMEIRA abertura, igual à diária
-- de diarista (20260930000153). Ser por pessoa e não por abertura é o que
-- responde "desde quando o Financeiro sabe desta diária"; regravar a cada F5
-- transformaria o rodapé num relógio.
CREATE TABLE IF NOT EXISTS public."DIARIA_UFRGS_VISUALIZACAO" (
  diaria_id      uuid        NOT NULL REFERENCES public."DIARIA_UFRGS"(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id),
  user_nome      text,
  visualizada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diaria_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_diaria_ufrgs_visualizacao
  ON public."DIARIA_UFRGS_VISUALIZACAO"(diaria_id, visualizada_em DESC);

-- ── 7) Triggers ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.diaria_ufrgs_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $fn$ BEGIN NEW.updated_at = now(); RETURN NEW; END $fn$;

DROP TRIGGER IF EXISTS diaria_ufrgs_touch_trg ON public."DIARIA_UFRGS";
CREATE TRIGGER diaria_ufrgs_touch_trg BEFORE UPDATE ON public."DIARIA_UFRGS"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_ufrgs_touch();

-- 7.1) Número legível, sequencial por ano: DU-2026-000123. Prefixo DU para
-- não se confundir com o SD- da diária de diarista em nenhum relatório.
CREATE SEQUENCE IF NOT EXISTS public.diaria_ufrgs_seq;

-- 7.2) As fórmulas da planilha, em inteiro.
--
-- Roda em BEFORE INSERT OR UPDATE porque o resultado é dado da própria
-- linha, não de uma tabela filha — não há o vaivém de GUC que a diária de
-- diarista precisa para somar DIARIA_LINHA.
--
-- A tarifa é escolhida pela SAÍDA (a data em que a despesa aconteceu), não
-- por now(): lançamento retroativo tem que usar a tabela que valia no dia.
-- Depois de escolhida, fica congelada em tarifa_id/aliquota_total.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_calcular() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  t        public."DIARIA_UFRGS_TARIFA"%ROWTYPE;
  v_f      numeric;
  v_liq    bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.numero IS NULL THEN
      NEW.numero := 'DU-' || to_char(now(), 'YYYY') || '-' ||
                    lpad(nextval('public.diaria_ufrgs_seq')::text, 6, '0');
    END IF;
    IF NEW.solicitante_nome IS NULL THEN
      SELECT COALESCE(p.display_name, p.email) INTO NEW.solicitante_nome
        FROM public.profiles p WHERE p.id = NEW.solicitante_id;
    END IF;
  END IF;

  NEW.competencia := date_trunc('month', NEW.saida)::date;

  -- O fiscal acompanha a lotação (a VLOOKUP da coluna W).
  SELECT l.fiscal INTO NEW.fiscal
    FROM public."DIARIA_UFRGS_LOTACAO" l WHERE l.lotacao = NEW.lotacao;

  SELECT * INTO t
    FROM public."DIARIA_UFRGS_TARIFA" x
   WHERE x.sindicato = NEW.sindicato
     AND x.ativo = true
     AND x.vigencia_inicio <= NEW.saida
   ORDER BY x.vigencia_inicio DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há tarifa de diária cadastrada para % com vigência até %.',
      NEW.sindicato, to_char(NEW.saida, 'DD/MM/YYYY');
  END IF;

  NEW.tarifa_id      := t.id;
  v_f                := t.aliquota_pis + t.aliquota_cofins + t.aliquota_iss;
  NEW.aliquota_total := v_f;

  -- R = ($N*Qt.Hosp)+($O*Qt.Café)+($P*Qt.Alm)+($Q*Qt.Janta)
  NEW.valor_total_centavos := t.hospedagem_centavos * NEW.qt_hospedagem
                            + t.cafe_centavos       * NEW.qt_cafe
                            + t.almoco_centavos     * NEW.qt_almoco
                            + t.janta_centavos      * NEW.qt_janta;
  -- S = tarifa de VA x dias de VA
  NEW.valor_va_centavos := t.va_centavos * NEW.qt_va;
  -- T = R - S  (negativo é resultado legítimo; ver cabeçalho)
  v_liq := NEW.valor_total_centavos - NEW.valor_va_centavos;
  NEW.valor_liquido_centavos := v_liq;
  -- U = T * f / (1 - f), o gross-up. round() em centavos: a planilha carrega
  -- a fração e só arredonda na exibição, e essa diferença de arredondamento
  -- é justamente o que faz um total "não fechar" na conferência.
  NEW.tributos_centavos := round(v_liq * v_f / (1 - v_f));
  -- V = T + U
  NEW.valor_faturar_centavos := NEW.valor_liquido_centavos + NEW.tributos_centavos;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS diaria_ufrgs_calcular_trg ON public."DIARIA_UFRGS";
CREATE TRIGGER diaria_ufrgs_calcular_trg
  BEFORE INSERT OR UPDATE ON public."DIARIA_UFRGS"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_ufrgs_calcular();

-- 7.3) Guard: fora das RPCs, ninguém mexe nesta tabela pelo PostgREST.
--
-- Mais fechado que o da diária de diarista de propósito. Lá o UPDATE direto
-- existia antes das RPCs e ficou por compatibilidade; aqui toda escrita
-- nasceu passando por RPC SECURITY DEFINER, então o guard pode simplesmente
-- recusar o que não vem delas. A GUC é a mesma mecânica já usada em
-- diaria_recalculando()/diaria_em_transicao().
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_em_rpc() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $fn$ SELECT COALESCE(current_setting('diaria_ufrgs.rpc', true), '') = '1' $fn$;

CREATE OR REPLACE FUNCTION public.diaria_ufrgs_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF public.diaria_ufrgs_em_rpc() THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A diária UFRGS só é alterada pelas ações da tela (incluir/editar, aprovar, enviar para malote, solicitar ajuste, excluir).';
END $fn$;

DROP TRIGGER IF EXISTS diaria_ufrgs_guard_trg ON public."DIARIA_UFRGS";
CREATE TRIGGER diaria_ufrgs_guard_trg BEFORE UPDATE ON public."DIARIA_UFRGS"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_ufrgs_guard();

-- 7.4) Trilha automática. É o "controle, histórico e rastreabilidade" que o
-- pedido cita como o motivo de sair da planilha.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_evento_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."DIARIA_UFRGS_EVENTO" (diaria_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, 'criada', 'Diária UFRGS registrada.', NEW.solicitante_id, NEW.solicitante_nome);
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public."DIARIA_UFRGS_EVENTO" (diaria_id, tipo, descricao, autor_id, autor_nome)
    VALUES (
      NEW.id,
      -- Voltar de 'em_ajuste' para 'solicitada' não é "solicitada de novo":
      -- é o reenvio depois da correção, e a trilha precisa distinguir.
      CASE WHEN OLD.status = 'em_ajuste' AND NEW.status = 'solicitada'
           THEN 'reenviada' ELSE NEW.status END,
      CASE
        WHEN NEW.status = 'aprovada' AND NEW.malote_despesa_id IS NOT NULL
          THEN 'Aprovada e enviada para o Malote: ' || COALESCE(NEW.malote_motivo, '(sem motivo)')
        WHEN NEW.status = 'aprovada'      THEN 'Aprovada.'
        WHEN NEW.status = 'em_ajuste'     THEN 'Devolvida para ajuste: ' || COALESCE(NEW.ajuste_motivo, '(sem motivo)')
        WHEN NEW.status = 'excluida'      THEN 'Excluída: ' || COALESCE(NEW.exclusao_motivo, '(sem motivo)')
        WHEN OLD.status = 'em_ajuste' AND NEW.status = 'solicitada'
          THEN 'Ajustada e reenviada pelo solicitante.'
        ELSE NULL
      END,
      auth.uid(),
      COALESCE(
        CASE WHEN NEW.status = 'em_ajuste' THEN NEW.ajuste_pedido_por_nome
             WHEN NEW.status = 'excluida'  THEN NEW.excluida_por_nome
             ELSE NEW.decidido_por_nome END,
        (SELECT COALESCE(p.display_name, p.email) FROM public.profiles p WHERE p.id = auth.uid())
      )
    );
  ELSIF NEW.malote_despesa_id IS DISTINCT FROM OLD.malote_despesa_id
        AND NEW.malote_despesa_id IS NOT NULL THEN
    -- Enviar para o Malote uma diária JÁ aprovada não muda o status, e sem
    -- este ramo o despacho do pagamento não apareceria na trilha.
    INSERT INTO public."DIARIA_UFRGS_EVENTO" (diaria_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, 'enviada_malote',
            'Enviada para o Malote: ' || COALESCE(NEW.malote_motivo, '(sem motivo)'),
            auth.uid(),
            (SELECT COALESCE(p.display_name, p.email) FROM public.profiles p WHERE p.id = auth.uid()));
  ELSIF NEW.updated_at IS DISTINCT FROM OLD.updated_at
        AND OLD.status IN ('solicitada', 'em_ajuste') THEN
    INSERT INTO public."DIARIA_UFRGS_EVENTO" (diaria_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id, 'editada', 'Dados da diária alterados.', auth.uid(),
            (SELECT COALESCE(p.display_name, p.email) FROM public.profiles p WHERE p.id = auth.uid()));
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS diaria_ufrgs_evento_auto_trg ON public."DIARIA_UFRGS";
CREATE TRIGGER diaria_ufrgs_evento_auto_trg
  AFTER INSERT OR UPDATE ON public."DIARIA_UFRGS"
  FOR EACH ROW EXECUTE FUNCTION public.diaria_ufrgs_evento_auto();

-- ── 8) Campos computados na leitura ──────────────────────────────────
--
-- Mesmo desenho de malote_despesa_paga(DIARIA_SOLICITACAO) na
-- 20260930000151, e pelo mesmo motivo: gravar 'paga' na diária exigiria
-- trigger em malote_despesa nas duas mãos, e o estorno do pagamento teria
-- de desfazer. Derivado na leitura, a diária mostra sempre o estado real da
-- despesa. SECURITY DEFINER porque quem enxerga diárias normalmente não tem
-- leitura em malote_despesa — e a função devolve um booleano, nunca dados
-- da despesa.
CREATE OR REPLACE FUNCTION public.malote_despesa_paga(d public."DIARIA_UFRGS")
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT x.status = 'despesa_paga'
       FROM public.malote_despesa x
      WHERE x.id = d.malote_despesa_id),
    false
  )
$fn$;
REVOKE ALL ON FUNCTION public.malote_despesa_paga(public."DIARIA_UFRGS") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.malote_despesa_paga(public."DIARIA_UFRGS") TO authenticated;

-- "Data de Depósito" (coluna K da planilha): o dia em que a diária foi paga
-- no malote. data_pagamento é a data do dinheiro; pago_em é só o instante do
-- clique, e serve de rede quando a despesa antiga não tem a primeira.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_data_deposito(d public."DIARIA_UFRGS")
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT x.data_pagamento
    FROM public.malote_despesa x
   WHERE x.id = d.malote_despesa_id
     AND x.status = 'despesa_paga'
$fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_data_deposito(public."DIARIA_UFRGS") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_data_deposito(public."DIARIA_UFRGS") TO authenticated;

-- ── 9) RLS ───────────────────────────────────────────────────────────
ALTER TABLE public."DIARIA_UFRGS"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_UFRGS_ANEXO"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_UFRGS_EVENTO"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DIARIA_UFRGS_VISUALIZACAO" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public."DIARIA_UFRGS"              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_UFRGS_ANEXO"        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_UFRGS_EVENTO"       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public."DIARIA_UFRGS_VISUALIZACAO" FROM PUBLIC, anon, authenticated;
-- Só leitura pelo PostgREST: toda escrita passa pelas RPCs abaixo, que são
-- onde as validações vivem. Nem UPDATE é concedido — o guard de 7.3 recusaria
-- de todo jeito, e não conceder deixa a intenção explícita no grant.
GRANT SELECT ON public."DIARIA_UFRGS"              TO authenticated;
GRANT SELECT ON public."DIARIA_UFRGS_ANEXO"        TO authenticated;
GRANT SELECT ON public."DIARIA_UFRGS_EVENTO"       TO authenticated;
GRANT SELECT ON public."DIARIA_UFRGS_VISUALIZACAO" TO authenticated;

-- Mesma regra da diária de diarista: quem lançou sempre vê a própria; o
-- resto depende de enxergar a tela (Operacional ou Financeiro). O menu de
-- Encarregados fica fora daqui — é ele que faz "vejo só as minhas".
DROP POLICY IF EXISTS diaria_ufrgs_select ON public."DIARIA_UFRGS";
CREATE POLICY diaria_ufrgs_select ON public."DIARIA_UFRGS"
  FOR SELECT TO authenticated
  USING (solicitante_id = auth.uid() OR public.diaria_ve_tudo());

-- Filhas seguem a mãe: o EXISTS reaplica a policy de SELECT dela.
DROP POLICY IF EXISTS diaria_ufrgs_anexo_select ON public."DIARIA_UFRGS_ANEXO";
CREATE POLICY diaria_ufrgs_anexo_select ON public."DIARIA_UFRGS_ANEXO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."DIARIA_UFRGS" d WHERE d.id = diaria_id));

DROP POLICY IF EXISTS diaria_ufrgs_evento_select ON public."DIARIA_UFRGS_EVENTO";
CREATE POLICY diaria_ufrgs_evento_select ON public."DIARIA_UFRGS_EVENTO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."DIARIA_UFRGS" d WHERE d.id = diaria_id));

DROP POLICY IF EXISTS diaria_ufrgs_visualizacao_select ON public."DIARIA_UFRGS_VISUALIZACAO";
CREATE POLICY diaria_ufrgs_visualizacao_select ON public."DIARIA_UFRGS_VISUALIZACAO"
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public."DIARIA_UFRGS" d WHERE d.id = diaria_id));

-- ── 10) RPCs de apoio ────────────────────────────────────────────────

-- 10.1) Motoristas para o campo "Motorista", já com a MATRÍCULA — que é o
-- que preenche a coluna "Matr." sozinha (a XLOOKUP da planilha).
--
-- RPC própria em vez de mexer em diaria_buscar_empregados(): mudar o
-- RETURNS TABLE daquela exigiria DROP + CREATE e ela é chamada pelo modal da
-- diária de diarista, que está em produção. Mesma mecânica de busca (nome
-- sem acento em qualquer ordem, matrícula pelos dígitos) e mesma decisão da
-- 20260930000152: quem já foi desligado APARECE, porque a diária existe
-- muitas vezes para cobrir justamente o posto que ficou vago — a situação
-- vem em cada sugestão para quem lança decidir.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_buscar_motoristas(p_termo text)
RETURNS TABLE (
  empregado_id bigint,
  nome         text,
  matricula    text,
  cargo        text,
  situacao     text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_q      text := btrim(coalesce(p_termo, ''));
  v_digits text := regexp_replace(v_q, '\D', '', 'g');
  v_tokens text[];
BEGIN
  IF NOT public.diaria_pode('visualizar') THEN
    RETURN;
  END IF;
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  v_tokens := ARRAY(
    SELECT regexp_replace(lower(unaccent_safe(w)), '[^a-z0-9]+', '', 'g')
      FROM regexp_split_to_table(v_q, '\s+') AS w
  );

  RETURN QUERY
  SELECT e."ID",
         e."Nome",
         nullif(btrim(e."Cadastro"::text), ''),
         e."Título do Cargo",
         e."Situação"
    FROM public."EMPREGADOS" e
   WHERE coalesce(e."Nome", '') NOT ILIKE '%teste%'
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
            AND regexp_replace(coalesce(e."Cadastro"::text, ''), '\D', '', 'g') LIKE '%' || v_digits || '%' )
     )
   ORDER BY e."Nome"
   LIMIT 30;
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_buscar_motoristas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_buscar_motoristas(text) TO authenticated;

-- 10.2) Carimbar quem abriu a diária. ON CONFLICT DO NOTHING é o que garante
-- "primeira abertura": a tela chama a cada modal aberto e só a primeira
-- gravação vale.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_registrar_visualizacao(p_diaria_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."DIARIA_UFRGS" d
     WHERE d.id = p_diaria_id
       AND (d.solicitante_id = auth.uid() OR public.diaria_ve_tudo())
  ) THEN
    RETURN;  -- silencioso: telemetria de leitura
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."DIARIA_UFRGS_VISUALIZACAO" (diaria_id, user_id, user_nome)
  VALUES (p_diaria_id, auth.uid(), v_nome)
  ON CONFLICT (diaria_id, user_id) DO NOTHING;
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_registrar_visualizacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_registrar_visualizacao(uuid) TO authenticated;

-- ── 11) Criar e editar ───────────────────────────────────────────────
--
-- Uma função de validação compartilhada pelas duas: o mesmo conjunto de
-- regras precisa valer no lançamento e na correção, e duplicá-las é como
-- nasce a edição que aceita o que a criação recusa.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_validar(p_dados jsonb)
RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF btrim(coalesce(p_dados->>'motorista_nome', '')) = '' THEN
    RAISE EXCEPTION 'Informe o motorista.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."DIARIA_UFRGS_TARIFA" t
     WHERE t.sindicato = p_dados->>'sindicato' AND t.ativo = true
  ) THEN
    RAISE EXCEPTION 'Sindicato inválido: escolha entre os cadastrados na tabela de tarifas.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."DIARIA_UFRGS_LOTACAO" l
     WHERE l.lotacao = p_dados->>'lotacao' AND l.ativo = true
  ) THEN
    RAISE EXCEPTION 'Lotação inválida.';
  END IF;
  IF btrim(coalesce(p_dados->>'numero_oficio', '')) = '' THEN
    RAISE EXCEPTION 'Informe o número do ofício.';
  END IF;
  IF NULLIF(p_dados->>'saida', '') IS NULL OR NULLIF(p_dados->>'retorno', '') IS NULL THEN
    RAISE EXCEPTION 'Informe as datas de saída e retorno.';
  END IF;
  IF (p_dados->>'retorno')::date < (p_dados->>'saida')::date THEN
    RAISE EXCEPTION 'O retorno não pode ser antes da saída.';
  END IF;
  IF btrim(coalesce(p_dados->>'destino', '')) = '' THEN
    RAISE EXCEPTION 'Informe o destino.';
  END IF;
  IF NULLIF(p_dados->>'posto', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public."DIARIA_UFRGS_POSTO" x
        WHERE x.codigo = p_dados->>'posto' AND x.ativo = true
     ) THEN
    RAISE EXCEPTION 'Posto inválido.';
  END IF;
  -- Diária sem nenhuma quantidade é uma linha de zero no relatório: aceitar
  -- isso é aceitar mandar para o Malote uma despesa de R$ 0,00.
  IF COALESCE((p_dados->>'qt_hospedagem')::int, 0)
     + COALESCE((p_dados->>'qt_cafe')::int, 0)
     + COALESCE((p_dados->>'qt_almoco')::int, 0)
     + COALESCE((p_dados->>'qt_janta')::int, 0) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma hospedagem, café, almoço ou janta.';
  END IF;
END $fn$;

-- Metadados de anexo. O limite de 10 MB (10.240 KB) por arquivo é o do
-- bucket 'diarias' (file_size_limit 10485760, 20260930000019) e o mesmo que
-- o modal da diária de diarista anuncia — é o teto de anexo que a web usa
-- por padrão, e o Storage recusaria acima dele de qualquer forma.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_validar_anexos(p_id uuid, p_anexos jsonb)
RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_anexos, '[]'::jsonb)) a
     WHERE coalesce(a->>'storage_path', '') NOT LIKE 'ufrgs/' || p_id::text || '/%'
        OR coalesce(a->>'nome_arquivo', '') = ''
        OR NOT CASE
             WHEN coalesce(a->>'tamanho_bytes', '') ~ '^[0-9]+$'
             THEN (a->>'tamanho_bytes')::bigint BETWEEN 1 AND 10485760
             ELSE false
           END
  ) THEN
    RAISE EXCEPTION 'Metadados de anexo inválidos (limite de 10 MB por arquivo).';
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.diaria_ufrgs_criar(p_dados jsonb)
RETURNS TABLE (id uuid, numero text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id       uuid := COALESCE(NULLIF(p_dados->>'id', '')::uuid, gen_random_uuid());
  v_numero   text;
  v_nome     text;
  v_contrato public.contratos%ROWTYPE;
  v_empresa  text;
  v_mat      text := NULLIF(btrim(coalesce(p_dados->>'matricula', '')), '');
  v_mot_nome text := btrim(coalesce(p_dados->>'motorista_nome', ''));
  v_mot_id   bigint := NULLIF(p_dados->>'motorista_empregado_id', '')::bigint;
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para lançar diárias.';
  END IF;

  SELECT * INTO v_contrato
    FROM public.contratos c
   WHERE c.id = NULLIF(p_dados->>'contrato_id', '')::uuid
     AND c.status = 'ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato ativo não encontrado.';
  END IF;
  SELECT COALESCE(e.nome_fantasia, e.razao_social) INTO v_empresa
    FROM public.empresas e WHERE e.id = v_contrato.empresa_id;

  PERFORM public.diaria_ufrgs_validar(p_dados);
  PERFORM public.diaria_ufrgs_validar_anexos(v_id, p_dados->'anexos');

  -- Quando o motorista veio do dropdown, nome e matrícula saem de EMPREGADOS
  -- no SERVIDOR: o cliente não consegue trocar a matrícula mantendo o id.
  IF v_mot_id IS NOT NULL THEN
    SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '')
      INTO v_mot_nome, v_mat
      FROM public."EMPREGADOS" e WHERE e."ID" = v_mot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Motorista não encontrado em EMPREGADOS.';
    END IF;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  INSERT INTO public."DIARIA_UFRGS" (
    id, contrato_id, contrato_nome, contrato_cliente, contrato_empresa, competencia,
    cod_fornecedor, matricula, motorista_empregado_id, motorista_nome,
    sindicato, lotacao, numero_oficio, saida, retorno, destino, posto,
    valor_posto_variavel_centavos,
    qt_hospedagem, qt_cafe, qt_almoco, qt_janta, qt_va,
    observacoes, solicitante_id, solicitante_nome
  ) VALUES (
    v_id, v_contrato.id, v_contrato.nome, v_contrato.cliente, v_empresa,
    date_trunc('month', (p_dados->>'saida')::date)::date,
    NULLIF(btrim(coalesce(p_dados->>'cod_fornecedor', '')), ''),
    v_mat, v_mot_id, v_mot_nome,
    p_dados->>'sindicato', p_dados->>'lotacao',
    btrim(p_dados->>'numero_oficio'),
    (p_dados->>'saida')::date, (p_dados->>'retorno')::date,
    btrim(p_dados->>'destino'), NULLIF(p_dados->>'posto', ''),
    COALESCE((p_dados->>'valor_posto_variavel_centavos')::bigint, 0),
    COALESCE((p_dados->>'qt_hospedagem')::int, 0),
    COALESCE((p_dados->>'qt_cafe')::int, 0),
    COALESCE((p_dados->>'qt_almoco')::int, 0),
    COALESCE((p_dados->>'qt_janta')::int, 0),
    COALESCE((p_dados->>'qt_va')::int, 0),
    NULLIF(btrim(coalesce(p_dados->>'observacoes', '')), ''),
    auth.uid(), v_nome
  )
  RETURNING "DIARIA_UFRGS".numero INTO v_numero;

  INSERT INTO public."DIARIA_UFRGS_ANEXO" (
    diaria_id, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos', '[]'::jsonb)) a;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  RETURN QUERY SELECT v_id, v_numero;
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_criar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_criar(jsonb) TO authenticated;

-- Editar. "incluir/editar" é UM flag (é o pedido), então o gate é o mesmo da
-- criação — mais uma regra de ESTADO: só se mexe no que ainda não foi
-- decidido. Quem devolveu para ajuste é o dono corrigindo; quem tem a tela
-- também corrige uma 'solicitada' antes de alguém aprovar.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_editar(p_dados jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d        public."DIARIA_UFRGS"%ROWTYPE;
  v_id       uuid := NULLIF(p_dados->>'id', '')::uuid;
  v_mat      text := NULLIF(btrim(coalesce(p_dados->>'matricula', '')), '');
  v_mot_nome text := btrim(coalesce(p_dados->>'motorista_nome', ''));
  v_mot_id   bigint := NULLIF(p_dados->>'motorista_empregado_id', '')::bigint;
  v_removidos text[] := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(p_dados->'anexos_removidos', '[]'::jsonb))
  );
BEGIN
  IF NOT public.diaria_pode('incluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para editar diárias.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'em_ajuste') THEN
    RAISE EXCEPTION 'Uma diária % não pode mais ser editada.', v_d.status;
  END IF;
  IF v_d.status = 'em_ajuste' AND v_d.solicitante_id <> auth.uid()
     AND NOT public.diaria_decide('aprovar') THEN
    RAISE EXCEPTION 'A diária devolvida para ajuste é corrigida por quem a lançou.';
  END IF;

  PERFORM public.diaria_ufrgs_validar(p_dados);
  PERFORM public.diaria_ufrgs_validar_anexos(v_id, p_dados->'anexos_novos');

  IF v_mot_id IS NOT NULL THEN
    SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '')
      INTO v_mot_nome, v_mat
      FROM public."EMPREGADOS" e WHERE e."ID" = v_mot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Motorista não encontrado em EMPREGADOS.';
    END IF;
  END IF;

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS" SET
    cod_fornecedor         = NULLIF(btrim(coalesce(p_dados->>'cod_fornecedor', '')), ''),
    matricula              = v_mat,
    motorista_empregado_id = v_mot_id,
    motorista_nome         = v_mot_nome,
    sindicato              = p_dados->>'sindicato',
    lotacao                = p_dados->>'lotacao',
    numero_oficio          = btrim(p_dados->>'numero_oficio'),
    saida                  = (p_dados->>'saida')::date,
    retorno                = (p_dados->>'retorno')::date,
    destino                = btrim(p_dados->>'destino'),
    posto                  = NULLIF(p_dados->>'posto', ''),
    valor_posto_variavel_centavos = COALESCE((p_dados->>'valor_posto_variavel_centavos')::bigint, 0),
    qt_hospedagem          = COALESCE((p_dados->>'qt_hospedagem')::int, 0),
    qt_cafe                = COALESCE((p_dados->>'qt_cafe')::int, 0),
    qt_almoco              = COALESCE((p_dados->>'qt_almoco')::int, 0),
    qt_janta               = COALESCE((p_dados->>'qt_janta')::int, 0),
    qt_va                  = COALESCE((p_dados->>'qt_va')::int, 0),
    observacoes            = NULLIF(btrim(coalesce(p_dados->>'observacoes', '')), ''),
    -- Reenviar depois do ajuste devolve a diária para a fila. A decisão
    -- anterior sai de cena; quem devolveu e por quê continua na trilha.
    status                 = CASE WHEN v_d.status = 'em_ajuste' THEN 'solicitada' ELSE v_d.status END,
    ajuste_motivo          = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_motivo END,
    ajuste_pedido_por      = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_por END,
    ajuste_pedido_por_nome = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_por_nome END,
    ajuste_pedido_em       = CASE WHEN v_d.status = 'em_ajuste' THEN NULL ELSE v_d.ajuste_pedido_em END
  WHERE id = v_id;

  DELETE FROM public."DIARIA_UFRGS_ANEXO"
   WHERE diaria_id = v_id AND storage_path = ANY (v_removidos);

  INSERT INTO public."DIARIA_UFRGS_ANEXO" (
    diaria_id, storage_path, nome_arquivo, mime_type, tamanho_bytes
  )
  SELECT v_id, a->>'storage_path', a->>'nome_arquivo',
         NULLIF(a->>'mime_type', ''), NULLIF(a->>'tamanho_bytes', '')::bigint
    FROM jsonb_array_elements(COALESCE(p_dados->'anexos_novos', '[]'::jsonb)) a;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_editar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_editar(jsonb) TO authenticated;

-- ── 12) Decidir, devolver, excluir ───────────────────────────────────

-- 12.1) Aprovar ou reprovar, SEM tocar no Malote.
--
-- Os dois botões existem separados porque as permissões são separadas: quem
-- confere a planilha diz "a conta está certa" (aprovar); despachar o
-- pagamento é 'enviar_malote'. Quem tem as duas usa o botão combinado.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_decidir(
  p_diaria_id uuid,
  p_status    text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d    public."DIARIA_UFRGS"%ROWTYPE;
  v_nome text;
BEGIN
  IF p_status NOT IN ('aprovada', 'reprovada') THEN
    RAISE EXCEPTION 'Decisão inválida para a diária.';
  END IF;
  IF NOT public.diaria_decide('aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta diária.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = p_diaria_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status <> 'solicitada' THEN
    RAISE EXCEPTION 'A diária já foi % e não pode ser decidida novamente.', v_d.status;
  END IF;
  -- Mesma regra da diária de diarista: ninguém decide a própria.
  IF v_d.solicitante_id = auth.uid() THEN
    RAISE EXCEPTION 'Quem lançou a diária não pode aprovar ou reprovar a própria.';
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS"
     SET status            = p_status,
         decidido_por      = auth.uid(),
         decidido_por_nome = v_nome,
         decidido_em       = now()
   WHERE id = p_diaria_id;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_decidir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_decidir(uuid, text) TO authenticated;

-- 12.2) Enviar para o Malote — sozinho ou junto com a aprovação.
--
-- Aceita 'solicitada' (é o botão "Aprovar e enviar para malote") e
-- 'aprovada' (a diária já conferida que agora vai para pagamento). No
-- primeiro caso exige as DUAS permissões, porque faz as duas coisas.
--
-- Cria despesa + rateio + parcelas na MESMA transação em que muda a diária,
-- como diaria_aprovar_com_despesa() faz desde a 20260930000033: se qualquer
-- regra do Malote recusar, nada fica pela metade.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_enviar_malote(
  p_diaria_id uuid,
  p_despesa   jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d                public."DIARIA_UFRGS"%ROWTYPE;
  v_empresa_id       uuid;
  v_classificacao_id uuid;
  v_malote_id        uuid;
  v_valor_total      numeric;
  v_total_rateio     numeric;
  v_numero_parcelas  integer;
  v_nome             text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada.';
  END IF;
  IF NOT public.diaria_decide('enviar_malote') THEN
    RAISE EXCEPTION 'Você não tem permissão para enviar esta diária para o malote.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = p_diaria_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'aprovada') THEN
    RAISE EXCEPTION 'Uma diária % não vai para o malote.', v_d.status;
  END IF;
  IF v_d.malote_despesa_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta diária já tem despesa no Malote.';
  END IF;
  IF v_d.status = 'solicitada' THEN
    IF NOT public.diaria_decide('aprovar') THEN
      RAISE EXCEPTION 'Aprovar e enviar para o malote exige também a permissão de aprovar.';
    END IF;
    IF v_d.solicitante_id = auth.uid() THEN
      RAISE EXCEPTION 'Quem lançou a diária não pode aprovar a própria.';
    END IF;
  END IF;
  -- Valor líquido negativo (ver cabeçalho) existe na planilha, mas não vira
  -- despesa: o Malote é saída de caixa, e R$ 0,00 ou negativo ali seria uma
  -- despesa que ninguém consegue pagar nem conferir.
  IF v_d.valor_faturar_centavos <= 0 THEN
    RAISE EXCEPTION 'O valor à faturar desta diária é R$ %; corrija as quantidades antes de enviar para o malote.',
      to_char(v_d.valor_faturar_centavos / 100.0, 'FM999999990.00');
  END IF;

  SELECT c.empresa_id INTO v_empresa_id
    FROM public.contratos c WHERE c.id = v_d.contrato_id;
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'O contrato da diária não possui empresa para gerar a despesa do Malote.';
  END IF;

  SELECT c.id INTO v_classificacao_id
    FROM public.planejamento_orcamentario_classificacao c
   WHERE c.ativo = true
     AND lower(public.unaccent_safe(btrim(c.nome))) = 'diaria'
   ORDER BY c.created_at
   LIMIT 1;
  IF v_classificacao_id IS NULL THEN
    RAISE EXCEPTION 'A classificação ativa "Diária" não foi encontrada no Malote.';
  END IF;

  IF btrim(coalesce(p_despesa->>'nome', '')) = '' THEN
    RAISE EXCEPTION 'Informe o nome da despesa.';
  END IF;
  v_valor_total := NULLIF(p_despesa->>'valor_total', '')::numeric;
  IF v_valor_total IS NULL OR v_valor_total <= 0 THEN
    RAISE EXCEPTION 'Informe um valor total válido para a despesa.';
  END IF;
  -- O valor da despesa é o Valor à Faturar da diária: é ele que sai de caixa
  -- (líquido + tributos), e é o que o relatório soma na "Valor da Fatura".
  IF round(v_valor_total, 2) <> round(v_d.valor_faturar_centavos / 100.0, 2) THEN
    RAISE EXCEPTION 'O valor da despesa deve ser igual ao valor à faturar da diária (R$ %).',
      to_char(v_d.valor_faturar_centavos / 100.0, 'FM999999990.00');
  END IF;
  IF NULLIF(p_despesa->>'data_pagamento', '') IS NULL
     OR NULLIF(p_despesa->>'competencia', '') IS NULL
     OR btrim(coalesce(p_despesa->>'forma_pagamento', '')) = '' THEN
    RAISE EXCEPTION 'Data de pagamento, competência e forma de pagamento são obrigatórias.';
  END IF;
  IF jsonb_array_length(COALESCE(p_despesa->'rateio', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos uma linha de rateio.';
  END IF;
  SELECT round(COALESCE(sum((r->>'valor')::numeric), 0), 2)
    INTO v_total_rateio
    FROM jsonb_array_elements(COALESCE(p_despesa->'rateio', '[]'::jsonb)) r;
  IF abs(v_total_rateio - round(v_valor_total, 2)) > 0.01 THEN
    RAISE EXCEPTION 'O total do rateio deve ser igual ao valor da despesa.';
  END IF;

  v_numero_parcelas := NULLIF(p_despesa->>'numero_parcelas', '')::integer;
  IF COALESCE((p_despesa->>'parcelado')::boolean, false)
     AND (v_numero_parcelas IS NULL OR v_numero_parcelas < 2 OR v_numero_parcelas > 420) THEN
    RAISE EXCEPTION 'Quantidade de parcelas deve ser entre 2 e 420.';
  END IF;
  IF COALESCE((p_despesa->>'parcelado')::boolean, false)
     AND jsonb_array_length(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) <> v_numero_parcelas THEN
    RAISE EXCEPTION 'As parcelas informadas não correspondem à quantidade da despesa.';
  END IF;

  INSERT INTO public.malote_despesa (
    empresa_id, classificacao_id, origem, status, nivel_aprovacao_atual,
    nome, valor_total, motivo, descricao, tipo_movimento, tipo, contrato_id,
    data_pagamento, competencia, forma_pagamento, informacoes_pagamento,
    excecao, justificativa_excecao, parcelado, numero_parcelas, dia_desconto,
    created_by
  ) VALUES (
    v_empresa_id, v_classificacao_id, 'despesa_unica', 'pendente_aprovacao', 1,
    btrim(p_despesa->>'nome'), v_valor_total,
    'Pagamento de diária UFRGS ' || coalesce(v_d.numero, v_d.id::text),
    'Gerado automaticamente pelo Controle de Diárias (UFRGS). Motorista: ' ||
      v_d.motorista_nome || '; ofício: ' || v_d.numero_oficio ||
      '; destino: ' || v_d.destino || '; lotação: ' || v_d.lotacao || '.',
    'saida', 'contrato', v_d.contrato_id,
    (p_despesa->>'data_pagamento')::date,
    (p_despesa->>'competencia')::date,
    btrim(p_despesa->>'forma_pagamento'),
    NULLIF(btrim(coalesce(p_despesa->>'informacoes_pagamento', '')), ''),
    COALESCE((p_despesa->>'excecao')::boolean, false),
    NULLIF(btrim(coalesce(p_despesa->>'justificativa_excecao', '')), ''),
    COALESCE((p_despesa->>'parcelado')::boolean, false),
    CASE WHEN COALESCE((p_despesa->>'parcelado')::boolean, false) THEN v_numero_parcelas ELSE NULL END,
    CASE WHEN COALESCE((p_despesa->>'parcelado')::boolean, false) THEN NULLIF(p_despesa->>'dia_desconto', '')::integer ELSE NULL END,
    auth.uid()
  ) RETURNING id INTO v_malote_id;

  INSERT INTO public.malote_despesa_rateio_linha (
    despesa_id, classificacao_id, empresa_id, contrato_id, fornecedor_id,
    integrante_empregado_id, percentual, valor, ordem, justificativa_texto
  )
  SELECT
    v_malote_id,
    NULLIF(r.linha->>'classificacao_id', '')::uuid,
    NULLIF(r.linha->>'empresa_id', '')::uuid,
    NULLIF(r.linha->>'contrato_id', '')::uuid,
    NULLIF(r.linha->>'fornecedor_id', '')::uuid,
    NULLIF(r.linha->>'integrante_empregado_id', '')::bigint,
    NULLIF(r.linha->>'percentual', '')::numeric,
    (r.linha->>'valor')::numeric,
    (r.ordem - 1)::integer,
    NULLIF(btrim(coalesce(r.linha->>'justificativa_texto', '')), '')
  FROM jsonb_array_elements(COALESCE(p_despesa->'rateio', '[]'::jsonb))
       WITH ORDINALITY AS r(linha, ordem);

  IF COALESCE((p_despesa->>'parcelado')::boolean, false) THEN
    INSERT INTO public.malote_despesa_parcela (
      despesa_id, numero_parcela, valor, data_vencimento
    )
    SELECT
      v_malote_id,
      (p.parcela->>'numero_parcela')::integer,
      (p.parcela->>'valor')::numeric,
      (p.parcela->>'data_vencimento')::date
    FROM jsonb_array_elements(COALESCE(p_despesa->'parcelas', '[]'::jsonb)) p(parcela);
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS"
     SET status                = 'aprovada',
         malote_motivo         = btrim(p_despesa->>'nome'),
         malote_data_pagamento = (p_despesa->>'data_pagamento')::date,
         malote_despesa_id     = v_malote_id,
         enviado_malote_em     = now(),
         decidido_por          = COALESCE(v_d.decidido_por, auth.uid()),
         decidido_por_nome     = COALESCE(v_d.decidido_por_nome, v_nome),
         decidido_em           = COALESCE(v_d.decidido_em, now())
   WHERE id = p_diaria_id;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  RETURN v_malote_id;
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_enviar_malote(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_enviar_malote(uuid, jsonb) TO authenticated;

-- 12.3) Devolver para ajuste. Mesma saída que a diária de diarista ganhou na
-- 20260930000153: de 'solicitada' (a decisão normal) e de 'reprovada' — a
-- reprovada que "fica ali parada".
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_solicitar_ajuste(
  p_diaria_id uuid,
  p_motivo    text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d      public."DIARIA_UFRGS"%ROWTYPE;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF NOT public.diaria_decide('aprovar') THEN
    RAISE EXCEPTION 'Você não tem permissão para devolver esta diária para ajuste.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Diga o que precisa ser ajustado — é o que o solicitante vai ler.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = p_diaria_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status NOT IN ('solicitada', 'reprovada') THEN
    RAISE EXCEPTION 'Só uma diária Solicitada ou Reprovada pode ser devolvida para ajuste (esta está %).', v_d.status;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS"
     SET status                 = 'em_ajuste',
         ajuste_motivo          = v_motivo,
         ajuste_pedido_por      = auth.uid(),
         ajuste_pedido_por_nome = v_nome,
         ajuste_pedido_em       = now(),
         decidido_por           = NULL,
         decidido_por_nome      = NULL,
         decidido_em            = NULL
   WHERE id = p_diaria_id;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  -- O sininho global (public.notificacoes), o mesmo da diária de diarista.
  -- O link leva para a rota do Operacional porque a diária UFRGS é lançada e
  -- corrigida lá — Encarregados não tem esse tipo.
  INSERT INTO public.notificacoes (user_id, titulo, mensagem, tipo, link)
  SELECT v_d.solicitante_id,
         'Diária UFRGS devolvida para ajuste',
         'A diária ' || COALESCE(v_d.numero, '') || ' precisa de ajuste: ' || v_motivo,
         'diaria_ajuste',
         '/app/operacional/diarias?tipo=ufrgs&diaria=' || p_diaria_id::text
   WHERE v_d.solicitante_id IS DISTINCT FROM auth.uid();
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_solicitar_ajuste(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_solicitar_ajuste(uuid, text) TO authenticated;

-- 12.4) Excluir — LOGICAMENTE, mesma decisão da diária de diarista: é
-- pagamento a pessoa física, e DELETE apagaria junto quem pediu, quem
-- decidiu e por quê. O que a RPC recusa é excluir o que já virou despesa no
-- Malote — desfazer aquilo é pelo Malote.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_excluir(
  p_diaria_id uuid,
  p_motivo    text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_d      public."DIARIA_UFRGS"%ROWTYPE;
  v_nome   text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
BEGIN
  IF NOT public.diaria_decide('excluir') THEN
    RAISE EXCEPTION 'Você não tem permissão para excluir esta diária.';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Diga por que a diária está sendo excluída — é o que fica no histórico.';
  END IF;

  SELECT * INTO v_d FROM public."DIARIA_UFRGS" WHERE id = p_diaria_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Diária UFRGS não encontrada.';
  END IF;
  IF v_d.status = 'excluida' THEN
    RAISE EXCEPTION 'Esta diária já está excluída.';
  END IF;
  IF v_d.malote_despesa_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta diária já virou despesa no Malote — desfaça por lá antes de excluir.';
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  UPDATE public."DIARIA_UFRGS"
     SET status            = 'excluida',
         exclusao_motivo   = v_motivo,
         excluida_por      = auth.uid(),
         excluida_por_nome = v_nome,
         excluida_em       = now()
   WHERE id = p_diaria_id;
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_excluir(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_excluir(uuid, text);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_solicitar_ajuste(uuid, text);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_enviar_malote(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_decidir(uuid, text);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_editar(jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_criar(jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_validar_anexos(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_validar(jsonb);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_registrar_visualizacao(uuid);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_buscar_motoristas(text);
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_data_deposito(public."DIARIA_UFRGS");
-- DROP FUNCTION IF EXISTS public.malote_despesa_paga(public."DIARIA_UFRGS");
-- DROP TABLE IF EXISTS public."DIARIA_UFRGS_VISUALIZACAO",
--   public."DIARIA_UFRGS_EVENTO", public."DIARIA_UFRGS_ANEXO",
--   public."DIARIA_UFRGS" CASCADE;
-- DROP FUNCTION IF EXISTS public.diaria_ufrgs_evento_auto(),
--   public.diaria_ufrgs_guard(), public.diaria_ufrgs_em_rpc(),
--   public.diaria_ufrgs_calcular(), public.diaria_ufrgs_touch();
-- DROP SEQUENCE IF EXISTS public.diaria_ufrgs_seq;
-- DROP TABLE IF EXISTS public."DIARIA_UFRGS_POSTO",
--   public."DIARIA_UFRGS_LOTACAO", public."DIARIA_UFRGS_TARIFA" CASCADE;
-- -- Os gates voltam ao estado da 20260930000153 (reaplique-a) e:
-- DROP FUNCTION IF EXISTS public.diaria_decide(public.app_acao);
-- DROP FUNCTION IF EXISTS public.diaria_ve_tudo();
-- DELETE FROM public.app_menu_acao WHERE acao = 'enviar_malote';
-- DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro_diarias';
-- DELETE FROM public.app_menu WHERE codigo = 'financeiro_diarias';
-- NOTIFY pgrst, 'reload schema';
