-- =========================================================================
-- Organograma: pares no MESMO nível (16/10/2026)
--
-- PEDIDO (Pablo, com print): "no organograma tenho que conseguir conectar
-- ambos no mesmo nível de hierarquia, o bigode, guiomar e helena". No topo
-- havia três cards (Guiomar, Antonio Vianei e Helena) e só a Helena tinha a
-- árvore embaixo; os outros dois ficavam soltos, sem linha nenhuma.
--
-- MODELO (sem tabela nova — a pessoa continua sendo o nó de "ORGANOGRAMA_NO")
--   par_grupo  text    — nome do grupo de pares ("Direção", "Proprietários"...).
--                        Irmãos (mesmo "reporta a") com o mesmo nome formam um
--                        grupo: aparecem lado a lado, ligados por uma barra.
--   do_grupo   boolean — o subordinado responde ao GRUPO inteiro, não só a um
--                        dos pares: a linha dele desce do meio do grupo.
--                        parent_id continua apontando para um dos pares, então
--                        a trava de ciclo e o "sobe os subordinados" seguem
--                        valendo sem mudar nada.
--
-- REGRA NOVA NO BANCO
--   · quem responde ao grupo não pode ficar pendurado num par que saiu do
--     grupo (ou foi tirado do organograma): passa para outro par do mesmo
--     grupo. Se o grupo acabou, o do_grupo é desligado ao apagar (senão a
--     pessoa iria parar no grupo do avô, que não tem nada a ver).
--     O gatilho de apagar se chama ..._grupo_antes_apagar para rodar ANTES do
--     trg_organograma_no_sobe_filhos (Postgres dispara em ordem alfabética).
--
-- organograma_nos() muda o tipo de retorno (par_grupo, do_grupo no fim) →
-- DROP antes do CREATE; o REVOKE/GRANT vai junto de novo.
--
-- Idempotente. Aplicar no banco do app. ROLLBACK no fim.
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
-- DROP TRIGGER IF EXISTS trg_organograma_no_grupo_antes_apagar ON public."ORGANOGRAMA_NO";
-- DROP TRIGGER IF EXISTS trg_organograma_no_grupo_depois_mudar ON public."ORGANOGRAMA_NO";
-- DROP FUNCTION IF EXISTS public.organograma_no_grupo_antes_apagar();
-- DROP FUNCTION IF EXISTS public.organograma_no_grupo_depois_mudar();
-- DROP FUNCTION IF EXISTS public.organograma_no_outro_par(public."ORGANOGRAMA_NO");
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP CONSTRAINT IF EXISTS organograma_no_par_grupo_valido;
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP COLUMN IF EXISTS do_grupo;
-- ALTER TABLE public."ORGANOGRAMA_NO" DROP COLUMN IF EXISTS par_grupo;
-- NOTIFY pgrst, 'reload schema';
