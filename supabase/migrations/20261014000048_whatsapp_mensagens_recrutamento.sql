-- =========================================================================
-- SIS-2026-0667 — Mensagens do Recrutamento no WhatsApp do ERP (14/10/2026)
--
-- Chamado da Alessandra (RH): "incluir mensagens automáticas no WhatsApp do
-- bot do ERP" — os textos que o Recrutamento copiava e colava à mão:
-- convite para a vaga, perguntas, checklist de dados, aprovado, Senior,
-- formulário, lembrete do ASO, contratado, treinamento e prorrogação.
--
-- Viram MENSAGENS PRONTAS (WA_TEMPLATE, mig 20260922000001): na Caixa de
-- Entrada a recrutadora digita "/" e escolhe; quando a mensagem tem lacuna
-- (cargo, data de início, banco…) a tela pede o valor antes de enviar.
--   • Dentro das 24h da última mensagem do candidato, saem na hora (texto
--     livre).
--   • Para alcançar quem ainda não escreveu (ex.: o convite), cada uma precisa
--     ser aprovada pela Meta: Chatbot › Mensagens prontas › "Enviar para
--     aprovação". template_nome = código, igual ao que a tela grava.
--
-- O "CHECKLIST ASO" do chamado não é mensagem para o candidato: sai pronto
-- da Ficha do ASO no kanban (botão "Copiar checklist ASO", mesmo commit).
--
-- Textos fiéis ao chamado; só as lacunas viraram variáveis e saiu o lixo de
-- prévia de link que veio colado no TREINAMENTO. A Meta recusa corpo que
-- começa ou termina em variável — nenhum aqui faz isso.
--
-- Só INSERT, idempotente (ON CONFLICT DO NOTHING: quem já editou a mensagem
-- pela tela não perde a edição). Aplicar no banco do app.
-- =========================================================================

INSERT INTO public."WA_TEMPLATE" (codigo, titulo, texto, variaveis, template_nome, categoria, ordem) VALUES
('rec_convite', 'Recrutamento — Convite para a vaga',
$t$Olá! Seja bem-vindo(a) ao Grupo Nascimento!
Temos uma vaga em aberto para o cargo de {{1}}. Você teria interesse em participar do nosso processo seletivo?$t$,
 ARRAY['Cargo'], 'rec_convite', 'UTILITY', 200),

('rec_perguntas', 'Recrutamento — Perguntas',
$t$Para seguirmos com o processo seletivo, responda por favor:

1 - Você utilizará quantos vales-transporte por dia? Qual o valor?
2 - Tem disponibilidade para início imediato? (  ) Sim  (  ) Não
3 - Possui os requisitos obrigatórios para a vaga? (  ) Sim  (  ) Não  (  ) Não se aplica
4 - Possui alguma deficiência? Se enquadra como PCD? (  ) Sim  (  ) Não$t$,
 ARRAY[]::text[], 'rec_perguntas', 'UTILITY', 201),

('rec_checklist_dados', 'Recrutamento — Checklist de dados do colaborador',
$t$CHECKLIST
Para seguirmos com a sua contratação, responda por favor:

NOME COMPLETO DO COLABORADOR:
TELEFONE PESSOAL DO COLABORADOR:
TELEFONE DE UMA PESSOA PRÓXIMA:
E-MAIL DO COLABORADOR:
ESTADO CIVIL:
RAÇA OU COR:
ESCOLARIDADE:
UTILIZA VALE-TRANSPORTE?
SE SIM, QUAL CARTÃO?
QUANTOS POR DIA?
TEM ALGUMA DEFICIÊNCIA? SE SIM, QUAL?
QUAL OPÇÃO DE PIX:
VOCÊ TEM FILHOS MENORES DE 14 ANOS?
VOCÊ POSSUI CNH?
VOCÊ É ESTRANGEIRO?

Grupo Nascimento$t$,
 ARRAY[]::text[], 'rec_checklist_dados', 'UTILITY', 202),

('rec_aprovado', 'Recrutamento — Aprovado',
$t$Parabéns, você foi aprovado(a)!!
É com muita alegria que comunicamos a sua aprovação no nosso processo seletivo!
Estamos extremamente felizes em te receber em nossa equipe e confiamos que sua trajetória conosco será repleta de conquistas e crescimento.
Agora daremos seguimento na sua contratação solicitando os documentos necessários.$t$,
 ARRAY[]::text[], 'rec_aprovado', 'UTILITY', 203),

