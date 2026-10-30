-- =========================================================================
-- Organograma: pares no mesmo nível — REAPLICA no cluster (30/10/2026)
--
-- SINTOMA (Pablo, com print): "tenho que conseguir conectar esses na mesma
-- hierarquia" / "as linhas ainda não ficam aparecendo". Guiomar, Antonio
-- Vianei e Helena seguem como três cards soltos no topo, sem o quadro do
-- grupo nem a barra entre eles, mesmo depois de juntá-los em "Mesmo nível".
--
-- CAUSA: a mig 20261016000030 entrou na Supabase antiga na tarde da virada
-- (16/10). As FUNÇÕES não vieram na replicação para o cluster (mesmo caso das
-- tvg_*/tv_* — migs 20261019000005 e 20261020000002), então a
-- organograma_nos() do cluster é a da mig 280: não devolve par_grupo nem
-- do_grupo. O Editar grava o grupo, mas a leitura nunca o traz de volta e a
-- tela monta a árvore como se ninguém tivesse par. Sem erro em lugar nenhum.
-- O desenho (barra .org-par) foi conferido à parte e está certo.
--
-- O QUE FAZ: reexecuta a 20261016000030 inteira, sem mudar nada — colunas
-- (IF NOT EXISTS), constraint, organograma_no_outro_par, os dois gatilhos de
-- grupo e a organograma_nos() com par_grupo/do_grupo. Idempotente: no banco
-- que já tinha tudo, só recria igual.
-- =========================================================================

ALTER TABLE public."ORGANOGRAMA_NO" ADD COLUMN IF NOT EXISTS par_grupo text;
ALTER TABLE public."ORGANOGRAMA_NO" ADD COLUMN IF NOT EXISTS do_grupo boolean NOT NULL DEFAULT false;

ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT IF EXISTS organograma_no_par_grupo_valido;
ALTER TABLE public."ORGANOGRAMA_NO"
  ADD CONSTRAINT organograma_no_par_grupo_valido CHECK (par_grupo IS NULL OR (btrim(par_grupo) <> '' AND length(par_grupo) <= 60));

-- Outro par do mesmo grupo de OLD (mesmo chefe, mesmo do_grupo, mesmo nome).
CREATE OR REPLACE FUNCTION public.organograma_no_outro_par(p_old public."ORGANOGRAMA_NO")
RETURNS uuid LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT o.id FROM public."ORGANOGRAMA_NO" o
   WHERE o.id <> p_old.id
     AND o.parent_id IS NOT DISTINCT FROM p_old.parent_id
     AND o.do_grupo = p_old.do_grupo
     AND lower(btrim(o.par_grupo)) = lower(btrim(p_old.par_grupo))
   ORDER BY o.ordem, o.id
   LIMIT 1
$$;

-- Par saiu do grupo (trocou o nome, o chefe ou o do_grupo): a equipe que
-- responde ao grupo passa para outro par que ficou. Se o grupo inteiro se
-- mudou junto (ninguém ficou para trás), não há o que fazer.
CREATE OR REPLACE FUNCTION public.organograma_no_grupo_depois_mudar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  IF OLD.par_grupo IS NULL THEN RETURN NEW; END IF;
  IF NEW.par_grupo IS NOT NULL
     AND lower(btrim(NEW.par_grupo)) = lower(btrim(OLD.par_grupo))
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.do_grupo = OLD.do_grupo THEN
    RETURN NEW;
  END IF;
  v := public.organograma_no_outro_par(OLD);
  IF v IS NOT NULL THEN
    UPDATE public."ORGANOGRAMA_NO" SET parent_id = v WHERE parent_id = OLD.id AND do_grupo;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_organograma_no_grupo_depois_mudar ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_grupo_depois_mudar
  AFTER UPDATE OF par_grupo, parent_id, do_grupo ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_no_grupo_depois_mudar();

