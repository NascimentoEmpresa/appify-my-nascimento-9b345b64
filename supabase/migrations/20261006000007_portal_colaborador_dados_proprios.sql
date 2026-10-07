-- =========================================================================
-- PORTAL DO COLABORADOR › Meu perfil: SEXO, ESTADO CIVIL e CELULAR/WHATSAPP
-- informados pelo próprio colaborador (06/10/2026)
--
-- PEDIDO (Pablo): "deixa opção do colaborador editar o seu usuário, mas pode
-- editar apenas o sexo, estado civil e adicionar número de celular/WhatsApp.
-- Isso vai atualizar na tabela EMPREGADOS. Deixa os 3 zerados — se os
-- colaboradores quiserem, eles acessam e editam. Atualmente tá puxando
-- errado: essa mulher (MARGARETE SILVEIRA SANTOS) tá como M de masculino e
-- solteira, e na verdade é viúva."
--
-- POR QUE COLUNAS NOVAS, e não o "Sexo"/"Estado Civil" da Senior: o erro
-- está NA SENIOR (a linha da Margarete veio "M / Solteiro" de lá), e o
-- rh_sync_senior_empregados reescreve "Sexo" a cada rodada (mig 275 —
-- EMPREGADOS igual à Senior). Apagar ou corrigir ali voltaria errado na
-- próxima sincronização. Então a EMPREGADOS ganha três colunas que são DO
-- COLABORADOR — nascem vazias ("zerados"), só ele preenche pelo portal, e a
-- sincronização não as toca. O "Sexo" da Senior fica como está para quem
-- já o usa (relatórios, eSocial); o portal passa a mostrar só o informado.
--
-- Única interferência do sync: quando a Senior reaproveita a matrícula para
-- OUTRA pessoa (v_outra), as três são limpas junto com login e telefone —
-- senão a pessoa nova herdaria o celular da antiga.
--
-- Idempotente. Aplicar no banco do app (SQL Editor) — não se auto-aplica.
-- A Edge colaborador-portal ganha a ação "atualizar_dados" (redeploy).
-- =========================================================================

-- ── 1) Colunas do colaborador ────────────────────────────────────────────
ALTER TABLE public."EMPREGADOS"
  ADD COLUMN IF NOT EXISTS sexo_informado            text,
  ADD COLUMN IF NOT EXISTS estado_civil_informado    text,
  ADD COLUMN IF NOT EXISTS celular_whatsapp          text,
  ADD COLUMN IF NOT EXISTS dados_pessoais_atualizados_em timestamptz;

ALTER TABLE public."EMPREGADOS" DROP CONSTRAINT IF EXISTS empregados_sexo_informado_chk;
ALTER TABLE public."EMPREGADOS" ADD CONSTRAINT empregados_sexo_informado_chk
  CHECK (sexo_informado IS NULL OR sexo_informado IN ('Feminino', 'Masculino'));
ALTER TABLE public."EMPREGADOS" DROP CONSTRAINT IF EXISTS empregados_estado_civil_informado_chk;
ALTER TABLE public."EMPREGADOS" ADD CONSTRAINT empregados_estado_civil_informado_chk
  CHECK (estado_civil_informado IS NULL OR estado_civil_informado IN
         ('Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Separado(a)', 'Viúvo(a)'));
-- Só dígitos, com DDD: 10 (fixo) ou 11 (celular); 12/13 com o 55 do Brasil.
ALTER TABLE public."EMPREGADOS" DROP CONSTRAINT IF EXISTS empregados_celular_whatsapp_chk;
ALTER TABLE public."EMPREGADOS" ADD CONSTRAINT empregados_celular_whatsapp_chk
  CHECK (celular_whatsapp IS NULL OR celular_whatsapp ~ '^\d{10,13}$');

