-- =========================================================================
-- Treinamentos: os 14 cursos do membox cadastrados no ERP (sem capa/vídeo)
--
-- Pedido do Pablo em 22/09/2026: "adiciona esses cursos no sistema, só sem
-- foto, deixa pro setor de treinamentos colocar os vídeos e fotos depois".
-- Nome e descrição copiados da vitrine do membox (a descrição lá vem cortada
-- em "...." — onde o corte caiu no meio da frase, a frase foi fechada; o
-- setor revisa no Editar curso).
--
--   • Entram como RASCUNHO (publicado = false): sem aula, um curso
--     publicado apareceria vazio pro colaborador no Portal (acesso completo
--     libera todo curso publicado). O setor publica quando subir o vídeo.
--   • Certificado padrão já vinculado; capa, categoria e carga horária vazias.
--   • ON CONFLICT (slug) DO NOTHING: reaplicar não duplica nem sobrescreve o
--     que o setor já tiver editado.
--
-- Idempotente. Aplicar no banco do app.
-- =========================================================================

INSERT INTO public."TRN_CURSO"(nome, slug, descricao, publicado, certificado_modelo_id, ordem_vitrine)
SELECT v.nome, v.slug, v.descricao, false,
       (SELECT id FROM public."TRN_CERTIFICADO_MODELO" WHERE nome = 'Certificado padrão' LIMIT 1),
       v.ordem
  FROM (VALUES
    (1,  'Questionário', 'questionario',
         'Neste vídeo, apresentamos um questionário para ouvir a opinião dos colaboradores e identificar oportunidades de melhoria. Sua participação é essencial para construirmos um ambiente cada vez melhor.'),
    (2,  'NR-23', 'nr-23',
         'NR-23 – Proteção Contra Incêndios: estabelece medidas de prevenção e combate a incêndios, garantindo segurança, equipamentos adequados, sinalização e procedimentos de emergência no ambiente de trabalho.'),
    (3,  'Higienização de Ambientes', 'higienizacao-de-ambientes',
         'Treinamento sobre técnicas e procedimentos adequados para a higienização de ambientes, incluindo o uso correto de produtos, equipamentos e EPIs, a fim de garantir a limpeza, a segurança e a prevenção de contaminações.'),
    (4,  'NR-24', 'nr-24',
         'Treinamento sobre os requisitos da NR-24, abordando higiene, organização, instalações sanitárias, conforto e boas práticas para garantir um ambiente de trabalho seguro, saudável e adequado aos colaboradores.'),
    (5,  'NR-31', 'nr-31',
         'Treinamento sobre os principais requisitos da NR-31, abordando os riscos das atividades rurais, medidas de prevenção, uso correto de EPIs, segurança no manuseio de máquinas, ferramentas e produtos, visando a proteção dos trabalhadores.'),
    (6,  'NR-12', 'nr-12',
         'Treinamento sobre os principais requisitos da NR-12, abordando os riscos relacionados a máquinas e equipamentos, medidas de prevenção, dispositivos de segurança, procedimentos corretos de utilização e práticas seguras para evitar acidentes.'),
    (7,  'NR-1', 'nr-1',
         'Treinamento sobre os principais requisitos da NR-01, abordando responsabilidades, direitos e deveres, identificação de riscos ocupacionais, medidas de prevenção e a importância do gerenciamento de riscos para garantir um ambiente de trabalho seguro.'),
    (8,  'NR-26', 'nr-26',
         'Treinamento sobre a NR-26, abordando a identificação de riscos, o uso correto das cores de segurança, sinalização de ambientes e produtos químicos, visando a prevenção de acidentes e a segurança dos trabalhadores.'),
    (9,  'NR-15', 'nr-15',
         'Treinamento sobre a NR-15, com orientações sobre atividades insalubres, principais riscos ocupacionais, medidas de prevenção e uso correto de EPIs.'),
    (10, 'NR-17', 'nr-17',
         'Capacitação sobre os princípios da ergonomia aplicados às atividades laborais, abordando postura adequada, organização do trabalho, prevenção de riscos ergonômicos e atendimento aos requisitos da NR-17.'),
    (11, 'NR-6', 'nr-6',
         'Este curso tem como objetivo orientar os colaboradores sobre a importância da utilização correta dos Equipamentos de Proteção Individual — EPIs na prevenção de acidentes e doenças relacionadas ao trabalho.'),
    (12, 'Uso de Adornos no Ambiente de Trabalho', 'uso-de-adornos-no-ambiente-de-trabalho',
         'Curso destinado a orientar os colaboradores sobre os riscos do uso de adornos no ambiente de trabalho, como anéis, pulseiras, relógios, brincos, colares e acessórios semelhantes. O objetivo é reforçar a importância da segurança, higiene e prevenção.'),
    (13, 'Integração de funcionários', 'integracao-de-funcionarios',
         'Este treinamento tem como objetivo apresentar aos colaboradores as principais orientações sobre o Grupo Nascimento.'),
    (14, 'Ética e Integridade', 'etica-e-integridade',
         'O Treinamento em Ética e Integridade foi desenvolvido para reforçar os valores do Grupo Nascimento e promover uma cultura organizacional baseada em respeito, transparência e responsabilidade. De forma clara e objetiva, o curso orienta os colaboradores.')
  ) AS v(ordem, nome, slug, descricao)
ON CONFLICT (slug) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (só se nada foi feito nos cursos ainda — apaga módulos/aulas/matrículas em cascata)
-- DELETE FROM public."TRN_CURSO" WHERE slug IN ('questionario','nr-23','higienizacao-de-ambientes','nr-24','nr-31','nr-12','nr-1',
--   'nr-26','nr-15','nr-17','nr-6','uso-de-adornos-no-ambiente-de-trabalho','integracao-de-funcionarios','etica-e-integridade');
