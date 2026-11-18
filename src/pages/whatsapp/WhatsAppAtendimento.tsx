// SIS-2026-0929 — Atendimento dos supervisores por WhatsApp com I.A.
// /app/whatsapp/atendimento — fila de pendências, protocolos, indicadores e
// auditoria do canal corporativo dos supervisores (WA_CANAL 'supervisores').
//
// Acesso (menus nascem pendentes — liberar em Módulos & Menus › Novos Módulos):
//   whatsapp_atd_fila      visualizar = ver fila/protocolos/indicadores; alterar = assumir/encaminhar/concluir
//   whatsapp_atd_auditoria visualizar = aba Auditoria e consultas dentro do protocolo
// Tudo vem por RPC SECURITY DEFINER que confere o menu (wa_atd_*); a conversa
// em si continua na Caixa de Entrada (/app/whatsapp), onde a equipe responde.
//
// Atualização da fila: SÓ quando a pessoa pede (botão Atualizar desta aba ou o
// da barra do topo — src/lib/atualizarTela.ts). Sem refetchInterval: a Caixa de
// Entrada com 8 s derrubou a produção em 03/11/2026 (mig 20261103004100), e o
// guardião (regra D1) reprova busca automática.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import {
  Bot, CheckCircle2, Clock, Hand, Inbox, MessageCircle, RefreshCw, Search, ShieldAlert,
  ShieldCheck, Undo2, UserCheck, Forward, AlertTriangle, Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  STATUS_ROTULO, STATUS_COR, PAPEL_ROTULO, MOTIVO_CONSULTA_ROTULO, rotuloMotivoEncaminhamento,
  tempoEsperaMin, formatarEspera, urgencia, ordenarFila, filtrarFila,
  type StatusAtendimento, type ItemFila,
} from "@/lib/whatsapp/atendimentoSupervisores";

interface ItemFilaTela extends ItemFila {
  assunto: string | null; sensivel: boolean; resumo: string | null; motivo: string | null; setor: string | null;
  solicitante_papel: string | null; solicitante_nome: string | null;
  contato_nome: string | null; contato_telefone: string | null;
  contrato_nome: string | null; responsavel_nome: string | null;
  conversa_id: string; resolvido_pela_ia: boolean | null;
}

