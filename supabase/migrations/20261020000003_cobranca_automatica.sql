-- SIS-2026-0653: cobrança automática a partir do Relatório de Serviços (nf_emissao).
--
-- O que muda: uma rotina (edge function `cobranca-automatica`, chamada de hora em hora pelo worker) lê as notas em
-- aberto do Relatório de Serviços, agrupa por contrato e envia a cobrança da faixa do Financeiro (aviso, verde,
-- amarela, laranja e vermelha administrativas). Contrato cuja nota mais atrasada está na faixa ROXA ou PRETA fica
-- fora do envio automático, por inteiro: o Jurídico analisa e envia à mão.
--
-- A rotina nasce DESLIGADA (modo = 'desligado'). Os modos são: desligado, simulacao (só calcula, mostra na tela),
-- piloto (envia tudo para um e-mail interno) e producao (envia aos tomadores). Quem muda é o Financeiro, na tela
-- Cobranças > Automação, com acesso 'alterar' em 'cobrancas'.
--
-- Garantia contra envio judicial em duas camadas: (1) o código recusa faixa roxa/preta antes de enviar;
-- (2) a tabela de envios tem CHECK que impede registrar envio automático dessas faixas.
--
-- Os modelos abaixo (cobranca_auto_*) são os textos que o Financeiro usa hoje no sistema de cobranças antigo
-- (Flask), com os mesmos campos ({{t_nota}}, {{lista_html}}...), para o e-mail de um contrato com várias notas.
-- Só as 5 faixas do Financeiro têm modelo aqui; nenhum texto jurídico entra na automação.
--
-- ROLLBACK:
--   SELECT cron.unschedule('cobranca-automatica-tick');
--   DROP TABLE IF EXISTS public.cobranca_auto_envio, public.cobranca_auto_contrato_manual, public.cobranca_auto_config;
--   DELETE FROM public.template_mensagem WHERE codigo LIKE 'cobranca_auto_%';

SET lock_timeout = '5s';

-- 1) Configuração (uma linha só)
CREATE TABLE IF NOT EXISTS public.cobranca_auto_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modo text NOT NULL DEFAULT 'desligado' CHECK (modo IN ('desligado', 'simulacao', 'piloto', 'producao')),
  email_piloto text,
  cc_fixo text[] NOT NULL DEFAULT ARRAY['gerenciaoperacional@haggltda.com.br'],
  assinatura_html text NOT NULL DEFAULT '',
  -- dias entre reenvios dentro da mesma faixa (0 = não repete)
  intervalo_dias jsonb NOT NULL DEFAULT '{"aviso":0,"verde":7,"amarela":7,"laranja":7,"vermelha":7}'::jsonb,
  aviso_dias_antes int NOT NULL DEFAULT 5 CHECK (aviso_dias_antes BETWEEN 0 AND 30),
  somente_dias_uteis boolean NOT NULL DEFAULT true,
  hora_inicio int NOT NULL DEFAULT 8 CHECK (hora_inicio BETWEEN 0 AND 23),
  hora_fim int NOT NULL DEFAULT 17 CHECK (hora_fim BETWEEN 1 AND 24),
  limite_por_execucao int NOT NULL DEFAULT 30 CHECK (limite_por_execucao BETWEEN 1 AND 200),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
INSERT INTO public.cobranca_auto_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2) Contratos que o Financeiro/Jurídico quer só no manual
CREATE TABLE IF NOT EXISTS public.cobranca_auto_contrato_manual (
  contrato_id uuid PRIMARY KEY REFERENCES public.contratos(id) ON DELETE CASCADE,
  motivo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
);

-- 3) Registro de cada envio automático (alimenta a cadência, o "Último e-mail" e a trilha de auditoria)
CREATE TABLE IF NOT EXISTS public.cobranca_auto_envio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid REFERENCES public.contratos(id) ON DELETE SET NULL,
  contrato_nome text NOT NULL,
  empresa_codigo text,
  -- Só faixas do Financeiro: o banco recusa registrar envio automático judicial (roxa/preta).
  faixa text NOT NULL CHECK (faixa IN ('aviso', 'verde', 'amarela', 'laranja', 'vermelha')),
  modo text NOT NULL CHECK (modo IN ('piloto', 'producao')),
  status text NOT NULL CHECK (status IN ('enviado', 'falhou')),
  notas jsonb NOT NULL DEFAULT '[]'::jsonb,
  qtd_notas int NOT NULL DEFAULT 0,
  valor_total numeric(15,2) NOT NULL DEFAULT 0,
  destinatarios text[] NOT NULL DEFAULT '{}',
  cc text[] NOT NULL DEFAULT '{}',
  assunto text,
  corpo text,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cobranca_auto_envio_contrato ON public.cobranca_auto_envio (contrato_id, faixa, criado_em DESC);

