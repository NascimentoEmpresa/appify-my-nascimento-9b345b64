-- =========================================================================
-- QUADRO DE POSTOS DO CONTRATO — e a vaga que nasce dele.
--
-- O problema: ganhamos uma licitação, assinamos um contrato que exige 30
-- pessoas, e daí em diante a informação de QUEM são essas 30 pessoas vivia
-- fora do ERP. O contrato em `contratos` só guardava o total
-- (`quant_func_estipulado`), e o Recrutamento recebia as 30 vagas uma a uma,
-- digitadas à mão pelo encarregado, cada uma com salário, escala e benefício
-- redigitados — que é exatamente onde a informação diverge do contrato.
--
-- Agora o contrato declara o quadro: posto 1 = 10 jardineiros, posto 2 = 10
-- vigilantes, posto 3 = 10 auxiliares administrativos. Desse quadro saem as
-- 30 solicitações de vaga, JÁ com salário, benefício, escala, local e
-- requisitos — e elas seguem o fluxo normal (Pendente Analista → Recrutamento
-- → ...), sem atalho nenhum.
--
-- -------------------------------------------------------------------------
-- POR QUE UMA TABELA NOVA, E NÃO sup_posto
-- -------------------------------------------------------------------------
-- A pergunta óbvia é: por que o quadro não escreve direto em `sup_posto`, se
-- é lá que o posto do contrato mora? Porque desde a migration
-- 20260930000081 sup_posto NÃO É MAIS CADASTRO — é ESPELHO da Planilha de
-- Custo. Aquela migration removeu a policy de escrita (`sup_posto_write`) de
-- propósito, com o motivo escrito: posto cadastrado à mão criava um segundo
-- lugar da verdade, e o Suprimentos passava a enxergar posto que a planilha
-- não tem. Pior: o passo (c) da `sup_cat_postos_do_contrato` DESATIVA todo
-- posto que não está na planilha e não tem função pendurada. Um posto criado
-- aqui à mão sumiria sozinho na primeira vez que alguém abrisse o Catálogo
-- de Materiais daquele contrato.
--
-- E o contrato precisa declarar posto ANTES da planilha existir: contrato
-- recém-ganho normalmente ainda não teve a Planilha de Custo importada, e é
-- justamente aí que as vagas precisam abrir.
--
-- Então: `CONTRATO_QUADRO_POSTO` é a declaração do contrato (o que foi
-- assinado), `planilha_custo` continua sendo a declaração de custo, e
-- `sup_posto` continua sendo o espelho que as duas alimentam. A parte 4
-- desta migration ensina a `sup_cat_postos_do_contrato` a tratar o posto do
-- quadro como legítimo — senão ele cairia no passo (c) e seria desativado,
-- que é o bug que este comentário existe para evitar que alguém reintroduza.
--
-- -------------------------------------------------------------------------
-- UMA LINHA DE VAGA POR PESSOA
-- -------------------------------------------------------------------------
-- 10 jardineiros viram 10 linhas em SISTEMA_RECRUTAMENTO, não uma linha com
-- quantidade_vagas = 10. Não é preferência: a tabela rastreia UM candidato
-- por linha (etapa_processo, selecionado_por, contratado_nome, empregado_id,
-- admitido_em são todos singulares). Uma linha com quantidade 10 só
-- conseguiria acompanhar a admissão de uma pessoa — as outras nove ficariam
-- sem etapa, sem ASO e sem enxoval.
--
-- `quadro_posto_id` + `quadro_indice` (1..N) amarram a vaga à linha do quadro
-- e tornam a geração REPETÍVEL: gerar de novo só preenche o índice que falta.
-- Aumentar o quadro de 10 para 12 cria as vagas 11 e 12 e não mexe nas dez
-- que já estão em processo. Diminuir NÃO apaga vaga nenhuma — vaga em
-- andamento é gente em entrevista; quem quiser cancelar cancela na tela do
-- Recrutamento, com motivo.
--
-- -------------------------------------------------------------------------
-- O PRAZO DE 7 DIAS ÚTEIS VALE AQUI TAMBÉM
-- -------------------------------------------------------------------------
-- `sistema_recrutamento_guard` (20260903000001) recusa INSERT de vaga com
-- menos de 7 dias úteis de antecedência, e esta RPC roda como o usuário
-- (SECURITY DEFINER não muda `auth.role()`), então a regra se aplica. A
-- geração confere o prazo ANTES de inserir e diz qual posto está fora — sem
-- isso o erro chegaria na 27ª vaga, depois de 26 criadas, e a mensagem do
-- guard não diria de qual posto era.
--
-- Idempotente. Aplicar no banco do app (SQL Editor do projeto remoto).
-- =========================================================================

