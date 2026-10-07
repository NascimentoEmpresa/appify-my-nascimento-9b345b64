-- =========================================================================
-- EMPREGADOS: remover as linhas repetidas que NÃO existem na Senior
-- (pedido do Pablo, 07/10/2026)
--
-- "pode apagar os duplicados, até os MEI, deixa só os que são da senior
-- mesmo que são os corretos. os MEI que não tem na senior deixa."
--
-- Levantamento (nome e CPF repetidos, mais Empresa+Cadastro repetido):
--
--   pessoa                              sai (fora da Senior)        fica (Senior)
--   CARLOS EDUARDO RAMOS DO NASCIMENTO  11930 MEI 5/11930 (login)   13607 2/2384 Trabalhando
--                                       11735 5/900000 demitido     9506  2/1214 Demitido
--                                       12458 2/sem cad. demitido
--   SENILTON RAMOS DO NASCIMENTO        11931 MEI 5/11931 (login)   12922 1/4083 Trabalhando
--                                       11252 2/900000 demitido     12924 1/862  Demitido
--   1/9901                              1950  DAIANE (demitida)     11940 ANTONIO ROSA DA SILVA
--   5/210                               11820 JUCELAINE DE MATTOS   12096 JUCELAINE DE MATOS
--
-- GUIOMAR FOGAÇA RAMOS DO NASCIMENTO NÃO entra: as três linhas dela (3/209,
-- 1/5535, 1/269) existem na Senior — são vínculos de verdade. Os outros 10
-- MEIs não têm par na Senior e ficam, como pedido.
--
-- O QUE É PRESERVADO (mesmo pega da limpeza de 20/08, mig 20260909000010):
-- login, e-mail, senha, perfil, setor, LIDER e permissões moravam nas linhas
-- MEI (11930/11931), que saem. Vão para a linha da Senior da mesma pessoa,
-- só onde ela está vazia. Referências repontadas: malote_despesa_rateio_linha
-- (13 linhas) e CS_FORM_VINCULOS (1). Os alunos de Treinamento das linhas
-- que saem só tinham a matrícula automática em massa (o sobrevivente tem a
-- mesma), sem progresso, prova ou certificado — são apagados, senão o
-- e-mail único do aluno impede o sobrevivente de herdar o e-mail real.
--
-- REVERSÍVEL: as linhas saem inteiras para EMPREGADOS_DUPLICADOS_BKP
-- (ficou_com_id = quem ficou no lugar). Não há FK para EMPREGADOS.
-- Idempotente: rodar de novo não acha nada para mover/apagar.
-- =========================================================================

BEGIN;

-- Colunas criadas em EMPREGADOS depois do backup de agosto.
ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP"
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS celular_whatsapp text,
  ADD COLUMN IF NOT EXISTS sexo_informado text,
  ADD COLUMN IF NOT EXISTS estado_civil_informado text,
  ADD COLUMN IF NOT EXISTS dados_pessoais_atualizados_em timestamptz;

CREATE TEMP TABLE _dup (sai bigint PRIMARY KEY, fica bigint NOT NULL) ON COMMIT DROP;
INSERT INTO _dup VALUES
  (11930, 13607), (11735, 13607), (12458, 13607),
  (11931, 12922), (11252, 12922),
  (1950,  11940),
  (11820, 12096);
-- só o que ainda existe (idempotência)
DELETE FROM _dup d WHERE NOT EXISTS (SELECT 1 FROM public."EMPREGADOS" e WHERE e."ID" = d.sai);

-- 1) backup inteiro
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position) INTO cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'EMPREGADOS';
  EXECUTE format(
    'INSERT INTO public."EMPREGADOS_DUPLICADOS_BKP" (%s, ficou_com_id, removido_em)
     SELECT %s, d.fica, now() FROM public."EMPREGADOS" e JOIN _dup d ON d.sai = e."ID"',
    cols, (SELECT string_agg('e.' || x, ', ') FROM unnest(string_to_array(cols, ', ')) x));
