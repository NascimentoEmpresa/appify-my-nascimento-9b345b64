-- =====================================================================
-- SUPPLY / COMPRAS — Fase 3: PATRIMÔNIO E MANUTENÇÃO
--
-- Subsistema 7 do legado (REPLICAR-MODULO-COMPRAS.md §9): cadastro de frota
-- e maquinário, com anexos que documentam a manutenção e o custo dela.
--
-- Patrimônio é onde ficam TODOS os bens; Manutenção é o recorte do que está
-- parado agora. Um cadastro, duas telas.
--
-- DECISÕES QUE DIFEREM DO LEGADO
--
--   1. UMA TABELA, NÃO DUAS. O legado tinha `veiculos` e `equipamentos` com
--      controllers "praticamente idênticos" (§9.1) — duplicação que só
--      dobrava a manutenção do código. Aqui é `categoria`. A tela continua
--      mostrando os dois grupos separados.
--
--   2. CONTRATO E POSTO OPCIONAIS. A frota da sede (as 12 do "ADM" nos prints)
--      não pertence a licitação nenhuma. Quando não há contrato, o bem é
--      agrupado por `lotacao`.
--
--   3. O LOG É TRIGGER, NÃO CHAMADA MANUAL. O legado dependia de cada
--      controller lembrar de chamar o helper de log, e engolia a falha no
--      console. Aqui o trigger registra sozinho e, se falhar, não derruba a
--      operação — mesma garantia, sem depender de disciplina.
--
--   4. O VALOR FICA NO ARQUIVO, não no bem. É o que amarra o custo à nota
--      fiscal que o comprova e permite somar o gasto do ano por veículo.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.sup_patrimonio_log, public.sup_patrimonio_arquivo,
--     public.sup_patrimonio CASCADE;
--   DROP FUNCTION IF EXISTS public.sup_patrimonio_registrar_log();
--   DELETE FROM public.app_menu WHERE codigo IN ('sup_patrimonio','sup_manutencao');
--   DELETE FROM public.perfil_acesso_permissao WHERE menu_codigo IN ('sup_patrimonio','sup_manutencao');
-- =====================================================================

