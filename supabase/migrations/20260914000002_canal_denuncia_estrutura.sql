-- =====================================================================
-- CANAL DE ÉTICA — atendimento integral do pedido do Comitê (21/08/2026)
--
-- Cobre os 57 requisitos que a conferência apontou como ausentes ou
-- parciais. Esta migration é a ESTRUTURA (colunas, tabelas, domínios,
-- gatilhos, visão e capacidades); as portas públicas do site ficam na
-- 20260821000003_canal_denuncia_rpcs.sql.
--
-- O QUE MUDA, EM BLOCOS
--   1. Contato Seguro sai do ar (o espelho legado deixa de ter menu).
--   2. Empresa e contrato viram dado estruturado, informado por quem denuncia.
--   3. Volta a denúncia anônima — sem desmontar o acompanhamento.
--   4. Campos que faltavam ao denunciante (data/hora do fato, risco, retaliação,
--      quem é o denunciado e sua função).
--   5. Campos que faltavam ao Comitê (resumo, pendência, medida principal,
--      recomendação) + providências como LISTA, com prazo e responsável.
--   6. Camada da Presidência, com capacidade própria e trava no banco.
--   7. Fluxo de 11 situações, com justificativa obrigatória na mudança.
--   8. Trilha de TODOS os campos da ficha, não só de quatro.
--   9. Anexos de verdade (bucket + tabela), com marcação de sensível.
--  10. Cadastro de responsáveis pela apuração.
--  11. Sigilo que restringe de verdade: visão mascarada + capacidade.
--
-- O QUE NÃO MUDA: o relato continua imutável, continua não existindo
-- caminho de exclusão pela API, e nada de IP/user-agent/auth.uid() do
-- denunciante é gravado.
--
-- Idempotente.
-- =====================================================================

-- =====================================================================
-- 1. CONTATO SEGURO SAI DO AR
-- =====================================================================
-- As TABELAS ficam. Elas guardam denúncias reais já tratadas, e apagar
-- histórico de canal de ética não se desfaz — se a decisão for descartar,
-- que seja num passo explícito e separado. O que sai é o acesso: sem menu,
-- a tela não existe mais para ninguém.
DELETE FROM public.screen_permission_user WHERE menu_codigo = 'central_servicos_denuncias';
UPDATE public.app_menu SET ativo = false WHERE codigo = 'central_servicos_denuncias';

