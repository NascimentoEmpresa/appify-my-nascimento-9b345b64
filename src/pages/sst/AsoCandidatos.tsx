import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2, Clock, Loader2, MapPin, Search, Siren, Stethoscope, ThumbsDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { MapaPicker } from "@/components/sst/MapaPicker";
import { HistoricoCandidato } from "@/components/recrutamento/CandidatoInfo";
import { FichaAso } from "@/components/recrutamento/FichaAso";
import { FotoCrachaCandidato } from "@/components/recrutamento/AlertaUrgenteAdmissao";
import { cn } from "@/lib/utils";
import { COR_INICIO, inicioTrabalho } from "@/lib/recrutamento/inicioTrabalho";

// =====================================================================
// SST — ASO Admissão (fila do Recrutamento)
//
// Candidatos que o Recrutamento mandou para "SST + COMPRAS". SST e Compras
// correm em PARALELO; o SST agenda o exame e isso conclui a parte dele —
// quem leva à ADMISSÃO é o trigger rec_paralelo_admissao, quando o Compras
// também aprovar. Fonte: VW_RECRUTAMENTO_CANDIDATOS.
//
// 14/10/2026 (mig 20261014000045, Pablo: "deixa o painel de ASO admissão
// igual do ASO Demissional que tá legal" e "SST tem que conseguir marcar como
// VISTO igual do demissional"): a tela virou o mesmo formato do
// PainelDemissoes — indicadores, tabela, detalhe em diálogo — com os mesmos
// DOIS passos do SST: (1) "Solicitação recebida" grava o VISTO
// (sst_visto_em/por) e (2) agendar o exame. O visto também apaga o card de
// URGENTE (AlertaUrgenteAdmissao). Candidato antigo, sem visto, ainda pode ser
// agendado direto: o passo 1 é o que responde "o SST viu?", não uma trava.
// =====================================================================

const sb = supabase as unknown as SupabaseClient;
const ETAPAS_PARALELO = ["SST + COMPRAS", "EXAME SST"];

type Situacao = "A receber" | "A agendar" | "Agendado" | "Reprovado pelo SST" | "Fora da etapa";
const SITUACOES: Situacao[] = ["A receber", "A agendar", "Agendado", "Reprovado pelo SST", "Fora da etapa"];

interface Cand {
  candidato_id: number; vaga_id: number; nome: string; cpf: string | null; cargo: string | null; contrato: string | null;
  cidade: string | null; local_exato: string | null; etapa_processo: string; etapa_changed_at: string | null;
  sst_ok: boolean | null; sst_por: string | null; sst_em: string | null; sst_obs: string | null;
  sst_data_exame: string | null; sst_hora_exame: string | null; sst_local_exame: string | null; sst_maps_url: string | null;
  sst_agendado_em: string | null; sst_agendado_por: string | null; compras_ok: boolean | null;
  sst_visto_em: string | null; sst_visto_por: string | null; cracha_foto_path: string | null;
  /** Início no posto, informado pelo Recrutamento (mig 20261028001800). */
  data_inicio_trabalho?: string | null;
  urgente_sst: boolean | null; urgente_por: string | null; urgente_motivo: string | null; urgente_em: string | null;
  solicitante_nome: string | null;
}

function situacaoDe(c: Cand): Situacao {
  if (c.sst_ok === false) return "Reprovado pelo SST";
  if (c.sst_agendado_em || c.sst_ok === true) return "Agendado";
  if (!ETAPAS_PARALELO.includes(c.etapa_processo)) return "Fora da etapa";
  return c.sst_visto_em ? "A agendar" : "A receber";
}
const COR: Record<Situacao, string> = {
  "A receber": "border-cyan-300 bg-cyan-50 text-cyan-800",
  "A agendar": "border-sky-300 bg-sky-50 text-sky-800",
  "Agendado": "border-emerald-300 bg-emerald-50 text-emerald-800",
  "Reprovado pelo SST": "border-red-300 bg-red-50 text-red-800",
  "Fora da etapa": "border-slate-300 bg-slate-50 text-slate-700",
};

