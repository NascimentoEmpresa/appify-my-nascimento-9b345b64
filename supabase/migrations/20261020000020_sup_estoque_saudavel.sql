-- =========================================================================
-- SUPRIMENTOS › ESTOQUE SAUDÁVEL — parâmetros, política e snapshot mensal
-- (20/10/2026 — pedido do gerente de Supply por áudio, SEM chamado)
--
-- PEDIDO, nas palavras dele:
--   · "uma IA que identifique a rotatividade dos produtos e me diga qual é o
--     estoque saudável que eu tenho que ter de cada coisa, pra poder atender
--     essa rotatividade de hoje";
--   · "pra não ter o prejuízo das pessoas paradas em casa, não podendo
--     trabalhar sem uniforme";
--   · "hoje eu não tenho calça M, eu mando fazer, isso leva cinco, dez dias,
--     eu não tenho previsibilidade";
--   · "o que eu preciso eliminar do estoque: isso aqui não tem giro há tantos
--     meses, elimina, faz venda" / "saber o que a gente tem de dinheiro
--     parado";
--   · "incorpora aquele número e faz aquele pedido pra manter esse estoque
--     mínimo, pra atender os colaboradores e os contratos que a gente já tem
--     hoje" — contrato NOVO é pedido próprio, fora desta conta;
--   · "depois, mês a mês, a IA ia analisando e dizendo a hora de diminuir
--     esse estoque aqui, porque foi trocado o quadro".
--
-- ESTA MIGRATION É SÓ A MEMÓRIA DO MÓDULO. A conta mora na RPC
-- sup_estoque_saudavel (20261020000021) e a leitura em texto na Edge Function
-- sup-estoque-ia. A divisão é deliberada:
--
--   A MATEMÁTICA NÃO É DA IA. Ponto de pedido, estoque de segurança e alvo
--   saem de fórmula de reposição clássica, no banco, audítavel e igual toda
--   vez que rodar. A IA lê esses números e escreve a leitura/priorização —
--   ela não inventa quantidade. Isso é o que permite o gerente levar o número
--   para uma negociação de volume: ele é reproduzível e tem a conta atrás.
--
-- Três tabelas, cada uma com um motivo:
--
--   sup_estoque_parametro  As premissas da conta (prazo de reposição, nível de
--                          serviço, ciclo de revisão, meses sem giro para
--                          considerar morto). Ficam em tabela e não no código
--                          porque são regra de negócio que Suprimentos vai
--                          calibrar — e porque o prazo de 5-10 dias do áudio
--                          é diferente por tipo de item (confecção sob medida
--                          x insumo de prateleira).
--
--   sup_estoque_politica   O alvo APROVADO por item+tamanho. A RPC sugere; a
--                          pessoa aprova; só então vale. Nada escreve
--                          automaticamente em estoque mínimo de produção: o
--                          número dispara compra, e compra errada por conta
--                          automática é prejuízo. Guarda também a decisão de
--                          LIQUIDAR (o "faz venda" do áudio).
--
--   sup_estoque_snapshot   Foto mensal de saldo, demanda e alvo por item.
--                          Existe porque HOJE NÃO HÁ HISTÓRICO DE SALDO — a
--                          RPC de rotatividade (20261013000012) já registra
--                          essa dívida: "não existe snapshot diário, então o
--                          denominador do giro é o saldo de hoje". Sem esta
--                          foto, "mês a mês a IA dizendo a hora de diminuir"
--                          é impossível: no mês seguinte o saldo de hoje já
--                          é outro e o de ontem não existe em lugar nenhum.
--                          A partir daqui, cada mês deixa rastro.
--
-- PERMISSÃO: menu fantasma `sup_estoque_saudavel` (app_menu.rota = NULL) —
-- a aba vive dentro do dashboard, cuja tela já é gateada por
-- sup_dashboard_compras_estoque. O menu fantasma existe para separar VER o
-- planejamento de APROVAR alvo e MARCAR liquidação, que são decisão de
-- compra e não de leitura. A permissão é SEMEADA no bloco 1.1 — ver lá por
-- que isso não pode ficar para depois. Quem já vê o dashboard herda só
-- 'visualizar'; 'alterar' e 'exportar' nascem apenas no perfil que concede
-- tudo, e se liberam um a um em Administração › Acesso por Usuário.
--
-- Idempotente. NÃO SE AUTO-APLICA: rodar no SQL Editor do projeto remoto.
-- =========================================================================

