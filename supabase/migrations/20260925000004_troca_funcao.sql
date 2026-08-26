-- =========================================================================
-- TROCA DE FUNÇÃO — encarregado → aprovação → SST → RH
--
-- O FLUXO
--   1. O ENCARREGADO escolhe o colaborador. O cargo ATUAL vem de EMPREGADOS
--      (não se digita) e ele informa só o cargo novo e o porquê.
--   2. APROVA quem cuida daquela gente:
--        contrato   → Operacional;
--        escritório → o administrativo (Fernanda / Senilton).
--      Reprovar EXIGE motivo — sem isso o encarregado não sabe o que fazer.
--   3. O SST marca o ASO de mudança de função.
--   4. O RH faz a alteração na Senior e conclui.
--
--   Pendente Operacional ─┐
--                         ├→ Pendente SST → Pendente RH → Concluída
--   Pendente Escritório  ─┘
--          ↘ Reprovada
--
-- CONTRATO vs ESCRITÓRIO sai da coluna "Descrição do Local" da EMPREGADOS,
-- resolvido no MOMENTO do pedido e congelado em `e_escritorio`. Congelar é
-- de propósito: se a pessoa mudar de local no meio do caminho, a
-- solicitação não pode trocar de fila e sumir da mão de quem já estava
-- decidindo. A mesma regra vive em src/lib/trocaFuncao/solicitacao.ts, para
-- a tela saber antes de gravar; quem decide na gravação é o DEFAULT daqui.
--
-- ACESSO: nenhum arquivo novo de permissão. Cinco menus em app_menu, um por
-- público, no padrão de `solicitacoes_demissao` (20260909000005): RLS
-- liberada para authenticated e o controle no menu/RouteGuard, que é como
-- todo o fluxo do encarregado já funciona.
--
-- Idempotente.
-- ROLLBACK: no fim do arquivo.
-- =========================================================================

-- ── 1) A solicitação ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" (
  id                    BIGSERIAL PRIMARY KEY,

  -- Quem pediu (o encarregado logado).
  solicitante_nome      TEXT,
  solicitante_email     TEXT,

  -- Quem vai mudar de função. `colaborador_id` é o ID em EMPREGADOS e é a
  -- prova de que a pessoa foi ESCOLHIDA na lista, não digitada à mão.
  colaborador_id        BIGINT,
  colaborador_nome      TEXT,
  colaborador_cpf       TEXT,
  colaborador_admissao  DATE,

  -- O cargo de hoje vem do cadastro; o novo é o que se está pedindo.
  cargo_atual           TEXT,
  cargo_novo            TEXT NOT NULL,
  local                 TEXT,
  posto                 TEXT,
  filial                TEXT,

  -- Congelado na criação — ver o cabeçalho.
  e_escritorio          BOOLEAN NOT NULL DEFAULT false,

  motivo                TEXT,
  data_pretendida       DATE,

  status                TEXT NOT NULL DEFAULT 'Pendente Operacional',

  -- Aprovação (Operacional OU escritório: é sempre uma só, então um par de
  -- colunas basta e a fila de origem fica em `e_escritorio`).
  aprovador_nome        TEXT,
  aprovador_em          TIMESTAMPTZ,
  aprovador_motivo      TEXT,     -- obrigatório na reprovação

  sst_por               TEXT,
  sst_em                TIMESTAMPTZ,
  sst_aso_data          DATE,
  sst_observacao        TEXT,

  rh_por                TEXT,
  rh_em                 TIMESTAMPTZ,
  rh_observacao         TEXT,

  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT stf_cargo_novo_nao_vazio CHECK (length(btrim(cargo_novo)) > 0),
  CONSTRAINT stf_status_conhecido CHECK (status IN (
    'Pendente Operacional', 'Pendente Escritório', 'Pendente SST',
    'Pendente RH', 'Concluída', 'Reprovada'
  ))
);

CREATE INDEX IF NOT EXISTS stf_status_idx      ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"(status);
CREATE INDEX IF NOT EXISTS stf_solicitante_idx ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"(solicitante_email);
CREATE INDEX IF NOT EXISTS stf_colaborador_idx ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"(colaborador_id);
CREATE INDEX IF NOT EXISTS stf_criado_idx      ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"(criado_em DESC);

DROP TRIGGER IF EXISTS trg_stf_atualizado ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE TRIGGER trg_stf_atualizado BEFORE UPDATE ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public."SISTEMA_SOLICITACOES_TROCA_FUNCAO_id_seq" TO authenticated;

DROP POLICY IF EXISTS stf_all_auth ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
CREATE POLICY stf_all_auth ON public."SISTEMA_SOLICITACOES_TROCA_FUNCAO"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2) Navegação e acesso ────────────────────────────────────────────────
-- Um menu por público: encarregado abre, Operacional OU escritório aprova,
-- SST marca o ASO, RH conclui. Cinco telas, cinco liberações — é o que
-- permite dar o escritório só para a Fernanda e o Senilton sem abrir a fila
-- do Operacional para eles (e vice-versa). Nada de nome de pessoa no código.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota,
       COALESCE((SELECT max(ordem) FROM public.app_menu WHERE modulo_id = m.id), 0) + 1,
       true
  FROM (VALUES
    ('encarregados', 'encarregados_troca_funcao', 'Mudança de Função',              '/app/encarregados/troca-funcao'),
    ('operacional',  'operacional_troca_funcao',  'Mudança de Função',              '/app/operacional/troca-funcao'),
    ('rh',           'escritorio_troca_funcao',   'Mudança de Função — Escritório', '/app/rh/troca-funcao-escritorio'),
    ('sst',          'sst_troca_funcao',          'Mudança de Função — ASO',        '/app/sst/troca-funcao'),
    ('rh',           'rh_troca_funcao',           'Mudança de Função',              '/app/rh/troca-funcao')
  ) AS x(modulo, codigo, nome, rota)
  JOIN public.app_modulo m ON m.codigo = x.modulo
 WHERE NOT EXISTS (SELECT 1 FROM public.app_menu y WHERE y.codigo = x.codigo);

-- ── 3) Conferência ───────────────────────────────────────────────────────
SELECT m.codigo AS modulo, x.codigo AS menu, x.rota, x.ativo
  FROM public.app_menu x JOIN public.app_modulo m ON m.id = x.modulo_id
 WHERE x.codigo LIKE '%troca_funcao%'
 ORDER BY m.codigo, x.codigo;

NOTIFY pgrst, 'reload schema';

-- =========================================================================
-- DEPOIS DE RODAR: liberar em Administração › Acesso por Usuário —
--   encarregados_troca_funcao  para os encarregados;
--   operacional_troca_funcao   para o Operacional;
--   escritorio_troca_funcao    para a Fernanda e o Senilton;
--   sst_troca_funcao           para o SST;
--   rh_troca_funcao            para o RH.
-- =========================================================================
-- ROLLBACK
--   DELETE FROM public.app_menu WHERE codigo IN (
--     'encarregados_troca_funcao','operacional_troca_funcao',
--     'escritorio_troca_funcao','sst_troca_funcao','rh_troca_funcao');
--   DROP TABLE IF EXISTS public."SISTEMA_SOLICITACOES_TROCA_FUNCAO";
-- =========================================================================
