-- Nº sequencial "de chegada" do processo, visível e filtrável na tela.
-- 1 = o mais antigo, N = o mais recente. É por PROCESSO (numero_processo), então
-- todas as linhas de motivo do mesmo processo compartilham o mesmo número.
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "id_sequencial" bigint;

-- Backfill cronológico. Só 110 dos 390 processos têm data_entrada_reclamatoria,
-- então o critério é: data de entrada quando existir; senão o ano + os 7 dígitos
-- sequenciais do número CNJ (0020035-59.2024… → ano 2024, seq 20035), que já são
-- atribuídos em ordem de distribuição dentro do ano.
WITH base AS (
  SELECT numero_processo,
         max(CASE WHEN data_entrada_reclamatoria ~ '^\d{4}-\d{2}-\d{2}'
                  THEN substring(data_entrada_reclamatoria from 1 for 10)::date END) AS entrada,
         max(COALESCE(substring(numero_processo from '\.(\d{4})\.\d\.\d{2}\.')::int,
                      ano_processo::int)) AS ano,
         max(NULLIF(substring(numero_processo from '^(\d{7})'), '')::bigint) AS seq_cnj
    FROM public."JUR_PROCESSOS"
   GROUP BY numero_processo
), ordenado AS (
  SELECT numero_processo,
         row_number() OVER (
           ORDER BY COALESCE(entrada, make_date(COALESCE(ano, 1900), 1, 1)) ASC,
                    COALESCE(ano, 1900) ASC,
                    seq_cnj ASC NULLS LAST,
                    numero_processo ASC
         ) AS n
    FROM base
)
UPDATE public."JUR_PROCESSOS" p
   SET id_sequencial = o.n
  FROM ordenado o
 WHERE p.numero_processo = o.numero_processo
   AND p.id_sequencial IS DISTINCT FROM o.n;

CREATE INDEX IF NOT EXISTS jur_processos_id_sequencial_idx
    ON public."JUR_PROCESSOS" (id_sequencial DESC);

NOTIFY pgrst, 'reload schema';