-- 4) Acesso: mesma tela 'cobrancas' (alterar = Financeiro/Controladoria; aprovar = Jurídico; visualizar = Comercial).
--    Quem escreve nos envios é só a rotina (service_role); a tela apenas lê.
ALTER TABLE public.cobranca_auto_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobranca_auto_contrato_manual ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobranca_auto_envio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cac_select ON public.cobranca_auto_config;
CREATE POLICY cac_select ON public.cobranca_auto_config FOR SELECT TO authenticated USING (
  public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'aprovar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'visualizar'::public.app_acao)
);
DROP POLICY IF EXISTS cac_update ON public.cobranca_auto_config;
CREATE POLICY cac_update ON public.cobranca_auto_config FOR UPDATE TO authenticated
  USING (public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao));

DROP POLICY IF EXISTS cacm_select ON public.cobranca_auto_contrato_manual;
CREATE POLICY cacm_select ON public.cobranca_auto_contrato_manual FOR SELECT TO authenticated USING (
  public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'aprovar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'visualizar'::public.app_acao)
);
-- Marcar contrato como "só manual" é o lado seguro: o Jurídico (aprovar) também pode.
DROP POLICY IF EXISTS cacm_write ON public.cobranca_auto_contrato_manual;
CREATE POLICY cacm_write ON public.cobranca_auto_contrato_manual FOR ALL TO authenticated
  USING (public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao) OR public.can_access(auth.uid(), 'cobrancas', 'aprovar'::public.app_acao))
  WITH CHECK (public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao) OR public.can_access(auth.uid(), 'cobrancas', 'aprovar'::public.app_acao));

DROP POLICY IF EXISTS cae_select ON public.cobranca_auto_envio;
CREATE POLICY cae_select ON public.cobranca_auto_envio FOR SELECT TO authenticated USING (
  public.can_access(auth.uid(), 'cobrancas', 'alterar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'aprovar'::public.app_acao)
  OR public.can_access(auth.uid(), 'cobrancas', 'visualizar'::public.app_acao)
);

-- Cluster pós-virada: tabela nova não ganha GRANT sozinha (ver 20261020000002).
GRANT SELECT, UPDATE ON TABLE public.cobranca_auto_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cobranca_auto_contrato_manual TO authenticated;
GRANT SELECT ON TABLE public.cobranca_auto_envio TO authenticated;
GRANT ALL ON TABLE public.cobranca_auto_config, public.cobranca_auto_contrato_manual, public.cobranca_auto_envio TO service_role;

-- 5) Modelos de e-mail (textos do Financeiro; só as faixas administrativas)
INSERT INTO public.template_mensagem (empresa_id, codigo, nome, tipo, assunto, corpo, variaveis) VALUES
(NULL, 'cobranca_auto_aviso', 'Aviso amigável (pré-vencimento) — automático', 'email',
 $cobauto$LEMBRETE DE VENCIMENTO - {{cliente}}$cobauto$,
 $cobauto$Prezado(a),<br><br>

Este e-mail tem por objetivo lembrá-lo(a) acerca do vencimento do pagamento referente {{t_nota}}{{t_num}}, {{t_emi}}{{t_comp}}{{t_venc}} conforme detalhamento abaixo:<br><br>

{{lista_html}}<br>

<b>Valor Total: {{valor_total}}</b><br><br>

Caso o pagamento já esteja devidamente programado, pedimos a gentileza de nos informar a previsão de liquidação para fins de controle interno.<br><br>

Permanecemos à disposição para quaisquer esclarecimentos adicionais, bem como para o envio de segunda via da nota fiscal ou informações complementares que se façam necessárias.$cobauto$,
 '["cliente", "lista_html", "t_comp", "t_emi", "t_nota", "t_num", "t_venc", "valor_total"]'::jsonb),