-- ── 2) O portal grava (só a Edge, com o empregado da sessão) ─────────────
CREATE OR REPLACE FUNCTION public.col_atualizar_dados(p_emp bigint, p_sexo text, p_estado_civil text, p_celular text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cel text := nullif(regexp_replace(coalesce(p_celular, ''), '\D', '', 'g'), '');
BEGIN
  IF p_emp IS NULL THEN RAISE EXCEPTION 'Sessão inválida.'; END IF;
  -- Valida antes do UPDATE: o erro do CHECK traz a linha inteira da
  -- EMPREGADOS (conta bancária inclusive) e a Edge repassa a mensagem à tela.
  IF nullif(btrim(p_sexo), '') IS NOT NULL AND btrim(p_sexo) NOT IN ('Feminino', 'Masculino') THEN
    RAISE EXCEPTION 'Sexo inválido.';
  END IF;
  IF nullif(btrim(p_estado_civil), '') IS NOT NULL AND btrim(p_estado_civil) NOT IN
     ('Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Separado(a)', 'Viúvo(a)') THEN
    RAISE EXCEPTION 'Estado civil inválido.';
  END IF;
  IF v_cel IS NOT NULL AND length(v_cel) NOT BETWEEN 10 AND 13 THEN
    RAISE EXCEPTION 'Celular inválido — informe com DDD, ex.: (51) 99999-9999.';
  END IF;
  UPDATE public."EMPREGADOS"
     SET sexo_informado = nullif(btrim(p_sexo), ''),
         estado_civil_informado = nullif(btrim(p_estado_civil), ''),
         celular_whatsapp = v_cel,
         dados_pessoais_atualizados_em = now()
   WHERE "ID" = p_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro não encontrado.'; END IF;
  RETURN public.col_perfil(p_emp);
END $$;
REVOKE ALL ON FUNCTION public.col_atualizar_dados(bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.col_atualizar_dados(bigint, text, text, text) TO service_role;

-- ── 3) O perfil mostra o que o colaborador informou ──────────────────────
-- Mesmo corpo da col_perfil vigente; sexo/estado_civil passam a ser os
-- informados (vazios até ele preencher) + celular_whatsapp.
CREATE OR REPLACE FUNCTION public.col_perfil(p_emp bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE e record; r jsonb; v_cpf text;
BEGIN
  SELECT * INTO e FROM public."EMPREGADOS" x WHERE x."ID" = p_emp;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_cpf := public.col_digitos(e."CPF");
  r := jsonb_build_object(
    'empregado_id',   e."ID",
    'nome',           e."Nome",
    'matricula',      nullif(btrim(e."Cadastro"::text), ''),
    'cpf',            CASE WHEN length(v_cpf) = 11
                        THEN substr(v_cpf,1,3) || '.' || substr(v_cpf,4,3) || '.' || substr(v_cpf,7,3) || '-' || substr(v_cpf,10,2)
                        ELSE e."CPF" END,
    'nascimento',     public.rh_data(e."Nascimento"::text),
    'sexo',           e.sexo_informado,
    'estado_civil',   e.estado_civil_informado,
    'celular_whatsapp', e.celular_whatsapp,
    'dados_pessoais_atualizados_em', e.dados_pessoais_atualizados_em,
    'instrucao',      e."Descrição (Instrução)",
    'nacionalidade',  e."Descrição (Nacionalidade)",
    'email',          e."email",
    'pis',            e."PIS",
    'ctps',           CASE WHEN e."CTPS" IS NOT NULL THEN e."CTPS"::text || coalesce('-' || e."Dígito Carteira Trabalho", '') END,
    'cargo',          e."Título do Cargo",
    'setor',          e."Setor_ERP",
    'posto',          e."Nome do Posto",
    'local',          e."Descrição do Local",
    'filial',         e."Nome Filial",
    'empresa',        e."Nome da Empresa",
    'centro_custo',   e."Titulo C.Custo",
    'situacao',       e."Situação",
    'admissao',       public.rh_data(e."Admissão"::text),
    'data_cargo',     public.rh_data(e."Data Cargo"::text),
    'data_afastamento', public.rh_data(e."Data Afastamento"::text),
    'escala',         e."Escala",
    'escala_codigo',  e."Escala_1",
    'tipo_contrato',  coalesce(e."Descrição (T. Contrato)", e."TIPO DE CONTRATO"),
    'categoria',      e."Descrição (Cat. eSocial)",
    'lider',          e."LIDER",
    'tem_conta_erp',  e.auth_user_id IS NOT NULL,
    'senha_propria',  EXISTS (SELECT 1 FROM public."COL_PORTAL_CREDENCIAL" c WHERE c.empregado_id = e."ID")
  );
  RETURN r;
END $function$;

-- ── 4) Sync da Senior: matrícula reaproveitada limpa os dados da antiga ──
-- Troca só a linha do telefone no corpo vigente (8,9 mil caracteres —
-- reescrever a função inteira aqui arriscaria desfazer ajuste mais novo).
DO $$
DECLARE v_def text; v_novo text;
BEGIN
  v_def := pg_get_functiondef('public.rh_sync_senior_empregados(jsonb)'::regprocedure);
  IF v_def LIKE '%sexo_informado%' THEN RETURN; END IF;  -- já aplicado
  v_novo := replace(v_def,
    'telefone           = CASE WHEN v_outra THEN NULL ELSE x.telefone END,',
    'telefone           = CASE WHEN v_outra THEN NULL ELSE x.telefone END,
           sexo_informado     = CASE WHEN v_outra THEN NULL ELSE x.sexo_informado END,
           estado_civil_informado = CASE WHEN v_outra THEN NULL ELSE x.estado_civil_informado END,
           celular_whatsapp   = CASE WHEN v_outra THEN NULL ELSE x.celular_whatsapp END,
           dados_pessoais_atualizados_em = CASE WHEN v_outra THEN NULL ELSE x.dados_pessoais_atualizados_em END,');
  IF v_novo = v_def THEN
    RAISE EXCEPTION 'rh_sync_senior_empregados mudou: não achei a linha do telefone para incluir as colunas novas.';
  END IF;
  EXECUTE v_novo;
END $$;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- Reaplicar col_perfil da mig 20260930000196 (sexo/estado civil da Senior) e
-- rh_sync_senior_empregados da mig 20260930000275.
-- DROP FUNCTION IF EXISTS public.col_atualizar_dados(bigint, text, text, text);
-- ALTER TABLE public."EMPREGADOS" DROP COLUMN IF EXISTS sexo_informado, DROP COLUMN IF EXISTS estado_civil_informado,
--   DROP COLUMN IF EXISTS celular_whatsapp, DROP COLUMN IF EXISTS dados_pessoais_atualizados_em;