-- ── 1. O quadro ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."CONTRATO_QUADRO_POSTO" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id  uuid NOT NULL REFERENCES public.contratos(id) ON DELETE CASCADE,
  empresa_id   uuid NOT NULL REFERENCES public.empresas(id)  ON DELETE CASCADE,

  -- O posto como o contrato o chama. É texto, e não só o FK para sup_posto,
  -- porque o quadro pode declarar posto que a Planilha de Custo ainda não
  -- tem (contrato novo, planilha não importada). `sup_posto_id` é o espelho
  -- quando ele existe — preenchido pela RPC de salvar, nunca digitado.
  posto_nome   text NOT NULL,
  sup_posto_id uuid REFERENCES public.sup_posto(id) ON DELETE SET NULL,

  -- O que o Recrutamento precisa para contratar. Os NOT NULL aqui são a
  -- razão de a tela ter um card de obrigatórios: vaga que chega sem salário
  -- ou sem escala volta para o encarregado e perde uma semana.
  cargo        text NOT NULL,
  quantidade   int  NOT NULL CHECK (quantidade > 0 AND quantidade <= 999),
  escala       text NOT NULL,
  horario      text,
  salario      numeric(14,2) NOT NULL CHECK (salario >= 0),

  insalubridade_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (insalubridade_pct BETWEEN 0 AND 100),
  periculosidade_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (periculosidade_pct BETWEEN 0 AND 100),
  -- Texto e não colunas de VT/VA: é o mesmo formato que a vaga já usa em
  -- `beneficios` ("VT R$ 126,28/mês · VA R$ 461,82/mês"), montado por
  -- beneficiosDoCusto() a partir da Planilha de Custo. Quebrar em colunas
  -- aqui exigiria remontar a frase na hora de gerar a vaga, com outro
  -- formato, e as duas telas mostrariam benefício diferente.
  beneficios   text,

  estado       text NOT NULL CHECK (char_length(estado) = 2),
  cidade       text NOT NULL,
  local_exato  text NOT NULL,

  -- Data prevista de início das contratações deste posto. NOT NULL porque o
  -- guard da vaga exige (>= 7 dias úteis) e sem ela não há vaga.
  data_inicio_prevista date NOT NULL,

  motivo_vaga  text NOT NULL DEFAULT 'Admissão',
  req_obrigatorios text,
  req_desejaveis   text,
  exp_minima       text NOT NULL DEFAULT 'Não',
  exp_minima_qual  text,
  observacao       text,

  -- Posto que existe no contrato mas NÃO abre vaga agora (já coberto por
  -- remanejamento, ou entra numa fase posterior da implantação). Continua no
  -- quadro — o quadro é o contrato, não a fila do Recrutamento.
  gerar_vagas  boolean NOT NULL DEFAULT true,

  ordem        int NOT NULL DEFAULT 0,
  ativo        boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Dois postos com o mesmo nome no mesmo contrato são o mesmo posto. Se a
  -- operação precisa de dois blocos de jardineiro com escalas diferentes,
  -- eles são postos diferentes e merecem nomes diferentes — senão ninguém
  -- sabe qual dos dois a vaga #412 está repondo.
  UNIQUE (contrato_id, posto_nome)
);

CREATE INDEX IF NOT EXISTS idx_cqp_contrato ON public."CONTRATO_QUADRO_POSTO"(contrato_id, ordem);
CREATE INDEX IF NOT EXISTS idx_cqp_sup_posto ON public."CONTRATO_QUADRO_POSTO"(sup_posto_id);

COMMENT ON TABLE public."CONTRATO_QUADRO_POSTO" IS
  'Quadro de pessoal declarado pelo contrato: posto → cargo → quantidade, com salário, escala, benefícios e local. É a origem das solicitações de vaga do contrato (ver contrato_quadro_gerar_vagas). Não confundir com sup_posto, que é espelho da Planilha de Custo.';

DROP TRIGGER IF EXISTS trg_cqp_updated ON public."CONTRATO_QUADRO_POSTO";
CREATE TRIGGER trg_cqp_updated
  BEFORE UPDATE ON public."CONTRATO_QUADRO_POSTO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. Acesso ───────────────────────────────────────────────────────────
--
-- Menu fantasma (rota NULL) no módulo Licitações: o quadro é um BLOCO dentro
-- da tela Contratos, não uma página. Quem já tem o perfil espelho do módulo
-- Licitações ganha o bloco automaticamente (o perfil de módulo cobre menu
-- criado depois) — o admin pode desligar para quem não deve mexer no quadro.

INSERT INTO public.app_menu (codigo, nome, rota, modulo_id, ativo, ordem)
SELECT
  'contrato_quadro_postos',
  'Contratos · Quadro de Postos',
  NULL,
  m.id,
  true,
  (SELECT COALESCE(MAX(ordem), 0) + 1 FROM public.app_menu WHERE modulo_id = m.id)
FROM public.app_modulo m
WHERE m.codigo = 'licitacoes'
LIMIT 1
ON CONFLICT (modulo_id, codigo) DO UPDATE
  SET nome = EXCLUDED.nome, ativo = true;

INSERT INTO public.app_menu_acao (menu_codigo, acao) VALUES
  ('contrato_quadro_postos', 'incluir'),
  ('contrato_quadro_postos', 'alterar'),
  ('contrato_quadro_postos', 'excluir')
