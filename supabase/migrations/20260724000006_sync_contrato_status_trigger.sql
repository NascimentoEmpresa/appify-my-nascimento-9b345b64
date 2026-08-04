-- Mantém public.contratos.status sincronizado com o encerramento na planilha_custo.
-- Quando todas as linhas de um contrato_id são encerradas → status = 'encerrado'.
-- Quando uma linha é reativada → status volta para 'ativo'.

create or replace function sync_contrato_encerrado()
returns trigger language plpgsql as $$
begin
  if new.encerrado = true and (old.encerrado is distinct from true) then
    if new.contrato_id is not null then
      if not exists (
        select 1 from public.planilha_custo
        where contrato_id = new.contrato_id
          and (encerrado is null or encerrado = false)
      ) then
        update public.contratos
        set status = 'encerrado', updated_at = now()
        where id = new.contrato_id
          and status != 'encerrado';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_sync_contrato_encerrado
after update of encerrado on public.planilha_custo
for each row execute function sync_contrato_encerrado();

create or replace function sync_contrato_reativado()
returns trigger language plpgsql as $$
begin
  if new.encerrado = false and old.encerrado = true then
    if new.contrato_id is not null then
      update public.contratos
      set status = 'ativo', updated_at = now()
      where id = new.contrato_id
        and status = 'encerrado';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_sync_contrato_reativado
after update of encerrado on public.planilha_custo
for each row execute function sync_contrato_reativado();