-- Tirar um par do organograma: quem responde ao grupo vai para outro par;
-- sem outro par, vira subordinado comum (o sobe_filhos leva para o avô).
CREATE OR REPLACE FUNCTION public.organograma_no_grupo_antes_apagar()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  IF OLD.par_grupo IS NOT NULL THEN v := public.organograma_no_outro_par(OLD); END IF;
  IF v IS NOT NULL THEN
    UPDATE public."ORGANOGRAMA_NO" SET parent_id = v WHERE parent_id = OLD.id AND do_grupo;
  ELSE
    UPDATE public."ORGANOGRAMA_NO" SET do_grupo = false WHERE parent_id = OLD.id AND do_grupo;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_organograma_no_grupo_antes_apagar ON public."ORGANOGRAMA_NO";
CREATE TRIGGER trg_organograma_no_grupo_antes_apagar
  BEFORE DELETE ON public."ORGANOGRAMA_NO"
  FOR EACH ROW EXECUTE FUNCTION public.organograma_no_grupo_antes_apagar();

-- Leitura: mesmas colunas da mig 280 + par_grupo, do_grupo.
DROP FUNCTION IF EXISTS public.organograma_nos();
CREATE FUNCTION public.organograma_nos()
RETURNS TABLE (
  id uuid, user_id uuid, parent_id uuid, ordem integer, funcao_manual text,
  nome text, email text, avatar_url text, cargo text, setor text, ativo boolean, cor text,
  par_grupo text, do_grupo boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_access(auth.uid(), 'organograma', 'visualizar'::app_acao) THEN
    RAISE EXCEPTION 'Sem acesso ao Organograma.';
  END IF;
  RETURN QUERY
  SELECT o.id, o.user_id, o.parent_id, o.ordem, nullif(btrim(o.funcao), ''),
         coalesce(nullif(btrim(p.display_name), ''), p.email, 'Usuário'),
         p.email, p.avatar_url,
         coalesce(nullif(btrim(e."Título do Cargo"), ''), nullif(btrim(p.cargo), '')),
         coalesce(nullif(btrim(e."Setor_ERP"), ''), (SELECT min(us.setor) FROM public.user_setor us WHERE us.user_id = o.user_id)),
         coalesce(p.ativo, false),
         o.cor,
         nullif(btrim(o.par_grupo), ''),
         o.do_grupo
    FROM public."ORGANOGRAMA_NO" o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    LEFT JOIN LATERAL (
      SELECT x."Título do Cargo", x."Setor_ERP" FROM public."EMPREGADOS" x
       WHERE x.auth_user_id = o.user_id
       ORDER BY (x."Situação" = 'Trabalhando') DESC NULLS LAST, x."ID" DESC LIMIT 1
    ) e ON true
   ORDER BY o.ordem, 6;
END;
$$;
REVOKE ALL ON FUNCTION public.organograma_nos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.organograma_nos() TO authenticated;

REVOKE ALL ON FUNCTION public.organograma_no_outro_par(public."ORGANOGRAMA_NO") FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- DROP FUNCTION IF EXISTS public.organograma_nos();
-- -- (reexecutar o CREATE de organograma_nos() da 20260930000280_organograma_cor_do_card.sql)
-- -- ⚠ Não desfazer as colunas sem antes conferir: no banco em que a 20261016000030 já valia, este ROLLBACK apaga os grupos montados.
-- DROP TRIGGER IF EXISTS trg_organograma_no_grupo_antes_apagar ON public."ORGANOGRAMA_NO";
-- DROP TRIGGER IF EXISTS trg_organograma_no_grupo_depois_mudar ON public."ORGANOGRAMA_NO";
-- DROP FUNCTION IF EXISTS public.organograma_no_grupo_antes_apagar();
-- DROP FUNCTION IF EXISTS public.organograma_no_grupo_depois_mudar();
-- DROP FUNCTION IF EXISTS public.organograma_no_outro_par(public."ORGANOGRAMA_NO");
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT IF EXISTS organograma_no_par_grupo_valido;
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP COLUMN IF EXISTS do_grupo;
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP COLUMN IF EXISTS par_grupo;
-- NOTIFY pgrst, 'reload schema';
