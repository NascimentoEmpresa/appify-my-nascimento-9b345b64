-- =====================================================================
-- SOLICITAR MATERIAIS — escolher o colaborador em vez de digitar
--
-- POR QUE
-- Pedido do gerente de sistemas: minimizar a digitação do usuário externo,
-- para ele não conseguir criar informação que não existe. Hoje nome e
-- matrícula do colaborador são campos livres, e saem daí nomes truncados,
-- matrículas inventadas e grafias que não batem com a folha.
--
-- O QUE ENTRA
--   1. sup_norm_busca — normalização que PRESERVA espaço (a sup_norm_nome não);
--   2. índice trigram parcial, para a busca por pedaço de nome usar índice;
--   3. de-para de contrato, porque EMPREGADOS não tem FK para contratos;
--   4. RPC sup_ext_colaboradores — busca no servidor, devolve pouco e SÓ o
--      que a tela precisa (nunca CPF, salário, PIX ou conta);
--   5. sup_pedido ganha o vínculo com a pessoa real;
--   6. sup_ext_criar_pedido resolve nome e matrícula NO SERVIDOR.
--
-- PRIVACIDADE
-- EMPREGADOS guarda CPF, salário, chave PIX e conta bancária, e a sessão do
-- encarregado é ANÔNIMA. A tabela tem RLS ligada, então nada disso é legível
-- direto — e a RPC abaixo devolve exatamente cinco campos, nenhum sensível.
-- =====================================================================

