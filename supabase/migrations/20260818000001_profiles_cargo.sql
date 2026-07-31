-- Adiciona profiles.cargo (título de função — RH), independente de setor e de
-- EMPREGADOS."Título do Cargo" (que só existe pra quem está vinculado à Senior).
-- Backfill com os dados curados manualmente pelo usuário em profiles_rows.xlsx.
--
-- ROLLBACK:
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS cargo;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cargo text;

-- O SQL Editor roda sem sessão de auth (auth.uid() IS NULL) e não bate no
-- allowlist de role de a_trg_profiles_block_self_escalation, então qualquer
-- UPDATE em profiles por aqui explode com "sessão ausente". É só um backfill
-- administrativo único — desliga o trigger, atualiza, religa.
ALTER TABLE public.profiles DISABLE TRIGGER a_trg_profiles_block_self_escalation;

UPDATE public.profiles AS p
SET cargo = v.cargo
FROM (VALUES
  ('03323fbd-a05d-47c4-8ea9-0547acd5874d', 'ASSISTENTE FINANCEIRO III'),
  ('07ccb022-18f0-45bc-9c79-12702620ac5c', 'ASSISTENTE DE DEP PESSOAL I'),
  ('0cc9cfd8-9427-420f-95aa-7b2491d797b0', 'APRENDIZ'),
  ('0cdde072-4fcf-4939-a11b-c0ff766bb4f0', 'ASSISTENTE DE DEP PESSOAL I'),
  ('1116752d-09b2-49c1-951d-753b72c70276', 'GERENTE LICITACAO'),
  ('195a4db7-8027-43a5-93dc-e77870d4ba2e', 'ANALISTA DESENV. DE SISTEMAS I'),
  ('205bcc4d-326e-4208-8217-98b2c1a7d6e3', 'SUPERVISOR DE DEP PESSOAL'),
  ('24441177-a9e2-4f0e-b2ae-7d4fabe37044', 'DIRETORA ADMINISTRATIVA'),
  ('256ae1ab-993f-49c9-ac30-b097ce0bd0bc', 'SUPERVISOR DE LICITAÇÃO'),
  ('2833d563-9f09-436b-961a-bf092f88ea30', 'SUPERVISOR OPERACIONAL'),
  ('2bfeeeec-c68c-4d2b-a639-86705e590a95', 'AUXILIAR ADMINISTRATIVO'),
  ('2d49fd95-6d74-4b97-98a8-4ecaf969bd99', 'GERENTE DE SUPLY'),
  ('301bfa45-d01a-4e81-abd9-18d48bccef97', 'ANALISTA DESENV. DE SISTEMAS I'),
  ('38332698-2886-4b48-9d95-0d98fc044c09', 'ANALISTA DE CONTRATO'),
  ('392cd6af-41c7-4730-a100-69bdd81b5d96', 'ADVOGADA'),
  ('3baeb855-5389-4459-93f4-759ee82b288e', 'GERENTE CONTROLADORIA'),
  ('3dff844b-df2a-4c77-8ab2-5a6da335a4c6', 'ANALISTA FINANCEIRO II'),
  ('55e3072e-091a-4bd3-bb95-719cb0ee7090', 'SUPERVISOR OPERACIONAL'),
  ('58a3a940-b45c-4755-8c4e-57da105a25d1', 'APRENDIZ'),
  ('60e5bb0a-c0ae-4434-950f-9fdaecb01ea7', 'PRESIDENTE'),
  ('6a8ac11c-a1e5-49ab-8de9-6a9c7dc03a98', 'DIRETOR OPERACIONAL'),
  ('762ab7d5-d787-41af-b058-3021c311e11e', 'ASSISTENTE LICITACAO I'),
  ('7a07dbbb-e0a9-48ac-82a4-e6d43e0bac4c', 'SUPERVISOR COMPRAS'),
  ('7cffae0b-2cfe-4e9f-8876-dde9b3c07e50', 'GERENTE OPERACIONAL'),
  ('8602a7e5-efe9-40ca-a967-6454e473871f', 'SUPERVISOR(A) ALMOXARIFE'),
  ('87e620ce-c9b0-4390-9fd7-d6480c79c85d', 'ENCARREGADA'),
  ('8a03a976-1287-453e-9c86-d78163ac2e2e', 'GERENTE FINANCEIRO'),
  ('8f426a53-fdbb-49f2-ad43-d39532539f2d', 'SUPERVISOR FINANCEIRO'),
  ('90b97215-bed4-46a5-9ac3-bcd63125eadf', 'AUXILIAR ADMINISTRATIVO'),
  ('9645ba19-e658-43ce-a6d2-d98915f23536', 'ANALISTA DE DEP. PESSOAL II'),
  ('97260632-2f1a-44e3-9f93-58b2b1f3702c', 'ANALISTA DESENV. DE SISTEMAS I'),
  ('99deb4d7-daa2-4af0-9762-965443620a65', 'SUPERVISOR OPERACIONAL'),
  ('9abd3eb8-843d-4fba-886b-4d23793dc567', 'ASSISTENTE SST'),
  ('a07679bb-7c84-4572-af67-09758a981fd1', 'AUXILIAR ADMINISTRATIVO'),
  ('a240e3b5-3cda-4913-bebb-edcfa1035c7a', 'GERENTE DE RH'),
  ('ab761a12-197b-403b-809f-0f53a36a16e2', 'SUPERVISOR CONTROLADORIA'),
  ('abe98d82-e963-44e9-95ad-5f733a0e58b2', 'AUXILIAR ADMINISTRATIVO'),
  ('ac44b6e8-58fd-46ca-b9e1-d8f0cb666942', 'GERENTE DE NOVOS NEGÓCIOS'),
  ('ae8326a7-652a-4275-91cf-6a0102dd4d19', 'ANALISTA DE CONTRATO'),
  ('ba897b8a-f236-4329-80f1-1dad02582ac4', 'ANALISTA DE LICITAÇÃO'),
  ('bb79bee4-acf3-4fa5-9940-0b2c19d1f9d2', 'ASSISTENTE JURIDICO I'),
  ('c7ce1cea-81f6-4453-bf35-90de176be668', 'ASSISTENTE DE COMPRAS II'),
  ('cb0a7a80-84f6-4707-a3be-90c2380736b4', 'GERENTE DE TREINAMENTOS'),
  ('ce85e067-2b86-4d80-b2cd-c546ccaaa5cf', 'SUPERVISOR OPERACIONAL'),
  ('d06c8078-e7b6-4728-bf20-f8be477941a2', 'TECNICO EM SEGURANCA DO TRABAL'),
  ('d1dbc8d4-bf9b-4125-a6b1-11b6195155a4', 'GERENTE SET.SISTEMAS'),
  ('d328f694-101b-42da-a81f-143e73b0ca94', 'ANALISTA JURIDICO II'),
  ('e2c4faf6-289e-4f80-a235-628c2d674f46', 'ANALISTA DESENV. DE SISTEMAS I'),
  ('e6d533b1-c81b-4c1e-9f27-6b716d1294fe', NULL),
  ('eeb3ce16-f0f3-4bba-85ee-41ce0b43d299', 'ENFERMEIRA DO TRABALHO'),
  ('f0bd3e31-1da0-48a8-b9c3-1ca4e2b4f030', 'AUXILIAR ADMINISTRATIVO'),
  ('ff35bbfd-1aca-410a-893d-8ae381f8817e', 'APRENDIZ')
) AS v(id, cargo)
WHERE p.id = v.id::uuid;

ALTER TABLE public.profiles ENABLE TRIGGER a_trg_profiles_block_self_escalation;
