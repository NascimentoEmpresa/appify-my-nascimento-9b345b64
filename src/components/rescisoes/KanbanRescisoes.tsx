import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtData } from "@/lib/demissao/solicitacao";
import {
  STATUS_RESCISAO, corStatusRescisao, diasDesde, pagamentoAtrasado, semRetorno, type LinhaRescisao,
} from "@/lib/demissao/rescisao";
import { AlertTriangle, CalendarClock, CheckCircle2, FileCheck2, FileClock, MoreVertical, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O kanban das rescisões (21/10/2026) — uma coluna por STATUS da planilha
 * (Por fazer → Feita → Rescisão OK → Rescisão e documentos OK →
 * Encaminhado ao INSS). Arrastar o card muda o status; quem não arrasta
 * (celular, teclado) usa o "⋮" do card. Igual ao kanban do Recrutamento, mas
 * sem etapas aninhadas: aqui o card é a linha da planilha.
 *
 * Coluna com muitas linhas (a "Rescisão OK" tem ~700 no histórico) mostra
 * as primeiras e um "mostrar mais" — desenhar mil cards de uma vez travava.
 */

const CARDS_DE_CADA_VEZ = 40;

/** "Por fazer": o pagamento mais próximo primeiro (é a fila do dia). Demais: o mais recente primeiro. */
function ordenarColuna(status: string, linhas: LinhaRescisao[]): LinhaRescisao[] {
  const copia = [...linhas];
  const asc = status === "Por fazer";
  return copia.sort((a, b) => {
    const da = a.pagamento ?? "", db = b.pagamento ?? "";
    if (da === db) return a.nome.localeCompare(b.nome, "pt-BR");
    if (!da) return 1;
    if (!db) return -1;
    return (da < db ? -1 : 1) * (asc ? 1 : -1);
  });
}

function Chip({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium", className)}>
      {children}
    </span>
  );
}

function CardRescisao({ l, hoje, podeMover, onAbrir, onMover }: {
  l: LinhaRescisao; hoje: string; podeMover: boolean;
  onAbrir: () => void; onMover: (para: string) => void;
}) {
  const atrasada = pagamentoAtrasado(l, hoje);
  const dias = diasDesde(l.statusDesde);
  const programadas = l.rescisaoProgramada && l.valesProgramados;
  return (
    <div
      draggable={podeMover}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.chave); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onAbrir}
      className={cn(
        "group cursor-pointer rounded-lg border bg-card p-2.5 text-left shadow-sm transition hover:border-primary/50 hover:shadow",
        podeMover && "active:cursor-grabbing",
        atrasada && "border-l-4 border-l-red-500",
      )}
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight [overflow-wrap:anywhere]">{l.nome}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {l.empresa ?? "—"}{l.matricula ? ` · ${l.matricula}` : ""}
            {l.solicitacao ? ` · #${l.solicitacao.id}` : l.origem === "manual" ? " · manual" : ""}
          </p>
        </div>
        {podeMover && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="-mr-1 -mt-1 h-6 w-6 shrink-0 opacity-60 group-hover:opacity-100" aria-label="Mover">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuLabel className="text-xs">Mover para</DropdownMenuLabel>
              {STATUS_RESCISAO.filter((s) => s !== l.statusRescisao).map((s) => (
                <DropdownMenuItem key={s} onClick={() => onMover(s)}>{s}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {l.contrato && <p className="mt-1 line-clamp-1 text-[11px] text-foreground/80" title={l.contrato}>{l.contrato}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className={cn("inline-flex items-center gap-1", atrasada ? "font-semibold text-red-600" : "text-muted-foreground")}>
          {atrasada ? <AlertTriangle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
          Pagto. <span className={cn(l.sugerido.pagamento && "italic")}>{l.pagamento ? fmtData(l.pagamento) : "—"}</span>
        </span>
        {dias != null && dias > 0 && (
          <span className="text-muted-foreground" title="Dias nesta coluna">{dias}d</span>
        )}
      </div>
      {l.tipo && <p className={cn("mt-1 line-clamp-1 text-[11px] text-muted-foreground", l.sugerido.tipo && "italic")}>{l.tipo}</p>}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {l.homologacao && l.homologacao !== "Não" && (
          <Chip className="border-violet-200 bg-violet-50 text-violet-800" title="Homologação">Homolog.: {l.homologacao}</Chip>
        )}
        {l.sstOk === false && <Chip className="border-amber-200 bg-amber-50 text-amber-800" title="Planilha SST"><Stethoscope className="h-2.5 w-2.5" /> SST</Chip>}
        {programadas
          ? <Chip className="border-emerald-200 bg-emerald-50 text-emerald-700" title="Rescisão e vales programados"><CheckCircle2 className="h-2.5 w-2.5" /> Prog.</Chip>
          : <Chip className="border-slate-200 bg-slate-50 text-slate-600" title="Falta programar rescisão/vales">Falta prog.</Chip>}
        {semRetorno(l)
          ? <Chip className="border-sky-200 bg-sky-50 text-sky-800" title="Documentação enviada, sem retorno"><FileClock className="h-2.5 w-2.5" /> Aguard. retorno</Chip>
          : (l.retornoMeio || l.retornoData || l.retornoObs) && <Chip className="border-emerald-200 bg-emerald-50 text-emerald-700" title="Documentação retornou"><FileCheck2 className="h-2.5 w-2.5" /> Doc. OK</Chip>}
      </div>
    </div>
  );
}

function Coluna({ status, linhas, hoje, podeMover, onAbrir, onSoltar, onMover }: {
  status: string; linhas: LinhaRescisao[]; hoje: string; podeMover: boolean;
  onAbrir: (l: LinhaRescisao) => void; onSoltar: (chave: string) => void; onMover: (l: LinhaRescisao, para: string) => void;
}) {
  const [exibir, setExibir] = useState(CARDS_DE_CADA_VEZ);
  const [sobre, setSobre] = useState(false);
  useEffect(() => { setExibir(CARDS_DE_CADA_VEZ); }, [linhas.length]);
  const ordenadas = useMemo(() => ordenarColuna(status, linhas), [status, linhas]);
  const atrasadas = useMemo(() => linhas.filter((l) => pagamentoAtrasado(l, hoje)).length, [linhas, hoje]);

  return (
    <div
      className={cn("flex w-[280px] shrink-0 flex-col rounded-xl border bg-muted/40 transition", sobre && "border-primary bg-primary/5 ring-2 ring-primary/30")}
      onDragOver={(e) => { if (!podeMover) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!sobre) setSobre(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSobre(false); }}
      onDrop={(e) => { e.preventDefault(); setSobre(false); const chave = e.dataTransfer.getData("text/plain"); if (chave) onSoltar(chave); }}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", corStatusRescisao(status))}>{status}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {atrasadas > 0 && <span className="font-semibold text-red-600" title="Pagamento vencido">{atrasadas} atras.</span>}
          <b className="text-foreground">{linhas.length}</b>
        </span>
      </div>
      <div className="flex max-h-[calc(100vh-330px)] min-h-[160px] flex-col gap-2 overflow-y-auto p-2">
        {ordenadas.slice(0, exibir).map((l) => (
          <CardRescisao key={l.chave} l={l} hoje={hoje} podeMover={podeMover} onAbrir={() => onAbrir(l)} onMover={(para) => onMover(l, para)} />
        ))}
        {ordenadas.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">{podeMover ? "Arraste um card para cá" : "Nenhuma"}</p>}
        {ordenadas.length > exibir && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setExibir((n) => n + CARDS_DE_CADA_VEZ * 2)}>
            Mostrar mais ({ordenadas.length - exibir})
          </Button>
        )}
      </div>
    </div>
  );
}

export function KanbanRescisoes({ linhas, hoje, podeMover, onAbrir, onMover }: {
  linhas: LinhaRescisao[]; hoje: string; podeMover: boolean;
  onAbrir: (l: LinhaRescisao) => void;
  onMover: (l: LinhaRescisao, para: string) => void;
}) {
  const porStatus = useMemo(() => {
    const m = new Map<string, LinhaRescisao[]>(STATUS_RESCISAO.map((s) => [s, []]));
    for (const l of linhas) {
      const s = l.statusRescisao ?? "Por fazer";
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(l);
    }
    return m;
  }, [linhas]);
  const porChave = useMemo(() => new Map(linhas.map((l) => [l.chave, l])), [linhas]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {[...porStatus.entries()].map(([status, ls]) => (
        <Coluna key={status} status={status} linhas={ls} hoje={hoje} podeMover={podeMover} onAbrir={onAbrir} onMover={onMover}
          onSoltar={(chave) => {
            const l = porChave.get(chave);
            if (l && (l.statusRescisao ?? "Por fazer") !== status) onMover(l, status);
          }} />
      ))}
    </div>
  );
}