-- ── 1) Menu fantasma e ações ─────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'sup_estoque_saudavel', 'Estoque Saudável (planejamento)', NULL, 91, true
  FROM public.app_modulo m WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

INSERT INTO public.app_menu_acao (menu_codigo, acao)
SELECT 'sup_estoque_saudavel', a::public.app_acao
  FROM unnest(ARRAY['alterar', 'exportar']) a
ON CONFLICT (menu_codigo, acao) DO NOTHING;

-- ── 1.1) Semear a permissão — SEM ISTO O MENU NASCE ABERTO ───────────────
--
-- Menu sem nenhuma linha em perfil_acesso_permissao é lido pelo RouteGuard
-- como "ninguém configurou ainda" e liberado para TODO usuário autenticado
-- (fail-open deliberado, para não quebrar tela antiga — ver J2 em
-- .github/REGRAS-PR.md). Num menu cujas ações são aprovar alvo de compra e
-- mudar as premissas da conta, esse fail-open publicaria a decisão de compra
-- para o escritório inteiro.
--
-- Duas sementes, com escopos diferentes de propósito:
--
--   · perfil que concede tudo (admin): recebe as três ações. É o que garante
--     que existe alguém capaz de liberar os outros depois;
--
--   · quem já enxerga o dashboard de Compras/Estoque: recebe SÓ 'visualizar'.
--     Ler o planejamento é a mesma informação que a pessoa já vê nos outros
--     painéis. Aprovar alvo e exportar a lista de compra, não — são decisão
--     de compra e grant à parte, liberado um a um em Acesso por Usuário.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, 'sup_estoque_saudavel', a::public.app_acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN unnest(ARRAY['visualizar', 'alterar', 'exportar']) a
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT p.perfil_id, 'sup_estoque_saudavel', 'visualizar'::public.app_acao, true
  FROM public.perfil_acesso_permissao p
  JOIN public.perfil_acesso pa ON pa.id = p.perfil_id AND pa.ativo AND NOT pa.concede_tudo
 WHERE p.menu_codigo = 'sup_dashboard_compras_estoque'
   AND p.acao = 'visualizar' AND p.allow
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 2) Parâmetros da conta, por empresa ──────────────────────────────────
--
-- Uma linha por empresa, mais linhas opcionais por tipo de item. O tipo é o
-- recorte que importa: uniforme de confecção não repõe no mesmo prazo que
-- insumo de limpeza, e tratar os dois com o mesmo prazo de reposição infla o
-- estoque de um e deixa o outro faltando.
CREATE TABLE IF NOT EXISTS public.sup_estoque_parametro (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- NULL = padrão da empresa; preenchido = sobrepõe para aquele tipo.
  tipo_item            text CHECK (tipo_item IS NULL OR tipo_item IN ('uniforme', 'epi', 'insumo', 'equipamento')),

  -- "isso leva cinco, dez dias" — fica o pior caso dos dois, que é o que
  -- protege a operação. É o prazo entre decidir comprar e a peça estar
  -- disponível no almoxarifado, não o prazo do fornecedor.
  lead_time_dias       integer NOT NULL DEFAULT 10 CHECK (lead_time_dias BETWEEN 0 AND 365),

  -- Probabilidade de NÃO faltar dentro do prazo de reposição. 95% é o padrão
  -- de prateleira para item de reposição barata; o custo de errar aqui é
  -- "pessoa parada em casa", que o gerente colocou como o prejuízo a evitar.
  -- Virar 99% engorda o estoque de segurança ~40% — por isso é parâmetro, e a
  -- tela mostra qual nível está valendo.
  nivel_servico        numeric(4,3) NOT NULL DEFAULT 0.950
                         CHECK (nivel_servico BETWEEN 0.500 AND 0.999),

  -- De quanto em quanto tempo a compra é revista. 30 dias = a revisão mensal
  -- que ele pediu. Entra no alvo porque o estoque tem que atravessar o
  -- intervalo entre duas compras, não só o prazo de entrega.
  ciclo_revisao_dias   integer NOT NULL DEFAULT 30 CHECK (ciclo_revisao_dias BETWEEN 7 AND 365),

  -- Janela de histórico que alimenta a demanda. 6 meses: longo o bastante
  -- para a sazonalidade de admissão aparecer, curto o bastante para o alvo
  -- CAIR quando o quadro cai — que é exatamente o "foi trocado o quadro" do
  -- áudio. Janela de 12 meses seguraria o alvo alto por meio ano depois de
  -- um contrato encerrar.
  janela_meses         integer NOT NULL DEFAULT 6 CHECK (janela_meses BETWEEN 2 AND 60),

  -- Sem nenhuma saída nesse tanto de meses E com saldo em casa = candidato a
  -- liquidação ("isso aqui não tem giro há tantos meses, elimina do estoque").
  meses_sem_giro_morto integer NOT NULL DEFAULT 6 CHECK (meses_sem_giro_morto BETWEEN 1 AND 60),

  -- Acima de quantos % do alvo o excesso deixa de ser folga e passa a ser
  -- dinheiro parado. 20% de folga é tolerância de lote de compra: comprar
  -- exatamente o alvo raramente é possível (fornecedor vende por caixa/dúzia).
  tolerancia_excesso   numeric(4,2) NOT NULL DEFAULT 0.20
                         CHECK (tolerancia_excesso BETWEEN 0 AND 2),

  atualizado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_por_nome  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Um padrão por empresa e um por tipo. O índice parcial é o jeito de ter
-- UNIQUE com coluna NULL: em Postgres, UNIQUE(empresa_id, tipo_item) deixaria
-- entrar duas linhas com tipo_item NULL para a mesma empresa, e aí a conta
-- passaria a depender de qual delas o LIMIT 1 pegasse.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sup_estoque_parametro_empresa_padrao
  ON public.sup_estoque_parametro (empresa_id) WHERE tipo_item IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sup_estoque_parametro_empresa_tipo
  ON public.sup_estoque_parametro (empresa_id, tipo_item) WHERE tipo_item IS NOT NULL;

-- ── 3) Política aprovada por item + tamanho ──────────────────────────────
--
-- A chave é (item BASE, tamanho) e não o item filho de propósito. O estoque
-- bipa o código do item filho ("JAQUETA M"), mas o pedido chega como item
-- base + tamanho em texto, e a conta precisa casar os dois lados — é a mesma
-- chave que a RPC de rotatividade usa. Guardar por item filho obrigaria o
-- filho a existir antes de haver política, e tamanho que nunca entrou no
-- estoque é justamente o que mais precisa de alvo.
CREATE TABLE IF NOT EXISTS public.sup_estoque_politica (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sup_item_base_id   uuid NOT NULL REFERENCES public.sup_item(id) ON DELETE CASCADE,
  -- NULL = item sem grade de tamanho (insumo, equipamento).
  tamanho            text,

  -- Os três números que a pessoa aprovou. NULL = "ainda não aprovei este,
  -- siga a sugestão da RPC" — diferente de 0, que é "não quero estoque disto".
  alvo_aprovado      integer CHECK (alvo_aprovado IS NULL OR alvo_aprovado >= 0),
  minimo_aprovado    integer CHECK (minimo_aprovado IS NULL OR minimo_aprovado >= 0),
  -- Prazo de reposição próprio deste item, quando ele fugir do padrão do tipo
  -- (ex.: uniforme com bordado de contrato específico).
  lead_time_dias     integer CHECK (lead_time_dias IS NULL OR lead_time_dias BETWEEN 0 AND 365),

  -- O "faz venda" do áudio. Marcar aqui tira o item das sugestões de compra
  -- e o joga na lista de liquidação, com o motivo registrado.
  liquidar           boolean NOT NULL DEFAULT false,
  liquidar_motivo    text,

  -- Item que a pessoa decidiu que NÃO entra no planejamento automático
  -- (compra sob demanda, item de contrato único). Fica fora das sugestões
  -- sem precisar zerar o alvo e sem sumir da tela.
  fora_do_plano      boolean NOT NULL DEFAULT false,

  observacao         text,
  aprovado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aprovado_por_nome  text,
  aprovado_em        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Mesmo cuidado do parâmetro: tamanho NULL é um caso legítimo e precisa de
-- índice parcial para não aceitar duplicata.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sup_estoque_politica_item_tamanho
  ON public.sup_estoque_politica (empresa_id, sup_item_base_id, tamanho)
  WHERE tamanho IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sup_estoque_politica_item_sem_tamanho
  ON public.sup_estoque_politica (empresa_id, sup_item_base_id)
  WHERE tamanho IS NULL;
CREATE INDEX IF NOT EXISTS idx_sup_estoque_politica_empresa
  ON public.sup_estoque_politica (empresa_id) WHERE NOT fora_do_plano;

-- ── 4) Histórico da política ─────────────────────────────────────────────
--
-- Não é auditoria por burocracia: é a resposta para "por que a gente tinha
-- 400 calças M em julho e tem 180 agora". Guarda o alvo anterior, o novo, o
-- que a conta sugeria na hora e quem decidiu.
CREATE TABLE IF NOT EXISTS public.sup_estoque_politica_historico (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politica_id      uuid REFERENCES public.sup_estoque_politica(id) ON DELETE SET NULL,
  empresa_id       uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  sup_item_base_id uuid REFERENCES public.sup_item(id) ON DELETE SET NULL,
  item_nome        text NOT NULL,                     -- snapshot: o catálogo muda
  tamanho          text,
  acao             text NOT NULL CHECK (acao IN ('alvo', 'liquidar', 'fora_do_plano', 'parametro')),
  alvo_anterior    integer,
  alvo_novo        integer,
  minimo_anterior  integer,
  minimo_novo      integer,
  -- O que a conta sugeria no momento da aprovação. É isto que mostra se a
  -- pessoa seguiu ou contrariou a sugestão, e permite revisar a fórmula.
  alvo_sugerido    integer,
  observacao       text,
  alterado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  alterado_por_nome text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_estoque_politica_hist_item
  ON public.sup_estoque_politica_historico (empresa_id, sup_item_base_id, created_at DESC);

-- ── 5) Snapshot mensal ───────────────────────────────────────────────────
--
-- Uma linha por (competência, item, tamanho). Gravada pela RPC
-- sup_estoque_snapshot_gravar, que o pg_cron chama todo dia 1º.
--
-- Por que não calcular o passado a partir dos movimentos: porque dá para
-- reconstruir o saldo, mas não o ALVO — o alvo depende da janela de demanda,
-- dos parâmetros e da política vigentes naquele mês, e esses três mudam.
-- Reconstruir depois produziria um histórico que nunca existiu.
CREATE TABLE IF NOT EXISTS public.sup_estoque_snapshot (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  competencia        date NOT NULL,                   -- 1º dia do mês
  sup_item_base_id   uuid REFERENCES public.sup_item(id) ON DELETE SET NULL,
  item_nome          text NOT NULL,
  tamanho            text,
  tipo_item          text,

  saldo_disponivel   numeric(14,2) NOT NULL DEFAULT 0,
  saldo_reservado    numeric(14,2) NOT NULL DEFAULT 0,
  demanda_mes        numeric(14,2) NOT NULL DEFAULT 0, -- unidades pedidas na competência
  saida_mes          numeric(14,2) NOT NULL DEFAULT 0, -- unidades que saíram de fato
  demanda_dia        numeric(14,4) NOT NULL DEFAULT 0, -- média da janela, no fechamento
  alvo_calculado     integer,
  ponto_pedido       integer,
  alvo_aprovado      integer,
  valor_unitario     numeric(14,2),
  valor_em_estoque   numeric(14,2),
  situacao           text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sup_estoque_snapshot_comp_item
  ON public.sup_estoque_snapshot (empresa_id, competencia, sup_item_base_id, tamanho)
  WHERE sup_item_base_id IS NOT NULL AND tamanho IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sup_estoque_snapshot_comp
  ON public.sup_estoque_snapshot (empresa_id, competencia DESC);

-- ── 6) updated_at ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sup_estoque_parametro_updated ON public.sup_estoque_parametro;
CREATE TRIGGER trg_sup_estoque_parametro_updated
  BEFORE UPDATE ON public.sup_estoque_parametro
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_sup_estoque_politica_updated ON public.sup_estoque_politica;
CREATE TRIGGER trg_sup_estoque_politica_updated
  BEFORE UPDATE ON public.sup_estoque_politica
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 7) RLS ───────────────────────────────────────────────────────────────
--
-- LEITURA pelo menu do dashboard (quem vê a aba vê a política), ESCRITA só
-- por RPC. As tabelas não têm policy de INSERT/UPDATE/DELETE nenhuma: gravar
-- alvo é decisão de compra e passa por sup_estoque_politica_salvar, que
-- confere a ação 'alterar' no menu fantasma e grava histórico no mesmo
-- comando. Sem policy de escrita, não há caminho alternativo pelo PostgREST.
ALTER TABLE public.sup_estoque_parametro            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_politica             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_politica_historico   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_estoque_snapshot             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_estoque_parametro_select ON public.sup_estoque_parametro;
CREATE POLICY sup_estoque_parametro_select ON public.sup_estoque_parametro
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS sup_estoque_politica_select ON public.sup_estoque_politica;
CREATE POLICY sup_estoque_politica_select ON public.sup_estoque_politica
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS sup_estoque_politica_hist_select ON public.sup_estoque_politica_historico;
CREATE POLICY sup_estoque_politica_hist_select ON public.sup_estoque_politica_historico
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao));

