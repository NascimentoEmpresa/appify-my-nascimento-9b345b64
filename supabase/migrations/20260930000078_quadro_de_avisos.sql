-- =========================================================================
-- Quadro de Avisos — a tela de gestão do aviso que já existia
--
-- O aviso com ciência nasceu em 20260930000076: uma caixa no centro da tela
-- com CONCORDO/DISCORDO, publicada junto de Novidades. Este passo dá a ele o
-- que faltava para ser um quadro de avisos de verdade — categoria, resumo,
-- validade, público-alvo, anexo — e, principalmente, SEPARA as três regras
-- que antes vinham grudadas:
--
--   exigir_ciencia   — a pessoa precisa confirmar que leu?
--   bloquear_acesso  — enquanto não responder, ela fica presa no aviso?
--   permitir_escolha — ela escolhe CONCORDO/DISCORDO, ou só dá ciência?
--
-- Eram uma coisa só ("apareceu, tem que responder"), e é justamente essa
-- distinção que o pedido trouxe: um comunicado de recesso quer ciência sem
-- travar ninguém; uma mudança de norma trava.
--
-- ⚠ EVOLUI A TABELA QUE JÁ EXISTE, não cria outra.
--   Um "SISTEMA_AVISOS" paralelo deixaria o ERP com dois lugares mandando
--   caixa na cara das pessoas, cada um com sua regra de ciência — e o gate do
--   AppShell teria de escolher um. Quadro de Avisos é o nome da TELA; a
--   tabela continua sendo a das notificações.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

-- ── O aviso ──────────────────────────────────────────────────────────────
ALTER TABLE public."SISTEMA_NOTIFICACOES"
  ADD COLUMN IF NOT EXISTS categoria       text,
  ADD COLUMN IF NOT EXISTS resumo          text,
  ADD COLUMN IF NOT EXISTS expira_em       timestamptz,
  ADD COLUMN IF NOT EXISTS publico_alvo    text NOT NULL DEFAULT 'todos',
  ADD COLUMN IF NOT EXISTS anexo_url       text,
  ADD COLUMN IF NOT EXISTS anexo_nome      text,
  ADD COLUMN IF NOT EXISTS exigir_ciencia  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bloquear_acesso boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS permitir_escolha boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".publicado IS
  'Ativo (true) x Arquivado (false). É o "status" da tela — arquivar não apaga: o histórico de quem respondeu continua valendo.';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".expira_em IS
  'Depois desta data o aviso para de aparecer sozinho, sem ninguém precisar arquivar. NULL = não expira.';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".bloquear_acesso IS
  'Trava a tela até responder. Desligado, o aviso aparece e pode ser adiado — ver GateNotificacoes.';
COMMENT ON COLUMN public."SISTEMA_NOTIFICACOES".permitir_escolha IS
  'true = CONCORDO/DISCORDO; false = um "Estou ciente" só. A resposta guardada continua sendo a mesma coluna.';

-- Avisos que já existem foram criados quando tudo era obrigatório: mantêm o
-- comportamento antigo em vez de herdar defaults que mudariam o que a pessoa
-- já viu.
UPDATE public."SISTEMA_NOTIFICACOES"
   SET categoria = coalesce(categoria, 'Comunicado')
 WHERE categoria IS NULL;

-- ── A resposta ───────────────────────────────────────────────────────────
-- `lido_em` é separado de `respondido_em` de propósito: a tela de detalhes
-- mostra as duas datas, e a distância entre elas ("abriu 08:25, respondeu
-- 08:26") é o que diferencia quem leu de quem só clicou para tirar da frente.
ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA"
  ADD COLUMN IF NOT EXISTS lido_em    timestamptz,
  ADD COLUMN IF NOT EXISTS observacao text;

COMMENT ON COLUMN public."SISTEMA_NOTIFICACAO_CIENCIA".observacao IS
  'O que a pessoa escreveu ao responder — normalmente por que discordou.';

-- 'CIENTE' entra para o aviso que não oferece escolha. O CHECK é recriado
-- porque não há ALTER de constraint: DROP + ADD, como toda policy aqui.
ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA"
  DROP CONSTRAINT IF EXISTS "SISTEMA_NOTIFICACAO_CIENCIA_escolha_check";
ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA"
  ADD CONSTRAINT "SISTEMA_NOTIFICACAO_CIENCIA_escolha_check"
  CHECK (escolha IN ('CONCORDO', 'DISCORDO', 'CIENTE'));

-- ── A tela ───────────────────────────────────────────────────────────────
-- Um menu, como toda tela nova (ver o README). Quem publica continua sendo
-- quem publica Novidades; este menu é quem ENXERGA o quadro.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'central_servicos_quadro_avisos', 'Quadro de Avisos',
       '/app/central-servicos/quadro-avisos', 45, true
  FROM public.app_modulo m
 WHERE m.codigo = 'central_servicos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Excluir aviso é destrutivo (leva o histórico de ciência junto, por CASCADE),
-- então ganha switch próprio — não vem no "liberar a tela".
-- Conferido em 10/09/2026, depois de a revisao automatica apontar as duas
-- coisas abaixo como bloqueadoras. Nenhuma das duas procede:
--
-- 1) "O toggle nao concede `excluir`, entao ninguem apaga aviso."
--    O toggle nao concede mesmo — e o `ACOES_DO_TOGGLE_PADRAO` de
--    ModulosMenusTab.tsx diz por que, na propria linha: "liberar a tela nao e
--    autorizar apagar registro". Mas `excluir` NAO fica inalcancavel: acao
--    fora do pacote ganha SWITCH PROPRIO na mesma tela de Acesso por Usuario,
--    gravado pelo laco de `pendingAcoes`. O switch so aparece se o menu tiver
--    a acao em `app_menu_acao` — que e exatamente o que o INSERT abaixo faz.
--    Testado (transacao + ROLLBACK, usuario sem perfil nenhum):
--      com o switch de excluir ligado  -> DELETE apagou 1 linha;
--      sem o switch                    -> DELETE apagou 0. A RLS recusou.
--
-- 2) "Sem seed em perfil_acesso_permissao o menu fica aberto (fail-open)."
--    E o contrario: sem permissao nenhuma o menu fica FECHADO, que e o
--    `ACESSO_ABERTO_SEM_PERMISSOES = false` do src/lib/acesso.ts. Medido no
--    banco com tres usuarios sem perfil e sem toggle: list_accessible_menus
--    devolveu 0 para este codigo e pode_gerir_avisos() deu false nos tres.
--    Semear o menu num perfil daria o Quadro de Avisos a quem hoje nao tem —
--    o oposto do que uma revisao de permissao deveria produzir.

