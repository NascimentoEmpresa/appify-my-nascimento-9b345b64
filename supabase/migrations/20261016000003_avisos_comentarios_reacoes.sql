-- =========================================================================
-- Quadro de Avisos: comentários (inclusive anônimos) e reações com emoji
--
-- Pedido do Pablo em 16/10/2026: "quero uma opção também de liberar as
-- pessoas pra comentar, se quiser comentar anonimamente também, os
-- comentários ficam no aviso, podendo reagir com emojis também".
--
--   SISTEMA_NOTIFICACOES.permitir_comentarios  quem recebeu comenta e reage
--   SISTEMA_NOTIFICACOES.permitir_anonimo      o comentário pode ir sem nome
--   Os dois nascem false: aviso antigo continua sem comentário nenhum.
--
-- POR QUE NÃO O FEED ÚNICO SISTEMA_COMENTARIOS (consolidação de jun/2026)
--   A política dele é uma só, FOR ALL USING (true): qualquer pessoa logada lê
--   e grava qualquer linha. Políticas permissivas somam com OR, então não há
--   como dizer "só quem é alvo do aviso lê" sem mexer naquela — e ela serve
--   demissão, advertência, férias, processo. Também não tem coluna de autor
--   (só nome/CPF em texto), e a reação precisa de dono para "tirar a minha".
--   Daí as duas tabelas abaixo, filhas do aviso (ON DELETE CASCADE).
--
-- ANÔNIMO É ANÔNIMO NO BANCO
--   O gatilho sistema_notif_comentario_autor apaga user_id e autor_nome ANTES
--   de gravar quando anonimo = true — o mesmo desenho do anonimato dos
--   formulários. Não há coluna escondida com o autor. Consequência aceita: o
--   autor de um comentário anônimo não consegue apagá-lo depois (o banco não
--   sabe que é dele); quem gerencia o Quadro (excluir) apaga qualquer um.
--   No comentário com nome, o nome vem do profile no servidor, nunca do
--   navegador — não dá para comentar "como" outra pessoa.
--
-- RLS
--   ler      quem gerencia o Quadro, ou o aviso está publicado e é para mim
--            (notificacao_para_mim — a mesma regra do aviso)
--   gravar   aviso publicado, vigente, com comentários liberados, e para mim
--   apagar   o próprio comentário/reação, ou quem tem excluir no Quadro
--   Sem UPDATE: comentário não se edita (editar depois de reagirem muda o
--   sentido do que os outros reagiram).
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS permitir_comentarios boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permitir_anonimo     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".permitir_comentarios IS
  'Quem recebeu o aviso pode comentar e reagir com emoji. Migration 20261016000003.';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".permitir_anonimo IS
  'O comentário pode ir sem nome (o autor não é gravado). Só vale com permitir_comentarios.';

CREATE TABLE IF NOT EXISTS public."SISTEMA_NOTIFICACAO_COMENTARIO" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacao_id  bigint      NOT NULL REFERENCES public."SISTEMA_NOTIFICACOES"(id) ON DELETE CASCADE,
  -- NULL quando anônimo — o gatilho apaga.
  user_id         uuid        DEFAULT auth.uid(),
  autor_nome      text,
  anonimo         boolean     NOT NULL DEFAULT false,
  texto           text        NOT NULL CHECK (char_length(btrim(texto)) BETWEEN 1 AND 1000),
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sistema_notif_comentario_aviso_idx
  ON public."SISTEMA_NOTIFICACAO_COMENTARIO" (notificacao_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public."SISTEMA_NOTIFICACAO_REACAO" (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacao_id  bigint      NOT NULL REFERENCES public."SISTEMA_NOTIFICACOES"(id) ON DELETE CASCADE,
  -- NULL = reação ao aviso; preenchido = reação a um comentário.
  comentario_id   bigint      REFERENCES public."SISTEMA_NOTIFICACAO_COMENTARIO"(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL DEFAULT auth.uid(),
  emoji           text        NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '😮', '😢', '👏', '🎉', '🙏')),
  criado_em       timestamptz NOT NULL DEFAULT now()
);
-- Um mesmo emoji uma vez por pessoa em cada alvo (aviso ou comentário).
CREATE UNIQUE INDEX IF NOT EXISTS sistema_notif_reacao_unica_idx
  ON public."SISTEMA_NOTIFICACAO_REACAO" (notificacao_id, coalesce(comentario_id, 0), user_id, emoji);

COMMENT ON TABLE public."SISTEMA_NOTIFICACAO_COMENTARIO" IS
  'Comentários de um aviso do Quadro. Anônimo = sem user_id/autor_nome (apagados pelo gatilho). Migration 20261016000003.';
COMMENT ON TABLE public."SISTEMA_NOTIFICACAO_REACAO" IS
  'Reações com emoji ao aviso (comentario_id NULL) ou a um comentário. Migration 20261016000003.';