(NULL, 'cobranca_auto_verde', 'Faixa verde (até 15 dias) — automático', 'email',
 $cobauto$Pendência de pagamento - {{cliente}}$cobauto$,
 $cobauto$Prezado(a),<br><br>Conforme nossos registros, o pagamento referente {{t_nota}}{{t_num}}{{t_venc}} ainda não consta como liquidado até a presente data, conforme informações abaixo:<br><br>{{lista_html}}<br><b>Valor Total em Aberto: {{valor_total}}</b><br><br>Dessa forma, solicitamos, por gentileza, a verificação dessa pendência e, se possível, a gentileza de nos informar uma previsão para a regularização do valor em aberto. Colocamo-nos à disposição para o envio de segunda via da nota fiscal, bem como para quaisquer esclarecimentos adicionais que se façam necessários. Aguardamos seu retorno.$cobauto$,
 '["cliente", "lista_html", "t_nota", "t_num", "t_venc", "valor_total"]'::jsonb),

(NULL, 'cobranca_auto_amarela', 'Faixa amarela (16 a 30 dias) — automático', 'email',
 $cobauto$Cobrança administrativa de pagamento - {{cliente}}$cobauto$,
 $cobauto$Prezados(as),<br><br>Cumprimentando-os cordialmente, vimos, por meio deste, reiterar formalmente a pendência administrativa e financeira relacionada ao Contrato <b>{{cliente}}</b>, firmado entre este órgão e a empresa <b>{{ass_emp}}</b>, cujo objeto consiste na prestação continuada de serviços.<br><br>Conforme histórico de tratativas já estabelecido, foram realizadas tentativas de regularização ao longo das últimas semanas, por meio de comunicações formais por e-mail, contatos institucionais, alinhamentos com a fiscalização contratual e tratativas operacionais. Não obstante tais esforços, até o presente momento permanece pendente de regularização o pagamento referente {{t_nota}}{{t_num}}, conforme informações abaixo:<br><br>{{lista_html}}<br><b>Valor Total em Aberto: {{valor_total}}</b><br><br>Importa destacar que, desde o início da contratação, a empresa vem mantendo postura absolutamente colaborativa, diligente e comprometida com a execução integral dos serviços, assegurando padrão técnico elevado, regularidade operacional, qualidade na prestação e estrita observância das exigências administrativas estabelecidas pelo contratante.<br><br>Ressalta-se que, mesmo diante do cenário de inadimplência, os serviços vêm sendo executados de forma contínua e ininterrupta, sem qualquer redução operacional, paralisação de postos ou prejuízo à rotina institucional deste órgão, preservando-se integralmente o interesse público envolvido.<br><br>Nesse sentido, registra-se de forma expressa que os colaboradores permanecem regularmente em atividade, a empresa mantém integral cumprimento de suas obrigações trabalhistas, previdenciárias, fiscais e operacionais, não houve interrupção ou descontinuidade na execução dos serviços, não foi causado qualquer prejuízo à Administração, bem como a execução contratual segue preservada com o mesmo padrão de qualidade inicialmente pactuado.<br><br>A empresa possui histórico consolidado de atuação séria, responsável e tecnicamente qualificada, mantendo compromisso permanente com a boa execução contratual, com a legalidade administrativa e com a preservação do interesse público.<br><br>Todavia, a permanência da pendência ora relatada passa a produzir impacto relevante sobre a equação econômico-financeira do contrato, afetando diretamente o fluxo financeiro necessário à manutenção dos serviços continuados, especialmente em razão da natureza intensiva em mão de obra da contratação.<br><br>Cabe destacar que a retenção prolongada do pagamento ou da análise documental necessária à sua liberação, quando não solucionada em prazo razoável, ultrapassa o campo da mera mora administrativa, passando a comprometer o equilíbrio econômico-financeiro contratualmente assegurado, nos termos da legislação vigente.<br><br>Diante desse contexto, solicitamos, de forma expressa e objetiva:<br>
<ol type="a">
    <li>manifestação formal deste órgão acerca da pendência;</li>
    <li>indicação das providências adotadas até o momento;</li>
    <li>informação precisa da data prevista para regularização;</li>
    <li>confirmação de eventual cronograma administrativo interno já estabelecido.</li>
</ol>
Ressaltamos que esta empresa permanece, como sempre, aberta ao diálogo institucional e à construção de solução administrativa célere, eficiente e adequada, pautada na boa-fé, na cooperação e na preservação da relação contratual.<br><br>Entretanto, diante da continuidade da situação, fica desde já registrado que, não havendo regularização em prazo razoável, poderão ser adotadas as medidas administrativas e jurídicas cabíveis, inclusive aquelas voltadas à recomposição do equilíbrio econômico-financeiro do contrato, à formalização da cobrança administrativa e à incidência de encargos moratórios, sem prejuízo de outras providências legalmente admitidas.<br><br>A presente comunicação, portanto, constitui medida necessária de resguardo contratual, diante do histórico já consolidado de tratativas e da necessidade de preservação responsável da continuidade operacional dos serviços.<br><br>Permanecemos à disposição para realização de reunião institucional imediata, caso entendam pertinente.$cobauto$,
 '["ass_emp", "cliente", "lista_html", "t_nota", "t_num", "valor_total"]'::jsonb),

