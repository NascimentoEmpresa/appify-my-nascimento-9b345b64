import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinhaTarefa } from "@/components/organograma/LinhaTarefa";
import { useAcompanhamentoTarefas } from "@/hooks/useTarefasFuncao";
import { resumirPorPessoa, type ResumoPessoa } from "@/lib/organograma/tarefas";

const mesAtual = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return { ini: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`, fim: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())}` };
};

/** Quem está em dia, por pessoa. O banco decide quem aparece: com o menu, todos; líder, a própria equipe. */
export function AcompanhamentoTarefas({ podeResolver = false, vazio }: { podeResolver?: boolean; vazio: string }) {
  const [periodo, setPeriodo] = useState(mesAtual);
  const [busca, setBusca] = useState("");
  const [soAtraso, setSoAtraso] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const { data, isLoading, error } = useAcompanhamentoTarefas(periodo.ini, periodo.fim);
  const hoje = data?.hoje ?? "";
  const pessoas = useMemo(() => resumirPorPessoa(data?.itens ?? [], hoje), [data, hoje]);
  const visiveis = pessoas
    .filter((p) => !soAtraso || p.vencidas > 0)
    .filter((p) => p.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  const soma = (k: "vencidas" | "hoje" | "concluidas") => pessoas.reduce((n, p) => n + p[k], 0);

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Numero titulo="Pessoas" valor={pessoas.length} />
        <Numero titulo="Vencidas" valor={soma("vencidas")} destaque={soma("vencidas") > 0} />
        <Numero titulo="Vencem hoje" valor={soma("hoje")} />
        <Numero titulo="Concluídas no período" valor={soma("concluidas")} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="ac-ini" className="text-xs">De</Label><Input id="ac-ini" type="date" className="w-40" value={periodo.ini} onChange={(e) => setPeriodo((p) => ({ ...p, ini: e.target.value }))} /></div>
        <div><Label htmlFor="ac-fim" className="text-xs">Até</Label><Input id="ac-fim" type="date" className="w-40" value={periodo.fim} onChange={(e) => setPeriodo((p) => ({ ...p, fim: e.target.value }))} /></div>
        <div className="min-w-48 flex-1"><Label htmlFor="ac-busca" className="text-xs">Pessoa</Label><Input id="ac-busca" placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <Button variant={soAtraso ? "default" : "outline"} aria-pressed={soAtraso} onClick={() => setSoAtraso((s) => !s)}>Só com vencidas</Button>
      </div>
      {visiveis.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{pessoas.length ? "Ninguém neste filtro." : vazio}</p> : (
        <ul className="space-y-2">
          {visiveis.map((p) => <LinhaPessoa key={p.chave} p={p} hoje={hoje} aberta={aberta === p.chave} podeResolver={podeResolver} alternar={() => setAberta(aberta === p.chave ? null : p.chave)} />)}
        </ul>
      )}
    </div>
  );
}

function LinhaPessoa({ p, hoje, aberta, alternar, podeResolver }: { p: ResumoPessoa; hoje: string; aberta: boolean; alternar: () => void; podeResolver: boolean }) {
  return (
    <li className="rounded-md border">
      <button type="button" aria-expanded={aberta} onClick={alternar} className="flex w-full flex-wrap items-center gap-2 p-3 text-left hover:bg-muted/50">
        {aberta ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-40 flex-1 font-medium">{p.nome}</span>
        {p.vencidas > 0 && <Badge className="bg-red-600">{p.vencidas} vencida(s)</Badge>}
        {p.hoje > 0 && <Badge className="bg-amber-500 text-amber-950">{p.hoje} hoje</Badge>}
        <span className="text-xs text-muted-foreground">{p.concluidas} concluída(s){p.noPrazo !== null ? ` · ${p.noPrazo}% no prazo` : ""}</span>
      </button>
      {aberta && (
        <ul className="space-y-2 border-t p-3">
          {p.itens.map((t) => <LinhaTarefa key={t.id} t={t} hoje={hoje} podeResolver={podeResolver} />)}
        </ul>
      )}
    </li>
  );
}

const Numero = ({ titulo, valor, destaque }: { titulo: string; valor: number; destaque?: boolean }) => (
  <Card className={destaque ? "border-red-300 bg-red-50 p-3" : "p-3"}>
    <span className="block text-2xl font-bold">{valor}</span>
    <span className="text-xs text-muted-foreground">{titulo}</span>
  </Card>
);
