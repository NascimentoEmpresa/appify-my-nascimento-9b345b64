import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Lock, Unlock, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { usePermissoes } from "@/context/PermissoesContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// =====================================================================
// TREINAMENTOS — alertas de reprovação (14/10/2026, mig 20261014000020).
//
// Quem reprova a prova o número máximo de vezes seguidas fica com a prova
// travada e nasce um TREINAMENTO_ALERTA (com aviso no sininho). Aqui quem
// recebe os alertas vê as tentativas e decide: liberar uma nova rodada
// (zera as reprovações e destrava) ou encerrar com o que foi verificado.
//
// Quem vê: menu fantasma `treinamentos_alertas` (visualizar) ou quem gerencia
// treinamentos; quem trata: o mesmo menu com `alterar`. As RPCs cobram igual.
// =====================================================================

export interface AlertaTreinamento {
  id: string;
  treinamento_id: string;
  treinamento_titulo: string | null;
  user_id: string;
  usuario_nome: string | null;
  tentativas: number;
  ultima_nota: number | null;
  nota_minima: number | null;
  status: "aberto" | "liberado" | "encerrado";
  tratado_por_nome: string | null;
  tratado_em: string | null;
  tratado_obs: string | null;
  created_at: string;
}

interface Tentativa {
  id: string;
  numero: number;
  acertos: number;
  total: number;
  nota: number;
  aprovado: boolean;
  created_at: string;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Quem enxerga a aba de alertas (o banco repete em trn_pode_ver_alertas). */
export function usePodeVerAlertasTreinamento() {
  const { can } = usePermissoes();
  return can("visualizar", undefined, "treinamentos_alertas")
      || can("incluir", undefined, "treinamentos_gerenciar")
      || can("alterar", undefined, "treinamentos_gerenciar");
}

export function useAlertasTreinamento(ativo: boolean) {
  return useQuery({
    queryKey: ["treinamento-alertas"],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("TREINAMENTO_ALERTA")
        .select("*").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return (data ?? []) as AlertaTreinamento[];
    },
  });
}