(NULL, 'cobranca_auto_laranja', 'Faixa laranja, Anexo I administrativo — automático', 'email',
 $cobauto$Cobrança administrativa de pagamento - {{cliente}}$cobauto$,
 $cobauto$Prezados(as),<br><br>Cumprimentando-os cordialmente, vimos, por meio deste, reiterar formalmente a pendência administrativa e financeira relacionada ao Contrato <b>{{cliente}}</b>, firmado entre este órgão e a empresa <b>{{ass_emp}}</b>, cujo objeto consiste na prestação continuada de serviços.<br><br>Conforme histórico de tratativas já estabelecido, foram realizadas tentativas de regularização ao longo das últimas semanas, por meio de comunicações formais por e-mail, contatos institucionais, alinhamentos com a fiscalização contratual e tratativas operacionais. Não obstante tais esforços, até o presente momento permanece pendente de regularização o pagamento referente {{t_nota}}{{t_num}}, conforme informações abaixo:<br><br>{{lista_html}}<br><b>Valor Total em Aberto: {{valor_total}}</b><br><br>Importa destacar que, desde o início da contratação, a empresa vem mantendo postura absolutamente colaborativa, diligente e comprometida com a execução integral dos serviços, assegurando padrão técnico elevado, regularidade operacional, qualidade na prestação e estrita observância das exigências administrativas estabelecidas pelo contratante.<br><br>Ressalta-se que, mesmo diante do cenário de inadimplência, os serviços vêm sendo executados de forma contínua e ininterrupta, sem qualquer redução operacional, paralisação de postos ou prejuízo à rotina institucional deste órgão, preservando-se integralmente o interesse público envolvido.<br><br>Nesse sentido, registra-se de forma expressa que os colaboradores permanecem regularmente em atividade, a empresa mantém integral cumprimento de suas obrigações trabalhistas, previdenciárias, fiscais e operacionais, não houve interrupção ou descontinuidade na execução dos serviços, não foi causado qualquer prejuízo à Administração, bem como a execução contratual segue preservada com o mesmo padrão de qualidade inicialmente pactuado.<br><br>A empresa possui histórico consolidado de atuação séria, responsável e tecnicamente qualificada, mantendo compromisso permanente com a boa execução contratual, com a legalidade administrativa e com a preservação do interesse público.<br><br>Todavia, a permanência da pendência ora relatada passa a produzir impacto relevante sobre a equação econômico-financeira do contrato, afetando diretamente o fluxo financeiro necessário à manutenção dos serviços continuados, especialmente em razão da natureza intensiva em mão de obra da contratação.<br><br>Cabe destacar que a retenção prolongada do pagamento ou da análise documental necessária à sua liberação, quando não solucionada em prazo razoável, ultrapassa o campo da mera mora administrativa, passando a comprometer o equilíbrio econômico-financeiro contratualmente assegurado, nos termos da legislação vigente.<br><br>Diante desse contexto, solicitamos, de forma expressa e objetiva:<br>
<ol type="a">
    <li>manifestação formal deste órgão acerca da pendência;</li>
    <li>indicação das providências adotadas até o momento;</li>
    <li>informação precisa da data prevista para regularização;</li>
    <li>confirmação de eventual cronograma administrativo interno já estabelecido.</li>
</ol>
Ressaltamos que esta empresa permanece, como sempre, aberta ao diálogo institucional e à construção de solução administrativa célere, eficiente e adequada, pautada na boa-fé, na cooperação e na preservação da relação contratual.<br><br>Entretanto, diante da continuidade da situação, fica desde já registrado que, não havendo regularização em prazo razoável, poderão ser adotadas as medidas administrativas e jurídicas cabíveis, inclusive aquelas voltadas à recomposição do equilíbrio econômico-financeiro do contrato, à formalização da cobrança administrativa e à incidência de encargos moratórios, sem prejuízo de outras providências legalmente admitidas.<br><br>A presente comunicação, portanto, constitui medida necessária de resguardo contratual, diante do histórico já consolidado de tratativas e da necessidade de preservação responsável da continuidade operacional dos serviços.<br><br>Permanecemos à disposição para realização de reunião institucional imediata, caso entendam pertinente.$cobauto$,
 '["ass_emp", "cliente", "lista_html", "t_nota", "t_num", "valor_total"]'::jsonb),