-- ── 1. O bem ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sup_patrimonio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria    text NOT NULL CHECK (categoria IN ('veiculo','equipamento')),
  nome         text NOT NULL,
  -- Placa, número de série ou patrimônio. É o que distingue duas unidades do
  -- mesmo modelo — na carga do legado há 6 nomes repetidos (3 roçadeiras
  -- STHIL FS 220, por exemplo) e nenhum identificador repetido.
  identificador text,
  descricao    text,

  -- Ambos opcionais: bem da sede não tem contrato.
  contrato_id  uuid REFERENCES public.contratos(id) ON DELETE SET NULL,
  posto_id     uuid REFERENCES public.sup_posto(id) ON DELETE SET NULL,
  -- Usado para agrupar quando não há contrato ("ADM", "Sede", "Oficina").
  lotacao      text,

  em_manutencao          boolean NOT NULL DEFAULT false,
  data_inicio_manutencao date,
  data_previsao_fim      date,

  ativo        boolean NOT NULL DEFAULT true,
  observacoes  text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Data órfã de um estado que não existe mais é o defeito que o §9.2 manda
  -- evitar; aqui o banco não deixa nem chegar nesse estado.
  CONSTRAINT sup_patrimonio_datas_coerentes CHECK (
    em_manutencao OR (data_inicio_manutencao IS NULL AND data_previsao_fim IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_sup_patrim_empresa   ON public.sup_patrimonio(empresa_id);
CREATE INDEX IF NOT EXISTS idx_sup_patrim_contrato  ON public.sup_patrimonio(contrato_id);
CREATE INDEX IF NOT EXISTS idx_sup_patrim_posto     ON public.sup_patrimonio(posto_id);
CREATE INDEX IF NOT EXISTS idx_sup_patrim_manut     ON public.sup_patrimonio(em_manutencao) WHERE em_manutencao;
-- Identificador é a chave da importação: único quando informado, e livre para
-- os casos "SEM NUMERO DE SERIE", que entram nulos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sup_patrim_identificador
  ON public.sup_patrimonio(empresa_id, upper(trim(identificador)))
  WHERE identificador IS NOT NULL AND trim(identificador) <> '';

-- ── 2. Anexos: a nota e o custo ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sup_patrimonio_arquivo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patrimonio_id uuid NOT NULL REFERENCES public.sup_patrimonio(id) ON DELETE CASCADE,
  nome_arquivo  text NOT NULL,
  caminho       text NOT NULL,
  tipo_mime     text,
  tamanho_kb    integer,
  comentario    text,
  -- O custo daquela manutenção, junto do documento que o comprova.
  valor         numeric(12,2),
  enviado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enviado_por_nome text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_patrim_arq ON public.sup_patrimonio_arquivo(patrimonio_id, created_at DESC);

-- ── 3. Auditoria ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sup_patrimonio_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patrimonio_id uuid,
  patrimonio_nome text,
  acao          text NOT NULL,
  campo         text,
  valor_anterior text,
  valor_novo    text,
  usuario_id    uuid,
  usuario_nome  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sup_patrim_log ON public.sup_patrimonio_log(patrimonio_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_sup_patrimonio_updated ON public.sup_patrimonio;
CREATE TRIGGER trg_sup_patrimonio_updated BEFORE UPDATE ON public.sup_patrimonio
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Registra criação, alteração campo a campo, e exclusão.
-- §9.2: "o log nunca quebra a operação". No legado isso dependia de cada
-- controller lembrar de chamar o helper e engolir o erro; aqui o próprio
-- trigger se protege, e não há como esquecer.
CREATE OR REPLACE FUNCTION public.sup_patrimonio_registrar_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nome text := coalesce(public.sup_est_nome_usuario(), 'sistema');
  v_uid  uuid := auth.uid();
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.sup_patrimonio_log
        (patrimonio_id, patrimonio_nome, acao, usuario_id, usuario_nome)
      VALUES (NEW.id, NEW.nome, 'criado', v_uid, v_nome);

    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO public.sup_patrimonio_log
        (patrimonio_id, patrimonio_nome, acao, usuario_id, usuario_nome)
      VALUES (OLD.id, OLD.nome, 'excluido', v_uid, v_nome);

    ELSE
      -- Uma linha por campo que mudou, com antes e depois.
      INSERT INTO public.sup_patrimonio_log
        (patrimonio_id, patrimonio_nome, acao, campo, valor_anterior, valor_novo, usuario_id, usuario_nome)
      SELECT NEW.id, NEW.nome, 'alterado', x.campo, x.antes, x.depois, v_uid, v_nome
        FROM (VALUES
          ('nome',                  OLD.nome,                              NEW.nome),
          ('identificador',         OLD.identificador,                     NEW.identificador),
          ('categoria',             OLD.categoria,                         NEW.categoria),
          ('lotacao',               OLD.lotacao,                           NEW.lotacao),
          ('contrato_id',           OLD.contrato_id::text,                 NEW.contrato_id::text),
          ('posto_id',              OLD.posto_id::text,                    NEW.posto_id::text),
          ('em_manutencao',         OLD.em_manutencao::text,               NEW.em_manutencao::text),
          ('data_inicio_manutencao',OLD.data_inicio_manutencao::text,      NEW.data_inicio_manutencao::text),
          ('data_previsao_fim',     OLD.data_previsao_fim::text,           NEW.data_previsao_fim::text),
          ('ativo',                 OLD.ativo::text,                       NEW.ativo::text)
        ) AS x(campo, antes, depois)
       WHERE x.antes IS DISTINCT FROM x.depois;
    END IF;
  EXCEPTION WHEN others THEN
    NULL;  -- auditoria nunca impede a operação
  END;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_sup_patrimonio_log ON public.sup_patrimonio;
CREATE TRIGGER trg_sup_patrimonio_log
  AFTER INSERT OR UPDATE OR DELETE ON public.sup_patrimonio
  FOR EACH ROW EXECUTE FUNCTION public.sup_patrimonio_registrar_log();

-- ── 4. RLS ───────────────────────────────────────────────────────────
-- can_access() responde "pode abrir a tela", nunca "pode ver esta linha":
-- por isso vem sempre somado ao escopo de empresa via user_empresa.
-- O painel de manutenção tem menu próprio e enxerga o mesmo cadastro.

ALTER TABLE public.sup_patrimonio         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_patrimonio_arquivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sup_patrimonio_log     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sup_patrimonio_select ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_select ON public.sup_patrimonio FOR SELECT TO authenticated
  USING (
    (public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar')
     OR public.can_access(auth.uid(), 'sup_manutencao', 'visualizar'))
    AND sup_patrimonio.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sup_patrimonio_insert ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_insert ON public.sup_patrimonio FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access(auth.uid(), 'sup_patrimonio', 'incluir')
    AND sup_patrimonio.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- Marcar/desmarcar manutenção é a ação do painel, então 'sup_manutencao'
-- também autoriza o UPDATE — quem cuida da oficina não precisa poder
-- cadastrar bem novo.
DROP POLICY IF EXISTS sup_patrimonio_update ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_update ON public.sup_patrimonio FOR UPDATE TO authenticated
  USING (
    (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
     OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar'))
    AND sup_patrimonio.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  )
  WITH CHECK (
    (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
     OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar'))
    AND sup_patrimonio.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS sup_patrimonio_delete ON public.sup_patrimonio;
CREATE POLICY sup_patrimonio_delete ON public.sup_patrimonio FOR DELETE TO authenticated
  USING (
    public.can_access(auth.uid(), 'sup_patrimonio', 'excluir')
    AND sup_patrimonio.empresa_id IN (
      SELECT ue.empresa_id FROM public.user_empresa ue WHERE ue.user_id = auth.uid()
    )
  );

-- Anexos herdam a visibilidade do bem — o EXISTS reaproveita a policy acima.
DROP POLICY IF EXISTS sup_patrim_arq_select ON public.sup_patrimonio_arquivo;
CREATE POLICY sup_patrim_arq_select ON public.sup_patrimonio_arquivo FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_patrimonio p WHERE p.id = sup_patrimonio_arquivo.patrimonio_id
  ));

DROP POLICY IF EXISTS sup_patrim_arq_write ON public.sup_patrimonio_arquivo;
CREATE POLICY sup_patrim_arq_write ON public.sup_patrimonio_arquivo FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sup_patrimonio p
     WHERE p.id = sup_patrimonio_arquivo.patrimonio_id
       AND (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
            OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sup_patrimonio p
     WHERE p.id = sup_patrimonio_arquivo.patrimonio_id
       AND (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
            OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar'))
  ));

DROP POLICY IF EXISTS sup_patrim_log_select ON public.sup_patrimonio_log;
CREATE POLICY sup_patrim_log_select ON public.sup_patrimonio_log FOR SELECT TO authenticated
  USING (public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar'));
-- Escrita só pelo trigger (SECURITY DEFINER): ninguém forja linha de auditoria.

-- ── 5. Storage dos anexos ────────────────────────────────────────────
-- Privado: nota fiscal de manutenção não é documento público.
INSERT INTO storage.buckets (id, name, public)
VALUES ('sup-patrimonio', 'sup-patrimonio', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sup_patrim_storage_insert ON storage.objects;
CREATE POLICY sup_patrim_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sup-patrimonio'
    AND (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
         OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar')));

DROP POLICY IF EXISTS sup_patrim_storage_select ON storage.objects;
CREATE POLICY sup_patrim_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sup-patrimonio'
    AND (public.can_access(auth.uid(), 'sup_patrimonio', 'visualizar')
         OR public.can_access(auth.uid(), 'sup_manutencao', 'visualizar')));

DROP POLICY IF EXISTS sup_patrim_storage_delete ON storage.objects;
CREATE POLICY sup_patrim_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sup-patrimonio'
    AND (public.can_access(auth.uid(), 'sup_patrimonio', 'alterar')
         OR public.can_access(auth.uid(), 'sup_manutencao', 'alterar')));

-- ── 6. Menus ─────────────────────────────────────────────────────────
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, x.codigo, x.nome, x.rota, x.ordem, true
  FROM public.app_modulo m, (VALUES
    ('sup_patrimonio', 'Patrimônio',            '/app/suprimentos/patrimonio', 70),
    ('sup_manutencao', 'Painel de Manutenções', '/app/suprimentos/manutencao', 71)
  ) AS x(codigo, nome, rota, ordem)
 WHERE m.codigo = 'suprimentos'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Fecha por padrão já na criação. Menu sem NENHUMA regra é tratado como
-- aberto por list_configured_menu_codes — foi o que deixou os menus da Fase 1
-- visíveis a todo mundo até a 20260823000002. Semear aqui evita repetir.
INSERT INTO public.perfil_acesso_permissao (perfil_id, menu_codigo, acao, allow)
SELECT pa.id, m.codigo, a.acao, true
  FROM public.perfil_acesso pa
 CROSS JOIN (VALUES ('sup_patrimonio'), ('sup_manutencao')) AS m(codigo)
 CROSS JOIN (VALUES ('visualizar'::public.app_acao), ('incluir'::public.app_acao),
                    ('alterar'::public.app_acao), ('excluir'::public.app_acao)) AS a(acao)
 WHERE pa.concede_tudo AND pa.ativo
ON CONFLICT (perfil_id, menu_codigo, acao) DO NOTHING;

-- ── 7. Conferência ───────────────────────────────────────────────────
SELECT am.codigo, am.nome,
       EXISTS (SELECT 1 FROM public.perfil_acesso_permissao p WHERE p.menu_codigo = am.codigo)
         AS fechado_por_padrao
  FROM public.app_menu am
 WHERE am.codigo IN ('sup_patrimonio', 'sup_manutencao');

NOTIFY pgrst, 'reload schema';
