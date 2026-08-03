-- =====================================================================
-- WHATSAPP — anexos ENVIADOS pelo atendente (print colado, arquivo)
--
-- O bucket whatsapp-midia só tinha policy de SELECT ("wa midia select"):
-- servia pra mostrar a mídia RECEBIDA, que quem grava é o webhook com
-- service_role. Para o atendente enviar, o navegador precisa escrever no
-- bucket — daí a policy de INSERT.
--
-- Por que o navegador sobe direto em vez de mandar o arquivo pra edge
-- function: base64 dentro do JSON incha ~33% e estoura o limite de corpo da
-- requisição num print grande. O front sobe pro storage, manda só o caminho,
-- e a function (service_role) baixa e repassa pra Graph API.
--
-- Mesma regra da leitura: quem tem o menu 'whatsapp' pode escrever. O caminho
-- é sempre 'saida/<conversa_id>/...', separado da mídia recebida.
--
-- Idempotente.
-- ROLLBACK: DROP POLICY IF EXISTS "wa midia insert" ON storage.objects;
-- =====================================================================

DROP POLICY IF EXISTS "wa midia insert" ON storage.objects;
CREATE POLICY "wa midia insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'whatsapp-midia'
    AND public.tem_acesso_menu('whatsapp')
    AND (storage.foldername(name))[1] = 'saida'
  );

NOTIFY pgrst, 'reload schema';
