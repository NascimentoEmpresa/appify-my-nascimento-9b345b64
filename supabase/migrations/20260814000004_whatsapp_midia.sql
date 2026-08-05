-- WhatsApp — recebimento de arquivos (documento/imagem/áudio/vídeo/sticker).
-- Bucket privado onde o webhook salva as mídias baixadas da Cloud API. Só quem
-- tem acesso ao WhatsApp (menu 'whatsapp') consegue ler; a escrita é feita pelo
-- webhook com service_role (bypassa RLS).
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-midia', 'whatsapp-midia', false, 104857600)  -- 100 MB
on conflict (id) do nothing;

drop policy if exists "wa midia select" on storage.objects;
create policy "wa midia select" on storage.objects
  for select to authenticated
  using (bucket_id = 'whatsapp-midia' and public.tem_acesso_menu('whatsapp'));

notify pgrst, 'reload schema';
