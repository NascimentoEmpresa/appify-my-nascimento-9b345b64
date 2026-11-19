import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, ChevronUp, ClipboardCheck, FileText, Inbox, Loader2, Send, Upload } from "lucide-react";
import {
  BUCKET_MEDIDAS, COLS_EVENTO, COLS_ITEM, COLS_MEDIDA, ETAPA,
  type EventoFluxo, type ItemSupervisor, type Medida,
  caminhoArquivo, dataBr, dataHoraBr, etapaDaMedida, hojeSp, validarAplicacao,
} from "@/lib/comite-etica/encaminhamento";

// =====================================================================
// Jurídico › Advertências — os dois cards do fluxo do Comitê de Ética
// (SIS-2026-0957)
//
//   · "Recebidos da presidência" (Jurídico, menu fantasma
//     juridico_recebidos_presidencia): as medidas que a presidente aprovou,
//     com o resumo do parecer dela. Cada uma já abriu uma solicitação na
//     tabela de advertências (a mesma do Jurídico) — fica fora das abas
//     comuns por sigilo e aparece aqui. "Encaminhar ao supervisor do
//     contrato" (juridico_encaminhar_supervisor): o banco acha o supervisor
//     pelo Organograma Operacional; o Jurídico anexa o documento final e
//     escreve as orientações.
//   · "Recebido do jurídico" (supervisor, menu advertencias_recebido_juridico):
//     só o item do contrato dele — documento, orientações, nº da denúncia —,
//     nunca o conteúdo da denúncia (é o que a RLS de
//     COMITE_ETICA_MEDIDA_SUPERVISOR garante). "Registrar aplicação": data e
//     comprovante opcional.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

const TOM: Record<string, string> = {
  neutro: "border-border bg-muted text-muted-foreground",
  atencao: "border-amber-300 bg-amber-50 text-amber-700",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-700",
  erro: "border-red-300 bg-red-50 text-red-700",
};

async function abrirArquivo(path: string) {
  const { data, error } = await db.storage.from(BUCKET_MEDIDAS).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Arquivo indisponível.");
  window.open(data.signedUrl, "_blank", "noopener");
}

async function subirArquivo(medidaId: string, pasta: "documento" | "comprovante", arquivo: File): Promise<string> {
  const path = caminhoArquivo(medidaId, pasta, arquivo.name);
  const { error } = await db.storage.from(BUCKET_MEDIDAS).upload(path, arquivo, { upsert: false, contentType: arquivo.type || undefined });
  if (error) throw new Error(`Falha ao enviar o arquivo: ${error.message}`);
  return path;
}

function BotaoArquivo({ path, rotulo }: { path: string; rotulo: string }) {
  const { toast } = useToast();
  return (
    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
            onClick={() => abrirArquivo(path).catch((e) => toast({ title: "Não foi possível abrir", description: e.message, variant: "destructive" }))}>
      <FileText className="h-3.5 w-3.5" /> {rotulo}
    </Button>
  );
}