export function AlertasTreinamento() {
  const { can } = usePermissoes();
  const podeTratar = can("alterar", undefined, "treinamentos_alertas")
                  || can("incluir", undefined, "treinamentos_gerenciar")
                  || can("alterar", undefined, "treinamentos_gerenciar");
  const q = useAlertasTreinamento(true);
  const [filtro, setFiltro] = useState<"aberto" | "tratados">("aberto");
  const lista = q.data ?? [];
  const abertos = lista.filter((a) => a.status === "aberto");
  const tratados = lista.filter((a) => a.status !== "aberto");
  const visiveis = filtro === "aberto" ? abertos : tratados;

  if (q.isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…</div>;
  }
  if (q.isError) {
    return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Não deu para carregar os alertas: {(q.error as Error).message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-gradient-to-r from-amber-500/10 to-transparent p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground"><AlertTriangle className="h-4 w-4 text-amber-600" /> Alertas de treinamento</p>
        <p className="mt-1">
          Quem não atinge a nota mínima no número máximo de tentativas fica com a prova travada. Verifique com a pessoa o que está
          acontecendo e libere uma nova rodada — ou encerre registrando o que foi visto.
        </p>
      </div>

      <div className="flex gap-1 border-b pb-2">
        {([["aberto", `Abertos (${abertos.length})`], ["tratados", `Tratados (${tratados.length})`]] as const).map(([k, r]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${filtro === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            {r}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <CheckCircle2 className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-medium">{filtro === "aberto" ? "Nenhum alerta aberto" : "Nenhum alerta tratado ainda"}</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visiveis.map((a) => <CardAlerta key={a.id} a={a} podeTratar={podeTratar} />)}
        </div>
      )}
    </div>
  );
}

function CardAlerta({ a, podeTratar }: { a: AlertaTreinamento; podeTratar: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [verTentativas, setVerTentativas] = useState(false);
  const [acao, setAcao] = useState<"liberar" | "encerrar" | null>(null);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const tentativas = useQuery({
    queryKey: ["treinamento-alerta-tentativas", a.treinamento_id, a.user_id],
    enabled: verTentativas,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("TREINAMENTO_TENTATIVA")
        .select("id, numero, acertos, total, nota, aprovado, created_at")
        .eq("treinamento_id", a.treinamento_id).eq("user_id", a.user_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Tentativa[];
    },
  });

  const confirmar = async () => {
    if (!acao) return;
    if (acao === "encerrar" && !obs.trim()) {
      toast({ title: "Escreva o que foi verificado", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).rpc("trn_alerta_tratar", { _alerta: a.id, _acao: acao, _obs: obs.trim() || null });
    setSalvando(false);
    if (error) { toast({ title: "Não deu para tratar o alerta", description: error.message, variant: "destructive" }); return; }
    toast(acao === "liberar"
      ? { title: "Nova rodada liberada", description: `${a.usuario_nome ?? "O colaborador"} foi avisado para rever o vídeo e refazer a prova.` }
      : { title: "Alerta encerrado" });
    setAcao(null); setObs("");
    qc.invalidateQueries({ queryKey: ["treinamento-alertas"] });
  };

  const aberto = a.status === "aberto";
  return (
    <div className={`flex flex-col gap-3 rounded-xl border bg-card p-4 ${aberto ? "border-amber-400/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">{a.usuario_nome ?? "Colaborador"}</h3>
          <p className="text-sm text-muted-foreground">{a.treinamento_titulo ?? "Treinamento"}</p>
        </div>
        {aberto ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white"><Lock className="h-3 w-3" /> Travada</span>
        ) : a.status === "liberado" ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold text-white"><Unlock className="h-3 w-3" /> Liberada</span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-slate-500 px-2 py-0.5 text-[11px] font-bold text-white"><XCircle className="h-3 w-3" /> Encerrada</span>
        )}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Reprovou <b className="text-foreground">{a.tentativas}x seguidas</b> · última nota <b className="text-foreground">{a.ultima_nota ?? "—"}%</b> (mínimo {a.nota_minima ?? "—"}%)</p>
        <p>Alerta gerado em {fmt(a.created_at)}</p>
        {!aberto && (
          <p>{a.status === "liberado" ? "Liberado" : "Encerrado"} por <b className="text-foreground">{a.tratado_por_nome ?? "—"}</b> em {fmt(a.tratado_em)}
            {a.tratado_obs && <span className="mt-1 block whitespace-pre-wrap rounded-md border-l-2 border-primary/40 bg-muted/40 px-2 py-1.5 text-foreground [overflow-wrap:anywhere]">{a.tratado_obs}</span>}
          </p>
        )}
        <button type="button" className="flex items-center gap-1 font-semibold text-primary" onClick={() => setVerTentativas((v) => !v)}>
          {verTentativas ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Tentativas
        </button>
        {verTentativas && (
          tentativas.isLoading ? <p><Loader2 className="inline h-3 w-3 animate-spin" /> Carregando…</p>
          : (
            <ul className="space-y-1">
              {(tentativas.data ?? []).map((t) => (
                <li key={t.id} className="flex justify-between gap-2 rounded-md bg-muted/40 px-2 py-1 tabular-nums">
                  <span>#{t.numero} · {fmt(t.created_at)}</span>
                  <span className={t.aprovado ? "font-semibold text-emerald-700" : "font-semibold text-destructive"}>
                    {t.acertos}/{t.total} ({t.nota}%)
                  </span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {aberto && podeTratar && (
        <div className="mt-auto flex gap-2">
          <Button className="flex-1 gap-1.5" onClick={() => { setObs(""); setAcao("liberar"); }}><Unlock className="h-4 w-4" /> Liberar nova rodada</Button>
          <Button variant="outline" onClick={() => { setObs(""); setAcao("encerrar"); }}>Encerrar</Button>
        </div>
      )}

      <Dialog open={!!acao} onOpenChange={(o) => !o && !salvando && setAcao(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{acao === "liberar" ? "Liberar nova rodada" : "Encerrar alerta"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {acao === "liberar"
              ? `${a.usuario_nome ?? "O colaborador"} volta a ter ${a.tentativas} tentativa(s) e é avisado para rever o vídeo e refazer a prova.`
              : "A prova continua travada. Registre o que foi verificado com a pessoa."}
          </p>
          <Textarea rows={3} maxLength={1000} value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder={acao === "liberar" ? "Observação (opcional): o que foi conversado" : "O que foi verificado *"} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAcao(null)} disabled={salvando}>Voltar</Button>
            <Button onClick={confirmar} disabled={salvando} variant={acao === "encerrar" ? "destructive" : "default"}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {acao === "liberar" ? "Liberar" : "Encerrar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
