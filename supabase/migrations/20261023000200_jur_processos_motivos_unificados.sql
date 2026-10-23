-- =========================================================================
-- Jurídico › Processos: motivos com grafias diferentes viram UM nome (23/10/2026)
--
-- Pablo: "junta os nomes que estão repetidos" — ex.: "Indenização por Dano
-- Material" e "Indenização por danos materiais" apareciam como dois motivos
-- no filtro, no ranking e no formulário. O motivo mora em texto livre, uma
-- linha por motivo em JUR_PROCESSOS.motivos, e cada grafia digitada virava
-- uma opção.
--
-- REGRA (a mesma de chaveMotivo em src/lib/juridico/motivos.ts — mudou lá,
-- muda aqui): dois textos são o MESMO motivo quando ficam iguais sem acento,
-- sem maiúscula, com espaços colapsados e plural → singular palavra por
-- palavra (…ais → …al, …eis → …el, …ois → …ol, …ões/…ães → …ão, senão tira o
-- "s" final). Cada grupo passa a usar o nome MAIS USADO (empate: ordem
-- alfabética). Só o texto do motivo muda: valores, ordem e o resto da linha
-- ficam como estão.
--
-- BACKUP: toda linha alterada vai antes para JUR_PROCESSOS_MOTIVO_UNIF_BKP
-- (id, numero_processo, motivo_ordem, antes, depois). O ROLLBACK usa
-- numero_processo + motivo_ordem, não o id — salvar o processo recria as
-- linhas e troca o id.
--
-- Idempotente: na segunda vez não acha nada para mudar.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.jur_motivo_chave(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $fn$
  SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           btrim(regexp_replace(lower(regexp_replace(normalize(coalesce(p, ''), NFD), '[̀-ͯ]', '', 'g')), '\s+', ' ', 'g')),
           '([a-z]{2,})ais\M', '\1al', 'g'),
           '([a-z]{2,})eis\M', '\1el', 'g'),
           '([a-z]{2,})ois\M', '\1ol', 'g'),
           '([a-z]{2,})[oa]es\M', '\1ao', 'g'),
           '([a-z]{3,})s\M', '\1', 'g');
$fn$;
REVOKE ALL ON FUNCTION public.jur_motivo_chave(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jur_motivo_chave(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public."JUR_PROCESSOS_MOTIVO_UNIF_BKP" (
  id bigint,
  numero_processo text,
  motivo_ordem integer,
  antes text,
  depois text,
  em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public."JUR_PROCESSOS_MOTIVO_UNIF_BKP" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."JUR_PROCESSOS_MOTIVO_UNIF_BKP" FROM anon, authenticated;

CREATE TEMP TABLE _jur_motivo_novo ON COMMIT DROP AS
WITH uso AS (
  SELECT public.jur_motivo_chave(motivos) AS k,
         btrim(regexp_replace(motivos, '\s+', ' ', 'g')) AS nome,
         count(*) AS n
    FROM public."JUR_PROCESSOS"
   WHERE btrim(coalesce(motivos, '')) <> ''
   GROUP BY 1, 2),
canon AS (SELECT DISTINCT ON (k) k, nome FROM uso ORDER BY k, n DESC, nome)
SELECT p.id, p.numero_processo, p.motivo_ordem, p.motivos AS antes, c.nome AS depois
  FROM public."JUR_PROCESSOS" p
  JOIN canon c ON c.k = public.jur_motivo_chave(p.motivos)
 WHERE btrim(coalesce(p.motivos, '')) <> ''
   AND p.motivos IS DISTINCT FROM c.nome;

INSERT INTO public."JUR_PROCESSOS_MOTIVO_UNIF_BKP" (id, numero_processo, motivo_ordem, antes, depois)
SELECT id, numero_processo, motivo_ordem, antes, depois FROM _jur_motivo_novo;

UPDATE public."JUR_PROCESSOS" p
   SET motivos = n.depois
  FROM _jur_motivo_novo n
 WHERE p.id = n.id;

NOTIFY pgrst, 'reload schema';

-- Conferência (pgAdmin): o que foi juntado, grafia antiga → nome final.
-- SELECT antes, depois, count(*) FROM public."JUR_PROCESSOS_MOTIVO_UNIF_BKP"
--  GROUP BY 1, 2 ORDER BY depois, antes;

-- ROLLBACK
-- UPDATE public."JUR_PROCESSOS" p SET motivos = b.antes
--   FROM public."JUR_PROCESSOS_MOTIVO_UNIF_BKP" b
--  WHERE p.numero_processo = b.numero_processo AND p.motivo_ordem = b.motivo_ordem AND p.motivos = b.depois;
-- DROP TABLE public."JUR_PROCESSOS_MOTIVO_UNIF_BKP";
-- DROP FUNCTION public.jur_motivo_chave(text);
-- NOTIFY pgrst, 'reload schema';
