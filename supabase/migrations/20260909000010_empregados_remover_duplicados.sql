-- =========================================================================
-- EMPREGADOS: remover cadastros duplicados (pedido do Pablo, 20/08/2026)
--
-- CHAVE DA DUPLICIDADE: Nome + CPF + Admissão + **Empresa**.
--
-- O pedido dizia "Nome, CPF e data de admissão", mas o próprio exemplo (TALIS
-- CASTRO DE SOUZA) mostra que Empresa entra na chave: das 6 linhas dele, as
-- duas que devem SOBRAR — 11343 e 12920 — têm Nome, CPF e Admissão iguais e
-- só se diferenciam pela Empresa (2 e 5), porque são dois vínculos de
-- verdade, em duas empresas do grupo. Sem Empresa na chave, um dos dois
-- vínculos seria apagado. São 10 pessoas nessa situação (a diferença entre
-- 276 e 266 linhas removidas).
--
-- QUEM FICA: quem está 'Trabalhando'; havendo empate, o ID maior. Ficar só
-- com o ID maior apagaria 15 pessoas ATIVAS cujo registro ativo não é o mais
-- recente — elas sumiriam de todas as telas, que filtram por 'Trabalhando'.
--
-- O QUE É PRESERVADO: as colunas do lado ERP (login, permissões, perfil,
-- setor) NÃO seguem o registro que fica — no TALIS, por exemplo, o e-mail e o
-- auth_user_id estavam na linha 12775, que sai. São 22 pessoas que perderiam
-- o vínculo do login. Por isso as duplicatas são consolidadas no sobrevivente
-- ANTES de sumirem, e só onde o sobrevivente está vazio (não sobrescreve
-- Perfil/Setor já definidos).
--
-- REVERSÍVEL: as linhas removidas vão inteiras para EMPREGADOS_DUPLICADOS_BKP,
-- com o ID de quem ficou no lugar. A tabela guarda CPF, PIS, Senha e
-- chave_secreta — por isso nasce com RLS ligada e SEM policy: nem anon nem
-- authenticated leem, só service_role/SQL direto.
--
-- MEI: nenhuma das 12 linhas com TIPO DE CONTRATO = 'MEI' cai em grupo
-- duplicado, então elas não são tocadas de qualquer forma.
-- =========================================================================

-- ── 1. Quem sai e para quem cada um aponta ───────────────────────────────
CREATE TEMP TABLE _dup AS
WITH g AS (
  SELECT "ID",
         first_value("ID") OVER w AS fica,
         row_number()      OVER w AS rn
  FROM public."EMPREGADOS"
  WINDOW w AS (PARTITION BY "Nome", "CPF", "Admissão", "Empresa"
               ORDER BY ("Situação" = 'Trabalhando') DESC, "ID" DESC)
)
SELECT "ID" AS removido, fica FROM g WHERE rn > 1;

-- ── 2. Backup completo, antes de qualquer escrita ────────────────────────
CREATE TABLE IF NOT EXISTS public."EMPREGADOS_DUPLICADOS_BKP"
  (LIKE public."EMPREGADOS");
ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP"
  ADD COLUMN IF NOT EXISTS ficou_com_id bigint,
  ADD COLUMN IF NOT EXISTS removido_em  timestamptz DEFAULT now();

ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EMPREGADOS_DUPLICADOS_BKP" FROM PUBLIC, anon, authenticated;

INSERT INTO public."EMPREGADOS_DUPLICADOS_BKP"
SELECT e.*, d.fica, now()
  FROM public."EMPREGADOS" e
  JOIN _dup d ON d.removido = e."ID";

-- ── 3. Referências de outras tabelas passam para quem ficou ──────────────
-- A varredura das colunas *_id que apontam para EMPREGADOS achou só esta com
-- linhas presas a um ID que sai (5 linhas). Sem unique em empregado_id, o
-- repontamento não colide.
UPDATE public."CS_FORM_VINCULOS" v
   SET empregado_id = d.fica
  FROM _dup d
 WHERE v.empregado_id = d.removido;

-- ── 4. Apagar as duplicatas ──────────────────────────────────────────────
-- Antes da consolidação: auth_user_id tem índice único, e copiar o valor com
-- a linha de origem ainda viva seria recusado.
DELETE FROM public."EMPREGADOS" e USING _dup d WHERE e."ID" = d.removido;

