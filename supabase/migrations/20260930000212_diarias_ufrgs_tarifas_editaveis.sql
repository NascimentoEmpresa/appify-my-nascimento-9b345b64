-- =====================================================================
-- DIÁRIAS UFRGS — a tarifa dos sindicatos passa a ser editável na tela
--
-- O PEDIDO (22/09/2026, /app/financeiro/diarias?tipo=ufrgs): o sindicato
-- escolhido no bloco "1. Identificação" é o que define a conta do bloco
-- "4. Quantidades e valores". Hoje, quando o valor de um sindicato muda
-- (dissídio, termo aditivo), alguém tem que abrir um chamado para o
-- desenvolvimento rodar um UPDATE. O pedido é que o PRÓPRIO FINANCEIRO
-- edite, pela tela, com permissão no Gerenciamento de Acesso — e que o
-- valor salvo já apareça no cálculo.
--
-- Até aqui a 20260930000155 dizia, textualmente, o contrário: "Só leitura
-- pelo cliente: tarifa e tabela de postos são do contrato, não da tela.
-- Mudança de dissídio entra por migration/SQL, com data de vigência." O
-- GRANT continua sendo só SELECT — o que muda é que agora existe uma RPC
-- SECURITY DEFINER para escrever, com chave própria. Nenhum client escreve
-- direto em "DIARIA_UFRGS_TARIFA".
--
-- AS QUATRO DECISÕES, todas confirmadas com o usuário antes de escrever:
--
-- 1) CHAVE PRÓPRIA, menu fantasma. 'financeiro_diarias_tarifas' (rota NULL)
--    em vez de reusar o 'alterar' de 'financeiro_diarias'. Motivo: 'alterar'
--    está em ACOES_DO_TOGGLE_PADRAO (src/lib/acoesDoToggleAcesso.ts) — vem
--    de brinde com o switch da tela. Quem recebesse Controle de Diárias no
--    Financeiro para CONFERIR passaria a poder mudar a tarifa de todo mundo,
--    que é a mesma armadilha que fez 'aprovar' sair do pacote em Diárias na
--    20260930000153. Mudar tarifa é mexer no valor de TODAS as diárias
--    futuras daquele sindicato; é decisão de pessoa específica, não do setor.
--
-- 2) NOVA VIGÊNCIA, não sobrescrita. Salvar grava uma LINHA NOVA com a data
--    "vigente a partir de" que a pessoa escolher (a tela sugere hoje). A
--    tabela anterior continua no banco, e a diária de agosto continua
--    batendo com o que foi faturado em agosto — que é a razão de
--    vigencia_inicio existir desde a 155. Salvar com uma data que JÁ tem
--    linha atualiza aquela linha no lugar (é a correção de digitação), e é
--    exatamente isso que o UNIQUE (sindicato, vigencia_inicio) faz virar um
--    ON CONFLICT DO UPDATE em vez de uma segunda linha para o mesmo dia.
--
-- 3) RECALCULA SÓ O QUE ESTÁ EM ABERTO. 'solicitada' e 'em_ajuste' cuja
--    saída cai na janela da vigência alterada são recalculadas na hora (a
--    trigger diaria_ufrgs_calcular já escolhe a tarifa pela saída; basta
--    tocar a linha). 'aprovada', 'reprovada' e 'excluida' NÃO são tocadas:
--    aprovada é conta conferida, e a paga virou desembolso no Malote —
--    reescrever qualquer uma das duas mudaria um número que alguém já
--    assinou. A RPC devolve as duas contagens para a tela poder dizer
--    "recalculei N e deixei M congeladas".
--
-- 4) JANELA, não "tudo do sindicato". A vigência alterada manda de
--    vigencia_inicio até a PRÓXIMA vigência do mesmo sindicato (exclusive).
--    Recalcular fora dessa janela tocaria diária que é governada por outra
--    linha da tabela — updated_at novo, evento novo na trilha e nenhum
--    centavo diferente.
--
-- PRÉ-REQUISITO: 20260930000155 (as tabelas e a trigger da Diária UFRGS).
-- Idempotente: pode reexecutar.
-- =====================================================================