ON CONFLICT DO NOTHING;

ALTER TABLE public."CONTRATO_QUADRO_POSTO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public."CONTRATO_QUADRO_POSTO" TO authenticated;

-- Leitura pelo acesso por usuário. Escrita NÃO tem policy de propósito: o
-- quadro só é alterado pelas RPCs abaixo, que validam o conjunto inteiro
-- (nome de posto repetido, prazo, espelho em sup_posto). Um INSERT solto pela
-- API criaria linha sem sup_posto_id e sem validação de prazo, e a vaga
-- estouraria depois, longe de quem digitou.
DROP POLICY IF EXISTS cqp_select ON public."CONTRATO_QUADRO_POSTO";
CREATE POLICY cqp_select ON public."CONTRATO_QUADRO_POSTO"
  FOR SELECT TO authenticated
  USING (public.has_screen_access(auth.uid(), 'contrato_quadro_postos', 'visualizar'));

-- ── 3. Amarração da vaga com a linha do quadro ──────────────────────────

ALTER TABLE public."SISTEMA_RECRUTAMENTO"
  ADD COLUMN IF NOT EXISTS quadro_posto_id uuid REFERENCES public."CONTRATO_QUADRO_POSTO"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quadro_indice   int;

-- O par (linha do quadro, índice) é único: é ele que torna a geração
-- repetível sem duplicar vaga. Parcial porque a esmagadora maioria das vagas
-- não vem de quadro nenhum (encarregado, substituição, demissão).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sr_quadro_indice
  ON public."SISTEMA_RECRUTAMENTO"(quadro_posto_id, quadro_indice)
  WHERE quadro_posto_id IS NOT NULL;

COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".quadro_posto_id IS
  'Linha do quadro de postos do contrato que originou esta vaga (CONTRATO_QUADRO_POSTO). NULL nas vagas abertas à mão.';
COMMENT ON COLUMN public."SISTEMA_RECRUTAMENTO".quadro_indice IS
  'Qual das N vagas daquele posto esta é (1..quantidade). Com quadro_posto_id forma a chave que impede gerar a mesma vaga duas vezes.';

