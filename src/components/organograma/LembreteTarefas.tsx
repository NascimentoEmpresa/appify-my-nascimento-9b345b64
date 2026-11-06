import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useMinhasTarefas } from "@/hooks/useTarefasFuncao";
import { diasDeAtraso, separarTarefas, type TarefaItem } from "@/lib/organograma/tarefas";

// =====================================================================
// Lembrete ao entrar no sistema (SIS-2026-0771): "A Vencer no Dia" e "Vencidas"
// em destaque. Abre uma vez por sessão do navegador: lembra, sem interromper a
// cada tela. Quem não tem tarefa nem percebe que isto existe.
// =====================================================================

const MAX_POR_GRUPO = 6;

export function LembreteTarefas() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { data } = useMinhasTarefas(!!user);
  const [aberto, setAberto] = useState(false);
  const hoje = data?.hoje ?? "";
  const s = useMemo(() => separarTarefas(data?.itens ?? [], hoje), [data, hoje]);
  const total = s.vencida.length + s.hoje.length;
  const chave = `lembrete-tarefas:${user?.id ?? ""}:${hoje}`;

  useEffect(() => {
    if (!data || total === 0) return;
    try {
      if (sessionStorage.getItem(chave)) return;
      sessionStorage.setItem(chave, "1");
    } catch { /* sem armazenamento: mostra mesmo assim */ }
    // Já está vendo as tarefas: conta como lembrado, e não abre depois em outra tela.
    if (!pathname.startsWith("/app/minhas-tarefas")) setAberto(true);
    // Só decide uma vez, quando as tarefas chegam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, total, chave]);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Suas tarefas de hoje</DialogTitle>
          <DialogDescription>{s.vencida.length} vencida(s) e {s.hoje.length} a vencer hoje.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Grupo titulo="Vencidas" itens={s.vencida} hoje={hoje} vencida />
          <Grupo titulo="A vencer no dia" itens={s.hoje} hoje={hoje} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setAberto(false)}>Agora não</Button>
            <Button onClick={() => { setAberto(false); nav("/app/minhas-tarefas"); }}>Ver minhas tarefas</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Grupo({ titulo, itens, hoje, vencida }: { titulo: string; itens: TarefaItem[]; hoje: string; vencida?: boolean }) {
  if (!itens.length) return null;
  return (
    <section>
      <h3 className={vencida ? "mb-1 text-sm font-semibold text-red-700" : "mb-1 text-sm font-semibold text-amber-700"}>{titulo}</h3>
      <ul className="space-y-1 text-sm">
        {itens.slice(0, MAX_POR_GRUPO).map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5">
            <span className="min-w-0 truncate">{t.titulo}</span>
            {vencida && <Badge className="shrink-0 bg-red-600">{diasDeAtraso(t.vencimento, hoje)} dia(s)</Badge>}
          </li>
        ))}
      </ul>
      {itens.length > MAX_POR_GRUPO && <p className="mt-1 text-xs text-muted-foreground">e mais {itens.length - MAX_POR_GRUPO}.</p>}
    </section>
  );
}