-- ── 1) A chave de acesso (menu fantasma) ─────────────────────────────
--
-- rota = NULL: não é tela, é capacidade — mesmo padrão de
-- 'malote_relatorio_despesas' (20260930000186) e dos quatro de Ponto
-- (20260925000010). Fica no módulo Financeiro porque a rota que expõe o
-- botão é /app/financeiro/diarias, e só ela (o botão não aparece em
-- Operacional nem em Encarregados — ver ControleDiarias.tsx).
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem)
SELECT mo.id, 'financeiro_diarias_tarifas',
       'Diárias UFRGS — editar tarifas dos sindicatos', NULL,
       COALESCE((SELECT max(am.ordem) FROM public.app_menu am WHERE am.modulo_id = mo.id), 0) + 10
  FROM public.app_modulo mo
 WHERE mo.codigo = 'financeiro'
   AND NOT EXISTS (SELECT 1 FROM public.app_menu am WHERE am.codigo = 'financeiro_diarias_tarifas');

-- can_access() devolve false para menu inativo ANTES de olhar perfil.
UPDATE public.app_menu SET ativo = true WHERE codigo = 'financeiro_diarias_tarifas';

-- Semear os perfis concede_tudo é o que marca o código como CONFIGURADO.
-- Menu sem nenhuma linha em perfil_acesso_permissao/screen_permission_user
-- fica fora de list_configured_menu_codes() e o front trata como "sem regra
-- = aberto" (aconteceu com os menus do Supply e com cotacoes-licitacao). A
-- linha não muda nada para quem já concede tudo; muda para todo o resto.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'financeiro_diarias_tarifas', a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('alterar'::public.app_acao)) AS a(acao)
 WHERE pa.ativo = true AND pa.concede_tudo = true
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- NADA em app_menu_acao de propósito: o switch principal da linha já grava
-- ACOES_DO_TOGGLE_PADRAO, que inclui 'alterar' — uma chave só, "pode editar
-- tarifa", sem sub-switch redundante. Mesmo desenho dos menus fantasma de
-- Ponto. E nenhum seed para o perfil "Financeiro": a permissão é de pessoa,
-- não do setor inteiro (libere em Administração › Acesso por Usuário).

-- ── 2) Trilha na própria linha da tarifa ─────────────────────────────
--
-- Quem mudou, quando e por quê. Não é tabela de histórico: o histórico das
-- TARIFAS já é a própria tabela (uma linha por vigência). Isto responde a
-- outra pergunta — "quem digitou este número?" —, que antes tinha uma
-- resposta só: "veio na migration".
ALTER TABLE public."DIARIA_UFRGS_TARIFA"
  ADD COLUMN IF NOT EXISTS motivo              text,
  ADD COLUMN IF NOT EXISTS atualizado_em       timestamptz,
  ADD COLUMN IF NOT EXISTS atualizado_por      uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS atualizado_por_nome text;

-- A soma das alíquotas entra num gross-up: U = T * f / (1 - f). Com f = 1 o
-- banco divide por zero e a gravação da DIÁRIA quebra, não a da tarifa —
-- longe do lugar onde o número errado foi digitado. Enquanto o valor vinha
-- de migration isso era teórico; com a tela, não é mais. O CHECK é a rede;
-- a RPC recusa antes, com mensagem em português.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'diaria_ufrgs_tarifa_aliquota_valida'
       AND conrelid = 'public."DIARIA_UFRGS_TARIFA"'::regclass
  ) THEN
    ALTER TABLE public."DIARIA_UFRGS_TARIFA"
      ADD CONSTRAINT diaria_ufrgs_tarifa_aliquota_valida
      CHECK (aliquota_pis >= 0 AND aliquota_cofins >= 0 AND aliquota_iss >= 0
             AND aliquota_pis + aliquota_cofins + aliquota_iss < 1);
  END IF;
END $do$;

-- ── 3) O gate ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_tarifa_pode()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
  SELECT public.can_access(auth.uid(), 'financeiro_diarias_tarifas', 'alterar');
$fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_tarifa_pode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_tarifa_pode() TO authenticated;