-- Pode ver o aviso (e portanto os comentários dele)?
CREATE OR REPLACE FUNCTION public.aviso_pode_ver(_notificacao bigint, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.pode_gerir_avisos(_user, 'visualizar'::app_acao)
      OR EXISTS (SELECT 1 FROM public."SISTEMA_NOTIFICACOES" n
                  WHERE n.id = _notificacao AND n.publicado AND public.notificacao_para_mim(n.id, _user));
$fn$;

-- Pode comentar/reagir? Aviso publicado, vigente, liberado, e para mim.
CREATE OR REPLACE FUNCTION public.aviso_pode_comentar(_notificacao bigint, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public."SISTEMA_NOTIFICACOES" n
                  WHERE n.id = _notificacao AND n.publicado AND n.permitir_comentarios
                    AND (n.expira_em IS NULL OR n.expira_em >= now())
                    AND public.notificacao_para_mim(n.id, _user));
$fn$;

REVOKE ALL ON FUNCTION public.aviso_pode_ver(bigint, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.aviso_pode_comentar(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aviso_pode_ver(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aviso_pode_comentar(bigint, uuid) TO authenticated;

-- O autor: anônimo some; com nome, vem do profile (não do navegador).
CREATE OR REPLACE FUNCTION public.sistema_notif_comentario_autor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.texto := btrim(NEW.texto);
  IF NEW.anonimo THEN
    IF NOT EXISTS (SELECT 1 FROM public."SISTEMA_NOTIFICACOES" n
                    WHERE n.id = NEW.notificacao_id AND n.permitir_anonimo) THEN
      RAISE EXCEPTION 'Este aviso não aceita comentário anônimo.' USING ERRCODE = '42501';
    END IF;
    NEW.user_id := NULL;
    NEW.autor_nome := NULL;
  ELSE
    NEW.user_id := auth.uid();
    NEW.autor_nome := (SELECT coalesce(nullif(btrim(p.display_name), ''), p.email)
                         FROM public.profiles p WHERE p.id = auth.uid());
  END IF;
  NEW.criado_em := now();
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS sistema_notif_comentario_autor ON public."SISTEMA_NOTIFICACAO_COMENTARIO";
CREATE TRIGGER sistema_notif_comentario_autor
  BEFORE INSERT ON public."SISTEMA_NOTIFICACAO_COMENTARIO"
  FOR EACH ROW EXECUTE FUNCTION public.sistema_notif_comentario_autor();

ALTER TABLE public."SISTEMA_NOTIFICACAO_COMENTARIO" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SISTEMA_NOTIFICACAO_REACAO" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sistema_notif_comentario_ler ON public."SISTEMA_NOTIFICACAO_COMENTARIO";
CREATE POLICY sistema_notif_comentario_ler ON public."SISTEMA_NOTIFICACAO_COMENTARIO" FOR SELECT TO authenticated
  USING (public.aviso_pode_ver(notificacao_id, auth.uid()));

-- O WITH CHECK roda DEPOIS do gatilho: anônimo chega aqui já sem user_id.
DROP POLICY IF EXISTS sistema_notif_comentario_gravar ON public."SISTEMA_NOTIFICACAO_COMENTARIO";
CREATE POLICY sistema_notif_comentario_gravar ON public."SISTEMA_NOTIFICACAO_COMENTARIO" FOR INSERT TO authenticated
  WITH CHECK (public.aviso_pode_comentar(notificacao_id, auth.uid())
              AND (user_id = auth.uid() OR (anonimo AND user_id IS NULL)));

DROP POLICY IF EXISTS sistema_notif_comentario_apagar ON public."SISTEMA_NOTIFICACAO_COMENTARIO";
CREATE POLICY sistema_notif_comentario_apagar ON public."SISTEMA_NOTIFICACAO_COMENTARIO" FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.pode_gerir_avisos(auth.uid(), 'excluir'::app_acao));

DROP POLICY IF EXISTS sistema_notif_reacao_ler ON public."SISTEMA_NOTIFICACAO_REACAO";
CREATE POLICY sistema_notif_reacao_ler ON public."SISTEMA_NOTIFICACAO_REACAO" FOR SELECT TO authenticated
  USING (public.aviso_pode_ver(notificacao_id, auth.uid()));

DROP POLICY IF EXISTS sistema_notif_reacao_gravar ON public."SISTEMA_NOTIFICACAO_REACAO";
CREATE POLICY sistema_notif_reacao_gravar ON public."SISTEMA_NOTIFICACAO_REACAO" FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.aviso_pode_comentar(notificacao_id, auth.uid()));

DROP POLICY IF EXISTS sistema_notif_reacao_apagar ON public."SISTEMA_NOTIFICACAO_REACAO";
CREATE POLICY sistema_notif_reacao_apagar ON public."SISTEMA_NOTIFICACAO_REACAO" FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.pode_gerir_avisos(auth.uid(), 'excluir'::app_acao));

REVOKE ALL ON public."SISTEMA_NOTIFICACAO_COMENTARIO", public."SISTEMA_NOTIFICACAO_REACAO" FROM anon;
GRANT SELECT, INSERT, DELETE ON public."SISTEMA_NOTIFICACAO_COMENTARIO", public."SISTEMA_NOTIFICACAO_REACAO" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
-- DROP TABLE IF EXISTS public."SISTEMA_NOTIFICACAO_REACAO";
-- DROP TABLE IF EXISTS public."SISTEMA_NOTIFICACAO_COMENTARIO";
-- DROP FUNCTION IF EXISTS public.sistema_notif_comentario_autor(), public.aviso_pode_comentar(bigint, uuid), public.aviso_pode_ver(bigint, uuid);
-- ALTER TABLE public."SISTEMA_NOTIFICACOES" DROP COLUMN IF EXISTS permitir_anonimo, DROP COLUMN IF EXISTS permitir_comentarios;
