import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";

/**
 * De quais SETORES este usuário aprova reembolso.
 *
 * Painel condicional dentro de Administração › Acesso por Usuário, no mesmo
 * molde de `MaloteSetoresUsuario` (SIS-2026-0216) — não é tela de permissão
 * nova, é a de sempre com mais um bloco.
 *
 * A SEMÂNTICA É O INVERSO da do Malote, e isso importa: lá, sem setor marcado
 * a pessoa vê tudo (opt-in, para não regredir o comportamento antigo). Aqui,
 * sem setor marcado ela não aprova nada (opt-out). Reembolso é dinheiro no
 * nome de uma pessoa; "esqueci de configurar" não pode significar "todo mundo
 * aprova".
 *
 * O setor de QUEM PEDE não aparece aqui porque não se escolhe: o banco carimba
 * a partir de `user_setor`, o setor marcado nesta mesma tela, logo acima.
 *
 * A lista vem da RPC `cs_reembolso_setores`, que devolve o catálogo de setores
 * do ERP — os mesmos 13 que Administração › Setores mantém, e os mesmos que
 * `user_setor` grava. Oferecer aqui uma lista diferente da que o carimbo usa
 * faria o admin marcar um setor que nunca casaria com nada, e foi exatamente
 * o que aconteceu até 02/09/2026: a RPC fazia UNION com `EMPREGADOS.Setor_ERP`
 * (o espelho da Senior), então a lista trazia `LICITACAO` junto com
 * `Licitações`, `DIRETOR ADMINISTRATIVO` junto com `Diretor Adm`, mais
 * `PADRAO`, `COMPRAS` e `PRESIDÊNCIA`, que não são setores do ERP. Pior: como
 * o carimbo lia EMPREGADOS primeiro, e lá 547 das 630 pessoas são `PADRAO`,
 * as solicitações nasciam num setor que ninguém aprova e sumiam da fila.
 * Ver a migration 20260930000040.
 */
export function ReembolsoSetoresUsuario({ userId, onToast }: {
  userId: string;
  onToast: (m: string, t?: string) => void;
}) {
  const [setores, setSetores] = useState<Set<string>>(new Set());
  const [catalogo, setCatalogo] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [meus, todos] = await Promise.all([
      (supabase as any).from("CS_REEMBOLSO_APROVADOR_SETOR").select("setor").eq("user_id", userId),
      (supabase as any).rpc("cs_reembolso_setores"),
    ]);
    setSetores(new Set((meus.data ?? []).map((r: any) => r.setor as string)));
    setCatalogo(
      (todos.data ?? [])
        .map((r: any) => (typeof r === "string" ? r : r?.setor))
        .filter((s: any): s is string => typeof s === "string" && s.length > 0),
    );
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const aplicar = async (novaLista: string[]) => {
    const novo = new Set(novaLista);
    const paraAdicionar = novaLista.filter((s) => !setores.has(s));
    const paraRemover = [...setores].filter((s) => !novo.has(s));

    if (paraAdicionar.length) {
      const { error } = await (supabase as any)
        .from("CS_REEMBOLSO_APROVADOR_SETOR")
        .insert(paraAdicionar.map((setor) => ({ user_id: userId, setor })));
      if (error) { onToast("Erro: " + error.message, "err"); return; }
    }
    if (paraRemover.length) {
      const { error } = await (supabase as any)
        .from("CS_REEMBOLSO_APROVADOR_SETOR")
        .delete().eq("user_id", userId).in("setor", paraRemover);
      if (error) { onToast("Erro: " + error.message, "err"); return; }
    }
    setSetores(novo);
  };

  if (loading) return <div className="py-2 text-xs text-muted-foreground">Carregando setores...</div>;

  return (
    <div className="py-1">
      <p className="mb-1.5 text-[11px] text-muted-foreground">
        Setores cujos reembolsos <b>este usuário</b> pode ver, aprovar, reprovar e enviar ao malote.
        O setor de quem pede é o marcado em <b>Setor</b>, aqui em cima, e não é escolhido por ele.{" "}
        <b>Sem nenhum setor marcado, a pessoa não aprova nada</b> — nem vê a fila —, mesmo com o
        menu de Aprovação liberado.
      </p>
      <SearchableMultiSelect
        value={[...setores]}
        onChange={aplicar}
        options={catalogo.map((s) => ({ value: s, label: s }))}
        placeholder="Nenhum setor (não aprova nada)..."
      />
    </div>
  );
}