/** Moldura dos dois cards: título, contador do que pede ação, recolher. */
function Moldura({ id, titulo, desc, pendentes, abrirPorLink, icone, children }: {
  id: string; titulo: string; desc: string; pendentes: number; abrirPorLink: boolean;
  icone: React.ReactNode; children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(abrirPorLink || pendentes > 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (pendentes > 0) setAberto(true); }, [pendentes]);
  useEffect(() => { if (abrirPorLink) { setAberto(true); ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, [abrirPorLink]);
  return (
    <Card ref={ref} id={id} className="mb-4 border-primary/30 p-4">
      <button type="button" onClick={() => setAberto((v) => !v)} className="flex w-full items-start justify-between gap-2 text-left">
        <div>
          <p className="flex items-center gap-2 text-sm font-extrabold text-[#0f3171]">
            {icone} {titulo}
            {pendentes > 0 && <Badge className="bg-[#7c3aed] text-white hover:bg-[#7c3aed]">{pendentes}</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {aberto && <div className="mt-3">{children}</div>}
    </Card>
  );
}

// =====================================================================
// Recebidos da presidência (Jurídico)
// =====================================================================

interface AdvResumo { id: number; status: string; created_at: string }

export function RecebidosPresidencia({ podeEncaminhar, abrirPorLink }: { podeEncaminhar: boolean; abrirPorLink: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cetica-juridico"],
    queryFn: async () => {
      const { data: med, error: e1 } = await db.from("COMITE_ETICA_MEDIDA").select(COLS_MEDIDA)
        .eq("status", "aprovada").neq("medida", "nenhuma").order("decidido_em", { ascending: false }).limit(200);
      if (e1) throw e1;
      const medidas = (med ?? []) as Medida[];
      const ids = medidas.map((m) => m.id);
      const advIds = medidas.map((m) => m.advertencia_id).filter((x): x is number => x != null);
      const [it, ev, adv] = await Promise.all([
        ids.length ? db.from("COMITE_ETICA_MEDIDA_SUPERVISOR").select(COLS_ITEM).in("medida_id", ids).limit(200) : { data: [], error: null },
        ids.length ? db.from("COMITE_ETICA_MEDIDA_EVENTO").select(COLS_EVENTO).in("medida_id", ids).order("em").limit(1000) : { data: [], error: null },
        advIds.length ? db.from("SISTEMA_SOLICITACOES_ADVERTENCIA").select("id, status, created_at").in("id", advIds).limit(200) : { data: [], error: null },
      ]);
      const erro = it.error ?? ev.error ?? adv.error;
      if (erro) throw erro;
      return {
        medidas, itens: (it.data ?? []) as ItemSupervisor[], eventos: (ev.data ?? []) as EventoFluxo[],
        advs: (adv.data ?? []) as AdvResumo[],
      };
    },
  });
  const [encaminhar, setEncaminhar] = useState<Medida | null>(null);
  const [verResolvidos, setVerResolvidos] = useState(false);

  const itemDe = (id: string) => data?.itens.find((i) => i.medida_id === id) ?? null;
  const pendentes = (data?.medidas ?? []).filter((m) => !itemDe(m.id));
  const lista = verResolvidos ? data?.medidas ?? [] : pendentes;

  return (
    <Moldura id="card-presidencia" titulo="Recebidos da presidência" icone={<Inbox className="h-4 w-4" />}
             pendentes={pendentes.length} abrirPorLink={abrirPorLink}
             desc="Medidas do Comitê de Ética aprovadas pela presidente. Formalize a advertência (ou a diretriz) e encaminhe ao supervisor do contrato.">
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p>
        : error ? <p className="text-sm text-red-600">Não foi possível ler: {(error as Error).message}</p>
        : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs">
              <Button size="sm" variant={verResolvidos ? "outline" : "default"} className="h-7 text-xs" onClick={() => setVerResolvidos(false)}>
                A encaminhar ({pendentes.length})
              </Button>
              <Button size="sm" variant={verResolvidos ? "default" : "outline"} className="h-7 text-xs" onClick={() => setVerResolvidos(true)}>
                Todos ({data!.medidas.length})
              </Button>
            </div>
            {!lista.length && <p className="text-sm text-muted-foreground">Nada a encaminhar.</p>}
            {lista.map((m) => {
              const it = itemDe(m.id);
              const et = etapaDaMedida(m, it);
              const adv = data!.advs.find((a) => a.id === m.advertencia_id);
              const evs = data!.eventos.filter((e) => e.medida_id === m.id);
              return (
                <div key={m.id} className="rounded-lg border bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold">{m.medida_rotulo}{m.colaborador_nome ? ` — ${m.colaborador_nome}` : ""}</p>
                      <p className="text-xs text-muted-foreground">
                        Denúncia <b className="font-mono">{m.protocolo ?? "—"}</b>
                        {m.contrato_texto ? ` · Contrato: ${m.contrato_texto}` : ""}
                        {adv ? ` · Solicitação #${adv.id} (${adv.status})` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">Aprovada por {m.decidido_por_nome ?? "—"} em {dataHoraBr(m.decidido_em)}</p>
                    </div>
                    <Badge variant="outline" className={TOM[et.tom]}>{et.rotulo}</Badge>
                  </div>
                  {m.decisao_texto && <p className="mt-2 text-xs"><b>Observação da Presidência:</b> {m.decisao_texto}</p>}
                  <details className="mt-2 rounded-md bg-slate-50 p-2" open={!it}>
                    <summary className="cursor-pointer text-xs font-semibold text-[#0f3171]">
                      Resumo do parecer da Presidência{m.resumo_usou_ia ? " (redigido com I.A, revisado pela presidente)" : ""}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-xs">{m.resumo_juridico || "—"}</p>
                  </details>
                  {it && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Encaminhado a <b>{it.supervisor_nome}</b> ({it.contrato_nome ?? "—"}) em {dataHoraBr(it.encaminhado_em)} por {it.encaminhado_por_nome ?? "—"}</span>
                      {it.documento_path && <BotaoArquivo path={it.documento_path} rotulo={it.documento_nome ?? "Documento"} />}
                      {it.comprovante_path && <BotaoArquivo path={it.comprovante_path} rotulo="Comprovante" />}
                    </div>
                  )}
                  {evs.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">Histórico ({evs.length})</summary>
                      <div className="mt-1 space-y-1 border-l-2 pl-3">
                        {evs.map((e) => (
                          <p key={e.id} className="text-xs">
                            <b>{ETAPA[e.etapa]}:</b> {e.evento} <span className="text-muted-foreground">— {dataHoraBr(e.em)}{e.usuario_nome ? ` · ${e.usuario_nome}` : ""}</span>
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                  {!it && (
                    <div className="mt-2 flex justify-end">
                      {podeEncaminhar
                        ? <Button size="sm" className="gap-1.5 bg-[#7c3aed] hover:bg-[#6d28d9]" onClick={() => setEncaminhar(m)}>
                            <Send className="h-4 w-4" /> Encaminhar ao supervisor do contrato
                          </Button>
                        : <span className="text-xs text-muted-foreground">Sem a permissão "Encaminhar ao supervisor do contrato".</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {encaminhar && <EncaminharSupervisor medida={encaminhar} onFechar={() => setEncaminhar(null)} />}
    </Moldura>
  );
}

interface Destino { contrato_id: string | null; contrato_nome: string | null; supervisor_nome: string | null; supervisor_tem_login: boolean }
interface ContratoSup { contrato_id: string; contrato_nome: string; supervisor_nome: string }

function EncaminharSupervisor({ medida: m, onFechar }: { medida: Medida; onFechar: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [orientacoes, setOrientacoes] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [outro, setOutro] = useState<ContratoSup | null>(null);
  const [escolher, setEscolher] = useState(false);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);

  const { data: destino, isLoading } = useQuery({
    queryKey: ["cetica-destino", m.id],
    queryFn: async () => {
      const { data, error } = await db.rpc("cetica_juridico_destino", { _medida: m.id });
      if (error) throw error;
      return data as Destino;
    },
  });
  const { data: contratos = [] } = useQuery({
    queryKey: ["cetica-contratos-supervisor", busca],
    enabled: escolher,
    queryFn: async () => {
      const { data, error } = await db.rpc("cetica_contratos_com_supervisor", { _busca: busca || null });
      if (error) throw error;
      return (data ?? []) as ContratoSup[];
    },
  });

  const semDestino = !isLoading && (!destino?.contrato_id || !destino?.supervisor_nome || !destino?.supervisor_tem_login);
  useEffect(() => { if (semDestino) setEscolher(true); }, [semDestino]);

  const confirmar = async () => {
    if (!orientacoes.trim()) { toast({ title: "Escreva as orientações ao supervisor", variant: "destructive" }); return; }
    if (semDestino && !outro) { toast({ title: "Escolha o contrato", description: "O contrato da denúncia não tem supervisor identificado.", variant: "destructive" }); return; }
    setSalvando(true);
    try {
      const path = arquivo ? await subirArquivo(m.id, "documento", arquivo) : null;
      const { error } = await db.rpc("cetica_juridico_encaminhar", {
        _medida: m.id, _orientacoes: orientacoes.trim(), _documento_path: path, _documento_nome: arquivo?.name ?? null,
        _contrato: outro?.contrato_id ?? null,
      });
      if (error) throw new Error(error.message);
      toast({ title: "Encaminhado ao supervisor", description: outro ? outro.supervisor_nome : destino?.supervisor_nome ?? "" });
      qc.invalidateQueries({ queryKey: ["cetica-juridico"] });
      onFechar();
    } catch (e) {
      toast({ title: "Não foi possível encaminhar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader><DialogTitle>Encaminhar ao supervisor do contrato</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Denúncia <b className="font-mono">{m.protocolo}</b> · {m.medida_rotulo}{m.colaborador_nome ? ` · ${m.colaborador_nome}` : ""}
          </p>
          <div className="rounded-md border bg-slate-50 p-3 text-xs">
            {isLoading ? "Procurando o supervisor no Organograma Operacional…"
              : outro ? <>Contrato escolhido: <b>{outro.contrato_nome}</b> · supervisor <b>{outro.supervisor_nome}</b></>
              : destino?.contrato_id && destino.supervisor_nome
                ? <>Contrato da denúncia: <b>{destino.contrato_nome}</b> · supervisor <b>{destino.supervisor_nome}</b>
                    {!destino.supervisor_tem_login && <span className="text-red-600"> (sem login no ERP — escolha outro contrato ou cadastre o login)</span>}</>
                : destino?.contrato_id
                  ? <>O contrato <b>{destino.contrato_nome}</b> não tem supervisor no Organograma Operacional.</>
                  : <>Não foi possível identificar o contrato da denúncia{m.contrato_texto ? ` ("${m.contrato_texto}")` : ""}.</>}
            {!escolher && <button type="button" className="ml-2 underline" onClick={() => setEscolher(true)}>escolher outro contrato</button>}
          </div>
          {escolher && (
            <div className="space-y-1">
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar contrato com supervisor…" />
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {contratos.map((c) => (
                  <button key={c.contrato_id} type="button" onClick={() => setOutro(c)}
                          className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100 ${outro?.contrato_id === c.contrato_id ? "bg-slate-100 font-bold" : ""}`}>
                    {c.contrato_nome} <span className="text-muted-foreground">· {c.supervisor_nome}</span>
                  </button>
                ))}
                {!contratos.length && <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum contrato encontrado.</p>}
              </div>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs font-semibold">Documento final (advertência ou diretriz)</p>
            <Input type="file" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold">Orientações ao supervisor (obrigatório)</p>
            <Textarea rows={5} value={orientacoes} onChange={(e) => setOrientacoes(e.target.value)}
                      placeholder="Ex.: aplicar a advertência na presença de uma testemunha, colher a assinatura e anexar o comprovante." />
            <p className="text-[11px] text-muted-foreground">O supervisor vê só o documento, estas orientações e o nº da denúncia — nunca o conteúdo dela.</p>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
            <Button onClick={confirmar} disabled={salvando || isLoading} className="gap-1.5 bg-[#7c3aed] hover:bg-[#6d28d9]">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Encaminhar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// Recebido do jurídico (supervisor do contrato)
// =====================================================================

export function RecebidoJuridico({ tambemJuridico, abrirPorLink }: { tambemJuridico: boolean; abrirPorLink: boolean }) {
  const { user } = useAuth();
  const { data: itens = [], isLoading, error } = useQuery({
    queryKey: ["cetica-supervisor", tambemJuridico ? user?.id : null],
    enabled: !!user,
    queryFn: async () => {
      let q = db.from("COMITE_ETICA_MEDIDA_SUPERVISOR").select(COLS_ITEM).order("encaminhado_em", { ascending: false }).limit(200);
      // Quem também é do Jurídico lê todos pela RLS; aqui, só os dele.
      if (tambemJuridico && user) q = q.eq("supervisor_user_id", user.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ItemSupervisor[];
    },
  });
  const [registrar, setRegistrar] = useState<ItemSupervisor | null>(null);
  const pendentes = itens.filter((i) => i.status === "aguardando_aplicacao");

  return (
    <Moldura id="card-supervisor" titulo="Recebido do jurídico" icone={<ClipboardCheck className="h-4 w-4" />}
             pendentes={pendentes.length} abrirPorLink={abrirPorLink}
             desc="Medidas do Comitê de Ética para aplicar nos seus contratos. Aplique conforme as orientações e registre a aplicação.">
      {isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p>
        : error ? <p className="text-sm text-red-600">Não foi possível ler: {(error as Error).message}</p>
        : !itens.length ? <p className="text-sm text-muted-foreground">Nada recebido do Jurídico.</p>
        : (
          <div className="grid gap-3 md:grid-cols-2">
            {itens.map((i) => (
              <div key={i.id} className="rounded-lg border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{i.medida_rotulo}{i.colaborador_nome ? ` — ${i.colaborador_nome}` : ""}</p>
                    <p className="text-xs text-muted-foreground">
                      Contrato <b>{i.contrato_nome ?? "—"}</b> · Denúncia <span className="font-mono">{i.protocolo ?? "—"}</span>
                    </p>
                  </div>
                  <Badge variant="outline" className={TOM[i.status === "aplicada" ? "ok" : "atencao"]}>
                    {i.status === "aplicada" ? `Aplicada em ${dataBr(i.aplicada_em)}` : "Aguardando aplicação"}
                  </Badge>
                </div>
                <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs">
                  <p className="font-semibold text-[#0f3171]">Orientações do Jurídico</p>
                  <p className="whitespace-pre-wrap">{i.orientacoes}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {i.documento_path
                    ? <BotaoArquivo path={i.documento_path} rotulo={`Documento: ${i.documento_nome ?? "arquivo"}`} />
                    : <span className="text-xs text-muted-foreground">Sem documento anexo.</span>}
                  {i.comprovante_path && <BotaoArquivo path={i.comprovante_path} rotulo="Comprovante" />}
                </div>
                <div className="mt-2 space-y-0.5 border-l-2 pl-3 text-xs text-muted-foreground">
                  {i.aprovado_em && <p>Aprovada pela Presidência em {dataHoraBr(i.aprovado_em)}</p>}
                  <p>Encaminhada pelo Jurídico em {dataHoraBr(i.encaminhado_em)}{i.encaminhado_por_nome ? ` · ${i.encaminhado_por_nome}` : ""}</p>
                  {i.status === "aplicada" && <p>Aplicação registrada em {dataHoraBr(i.registrado_em)}{i.registrado_por_nome ? ` · ${i.registrado_por_nome}` : ""}{i.aplicacao_obs ? ` — ${i.aplicacao_obs}` : ""}</p>}
                </div>
                {i.status === "aguardando_aplicacao" && (
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" className="gap-1.5" onClick={() => setRegistrar(i)}>
                      <ClipboardCheck className="h-4 w-4" /> Registrar aplicação
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      {registrar && <RegistrarAplicacao item={registrar} onFechar={() => setRegistrar(null)} />}
    </Moldura>
  );
}

function RegistrarAplicacao({ item: i, onFechar }: { item: ItemSupervisor; onFechar: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [data, setData] = useState(hojeSp());
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const confirmar = async () => {
    const erro = validarAplicacao(data, hojeSp());
    if (erro) { toast({ title: erro, variant: "destructive" }); return; }
    setSalvando(true);
    try {
      const path = arquivo ? await subirArquivo(i.medida_id, "comprovante", arquivo) : null;
      const { error } = await db.rpc("cetica_supervisor_registrar_aplicacao", {
        _item: i.id, _data: data, _comprovante_path: path, _comprovante_nome: arquivo?.name ?? null, _obs: obs.trim() || null,
      });
      if (error) throw new Error(error.message);
      toast({ title: "Aplicação registrada", description: "O Comitê de Ética foi avisado." });
      qc.invalidateQueries({ queryKey: ["cetica-supervisor"] });
      onFechar();
    } catch (e) {
      toast({ title: "Não foi possível registrar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Registrar aplicação</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">{i.medida_rotulo}{i.colaborador_nome ? ` — ${i.colaborador_nome}` : ""} · {i.contrato_nome}</p>
          <div className="space-y-1">
            <p className="text-xs font-semibold">Data da aplicação</p>
            <Input type="date" value={data} max={hojeSp()} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-1 text-xs font-semibold"><Upload className="h-3.5 w-3.5" /> Comprovante (opcional)</p>
            <Input type="file" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold">Observação (opcional)</p>
            <Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: colaborador assinou a ciência." />
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
            <Button onClick={confirmar} disabled={salvando} className="gap-1.5">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
