-- =====================================================================
-- COMITÊ DE ÉTICA — ficha de apuração e base dos indicadores
--
-- POR QUE
-- Até aqui a tratativa de uma denúncia guardava três coisas: status, parecer
-- e retorno. Dá para responder "o que aconteceu com o protocolo X", mas não
-- dá para responder "quais contratos concentram risco", "as medidas estão
-- sendo eficazes" ou "isso é falha de processo ou de comportamento" — que é
-- justamente o que transforma o comitê em ferramenta de gestão de risco.
--
-- O QUE MUDA
--   1. SITUAÇÃO separada de RESULTADO. Antes 'procedente' era status, então
--      um caso julgado procedente que ainda aguardava o cumprimento da medida
--      não tinha como ser representado. Agora `status` diz onde o processo
--      está e `resultado` diz no que deu.
--   2. Campos de ficha: origem, reclassificação pelo comitê, pessoas
--      envolvidas, gravidade, sigilo, investigação, medidas, recurso,
--      causa raiz e encaminhamentos.
--   3. SLA por gravidade em tabela própria — crítica não pode ter o mesmo
--      prazo de baixa, e o prazo é decisão de gestão, não constante de código.
--   4. Menu do dashboard + RLS aceitando os dois menus do módulo.
--
-- O QUE **NÃO** MUDA
-- O relato continua imutável: a trava `canal_denuncia_guard` segue protegendo
-- tudo que veio do denunciante. Todas as colunas criadas aqui são da
-- tratativa, ficam FORA da trava de propósito — é o comitê que as preenche.
--
-- Reincidência, tempo médio, % dentro do SLA e afins não viram coluna: são
-- derivados na leitura. Indicador gravado em coluna congela na hora do
-- cadastro e passa a mentir assim que um caso novo entra.
--
-- Idempotente.
-- =====================================================================

-- ── 1. Ficha de apuração ─────────────────────────────────────────────
ALTER TABLE public."CANAL_DENUNCIA"
  -- Identificação
  ADD COLUMN IF NOT EXISTS origem                   text,
  -- Classificação do comitê (o denunciante já escolheu um tipo; o comitê
  -- pode discordar, e é a leitura dele que vale no indicador).
  ADD COLUMN IF NOT EXISTS tipo_classificado        text,
  ADD COLUMN IF NOT EXISTS gravidade                text,
  ADD COLUMN IF NOT EXISTS sigilo                   text,
  -- Pessoas e recorte organizacional. O id do empregado permite contar
  -- reincidência mesmo quando o nome vier escrito diferente; o nome é
  -- guardado junto como retrato do momento, porque EMPREGADOS é reimportado
  -- da folha e a linha pode mudar de conteúdo depois.
  ADD COLUMN IF NOT EXISTS denunciado_nome          text,
  ADD COLUMN IF NOT EXISTS denunciado_empregado_id  bigint,
  ADD COLUMN IF NOT EXISTS lider_nome               text,
  ADD COLUMN IF NOT EXISTS lider_empregado_id       bigint,
  ADD COLUMN IF NOT EXISTS diretoria                text,
  ADD COLUMN IF NOT EXISTS contrato                 text,
  ADD COLUMN IF NOT EXISTS setor                    text,
  ADD COLUMN IF NOT EXISTS unidade                  text,
  ADD COLUMN IF NOT EXISTS cidade                   text,
  -- Investigação
  ADD COLUMN IF NOT EXISTS apuracao_responsavel     text,
  ADD COLUMN IF NOT EXISTS apuracao_inicio          date,
  ADD COLUMN IF NOT EXISTS apuracao_fim             date,
  -- Marca o fim do "tempo até a primeira providência" — indicador de
  -- responsividade, diferente do tempo total de conclusão.
  ADD COLUMN IF NOT EXISTS primeira_providencia_em  timestamptz,
  -- Desfecho
  ADD COLUMN IF NOT EXISTS resultado                text,
  ADD COLUMN IF NOT EXISTS medidas                  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS houve_recurso            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurso_resultado        text,
  ADD COLUMN IF NOT EXISTS recurso_data             date,
  ADD COLUMN IF NOT EXISTS causa_raiz               text,
  ADD COLUMN IF NOT EXISTS causa_raiz_detalhe       text,
  ADD COLUMN IF NOT EXISTS acoes_preventivas        text,
  ADD COLUMN IF NOT EXISTS acoes_corretivas         text,
  -- Prazo pactuado para ESTE caso. Fica nulo no caso comum e o painel usa o
  -- SLA da gravidade; preenchido, vence a régua geral (caso excepcional).
  ADD COLUMN IF NOT EXISTS sla_dias_override        integer;

