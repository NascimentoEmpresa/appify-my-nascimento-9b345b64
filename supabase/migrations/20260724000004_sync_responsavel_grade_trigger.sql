-- Trigger que mantém grade.responsavel sincronizado quando o display_name
-- de um usuário é alterado em profiles. Evita registros históricos com
-- nome desatualizado quando o perfil é corrigido.
create or replace function sync_responsavel_grade()
returns trigger language plpgsql as $$
begin
  if old.display_name is distinct from new.display_name then
    update grade
    set responsavel = new.display_name
    where responsavel = old.display_name;
  end if;
  return new;
end;
$$;

create trigger trg_sync_responsavel_grade
after update of display_name on profiles
for each row execute function sync_responsavel_grade();