DO $$
BEGIN
  EXECUTE 'COMMENT ON TABLE public."CS_DENUNCIAS" IS ' ||
    quote_literal('LEGADO (Contato Seguro), aposentado em 21/08/2026. Somente leitura historica: ' ||
                  'nao recebe denuncia nova e nao tem tela. O canal em uso e CANAL_DENUNCIA.');
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- =====================================================================
-- 2. EMPRESA E CONTRATO
-- =====================================================================
-- A lista que o site oferece é CADASTRO, não constante no código — foi
-- pedido explicitamente ("permitir o cadastramento futuro de outras
-- empresas"), e trocar uma opção não pode exigir deploy.
--
-- Fica separada de `public.empresas` de propósito: aquela tabela é o cadastro
-- fiscal (CNPJ, regime tributário), e nem toda opção que faz sentido para
-- quem denuncia corresponde a uma linha lá. `empresa_id` liga as duas quando
-- houver correspondência, e fica nula quando não houver.
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_EMPRESA" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rotulo      text NOT NULL UNIQUE,
  empresa_id  uuid REFERENCES public.empresas(id),
  -- Casado contra EMPREGADOS."Nome da Empresa" para montar a lista de
  -- contratos daquela empresa. Nulo = oferece todos os contratos.
  padrao_empregados text,
  ordem       integer NOT NULL DEFAULT 10,
  ativo       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."CANAL_DENUNCIA_EMPRESA" IS
  'Opcoes do campo "Empresa" do formulario publico. Cadastro: incluir empresa nova nao exige deploy.';
COMMENT ON COLUMN public."CANAL_DENUNCIA_EMPRESA".padrao_empregados IS
  'ILIKE contra EMPREGADOS."Nome da Empresa" para listar os contratos. Nulo = todos.';

INSERT INTO public."CANAL_DENUNCIA_EMPRESA" (rotulo, ordem) VALUES
  ('Nascimento', 10), ('SN', 20), ('NH', 30)
ON CONFLICT (rotulo) DO NOTHING;

ALTER TABLE public."CANAL_DENUNCIA_EMPRESA" ENABLE ROW LEVEL SECURITY;
-- A leitura é pública de propósito: é o que popula o select do site, que roda
-- sem login. São nomes de empresa — não há o que proteger aqui.
GRANT SELECT ON TABLE public."CANAL_DENUNCIA_EMPRESA" TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public."CANAL_DENUNCIA_EMPRESA" TO authenticated;

DROP POLICY IF EXISTS canal_empresa_ler ON public."CANAL_DENUNCIA_EMPRESA";
CREATE POLICY canal_empresa_ler ON public."CANAL_DENUNCIA_EMPRESA"
  FOR SELECT TO anon, authenticated USING (ativo OR public.tem_acesso_menu('comite_etica_sigilo'));

DROP POLICY IF EXISTS canal_empresa_manter ON public."CANAL_DENUNCIA_EMPRESA";
CREATE POLICY canal_empresa_manter ON public."CANAL_DENUNCIA_EMPRESA"
  FOR ALL TO authenticated
  USING (public.tem_acesso_menu('comite_etica_sigilo'))
  WITH CHECK (public.tem_acesso_menu('comite_etica_sigilo'));

ALTER TABLE public."CANAL_DENUNCIA"
  -- Informados por QUEM DENUNCIA, no formulário público. Fazem parte do
  -- relato: entram uma vez e não são reescritos (ver a trava, mais abaixo).
  ADD COLUMN IF NOT EXISTS empresa_id            uuid REFERENCES public."CANAL_DENUNCIA_EMPRESA"(id),
  -- Retrato do nome no dia do registro. `empresas` pode ser renomeada, e o
  -- procedimento exportado tem de continuar dizendo o que dizia.
  ADD COLUMN IF NOT EXISTS empresa_nome          text,
  ADD COLUMN IF NOT EXISTS contrato_informado    text,
  -- Como o contrato foi informado. Sem isto, "em branco" ficaria significando
  -- três coisas diferentes: não perguntei, não achei e não sei.
  ADD COLUMN IF NOT EXISTS contrato_situacao     text;

DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_contrato_situacao_chk
    CHECK (contrato_situacao IS NULL OR contrato_situacao IN ('selecionado','nao_localizado','nao_sei','manual'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public."CANAL_DENUNCIA".empresa_id IS
  'Empresa informada pelo denunciante. Faz parte do relato: imutavel apos o registro.';
COMMENT ON COLUMN public."CANAL_DENUNCIA".contrato_informado IS
  'Contrato/local de trabalho segundo o denunciante. O campo `contrato` continua sendo a leitura do Comite.';

CREATE INDEX IF NOT EXISTS idx_canal_denuncia_empresa ON public."CANAL_DENUNCIA"(empresa_id);

-- =====================================================================
-- 3. VOLTA A DENÚNCIA ANÔNIMA
-- =====================================================================
-- A 20260901000005 tornou o e-mail obrigatório para dar acompanhamento a
-- quem denuncia — e, com isso, acabou com o relato anônimo. O Comitê pediu
-- a opção de volta. Em vez de desfazer o acompanhamento, os dois convivem:
--
--   · com e-mail   → acompanha por e-mail + senha (como hoje);
--   · sem e-mail   → acompanha por PROTOCOLO + senha (o desenho original,
--                    da 20260812000001, que nunca deixou de funcionar).
--
-- A senha continua escolhida pela pessoa e guardada só como hash.
ALTER TABLE public."CANAL_DENUNCIA"
  ADD COLUMN IF NOT EXISTS anonimo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public."CANAL_DENUNCIA".anonimo IS
  'true = relato sem e-mail. O acompanhamento passa a ser por protocolo + senha. Diferente de `identificado`, que e sobre dizer o NOME.';

-- Quem é anônimo não pode ter e-mail gravado, e quem não é precisa de um:
-- sem esta trava, a coluna viraria "às vezes tem" e as duas portas de
-- acompanhamento passariam a discordar sobre quem entra por onde.
DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_anonimo_chk
    CHECK ((anonimo AND email IS NULL) OR (NOT anonimo AND email IS NOT NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  -- Base legada com e-mail nulo de antes da 20260901000005: a trava entra
  -- depois de a 3.1 abaixo acertar as linhas.
  WHEN check_violation THEN NULL;
END $$;

-- 3.1 Linhas antigas sem e-mail (anteriores à obrigatoriedade) são anônimas.
UPDATE public."CANAL_DENUNCIA" SET anonimo = true WHERE email IS NULL AND NOT anonimo;

DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_anonimo_chk
    CHECK ((anonimo AND email IS NULL) OR (NOT anonimo AND email IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================
-- 4. CAMPOS DO DENUNCIANTE QUE FALTAVAM
-- =====================================================================
ALTER TABLE public."CANAL_DENUNCIA"
  -- Quando o fato aconteceu. Estava só dentro do texto do relato, quando
  -- estava — e é o dado que decide prescrição, escala e testemunha.
  ADD COLUMN IF NOT EXISTS ocorrencia_data       date,
  ADD COLUMN IF NOT EXISTS ocorrencia_hora       text,
  -- 'unica' | 'recorrente' | 'em_curso': assédio contínuo e episódio isolado
  -- não pedem a mesma resposta.
  ADD COLUMN IF NOT EXISTS ocorrencia_frequencia text,
  -- Risco imediato é o que fura a fila. Booleano + detalhe: a triagem precisa
  -- conseguir filtrar, e o Comitê precisa ler o porquê.
  ADD COLUMN IF NOT EXISTS risco_imediato        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS risco_imediato_detalhe text,
  ADD COLUMN IF NOT EXISTS retaliacao            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retaliacao_detalhe    text,
  -- Quem é o denunciado SEGUNDO O DENUNCIANTE. Diferente de `denunciado_nome`,
  -- que é a identificação que o Comitê confirma contra o cadastro.
  ADD COLUMN IF NOT EXISTS denunciado_informado  text,
  ADD COLUMN IF NOT EXISTS denunciado_funcao     text;

DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_frequencia_chk
    CHECK (ocorrencia_frequencia IS NULL OR ocorrencia_frequencia IN ('unica','recorrente','em_curso'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Filtro da triagem: "o que não pode esperar" tem de ser uma consulta barata.
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_risco
  ON public."CANAL_DENUNCIA"(created_at DESC) WHERE risco_imediato;

-- =====================================================================
-- 5. CAMPOS DO COMITÊ QUE FALTAVAM
-- =====================================================================
ALTER TABLE public."CANAL_DENUNCIA"
  -- `titulo` é o assunto de uma linha da lista. Isto aqui é o resumo que vai
  -- para o relatório gerencial — são coisas diferentes.
  ADD COLUMN IF NOT EXISTS resumo             text,
  ADD COLUMN IF NOT EXISTS pendencia_atual    text,
  -- As medidas são uma lista de marcar; a principal é a que vai no relatório
  -- e no indicador de eficácia.
  ADD COLUMN IF NOT EXISTS medida_principal   text,
  ADD COLUMN IF NOT EXISTS recomendacao       text,
  ADD COLUMN IF NOT EXISTS evidencias_analise text,
  -- Responsável pela apuração deixa de ser texto solto (ver bloco 10). O
  -- texto continua como retrato de quem era o responsável na época.
  ADD COLUMN IF NOT EXISTS apuracao_responsavel_id uuid REFERENCES auth.users(id),
  -- Alimentado por gatilho. É o que responde "parado há quanto tempo?", que o
  -- SLA contado desde a abertura não responde.
  ADD COLUMN IF NOT EXISTS ultima_movimentacao_em timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_recomendacao_chk
    CHECK (recomendacao IS NULL OR recomendacao IN ('arquivamento','aplicacao_medida','reabertura','apuracao_complementar'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_canal_denuncia_parado
  ON public."CANAL_DENUNCIA"(ultima_movimentacao_em);
CREATE INDEX IF NOT EXISTS idx_canal_denuncia_resp_id
  ON public."CANAL_DENUNCIA"(apuracao_responsavel_id);

-- =====================================================================
-- 6. CAMADA DA PRESIDÊNCIA
-- =====================================================================
ALTER TABLE public."CANAL_DENUNCIA"
  ADD COLUMN IF NOT EXISTS decisao_final          text,
  ADD COLUMN IF NOT EXISTS decisao_em             timestamptz,
  ADD COLUMN IF NOT EXISTS decisao_fundamentacao  text,
  -- O que a Presidência fez com a recomendação do Comitê. É o campo que
  -- permite medir divergência entre os dois — e é por isso que ele é um
  -- domínio fechado, e não texto.
  ADD COLUMN IF NOT EXISTS decisao_sobre_parecer  text,
  ADD COLUMN IF NOT EXISTS decisao_medidas        text,
  ADD COLUMN IF NOT EXISTS decisao_por_user_id    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS decisao_por_nome       text;

DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_decisao_chk
    CHECK (decisao_sobre_parecer IS NULL
           OR decisao_sobre_parecer IN ('aprovada','alterada','rejeitada'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Capacidade própria: decidir não é tratar. Menu sem rota, igual a
-- `novidades_publicar` — aparece sozinho em Acesso por Usuário.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'comite_etica_presidencia', 'Pode registrar a decisão da Presidência', NULL, 30, true
  FROM public.app_modulo m WHERE m.codigo = 'comite_etica'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- Capacidade de sigilo: ver identidade do denunciante e anexos sensíveis.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'comite_etica_sigilo', 'Pode ver identidade e anexos sigilosos', NULL, 31, true
  FROM public.app_modulo m WHERE m.codigo = 'comite_etica'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- A tela de configuração do canal (empresas, responsáveis, prazos). Entra em
-- app_menu COM rota porque rota sem entrada lá é aberta a todo mundo — e esta
-- não pode ser. A tela também cobra `comite_etica_sigilo` por dentro.
INSERT INTO public.app_menu (modulo_id, codigo, nome, rota, ordem, ativo)
SELECT m.id, 'comite_etica_configuracao', 'Configuração do Canal', '/app/comite-etica/configuracao', 32, true
  FROM public.app_modulo m WHERE m.codigo = 'comite_etica'
ON CONFLICT (modulo_id, codigo) DO NOTHING;

-- =====================================================================
-- 7. FLUXO DE 11 SITUAÇÕES
-- =====================================================================
-- Traduz o que já existe antes de trocar o domínio — CHECK novo com linha
-- fora do domínio derruba a migration inteira.
--
-- `julgada` vira `aguardando_cumprimento`: era exatamente o que ela
-- descrevia ("o comitê concluiu; as providências estão em execução"), e ela
-- PARAVA o cronômetro do prazo. Um caso julgado cuja medida ninguém executou
-- aparecia como concluído. Agora não para mais.
UPDATE public."CANAL_DENUNCIA" SET status = 'triagem'                WHERE status = 'em_analise';
UPDATE public."CANAL_DENUNCIA" SET status = 'aguardando_cumprimento' WHERE status = 'julgada';
UPDATE public."CANAL_DENUNCIA" SET status = 'concluida'              WHERE status = 'encerrada';

DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA" DROP CONSTRAINT IF EXISTS canal_denuncia_status_chk;
  ALTER TABLE public."CANAL_DENUNCIA" ADD CONSTRAINT canal_denuncia_status_chk
    CHECK (status IN (
      'nova',                     -- denúncia recebida
      'triagem',
      'investigacao',             -- em apuração
      'aguardando_esclarecimentos',
      'aguardando_documentos',
      'parecer_elaboracao',
      'aguardando_presidencia',
      'aguardando_cumprimento',
      'concluida',
      'arquivada',
      'reaberta'
    ));
END $$;

-- Justificativa da última mudança. Fica como coluna, e não só dentro do
-- evento, para o gatilho conseguir lê-la na mesma transação do UPDATE —
-- é o que permite exigir o "por quê" sem uma segunda chamada da tela.
ALTER TABLE public."CANAL_DENUNCIA"
  ADD COLUMN IF NOT EXISTS justificativa_mudanca text;

COMMENT ON COLUMN public."CANAL_DENUNCIA".justificativa_mudanca IS
  'Por que a situacao mudou. Copiada para CANAL_DENUNCIA_EVENTO pelo gatilho; obrigatoria na troca de situacao.';

-- =====================================================================
-- 8. PROVIDÊNCIAS — lista, não campo
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_PROVIDENCIA" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id   uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  ordem         integer NOT NULL DEFAULT 1,
  descricao     text NOT NULL CHECK (length(btrim(descricao)) > 0),
  responsavel   text,
  responsavel_user_id uuid REFERENCES auth.users(id),
  prazo         date,
  concluida_em  timestamptz,
  -- 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
  situacao      text NOT NULL DEFAULT 'pendente',
  observacao    text,
  criado_por    uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  criado_por_nome text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canal_denuncia_prov_situacao_chk
    CHECK (situacao IN ('pendente','em_andamento','concluida','cancelada'))
);

COMMENT ON TABLE public."CANAL_DENUNCIA_PROVIDENCIA" IS
  'Providencias do procedimento, cada uma com prazo e responsavel. E daqui que sai "data de cada providencia" e "prazo para cumprimento".';

CREATE INDEX IF NOT EXISTS idx_canal_prov_denuncia
  ON public."CANAL_DENUNCIA_PROVIDENCIA"(denuncia_id, ordem);
CREATE INDEX IF NOT EXISTS idx_canal_prov_prazo
  ON public."CANAL_DENUNCIA_PROVIDENCIA"(prazo) WHERE situacao IN ('pendente','em_andamento');

ALTER TABLE public."CANAL_DENUNCIA_PROVIDENCIA" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_PROVIDENCIA" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."CANAL_DENUNCIA_PROVIDENCIA" TO authenticated;

DROP POLICY IF EXISTS canal_prov_todas ON public."CANAL_DENUNCIA_PROVIDENCIA";
CREATE POLICY canal_prov_todas ON public."CANAL_DENUNCIA_PROVIDENCIA"
  FOR ALL TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- =====================================================================
-- 9. ANEXOS
-- =====================================================================
-- Bucket privado. Sem `public`, sem política de leitura anônima: quem baixa
-- é sempre alguém autenticado, por URL assinada de vida curta.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('denuncia-evidencias', 'denuncia-evidencias', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

CREATE TABLE IF NOT EXISTS public."CANAL_DENUNCIA_ANEXO" (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denuncia_id   uuid NOT NULL REFERENCES public."CANAL_DENUNCIA"(id) ON DELETE CASCADE,
  -- Quem juntou o arquivo. O do denunciante é prova do relato e por isso
  -- não pode ser removido nem por quem apura (ver a policy de DELETE).
  origem        text NOT NULL CHECK (origem IN ('denunciante','comite','presidencia')),
  -- 'evidencia' | 'documento_suporte' | 'entrevista' | 'manifestacao' | 'parecer' | 'outro'
  categoria     text NOT NULL DEFAULT 'evidencia',
  nome_arquivo  text NOT NULL,
  storage_path  text NOT NULL UNIQUE,
  mime_type     text,
  tamanho_bytes bigint,
  -- Sensível = só quem tem a capacidade `comite_etica_sigilo` abre.
  sensivel      boolean NOT NULL DEFAULT false,
  descricao     text,
  autor_user_id uuid REFERENCES auth.users(id),
  autor_nome    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."CANAL_DENUNCIA_ANEXO" IS
  'Arquivos do procedimento. O que veio pelo site entra via edge function denuncia-anexar (service_role); o do Comite entra direto pelo storage.';

CREATE INDEX IF NOT EXISTS idx_canal_anexo_denuncia
  ON public."CANAL_DENUNCIA_ANEXO"(denuncia_id, created_at);

ALTER TABLE public."CANAL_DENUNCIA_ANEXO" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."CANAL_DENUNCIA_ANEXO" FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public."CANAL_DENUNCIA_ANEXO" TO authenticated;

-- Anexo sensível só aparece para quem tem a capacidade. Isto é o que faz o
-- campo "Sigilo" deixar de ser enfeite: a linha nem volta na consulta.
DROP POLICY IF EXISTS canal_anexo_select ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_select ON public."CANAL_DENUNCIA_ANEXO"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias')
         AND (NOT sensivel OR public.tem_acesso_menu('comite_etica_sigilo')));

DROP POLICY IF EXISTS canal_anexo_insert ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_insert ON public."CANAL_DENUNCIA_ANEXO"
  FOR INSERT TO authenticated
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias')
              AND origem <> 'denunciante');

-- Reclassificar (marcar como sensível, corrigir a categoria) é permitido;
-- trocar o arquivo por outro, não.
DROP POLICY IF EXISTS canal_anexo_update ON public."CANAL_DENUNCIA_ANEXO";
CREATE POLICY canal_anexo_update ON public."CANAL_DENUNCIA_ANEXO"
  FOR UPDATE TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'))
  WITH CHECK (public.tem_acesso_menu('central_servicos_canal_denuncias'));

CREATE OR REPLACE FUNCTION public.canal_denuncia_anexo_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path
  OR NEW.denuncia_id  IS DISTINCT FROM OLD.denuncia_id
  OR NEW.origem       IS DISTINCT FROM OLD.origem
  OR NEW.nome_arquivo IS DISTINCT FROM OLD.nome_arquivo THEN
    RAISE EXCEPTION 'O arquivo anexado é imutável. É possível reclassificar, não substituir.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_canal_anexo_guard ON public."CANAL_DENUNCIA_ANEXO";
CREATE TRIGGER trg_canal_anexo_guard
  BEFORE UPDATE ON public."CANAL_DENUNCIA_ANEXO"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_anexo_guard();

-- Sem policy de DELETE: nenhum anexo sai pela API, de nenhuma origem.

-- Storage: o Comitê lê e escreve; o público não alcança o bucket (a entrada
-- dele é a edge function, que usa service_role e ignora estas políticas).
DROP POLICY IF EXISTS denuncia_evid_select ON storage.objects;
CREATE POLICY denuncia_evid_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'denuncia-evidencias'
         AND public.tem_acesso_menu('central_servicos_canal_denuncias'));

DROP POLICY IF EXISTS denuncia_evid_insert ON storage.objects;
CREATE POLICY denuncia_evid_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'denuncia-evidencias'
              AND public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- =====================================================================
-- 10. CADASTRO DE RESPONSÁVEIS PELA APURAÇÃO
-- =====================================================================
CREATE TABLE IF NOT EXISTS public."COMITE_ETICA_RESPONSAVEL" (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  papel      text,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public."COMITE_ETICA_RESPONSAVEL" IS
  'Quem pode ser apontado como responsavel pela apuracao. Fecha o texto livre que fazia o mesmo nome virar dois responsaveis no relatorio.';

ALTER TABLE public."COMITE_ETICA_RESPONSAVEL" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."COMITE_ETICA_RESPONSAVEL" FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."COMITE_ETICA_RESPONSAVEL" TO authenticated;

DROP POLICY IF EXISTS comite_resp_select ON public."COMITE_ETICA_RESPONSAVEL";
CREATE POLICY comite_resp_select ON public."COMITE_ETICA_RESPONSAVEL"
  FOR SELECT TO authenticated
  USING (public.tem_acesso_menu('central_servicos_canal_denuncias'));

-- Manter o cadastro é ato de coordenação: exige a capacidade de sigilo, que
-- é quem manda no módulo.
DROP POLICY IF EXISTS comite_resp_escrever ON public."COMITE_ETICA_RESPONSAVEL";
CREATE POLICY comite_resp_escrever ON public."COMITE_ETICA_RESPONSAVEL"
  FOR ALL TO authenticated
  USING (public.tem_acesso_menu('comite_etica_sigilo'))
  WITH CHECK (public.tem_acesso_menu('comite_etica_sigilo'));

-- =====================================================================
-- 11. ENTREVISTAS E MANIFESTAÇÕES NO FIO DA CONVERSA
-- =====================================================================
ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM"
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'mensagem';

DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM" ADD CONSTRAINT canal_msg_tipo_chk
    CHECK (tipo IN ('mensagem','nota','entrevista','manifestacao','providencia'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Entrevista e manifestação são registro de trabalho: nunca saem para o
-- denunciante, então são obrigatoriamente internas.
DO $$
BEGIN
  ALTER TABLE public."CANAL_DENUNCIA_MENSAGEM" ADD CONSTRAINT canal_msg_tipo_interna_chk
    CHECK (tipo IN ('mensagem','nota') OR interna);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public."CANAL_DENUNCIA_MENSAGEM".tipo IS
  'Separa conversa de registro de apuracao. entrevista/manifestacao/providencia sao sempre internas e saem tipadas no PDF.';

-- =====================================================================
-- 12. TRILHA COMPLETA + JUSTIFICATIVA + ÚLTIMA MOVIMENTAÇÃO
-- =====================================================================
ALTER TABLE public."CANAL_DENUNCIA_EVENTO"
  ADD COLUMN IF NOT EXISTS justificativa text,
  ADD COLUMN IF NOT EXISTS por_nome      text;

-- Antes só quatro campos deixavam rastro (situação, resultado, gravidade e
-- responsável); mudar contrato, parecer ou setor não registrava nada. Agora a
-- comparação é sobre a linha inteira, campo a campo — é isto que atende
-- "manter o histórico das versões" sem uma tabela de versões.
CREATE OR REPLACE FUNCTION public.canal_denuncia_registrar_evento()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_antes  jsonb := to_jsonb(OLD);
  v_depois jsonb := to_jsonb(NEW);
  v_chave  text;
  v_de     text;
  v_para   text;
  v_nome   text;
  -- Fora da trilha: carimbos automáticos e o campo que carrega a própria
  -- justificativa. Registrá-los encheria o histórico de linhas sem sentido.
  v_ignorar text[] := ARRAY['updated_at','ultima_movimentacao_em','justificativa_mudanca','senha_hash'];
BEGIN
  SELECT COALESCE(p.display_name, p.email) INTO v_nome
    FROM public.profiles p WHERE p.id = auth.uid();

  FOR v_chave IN SELECT jsonb_object_keys(v_depois) LOOP
    CONTINUE WHEN v_chave = ANY(v_ignorar);
    v_de   := v_antes  ->> v_chave;
    v_para := v_depois ->> v_chave;
    CONTINUE WHEN v_de IS NOT DISTINCT FROM v_para;

    INSERT INTO public."CANAL_DENUNCIA_EVENTO"
      (denuncia_id, campo, de, para, por_user_id, por_nome, justificativa)
    VALUES
      (NEW.id, v_chave, v_de, v_para, auth.uid(), v_nome,
       -- A justificativa acompanha a mudança de situação; nos demais campos
       -- ela não se aplica e ficaria repetida em dez linhas.
       CASE WHEN v_chave = 'status' THEN NEW.justificativa_mudanca END);
  END LOOP;

  RETURN NEW;
END $$;

-- Toda alteração é movimentação — inclusive as que não mudam a situação.
-- Sem isto, "parado há 40 dias" continuaria significando "aberto há 40 dias".
CREATE OR REPLACE FUNCTION public.canal_denuncia_movimentou()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.ultima_movimentacao_em := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_canal_denuncia_movimentou ON public."CANAL_DENUNCIA";
CREATE TRIGGER trg_canal_denuncia_movimentou
  BEFORE UPDATE ON public."CANAL_DENUNCIA"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_movimentou();

-- Mensagem, providência e anexo também são movimentação do procedimento.
CREATE OR REPLACE FUNCTION public.canal_denuncia_filho_movimentou()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public."CANAL_DENUNCIA" SET ultima_movimentacao_em = now()
   WHERE id = NEW.denuncia_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_canal_msg_movimentou ON public."CANAL_DENUNCIA_MENSAGEM";
CREATE TRIGGER trg_canal_msg_movimentou
  AFTER INSERT ON public."CANAL_DENUNCIA_MENSAGEM"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_filho_movimentou();

DROP TRIGGER IF EXISTS trg_canal_prov_movimentou ON public."CANAL_DENUNCIA_PROVIDENCIA";
CREATE TRIGGER trg_canal_prov_movimentou
  AFTER INSERT OR UPDATE ON public."CANAL_DENUNCIA_PROVIDENCIA"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_filho_movimentou();

DROP TRIGGER IF EXISTS trg_canal_anexo_movimentou ON public."CANAL_DENUNCIA_ANEXO";
CREATE TRIGGER trg_canal_anexo_movimentou
  AFTER INSERT ON public."CANAL_DENUNCIA_ANEXO"
  FOR EACH ROW EXECUTE FUNCTION public.canal_denuncia_filho_movimentou();

-- =====================================================================
-- 13. A TRAVA, ATUALIZADA
-- =====================================================================
-- Os campos novos do DENUNCIANTE entram na imutabilidade (são relato).
-- Os da Presidência ganham trava própria: só quem tem a capacidade escreve —
-- e isso é verificado no banco, não na tela, porque a tela é sugestão.
CREATE OR REPLACE FUNCTION public.canal_denuncia_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.protocolo                IS DISTINCT FROM OLD.protocolo
  OR NEW.senha_hash               IS DISTINCT FROM OLD.senha_hash
  OR NEW.identificado             IS DISTINCT FROM OLD.identificado
  OR NEW.anonimo                  IS DISTINCT FROM OLD.anonimo
  OR NEW.nome_completo            IS DISTINCT FROM OLD.nome_completo
  OR NEW.cpf                      IS DISTINCT FROM OLD.cpf
  OR NEW.email                    IS DISTINCT FROM OLD.email
  OR NEW.data_nascimento          IS DISTINCT FROM OLD.data_nascimento
  OR NEW.telefone_fixo            IS DISTINCT FROM OLD.telefone_fixo
  OR NEW.celular                  IS DISTINCT FROM OLD.celular
  OR NEW.relacao                  IS DISTINCT FROM OLD.relacao
  OR NEW.tipo_denuncia            IS DISTINCT FROM OLD.tipo_denuncia
  OR NEW.local_ocorrencia         IS DISTINCT FROM OLD.local_ocorrencia
  OR NEW.como_soube               IS DISTINCT FROM OLD.como_soube
  OR NEW.lideranca_ciente         IS DISTINCT FROM OLD.lideranca_ciente
  OR NEW.lideranca_envolvida      IS DISTINCT FROM OLD.lideranca_envolvida
  OR NEW.lideranca_ocultou        IS DISTINCT FROM OLD.lideranca_ocultou
  OR NEW.lideranca_ciente_quem    IS DISTINCT FROM OLD.lideranca_ciente_quem
  OR NEW.lideranca_envolvida_quem IS DISTINCT FROM OLD.lideranca_envolvida_quem
  OR NEW.lideranca_ocultou_quem   IS DISTINCT FROM OLD.lideranca_ocultou_quem
  OR NEW.descricao                IS DISTINCT FROM OLD.descricao
  OR NEW.testemunhas              IS DISTINCT FROM OLD.testemunhas
  OR NEW.evidencias               IS DISTINCT FROM OLD.evidencias
  OR NEW.valor_financeiro         IS DISTINCT FROM OLD.valor_financeiro
  OR NEW.sugestao                 IS DISTINCT FROM OLD.sugestao
  OR NEW.created_at               IS DISTINCT FROM OLD.created_at
  -- Campos novos que também são relato (bloco 2 e 4 desta migration)
  OR NEW.empresa_id               IS DISTINCT FROM OLD.empresa_id
  OR NEW.empresa_nome             IS DISTINCT FROM OLD.empresa_nome
  OR NEW.contrato_informado       IS DISTINCT FROM OLD.contrato_informado
  OR NEW.contrato_situacao        IS DISTINCT FROM OLD.contrato_situacao
  OR NEW.ocorrencia_data          IS DISTINCT FROM OLD.ocorrencia_data
  OR NEW.ocorrencia_hora          IS DISTINCT FROM OLD.ocorrencia_hora
  OR NEW.ocorrencia_frequencia    IS DISTINCT FROM OLD.ocorrencia_frequencia
  OR NEW.risco_imediato           IS DISTINCT FROM OLD.risco_imediato
  OR NEW.risco_imediato_detalhe   IS DISTINCT FROM OLD.risco_imediato_detalhe
  OR NEW.retaliacao               IS DISTINCT FROM OLD.retaliacao
  OR NEW.retaliacao_detalhe       IS DISTINCT FROM OLD.retaliacao_detalhe
  OR NEW.denunciado_informado     IS DISTINCT FROM OLD.denunciado_informado
  OR NEW.denunciado_funcao        IS DISTINCT FROM OLD.denunciado_funcao
  THEN
    RAISE EXCEPTION 'O conteúdo da denúncia é imutável. A tratativa altera apenas a apuração, nunca o relato.'
      USING ERRCODE = '42501';
  END IF;

  -- Presidência: capacidade própria, cobrada no banco.
  IF (NEW.decisao_final         IS DISTINCT FROM OLD.decisao_final
   OR NEW.decisao_em            IS DISTINCT FROM OLD.decisao_em
   OR NEW.decisao_fundamentacao IS DISTINCT FROM OLD.decisao_fundamentacao
   OR NEW.decisao_sobre_parecer IS DISTINCT FROM OLD.decisao_sobre_parecer
   OR NEW.decisao_medidas       IS DISTINCT FROM OLD.decisao_medidas)
     AND NOT public.tem_acesso_menu('comite_etica_presidencia') THEN
    RAISE EXCEPTION 'Somente a Presidência registra a decisão final.' USING ERRCODE = '42501';
  END IF;

  -- Mudou de situação sem dizer por quê? Não passa. É o que transforma o
  -- histórico em algo que se lê depois — data e hora sozinhas não explicam
  -- por que um caso ficou seis meses aguardando documentos.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(btrim(NEW.justificativa_mudanca), '') = '' THEN
    RAISE EXCEPTION 'Informe a justificativa da mudança de situação.' USING ERRCODE = '22023';
  END IF;

  -- Carimba quem decidiu, sem depender da tela mandar.
  IF NEW.decisao_final IS DISTINCT FROM OLD.decisao_final AND NEW.decisao_final IS NOT NULL THEN
    NEW.decisao_em          := COALESCE(NEW.decisao_em, now());
    NEW.decisao_por_user_id := auth.uid();
    NEW.decisao_por_nome    := (SELECT COALESCE(p.display_name, p.email)
                                  FROM public.profiles p WHERE p.id = auth.uid());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =====================================================================
-- 14. SIGILO QUE RESTRINGE DE VERDADE
-- =====================================================================
-- RLS é por LINHA e não mascara coluna. Para a identidade do denunciante
-- ficar restrita sem esconder o caso inteiro, a leitura passa a ser por
-- visão: quem não tem `comite_etica_sigilo` continua vendo a denúncia, o
-- relato e a apuração — mas recebe a identificação em branco.
--
-- `security_invoker` mantém a RLS da tabela valendo para quem consulta: a
-- visão mascara, não amplia.
CREATE OR REPLACE VIEW public.v_canal_denuncia
WITH (security_invoker = true) AS
SELECT
  d.id, d.protocolo, d.identificado, d.anonimo,
  -- Identidade: só com a capacidade de sigilo.
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.nome_completo  END AS nome_completo,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.cpf            END AS cpf,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.email          END AS email,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.data_nascimento END AS data_nascimento,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.telefone_fixo  END AS telefone_fixo,
  CASE WHEN public.tem_acesso_menu('comite_etica_sigilo') THEN d.celular        END AS celular,
  -- Bandeira para a tela explicar a lacuna em vez de parecer cadastro vazio.
  (d.identificado AND NOT public.tem_acesso_menu('comite_etica_sigilo')) AS identidade_restrita,

  d.empresa_id, d.empresa_nome, d.contrato_informado, d.contrato_situacao,
  d.relacao, d.tipo_denuncia, d.local_ocorrencia, d.como_soube,
  d.ocorrencia_data, d.ocorrencia_hora, d.ocorrencia_frequencia,
  d.risco_imediato, d.risco_imediato_detalhe, d.retaliacao, d.retaliacao_detalhe,
  d.denunciado_informado, d.denunciado_funcao,
  d.lideranca_ciente, d.lideranca_envolvida, d.lideranca_ocultou,
  d.lideranca_ciente_quem, d.lideranca_envolvida_quem, d.lideranca_ocultou_quem,
  d.titulo, d.resumo, d.descricao, d.testemunhas, d.evidencias,
  d.valor_financeiro, d.sugestao,

  d.origem, d.tipo_classificado, d.gravidade, d.sigilo,
  d.denunciado_nome, d.denunciado_empregado_id, d.lider_nome, d.lider_empregado_id,
  d.diretoria, d.contrato, d.setor, d.unidade, d.cidade,
  d.apuracao_responsavel, d.apuracao_responsavel_id,
  d.apuracao_inicio, d.apuracao_fim, d.primeira_providencia_em,
  d.pendencia_atual, d.evidencias_analise,
  d.resultado, d.medidas, d.medida_principal, d.recomendacao,
  d.houve_recurso, d.recurso_resultado, d.recurso_data,
  d.causa_raiz, d.causa_raiz_detalhe, d.acoes_preventivas, d.acoes_corretivas,
  d.sla_dias_override,
  d.status, d.justificativa_mudanca, d.parecer_interno, d.retorno_denunciante,

  d.decisao_final, d.decisao_em, d.decisao_fundamentacao,
  d.decisao_sobre_parecer, d.decisao_medidas, d.decisao_por_nome,

  d.concluido_em, d.ultima_movimentacao_em, d.created_at, d.updated_at
FROM public."CANAL_DENUNCIA" d;

COMMENT ON VIEW public.v_canal_denuncia IS
  'Leitura do canal com a identidade do denunciante mascarada para quem nao tem comite_etica_sigilo. E por aqui que as telas leem; a tabela so recebe escrita.';

REVOKE ALL ON public.v_canal_denuncia FROM anon;
GRANT SELECT ON public.v_canal_denuncia TO authenticated;

-- A tabela deixa de ser lida direto: com SELECT nela, bastaria pedir as
-- colunas de identidade e a visão viraria decoração.
REVOKE SELECT ON TABLE public."CANAL_DENUNCIA" FROM authenticated;
GRANT UPDATE ON TABLE public."CANAL_DENUNCIA" TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- ROLLBACK (resumido — a ordem importa)
--   DROP VIEW IF EXISTS public.v_canal_denuncia;
--   GRANT SELECT ON public."CANAL_DENUNCIA" TO authenticated;
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_ANEXO";
--   DROP TABLE IF EXISTS public."CANAL_DENUNCIA_PROVIDENCIA";
--   DROP TABLE IF EXISTS public."COMITE_ETICA_RESPONSAVEL";
--   DELETE FROM storage.buckets WHERE id = 'denuncia-evidencias';
--   ALTER TABLE public."CANAL_DENUNCIA" DROP COLUMN empresa_id, ... (ver blocos 2 a 7);
--   Restaurar canal_denuncia_guard e canal_denuncia_registrar_evento da 20260901000006;
--   UPDATE ... status: triagem→em_analise, aguardando_cumprimento→julgada, concluida→encerrada;
--   UPDATE public.app_menu SET ativo = true WHERE codigo = 'central_servicos_denuncias';
-- =====================================================================
