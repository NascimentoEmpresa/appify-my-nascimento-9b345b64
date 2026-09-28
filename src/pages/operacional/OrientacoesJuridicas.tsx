import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FioDuvida } from "@/components/juridico/FioDuvida";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Ban, EyeOff, Loader2, MessageSquareReply, Scale, Search, Send } from "lucide-react";
import {
  STATUS_PENDENTE_OPERACIONAL, agruparComplementos, complementoPendente, estaOculta, infoAvaliacao,
  respondidaPeloOperacional, type Complemento, type Duvida,
} from "@/lib/juridico/duvidas";

// =====================================================================
// OPERACIONAL — Orientações Jurídicas (25/09/2026, mig 244)
//
// A pergunta que o ENCARREGADO faz em Encarregados › Orientações Jurídicas
// chega aqui primeiro ("Pendente Operacional"). O supervisor do contrato:
//   • RESPONDE direto ao encarregado — a resposta não vai pra biblioteca do
//     Jurídico (não é parecer), e o fio de complementos continua aqui;
//   • ou ENCAMINHA ao Jurídico quando não sabe orientar — cai na fila de
//     resposta do Parecer Jurídico ("Aprovada"), com a observação dele;
//   • ou REPROVA, com motivo (mig 247) — o encarregado lê no sino.
// "De encarregado" = quem pergunta tem a tela Orientações Jurídicas dos
// Encarregados, por qualquer porta (mig 247).
// Pode também OCULTAR a pergunta: só quem perguntou e os responsáveis veem.
// As decisões são RPCs (jur_duvida_operacional_decidir / jur_duvida_ocultar);
// quem pode é quem tem o menu operacional_orientacoes — a RLS repete.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

type Aba = "pendentes" | "complementar" | "respondidas" | "encaminhadas" | "todas";

const fmtDtHora = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? s : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