const fmtD = (s?: string | null) => (!s ? "—" : String(s).slice(0, 10).split("-").reverse().join("/"));
const fmtDH = (s?: string | null) => (!s ? "—" : new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));
const mapsHref = (c: Cand): string | null => {
  const url = String(c.sst_maps_url ?? "").trim();
  if (url) return url;
  const local = String(c.sst_local_exame ?? "").trim();
  return local ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(local)}` : null;
};

function Kpi({ titulo, valor, icone: Icone, cor }: { titulo: string; valor: number; icone: LucideIcon; cor: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", cor)}><Icone className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
          <p className="text-2xl font-bold leading-tight">{valor}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AsoCandidatos() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeAgir = can("alterar", undefined, "sst_aso");
  const nome = user?.user_metadata?.nome ?? user?.email ?? "";

  const [todas, setTodas] = useState<Cand[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [fSituacao, setFSituacao] = useState<string>("pendentes");
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [aberta, setAberta] = useState<Cand | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    // O que está na etapa paralela + o que o SST já tratou (para a consulta "Todos").
    const { data, error } = await sb.from("VW_RECRUTAMENTO_CANDIDATOS").select("*")
      .or('etapa_processo.eq."SST + COMPRAS",etapa_processo.eq."EXAME SST",sst_em.not.is.null,sst_agendado_em.not.is.null')
      .order("etapa_changed_at", { ascending: false }).limit(500);
    if (error) toast.error("Erro ao carregar: " + error.message);
    setTodas((data ?? []) as Cand[]);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Veio do card de urgente ou do sino: ?abrir=<candidato>.
  const [params, setParams] = useSearchParams();
  const abrirId = Number(params.get("abrir") ?? "");
  useEffect(() => {
    if (!abrirId || carregando) return;
    const alvo = todas.find((c) => Number(c.candidato_id) === abrirId);
    if (alvo) setAberta(alvo);
    else toast.info(`O candidato #${abrirId} não está nesta fila (pode já ter andado).`);
    const p = new URLSearchParams(params); p.delete("abrir"); setParams(p, { replace: true });
  }, [abrirId, carregando, todas, params, setParams]);

  const contar = (s: Situacao) => todas.filter((c) => situacaoDe(c) === s).length;
  const urgentes = todas.filter((c) => c.urgente_sst && (situacaoDe(c) === "A receber" || situacaoDe(c) === "A agendar")).length;

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todas
      .filter((c) => {
        const s = situacaoDe(c);
        if (fSituacao === "pendentes" ? !(s === "A receber" || s === "A agendar") : fSituacao !== "todos" && s !== fSituacao) return false;
        if (!passaNoFiltroContratos(c, "contrato", fContratos)) return false;
        if (!q) return true;
        return [c.nome, c.cpf, c.cargo, c.contrato, c.cidade, String(c.candidato_id)].some((v) => String(v ?? "").toLowerCase().includes(q));
      })
      // Urgente primeiro; depois quem chegou antes.
      .sort((a, b) => Number(!!b.urgente_sst) - Number(!!a.urgente_sst)
        || String(a.etapa_changed_at ?? "").localeCompare(String(b.etapa_changed_at ?? "")));
  }, [todas, busca, fSituacao, fContratos]);

  const logHist = async (c: Cand, evento: string, para: string, detalhe: string | null) => {
    try {
      await sb.from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: c.vaga_id, candidato_id: c.candidato_id, candidato_nome: c.nome, evento,
        de_status: "SST + COMPRAS", para_status: para, papel: "SST", usuario_nome: nome, usuario_email: user?.email ?? "", detalhe,
      });
    } catch { /* histórico é registro; não derruba a ação */ }
  };

  const salvar = async (c: Cand, patch: Record<string, unknown>, aviso: string, hist?: [string, string, string | null]) => {
    const { error } = await sb.from("WA_CURRICULOS").update(patch).eq("id", c.candidato_id);
    if (error) { toast.error("Erro ao salvar: " + error.message); return false; }
    if (hist) await logHist(c, ...hist);
    toast.success(aviso);
    setAberta(null);
    carregar();
    return true;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="ASO Admissão"
        subtitle="Receba a solicitação (visto) e agende o exame admissional — agendar conclui a parte do SST. O candidato segue para a Admissão quando o Compras também aprovar."
        module="SST"
        breadcrumb={["ASO Admissão"]}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="A receber" valor={contar("A receber")} icone={Clock} cor="bg-cyan-100 text-cyan-700" />
        <Kpi titulo="A agendar" valor={contar("A agendar")} icone={Stethoscope} cor="bg-sky-100 text-sky-700" />
        <Kpi titulo="Agendados" valor={contar("Agendado")} icone={CheckCircle2} cor="bg-emerald-100 text-emerald-700" />
        <Kpi titulo="Urgentes" valor={urgentes} icone={Siren} cor={urgentes ? "bg-red-600 text-white" : "bg-red-100 text-red-700"} />
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Solicitações</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <FiltroContratos linhas={todas} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="w-56 pl-8" placeholder="Candidato, CPF, cargo, contrato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Select value={fSituacao} onValueChange={setFSituacao}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendentes">Pendentes</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
                {SITUACOES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={carregar} disabled={carregando}>
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtradas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {todas.length === 0 ? "Nenhum candidato enviado ao SST ainda." : fSituacao === "pendentes" ? "Nenhum candidato aguardando o SST." : "Nada bate com o filtro atual."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Candidato</TableHead>
                    <TableHead className="hidden md:table-cell">Contrato</TableHead>
                    <TableHead>Início no posto</TableHead>
                    <TableHead className="hidden lg:table-cell">Exame</TableHead>
                    <TableHead className="hidden sm:table-cell">Chegou em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((c) => {
                    const s = situacaoDe(c);
                    const agir = podeAgir && (s === "A receber" || s === "A agendar");
                    return (
                      <TableRow key={c.candidato_id} className={cn("cursor-pointer", c.urgente_sst && agir && "bg-red-50/60")} onClick={() => setAberta(c)}>
                        <TableCell className="text-muted-foreground">{c.candidato_id}</TableCell>
                        <TableCell>
                          <div className="font-medium">{c.nome}</div>
                          <div className="text-xs text-muted-foreground">{c.cargo || "—"}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{c.contrato || "—"}</TableCell>
                        <TableCell><InicioNoPosto iso={c.data_inicio_trabalho} /></TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {c.sst_data_exame ? `${fmtD(c.sst_data_exame)}${c.sst_hora_exame ? ` ${c.sst_hora_exame}` : ""}` : "—"}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{fmtD(c.etapa_changed_at)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={COR[s]}>{s}</Badge>
                            {c.urgente_sst && (s === "A receber" || s === "A agendar") && (
                              <Badge className="bg-red-600 text-white hover:bg-red-600"><Siren className="mr-1 h-3 w-3" /> Urgente</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setAberta(c); }}>{agir ? "Analisar" : "Ver"}</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DetalheCandidato cand={aberta} podeAgir={podeAgir} nome={nome} onFechar={() => setAberta(null)} onSalvar={salvar} />
    </div>
  );
}

/** Data em que começa a trabalhar (mig 20261028001800): na lista, curta; no detalhe, em faixa. */
function InicioNoPosto({ iso, destaque }: { iso?: string | null; destaque?: boolean }) {
  const ini = inicioTrabalho(iso);
  if (!ini) return destaque ? null : <span className="text-muted-foreground">—</span>;
  const cor = COR_INICIO[ini.tom];
  if (!destaque) {
    return (
      <div>
        <div className="font-medium" style={{ color: cor.cor }}>{ini.curta}</div>
        <div className="text-xs" style={{ color: cor.cor }}>{ini.prazo}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border px-3 py-2 text-sm" style={{ color: cor.cor, background: cor.fundo, borderColor: cor.borda }}>
      📅 <b>Começa a trabalhar em {ini.data}</b> — {ini.prazo}
    </div>
  );
}

// ── Detalhe + os dois passos do SST ───────────────────────────────────
function DetalheCandidato({ cand: c, podeAgir, nome, onFechar, onSalvar }: {
  cand: Cand | null; podeAgir: boolean; nome: string; onFechar: () => void;
  onSalvar: (c: Cand, patch: Record<string, unknown>, aviso: string, hist?: [string, string, string | null]) => Promise<boolean>;
}) {
  const [ag, setAg] = useState({ data: "", hora: "", local: "", maps: "" });
  const [mapPrev, setMapPrev] = useState("");
  const [obs, setObs] = useState("");
  const [reprovando, setReprovando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!c) return;
    const local = c.sst_local_exame || c.local_exato || c.cidade || "";
    setAg({ data: c.sst_data_exame || "", hora: c.sst_hora_exame || "", local, maps: c.sst_maps_url || "" });
    setMapPrev(local); setObs(""); setReprovando(false);
  }, [c]);

  if (!c) return null;
  const s = situacaoDe(c);
  const naEtapa = ETAPAS_PARALELO.includes(c.etapa_processo);

  /** PASSO 1 — o VISTO: responde "o SST viu meu pedido?" e apaga o card de urgente. */
  const receber = async () => {
    setSalvando(true);
    await onSalvar(c, { sst_visto_em: new Date().toISOString(), sst_visto_por: nome },
      `Solicitação de ${c.nome.split(" ")[0]} marcada como recebida pelo SST.`,
      ["Solicitação de ASO admissional recebida pelo SST (visto)", "SST + COMPRAS", null]);
    setSalvando(false);
  };

  /** PASSO 2 — agendar conclui a parte do SST (sst_ok). Recebe junto, se faltava o visto. */
  const agendar = async () => {
    if (!ag.data) { toast.error("Informe a data do exame."); return; }
    setSalvando(true);
    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = {
      sst_data_exame: ag.data, sst_hora_exame: ag.hora.trim() || null, sst_local_exame: ag.local.trim() || null,
      sst_maps_url: ag.maps.trim() || null, sst_agendado_por: nome, sst_agendado_em: agora,
      sst_ok: true, sst_por: nome, sst_em: agora,
      ...(c.sst_visto_em ? {} : { sst_visto_em: agora, sst_visto_por: nome }),
    };
    await onSalvar(c, patch,
      c.compras_ok === true ? "Exame agendado — candidato liberado para a Admissão." : "Exame agendado — SST concluído, aguardando o Compras.",
      ["Exame agendado — SST aprovado", "SST + COMPRAS", `${fmtD(ag.data)} ${ag.hora} · ${ag.local}`.trim()]);
    setSalvando(false);
  };

  const reprovar = async () => {
    if (!obs.trim()) { toast.error("Informe o motivo."); return; }
    setSalvando(true);
    const agora = new Date().toISOString();
    await onSalvar(c, { etapa_processo: "Reprovado", etapa_changed_at: agora, sst_ok: false, sst_por: nome, sst_em: agora, motivo_reprovacao: obs.trim() },
      "Candidato reprovado.", ["Candidato reprovado", "Reprovado", obs.trim()]);
    setSalvando(false);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {c.nome}
            <Badge variant="outline" className={COR[s]}>{s}</Badge>
            {c.urgente_sst && (s === "A receber" || s === "A agendar") && (
              <Badge className="bg-red-600 text-white hover:bg-red-600"><Siren className="mr-1 h-3 w-3" /> Urgente</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <InicioNoPosto iso={c.data_inicio_trabalho} destaque />
          {c.urgente_sst && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              🚨 Marcado como <b>urgente</b>{c.urgente_por ? ` por ${c.urgente_por}` : ""}{c.urgente_em ? ` em ${fmtDH(c.urgente_em)}` : ""}{c.urgente_motivo ? ` — ${c.urgente_motivo}` : ""}.
            </div>
          )}

          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1"><FichaAso candidatoId={c.candidato_id} /></div>
            <FotoCrachaCandidato caminho={c.cracha_foto_path} tamanho={72} />
          </div>

          {c.sst_visto_em && (
            <p className="text-xs text-muted-foreground">👁 Recebida por {c.sst_visto_por || "—"} em {fmtDH(c.sst_visto_em)}</p>
          )}
          {c.sst_agendado_em && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              🗓 <b>Exame agendado:</b> {fmtD(c.sst_data_exame)}{c.sst_hora_exame ? ` às ${c.sst_hora_exame}` : ""}{c.sst_local_exame ? ` · ${c.sst_local_exame}` : ""}
              {mapsHref(c) && <> · <a href={mapsHref(c)!} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 underline"><MapPin className="mr-0.5 inline h-3.5 w-3.5" />Ver no mapa</a></>}
              <span className="block text-xs text-emerald-700">por {c.sst_agendado_por || "—"} em {fmtDH(c.sst_agendado_em)}</span>
            </div>
          )}

          {/* PASSO 1 — receber (visto). Igual ao ASO demissional. */}
          {podeAgir && naEtapa && s === "A receber" && !reprovando && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <h3 className="text-sm font-semibold">Receber a solicitação</h3>
              <p className="text-sm text-muted-foreground">
                Confirme que o pedido de ASO admissional chegou ao SST. O Recrutamento passa a ver que vocês viram, e o card de urgente some.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={receber} disabled={salvando}><Stethoscope className="mr-2 h-4 w-4" /> Solicitação recebida</Button>
                <Button variant="outline" onClick={() => setReprovando(true)} disabled={salvando}><ThumbsDown className="mr-2 h-4 w-4" /> Reprovar</Button>
              </div>
            </div>
          )}

          {/* PASSO 2 — agendar: os mesmos campos do ASO demissional, inclusive o mapa. */}
          {podeAgir && naEtapa && (s === "A agendar" || s === "Agendado") && c.sst_ok !== false && !reprovando && (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <h3 className="text-sm font-semibold">{s === "Agendado" ? "Reagendar o exame admissional" : "Agendar o exame admissional"}</h3>
              <p className="text-sm text-muted-foreground">Informe data, hora e local do exame. Agendar <strong>conclui</strong> a parte do SST.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Data *</Label><Input type="date" value={ag.data} onChange={(e) => setAg((x) => ({ ...x, data: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Horário</Label><Input value={ag.hora} placeholder="Ex.: 09:00" onChange={(e) => setAg((x) => ({ ...x, hora: e.target.value }))} /></div>
              </div>
              <div className="space-y-1.5">
                <Label>Local do exame</Label>
                <Input value={ag.local} placeholder="Clínica / endereço" onChange={(e) => setAg((x) => ({ ...x, local: e.target.value }))} onBlur={() => setMapPrev(ag.local.trim())} />
              </div>
              <div className="space-y-1.5">
                <Label>Local exato no Google Maps (opcional)</Label>
                <div className="flex gap-2">
                  <Input value={ag.maps} placeholder="Cole aqui o link do Maps (Compartilhar → Copiar link)" onChange={(e) => setAg((x) => ({ ...x, maps: e.target.value }))} />
                  <Button variant="outline" asChild>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ag.local.trim() || "clínica ocupacional")}`} target="_blank" rel="noopener noreferrer">Buscar no Maps</a>
                  </Button>
                </div>
              </div>
              <MapaPicker busca={mapPrev} onPick={({ nome: n, url }) => setAg((x) => ({ ...x, maps: url, local: n || x.local }))} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={agendar} disabled={salvando}><CheckCircle2 className="mr-2 h-4 w-4" /> {s === "Agendado" ? "Salvar novo agendamento" : "Agendar e concluir"}</Button>
                {s !== "Agendado" && <Button variant="outline" onClick={() => setReprovando(true)} disabled={salvando}><ThumbsDown className="mr-2 h-4 w-4" /> Reprovar</Button>}
              </div>
            </div>
          )}

          {reprovando && (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="text-sm font-semibold text-red-800">Reprovar o candidato</h3>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Descreva o motivo…" rows={3} />
              <div className="flex gap-2">
                <Button variant="destructive" onClick={reprovar} disabled={salvando}>Confirmar reprovação</Button>
                <Button variant="outline" onClick={() => setReprovando(false)} disabled={salvando}>Voltar</Button>
              </div>
            </div>
          )}

          <div className="flex justify-end"><HistoricoCandidato candidatoId={c.candidato_id} nome={c.nome} /></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
