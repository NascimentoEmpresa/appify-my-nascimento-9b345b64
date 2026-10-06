import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useCtrlExcluirReuniao, useCtrlRegistros, useCtrlReunioes, useCtrlTextoReuniao, type Reuniao } from "@/hooks/useReunioesEncarregados";
import { MENU_REUNIOES, dataBR, semCodigo } from "./comum";

// Reuniões com Encarregados › Reuniões importadas (mig 20261006000005):
// contagens por reunião, o texto original e exclusão (leva os registros junto).

export default function ListaReunioes({ irPara }: { irPara: (aba: string, extra?: Record<string, string>) => void }) {
  const { data: reunioes = [], isLoading } = useCtrlReunioes();
  const { data: registros = [] } = useCtrlRegistros();
  const excluir = useCtrlExcluirReuniao();
  const [aberta, setAberta] = useState<Reuniao | null>(null);
  const texto = useCtrlTextoReuniao(aberta?.id ?? null);

  const conta = useMemo(() => {
    const m = new Map<string, { total: number; pend: number; dif: number; duv: number }>();
    for (const r of registros) {
      const c = m.get(r.reuniao_id) ?? { total: 0, pend: 0, dif: 0, duv: 0 };
      if (r.status !== "excluido") { c.total++; r.tipo === "dificuldade" ? c.dif++ : c.duv++; }
      if (r.status === "pendente") c.pend++;
      m.set(r.reuniao_id, c);
    }
    return m;
  }, [registros]);
  const lista = [...reunioes].sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? "") || b.created_at.localeCompare(a.created_at));

  if (isLoading) return <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card>;
  if (!lista.length) return <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma reunião importada ainda.</Card>;

  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Data</th><th className="px-3 py-2 font-medium">Reunião</th><th className="px-3 py-2 font-medium">Supervisor / equipe</th>
              <th className="px-3 py-2 text-right font-medium">Participantes</th><th className="px-3 py-2 text-right font-medium">Dificuldades</th>
              <th className="px-3 py-2 text-right font-medium">Dúvidas</th><th className="px-3 py-2 text-right font-medium">A revisar</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => {
              const c = conta.get(r.id) ?? { total: 0, pend: 0, dif: 0, duv: 0 };
              return (
                <tr key={r.id} className="border-t">
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums">{dataBR(r.data_reuniao)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.titulo}</p>
                    {r.contrato && <p className="text-xs text-muted-foreground">{semCodigo(r.contrato)}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs">{[r.supervisor, r.equipe].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.participantes.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.dif}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.duv}</td>
                  <td className="px-3 py-2 text-right">
                    {c.pend > 0 ? <button className="font-semibold text-primary hover:underline" onClick={() => irPara("revisar", { reuniao: r.id, status: "pendente" })}>{c.pend}</button> : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setAberta(r)}><FileText className="mr-1 h-4 w-4" /> Texto</Button>
                    <AcessoGate menu={MENU_REUNIOES} acao="excluir">
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => {
                        if (!window.confirm(`Excluir "${r.titulo}" e os registros dela? As ações do plano ficam, sem o vínculo.`)) return;
                        try { await excluir.mutateAsync(r.id); toast.success("Reunião excluída."); } catch (e) { toast.error((e as Error).message); }
                      }}><Trash2 className="h-4 w-4" /></Button>
                    </AcessoGate>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Dialog open={!!aberta} onOpenChange={(o) => !o && setAberta(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
          <DialogHeader><DialogTitle>{aberta?.titulo} · {dataBR(aberta?.data_reuniao)}</DialogTitle></DialogHeader>
          {aberta?.participantes.length ? <p className="text-xs text-muted-foreground">Participantes: {aberta.participantes.join(", ")}</p> : null}
          <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed">{texto.isLoading ? "Carregando…" : texto.data}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