('rec_senior', 'Recrutamento — Pré-cadastro Senior',
$t$Prezado(a),

Para darmos continuidade ao processo seletivo do Grupo Nascimento, solicitamos a realização do seu pré-cadastro em nosso sistema.

Após o envio das informações solicitadas, você receberá um link para completar seus dados e anexar documentos.

Ficamos à disposição para dúvidas.

Atenciosamente,
Grupo Nascimento$t$,
 ARRAY[]::text[], 'rec_senior', 'UTILITY', 204),

('rec_link_formulario', 'Recrutamento — Link do formulário',
$t$Poderia preencher o formulário por gentileza?
{{1}}

Ficamos à disposição para dúvidas.
Grupo Nascimento$t$,
 ARRAY['Link do formulário'], 'rec_link_formulario', 'UTILITY', 205),

('rec_lembrete_aso', 'Recrutamento — Lembrete do ASO',
$t$LEMBRETE - Passando para lembrar do exame admissional hoje. Após a realização do exame, pedimos que envie uma foto nítida e legível do documento.

Caso não possa comparecer, por favor, nos avise o quanto antes! ☺️$t$,
 ARRAY[]::text[], 'rec_lembrete_aso', 'UTILITY', 206),

('rec_contratado', 'Recrutamento — Contratado',
$t$Seu início será no dia {{1}}, em {{2}}. O encarregado(a) irá entrar em contato com você para te enviar mais informações.
Agradecemos pelo seu compromisso e desejamos muito sucesso nessa nova jornada.

Informamos que o pagamento do salário será realizado pelo banco {{3}}. Para o registro de ponto, deverá ser utilizado o aplicativo Wiipo, onde serão realizados os acompanhamentos e ajustes necessários. O benefício de vale-alimentação será disponibilizado pelo aplicativo Ticket.
APÓS A ASSINATURA DO CONTRATO VOCÊ PODE ACESSAR ESSES APLICATIVOS.

Seja bem-vindo(a)! Estamos à disposição para auxiliar no que precisar.
Atenciosamente,
Grupo Nascimento.$t$,
 ARRAY['Data de início', 'Local / posto', 'Banco do salário'], 'rec_contratado', 'UTILITY', 207),

('rec_treinamento', 'Recrutamento — Treinamentos',
$t$Também é importante você realizar os treinamentos disponibilizados pela nossa empresa, para garantir o certificado.

Basta acessar o link abaixo e fazer o login:
Login: CPF
Senha: CPF

https://appify-my-nascimento.lovable.app/colaborador/treinamentos

Contamos com a sua colaboração e o seu comprometimento.
É fundamental realizar os treinamentos porque eles evitam riscos legais, garantem um ambiente seguro, agradável e justo para todos.

APÓS O INÍCIO DAS SUAS ATIVIDADES VOCÊ CONSEGUIRÁ ACESSAR O TREINAMENTO.$t$,
 ARRAY[]::text[], 'rec_treinamento', 'UTILITY', 208),

('rec_prorrogacao', 'Recrutamento — Prorrogação do contrato',
$t$Prezado(a),
Informamos que a prorrogação do contrato de trabalho, realizada nos termos da Consolidação das Leis do Trabalho (arts. 443 e 451), possui vigência até o dia {{1}}.

Permanecemos à disposição para esclarecimentos.

Atenciosamente,
RECRUTAMENTO E SELEÇÃO
GRUPO NASCIMENTO.$t$,
 ARRAY['Data final da prorrogação'], 'rec_prorrogacao', 'UTILITY', 209)
ON CONFLICT (codigo) DO NOTHING;

-- ROLLBACK
-- DELETE FROM public."WA_TEMPLATE" WHERE codigo IN ('rec_convite', 'rec_perguntas', 'rec_checklist_dados',
--   'rec_aprovado', 'rec_senior', 'rec_link_formulario', 'rec_lembrete_aso', 'rec_contratado',
--   'rec_treinamento', 'rec_prorrogacao');