COMMENT ON COLUMN public."CANAL_DENUNCIA".tipo_classificado IS
  'Tipo segundo o comitê. Indicadores usam COALESCE(tipo_classificado, tipo_denuncia).';
COMMENT ON COLUMN public."CANAL_DENUNCIA".medidas IS
  'Medidas aplicadas (multiplas). Valores em src/pages/comite-etica/vocabulario.ts.';
COMMENT ON COLUMN public."CANAL_DENUNCIA".sla_dias_override IS
  'Prazo especifico deste caso. Nulo = usa COMITE_ETICA_SLA pela gravidade.';

-- ── 2. Situação x resultado: traduz o modelo antigo ──────────────────
-- Antes o desfecho morava em `status`. Quem já estava assim vira encerrada
-- com o resultado preenchido, senão o caso sumiria dos dois indicadores.
UPDATE public."CANAL_DENUNCIA"
   SET resultado = COALESCE(resultado, status),
       status    = 'encerrada'
 WHERE status IN ('procedente', 'improcedente', 'arquivada');

UPDATE public."CANAL_DENUNCIA"
   SET status = 'investigacao'
 WHERE status = 'apuracao';

-- ── 3. Domínios ──────────────────────────────────────────────────────
-- NOT VALID em nada: a tabela é pequena e vale falhar aqui se algum valor
-- legado não couber, em vez de descobrir pelo indicador torto meses depois.
DO $$
BEGIN
  -- A 20260812000001 criou `canal_denuncia_status_valido` com os valores
  -- antigos. CHECKs são cumulativos: deixá-lo de pé faria a interseção com o
  -- novo domínio ser só 'nova' e 'em_analise', e gravar "Em investigação"
  -- passaria a estourar. Some antes de o novo entrar.
  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_status_valido;

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_status_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_status_chk
    CHECK (status IN ('nova','em_analise','aguardando_documentos','investigacao','julgada','encerrada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_resultado_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_resultado_chk
    CHECK (resultado IS NULL OR resultado IN ('procedente','parcialmente_procedente','improcedente','arquivada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_gravidade_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_gravidade_chk
    CHECK (gravidade IS NULL OR gravidade IN ('baixa','media','alta','critica'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_sigilo_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_sigilo_chk
    CHECK (sigilo IS NULL OR sigilo IN ('sigilosa','identificada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_recurso_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_recurso_chk
    CHECK (recurso_resultado IS NULL OR recurso_resultado IN ('mantida','parcialmente_reformada','reformada'));

  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_causa_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_causa_chk
    CHECK (causa_raiz IS NULL OR causa_raiz IN ('falha_lideranca','comunicacao','treinamento','processo',
                                                'comportamento_individual','descumprimento_norma',
                                                'clima_organizacional','outro'));
END $$;

-- Índices dos recortes que o painel agrupa com mais frequência.
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_contrato  ON public."CANAL_DENUNCIA"(contrato);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_setor     ON public."CANAL_DENUNCIA"(setor);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_lider     ON public."CANAL_DENUNCIA"(lider_empregado_id);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_denunciado ON public."CANAL_DENUNCIA"(denunciado_empregado_id);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_resultado ON public."CANAL_DENUNCIA"(resultado);

-- ── 4. SLA por gravidade ─────────────────────────────────────────────
-- Prazo é decisão de gestão: fica em tabela para a dona ajustar sem deploy.
CREATE TABLE IF NOT EXISTS public."COMITE_ETICA_SLA" (
  gravidade   text PRIMARY KEY
              CHECK (gravidade IN ('baixa','media','alta','critica')),
  dias        integer NOT NULL CHECK (dias > 0),
  -- Prazo para a PRIMEIRA providência (acusar recebimento, abrir apuração).
  dias_primeira_providencia integer NOT NULL DEFAULT 2 CHECK (dias_primeira_providencia > 0),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public."COMITE_ETICA_SLA" (gravidade, dias, dias_primeira_providencia) VALUES
  ('critica', 10, 1),
  ('alta',    20, 2),
  ('media',   30, 3),
  ('baixa',   45, 5)
ON CONFLICT (gravidade) DO NOTHING;

ALTER TABLE public."COMITE_ETICA_SLA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."COMITE_ETICA_SLA" FROM anon;
GRANT SELECT, UPDATE ON TABLE public."COMITE_ETICA_SLA" TO authenticated;

DROP POLICY IF EXISTS comite_etica_sla_select ON public."COMITE_ETICA_SLA";
CREATE POLICY comite_etica_sla_select ON public."COMITE_ETICA_SLA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
      OR public.tem_acesso_menu('comite_etica_indicadores'));

DROP POLICY IF EXISTS comite_etica_sla_update ON public."COMITE_ETICA_SLA";
CREATE POLICY comite_etica_sla_update ON public."COMITE_ETICA_SLA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- ── 5. RLS da denúncia: quem vê o painel também lê a base ────────────
-- Sem isto, liberar só o dashboard entrega uma tela de zeros: a policy
-- barra o SELECT e o painel não tem como saber que foi a RLS.
DROP POLICY IF EXISTS canal_denuncia_select ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_select ON public."CANAL_DENUNCIA"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
      OR public.tem_acesso_menu('comite_etica_indicadores'));

-- Escrita continua exclusiva de quem trata a denúncia.
DROP POLICY IF EXISTS canal_denuncia_update ON public."CANAL_DENUNCIA";
CREATE POLICY canal_denuncia_update ON public."CANAL_DENUNCIA"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- ── 6. Menu do painel ────────────────────────────────────────────────
INSERT INTO public.app_menu (codigo, nome, rota, ordem, modulo_id)
SELECT 'comite_etica_indicadores', 'Indicadores', '/app/comite-etica/indicadores', 5,
       (SELECT id FROM public.app_modulo WHERE codigo = 'comite_etica')
WHERE NOT EXISTS (SELECT 1 FROM public.app_menu WHERE codigo = 'comite_etica_indicadores')
  AND EXISTS (SELECT 1 FROM public.app_modulo WHERE codigo = 'comite_etica');

-- ── Conferência ──────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='CANAL_DENUNCIA'
      AND column_name IN ('origem','tipo_classificado','gravidade','sigilo','denunciado_nome',
                          'denunciado_empregado_id','lider_nome','lider_empregado_id','diretoria',
                          'contrato','setor','unidade','cidade','apuracao_responsavel','apuracao_inicio',
                          'apuracao_fim','primeira_providencia_em','resultado','medidas','houve_recurso',
                          'recurso_resultado','recurso_data','causa_raiz','causa_raiz_detalhe',
                          'acoes_preventivas','acoes_corretivas','sla_dias_override')) AS colunas_ficha,
  (SELECT count(*) FROM public."COMITE_ETICA_SLA")                                     AS linhas_sla,
  (SELECT count(*) FROM public.app_menu WHERE codigo='comite_etica_indicadores')       AS menu_painel;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo='comite_etica_indicadores';
--   DROP TABLE IF EXISTS public."COMITE_ETICA_SLA";
--   ALTER TABLE public."CANAL_DENUNCIA"
--     DROP CONSTRAINT IF EXISTS canal_denuncia_status_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_resultado_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_gravidade_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_sigilo_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_recurso_chk,
--     DROP CONSTRAINT IF EXISTS canal_denuncia_causa_chk,
--     DROP COLUMN IF EXISTS origem, DROP COLUMN IF EXISTS tipo_classificado,
--     DROP COLUMN IF EXISTS gravidade, DROP COLUMN IF EXISTS sigilo,
--     DROP COLUMN IF EXISTS denunciado_nome, DROP COLUMN IF EXISTS denunciado_empregado_id,
--     DROP COLUMN IF EXISTS lider_nome, DROP COLUMN IF EXISTS lider_empregado_id,
--     DROP COLUMN IF EXISTS diretoria, DROP COLUMN IF EXISTS contrato,
--     DROP COLUMN IF EXISTS setor, DROP COLUMN IF EXISTS unidade, DROP COLUMN IF EXISTS cidade,
--     DROP COLUMN IF EXISTS apuracao_responsavel, DROP COLUMN IF EXISTS apuracao_inicio,
--     DROP COLUMN IF EXISTS apuracao_fim, DROP COLUMN IF EXISTS primeira_providencia_em,
--     DROP COLUMN IF EXISTS resultado, DROP COLUMN IF EXISTS medidas,
--     DROP COLUMN IF EXISTS houve_recurso, DROP COLUMN IF EXISTS recurso_resultado,
--     DROP COLUMN IF EXISTS recurso_data, DROP COLUMN IF EXISTS causa_raiz,
--     DROP COLUMN IF EXISTS causa_raiz_detalhe, DROP COLUMN IF EXISTS acoes_preventivas,
--     DROP COLUMN IF EXISTS acoes_corretivas, DROP COLUMN IF EXISTS sla_dias_override;
--   -- e recriar as policies canal_denuncia_select/update da 20260812000001
-- =====================================================================