const fmtData = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function StatusBadge({ status }: { status: StatusAtendimento }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COR[status]}`}>{STATUS_ROTULO[status]}</span>;
}

function Espera({ item }: { item: ItemFilaTela }) {
  const min = tempoEsperaMin(item);
  const u = urgencia(min);
  const cor = u === "critico" ? "text-destructive font-bold" : u === "atencao" ? "text-amber-600 font-semibold" : "text-muted-foreground";
  return <span className={`whitespace-nowrap text-xs ${cor}`}>{formatarEspera(min)}</span>;
}

function Indicador({ icone: Icone, rotulo, valor, detalhe }: { icone: any; rotulo: string; valor: string | number; detalhe?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icone className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none">{valor}</p>
        <p className="truncate text-xs font-medium text-muted-foreground">{rotulo}</p>
        {detalhe && <p className="truncate text-[11px] text-muted-foreground">{detalhe}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tabela de protocolos (fila e histórico usam a mesma)
// ---------------------------------------------------------------------------
function TabelaProtocolos({ itens, onAbrir }: { itens: ItemFilaTela[]; onAbrir: (i: ItemFilaTela) => void }) {
  if (!itens.length) return <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum atendimento aqui.</Card>;
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Protocolo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Quem escreveu</TableHead>
            <TableHead>Contrato</TableHead>
            <TableHead>Assunto / resumo</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead>Espera</TableHead>
            <TableHead>Aberto em</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((i) => (
            <TableRow key={i.id} className="cursor-pointer" onClick={() => onAbrir(i)}>
              <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{i.protocolo}</TableCell>
              <TableCell><StatusBadge status={i.status} /></TableCell>
              <TableCell className="text-xs">
                <div className="font-medium">{i.solicitante_nome ?? i.contato_nome ?? "—"}</div>
                <div className="text-muted-foreground">{PAPEL_ROTULO[i.solicitante_papel ?? ""] ?? "—"}</div>
              </TableCell>
              <TableCell className="text-xs">{i.contrato_nome ?? "—"}</TableCell>
              <TableCell className="max-w-[320px] text-xs">
                <div className="flex items-center gap-1">
                  {i.sensivel && <Lock className="h-3 w-3 shrink-0 text-amber-600" aria-label="Assunto sensível" />}
                  <span className="font-medium">{i.assunto ?? "—"}</span>
                </div>
                {i.motivo && <div className="text-muted-foreground">{rotuloMotivoEncaminhamento(i.motivo)}</div>}
                {i.resumo && <div className="line-clamp-2 text-muted-foreground">{i.resumo}</div>}
              </TableCell>
              <TableCell className="text-xs">{i.responsavel_nome ?? <span className="text-muted-foreground">fila geral</span>}{i.setor && <div className="text-muted-foreground">{i.setor}</div>}</TableCell>
              <TableCell><Espera item={i} /></TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtData(i.aberto_em)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Detalhe do protocolo
// ---------------------------------------------------------------------------
function DetalheProtocolo({ id, aberto, onFechar }: { id: string | null; aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const [modo, setModo] = useState<null | "encaminhar" | "concluir">(null);
  const [texto, setTexto] = useState("");
  const [setor, setSetor] = useState<string>("");
  const [responsavel, setResponsavel] = useState<string>("");

  const { data: det, isLoading } = useQuery({
    queryKey: ["wa-atd-detalhe", id],
    enabled: !!id && aberto,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_atd_detalhe", { p_atendimento: id });
      if (error) throw error;
      return data as any;
    },
  });
  const { data: responsaveis } = useQuery({
    queryKey: ["wa-atd-responsaveis"],
    enabled: modo === "encaminhar",
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_atd_responsaveis");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });
  const { data: canal } = useQuery({
    queryKey: ["wa-atd-canal"],
    enabled: modo === "encaminhar",
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("WA_CANAL").select("setores").eq("codigo", "supervisores").maybeSingle();
      if (error) throw error;
      return data as { setores: string[] } | null;
    },
  });

  const acao = useMutation({
    mutationFn: async (p: { acao: string; responsavel?: string | null; setor?: string | null; texto?: string | null }) => {
      const { error } = await (supabase as any).rpc("wa_atd_acao", {
        p_atendimento: id, p_acao: p.acao, p_responsavel: p.responsavel ?? null, p_setor: p.setor ?? null, p_texto: p.texto ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      toast.success({ assumir: "Atendimento assumido — a I.A parou nesta conversa.", devolver_ia: "Devolvido para a I.A.", encaminhar: "Encaminhado.", concluir: "Atendimento concluído." }[p.acao] ?? "Feito.");
      setModo(null); setTexto("");
      qc.invalidateQueries({ queryKey: ["wa-atd-detalhe", id] });
      qc.invalidateQueries({ queryKey: ["wa-atd-fila"] });
      qc.invalidateQueries({ queryKey: ["wa-atd-indicadores"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Não deu certo."),
  });

  const a = det?.atendimento;
  const pode = !!det?.pode_alterar && a && a.status !== "concluido";

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { setModo(null); onFechar(); } }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{a?.protocolo ?? "Protocolo"}</span>
            {a && <StatusBadge status={a.status} />}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {a && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><span className="text-muted-foreground">Quem escreveu:</span> {PAPEL_ROTULO[a.solicitante_papel ?? ""] ?? "—"}</div>
              <div><span className="text-muted-foreground">Assunto:</span> {a.assunto ?? "—"} {a.sensivel && <Badge variant="outline" className="ml-1 text-[10px]">sensível</Badge>}</div>
              <div><span className="text-muted-foreground">Aberto:</span> {fmtData(a.aberto_em)}</div>
              <div><span className="text-muted-foreground">Na fila desde:</span> {fmtData(a.aguardando_desde)}</div>
              <div><span className="text-muted-foreground">1ª resposta da I.A:</span> {fmtData(a.primeira_resposta_ia_em)}</div>
              <div><span className="text-muted-foreground">1ª resposta humana:</span> {fmtData(a.primeira_resposta_humana_em)}</div>
              {a.motivo_encaminhamento && <div className="sm:col-span-2"><span className="text-muted-foreground">Encaminhado porque:</span> {rotuloMotivoEncaminhamento(a.motivo_encaminhamento)}</div>}
              {a.resumo && <div className="sm:col-span-2 rounded-md bg-muted p-2"><span className="font-semibold">Resumo:</span> {a.resumo}</div>}
              {a.resolucao && <div className="sm:col-span-2"><span className="text-muted-foreground">Resolução:</span> {a.resolucao}</div>}
            </div>

            <div>
              <p className="mb-1 font-semibold">Mensagens</p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {(det.mensagens ?? []).map((m: any) => (
                  <div key={m.id} className={`flex ${m.direcao === "entrada" ? "justify-start" : m.origem === "sistema" ? "justify-center" : "justify-end"}`}>
                    <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                      m.origem === "sistema" ? "bg-muted text-muted-foreground italic"
                      : m.direcao === "entrada" ? "bg-secondary" : m.origem === "bot" ? "bg-sky-100 dark:bg-sky-900/40" : "bg-violet-100 dark:bg-violet-900/40"}`}>
                      <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                        {m.direcao === "entrada" ? "Contato" : m.origem === "bot" ? <><Bot className="h-3 w-3" /> I.A</> : m.origem === "atendente" ? <><UserCheck className="h-3 w-3" /> {m.autor_nome ?? "Atendente"}</> : "Sistema"}
                        <span className="font-normal">· {fmtData(m.criada_em)}</span>
                      </div>
                      <div className="whitespace-pre-wrap">{m.texto}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {Array.isArray(det.consultas) && det.consultas.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 font-semibold"><ShieldCheck className="h-4 w-4" /> Consultas de dados neste protocolo</p>
                <ul className="space-y-1 text-xs">
                  {det.consultas.map((c: any) => (
                    <li key={c.id} className="flex flex-wrap gap-2">
                      <Badge variant={c.resultado === "autorizada" ? "secondary" : "destructive"} className="text-[10px]">{c.resultado}</Badge>
                      <span>{c.categoria}</span>
                      <span className="text-muted-foreground">“{c.alvo_termo || "próprio"}” — {MOTIVO_CONSULTA_ROTULO[c.motivo] ?? c.motivo}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {modo === "encaminhar" && (
              <Card className="space-y-2 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Setor</Label>
                    <Select value={setor} onValueChange={setSetor}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="(manter)" /></SelectTrigger>
                      <SelectContent>{(canal?.setores ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Responsável</Label>
                    <Select value={responsavel} onValueChange={setResponsavel}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Fila geral" /></SelectTrigger>
                      <SelectContent>{(responsaveis ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <Textarea placeholder="Observação para quem vai receber" value={texto} onChange={(e) => setTexto(e.target.value)} className="text-xs" />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
                  <Button size="sm" disabled={acao.isPending} onClick={() => acao.mutate({ acao: "encaminhar", responsavel: responsavel || null, setor: setor || null, texto })}>Encaminhar</Button>
                </div>
              </Card>
            )}
            {modo === "concluir" && (
              <Card className="space-y-2 p-3">
                <Label className="text-xs">Como foi resolvido (fica no protocolo)</Label>
                <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} className="text-xs" />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setModo(null)}>Cancelar</Button>
                  <Button size="sm" disabled={acao.isPending} onClick={() => acao.mutate({ acao: "concluir", texto })}>Concluir</Button>
                </div>
              </Card>
            )}
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {a && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/app/whatsapp?conversa=${a.conversa_id}`}><MessageCircle className="mr-1 h-4 w-4" /> Responder na Caixa de Entrada</Link>
            </Button>
          )}
          {pode && !modo && (
            <div className="flex flex-wrap gap-2">
              {a.status !== "em_atendimento_humano" && (
                <Button size="sm" disabled={acao.isPending} onClick={() => acao.mutate({ acao: "assumir" })}><Hand className="mr-1 h-4 w-4" /> Assumir</Button>
              )}
              {a.status !== "ia" && (
                <Button size="sm" variant="outline" disabled={acao.isPending} onClick={() => acao.mutate({ acao: "devolver_ia" })}><Undo2 className="mr-1 h-4 w-4" /> Devolver à I.A</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { setModo("encaminhar"); setTexto(""); }}><Forward className="mr-1 h-4 w-4" /> Encaminhar</Button>
              <Button size="sm" variant="secondary" onClick={() => { setModo("concluir"); setTexto(""); }}><CheckCircle2 className="mr-1 h-4 w-4" /> Concluir</Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------
function AbaFila({ onAbrir }: { onAbrir: (i: ItemFilaTela) => void }) {
  const { user } = useAuth();
  const [filtro, setFiltro] = useState<"abertos" | StatusAtendimento>("abertos");
  const [meus, setMeus] = useState(false);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["wa-atd-fila", "abertos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_atd_fila", { p_status: null });
      if (error) throw error;
      return (data ?? []) as ItemFilaTela[];
    },
  });
  const itens = useMemo(
    () => ordenarFila(filtrarFila(data ?? [], { status: filtro, meus: meus ? user?.id ?? null : null })),
    [data, filtro, meus, user?.id]);
  const aguardando = (data ?? []).filter((i) => i.status === "aguardando_humano").length;

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        {(["abertos", "aguardando_humano", "em_atendimento_humano", "ia"] as const).map((s) => (
          <Button key={s} size="sm" variant={filtro === s ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFiltro(s)}>
            {s === "abertos" ? "Todos abertos" : STATUS_ROTULO[s]}
            {s === "aguardando_humano" && aguardando > 0 && <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-[10px]">{aguardando}</Badge>}
          </Button>
        ))}
        <Button size="sm" variant={meus ? "default" : "outline"} className="h-8 text-xs" onClick={() => setMeus((v) => !v)}>
          <UserCheck className="mr-1 h-3.5 w-3.5" /> Só os meus
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto h-8 text-xs" onClick={() => refetch()}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </Card>
      <TabelaProtocolos itens={itens} onAbrir={onAbrir} />
    </div>
  );
}

function AbaProtocolos({ onAbrir }: { onAbrir: (i: ItemFilaTela) => void }) {
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hoje());
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["wa-atd-fila", "historico", de, ate, buscaAplicada],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_atd_fila", {
        p_status: ["ia", "aguardando_humano", "em_atendimento_humano", "concluido"], p_de: de, p_ate: ate,
        p_busca: buscaAplicada || null, p_limite: 500,
      });
      if (error) throw error;
      return (data ?? []) as ItemFilaTela[];
    },
  });
  const itens = useMemo(() => [...(data ?? [])].sort((a, b) => b.aberto_em.localeCompare(a.aberto_em)), [data]);
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div><Label className="mb-1 block text-xs">De</Label><Input type="date" className="h-8 w-40 text-xs" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><Label className="mb-1 block text-xs">Até</Label><Input type="date" className="h-8 w-40 text-xs" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca.trim()); }}>
          <div><Label className="mb-1 block text-xs">Protocolo, telefone, nome ou assunto</Label>
            <Input className="h-8 w-64 text-xs" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <Button type="submit" size="sm" className="h-8"><Search className="h-3.5 w-3.5" /></Button>
        </form>
      </Card>
      {isLoading ? <Card className="p-6 text-center text-sm text-muted-foreground">Carregando…</Card> : <TabelaProtocolos itens={itens} onAbrir={onAbrir} />}
    </div>
  );
}

function AbaIndicadores() {
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hoje());
  const { data: m, isLoading } = useQuery({
    queryKey: ["wa-atd-indicadores", de, ate],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_atd_indicadores", { p_de: de, p_ate: ate });
      if (error) throw error;
      return data as any;
    },
  });
  const dias = useMemo(() => (m?.por_dia ?? []).map((d: any) => ({ dia: d.dia.slice(8, 10) + "/" + d.dia.slice(5, 7), Total: d.total, "Resolvidos pela I.A": d.ia })), [m]);
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div><Label className="mb-1 block text-xs">De</Label><Input type="date" className="h-8 w-40 text-xs" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><Label className="mb-1 block text-xs">Até</Label><Input type="date" className="h-8 w-40 text-xs" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        <p className="ml-auto text-[11px] text-muted-foreground">Protocolos abertos no período. Pendências = situação agora.</p>
      </Card>
      {isLoading && <Card className="p-6 text-center text-sm text-muted-foreground">Carregando…</Card>}
      {m && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador icone={Inbox} rotulo="Atendimentos (protocolos)" valor={m.total} detalhe={`${m.concluidos} concluídos`} />
            <Indicador icone={Bot} rotulo="% resolvido pela I.A" valor={m.pct_resolvido_ia != null ? `${m.pct_resolvido_ia}%` : "—"} detalhe={`${m.resolvidos_ia} sem intervenção humana`} />
            <Indicador icone={AlertTriangle} rotulo="Pendências agora" valor={m.pendentes} detalhe={`${m.aguardando_humano} aguardando · maior espera ${formatarEspera(m.maior_espera_min ?? null)}`} />
            <Indicador icone={Clock} rotulo="Espera até um humano" valor={m.espera_humano_min != null ? formatarEspera(Math.round(m.espera_humano_min)) : "—"} detalhe={`I.A responde em ~${m.tempo_resposta_ia_seg ?? "—"} s`} />
            <Indicador icone={CheckCircle2} rotulo="Duração média" valor={m.duracao_media_min != null ? formatarEspera(Math.round(m.duracao_media_min)) : "—"} detalhe="da abertura à conclusão" />
            <Indicador icone={ShieldCheck} rotulo="Consultas autorizadas" valor={m.consultas_autorizadas} />
            <Indicador icone={ShieldAlert} rotulo="Consultas negadas" valor={m.consultas_negadas} detalhe="encaminhadas para validação humana" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <p className="mb-2 text-sm font-bold">Assuntos recorrentes</p>
              {(m.assuntos ?? []).length === 0 ? <p className="text-xs text-muted-foreground">Sem dados.</p> : (
                <ResponsiveContainer width="100%" height={Math.max(160, (m.assuntos.length) * 28)}>
                  <BarChart data={m.assuntos} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="assunto" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="total" name="Atendimentos" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-bold">Volume por dia</p>
              {dias.length === 0 ? <p className="text-xs text-muted-foreground">Sem dados.</p> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={dias}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Total" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Resolvidos pela I.A" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Por que foi para humano</p>
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {(m.motivos_encaminhamento ?? []).map((x: any) => (
                <li key={x.motivo} className="flex justify-between gap-2 rounded bg-muted px-2 py-1"><span>{rotuloMotivoEncaminhamento(x.motivo)}</span><b>{x.total}</b></li>
              ))}
              {!(m.motivos_encaminhamento ?? []).length && <li className="text-muted-foreground">Nenhum encaminhamento no período.</li>}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function AbaAuditoria() {
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hoje());
  const [so, setSo] = useState<"todas" | "negada" | "autorizada">("todas");
  const { data, isLoading } = useQuery({
    queryKey: ["wa-atd-auditoria", de, ate],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("wa_atd_auditoria", { p_de: de, p_ate: ate });
      if (error) throw error;
      return data as { consultas: any[]; acessos: any[] };
    },
  });
  const consultas = (data?.consultas ?? []).filter((c) => so === "todas" || c.resultado === so);
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div><Label className="mb-1 block text-xs">De</Label><Input type="date" className="h-8 w-40 text-xs" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><Label className="mb-1 block text-xs">Até</Label><Input type="date" className="h-8 w-40 text-xs" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        {(["todas", "negada", "autorizada"] as const).map((s) => (
          <Button key={s} size="sm" variant={so === s ? "default" : "outline"} className="h-8 text-xs" onClick={() => setSo(s)}>
            {s === "todas" ? "Todas" : s === "negada" ? "Negadas" : "Autorizadas"}
          </Button>
        ))}
        <p className="ml-auto text-[11px] text-muted-foreground">Abrir esta aba também fica registrado.</p>
      </Card>
      {isLoading && <Card className="p-6 text-center text-sm text-muted-foreground">Carregando…</Card>}
      <Card className="overflow-x-auto">
        <p className="p-3 pb-0 text-sm font-bold">Consultas de dados pelo WhatsApp</p>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Quando</TableHead><TableHead>Protocolo</TableHead><TableHead>Quem pediu</TableHead>
            <TableHead>O quê</TableHead><TableHead>De quem</TableHead><TableHead>Resultado</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {consultas.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap text-xs">{fmtData(c.criada_em)}</TableCell>
                <TableCell className="font-mono text-xs">{c.protocolo ?? "—"}</TableCell>
                <TableCell className="text-xs">{c.solicitante ?? "—"}<div className="text-muted-foreground">{PAPEL_ROTULO[c.papel] ?? c.papel}</div></TableCell>
                <TableCell className="text-xs">{c.categoria}</TableCell>
                <TableCell className="text-xs">{c.alvo ?? <span className="text-muted-foreground">“{c.alvo_termo ?? "—"}”</span>}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant={c.resultado === "autorizada" ? "secondary" : "destructive"} className="text-[10px]">{c.resultado}</Badge>
                  <div className="text-muted-foreground">{MOTIVO_CONSULTA_ROTULO[c.motivo] ?? c.motivo}</div>
                </TableCell>
              </TableRow>
            ))}
            {!consultas.length && <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground">Nenhuma consulta no período.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <Card className="overflow-x-auto">
        <p className="p-3 pb-0 text-sm font-bold">Acessos e alterações da equipe</p>
        <Table>
          <TableHeader><TableRow><TableHead>Quando</TableHead><TableHead>Quem</TableHead><TableHead>Ação</TableHead><TableHead>Protocolo</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data?.acessos ?? []).map((g) => (
              <TableRow key={g.id}>
                <TableCell className="whitespace-nowrap text-xs">{fmtData(g.criada_em)}</TableCell>
                <TableCell className="text-xs">{g.usuario ?? "—"}</TableCell>
                <TableCell className="text-xs">{g.acao}</TableCell>
                <TableCell className="font-mono text-xs">{g.protocolo ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

export default function WhatsAppAtendimento() {
  const { data: podeVer, isLoading } = useScreenAccess("whatsapp_atd_fila", "visualizar");
  const { data: podeAuditar } = useScreenAccess("whatsapp_atd_auditoria", "visualizar");
  const [sel, setSel] = useState<string | null>(null);

  const cabecalho = (
    <PageHeader title="Atendimento dos Supervisores" module="WhatsApp" breadcrumb={["WhatsApp", "Atendimento dos Supervisores"]}
      subtitle="Protocolos do canal corporativo dos supervisores: fila, histórico, indicadores e auditoria." />
  );
  if (isLoading) return <div>{cabecalho}</div>;
  if (!podeVer) {
    return (
      <div>
        {cabecalho}
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>WhatsApp — Atendimento Supervisores (fila e protocolos)</b>.
        </Card>
      </div>
    );
  }
  return (
    <div>
      {cabecalho}
      <Tabs defaultValue="fila">
        <TabsList className="mb-3 flex-wrap">
          <TabsTrigger value="fila">Fila de pendências</TabsTrigger>
          <TabsTrigger value="protocolos">Protocolos</TabsTrigger>
          <TabsTrigger value="indicadores">Indicadores</TabsTrigger>
          {podeAuditar && <TabsTrigger value="auditoria">Auditoria</TabsTrigger>}
        </TabsList>
        <TabsContent value="fila"><AbaFila onAbrir={(i) => setSel(i.id)} /></TabsContent>
        <TabsContent value="protocolos"><AbaProtocolos onAbrir={(i) => setSel(i.id)} /></TabsContent>
        <TabsContent value="indicadores"><AbaIndicadores /></TabsContent>
        {podeAuditar && <TabsContent value="auditoria"><AbaAuditoria /></TabsContent>}
      </Tabs>
      <DetalheProtocolo id={sel} aberto={!!sel} onFechar={() => setSel(null)} />
    </div>
  );
}