-- ── 4) A trilha do recálculo ─────────────────────────────────────────
--
-- O recálculo é um UPDATE em "DIARIA_UFRGS", e todo UPDATE numa diária em
-- aberto gera o evento 'editada' com "Dados da diária alterados." — que
-- aqui seria mentira: ninguém alterou dado nenhum da diária, a TARIFA é que
-- mudou embaixo dela. A GUC carrega a data da vigência para o evento poder
-- dizer qual tabela passou a valer. Mesma mecânica de 'diaria_ufrgs.rpc'.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_recalculo_tarifa()
RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $fn$ SELECT NULLIF(COALESCE(current_setting('diaria_ufrgs.tarifa_recalculo', true), ''), '') $fn$;

CREATE OR REPLACE FUNCTION public.diaria_ufrgs_evento_auto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_vigencia text;
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
    v_vigencia := public.diaria_ufrgs_recalculo_tarifa();
    INSERT INTO public."DIARIA_UFRGS_EVENTO" (diaria_id, tipo, descricao, autor_id, autor_nome)
    VALUES (NEW.id,
            CASE WHEN v_vigencia IS NULL THEN 'editada' ELSE 'tarifa' END,
            CASE WHEN v_vigencia IS NULL
                 THEN 'Dados da diária alterados.'
                 ELSE 'Valores recalculados pela tarifa de ' || NEW.sindicato
                      || ' vigente a partir de ' || v_vigencia || '.'
            END,
            auth.uid(),
            (SELECT COALESCE(p.display_name, p.email) FROM public.profiles p WHERE p.id = auth.uid()));
  END IF;
  RETURN NULL;
END $fn$;

