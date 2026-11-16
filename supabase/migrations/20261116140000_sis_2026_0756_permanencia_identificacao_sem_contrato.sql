-- =========================================================================
-- SIS-2026-0756 — PESQUISA DE PERMANÊNCIA: IDENTIFICAÇÃO SEM CONTRATO
-- (16/11/2026)
--
-- Helena Nascimento (RH), no chat do chamado em 09/11: "em vez de pedir o
-- nome da cidade ou do contrato, apresente estas opções" — Região de Atuação
-- (8 regiões), área em que trabalha (4 grupos, com exemplos), gênero e faixa
-- etária. Reaberto em 16/11 por Iury: "Pergunta do contrato ainda está lá".
--
-- O QUE MUDA (só no formulário 6990cfd5-…, slug pesquisa-permanencia)
--   1. Sai a pergunta "Onde você trabalha" (tipo local_trabalho: contrato ›
--      posto › função). Ela era o único dado que apontava o lugar exato da
--      pessoa; a região é bem mais larga — melhor para o anonimato também.
--   2. Entram, no começo, 4 perguntas "escolha_complemento" de resposta
--      única, com código por alternativa (config.codigo regiao/area/genero/
--      faixa) — o dashboard lê o código, não o texto, como nas p1..p8.
--      O JSON é perguntasIdentificacao() de supabase/functions/_shared/
--      pesquisa-permanencia.ts (o teste confere). A trava da resposta
--      (cs_form_resposta_tipos, mig 20261030001000) já valida este tipo.
--   3. As 8 perguntas do documento ficam como estão (inclusive se alguém as
--      editou no Formulários — só a lista é remontada).
--
-- RESPOSTAS JÁ RECEBIDAS: nada é apagado nem reescrito. As antigas continuam
-- com o contrato gravado (CS_FORM_RESPOSTAS.itens, no id da pergunta que
-- saiu) e aparecem nos cruzamentos como "Não informado"; os relatórios por
-- contrato/posto/função seguem valendo para elas. O formulário continua
-- sempre_anonimo.
--
-- Idempotente: só mexe se ainda houver local_trabalho ou faltar alguma das
-- 4 perguntas; pergunta que já existe (pelo id) não é duplicada.
-- =========================================================================

