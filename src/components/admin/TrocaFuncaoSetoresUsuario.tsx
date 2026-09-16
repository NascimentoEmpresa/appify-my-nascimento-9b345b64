import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";

// O client tipado não conhece as tabelas novas — cast num lugar só.
const sb = supabase as unknown as {
  from(tabela: string): {
    select(colunas: string): {
      eq(coluna: string, valor: string): Promise<{ data: { setor: string }[] | null; error: unknown }>;
      order(coluna: string): Promise<{ data: { nome: string }[] | null; error: unknown }>;
    };
    insert(linhas: { user_id: string; setor: string }[]): Promise<{ error: { message: string } | null }>;
    delete(): { eq(coluna: string, valor: string): { in(coluna: string, valores: string[]): Promise<{ error: { message: string } | null }> } };
  };
};

/**
 * De quais SETORES este usuário aprova na DIRETORIA (16/09/2026): mudança
 * de função, demissão e vaga do escritório / com setor — a mesma
 * configuração vale pros três fluxos.
 *
 * Painel condicional dentro de Administração › Acesso por Usuário, ao lado
 * dos menus de aprovação da Diretoria e da Mudança de Função — mesmo molde
 * do `ReembolsoSetoresUsuario`. Uma configuração só por pessoa.
 *
 * É um FILTRO, não um gate: sem setor marcado a pessoa vê e decide todas as
 * administrativas; com algum marcado, só as daqueles setores. O banco
 * repete a régua em aprova_setor() (mig 128).
 *
 * Opt-out, como no Reembolso: sem setor marcado, a pessoa não aprova nenhuma
 * solicitação que tenha setor — mesmo com o menu de aprovação liberado. O
 * banco garante isso no trigger trg_stf_guard_aprovador_setor (migration
 * 20260930000125); a tela só reflete. Solicitação de contrato SEM setor (o
 * campo é opcional lá) continua governada só pelo menu.
 *
 * A lista é o catálogo de setores do ERP (setor_catalogo) — o mesmo que o
 * encarregado escolhe ao pedir a troca. Oferecer outra lista faria o admin
 * marcar um setor que nunca casaria.
 */
export const TABELA_APROVADOR_SETOR = "SISTEMA_APROVADOR_SETOR";
/** Nome antigo (mig 125) — a tabela foi renomeada na 127; fica pra quem ainda importa. */
export const TABELA_STF_APROVADOR_SETOR = TABELA_APROVADOR_SETOR;

export function TrocaFuncaoSetoresUsuario({ userId, onToast }: {
  userId: string;
  onToast: (m: string, t?: string) => void;
}) {
  const [setores, setSetores] = useState<Set<string>>(new Set());
  const [catalogo, setCatalogo] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [meus, todos] = await Promise.all([
      sb.from(TABELA_STF_APROVADOR_SETOR).select("setor").eq("user_id", userId),
      sb.from("setor_catalogo").select("nome").order("nome"),
    ]);
    setSetores(new Set((meus.data ?? []).map((r) => r.setor)));
    setCatalogo((todos.data ?? []).map((r) => r.nome).filter(Boolean));
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const aplicar = async (novaLista: string[]) => {
    const novo = new Set(novaLista);
    const paraAdicionar = novaLista.filter((s) => !setores.has(s));
    const paraRemover = [...setores].filter((s) => !novo.has(s));

    if (paraAdicionar.length) {
      const { error } = await sb
        .from(TABELA_STF_APROVADOR_SETOR)
        .insert(paraAdicionar.map((setor) => ({ user_id: userId, setor })));
      if (error) { onToast("Erro: " + error.message, "err"); return; }
    }
    if (paraRemover.length) {
      const { error } = await sb
        .from(TABELA_STF_APROVADOR_SETOR)
        .delete().eq("user_id", userId).in("setor", paraRemover);
      if (error) { onToast("Erro: " + error.message, "err"); return; }
    }
    setSetores(novo);
  };

  if (loading) return <div className="py-2 text-xs text-muted-foreground">Carregando setores...</div>;

  return (
    <div className="py-1">
      <p className="mb-1.5 text-[11px] text-muted-foreground">
        Setores que <b>este usuário</b> trata na Diretoria — mudança de função, demissão e vaga do
        escritório / com setor. É um <b>filtro</b>: sem nenhum setor marcado, a pessoa vê e decide todas;
        com algum marcado, só as daqueles setores. Uma configuração só, que vale pros três fluxos.
      </p>
      <SearchableMultiSelect
        value={[...setores]}
        onChange={aplicar}
        options={catalogo.map((s) => ({ value: s, label: s }))}
        placeholder="Todos os setores (sem filtro)..."
      />
    </div>
  );
}