-- ── 5) Salvar uma tarifa ─────────────────────────────────────────────
--
-- Uma RPC só para os dois casos, porque para quem usa é o MESMO gesto
-- ("mudar o valor do sindicato") e o que separa os dois é só a data:
--
--   data nova  → INSERT: nasce uma vigência, a anterior continua valendo
--                para o passado dela;
--   data que já existe → UPDATE naquela linha: é correção de digitação.
--
-- O `xmax = 0` no RETURNING é o jeito de saber qual dos dois aconteceu num
-- ON CONFLICT (linha inserida agora tem xmax zerado; linha atualizada não) —
-- é só para a mensagem da tela, nada depende dele.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_tarifa_salvar(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_sind   text   := btrim(COALESCE(p_dados->>'sindicato', ''));
  v_vig    date   := NULLIF(p_dados->>'vigencia_inicio', '')::date;
  v_hosp   bigint := COALESCE((p_dados->>'hospedagem_centavos')::bigint, -1);
  v_cafe   bigint := COALESCE((p_dados->>'cafe_centavos')::bigint, -1);
  v_alm    bigint := COALESCE((p_dados->>'almoco_centavos')::bigint, -1);
  v_jan    bigint := COALESCE((p_dados->>'janta_centavos')::bigint, -1);
  v_va     bigint := COALESCE((p_dados->>'va_centavos')::bigint, -1);
  v_pis    numeric := COALESCE((p_dados->>'aliquota_pis')::numeric, -1);
  v_cof    numeric := COALESCE((p_dados->>'aliquota_cofins')::numeric, -1);
  v_iss    numeric := COALESCE((p_dados->>'aliquota_iss')::numeric, -1);
  v_f      numeric;
  v_nome   text;
  v_id     uuid;
  v_criada boolean;
  v_prox   date;
  v_recalc integer := 0;
  v_congel integer := 0;
BEGIN
  IF NOT public.diaria_ufrgs_tarifa_pode() THEN
    RAISE EXCEPTION 'Você não tem permissão para editar as tarifas dos sindicatos.';
  END IF;

  IF v_sind = '' THEN
    RAISE EXCEPTION 'Informe o sindicato.';
  END IF;
  IF length(v_sind) > 60 THEN
    RAISE EXCEPTION 'Nome de sindicato longo demais (máximo de 60 caracteres).';
  END IF;
  IF v_vig IS NULL THEN
    RAISE EXCEPTION 'Informe a data a partir da qual esta tabela de valores vale.';
  END IF;
  -- Data futura é legítima (dissídio assinado com efeito no mês que vem);
  -- o piso só barra o 0026 de um 2026 digitado torto.
  IF v_vig < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'Data de vigência inválida: %.', to_char(v_vig, 'DD/MM/YYYY');
  END IF;
  IF LEAST(v_hosp, v_cafe, v_alm, v_jan, v_va) < 0 THEN
    RAISE EXCEPTION 'Os valores da tarifa não podem ser negativos.';
  END IF;
  IF GREATEST(v_hosp, v_cafe, v_alm, v_jan, v_va) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um valor maior que zero.';
  END IF;
  IF LEAST(v_pis, v_cof, v_iss) < 0 THEN
    RAISE EXCEPTION 'As alíquotas não podem ser negativas.';
  END IF;
  v_f := v_pis + v_cof + v_iss;
  -- f/(1-f): em 100% o gross-up divide por zero, acima disso vira tributo
  -- negativo. O CHECK da tabela repete a regra; aqui ela tem mensagem.
  IF v_f >= 1 THEN
    RAISE EXCEPTION 'A soma das alíquotas é % e precisa ser menor que 100%%.',
      to_char(round(v_f * 100, 2), 'FM999990D00') || '%';
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public."DIARIA_UFRGS_TARIFA" (
    sindicato, vigencia_inicio,
    hospedagem_centavos, cafe_centavos, almoco_centavos, janta_centavos, va_centavos,
    aliquota_pis, aliquota_cofins, aliquota_iss,
    ativo, motivo, atualizado_em, atualizado_por, atualizado_por_nome
  ) VALUES (
    v_sind, v_vig,
    v_hosp, v_cafe, v_alm, v_jan, v_va,
    v_pis, v_cof, v_iss,
    true, NULLIF(btrim(COALESCE(p_dados->>'motivo', '')), ''), now(), auth.uid(), v_nome
  )
  ON CONFLICT (sindicato, vigencia_inicio) DO UPDATE SET
    hospedagem_centavos = EXCLUDED.hospedagem_centavos,
    cafe_centavos       = EXCLUDED.cafe_centavos,
    almoco_centavos     = EXCLUDED.almoco_centavos,
    janta_centavos      = EXCLUDED.janta_centavos,
    va_centavos         = EXCLUDED.va_centavos,
    aliquota_pis        = EXCLUDED.aliquota_pis,
    aliquota_cofins     = EXCLUDED.aliquota_cofins,
    aliquota_iss        = EXCLUDED.aliquota_iss,
    -- Salvar por cima de uma vigência desativada a traz de volta: é o
    -- desfazer natural de quem removeu a linha errada.
    ativo               = true,
    motivo              = EXCLUDED.motivo,
    atualizado_em       = now(),
    atualizado_por      = EXCLUDED.atualizado_por,
    atualizado_por_nome = EXCLUDED.atualizado_por_nome
  RETURNING id, (xmax = 0) INTO v_id, v_criada;

  -- A janela desta vigência: dela até a próxima do MESMO sindicato.
  SELECT min(x.vigencia_inicio) INTO v_prox
    FROM public."DIARIA_UFRGS_TARIFA" x
   WHERE x.sindicato = v_sind AND x.ativo = true AND x.vigencia_inicio > v_vig;

  SELECT count(*) INTO v_congel
    FROM public."DIARIA_UFRGS" d
   WHERE d.sindicato = v_sind
     AND d.status NOT IN ('solicitada', 'em_ajuste')
     AND d.saida >= v_vig
     AND (v_prox IS NULL OR d.saida < v_prox);

  -- O UPDATE não muda coluna nenhuma de propósito: quem recalcula é a
  -- trigger diaria_ufrgs_calcular (BEFORE UPDATE), que relê a tarifa pela
  -- data de saída. updated_at seria reescrito pela diaria_ufrgs_touch de
  -- qualquer jeito; está aqui para a linha ser de fato atualizada.
  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  PERFORM set_config('diaria_ufrgs.tarifa_recalculo', to_char(v_vig, 'DD/MM/YYYY'), true);
  UPDATE public."DIARIA_UFRGS" d
     SET updated_at = now()
   WHERE d.sindicato = v_sind
     AND d.status IN ('solicitada', 'em_ajuste')
     AND d.saida >= v_vig
     AND (v_prox IS NULL OR d.saida < v_prox);
  GET DIAGNOSTICS v_recalc = ROW_COUNT;
  PERFORM set_config('diaria_ufrgs.tarifa_recalculo', '', true);
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  RETURN jsonb_build_object(
    'id', v_id,
    'criada', v_criada,
    'recalculadas', v_recalc,
    'congeladas', v_congel
  );
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_tarifa_salvar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_tarifa_salvar(jsonb) TO authenticated;

-- ── 6) Remover uma vigência ──────────────────────────────────────────
--
-- Existe por causa do erro que a tela cria e a migration não criava: salvar
-- a tabela certa na DATA errada. Sem o desfazer, aquela linha passa a
-- governar todas as diárias dali para a frente e não há botão nenhum que a
-- tire do caminho.
--
-- Desativa, não apaga: "DIARIA_UFRGS".tarifa_id aponta para a linha, e as
-- diárias já lançadas nela precisam continuar conseguindo explicar o valor
-- que foi faturado. tarifaVigente() e a trigger só olham ativo = true.
CREATE OR REPLACE FUNCTION public.diaria_ufrgs_tarifa_remover(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_t       public."DIARIA_UFRGS_TARIFA"%ROWTYPE;
  v_nome    text;
  v_prox    date;
  v_restam  integer;
  v_orfas   integer;
  v_recalc  integer := 0;
BEGIN
  IF NOT public.diaria_ufrgs_tarifa_pode() THEN
    RAISE EXCEPTION 'Você não tem permissão para editar as tarifas dos sindicatos.';
  END IF;

  SELECT * INTO v_t FROM public."DIARIA_UFRGS_TARIFA" WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vigência de tarifa não encontrada.';
  END IF;
  IF v_t.ativo = false THEN
    RETURN jsonb_build_object('id', p_id, 'recalculadas', 0);
  END IF;

  SELECT count(*) INTO v_restam
    FROM public."DIARIA_UFRGS_TARIFA" x
   WHERE x.sindicato = v_t.sindicato AND x.ativo = true AND x.id <> p_id;
  IF v_restam = 0 THEN
    RAISE EXCEPTION
      'Esta é a única tabela de valores de %. Removê-la deixaria o sindicato sem tarifa e travaria o lançamento de diárias.',
      v_t.sindicato;
  END IF;

  SELECT min(x.vigencia_inicio) INTO v_prox
    FROM public."DIARIA_UFRGS_TARIFA" x
   WHERE x.sindicato = v_t.sindicato AND x.ativo = true AND x.vigencia_inicio > v_t.vigencia_inicio;

  -- Diária em aberto que ficaria sem NENHUMA tabela anterior para cair.
  -- Sem esta checagem quem recusa é a trigger, no meio do UPDATE em lote e
  -- com uma mensagem que fala de diária, não de tarifa.
  SELECT count(*) INTO v_orfas
    FROM public."DIARIA_UFRGS" d
   WHERE d.sindicato = v_t.sindicato
     AND d.status IN ('solicitada', 'em_ajuste')
     AND d.saida >= v_t.vigencia_inicio
     AND (v_prox IS NULL OR d.saida < v_prox)
     AND NOT EXISTS (
       SELECT 1 FROM public."DIARIA_UFRGS_TARIFA" x
        WHERE x.sindicato = v_t.sindicato AND x.ativo = true AND x.id <> p_id
          AND x.vigencia_inicio <= d.saida
     );
  IF v_orfas > 0 THEN
    RAISE EXCEPTION
      'Não dá para remover: % diária(s) em aberto ficariam sem tabela de valores. Cadastre a tabela anterior antes.',
      v_orfas;
  END IF;

  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  UPDATE public."DIARIA_UFRGS_TARIFA"
     SET ativo = false,
         atualizado_em = now(),
         atualizado_por = auth.uid(),
         atualizado_por_nome = v_nome
   WHERE id = p_id;

  PERFORM set_config('diaria_ufrgs.rpc', '1', true);
  PERFORM set_config('diaria_ufrgs.tarifa_recalculo', to_char(v_t.vigencia_inicio, 'DD/MM/YYYY'), true);
  UPDATE public."DIARIA_UFRGS" d
     SET updated_at = now()
   WHERE d.sindicato = v_t.sindicato
     AND d.status IN ('solicitada', 'em_ajuste')
     AND d.saida >= v_t.vigencia_inicio
     AND (v_prox IS NULL OR d.saida < v_prox);
  GET DIAGNOSTICS v_recalc = ROW_COUNT;
  PERFORM set_config('diaria_ufrgs.tarifa_recalculo', '', true);
  PERFORM set_config('diaria_ufrgs.rpc', '0', true);

  RETURN jsonb_build_object('id', p_id, 'recalculadas', v_recalc);
END $fn$;
REVOKE ALL ON FUNCTION public.diaria_ufrgs_tarifa_remover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diaria_ufrgs_tarifa_remover(uuid) TO authenticated;

-- ── 7) Leitura do histórico ──────────────────────────────────────────
--
-- A policy de SELECT continua sendo diaria_ufrgs_tarifa_select
-- (diaria_pode('visualizar')): o modal de edição lê a MESMA tabela que o
-- cálculo já lia, inclusive as vigências desativadas, que ele mostra
-- riscadas. Não há dado novo exposto — é a tabela de preços do contrato,
-- que toda diária já mostra no bloco 4.

