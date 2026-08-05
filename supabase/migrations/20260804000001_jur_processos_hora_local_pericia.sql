-- Carga dos 1058 registros de processos (390 processos, uma linha por motivo)
-- exportados do sistema antigo trouxe três campos que a tabela ainda não tinha.
-- São só de leitura/registro: a tela Processos.tsx guarda horário de audiência
-- dentro de audiencias_json, mas o histórico importado tem esses valores soltos
-- e jogá-los fora perderia 149 horários de 1ª audiência e 55 perícias agendadas.
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "primeira_audiencia_hora" text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "local_pericia" text;
ALTER TABLE public."JUR_PROCESSOS" ADD COLUMN IF NOT EXISTS "hora_pericia" text;

NOTIFY pgrst, 'reload schema';
