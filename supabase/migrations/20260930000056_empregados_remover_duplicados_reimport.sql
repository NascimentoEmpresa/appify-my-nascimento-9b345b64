-- =========================================================================
-- EMPREGADOS: remove as duplicatas da reimportação (04/09/2026)
--
-- Vieram à tona no Exportar Dados: a planilha de colaboradores trazia o mesmo
-- nome duas vezes. São 76 pares — quase todos com uma linha antiga e uma do
-- bloco de IDs 12500+, que é uma reimportação que copiou o cadastro em vez de
-- atualizá-lo.
--
-- POR QUE A COMPARAÇÃO LITERAL NÃO ACHAVA: "Admissão" é texto e guarda a
-- MESMA data em dois formatos — "01/02/2024" numa linha e "2024-02-01" na
-- outra. Agrupar pelo texto cru encontrava só 10 grupos, e nenhum deles era
-- duplicata (eram vínculos em empresas diferentes do grupo). A chave aqui
-- normaliza a data com `rh_data_br_para_date`, o mesmo helper que o RH já usa
-- para a coluna "Nascimento", que tem o mesmo problema de formato misto.
--
-- CHAVE: Nome + CPF + Empresa + Admissão NORMALIZADA. Empresa entra pelo
-- mesmo motivo documentado na limpeza de 20/08/2026 (20260909000010): a mesma
-- pessoa pode ter vínculo em duas empresas do grupo, com a mesma admissão, e
-- são dois vínculos de verdade — sem Empresa na chave, um deles seria
-- apagado.
--
-- QUEM FICA: o ID MAIOR, sempre. É uma escolha DIFERENTE da de agosto, que
-- preferia quem estava 'Trabalhando', e é deliberada — a evidência mudou:
--
--   • em 21 dos 25 pares que discordam da situação, a linha que fica diz
--     "Demitido" e 20 delas TÊM "Data Afastamento" preenchida. A baixa é
--     real; é a linha antiga que está velha, dizendo "Trabalhando" para quem
--     já saiu. Manter a antiga seria manter 20 demitidos no quadro ativo —
--     exatamente o número que o relatório da Protege e o faturamento contam.
--   • a exceção é CARLOS EDUARDO RAMOS DO NASCIMENTO (fica 12458, sai
--     12078): a linha que fica diz "Demitido" SEM data de afastamento. Segue
--     a mesma regra para não abrir exceção manual, mas vale conferência do
--     RH — se estiver errado, a linha antiga está inteira no backup.
--
-- LOGIN: uma das 76 linhas que saem tem `auth_user_id` e a sobrevivente não
-- (DAIANE MARTINS DE SOUZA, 9701 → 12852). O vínculo é movido ANTES do
-- delete; sem isso o login dela ficaria sem colaborador. As outras 9 pessoas
-- com login já têm o vínculo na linha que fica.
--
-- REFERÊNCIAS: nenhuma FK aponta para EMPREGADOS, mas 14 colunas de outros
-- módulos guardam `empregado_id` solto (líderes de setor, diárias, pedidos,
-- currículos, denúncias, rateio do malote). Conferido antes: ZERO delas
-- referencia qualquer um dos 76 IDs que saem.
--
-- REVERSÍVEL: as linhas saem inteiras para EMPREGADOS_DUPLICADOS_BKP, com o
-- ID de quem ficou no lugar — a mesma tabela e o mesmo desenho de agosto. Ela
-- guarda CPF/PIS, então tem RLS ligada e nenhuma policy: só service_role.
-- =========================================================================

-- ── 1. Quem sai e para quem cada um aponta ───────────────────────────────
CREATE TEMP TABLE _dup_reimport AS
WITH g AS (
  SELECT "ID",
         first_value("ID") OVER w AS fica,
         row_number()      OVER w AS rn
    FROM public."EMPREGADOS"
  WINDOW w AS (PARTITION BY "Nome", "CPF", "Empresa",
                            public.rh_data_br_para_date("Admissão")
               ORDER BY "ID" DESC)
)
SELECT "ID" AS removido, fica FROM g WHERE rn > 1;

-- ── 2. Backup, antes de tocar em qualquer coisa ──────────────────────────
CREATE TABLE IF NOT EXISTS public."EMPREGADOS_DUPLICADOS_BKP" (LIKE public."EMPREGADOS");
ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP" ADD COLUMN IF NOT EXISTS ficou_no_id bigint;
ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP" ADD COLUMN IF NOT EXISTS removido_em timestamptz DEFAULT now();
ALTER TABLE public."EMPREGADOS_DUPLICADOS_BKP" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."EMPREGADOS_DUPLICADOS_BKP" FROM PUBLIC, anon, authenticated;

INSERT INTO public."EMPREGADOS_DUPLICADOS_BKP"
SELECT e.*, d.fica, now()
  FROM public."EMPREGADOS" e
  JOIN _dup_reimport d ON d.removido = e."ID";

-- ── 3. O login não pode morrer com a linha ───────────────────────────────
-- `empregados_auth_user_id_uidx` é ÚNICO, então não dá para copiar o login
-- para a sobrevivente enquanto a linha antiga ainda o segura. Guarda agora,
-- apaga, e só então grava — nesta ordem, sem colisão.
-- Só onde a sobrevivente está VAZIA: não sobrescreve vínculo já existente.
CREATE TEMP TABLE _logins_a_mover AS
SELECT d.fica, s.auth_user_id
  FROM _dup_reimport d
  JOIN public."EMPREGADOS" s ON s."ID" = d.removido
  JOIN public."EMPREGADOS" f ON f."ID" = d.fica
 WHERE s.auth_user_id IS NOT NULL
   AND f.auth_user_id IS NULL;

-- ── 4. Remove ────────────────────────────────────────────────────────────
DELETE FROM public."EMPREGADOS" e USING _dup_reimport d WHERE e."ID" = d.removido;

-- ── 4b. Devolve o login à linha que ficou ────────────────────────────────
UPDATE public."EMPREGADOS" f
   SET auth_user_id = l.auth_user_id
  FROM _logins_a_mover l
 WHERE f."ID" = l.fica;

-- ── 5. Conferência ───────────────────────────────────────────────────────
SELECT (SELECT count(*) FROM public."EMPREGADOS")                    AS empregados_agora,
       (SELECT count(*) FROM _dup_reimport)                          AS removidos,
       (SELECT count(*) FROM public."EMPREGADOS_DUPLICADOS_BKP")     AS no_backup_total,
       (SELECT count(*) FROM (
          SELECT 1 FROM public."EMPREGADOS"
           GROUP BY "Nome","CPF","Empresa", public.rh_data_br_para_date("Admissão")
          HAVING count(*) > 1) x)                                    AS duplicatas_restantes;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   INSERT INTO public."EMPREGADOS"
--   SELECT (b.*)::public."EMPREGADOS".* FROM public."EMPREGADOS_DUPLICADOS_BKP" b
--    WHERE b.removido_em >= '2026-09-04';
--   (e desfazer o auth_user_id movido no passo 4b, se for o caso)
-- =========================================================================