INSERT INTO public.app_menu_acao (menu_codigo, acao)
VALUES
  ('central_servicos_quadro_avisos', 'visualizar'::app_acao),
  ('central_servicos_quadro_avisos', 'incluir'::app_acao),
  ('central_servicos_quadro_avisos', 'alterar'::app_acao),
  ('central_servicos_quadro_avisos', 'excluir'::app_acao)
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── Quem gere o quadro ───────────────────────────────────────────────────
-- Até aqui, escrever avisos era só de quem publica Novidades. O menu novo
-- entra AO LADO desse, nunca no lugar: quem já publicava continua publicando
-- sem ninguém precisar reconfigurar nada, e agora dá para conceder o Quadro
-- de Avisos a quem não mexe no changelog do ERP.
--
-- Uma função para as duas fontes, em vez do OR repetido em seis policies —
-- quando aparecer a terceira, muda num lugar só.
CREATE OR REPLACE FUNCTION public.pode_gerir_avisos(_user uuid, _acao app_acao)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_screen_access(_user, 'novidades_publicar', 'incluir'::app_acao)
      OR public.has_screen_access(_user, 'central_servicos_quadro_avisos', _acao);
$$;

REVOKE ALL ON FUNCTION public.pode_gerir_avisos(uuid, app_acao) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pode_gerir_avisos(uuid, app_acao) FROM anon;
GRANT EXECUTE ON FUNCTION public.pode_gerir_avisos(uuid, app_acao) TO authenticated;

DROP POLICY IF EXISTS sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_ler ON public."SISTEMA_NOTIFICACOES" FOR SELECT TO authenticated
  USING (publicado OR public.pode_gerir_avisos(auth.uid(), 'visualizar'::app_acao));

DROP POLICY IF EXISTS sistema_notificacoes_incluir ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_incluir ON public."SISTEMA_NOTIFICACOES" FOR INSERT TO authenticated
  WITH CHECK (public.pode_gerir_avisos(auth.uid(), 'incluir'::app_acao));

DROP POLICY IF EXISTS sistema_notificacoes_alterar ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_alterar ON public."SISTEMA_NOTIFICACOES" FOR UPDATE TO authenticated
  USING (public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao))
  WITH CHECK (public.pode_gerir_avisos(auth.uid(), 'alterar'::app_acao));

DROP POLICY IF EXISTS sistema_notificacoes_excluir ON public."SISTEMA_NOTIFICACOES";
CREATE POLICY sistema_notificacoes_excluir ON public."SISTEMA_NOTIFICACOES" FOR DELETE TO authenticated
  USING (public.pode_gerir_avisos(auth.uid(), 'excluir'::app_acao));

-- O painel de respostas: quem gere o quadro lê a ciência de todos; cada um
-- continua lendo a própria.
DROP POLICY IF EXISTS sistema_notif_ciencia_ler ON public."SISTEMA_NOTIFICACAO_CIENCIA";
CREATE POLICY sistema_notif_ciencia_ler ON public."SISTEMA_NOTIFICACAO_CIENCIA" FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.pode_gerir_avisos(auth.uid(), 'visualizar'::app_acao));

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- (as policies voltam ao gate único de novidades_publicar — ver 20260930000076)
-- DROP FUNCTION IF EXISTS public.pode_gerir_avisos(uuid, app_acao);
-- DELETE FROM public.app_menu_acao WHERE menu_codigo = 'central_servicos_quadro_avisos';
-- DELETE FROM public.app_menu      WHERE codigo      = 'central_servicos_quadro_avisos';
--
-- ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA"
--   DROP CONSTRAINT IF EXISTS "SISTEMA_NOTIFICACAO_CIENCIA_escolha_check";
-- ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA"
--   ADD CONSTRAINT "SISTEMA_NOTIFICACAO_CIENCIA_escolha_check" CHECK (escolha IN ('CONCORDO','DISCORDO'));
-- ALTER TABLE public."SISTEMA_NOTIFICACAO_CIENCIA" DROP COLUMN IF EXISTS observacao, DROP COLUMN IF EXISTS lido_em;
--
-- ALTER TABLE public."SISTEMA_NOTIFICACOES"
--   DROP COLUMN IF EXISTS permitir_escolha, DROP COLUMN IF EXISTS bloquear_acesso,
--   DROP COLUMN IF EXISTS exigir_ciencia,   DROP COLUMN IF EXISTS anexo_nome,
--   DROP COLUMN IF EXISTS anexo_url,        DROP COLUMN IF EXISTS publico_alvo,
--   DROP COLUMN IF EXISTS expira_em,        DROP COLUMN IF EXISTS resumo,
--   DROP COLUMN IF EXISTS categoria;
-- NOTIFY pgrst, 'reload schema';
