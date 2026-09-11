-- =========================================================================
-- EMPREGADOS: cargo, filial, escala e local param de chegar vazios
--
-- O SINTOMA
--   DAIANE ALVES LESSER, admitida em 09/09/2026, entrou com "Cargo",
--   "Título do Cargo", "Nome Filial", "Escala" e "Descrição do Local" em
--   branco. Não é caso isolado: 785 das 13.271 linhas estão assim.
--
-- A CAUSA
--   Duas origens diferentes escrevem nesta tabela.
--     • A carga histórica veio de planilha e trouxe TUDO.
--     • O robô `integracao-senior/` (que roda desde então) grava só 13
--       colunas — nome, CPF, admissão, situação, salário e mais algumas.
--       Ele lê `BiEmpregados`, onde esses campos são CÓDIGOS (codcar, codfil,
--       codesc, numloc), e nunca foi ensinado a resolver código em nome.
--   Ou seja: todo colaborador admitido depois de o robô entrar no ar nasce
--   sem cargo, sem escala e sem contrato na tela do ERP.
--
-- POR QUE A CORREÇÃO MORA NO BANCO, E NÃO NO ROBÔ
--   O schema `espelho` já tem BiEmpregados, BiCargos, BiFilial e
--   BiOrganogramas completos, atualizados pelo `espelho-mysql/`. Resolver os
--   códigos aqui conserta de uma vez as 785 linhas que JÁ estão furadas e as
--   futuras, sem depender do túnel SSH nem de novo deploy do robô — que roda
--   fora daqui, no Discloud, e não dá para testar de dentro do repositório.
--
-- O MAPEAMENTO, CONFERIDO CONTRA AS 12.486 LINHAS QUE JÁ ESTÃO CERTAS
--   "Título do Cargo"    <- BiCargos.titulo      por (empresa, codcar)
--   "Nome Filial"        <- BiFilial.APELIDO     por (empresa, codfil)
--   "Descrição do Local" <- BiOrganogramas.descricao_local  por numloc
--   "Escala_1"           <- codesc      "Escala" <- descrição do código
--
--   ⚠ "Nome Filial" é o APELIDO, não o `nome`. O `nome` é sempre a razão
--     social ("NASCIMENTO SERVICOS DE LIMPEZA LTDA"); o apelido é o contrato
--     ("PREFEITURA MUNICIPAL DE BUTIA"), que é o que a tela mostra e o que o
--     RH usa para saber onde a pessoa trabalha.
--
--   ⚠ O ESPELHO ESTÁ MAIS CERTO QUE A PLANILHA. Onde os dois discordam, é a
--     planilha que está torta: 361 pessoas com "VARREDOR DE RUA - LIMPEZA
--     URBA" (cortado em 30 caracteres) contra "...URBANA" no Senior, e filial
--     com espaço a mais ("VERANOPOLIS   -  001/2021" contra
--     "VERANOPOLIS - 001/2021"). Por isso existe o parâmetro `_sobrescrever`,
--     desligado por padrão: corrigir 12 mil linhas é decisão de quem
--     administra, não efeito colateral de preencher 785.
--
--   ⚠ A coluna numérica "Cargo" NÃO é o codcar. A planilha usava numeração
--     própria (codcar 0015 = SERVENTE DE LIMPEZA aparece como 165), e essa
--     numeração não tem de onde ser reproduzida — 83 dos 226 códigos são
--     ambíguos. As linhas novas recebem o codcar. Quem exibe cargo no ERP lê
--     "Título do Cargo" (conferido: UsuariosReal, BuscaColaborador,
--     CartaoPerfil), então o número não vai para tela nenhuma.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── A dimensão que faltava ───────────────────────────────────────────────
-- A escala é a única das quatro que o `espelho-mysql/` não traz: não há
-- tabela de escalas em tabelas.json. Enquanto ela não entrar lá, a fonte é o
-- que a carga histórica já provou — 272 dos 276 códigos de escala em uso têm
-- descrição conhecida, e ela bate com o Senior (o código 133 sai
-- "07:00-19:00(12x36)(12h)" nos dois).
CREATE TABLE IF NOT EXISTS public."RH_ESCALA" (
  codigo     integer PRIMARY KEY,
  descricao  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."RH_ESCALA" IS
  'Código de escala (codesc do Senior) -> descrição. Semeada a partir das linhas de EMPREGADOS que já vieram preenchidas; quando o espelho passar a trazer a tabela de escalas do Senior, esta vira derivada dela.';

-- Semeia pelo que já existe. `mode()` resolve os 6 códigos que aparecem com
-- mais de uma grafia: vence a descrição da maioria, não a última lida.
INSERT INTO public."RH_ESCALA" (codigo, descricao)
SELECT "Escala_1"::int, mode() WITHIN GROUP (ORDER BY btrim("Escala"))
  FROM public."EMPREGADOS"
 WHERE "Escala_1" IS NOT NULL
   AND nullif(btrim("Escala"), '') IS NOT NULL
 GROUP BY "Escala_1"
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public."RH_ESCALA" ENABLE ROW LEVEL SECURITY;

-- Ler é de qualquer autenticado: é dicionário de código, e aparece em toda
-- tela de RH que mostra a escala de alguém. Escrever é de quem administra RH.
DROP POLICY IF EXISTS rh_escala_ler ON public."RH_ESCALA";
CREATE POLICY rh_escala_ler ON public."RH_ESCALA" FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rh_escala_escrever ON public."RH_ESCALA";
CREATE POLICY rh_escala_escrever ON public."RH_ESCALA" FOR ALL TO authenticated
  USING (public.has_screen_access(auth.uid(), 'rh_colaboradores', 'alterar'::app_acao))
  WITH CHECK (public.has_screen_access(auth.uid(), 'rh_colaboradores', 'alterar'::app_acao));

-- ── O preenchimento ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rh_enriquecer_empregados_do_espelho(
  _sobrescrever boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, espelho, pg_temp
AS $fn$
DECLARE
  v_alteradas int;
BEGIN
  WITH fonte AS (
    SELECT e."ID"                    AS id_empregado,
           b.codcar::int             AS cod_cargo,
           btrim(c.titulo)           AS titulo_cargo,
           btrim(f.apelido)          AS nome_filial,
           btrim(o.descricao_local)  AS local_descricao,
           b.codesc::int             AS cod_escala,
           btrim(x.descricao)        AS escala_descricao
      FROM public."EMPREGADOS" e
      JOIN espelho."BiEmpregados"         b ON b.numemp = e."Empresa" AND b.numcad = e."Cadastro"
      LEFT JOIN espelho."BiCargos"        c ON c.empresa = b.numemp AND c.cargo = b.codcar
      LEFT JOIN espelho."BiFilial"        f ON f.empresa = b.numemp AND f.codigo = b.codfil
      LEFT JOIN espelho."BiOrganogramas"  o ON o.codigo_local = b.numloc
      LEFT JOIN public."RH_ESCALA"        x ON x.codigo = b.codesc::int
  ),
  novo AS (
    SELECT s.id_empregado,
           CASE WHEN _sobrescrever OR e."Cargo" IS NULL
                THEN coalesce(s.cod_cargo, e."Cargo") ELSE e."Cargo" END AS cargo,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Título do Cargo"), '') IS NULL
                THEN coalesce(s.titulo_cargo, e."Título do Cargo") ELSE e."Título do Cargo" END AS titulo_cargo,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Nome do Cargo"), '') IS NULL
                THEN coalesce(s.titulo_cargo, e."Nome do Cargo") ELSE e."Nome do Cargo" END AS nome_cargo,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Nome Filial"), '') IS NULL
                THEN coalesce(s.nome_filial, e."Nome Filial") ELSE e."Nome Filial" END AS nome_filial,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Descrição do Local"), '') IS NULL
                THEN coalesce(s.local_descricao, e."Descrição do Local") ELSE e."Descrição do Local" END AS local_descricao,
           CASE WHEN _sobrescrever OR e."Escala_1" IS NULL
                THEN coalesce(s.cod_escala, e."Escala_1") ELSE e."Escala_1" END AS escala_1,
           CASE WHEN _sobrescrever OR nullif(btrim(e."Escala"), '') IS NULL
                THEN coalesce(s.escala_descricao, e."Escala") ELSE e."Escala" END AS escala
      FROM fonte s
      JOIN public."EMPREGADOS" e ON e."ID" = s.id_empregado
  )
  UPDATE public."EMPREGADOS" e
     SET "Cargo"              = n.cargo,
         "Título do Cargo"    = n.titulo_cargo,
         "Nome do Cargo"      = n.nome_cargo,
         "Nome Filial"        = n.nome_filial,
         "Descrição do Local" = n.local_descricao,
         "Escala_1"           = n.escala_1,
         "Escala"             = n.escala
    FROM novo n
   WHERE n.id_empregado = e."ID"
     -- Só grava o que muda. Sem isto, toda execução carimba 13 mil linhas e
     -- qualquer trigger de auditoria acha que o cadastro inteiro foi mexido.
     AND (e."Cargo"              IS DISTINCT FROM n.cargo
       OR e."Título do Cargo"    IS DISTINCT FROM n.titulo_cargo
       OR e."Nome do Cargo"      IS DISTINCT FROM n.nome_cargo
       OR e."Nome Filial"        IS DISTINCT FROM n.nome_filial
       OR e."Descrição do Local" IS DISTINCT FROM n.local_descricao
       OR e."Escala_1"           IS DISTINCT FROM n.escala_1
       OR e."Escala"             IS DISTINCT FROM n.escala);

  GET DIAGNOSTICS v_alteradas = ROW_COUNT;
  RETURN jsonb_build_object('linhas_alteradas', v_alteradas, 'sobrescreveu', _sobrescrever);
END $fn$;

COMMENT ON FUNCTION public.rh_enriquecer_empregados_do_espelho(boolean) IS
  'Resolve os códigos do Senior (codcar, codfil, codesc, numloc) nas colunas de nome de EMPREGADOS, lendo o schema espelho. Sem argumento, só preenche o que está vazio; com true, também corrige o que diverge do Senior.';

REVOKE ALL ON FUNCTION public.rh_enriquecer_empregados_do_espelho(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rh_enriquecer_empregados_do_espelho(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.rh_enriquecer_empregados_do_espelho(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rh_enriquecer_empregados_do_espelho(boolean) TO service_role;

-- Preenche o que está vazio HOJE. Rodar de novo é inofensivo: a função só
-- grava o que muda.
SELECT public.rh_enriquecer_empregados_do_espelho();

NOTIFY pgrst, 'reload schema';

-- ── Conferência ──────────────────────────────────────────────────────────
SELECT count(*)                                      AS total,
       count("Cargo")                                AS com_cargo,
       count(nullif(btrim("Título do Cargo"), ''))    AS com_titulo_cargo,
       count(nullif(btrim("Nome Filial"), ''))        AS com_nome_filial,
       count(nullif(btrim("Escala"), ''))             AS com_escala,
       count(nullif(btrim("Descrição do Local"), ''))  AS com_local
  FROM public."EMPREGADOS";

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.rh_enriquecer_empregados_do_espelho(boolean);
-- DROP POLICY IF EXISTS rh_escala_escrever ON public."RH_ESCALA";
-- DROP POLICY IF EXISTS rh_escala_ler ON public."RH_ESCALA";
-- DROP TABLE IF EXISTS public."RH_ESCALA";
-- (as colunas preenchidas NÃO voltam a ficar vazias — não há como distinguir
--  o que esta migration escreveu do que já estava lá. Se precisar mesmo,
--  restaure de backup.)
-- NOTIFY pgrst, 'reload schema';