END $$;

-- 2) referências
UPDATE public.malote_despesa_rateio_linha r SET integrante_empregado_id = d.fica
  FROM _dup d WHERE r.integrante_empregado_id = d.sai;
UPDATE public."CS_FORM_VINCULOS" v SET empregado_id = d.fica
  FROM _dup d WHERE v.empregado_id = d.sai;
-- matrícula antes do aluno: a trigger trn_matricula_historico grava no
-- histórico do aluno ao remover o curso, e o aluno ainda precisa existir.
DELETE FROM public."TRN_MATRICULA" m USING public."TRN_ALUNO" a, _dup d
 WHERE m.aluno_id = a.id AND a.empregado_id = d.sai;
DELETE FROM public."TRN_ALUNO" a USING _dup d WHERE a.empregado_id = d.sai;

-- 3) lado ERP para o sobrevivente (auth_user_id tem índice único: solta antes)
CREATE TEMP TABLE _erp ON COMMIT DROP AS
  SELECT d.fica, e.* FROM public."EMPREGADOS" e JOIN _dup d ON d.sai = e."ID"
   WHERE e.auth_user_id IS NOT NULL OR e.email IS NOT NULL OR e."Setor_ERP" IS NOT NULL
      OR e."Perfil_ERP" IS NOT NULL OR e.permissoes_compras IS NOT NULL;
UPDATE public."EMPREGADOS" e SET auth_user_id = NULL FROM _dup d WHERE e."ID" = d.sai;

UPDATE public."EMPREGADOS" s SET
  auth_user_id               = COALESCE(s.auth_user_id, x.auth_user_id),
  email                      = COALESCE(s.email, x.email),
  "Senha"                    = COALESCE(s."Senha", x."Senha"),
  chave_secreta              = COALESCE(s.chave_secreta, x.chave_secreta),
  "Perfil_ERP"               = COALESCE(s."Perfil_ERP", x."Perfil_ERP"),
  "Setor_ERP"                = COALESCE(s."Setor_ERP", x."Setor_ERP"),
  "Ativo_ERP"                = COALESCE(s."Ativo_ERP", x."Ativo_ERP"),
  "LIDER"                    = COALESCE(s."LIDER", x."LIDER"),
  permissoes_compras         = COALESCE(s.permissoes_compras, x.permissoes_compras),
  permissoes_malote          = COALESCE(s.permissoes_malote, x.permissoes_malote),
  classificacoes_responsavel = COALESCE(s.classificacoes_responsavel, x.classificacoes_responsavel),
  aprovar_cotacao_classif    = COALESCE(s.aprovar_cotacao_classif, x.aprovar_cotacao_classif),
  tipo_acesso                = COALESCE(s.tipo_acesso, x.tipo_acesso),
  contrato_responsavel_id    = COALESCE(s.contrato_responsavel_id, x.contrato_responsavel_id),
  contrato_responsavel       = COALESCE(s.contrato_responsavel, x.contrato_responsavel),
  telefone                   = COALESCE(s.telefone, x.telefone),
  celular_whatsapp           = COALESCE(s.celular_whatsapp, x.celular_whatsapp)
FROM (SELECT DISTINCT ON (fica) * FROM _erp
       ORDER BY fica, (auth_user_id IS NOT NULL) DESC, "ID" DESC) x
WHERE s."ID" = x.fica;

-- 4) apaga
DELETE FROM public."EMPREGADOS" e USING _dup d WHERE e."ID" = d.sai;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- INSERT INTO "EMPREGADOS" (<colunas>) SELECT <colunas> FROM "EMPREGADOS_DUPLICADOS_BKP"
--  WHERE "ID" IN (11930,11735,12458,11931,11252,1950,11820) AND removido_em::date = '2026-10-07';
-- Depois: devolver auth_user_id de 13607→11930 e 12922→11931, repontar
-- malote_despesa_rateio_linha/CS_FORM_VINCULOS e deixar o trn_sync recriar os alunos.