-- ── 4. O posto do quadro não pode ser desativado pelo espelho ───────────
--
-- Reescreve sup_cat_postos_do_contrato juntando ao conjunto "postos
-- legítimos" os nomes declarados no quadro do contrato. Sem isto, o passo
-- (c) — que desativa posto fora da planilha e sem função — apagaria da lista
-- todo posto criado aqui, e a vaga gerada apontaria para posto invisível no
-- Catálogo de Materiais (uniforme e EPI da admissão sairiam vazios).
--
-- O resto da função é o da migration 20260930000081, sem alteração de
-- comportamento: os comentários originais de cada passo valem igual.
CREATE OR REPLACE FUNCTION public.sup_cat_postos_do_contrato(p_contrato_id uuid)
RETURNS TABLE (
  id          uuid,
  contrato_id uuid,
  nome        text,
  ativo       boolean,
  aprovado    boolean,
  na_planilha boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
#variable_conflict use_column
DECLARE
  v_empresa   uuid;
  v_contrato  text;
  v_nomes     text[];   -- nomes de posto como a planilha escreveu
  v_norm      text[];   -- os mesmos, normalizados, para casar sem acento/caixa
  v_quadro    text[];   -- nomes normalizados que o QUADRO do contrato declara
  v_vivos     text[];   -- planilha + quadro: o que não pode ser desativado
BEGIN
  IF NOT public.can_access(auth.uid(), 'sup_catalogo', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para o Catálogo de Materiais.';
  END IF;

  SELECT c.empresa_id, c.nome INTO v_empresa, v_contrato
    FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(p.nome), array_agg(public.sup_norm_nome(p.nome))
    INTO v_nomes, v_norm
    FROM (
      SELECT DISTINCT btrim(pc.posto) AS nome
        FROM public.planilha_custo pc
       WHERE btrim(coalesce(pc.posto, '')) <> ''
         AND (pc.contrato_id = p_contrato_id
              OR (pc.contrato_id IS NULL
                  AND pc.empresa_id = v_empresa
                  AND public.sup_norm_nome(pc.contrato) = public.sup_norm_nome(v_contrato)))
    ) p;

  v_nomes := coalesce(v_nomes, ARRAY[]::text[]);
  v_norm  := coalesce(v_norm,  ARRAY[]::text[]);

  SELECT coalesce(array_agg(public.sup_norm_nome(q.posto_nome)), ARRAY[]::text[])
    INTO v_quadro
    FROM public."CONTRATO_QUADRO_POSTO" q
   WHERE q.contrato_id = p_contrato_id AND q.ativo;

  v_vivos := v_norm || v_quadro;

  -- (a) novos
  INSERT INTO public.sup_posto (empresa_id, contrato_id, nome, ativo, aprovado)
  SELECT v_empresa, p_contrato_id, n, true, true
    FROM unnest(v_nomes) AS n
   WHERE NOT EXISTS (
     SELECT 1 FROM public.sup_posto sp
      WHERE sp.contrato_id = p_contrato_id
        AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(n))
  ON CONFLICT (contrato_id, nome) DO NOTHING;

  -- (b) reativados
  UPDATE public.sup_posto sp
     SET ativo = true, aprovado = true, updated_at = now()
   WHERE sp.contrato_id = p_contrato_id
     AND (sp.ativo IS FALSE OR sp.aprovado IS FALSE)
     AND public.sup_norm_nome(sp.nome) = ANY (v_vivos);

  -- (c) saiu da planilha E não está no quadro E não tem função -- sai da lista
  IF array_length(v_vivos, 1) > 0 THEN
    UPDATE public.sup_posto sp
       SET ativo = false, updated_at = now()
     WHERE sp.contrato_id = p_contrato_id
       AND sp.ativo
       AND NOT (public.sup_norm_nome(sp.nome) = ANY (v_vivos))
       AND NOT EXISTS (
         SELECT 1 FROM public.sup_funcao f
          WHERE f.posto_id = sp.id AND f.ativo);
  END IF;

  RETURN QUERY
  SELECT sp.id, sp.contrato_id, sp.nome, sp.ativo, sp.aprovado,
         (public.sup_norm_nome(sp.nome) = ANY (v_norm)) AS na_planilha
    FROM public.sup_posto sp
   WHERE sp.contrato_id = p_contrato_id
     AND sp.ativo
   ORDER BY sp.nome;
END $fn$;

REVOKE ALL ON FUNCTION public.sup_cat_postos_do_contrato(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sup_cat_postos_do_contrato(uuid) TO authenticated;

-- ── 4b. Salário e percentual no formato que a VAGA usa ──────────────────
--
-- A vaga guarda salário como TEXTO em pt-BR ("R$ 1.412,00") — é o que a tela
-- escreve (ModalNovaVaga.tsx) e o que `salarioNumero()` sabe ler
-- (src/lib/recrutamento/custoPosto.ts: tira "R$ ", remove os PONTOS e troca a
-- VÍRGULA por ponto).
--
-- Isso torna o formato uma regra, não estética: gravar "1412.00" aqui faria
-- salarioNumero() remover o ponto e ler CENTO E QUARENTA E UM MIL. E é por
-- isso que estes dois helpers não usam `G`/`D` do to_char — esses dois
-- dependem do lc_numeric do servidor (en_US no Supabase), que devolve
-- "1,412.00". Grupo e decimal ficam escritos à mão, sem locale no caminho.
CREATE OR REPLACE FUNCTION public.rec_brl_txt(_v numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _v IS NULL THEN NULL ELSE
    'R$ ' ||
    regexp_replace(split_part(to_char(round(_v, 2), 'FM999999999990.00'), '.', 1),
                   '(\d)(?=(\d{3})+$)', '\1.', 'g') ||
    ',' || split_part(to_char(round(_v, 2), 'FM999999999990.00'), '.', 2)
  END;
$$;

-- "40" / "20,5" — sem zero à toa e com vírgula decimal, como a vaga mostra.
CREATE OR REPLACE FUNCTION public.rec_pct_txt(_v numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(_v, 0) <= 0 THEN '' ELSE
    replace(rtrim(rtrim(to_char(round(_v, 2), 'FM999990.00'), '0'), '.'), '.', ',') || '%'
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.rec_brl_txt(numeric), public.rec_pct_txt(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_brl_txt(numeric), public.rec_pct_txt(numeric) TO authenticated;

-- ── 5. Ler o quadro ─────────────────────────────────────────────────────
--
-- Traz junto quantas vagas já foram geradas por linha. É a informação que a
-- tela precisa para dizer "10 de 10 geradas" ou "faltam 2", e ela não sai de
-- um SELECT na tabela do quadro sozinho.
CREATE OR REPLACE FUNCTION public.contrato_quadro_listar(p_contrato_id uuid)
RETURNS TABLE (
  id uuid, contrato_id uuid, posto_nome text, sup_posto_id uuid,
  cargo text, quantidade int, escala text, horario text, salario numeric,
  insalubridade_pct numeric, periculosidade_pct numeric, beneficios text,
  estado text, cidade text, local_exato text, data_inicio_prevista date,
  motivo_vaga text, req_obrigatorios text, req_desejaveis text,
  exp_minima text, exp_minima_qual text, observacao text,
  gerar_vagas boolean, ordem int,
  vagas_geradas int, vagas_vivas int, na_planilha boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'visualizar') THEN
    RAISE EXCEPTION 'Sem permissão para ver o quadro de postos do contrato.';
  END IF;

  RETURN QUERY
  SELECT q.id, q.contrato_id, q.posto_nome, q.sup_posto_id,
         q.cargo, q.quantidade, q.escala, q.horario, q.salario,
         q.insalubridade_pct, q.periculosidade_pct, q.beneficios,
         q.estado, q.cidade, q.local_exato, q.data_inicio_prevista,
         q.motivo_vaga, q.req_obrigatorios, q.req_desejaveis,
         q.exp_minima, q.exp_minima_qual, q.observacao,
         q.gerar_vagas, q.ordem,
         (SELECT count(*)::int FROM public."SISTEMA_RECRUTAMENTO" v
           WHERE v.quadro_posto_id = q.id),
         -- "Vivas" = as que ainda contam como reposição do posto. Reprovada e
         -- Cancelada não contam, mesma régua de vagaSeguraSubstituido() no
         -- front (src/lib/recrutamento/vagaRegras.ts).
         (SELECT count(*)::int FROM public."SISTEMA_RECRUTAMENTO" v
           WHERE v.quadro_posto_id = q.id
             AND btrim(coalesce(v.status, '')) NOT IN ('Reprovada', 'Cancelada')),
         EXISTS (
           SELECT 1 FROM public.planilha_custo pc
            WHERE btrim(coalesce(pc.posto, '')) <> ''
              AND public.sup_norm_nome(pc.posto) = public.sup_norm_nome(q.posto_nome)
              AND (pc.contrato_id = q.contrato_id
                   OR (pc.contrato_id IS NULL AND pc.empresa_id = q.empresa_id)))
    FROM public."CONTRATO_QUADRO_POSTO" q
   WHERE q.contrato_id = p_contrato_id AND q.ativo
   ORDER BY q.ordem, q.posto_nome;
END $fn$;

REVOKE ALL ON FUNCTION public.contrato_quadro_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_listar(uuid) TO authenticated;

-- ── 6. Salvar o quadro ──────────────────────────────────────────────────
--
-- Recebe o quadro INTEIRO (jsonb array) e o aplica de uma vez: insere o que
-- é novo, atualiza o que mudou, desativa o que sumiu. O conjunto inteiro num
-- round-trip, e não uma RPC por linha, porque "nome de posto repetido" só se
-- responde olhando as linhas juntas.
--
-- Cada linha pode trazer `id` (linha existente) ou não (nova). `posto_nome`
-- é a identidade de negócio: mudar o nome de uma linha existente RENOMEIA o
-- posto — e leva o espelho em sup_posto junto, senão a vaga velha apontaria
-- para um nome que não existe mais.
CREATE OR REPLACE FUNCTION public.contrato_quadro_salvar(
  p_contrato_id uuid,
  p_linhas      jsonb
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_empresa  uuid;
  v_linha    jsonb;
  v_ids      uuid[] := ARRAY[]::uuid[];
  v_id       uuid;
  v_nome     text;
  v_sup      uuid;
  v_nomes    text[] := ARRAY[]::text[];
  v_n        int := 0;
BEGIN
  IF NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'alterar')
     AND NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para alterar o quadro de postos do contrato.';
  END IF;

  SELECT c.empresa_id INTO v_empresa FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  IF jsonb_typeof(coalesce(p_linhas, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'O quadro precisa ser uma lista de postos.';
  END IF;

  FOR v_linha IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_n := v_n + 1;
    v_nome := btrim(coalesce(v_linha->>'posto_nome', ''));

    IF v_nome = '' THEN
      RAISE EXCEPTION 'Posto nº %: informe o nome do posto.', v_n;
    END IF;
    IF btrim(coalesce(v_linha->>'cargo', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%": informe o cargo.', v_nome;
    END IF;
    IF coalesce((v_linha->>'quantidade')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'Posto "%": a quantidade de colaboradores precisa ser 1 ou mais.', v_nome;
    END IF;
    IF btrim(coalesce(v_linha->>'escala', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%": informe a escala.', v_nome;
    END IF;
    IF coalesce((v_linha->>'salario')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'Posto "%": informe o salário.', v_nome;
    END IF;
    IF btrim(coalesce(v_linha->>'local_exato', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%": informe o local exato de trabalho.', v_nome;
    END IF;
    IF btrim(coalesce(v_linha->>'cidade', '')) = '' OR btrim(coalesce(v_linha->>'estado', '')) = '' THEN
      RAISE EXCEPTION 'Posto "%": informe estado e cidade.', v_nome;
    END IF;
    IF (v_linha->>'data_inicio_prevista') IS NULL THEN
      RAISE EXCEPTION 'Posto "%": informe a data prevista de início.', v_nome;
    END IF;

    -- Repetido dentro do próprio envio. O UNIQUE da tabela pegaria isso, mas
    -- com a mensagem do Postgres ("duplicate key value violates...") em vez
    -- do nome do posto que a pessoa digitou duas vezes.
    IF public.sup_norm_nome(v_nome) = ANY (v_nomes) THEN
      RAISE EXCEPTION 'O posto "%" aparece duas vezes no quadro. Cada posto entra uma vez só — se são dois blocos diferentes, dê nomes diferentes.', v_nome;
    END IF;
    v_nomes := v_nomes || public.sup_norm_nome(v_nome);

    -- Espelho em sup_posto. Escrita direta (a RPC é SECURITY DEFINER, e a
    -- policy de escrita de sup_posto não existe desde a 20260930000081) —
    -- nasce aprovado porque o que se aprovou foi o CONTRATO, lá atrás; posto
    -- do quadro não passa pelo lote de aprovação do Catálogo.
    SELECT sp.id INTO v_sup FROM public.sup_posto sp
     WHERE sp.contrato_id = p_contrato_id
       AND public.sup_norm_nome(sp.nome) = public.sup_norm_nome(v_nome)
     LIMIT 1;

    IF v_sup IS NULL THEN
      INSERT INTO public.sup_posto (empresa_id, contrato_id, nome, ativo, aprovado, created_by)
      VALUES (v_empresa, p_contrato_id, v_nome, true, true, auth.uid())
      ON CONFLICT (contrato_id, nome) DO UPDATE SET ativo = true, aprovado = true
      RETURNING id INTO v_sup;
    ELSE
      UPDATE public.sup_posto SET ativo = true, aprovado = true, updated_at = now()
       WHERE id = v_sup;
    END IF;

    v_id := NULLIF(btrim(coalesce(v_linha->>'id', '')), '')::uuid;

    IF v_id IS NULL THEN
      INSERT INTO public."CONTRATO_QUADRO_POSTO" (
        contrato_id, empresa_id, posto_nome, sup_posto_id, cargo, quantidade,
        escala, horario, salario, insalubridade_pct, periculosidade_pct,
        beneficios, estado, cidade, local_exato, data_inicio_prevista,
        motivo_vaga, req_obrigatorios, req_desejaveis, exp_minima,
        exp_minima_qual, observacao, gerar_vagas, ordem, created_by)
      VALUES (
        p_contrato_id, v_empresa, v_nome, v_sup,
        btrim(v_linha->>'cargo'), (v_linha->>'quantidade')::int,
        btrim(v_linha->>'escala'), NULLIF(btrim(coalesce(v_linha->>'horario', '')), ''),
        (v_linha->>'salario')::numeric,
        coalesce((v_linha->>'insalubridade_pct')::numeric, 0),
        coalesce((v_linha->>'periculosidade_pct')::numeric, 0),
        NULLIF(btrim(coalesce(v_linha->>'beneficios', '')), ''),
        upper(btrim(v_linha->>'estado')), btrim(v_linha->>'cidade'),
        btrim(v_linha->>'local_exato'), (v_linha->>'data_inicio_prevista')::date,
        coalesce(NULLIF(btrim(coalesce(v_linha->>'motivo_vaga', '')), ''), 'Admissão'),
        NULLIF(btrim(coalesce(v_linha->>'req_obrigatorios', '')), ''),
        NULLIF(btrim(coalesce(v_linha->>'req_desejaveis', '')), ''),
        coalesce(NULLIF(btrim(coalesce(v_linha->>'exp_minima', '')), ''), 'Não'),
        NULLIF(btrim(coalesce(v_linha->>'exp_minima_qual', '')), ''),
        NULLIF(btrim(coalesce(v_linha->>'observacao', '')), ''),
        coalesce((v_linha->>'gerar_vagas')::boolean, true),
        v_n, auth.uid())
      -- Reaproveita a linha desativada de mesmo nome em vez de estourar no
      -- UNIQUE: tirar um posto do quadro e recolocá-lo é rotina de
      -- implantação, e a segunda vez não pode falhar.
      ON CONFLICT (contrato_id, posto_nome) DO UPDATE SET
        ativo = true, sup_posto_id = EXCLUDED.sup_posto_id, cargo = EXCLUDED.cargo,
        quantidade = EXCLUDED.quantidade, escala = EXCLUDED.escala,
        horario = EXCLUDED.horario, salario = EXCLUDED.salario,
        insalubridade_pct = EXCLUDED.insalubridade_pct,
        periculosidade_pct = EXCLUDED.periculosidade_pct,
        beneficios = EXCLUDED.beneficios, estado = EXCLUDED.estado,
        cidade = EXCLUDED.cidade, local_exato = EXCLUDED.local_exato,
        data_inicio_prevista = EXCLUDED.data_inicio_prevista,
        motivo_vaga = EXCLUDED.motivo_vaga,
        req_obrigatorios = EXCLUDED.req_obrigatorios,
        req_desejaveis = EXCLUDED.req_desejaveis,
        exp_minima = EXCLUDED.exp_minima, exp_minima_qual = EXCLUDED.exp_minima_qual,
        observacao = EXCLUDED.observacao, gerar_vagas = EXCLUDED.gerar_vagas,
        ordem = EXCLUDED.ordem, updated_at = now()
      RETURNING id INTO v_id;
    ELSE
      UPDATE public."CONTRATO_QUADRO_POSTO" SET
        posto_nome = v_nome, sup_posto_id = v_sup,
        cargo = btrim(v_linha->>'cargo'), quantidade = (v_linha->>'quantidade')::int,
        escala = btrim(v_linha->>'escala'),
        horario = NULLIF(btrim(coalesce(v_linha->>'horario', '')), ''),
        salario = (v_linha->>'salario')::numeric,
        insalubridade_pct = coalesce((v_linha->>'insalubridade_pct')::numeric, 0),
        periculosidade_pct = coalesce((v_linha->>'periculosidade_pct')::numeric, 0),
        beneficios = NULLIF(btrim(coalesce(v_linha->>'beneficios', '')), ''),
        estado = upper(btrim(v_linha->>'estado')), cidade = btrim(v_linha->>'cidade'),
        local_exato = btrim(v_linha->>'local_exato'),
        data_inicio_prevista = (v_linha->>'data_inicio_prevista')::date,
        motivo_vaga = coalesce(NULLIF(btrim(coalesce(v_linha->>'motivo_vaga', '')), ''), 'Admissão'),
        req_obrigatorios = NULLIF(btrim(coalesce(v_linha->>'req_obrigatorios', '')), ''),
        req_desejaveis = NULLIF(btrim(coalesce(v_linha->>'req_desejaveis', '')), ''),
        exp_minima = coalesce(NULLIF(btrim(coalesce(v_linha->>'exp_minima', '')), ''), 'Não'),
        exp_minima_qual = NULLIF(btrim(coalesce(v_linha->>'exp_minima_qual', '')), ''),
        observacao = NULLIF(btrim(coalesce(v_linha->>'observacao', '')), ''),
        gerar_vagas = coalesce((v_linha->>'gerar_vagas')::boolean, true),
        ordem = v_n, ativo = true, updated_at = now()
      WHERE id = v_id AND contrato_id = p_contrato_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Posto "%" não pertence a este contrato.', v_nome;
      END IF;
    END IF;

    v_ids := v_ids || v_id;
  END LOOP;

  -- Some do quadro o que não veio no envio. Desativa em vez de apagar: a vaga
  -- já gerada aponta para a linha (quadro_posto_id), e um DELETE levaria a
  -- rastreabilidade de quem foi contratado para aquele posto.
  UPDATE public."CONTRATO_QUADRO_POSTO"
     SET ativo = false, updated_at = now()
   WHERE contrato_id = p_contrato_id AND ativo AND NOT (id = ANY (v_ids));

  RETURN v_n;
END $fn$;

REVOKE ALL ON FUNCTION public.contrato_quadro_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_salvar(uuid, jsonb) TO authenticated;

-- ── 7. Gerar as vagas ───────────────────────────────────────────────────
--
-- Uma linha em SISTEMA_RECRUTAMENTO por pessoa que falta contratar, com o
-- status inicial do fluxo normal ('Pendente Analista' — o mesmo que
-- statusInicialVaga() devolve para vaga não-administrativa). Daqui em diante
-- a vaga é uma vaga como qualquer outra: analista aprova, Recrutamento toca.
--
-- `p_simular = true` não grava nada e devolve a contagem — é o que a tela usa
-- para dizer "vão ser criadas 30 solicitações" ANTES de criar.
CREATE OR REPLACE FUNCTION public.contrato_quadro_gerar_vagas(
  p_contrato_id uuid,
  p_simular     boolean DEFAULT false
)
RETURNS TABLE (posto_nome text, criadas int, ja_existiam int, primeira_vaga bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_q          record;
  v_contrato   text;
  v_nome_user  text;
  v_email      text;
  v_i          int;
  v_ja         int;
  v_criadas    int;
  v_primeira   bigint;
  v_id         bigint;
  v_dias       int;
  v_insal_txt  text;
BEGIN
  IF NOT public.can_access(auth.uid(), 'contrato_quadro_postos', 'incluir') THEN
    RAISE EXCEPTION 'Sem permissão para abrir as vagas do quadro de postos.';
  END IF;

  SELECT c.nome INTO v_contrato FROM public.contratos c WHERE c.id = p_contrato_id;
  IF v_contrato IS NULL THEN
    RAISE EXCEPTION 'Contrato não encontrado.';
  END IF;

  SELECT coalesce(u.raw_user_meta_data->>'nome', u.email), u.email
    INTO v_nome_user, v_email
    FROM auth.users u WHERE u.id = auth.uid();

  -- Confere o prazo de TODOS os postos antes de gravar qualquer um. O guard
  -- da vaga (sistema_recrutamento_guard) recusaria a inserção do mesmo jeito,
  -- mas no meio do laço: sairiam 12 vagas criadas e um erro que não diz de
  -- qual posto é. Aqui o erro sai antes, com o nome do posto e a data.
  FOR v_q IN
    SELECT q.posto_nome, q.data_inicio_prevista
      FROM public."CONTRATO_QUADRO_POSTO" q
     WHERE q.contrato_id = p_contrato_id AND q.ativo AND q.gerar_vagas
  LOOP
    v_dias := public.dias_uteis_entre(current_date, v_q.data_inicio_prevista);
    IF v_dias < 7 THEN
      RAISE EXCEPTION 'Posto "%": a data prevista de início (%) tem % dia(s) útil(eis) de antecedência. A vaga precisa de no mínimo 7 dias úteis.',
        v_q.posto_nome, to_char(v_q.data_inicio_prevista, 'DD/MM/YYYY'), v_dias;
    END IF;
  END LOOP;

  FOR v_q IN
    SELECT q.* FROM public."CONTRATO_QUADRO_POSTO" q
     WHERE q.contrato_id = p_contrato_id AND q.ativo AND q.gerar_vagas
     ORDER BY q.ordem, q.posto_nome
  LOOP
    SELECT count(*)::int INTO v_ja
      FROM public."SISTEMA_RECRUTAMENTO" v WHERE v.quadro_posto_id = v_q.id;

    v_criadas := 0;
    v_primeira := NULL;

    -- Insalubridade no formato que a vaga já usa ("40%"), o mesmo que
    -- insalubridadeDoCusto() produz com origem 'cadastro'.
    v_insal_txt := public.rec_pct_txt(v_q.insalubridade_pct);

    IF NOT p_simular THEN
      FOR v_i IN 1..v_q.quantidade LOOP
        -- Índice já gerado (geração anterior) — pula. É o que torna repetir
        -- a geração seguro depois de aumentar a quantidade do posto.
        CONTINUE WHEN EXISTS (
          SELECT 1 FROM public."SISTEMA_RECRUTAMENTO" v
           WHERE v.quadro_posto_id = v_q.id AND v.quadro_indice = v_i);

        INSERT INTO public."SISTEMA_RECRUTAMENTO" (
          motivo_vaga, contrato, cargo, estado, cidade,
          quantidade_vagas, data_inicio_prevista, escala, horario, salario,
          insalubridade_recebe, insalubridade_quanto, beneficios, local_exato,
          alta_rotatividade, req_obrigatorios, req_desejaveis,
          exp_minima, exp_minima_qual, observacao_importante,
          status, solicitante_nome, solicitante_cpf,
          contrato_id, posto_id, quadro_posto_id, quadro_indice, administrativa)
        VALUES (
          v_q.motivo_vaga, v_contrato, v_q.cargo, v_q.estado, v_q.cidade,
          1, to_char(v_q.data_inicio_prevista, 'YYYY-MM-DD'),
          v_q.escala, v_q.horario, public.rec_brl_txt(v_q.salario),
          CASE WHEN v_q.insalubridade_pct > 0 THEN 'Sim' ELSE 'Não' END,
          v_insal_txt, v_q.beneficios, v_q.local_exato,
          'Não', v_q.req_obrigatorios, v_q.req_desejaveis,
          v_q.exp_minima, v_q.exp_minima_qual,
          btrim(concat_ws(E'\n',
            format('Vaga %s de %s do posto "%s" — quadro do contrato %s.',
                   v_i, v_q.quantidade, v_q.posto_nome, v_contrato),
            v_q.observacao)),
          'Pendente Analista', v_nome_user, v_email,
          p_contrato_id, v_q.sup_posto_id, v_q.id, v_i, false)
        RETURNING id INTO v_id;

        v_criadas := v_criadas + 1;
        IF v_primeira IS NULL THEN v_primeira := v_id; END IF;
      END LOOP;
    ELSE
      v_criadas := GREATEST(v_q.quantidade - v_ja, 0);
    END IF;

    posto_nome    := v_q.posto_nome;
    criadas       := v_criadas;
    ja_existiam   := v_ja;
    primeira_vaga := v_primeira;
    RETURN NEXT;
  END LOOP;
END $fn$;

REVOKE ALL ON FUNCTION public.contrato_quadro_gerar_vagas(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contrato_quadro_gerar_vagas(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.contrato_quadro_gerar_vagas(uuid, boolean);
--   DROP FUNCTION IF EXISTS public.contrato_quadro_salvar(uuid, jsonb);
--   DROP FUNCTION IF EXISTS public.contrato_quadro_listar(uuid);
--   DROP FUNCTION IF EXISTS public.rec_brl_txt(numeric), public.rec_pct_txt(numeric);
--   DROP INDEX IF EXISTS public.uq_sr_quadro_indice;
--   ALTER TABLE public."SISTEMA_RECRUTAMENTO"
--     DROP COLUMN IF EXISTS quadro_posto_id,
--     DROP COLUMN IF EXISTS quadro_indice;
--   DROP TABLE IF EXISTS public."CONTRATO_QUADRO_POSTO";
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'contrato_quadro_postos';
--   DELETE FROM public.app_menu      WHERE codigo      = 'contrato_quadro_postos';
--   -- E reaplicar a versão da 20260930000081 de sup_cat_postos_do_contrato
--   -- (a daqui só acrescenta o quadro ao conjunto de postos vivos; deixá-la
--   -- no lugar sem a tabela quebraria a função, porque ela lê o quadro).
--   NOTIFY pgrst, 'reload schema';
-- =========================================================================
