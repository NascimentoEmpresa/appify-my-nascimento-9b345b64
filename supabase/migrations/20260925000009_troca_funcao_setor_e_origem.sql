-- =========================================================================
-- TROCA DE FUNÇÃO — setor no pedido, origem virou filtro, e o UPDATE volta
-- a funcionar
--
-- TRÊS COISAS, e a primeira é conserto de produção.
--
-- 1) O UPDATE ESTAVA QUEBRADO DESDE O DIA 1.
--    A 20260925000004 pendurou o trigger `set_updated_at()` na tabela, mas
--    essa função grava `NEW.updated_at` e a coluna aqui chama
--    `atualizado_em`. Resultado: TODA alteração na tabela morria com
--       record "new" has no field "updated_at"
--    — aprovar, reprovar, marcar ASO, concluir. Nada do fluxo andava; o
--    print do erro veio da tela de aprovação do escritório. A função
--    `set_updated_at` é usada por dezenas de tabelas que TÊM `updated_at`,
--    então não dá para mexer nela: o certo é uma irmã que grava a coluna em
--    português, que é como o resto das tabelas de solicitação nomeia.
--
-- 2) SETOR no pedido (opcional). Não roteia nada, não concede nada — é para
--    o gerente filtrar a fila por setor do mesmo jeito que filtra por
--    contrato. Referencia `setor_catalogo` só de leitura, sem FK: o pedido é
--    um registro histórico e não pode sumir de vista porque alguém renomeou
--    um setor seis meses depois.
--
-- 3) O ESCRITÓRIO DEIXA DE SER TELA e vira FILTRO dentro da Mudança de
--    Função. O menu `escritorio_troca_funcao` CONTINUA EXISTINDO e continua
--    sendo o que libera ver o administrativo — muda só o que ele aponta: as
--    duas rotas caem na mesma tela, e cada um enxerga a origem que sua
--    permissão libera. Ninguém perde acesso e ninguém ganha: quem só tinha
--    escritório continua vendo só escritório.
--
-- 4) O SST pode DISPENSAR o ASO — nem toda troca de função exige exame
--    novo, e sem isso o card ficava parado esperando uma data que não ia
--    existir. Dispensar segue para o RH igual; o que muda é o registro.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) O trigger que quebrava todo UPDATE ────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_atualizado_em()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_stf_atualizado ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_stf_atualizado BEFORE UPDATE ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.set_atualizado_em();

-- ── 2) Setor e dispensa de ASO ───────────────────────────────────────────
ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  ADD COLUMN IF NOT EXISTS setor              TEXT,
  ADD COLUMN IF NOT EXISTS sst_aso_dispensado BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_TROCA_FUNCAO".setor IS
  'Setor informado no pedido (opcional). Só filtro — não roteia nem concede nada.';
COMMENT ON COLUMN public."SISTEMA_SOLICITACOES_TROCA_FUNCAO".sst_aso_dispensado IS
  'O SST liberou a troca sem exame novo. Vai para o RH igual, sem sst_aso_data.';

CREATE INDEX IF NOT EXISTS stf_setor_idx ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"(setor);

-- ── 3) O menu do escritório: mesma permissão, tela nova ──────────────────
-- O código e a rota NÃO mudam: o código é o que carrega a permissão de quem
-- já tem, e a rota é a porta de entrada de quem só tem essa (a Fernanda não
-- precisa ganhar o menu do Operacional para aprovar o administrativo). O que
-- muda é o outro lado: as duas rotas passam a renderizar a MESMA tela, e o
-- recorte vira permissão dentro dela. Aqui só cai o "— Escritório" do
-- rótulo, que descrevia uma tela separada que não existe mais.
UPDATE public.app_menu
   SET nome = 'Mudança de Função — Aprovação'
 WHERE codigo = 'escritorio_troca_funcao'
   AND nome IS DISTINCT FROM 'Mudança de Função — Aprovação';

-- ── 4) Conferência ───────────────────────────────────────────────────────
SELECT m.codigo AS modulo, x.codigo AS menu, x.nome, x.rota, x.ativo
  FROM public.app_menu x JOIN public.app_modulo m ON m.id = x.modulo_id
 WHERE x.codigo LIKE '%troca_funcao%'
 ORDER BY m.codigo, x.codigo;

-- Quem enxerga o quê depois da junção (esperado: nada mudou de dono).
SELECT pa.nome AS perfil, pap.menu_codigo,
       string_agg(pap.acao::text, ', ' ORDER BY pap.acao::text) AS acoes
  FROM public.perfil_acesso pa
  JOIN public.perfil_acesso_permissao pap ON pap.perfil_id = pa.id AND pap.allow
 WHERE pap.menu_codigo LIKE '%troca_funcao%'
 GROUP BY 1, 2 ORDER BY 1, 2;

-- O trigger consertado: tem que devolver uma linha só, com set_atualizado_em.
SELECT t.tgname, p.proname
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = 'public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"'::regclass
   AND NOT t.tgisinternal;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_stf_atualizado ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
--   CREATE TRIGGER trg_stf_atualizado BEFORE UPDATE ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
--     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();   -- (volta a quebrar!)
--   ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
--     DROP COLUMN IF EXISTS setor, DROP COLUMN IF EXISTS sst_aso_dispensado;
--   UPDATE public.app_menu SET nome = 'Mudança de Função — Escritório'
--    WHERE codigo = 'escritorio_troca_funcao';
--   DROP FUNCTION IF EXISTS public.set_atualizado_em();
-- =========================================================================