const statusDaOrientacao = (d: Duvida): { rotulo: string; cls: string } => {
  if (d.status === STATUS_PENDENTE_OPERACIONAL) return { rotulo: "Aguardando você", cls: "bg-amber-100 text-amber-800 border-amber-200" };
  if (d.status === "Aprovada") return { rotulo: "Com o Jurídico", cls: "bg-violet-100 text-violet-700 border-violet-200" };
  if (d.status === "Respondida") return respondidaPeloOperacional(d)
    ? { rotulo: "Respondida pelo Operacional", cls: "bg-green-100 text-green-700 border-green-200" }
    : { rotulo: "Respondida pelo Jurídico", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (d.status === "Reprovada") return { rotulo: "Reprovada", cls: "bg-red-100 text-red-700 border-red-200" };
  return { rotulo: d.status, cls: "bg-slate-100 text-slate-700 border-slate-200" };
};

export default function OperacionalOrientacoesJuridicas() {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const autor = empregado?.nome || user?.user_metadata?.nome || user?.email || "Operacional";

  const [duvidas, setDuvidas] = useState<Duvida[]>([]);
  const [fios, setFios] = useState<Map<number, Complemento[]>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>("pendentes");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<number | null>(null);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [d, c] = await Promise.all([
      db.from("JUR_DUVIDAS").select("*").eq("origem", "encarregados").order("created_at", { ascending: false }).limit(500),
      db.from("JUR_DUVIDAS_COMPLEMENTOS").select("*").order("id", { ascending: false }).limit(1000),
    ]);
    if (d.error) toast.error("Erro ao carregar: " + d.error.message);
    setDuvidas((d.data ?? []) as Duvida[]);
    setFios(agruparComplementos((c.data ?? []) as Complemento[]));
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const pedeComplemento = useCallback((d: Duvida) =>
    d.status === "Respondida" && respondidaPeloOperacional(d) && complementoPendente(fios.get(d.id) ?? []), [fios]);

  const contagem = useMemo(() => ({
    pendentes: duvidas.filter((d) => d.status === STATUS_PENDENTE_OPERACIONAL).length,
    complementar: duvidas.filter(pedeComplemento).length,
    respondidas: duvidas.filter((d) => d.status === "Respondida" && respondidaPeloOperacional(d)).length,
    encaminhadas: duvidas.filter((d) => d.operacional_acao === "encaminhou").length,
    todas: duvidas.length,
  }), [duvidas, pedeComplemento]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return duvidas.filter((d) => {
      if (aba === "pendentes" && d.status !== STATUS_PENDENTE_OPERACIONAL) return false;
      if (aba === "complementar" && !pedeComplemento(d)) return false;
      if (aba === "respondidas" && !(d.status === "Respondida" && respondidaPeloOperacional(d))) return false;
      if (aba === "encaminhadas" && d.operacional_acao !== "encaminhou") return false;
      if (!q) return true;
      return [d.titulo, d.pergunta, d.resposta, d.autor_nome, d.categoria].some((x) => String(x ?? "").toLowerCase().includes(q));
    });
  }, [duvidas, aba, busca, pedeComplemento]);

  const abrir = (id: number) => { setAberta(aberta === id ? null : id); setTexto(""); };

  const decidir = async (d: Duvida, acao: "responder" | "encaminhar" | "reprovar") => {
    if (acao === "responder" && texto.trim().length < 5) { toast.error("Escreva a orientação para o encarregado."); return; }
    if (acao === "reprovar" && texto.trim().length < 5) { toast.error("Escreva o motivo da reprovação — é o que o encarregado lê."); return; }
    setSalvando(true);
    const { error } = await db.rpc("jur_duvida_operacional_decidir", { p_id: d.id, p_acao: acao, p_texto: texto.trim() || null });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(acao === "responder"
      ? "Orientação enviada ao encarregado."
      : acao === "reprovar" ? "Pergunta reprovada — o encarregado foi avisado com o motivo."
      : "Encaminhada ao Jurídico — ela entra na fila de resposta do Parecer Jurídico.");
    setAberta(null); setTexto(""); carregar();
  };

  const alternarOculta = async (d: Duvida) => {
    const ocultar = !estaOculta(d);
    const { error } = await db.rpc("jur_duvida_ocultar", { p_id: d.id, p_ocultar: ocultar });
    if (error) { toast.error(error.message); return; }
    toast.success(ocultar ? "Pergunta ocultada — só quem perguntou e os responsáveis veem." : "Pergunta visível de novo.");
    carregar();
  };

  const ABAS: { k: Aba; rotulo: string }[] = [
    { k: "pendentes", rotulo: "Aguardando você" },
    { k: "complementar", rotulo: "Pedem complemento" },
    { k: "respondidas", rotulo: "Respondidas por aqui" },
    { k: "encaminhadas", rotulo: "Encaminhadas ao Jurídico" },
    { k: "todas", rotulo: "Todas" },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Orientações Jurídicas"
        subtitle="Perguntas dos encarregados. Responda direto quando souber orientar; quando não, encaminhe ao Jurídico."
        module="Operacional"
        breadcrumb={["Orientações Jurídicas"]}
        actions={<ResumoDeFuncoes fluxo="orientacoes" />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ABAS.map((a) => (
          <Button key={a.k} size="sm" variant={aba === a.k ? "default" : "outline"} onClick={() => setAba(a.k)}>
            {a.rotulo}
            <span className={cn("ml-2 rounded-full px-1.5 text-[11px] font-bold",
              aba === a.k ? "bg-white/20" : (a.k === "pendentes" || a.k === "complementar") && contagem[a.k] > 0 ? "bg-amber-500 text-white" : "bg-muted")}>
              {contagem[a.k]}
            </span>
          </Button>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Assunto, pergunta, encarregado…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      {carregando ? (
        <p className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</p>
      ) : filtradas.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {aba === "pendentes" ? "Nenhuma orientação esperando você." : "Nada neste filtro."}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtradas.map((d) => {
            const open = aberta === d.id;
            const st = statusDaOrientacao(d);
            const av = infoAvaliacao(d.avaliacao);
            const pendente = d.status === STATUS_PENDENTE_OPERACIONAL;
            return (
              <Card key={d.id} className={cn(pendente && !open && "border-amber-300")}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={st.cls}>{st.rotulo}</Badge>
                    {d.categoria && <Badge variant="outline">{d.categoria}</Badge>}
                    {estaOculta(d) && <Badge variant="outline" className="bg-slate-100 text-slate-600"><EyeOff className="mr-1 h-3 w-3" />Oculta</Badge>}
                    {pedeComplemento(d) && <Badge variant="outline" className="bg-violet-100 text-violet-700">💬 Pede complemento</Badge>}
                    {av && <Badge variant="outline" style={{ background: av.bg, color: av.cor }}>{av.emoji} {av.rotulo}</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{fmtDtHora(d.created_at)}</span>
                  </div>
                  <div>
                    <p className="font-semibold leading-tight">{d.titulo}</p>
                    <p className="text-xs text-muted-foreground">por <b>{d.autor_nome || "—"}</b></p>
                  </div>
                  <p className={cn("whitespace-pre-wrap text-sm text-slate-700", !open && "line-clamp-3")}>{d.pergunta}</p>

                  {d.status === "Reprovada" && d.motivo_reprovacao && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      Reprovada por {d.aprovado_por || "—"}: {d.motivo_reprovacao}
                    </div>
                  )}
                  {open && d.operacional_acao === "encaminhou" && (
                    <div className="rounded-lg border bg-violet-50 p-3 text-sm text-violet-900">
                      <Scale className="mr-1 inline h-4 w-4" /> Encaminhada ao Jurídico por {d.operacional_por} · {fmtDtHora(d.operacional_em)}
                      {d.operacional_obs && <p className="mt-1 whitespace-pre-wrap">Obs.: {d.operacional_obs}</p>}
                    </div>
                  )}
                  {open && d.status === "Respondida" && d.resposta && (
                    <div className="rounded-lg border border-green-300 bg-green-50 p-3">
                      <p className="text-xs font-bold uppercase text-green-700">
                        ✅ Resposta {respondidaPeloOperacional(d) ? "do Operacional" : "do Jurídico"} · {d.respondido_por || ""} {d.respondido_em ? "· " + fmtDtHora(d.respondido_em) : ""}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{d.resposta}</p>
                    </div>
                  )}
                  {open && d.status === "Respondida" && (
                    <FioDuvida duvida={d} fio={fios.get(d.id) ?? []} userId={user?.id} autorNome={autor}
                      podeResponder={respondidaPeloOperacional(d)} mostrarNomes onMudou={carregar}
                      toast={(m, t) => (t === "err" ? toast.error(m) : toast.success(m))} />
                  )}

                  {open && pendente && (
                    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                      <p className="text-sm font-semibold">Sua decisão</p>
                      <Textarea rows={4} value={texto} onChange={(e) => setTexto(e.target.value)}
                        placeholder="RESPONDER: a orientação ao encarregado. ENCAMINHAR: opcional — o que o Jurídico precisa saber. REPROVAR: o motivo (o encarregado lê)." />
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => decidir(d, "responder")} disabled={salvando}>
                          <MessageSquareReply className="mr-2 h-4 w-4" /> Responder ao encarregado
                        </Button>
                        <Button variant="outline" onClick={() => decidir(d, "encaminhar")} disabled={salvando}>
                          <Send className="mr-2 h-4 w-4" /> Não sei orientar — encaminhar ao Jurídico
                        </Button>
                        <Button variant="destructive" onClick={() => decidir(d, "reprovar")} disabled={salvando}>
                          <Ban className="mr-2 h-4 w-4" /> Reprovar
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {open && !(respondidaPeloOperacional(d) && estaOculta(d)) && (
                      <Button size="sm" variant="ghost" onClick={() => alternarOculta(d)}>
                        <EyeOff className="mr-1 h-4 w-4" /> {estaOculta(d) ? "Mostrar na biblioteca" : "Ocultar"}
                      </Button>
                    )}
                    <Button size="sm" variant={open ? "outline" : pendente ? "default" : "secondary"} onClick={() => abrir(d.id)}>
                      {open ? "Fechar" : pendente ? "Analisar →" : "Ver →"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