NOTIFY pgrst, 'reload schema';

-- ── 8) Conferência ───────────────────────────────────────────────────
SELECT am.codigo, am.nome, COALESCE(am.rota, '(fantasma — só permissão)') AS rota, am.ativo
  FROM public.app_menu am
 WHERE am.codigo IN ('financeiro_diarias', 'financeiro_diarias_tarifas');

SELECT sindicato, to_char(vigencia_inicio, 'DD/MM/YYYY') AS vigencia,
       hospedagem_centavos, cafe_centavos, almoco_centavos, janta_centavos, va_centavos,
       aliquota_pis + aliquota_cofins + aliquota_iss AS aliquota_total, ativo
  FROM public."DIARIA_UFRGS_TARIFA"
 ORDER BY sindicato, vigencia_inicio DESC;

-- =====================================================================
-- DEPOIS DE RODAR: liberar em Administração › Acesso por Usuário o item
-- "Diárias UFRGS — editar tarifas dos sindicatos" (módulo Financeiro) para
-- QUEM de fato mantém a tabela do contrato. Sem isso o botão não aparece
-- para ninguém além dos perfis que concedem tudo — que é o padrão certo.
-- =====================================================================
-- ROLLBACK
-- =====================================================================
--   DROP FUNCTION IF EXISTS public.diaria_ufrgs_tarifa_remover(uuid);
--   DROP FUNCTION IF EXISTS public.diaria_ufrgs_tarifa_salvar(jsonb);
--   DROP FUNCTION IF EXISTS public.diaria_ufrgs_tarifa_pode();
--   -- a evento_auto volta ao corpo da 20260930000155 (reexecute a seção 7.4
--   -- daquela migration); diaria_ufrgs_recalculo_tarifa fica sem uso:
--   DROP FUNCTION IF EXISTS public.diaria_ufrgs_recalculo_tarifa();
--   ALTER TABLE public."DIARIA_UFRGS_TARIFA"
--     DROP CONSTRAINT IF EXISTS diaria_ufrgs_tarifa_aliquota_valida;
--   ALTER TABLE public."DIARIA_UFRGS_TARIFA"
--     DROP COLUMN IF EXISTS motivo,
--     DROP COLUMN IF EXISTS atualizado_em,
--     DROP COLUMN IF EXISTS atualizado_por,
--     DROP COLUMN IF EXISTS atualizado_por_nome;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'financeiro_diarias_tarifas';
--   DELETE FROM public.app_menu WHERE codigo = 'financeiro_diarias_tarifas';
--   NOTIFY pgrst, 'reload schema';
-- =====================================================================