-- ── 1. Normalização para BUSCA ───────────────────────────────────────
--
-- sup_norm_nome() existe, mas apaga todo não-alfanumérico:
--   'José da Conceição ÁVILA' → 'JOSEDACONCEICAOAVILA'
-- Isso serve para casar nome exato (foi para isso que ela nasceu) e ARRUÍNA
-- busca por duas palavras: "JOSE AVILA" viraria "JOSEAVILA", que não existe
-- dentro daquela string. Aqui o espaço é justamente o que separa os termos.
CREATE OR REPLACE FUNCTION public.sup_norm_busca(t text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT btrim(regexp_replace(
    upper(translate(t,
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^A-Z0-9]+', ' ', 'g'));
$$;

-- ── 2. Índice ────────────────────────────────────────────────────────
-- Os índices existentes em "Nome" são btree: só servem para PREFIXO. Quem
-- procura "SILVA" quer achar no meio do nome, e aí btree não ajuda.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS empregados_nome_busca_trgm
  ON public."EMPREGADOS" USING gin (public.sup_norm_busca("Nome") gin_trgm_ops)
  WHERE "Situação" <> 'Demitido';

-- ── 3. De-para de contrato ───────────────────────────────────────────
--
-- EMPREGADOS não tem FK para contratos: contrato_responsavel_id está vazio
-- para os 2.411 na ativa, e os "Nome do Posto" não têm NENHUMA
-- correspondência com sup_posto. O único elo utilizável é "Nome Filial",
-- que casa com contratos.nome em 2.263 dos 2.411 (94%).
--
-- Esta tabela cobre o resto — os casos em que a mesma coisa está escrita
-- diferente nas duas pontas. NÃO é bloqueio: a busca é global, e o contrato
-- serve só para mostrar primeiro quem é do contrato do encarregado.
CREATE TABLE IF NOT EXISTS public.sup_empregado_contrato_depara (
  filial_nome text PRIMARY KEY,
  contrato_id uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  motivo      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sup_empregado_contrato_depara ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_depara_select ON public.sup_empregado_contrato_depara;
CREATE POLICY sup_depara_select ON public.sup_empregado_contrato_depara
  FOR SELECT TO authenticated USING (true);

-- Só os três pares confirmados. Os demais divergentes (BENTO GONÇALVES
-- 029/2025, FUNARBE PELOTAS, TRIUNFO MOTORISTAS, TRIUNFO OP. MÁQUINA) e as
-- filiais órfãs (VERANÓPOLIS RECEP EMERGENCIAL, LIMPEZA FURG) ficam de fora
-- de propósito: sem confirmação do RH, adivinhar aqui é pior que não ligar.
INSERT INTO public.sup_empregado_contrato_depara (filial_nome, contrato_id, motivo)
SELECT x.filial, ct.id, x.motivo
  FROM (VALUES
    ('UFRGS DIGITADORES 014.2026', 'UFRGS DIGITADORES - XXX/2026', 'numero do contrato ainda XXX no cadastro'),
    ('ESCOLA CANAÃ',               'CANAA',                        'catalogo usa o nome curto, sem acento'),
    ('UFFS CHAPECO - 041/2021',    'UFFS - 041/2021',              'catalogo omite o campus')
  ) AS x(filial, contrato_nome, motivo)
  JOIN public.contratos ct ON sup_norm_nome(ct.nome) = sup_norm_nome(x.contrato_nome)
ON CONFLICT (filial_nome) DO NOTHING;

-- ── 4. A busca ───────────────────────────────────────────────────────
--
-- Devolve NO MÁXIMO 30 linhas. A lista inteira tem 2.411 pessoas; mandar
-- isso para o navegador é o que trava a tela, não a consulta.
CREATE OR REPLACE FUNCTION public.sup_ext_colaboradores(
  p_busca       text DEFAULT NULL,
  p_contrato_id uuid DEFAULT NULL,
  p_limite      int  DEFAULT 20)
RETURNS TABLE (
  empregado_id    bigint,
  nome            text,
  matricula       text,
  contrato_nome   text,
  do_meu_contrato boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_lim    int  := least(greatest(coalesce(p_limite, 20), 1), 30);
  v_termos text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;

  -- Encarregado externo com sessão viva, OU usuário interno com permissão.
  IF NOT EXISTS (SELECT 1 FROM public.sup_ext_sessao s WHERE s.user_id = v_uid)
     AND NOT (public.can_access(v_uid, 'encarregados_solicitar_materiais', 'visualizar')
           OR public.can_access(v_uid, 'sup_pedidos_materiais', 'visualizar')) THEN
    RAISE EXCEPTION 'Sem permissão para consultar colaboradores' USING ERRCODE = '42501';
  END IF;

  -- Cada palavra digitada vira um filtro que TODOS precisam bater, então
  -- "jose avila" acha "JOSE DA CONCEICAO AVILA".
  v_termos := string_to_array(public.sup_norm_busca(coalesce(p_busca, '')), ' ');
  v_termos := array_remove(v_termos, '');

  RETURN QUERY
  WITH base AS (
    SELECT e."ID"::bigint          AS empregado_id,
           e."Nome"                AS nome,
           nullif(btrim(e."Cadastro"::text), '') AS matricula,
           COALESCE(dp.contrato_id, ct.id)       AS contrato_id,
           COALESCE(ctd.nome, ct.nome)           AS contrato_nome
      FROM public."EMPREGADOS" e
      LEFT JOIN public.contratos ct
             ON sup_norm_nome(ct.nome) = sup_norm_nome(e."Nome Filial")
      LEFT JOIN public.sup_empregado_contrato_depara dp
             ON dp.filial_nome = e."Nome Filial"
      LEFT JOIN public.contratos ctd ON ctd.id = dp.contrato_id
     WHERE e."Situação" <> 'Demitido'
       AND COALESCE(btrim(e."Nome"), '') <> ''
       AND (
            -- sem termo: só quem é do contrato do encarregado
            (cardinality(v_termos) = 0 AND p_contrato_id IS NOT NULL
              AND COALESCE(dp.contrato_id, ct.id) = p_contrato_id)
            OR
            -- com termo: busca global, uma condição por palavra
            (cardinality(v_termos) > 0 AND NOT EXISTS (
               SELECT 1 FROM unnest(v_termos) t
                WHERE public.sup_norm_busca(e."Nome") NOT LIKE '%' || t || '%'))
           )
  )
  -- COALESCE porque quem não tem filial casada fica com contrato_id NULL, e
  -- `true AND NULL` é NULL, não false — o cliente receberia null e o
  -- agrupamento "do seu contrato" quebraria.
  SELECT b.empregado_id, b.nome, b.matricula, b.contrato_nome,
         COALESCE(b.contrato_id = p_contrato_id, false) AS do_meu_contrato
    FROM base b
   ORDER BY COALESCE(b.contrato_id = p_contrato_id, false) DESC, b.nome
   LIMIT v_lim;
END $$;

REVOKE ALL ON FUNCTION public.sup_ext_colaboradores(text, uuid, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.sup_ext_colaboradores(text, uuid, int) TO authenticated;

-- ── 5. O pedido guarda QUEM é a pessoa ───────────────────────────────
ALTER TABLE public.sup_pedido
  ADD COLUMN IF NOT EXISTS colaborador_empregado_id bigint,
  ADD COLUMN IF NOT EXISTS colaborador_digitado boolean NOT NULL DEFAULT false;

-- Admissão não tem matrícula: a pessoa ainda não está na folha.
ALTER TABLE public.sup_pedido ALTER COLUMN matricula_colaborador DROP NOT NULL;

COMMENT ON COLUMN public.sup_pedido.colaborador_empregado_id IS
  'EMPREGADOS."ID" do colaborador escolhido na lista. NULL quando o nome foi digitado (admissão).';
COMMENT ON COLUMN public.sup_pedido.colaborador_digitado IS
  'true = nome digitado à mão (admissão). O Supply confere esses contra o RH.';

-- ── 6. Criar pedido: identidade do colaborador vem do banco ──────────
CREATE OR REPLACE FUNCTION public.sup_ext_criar_pedido(p_payload jsonb)
RETURNS sup_pedido LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_contrato  uuid := (p_payload->>'contrato_id')::uuid;
  v_posto     uuid := (p_payload->>'posto_id')::uuid;
  v_funcao    uuid := (p_payload->>'funcao_id')::uuid;
  v_tipo      text := coalesce(p_payload->>'tipo_pedido', 'uniforme');
  v_admissao  boolean := coalesce((p_payload->>'admissao')::boolean, false);
  v_colab_id  bigint := nullif(p_payload->>'colaborador_empregado_id', '')::bigint;
  v_ses       record;
  v_login     text;
  v_nome      text;
  v_origem    text;
  v_emp_id    bigint;
  v_emp_cpf   text;
  v_empresa   uuid;
  v_cnome     text;
  v_pnome     text;
  v_fnome     text;
  v_col_nome  text;
  v_col_matr  text;
  v_digitado  boolean := false;
  v_itens     jsonb := coalesce(p_payload->'itens', '[]'::jsonb);
  v_ped       public.sup_pedido;
  it          jsonb;
  v_idx       int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.sup_ext_pode_ver_contrato(v_contrato) THEN
    RAISE EXCEPTION 'Sem acesso a este contrato';
  END IF;
  IF jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um item';
  END IF;

  SELECT c.empresa_id, c.nome, p.nome, f.nome
    INTO v_empresa, v_cnome, v_pnome, v_fnome
    FROM public.contratos c
    JOIN public.sup_posto  p ON p.id = v_posto  AND p.contrato_id = c.id
    JOIN public.sup_funcao f ON f.id = v_funcao AND f.posto_id    = p.id
   WHERE c.id = v_contrato
     AND p.aprovado AND p.ativo AND f.aprovado AND f.ativo;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Posto ou função não pertence a este contrato (ou não está aprovado)';
  END IF;

  SELECT * INTO v_ses FROM public.sup_ext_sessao s WHERE s.user_id = v_uid;
  IF v_ses.user_id IS NOT NULL THEN
    -- Externo: identidade vem do cadastro, nunca do que o cliente mandou.
    v_origem  := 'externo';
    v_emp_id  := v_ses.empregado_id;
    v_emp_cpf := v_ses.empregado_cpf;
    v_nome    := coalesce(v_ses.empregado_nome, v_ses.login_informado);
    v_login   := upper(coalesce(v_ses.empregado_nome, v_ses.login_informado));
  ELSE
    v_origem := 'interno';
    SELECT pr.display_name INTO v_nome FROM public.profiles pr WHERE pr.id = v_uid;
    v_login  := upper(coalesce(v_nome, 'INTERNO'));
  END IF;

  -- ── QUEM vai receber o material ──
  -- Mesma regra do solicitante: escolheu da lista, o nome e a matrícula vêm
  -- do cadastro. O que o cliente mandou nesses campos é IGNORADO — é assim
  -- que se garante que não dá para inventar colaborador.
  IF v_colab_id IS NOT NULL THEN
    SELECT e."Nome", nullif(btrim(e."Cadastro"::text), '')
      INTO v_col_nome, v_col_matr
      FROM public."EMPREGADOS" e
     WHERE e."ID" = v_colab_id AND e."Situação" <> 'Demitido';
    IF v_col_nome IS NULL THEN
      RAISE EXCEPTION 'Colaborador não encontrado ou desligado';
    END IF;
  ELSIF v_admissao THEN
    -- Admissão é a ÚNICA porta para texto livre: a pessoa ainda não existe
    -- na folha, então não há o que escolher.
    v_col_nome := nullif(btrim(p_payload->>'nome_colaborador'), '');
    v_col_matr := NULL;
    v_digitado := true;
    IF v_col_nome IS NULL THEN
      RAISE EXCEPTION 'Informe o nome do novo colaborador';
    END IF;
  ELSIF v_tipo <> 'insumos' THEN
    RAISE EXCEPTION 'Escolha o colaborador na lista, ou marque "É admissão"';
  END IF;

  INSERT INTO public.sup_pedido (
    empresa_id, contrato_id, posto_id, funcao_id,
    contrato_nome, posto_nome, funcao_nome,
    criado_por, solicitante_login, solicitante_nome, origem,
    solicitante_empregado_id, solicitante_cpf,
    nome_colaborador, matricula_colaborador,
    colaborador_empregado_id, colaborador_digitado,
    admissao, tipo_admissao, data_admissao, imagem_cracha_path,
    tipo_pedido, observacoes_solicitante
  ) VALUES (
    v_empresa, v_contrato, v_posto, v_funcao,
    v_cnome, v_pnome, v_fnome,
    v_uid, v_login, v_nome, v_origem,
    v_emp_id, v_emp_cpf,
    coalesce(v_col_nome, ''), v_col_matr,
    v_colab_id, v_digitado,
    v_admissao,
    nullif(p_payload->>'tipo_admissao', ''),
    nullif(p_payload->>'data_admissao', '')::date,
    nullif(p_payload->>'imagem_cracha_path', ''),
    v_tipo,
    nullif(p_payload->>'observacoes_solicitante', '')
  ) RETURNING * INTO v_ped;

  FOR it IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_idx := v_idx + 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.sup_funcao_item fi
       WHERE fi.funcao_id = v_funcao
         AND fi.item_id   = (it->>'item_id')::uuid
         AND fi.aprovado AND fi.ativo
    ) THEN
      RAISE EXCEPTION 'Item % não pertence a esta função', coalesce(it->>'nome_item', it->>'item_id');
    END IF;

    INSERT INTO public.sup_pedido_item
      (pedido_id, item_id, nome_item, tipo_item, tamanho, quantidade, litros, ordem)
    SELECT v_ped.id, i.id, i.nome, i.tipo,
           nullif(it->>'tamanho', ''),
           greatest(coalesce((it->>'quantidade')::int, 1), 1),
           nullif(it->>'litros', ''),
           v_idx
      FROM public.sup_item i
     WHERE i.id = (it->>'item_id')::uuid;
  END LOOP;

  INSERT INTO public.sup_pedido_historico
    (pedido_id, acao, status_novo, observacao, alterado_por, alterado_por_nome)
  VALUES (v_ped.id, 'CRIADO', v_ped.status, 'Pedido criado', v_uid, v_nome);

  RETURN v_ped;
END $$;

-- ── 7. Conferência ───────────────────────────────────────────────────
SELECT count(*) AS pares_no_depara FROM public.sup_empregado_contrato_depara;

SELECT count(*) AS ativos,
       count(*) FILTER (WHERE public.sup_norm_busca("Nome") LIKE '%SILVA%') AS com_silva
  FROM public."EMPREGADOS" WHERE "Situação" <> 'Demitido';

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.sup_ext_colaboradores(text, uuid, int);
--   DROP TABLE IF EXISTS public.sup_empregado_contrato_depara;
--   DROP INDEX IF EXISTS public.empregados_nome_busca_trgm;
--   DROP FUNCTION IF EXISTS public.sup_norm_busca(text);
--   ALTER TABLE public.sup_pedido DROP COLUMN colaborador_empregado_id,
--                                 DROP COLUMN colaborador_digitado;
--   -- e recriar sup_ext_criar_pedido da 20260822000001
-- =====================================================================