DROP POLICY IF EXISTS sup_estoque_snapshot_select ON public.sup_estoque_snapshot;
CREATE POLICY sup_estoque_snapshot_select ON public.sup_estoque_snapshot
  FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_dashboard_compras_estoque', 'visualizar'::public.app_acao));

-- ── 8) Parâmetro padrão para as empresas que já existem ──────────────────
--
-- Sem esta linha a RPC cairia no default do código e a tela mostraria
-- premissas que não estão em lugar nenhum. Com ela, abrir a aba já mostra
-- "prazo 10 dias, nível 95%, revisão 30 dias" e dá o que editar.
INSERT INTO public.sup_estoque_parametro (empresa_id, tipo_item)
SELECT e.id, NULL FROM public.empresas e
ON CONFLICT DO NOTHING;

COMMENT ON TABLE public.sup_estoque_parametro IS
  'Premissas da conta de estoque saudável (prazo de reposição, nível de serviço, ciclo de revisão, janela de demanda) por empresa e, opcionalmente, por tipo de item.';
COMMENT ON TABLE public.sup_estoque_politica IS
  'Alvo e mínimo APROVADOS por item base + tamanho, mais as marcas de liquidar e fora do plano. A RPC sugere; aqui fica o que alguém assinou.';
COMMENT ON TABLE public.sup_estoque_snapshot IS
  'Foto mensal de saldo, demanda e alvo por item. Existe porque não há histórico de saldo no módulo — é o que permite comparar mês a mês e detectar queda de quadro.';

NOTIFY pgrst, 'reload schema';

-- ROLLBACK
--   DROP TABLE IF EXISTS public.sup_estoque_snapshot;
--   DROP TABLE IF EXISTS public.sup_estoque_politica_historico;
--   DROP TABLE IF EXISTS public.sup_estoque_politica;
--   DROP TABLE IF EXISTS public.sup_estoque_parametro;
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo = 'sup_estoque_saudavel';
--   DELETE FROM public.app_menu_acao WHERE menu_codigo = 'sup_estoque_saudavel';
--   DELETE FROM public.app_menu      WHERE codigo      = 'sup_estoque_saudavel';
--   NOTIFY pgrst, 'reload schema';
