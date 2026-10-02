import { useMemo } from "react";
import { ArrowRight, History, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useHistorico } from "@/hooks/useChecklistModulos";
import { ROTULO_CAMPO, rotuloValor, type DadosChecklist, type Historico } from "@/lib/sistemas/checklistModulos";
import { fmtDataHora } from "./ui";

// Linha do tempo do checklist: cada mudança de status, data, responsável ou
// observação, gravada pelo gatilho do banco (SIS_CHECKLIST_HIST).

export function HistoricoLista({ dados, moduloId, limite = 300, compacto, itens }: {
  dados: DadosChecklist; moduloId?: string | null; limite?: number; compacto?: boolean;
  /** Lista já carregada (o resumo da página vem na RPC); sem ela, busca. */
  itens?: Historico[];
}) {
  const q = useHistorico(moduloId ?? null, limite, !itens);
  const lista = itens ?? (q.data ?? []);
  const nomeModulo = useMemo(() => new Map(dados.modulos.map((m) => [m.id, m.nome])), [dados.modulos]);
  const nomeTela = useMemo(() => new Map(dados.telas.map((t) => [t.id, t.nome])), [dados.telas]);

  if (!itens && q.isLoading) return <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>;
  if (!lista.length) {
    return (
      <Card className="flex flex-col items-center gap-2 p-8 text-center">
        <History className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Nada preenchido ainda — as mudanças do checklist aparecem aqui.</p>
      </Card>
    );
  }
  return (
    <ol className="space-y-2">
      {lista.map((h) => (
        <li key={h.id} className="flex gap-3 rounded-xl border border-border bg-card p-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <b>{ROTULO_CAMPO[h.campo] ?? h.campo}</b>
              {!compacto && <span className="text-muted-foreground"> · {nomeModulo.get(h.modulo_id ?? "") ?? "—"}{h.menu_id ? ` › ${nomeTela.get(h.menu_id) ?? "tela removida"}` : " (módulo)"}</span>}
              {compacto && h.menu_id && <span className="text-muted-foreground"> · {nomeTela.get(h.menu_id) ?? "tela"}</span>}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground line-through decoration-muted-foreground/40">{rotuloValor(h.campo, h.de)}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-semibold text-foreground">{rotuloValor(h.campo, h.para)}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{h.usuario_nome ?? "—"} · {fmtDataHora(h.created_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