-- form-identificacao-inicio
UPDATE public."CS_FORMULARIOS" f
   SET perguntas = (
     SELECT COALESCE(jsonb_agg(t.e ORDER BY t.ord), '[]'::jsonb)
       FROM (
         SELECT n.e, n.ord
           FROM jsonb_array_elements('[{"id":"ac6ebbe3-1ad0-44e6-91f2-0b686bb8fa5c","tipo":"escolha_complemento","titulo":"Região de Atuação","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["RS - Região Metropolitana e Litoral (Porto Alegre, Canoas, Gravataí, Osório, Xangri-lá, etc.)","RS - Serra Gaúcha (Caxias do Sul, Bento Gonçalves, Gramado, Vacaria, etc.)","RS - Norte e Noroeste (Passo Fundo, Erechim, Ijuí, Santa Rosa, Carazinho, etc.)","RS - Centro e Vales (Santa Maria, Santa Cruz do Sul, Lajeado, Cachoeira do Sul, etc.)","RS - Sul e Campanha (Pelotas, Rio Grande, Bagé, Santana do Livramento, etc.)","RS - Fronteira Oeste e Missões (Uruguaiana, São Borja, Alegrete, Santo Ângelo, etc.)","Santa Catarina (SC) - Todas as regiões","Paraná (PR) - Todas as regiões"],"config":{"codigo":"regiao","max":1,"itens":[{"cod":"rs_metropolitana","rotulo":"RS - Região Metropolitana e Litoral (Porto Alegre, Canoas, Gravataí, Osório, Xangri-lá, etc.)"},{"cod":"rs_serra","rotulo":"RS - Serra Gaúcha (Caxias do Sul, Bento Gonçalves, Gramado, Vacaria, etc.)"},{"cod":"rs_norte","rotulo":"RS - Norte e Noroeste (Passo Fundo, Erechim, Ijuí, Santa Rosa, Carazinho, etc.)"},{"cod":"rs_centro","rotulo":"RS - Centro e Vales (Santa Maria, Santa Cruz do Sul, Lajeado, Cachoeira do Sul, etc.)"},{"cod":"rs_sul","rotulo":"RS - Sul e Campanha (Pelotas, Rio Grande, Bagé, Santana do Livramento, etc.)"},{"cod":"rs_fronteira","rotulo":"RS - Fronteira Oeste e Missões (Uruguaiana, São Borja, Alegrete, Santo Ângelo, etc.)"},{"cod":"sc","rotulo":"Santa Catarina (SC) - Todas as regiões"},{"cod":"pr","rotulo":"Paraná (PR) - Todas as regiões"}]}},{"id":"6d506331-d677-47fd-a31a-ea3e3406b541","tipo":"escolha_complemento","titulo":"Em qual área você trabalha atualmente?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Operacional","Operacional Técnico / Especialista","Administrativo e Comercial","Liderança e Supervisão de Campo"],"config":{"codigo":"area","max":1,"itens":[{"cod":"operacional","rotulo":"Operacional","descricao":"Exemplos: auxiliares gerais, portaria, limpeza, recepção, vigilância, ajudantes e funções de suporte inicial."},{"cod":"tecnico","rotulo":"Operacional Técnico / Especialista","descricao":"Exemplos: eletricistas, mecânicos, encanadores, motoristas, operadores de máquinas, técnicos de TI e funções que exigem certificação técnica ou curso profissionalizante."},{"cod":"administrativo","rotulo":"Administrativo e Comercial","descricao":"Exemplos: assistentes, analistas, faturamento, compras, recursos humanos, setor financeiro e atendimento de escritório."},{"cod":"lideranca","rotulo":"Liderança e Supervisão de Campo","descricao":"Exemplos: encarregados de contrato, supervisores regionais, coordenadores e líderes de equipe que atuam direto na ponta ou viajando pelos contratos."}]}},{"id":"311ec60f-c5bb-4b26-9026-2cc9aa88aa7c","tipo":"escolha_complemento","titulo":"Qual é o seu gênero?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Feminino","Masculino","Prefiro não responder / Outro"],"config":{"codigo":"genero","max":1,"itens":[{"cod":"feminino","rotulo":"Feminino"},{"cod":"masculino","rotulo":"Masculino"},{"cod":"nao_informar","rotulo":"Prefiro não responder / Outro"}]}},{"id":"f47fc316-212e-4d0b-bdc5-648f6d494ad2","tipo":"escolha_complemento","titulo":"Em qual faixa etária você se encontra?","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":["Até 25 anos","De 26 a 40 anos","Mais de 40 anos"],"config":{"codigo":"faixa","max":1,"itens":[{"cod":"ate_25","rotulo":"Até 25 anos"},{"cod":"26_40","rotulo":"De 26 a 40 anos"},{"cod":"mais_40","rotulo":"Mais de 40 anos"}]}}]'::jsonb) WITH ORDINALITY AS n(e, ord)
          WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(f.perguntas, '[]'::jsonb)) x
                             WHERE x ->> 'id' = n.e ->> 'id')
         UNION ALL
         SELECT x.e, 1000 + x.ord
           FROM jsonb_array_elements(COALESCE(f.perguntas, '[]'::jsonb)) WITH ORDINALITY AS x(e, ord)
          WHERE x.e ->> 'tipo' IS DISTINCT FROM 'local_trabalho'
       ) t)
 WHERE f.id = '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb'::uuid
   AND (EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(f.perguntas, '[]'::jsonb)) x WHERE x ->> 'tipo' = 'local_trabalho')
        OR (SELECT count(*) FROM jsonb_array_elements(COALESCE(f.perguntas, '[]'::jsonb)) x
             WHERE x ->> 'id' IN ('ac6ebbe3-1ad0-44e6-91f2-0b686bb8fa5c', '6d506331-d677-47fd-a31a-ea3e3406b541',
                                  '311ec60f-c5bb-4b26-9026-2cc9aa88aa7c', 'f47fc316-212e-4d0b-bdc5-648f6d494ad2')) < 4);
-- form-identificacao-fim

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (volta a pergunta do contrato no começo e tira as 4; respostas intocadas)
-- UPDATE public."CS_FORMULARIOS" f
--    SET perguntas = '[{"id":"65c6c19d-a958-47fb-8b66-1b07bd7a58dc","tipo":"local_trabalho","titulo":"Onde você trabalha","descricao":null,"obrigatoria":true,"imagem_url":null,"opcoes":[],"config":{}}]'::jsonb
--        || COALESCE((SELECT jsonb_agg(x.e ORDER BY x.ord) FROM jsonb_array_elements(f.perguntas) WITH ORDINALITY AS x(e, ord)
--                      WHERE x.e ->> 'id' NOT IN ('ac6ebbe3-1ad0-44e6-91f2-0b686bb8fa5c', '6d506331-d677-47fd-a31a-ea3e3406b541',
--                                                 '311ec60f-c5bb-4b26-9026-2cc9aa88aa7c', 'f47fc316-212e-4d0b-bdc5-648f6d494ad2')), '[]'::jsonb)
--  WHERE f.id = '6990cfd5-d0b1-4c59-bcde-48d0f88e70cb'::uuid;
-- NOTIFY pgrst, 'reload schema';