(NULL, 'cobranca_auto_vermelha', 'Faixa vermelha, Anexo III administrativo — automático', 'email',
 $cobauto$Reiteração de Cobrança Administrativa de Pagamento - {{cliente}}$cobauto$,
 $cobauto$Prezados(as),<br><br>Cumprimentando-os cordialmente, vimos, por meio deste, reiterar, em caráter expresso, técnico e fundamentado, a pendência financeira relacionada ao Contrato <b>{{cliente}}</b>, firmado entre este órgão e a empresa <b>{{ass_emp}}</b>, cujo objeto consiste na prestação continuada de serviços.<br><br>Até o presente momento, permanece sem a devida liquidação o pagamento referente {{t_nota}}{{t_num}}, configurando atraso administrativo relevante e injustificado, conforme detalhamento abaixo:<br><br>{{lista_html}}<br><b>Valor Total em Aberto: {{valor_total}}</b><br><br>Importa destacar que a empresa, desde o início da contratação, vem adotando postura absolutamente colaborativa, diligente e comprometida, assegurando a execução integral dos serviços contratados, com estrita observância das exigências técnicas, operacionais e administrativas estabelecidas.<br><br>Durante todo o período contratual, os serviços foram mantidos de forma contínua, regular e ininterrupta, sem qualquer redução operacional, paralisação de postos ou prejuízo à continuidade institucional deste órgão, preservando-se integralmente o interesse público envolvido.<br><br>Ressalta-se, de forma inequívoca, que os colaboradores permanecem regularmente em atividade, a empresa mantém integral cumprimento de suas obrigações trabalhistas, previdenciárias, fiscais e operacionais, não houve interrupção ou descontinuidade na execução dos serviços, não foi causado qualquer prejuízo à Administração, bem como a continuidade e a qualidade do serviço público foram integralmente preservadas.<br><br>Registre-se, ainda, que ao longo das últimas semanas foram realizadas diversas tentativas de solução administrativa, todas devidamente documentadas, incluindo o envio de comunicações formais por e-mail, contatos institucionais com o setor financeiro, tratativas junto à fiscalização contratual, reforços administrativos reiterados e solicitações expressas de posicionamento e providências.<br><br>Não obstante o histórico consistente de tratativas, a pendência permanece sem qualquer solução efetiva até o momento, ultrapassando o âmbito de mera mora administrativa e passando a impactar diretamente a equação econômico-financeira do contrato, nos termos assegurados pela legislação vigente.<br><br>Cumpre registrar, de forma expressa, que a contratada não deu causa ao atraso verificado, tendo cumprido integralmente todas as suas obrigações contratuais, o que reforça a necessidade de regularização imediata por parte da Administração.<br><br>Ademais, destaca-se que o contrato em questão possui dotação orçamentária específica previamente prevista, evidenciando que os recursos financeiros destinados à sua execução foram regularmente planejados e vinculados à despesa pública correspondente.<br><br>Nesse contexto, a persistência do inadimplemento, mesmo diante da existência de previsão orçamentária, pode caracterizar irregularidade administrativa relevante, na medida em que pode indicar, em tese:<br>
<ul>
    <li>possível desvio de finalidade de recursos públicos, caso verbas vinculadas ao contrato estejam sendo destinadas a finalidades diversas;</li>
    <li>eventual deficiência na gestão financeira ou irregular execução orçamentária da despesa pública;</li>
    <li>possível violação aos princípios da responsabilidade fiscal, considerando a existência de contratação regularmente autorizada, sem a correspondente quitação das obrigações assumidas.</li>
</ul>
Ressalta-se que tais situações se inserem no âmbito de fiscalização dos Tribunais de Contas, órgãos competentes para o controle da legalidade, legitimidade e economicidade da execução orçamentária, financeira e contratual da Administração Pública.<br><br><b>DA POSSÍVEL ATUAÇÃO DO TRIBUNAL DE CONTAS</b><br><br>Diante disso, a persistência da inadimplência poderá ensejar, caso não regularizada em prazo razoável, a comunicação formal dos fatos ao Tribunal de Contas competente, para fins de apuração e adoção das medidas cabíveis, dentre as quais:<br>
<ol type="I">
    <li>realização de auditoria na execução orçamentária do contrato;</li>
    <li>verificação do correto empenho, liquidação e destinação dos recursos públicos;</li>
    <li>determinação de regularização imediata dos pagamentos;</li>
    <li>apuração de eventual responsabilidade administrativa dos gestores;</li>
    <li>eventual aplicação de sanções administrativas e comunicação ao Ministério Público, se for o caso.</li>
</ol>
Tal providência poderá ser adotada sem prejuízo da utilização concomitante ou posterior das medidas judiciais cabíveis, inclusive com a propositura de ação específica, eventualmente acompanhada de pedido de tutela de urgência, com o objetivo de viabilizar o faturamento, assegurar o recebimento dos valores devidos e resguardar o equilíbrio econômico-financeiro do contrato.<br><br>Ressalta-se que a presente ressalva não possui caráter confrontativo, mas sim preventivo e protetivo, refletindo o dever da empresa de resguardar os direitos de seus colaboradores, assegurar a integridade de seus direitos contratuais e zelar pela regularidade da execução da despesa pública, em estrita observância aos princípios que regem a Administração Pública.<br><br>Diante o exposto, solicitamos:<br>
<ol type="a">
    <li>manifestação expressa e formal deste órgão acerca da pendência;</li>
    <li>informação objetiva quanto à fase atual do processo administrativo/financeiro;</li>
    <li>indicação precisa da data prevista para quitação do débito;</li>
    <li>confirmação de eventual cronograma interno de regularização já estabelecido;</li>
    <li>imediata regularização dos pagamentos em atraso.</li>
</ol>
A empresa permanece, como sempre, aberta ao diálogo institucional e à construção de solução administrativa célere e adequada, pautada na boa-fé, na cooperação e na preservação da relação contratual.<br><br>Todavia, diante da persistência da inadimplência, fica desde já formalmente registrada a reserva de adoção de todas as medidas administrativas e jurídicas cabíveis, inclusive, mas não se limitando a aplicação de encargos moratórios previstos contratualmente, formulação de pedido de recomposição do equilíbrio econômico-financeiro do contrato, intensificação da cobrança administrativa formal.<br><br>Cumpre destacar que a manutenção do atraso impacta diretamente o fluxo financeiro da contratada, podendo comprometer o cumprimento de obrigações operacionais, inclusive aquelas relacionadas ao pagamento de benefícios legais e contratuais dos colaboradores alocados na execução do contrato, uma vez que a empresa não dispõe de recursos próprios para suportar tais encargos de forma contínua sem o devido repasse da contratante.<br><br>Registra-se, por fim, que a presente notificação tem por finalidade preservar o equilíbrio econômico-financeiro do contrato, resguardar direitos da contratada e viabilizar solução administrativa tempestiva, antes da adoção de providências mais gravosas.<br><br>Sem mais para o momento, aguardamos manifestação.$cobauto$,
 '["ass_emp", "cliente", "lista_html", "t_nota", "t_num", "valor_total"]'::jsonb)
ON CONFLICT DO NOTHING;

-- 6) Agendamento: de hora em hora, no minuto 15 (a régua antiga roda no minuto 0). A rotina só age dentro da janela
--    configurada (dias úteis, 8h-17h) e conforme o modo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente - agendamento nao criado (esperado na replica)';
    RETURN;
  END IF;
  BEGIN
    PERFORM cron.unschedule('cobranca-automatica-tick');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM cron.schedule(
    'cobranca-automatica-tick',
    '15 * * * *',
    $cmd$SELECT public.enfileirar_http('cobranca-automatica', jsonb_build_object('tick_at', now()))$cmd$
  );
END $$;

NOTIFY pgrst, 'reload schema';
