import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcompanhamentoTarefas } from "@/components/organograma/AcompanhamentoTarefas";
import { LinhaTarefa } from "@/components/organograma/LinhaTarefa";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMinhasTarefas } from "@/hooks/useTarefasFuncao";
import { separarTarefas, type TarefaItem } from "@/lib/organograma/tarefas";

// =====================================================================
// MINHAS TAREFAS (SIS-2026-0771, mig 20261106001000)
// O checklist de quem está logado: as atividades do POP do cargo dele, vindas
// do organograma. Aberta para todo login: a RPC só devolve as tarefas da própria
// pessoa, e a aba Minha equipe só as de quem está abaixo dela na árvore.
// =====================================================================

export default function MinhasTarefas() {
  const { data, isLoading, error } = useMinhasTarefas();
  const hoje = data?.hoje ?? "";
  const s = useMemo(() => separarTarefas(data?.itens ?? [], hoje), [data, hoje]);

  return (
    <div className="space-y-4">
      <PageHeader title="Minhas Tarefas" breadcrumb={["Minhas Tarefas"]} subtitle="O checklist da sua função: o que vence hoje e o que está atrasado." />
      <Tabs defaultValue="minhas">
        <TabsList>
          <TabsTrigger value="minhas">Minhas tarefas</TabsTrigger>
          <TabsTrigger value="equipe">Minha equipe</TabsTrigger>
        </TabsList>
        <TabsContent value="minhas" className="space-y-4 pt-3">
          {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            : error ? <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>
            : !data?.itens.length ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma tarefa para a sua função por enquanto.</Card>
            ) : (
              <>
                <Grupo titulo="Vencidas" itens={s.vencida} hoje={hoje} cor="text-red-700" />
                <Grupo titulo="A vencer hoje" itens={s.hoje} hoje={hoje} cor="text-amber-700" />
                <Grupo titulo="Próximas" itens={s.proxima} hoje={hoje} />
                <Grupo titulo="Resolvidas nos últimos 30 dias" itens={s.resolvida} hoje={hoje} />
              </>
            )}
        </TabsContent>
        <TabsContent value="equipe" className="pt-3">
          <AcompanhamentoTarefas vazio="Ninguém abaixo de você no organograma tem tarefa neste período." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Grupo({ titulo, itens, hoje, cor }: { titulo: string; itens: TarefaItem[]; hoje: string; cor?: string }) {
  if (!itens.length) return null;
  return (
    <section>
      <h2 className={`mb-2 text-sm font-semibold ${cor ?? ""}`}>{titulo} ({itens.length})</h2>
      <ul className="space-y-2">{itens.map((t) => <LinhaTarefa key={t.id} t={t} hoje={hoje} />)}</ul>
    </section>
  );
}