-- ── 5. Consolidar o lado ERP no sobrevivente (só onde ele está vazio) ────
CREATE TEMP TABLE _consolidar AS
SELECT b.ficou_com_id AS fica,
       (array_agg(b.auth_user_id               ORDER BY b."ID" DESC) FILTER (WHERE b.auth_user_id IS NOT NULL))[1]                             AS auth_user_id,
       (array_agg(b.email                      ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.email,'')) <> ''))[1]                      AS email,
       (array_agg(b."Senha"                    ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Senha",'')) <> ''))[1]                    AS senha,
       (array_agg(b.chave_secreta              ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.chave_secreta,'')) <> ''))[1]              AS chave_secreta,
       (array_agg(b."Perfil_ERP"               ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Perfil_ERP",'')) <> ''))[1]               AS perfil_erp,
       (array_agg(b."Setor_ERP"                ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Setor_ERP",'')) <> ''))[1]                AS setor_erp,
       (array_agg(b."Ativo_ERP"                ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."Ativo_ERP",'')) <> ''))[1]                AS ativo_erp,
       (array_agg(b."LIDER"                    ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b."LIDER",'')) <> ''))[1]                    AS lider,
       (array_agg(b.permissoes_compras         ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.permissoes_compras,'')) <> ''))[1]         AS permissoes_compras,
       (array_agg(b.permissoes_malote          ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.permissoes_malote,'')) <> ''))[1]          AS permissoes_malote,
       (array_agg(b.classificacoes_responsavel ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.classificacoes_responsavel,'')) <> ''))[1] AS classificacoes_responsavel,
       (array_agg(b.aprovar_cotacao_classif    ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.aprovar_cotacao_classif,'')) <> ''))[1]    AS aprovar_cotacao_classif,
       (array_agg(b.tipo_acesso                ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.tipo_acesso,'')) <> ''))[1]                AS tipo_acesso,
       (array_agg(b.contrato_responsavel_id    ORDER BY b."ID" DESC) FILTER (WHERE b.contrato_responsavel_id IS NOT NULL))[1]                  AS contrato_responsavel_id,
       (array_agg(b.contrato_responsavel       ORDER BY b."ID" DESC) FILTER (WHERE btrim(coalesce(b.contrato_responsavel,'')) <> ''))[1]       AS contrato_responsavel
  FROM public."EMPREGADOS_DUPLICADOS_BKP" b
 WHERE b.ficou_com_id IN (SELECT fica FROM _dup)
 GROUP BY b.ficou_com_id;

UPDATE public."EMPREGADOS" e SET
  auth_user_id               = coalesce(e.auth_user_id, c.auth_user_id),
  email                      = coalesce(nullif(btrim(e.email), ''), c.email),
  "Senha"                    = coalesce(nullif(btrim(e."Senha"), ''), c.senha),
  chave_secreta              = coalesce(nullif(btrim(e.chave_secreta), ''), c.chave_secreta),
  "Perfil_ERP"               = coalesce(nullif(btrim(e."Perfil_ERP"), ''), c.perfil_erp),
  "Setor_ERP"                = coalesce(nullif(btrim(e."Setor_ERP"), ''), c.setor_erp),
  "Ativo_ERP"                = coalesce(nullif(btrim(e."Ativo_ERP"), ''), c.ativo_erp),
  "LIDER"                    = coalesce(nullif(btrim(e."LIDER"), ''), c.lider),
  permissoes_compras         = coalesce(nullif(btrim(e.permissoes_compras), ''), c.permissoes_compras),
  permissoes_malote          = coalesce(nullif(btrim(e.permissoes_malote), ''), c.permissoes_malote),
  classificacoes_responsavel = coalesce(nullif(btrim(e.classificacoes_responsavel), ''), c.classificacoes_responsavel),
  aprovar_cotacao_classif    = coalesce(nullif(btrim(e.aprovar_cotacao_classif), ''), c.aprovar_cotacao_classif),
  tipo_acesso                = coalesce(nullif(btrim(e.tipo_acesso), ''), c.tipo_acesso),
  contrato_responsavel_id    = coalesce(e.contrato_responsavel_id, c.contrato_responsavel_id),
  contrato_responsavel       = coalesce(nullif(btrim(e.contrato_responsavel), ''), c.contrato_responsavel)
FROM _consolidar c
WHERE e."ID" = c.fica;

-- ── 6. Login órfão não vale mais que login de verdade ────────────────────
-- CARLOS JOSE FERGUTZ NETO e ISADORA VELHO RAMOS têm DOIS auth_user_id: o da
-- linha que fica aponta para um usuário que não existe em profiles, e o login
-- que funciona (adm5@ / licitacao5@) está na linha que sai. Como auth_user_id
-- é único, só um cabe — então o critério não é "o do sobrevivente", é "o que
-- existe em profiles".
UPDATE public."EMPREGADOS" e
   SET auth_user_id = v.auth_user_id,
       email        = coalesce(nullif(btrim(e.email), ''), v.email)
  FROM (
    SELECT DISTINCT ON (b.ficou_com_id)
           b.ficou_com_id AS fica, b.auth_user_id, b.email
      FROM public."EMPREGADOS_DUPLICADOS_BKP" b
      JOIN public.profiles p ON p.id = b.auth_user_id
     ORDER BY b.ficou_com_id, b."ID" DESC
  ) v
 WHERE e."ID" = v.fica
   AND e.auth_user_id IS DISTINCT FROM v.auth_user_id
   AND NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE p2.id = e.auth_user_id);

DROP TABLE _consolidar;
DROP TABLE _dup;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK — devolve as linhas removidas (a consolidação feita no
-- sobrevivente NÃO se desfaz sozinha; confira antes de dropar o backup):
--   INSERT INTO public."EMPREGADOS"
--     SELECT b.* FROM public."EMPREGADOS_DUPLICADOS_BKP" b;   -- tirar as 2 colunas extras
--   -- e, quando o histórico não for mais preciso:
--   DROP TABLE public."EMPREGADOS_DUPLICADOS_BKP";
-- =========================================================================
