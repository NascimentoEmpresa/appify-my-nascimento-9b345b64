// Estúdio de BI — o assistente que monta gráfico por texto.
//
// Painel lateral em forma de conversa: o analista descreve, a function bi-ia
// devolve widgets JÁ EXECUTADOS (com amostra) e cada um aparece desenhado
// aqui, com o SQL à vista. Nada entra no painel sem o analista clicar em
// "Adicionar" — a IA propõe, a pessoa decide.
//
// Três modos:
//   painel  → "crie um painel de RH": devolve painel + widgets; o botão
//             cria tudo de uma vez (Paineis.tsx).
//   widget  → dentro de um painel: cada widget tem "Adicionar ao painel".
//   ajustar → um widget aberto: "deixa em linha", "só 2026" — devolve o
//             mesmo widget alterado; "Aplicar" substitui.
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { WidgetGrafico } from "@/components/bi/WidgetGrafico";
import { pedirParaIaBi, type RespostaIaBi } from "@/hooks/useBiEstudio";
import { TIPOS_WIDGET, type FiltroPainel, type WidgetRascunho } from "@/lib/bi/estudio";
import { AlertTriangle, Bot, Check, ChevronDown, ChevronUp, Loader2, Plus, Send, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Modo = "painel" | "widget" | "ajustar";

interface Turno {
  papel: "user" | "assistant";
  texto: string;
  resposta?: RespostaIaBi;
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  modo: Modo;
  painelId: number | null;
  filtros: FiltroPainel[];
  params: Record<string, string | null>;
  widgetAtual?: Partial<WidgetRascunho> | null;
  /** painel: (widgets, painel) → cria tudo. widget/ajustar: (widgets) → adiciona/aplica o escolhido. */
  onAplicar: (widgets: WidgetRascunho[], painel: RespostaIaBi["painel"]) => void | Promise<void>;
  salvando?: boolean;
  escuro?: boolean;
}

const SUGESTOES: Record<Modo, string[]> = {
  painel: [
    "Painel de RH: colaboradores ativos por contrato, admissões por mês em 2026, demissões por motivo e um KPI de headcount.",
    "Painel de recrutamento: vagas abertas por status, tempo médio em cada etapa, vagas por contrato e por motivo.",
    "Painel financeiro: contas a pagar e a receber em aberto por mês, com filtro de data inicial.",
  ],
  widget: [
    "Demissões por mês nos últimos 12 meses, em barras.",
    "Top 10 contratos por número de colaboradores ativos, barras horizontais.",
    "KPI: total de vagas em aberto hoje, comparando com 30 dias atrás.",
  ],
  ajustar: [
    "Troca para linha e mostra só 2026.",
    "Agrupa por trimestre em vez de mês.",
    "Mostra os rótulos de valor e limita a 8 categorias.",
  ],
};

export function AssistenteIA({ aberto, onFechar, modo, painelId, filtros, params, widgetAtual, onAplicar, salvando, escuro }: Props) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turnos, pensando]);

  const enviar = async (pedido?: string) => {
    const p = (pedido ?? texto).trim();
    if (!p || pensando) return;
    setTexto("");
    const novos: Turno[] = [...turnos, { papel: "user", texto: p }];
    setTurnos(novos);
    setPensando(true);
    try {
      const historico = novos.slice(0, -1).slice(-6).map(t => ({
        role: t.papel, content: t.papel === "assistant" && t.resposta ? JSON.stringify({ resposta: t.resposta.resposta, widgets: t.resposta.widgets.map(w => ({ titulo: w.titulo, tipo: w.tipo, sql: w.sql, config: w.config })) }) : t.texto,
      }));
      const r = await pedirParaIaBi({
        pedido: p, painel_id: painelId, filtros, params, historico,
        widget_atual: modo === "ajustar" && widgetAtual ? { titulo: widgetAtual.titulo, tipo: widgetAtual.tipo, sql: widgetAtual.sql, config: widgetAtual.config, largura: widgetAtual.largura, altura: widgetAtual.altura } : null,
      });
      setTurnos(t => [...t, { papel: "assistant", texto: r.resposta || "Pronto.", resposta: r }]);
    } catch (e) {
      const msg = (e as Error).message;
      setTurnos(t => [...t, { papel: "assistant", texto: "⚠️ " + msg }]);
      toast.error(msg);
    } finally {
      setPensando(false);
    }
  };

  const titulo = modo === "painel" ? "Criar painel com IA" : modo === "ajustar" ? "Ajustar gráfico com IA" : "Criar gráfico com IA";

  return (
    <Sheet open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> {titulo}</SheetTitle>
          <SheetDescription>
            Descreva o que você quer ver. A IA escreve o SQL, roda no banco e mostra o gráfico aqui — nada entra no painel sem você aprovar.
            {filtros.length > 0 && <> Filtros disponíveis: {filtros.map(f => <code key={f.chave} className="mx-0.5 rounded bg-muted px-1">{"{{" + f.chave + "}}"}</code>)}.</>}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {turnos.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exemplos</p>
              {SUGESTOES[modo].map(s => (
                <button key={s} type="button" onClick={() => enviar(s)}
                        className="block w-full rounded-lg border bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted">
                  {s}
                </button>
              ))}
            </div>
          )}
          {turnos.map((t, i) => (
            <div key={i} className={cn("flex gap-2", t.papel === "user" ? "justify-end" : "justify-start")}>
              {t.papel === "assistant" && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="h-4 w-4" /></span>}
              <div className={cn("max-w-[92%] space-y-3", t.papel === "user" && "max-w-[80%]")}>
                <div className={cn("rounded-2xl px-3.5 py-2 text-sm", t.papel === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>{t.texto}</div>
                {t.resposta && t.resposta.widgets.length > 0 && (
                  <div className="space-y-3">
                    {t.resposta.widgets.map((w, j) => (
                      <PreviaWidget key={j} w={w} escuro={escuro} modo={modo}
                        onAplicar={() => onAplicar([w], t.resposta!.painel)} salvando={salvando} />
                    ))}
                    {modo === "painel" && (
                      <Button onClick={() => onAplicar(t.resposta!.widgets, t.resposta!.painel)} disabled={salvando || t.resposta.widgets.every(w => w.ok === false)}>
                        {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                        Criar painel "{t.resposta.painel?.nome ?? "da IA"}" com {t.resposta.widgets.filter(w => w.ok !== false).length} gráfico(s)
                      </Button>
                    )}
                    <p className="text-[11px] text-muted-foreground">{t.resposta.modelo} · {t.resposta.tentativas === 2 ? "corrigido em 2 rodadas" : "1 rodada"}</p>
                  </div>
                )}
              </div>
              {t.papel === "user" && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"><User className="h-4 w-4" /></span>}
            </div>
          ))}
          {pensando && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Escrevendo o SQL e rodando no banco…
            </div>
          )}
          <div ref={fimRef} />
        </div>

        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={texto} onChange={e => setTexto(e.target.value)} rows={2}
              placeholder={modo === "ajustar" ? "O que mudar neste gráfico?" : "Descreva o gráfico ou painel…"}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
            />
            <Button onClick={() => enviar()} disabled={pensando || !texto.trim()} size="icon" className="h-10 w-10 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Enter envia · Shift+Enter quebra linha</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PreviaWidget({ w, escuro, modo, onAplicar, salvando }: {
  w: WidgetRascunho; escuro?: boolean; modo: Modo; onAplicar: () => void; salvando?: boolean;
}) {
  const [verSql, setVerSql] = useState(false);
  const tipoRotulo = TIPOS_WIDGET.find(t => t.valor === w.tipo)?.rotulo ?? w.tipo;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{w.titulo}</p>
          {w.subtitulo && <p className="truncate text-xs text-muted-foreground">{w.subtitulo}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">{tipoRotulo}</Badge>
          <Badge variant="outline" className="text-[10px]">{w.largura}×{w.altura}</Badge>
        </div>
      </div>
      <div className="px-2 py-2">
        {w.ok === false ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div><p className="font-semibold">O SQL não rodou.</p><p className="mt-0.5 whitespace-pre-wrap">{w.erro}</p><p className="mt-1 text-muted-foreground">Peça pra IA corrigir descrevendo o erro, ou adicione e ajuste o SQL à mão.</p></div>
          </div>
        ) : (
          <WidgetGrafico tipo={w.tipo} config={w.config} dados={w.amostra ?? null} escuro={escuro} altura={w.tipo === "kpi" ? 90 : 200} />
        )}
      </div>
      {w.explicacao && <p className="px-3 pb-2 text-[11px] text-muted-foreground">{w.explicacao}</p>}
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <button type="button" onClick={() => setVerSql(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {verSql ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} SQL
        </button>
        {modo !== "painel" && (
          <Button size="sm" onClick={onAplicar} disabled={salvando}>
            {modo === "ajustar" ? <><Check className="mr-1.5 h-3.5 w-3.5" /> Aplicar</> : <><Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar ao painel</>}
          </Button>
        )}
      </div>
      {verSql && <pre className="max-h-48 overflow-auto border-t bg-muted/40 px-3 py-2 text-[11px] leading-relaxed">{w.sql}</pre>}
    </div>
  );
}
