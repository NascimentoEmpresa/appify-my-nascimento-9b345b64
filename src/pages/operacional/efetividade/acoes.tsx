// =====================================================================
// Efetividade e Coberturas — ações sobre uma ausência: registrar, acionar
// substituto (diarista do banco ou colaborador remanejado), andar com a
// cobertura, ver a linha do tempo; e o banco de diaristas.
// Toda escrita vai pelas RPCs ope_efet_* (mig 20261008000030), que exigem
// a ação "alterar" no menu ope_efetividade.
// =====================================================================
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AlertTriangle, Ban, Car, CheckCircle2, Clock, Loader2, Phone, Plus, Search, UserCheck, UserPlus, Users, XCircle,
} from "lucide-react";
import { useEfetAcoes, useEfetDiaristas, useEfetEventos, usePodeAlterarEfetividade, type NovaOcorrencia } from "@/hooks/useEfetividade";
import {
  chaveContrato, fmtDataBR, fmtDuracao, fmtHoraTs, fmtMin, linkWhatsapp, tempoSemCobertura, ROTULO_MOTIVO, ROTULO_TURNO,
  type ColaboradorPrep, type ContratoEfet, type Diarista, type LinhaDia, type MotivoOcorrencia, type Ocorrencia, type StatusCobertura,
} from "@/lib/efetividade";
import { BadgeStatus } from "./shared";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A ocorrência que nasce de uma linha do dia (falta detectada pelo ponto). */
export function novaDeLinha(l: LinhaDia, data: string, sincAte: string | null): NovaOcorrencia {
  const c = l.p.c;
  const motivo: MotivoOcorrencia = l.dia.situacao === "atestado" ? "atestado" : l.dia.situacao === "afastamento" ? "afastamento"
    : l.dia.situacao === "ferias" ? "ferias" : "falta";
  return {
    data, empresa: c.empresa, filial: c.filial, contrato: c.contrato, posto_codigo: c.posto_codigo, posto_nome: c.posto_nome,
    turno: ROTULO_TURNO[l.p.turno], horario_previsto: l.p.jornada.inicio, empregado_id: c.id, empregado_nome: c.nome,
    motivo, origem: sincAte && data <= sincAte ? "ponto" : "manual",
  };
}

// ---- Acionar substituto ---------------------------------------------------------

export function AcionarDialog({
  open, onOpenChange, linha, ocorrencia, data, sincAte, candidatos,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  linha: LinhaDia | null; ocorrencia: Ocorrencia | null; data: string; sincAte: string | null;
  /** Colaboradores do mesmo contrato que podem ser remanejados (de folga ou presentes). */
  candidatos: LinhaDia[];
}) {
  const { toast } = useToast();
  const { acionar, garantirOcorrencia } = useEfetAcoes();
  const { data: diaristas = [], isLoading } = useEfetDiaristas();
  const [aba, setAba] = useState<"diarista" | "colaborador" | "outro">("diarista");
  const [busca, setBusca] = useState("");
  const [colab, setColab] = useState("");
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  const titulo = linha?.p.c.nome ?? ocorrencia?.empregado_nome ?? ocorrencia?.posto_nome ?? "";
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return diaristas.filter((d) => !q || d.nome.toLowerCase().includes(q) || (d.cidade ?? "").toLowerCase().includes(q) || (d.regioes ?? "").toLowerCase().includes(q));
  }, [diaristas, busca]);
  const opcColab = useMemo(() => candidatos
    .filter((l) => l.p.c.id !== linha?.p.c.id)
    .sort((a, b) => (a.dia.situacao === "folga" ? 0 : 1) - (b.dia.situacao === "folga" ? 0 : 1) || a.p.c.nome.localeCompare(b.p.c.nome, "pt-BR"))
    .map((l) => ({ value: String(l.p.c.id), label: l.p.c.nome, hint: `${l.dia.situacao === "folga" ? "de folga" : l.dia.situacao} · ${l.p.c.posto_nome}` })),
  [candidatos, linha]);

  const confirmar = async (tipo: "diarista" | "colaborador", extra: { diaristaId?: number; empregadoId?: number; nome?: string; telefone?: string }) => {
    setSalvando(true);
    try {
      const nova = linha ? novaDeLinha(linha, data, sincAte) : null;
      if (!ocorrencia && !nova) throw new Error("Nada para cobrir.");
      const id = await garantirOcorrencia(ocorrencia, nova!);
      await acionar.mutateAsync({ id, tipo, observacao: obs || null, ...extra });
      toast({ title: "Substituto acionado", description: `${extra.nome ?? "Substituto"} — acompanhe em Faltas e Coberturas.` });
      onOpenChange(false);
      setObs(""); setBusca(""); setColab(""); setNome(""); setTel("");
    } catch (e) {
      toast({ title: "Não foi possível acionar", description: msg(e), variant: "destructive" });
    } finally { setSalvando(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Acionar substituto</DialogTitle>
          <DialogDescription>
            Cobrir <b>{titulo}</b>{(linha?.p.c.posto_nome ?? ocorrencia?.posto_nome) && <> no posto <b>{linha?.p.c.posto_nome ?? ocorrencia?.posto_nome}</b></>} em {fmtDataBR(data)}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {([["diarista", "Diarista", Users], ["colaborador", "Colaborador do contrato", UserCheck], ["outro", "Outra pessoa", UserPlus]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => setAba(k)}
              className={cn("flex items-center justify-center gap-2 rounded-md border px-2 py-2 text-xs font-semibold", aba === k ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
              <I className="h-4 w-4" />{l}
            </button>
          ))}
        </div>

        {aba === "diarista" && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar por nome, cidade ou região…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              {isLoading && <p className="p-4 text-center text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Carregando…</p>}
              {!isLoading && !lista.length && <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma diarista. Cadastre em “Diaristas”.</p>}
              {lista.map((d) => (
                <div key={d.id} className={cn("flex items-center gap-3 border-b px-3 py-2 last:border-0", !d.disponivel && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.nome}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.telefone || "sem telefone"}{d.cidade ? ` · ${d.cidade}` : ""}{d.regioes ? ` · ${d.regioes}` : ""}
                      {` · ${d.confirmados + d.diarias} cobertura(s)`}
                    </p>
                  </div>
                  {d.em_aberto > 0 && <span className="rounded bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">acionada</span>}
                  {!d.disponivel && <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold">indisponível</span>}
                  {linkWhatsapp(d.telefone) && (
                    <a href={linkWhatsapp(d.telefone)!} target="_blank" rel="noreferrer" className="text-xs font-semibold text-success hover:underline">WhatsApp</a>
                  )}
                  <Button size="sm" disabled={salvando} onClick={() => confirmar("diarista", { diaristaId: d.id, nome: d.nome, telefone: d.telefone ?? undefined })}>
                    Acionar
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {aba === "colaborador" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Remanejar alguém do mesmo contrato — quem está de folga aparece primeiro.</p>
            <SearchableSelect value={colab} onChange={setColab} options={opcColab} placeholder="Escolha o colaborador" searchPlaceholder="Buscar…" />
            <Button className="w-full" disabled={!colab || salvando} onClick={() => {
              const l = candidatos.find((x) => String(x.p.c.id) === colab);
              confirmar("colaborador", { empregadoId: Number(colab), nome: l?.p.c.nome, telefone: l?.p.c.telefone ?? undefined });
            }}>Acionar colaborador</Button>
          </div>
        )}

        {aba === "outro" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            <Input placeholder="Telefone" value={tel} onChange={(e) => setTel(e.target.value)} />
            <Button className="sm:col-span-2" disabled={!nome.trim() || salvando} onClick={() => confirmar("diarista", { nome: nome.trim(), telefone: tel.trim() || undefined })}>
              Acionar
            </Button>
          </div>
        )}

        <Textarea rows={2} placeholder="Observação (opcional) — ex.: combinado chegar às 08:00" value={obs} onChange={(e) => setObs(e.target.value)} />
      </DialogContent>
    </Dialog>
  );
}

// ---- Registrar falta (avisada, sem esperar o ponto) -----------------------------

export function RegistrarFaltaDialog({
  open, onOpenChange, contratos, preps, data, contratoInicial,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; contratos: ContratoEfet[]; preps: ColaboradorPrep[];
  data: string; contratoInicial?: string | null;
}) {
  const { toast } = useToast();
  const { registrar } = useEfetAcoes();
  const [dia, setDia] = useState(data);
  const [contrato, setContrato] = useState(contratoInicial ?? "");
  const [colab, setColab] = useState("");
  const [motivo, setMotivo] = useState<MotivoOcorrencia>("falta");
  const [obs, setObs] = useState("");

  const opcContratos = useMemo(() => contratos.map((c) => ({ value: chaveContrato(c.empresa, c.filial), label: c.nome })), [contratos]);
  const doContrato = useMemo(() => preps.filter((p) => chaveContrato(p.c.empresa, p.c.filial) === contrato), [preps, contrato]);
  const opcColab = useMemo(() => doContrato.map((p) => ({ value: String(p.c.id), label: p.c.nome, hint: `${p.c.posto_nome} · ${ROTULO_TURNO[p.turno]}` })), [doContrato]);

  const salvar = async () => {
    const p = doContrato.find((x) => String(x.c.id) === colab);
    if (!p) { toast({ title: "Escolha o colaborador", variant: "destructive" }); return; }
    try {
      await registrar.mutateAsync({
        data: dia, empresa: p.c.empresa, filial: p.c.filial, contrato: p.c.contrato, posto_codigo: p.c.posto_codigo,
        posto_nome: p.c.posto_nome, turno: ROTULO_TURNO[p.turno], horario_previsto: p.jornada.inicio,
        empregado_id: p.c.id, empregado_nome: p.c.nome, motivo, origem: "manual", observacao: obs || null,
      });
      toast({ title: "Falta registrada", description: `${p.c.nome} — agora é só acionar o substituto.` });
      onOpenChange(false); setColab(""); setObs("");
    } catch (e) {
      toast({ title: "Não foi possível registrar", description: msg(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar falta</DialogTitle>
          <DialogDescription>Para a falta avisada antes de o ponto chegar (o espelho da Senior é diário).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1 text-xs font-semibold">Data<Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></label>
          <div className="space-y-1 text-xs font-semibold">Contrato
            <SearchableSelect value={contrato} onChange={(v) => { setContrato(v); setColab(""); }} options={opcContratos} placeholder="Escolha o contrato" searchPlaceholder="Buscar…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Colaborador
            <SearchableSelect value={colab} onChange={setColab} options={opcColab} disabled={!contrato} placeholder="Quem faltou" searchPlaceholder="Buscar…" />
          </div>
          <div className="space-y-1 text-xs font-semibold">Motivo
            <div className="flex flex-wrap gap-2">
              {(["falta", "atestado", "afastamento", "outros"] as MotivoOcorrencia[]).map((m) => (
                <button key={m} onClick={() => setMotivo(m)} className={cn("rounded-md border px-3 py-1 text-xs font-semibold", motivo === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
                  {ROTULO_MOTIVO[m]}
                </button>
              ))}
            </div>
          </div>
          <Textarea rows={2} placeholder="Observação — ex.: avisou pelo WhatsApp às 06:40" value={obs} onChange={(e) => setObs(e.target.value)} />
          <Button className="w-full" onClick={salvar} disabled={registrar.isPending}>
            {registrar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Registrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Detalhe da ocorrência + linha do tempo -------------------------------------

const PASSOS: { status: StatusCobertura; rotulo: string; icon: typeof Users; campo: keyof Ocorrencia }[] = [
  { status: "sem_cobertura", rotulo: "Falta identificada", icon: AlertTriangle, campo: "created_at" },
  { status: "acionado", rotulo: "Substituto acionado", icon: Phone, campo: "acionado_em" },
  { status: "aceita", rotulo: "Cobertura aceita", icon: UserCheck, campo: "aceito_em" },
  { status: "em_deslocamento", rotulo: "Em deslocamento", icon: Car, campo: "deslocamento_em" },
  { status: "aguardando_ponto", rotulo: "No posto", icon: Clock, campo: "chegada_em" },
  { status: "ponto_confirmado", rotulo: "Ponto confirmado", icon: CheckCircle2, campo: "ponto_em" },
];

/** A régua de 6 etapas (horizontal no Detalhamento, vertical na lateral). */
export function LinhaDoTempo({ o, vertical = false }: { o: Ocorrencia; vertical?: boolean }) {
  return (
    <ol className={cn(vertical ? "space-y-3" : "grid grid-cols-3 gap-3 md:grid-cols-6")}>
      {PASSOS.map((p, i) => {
        const ts = o[p.campo] as string | null;
        const feito = !!ts;
        const I = p.icon;
        return (
          <li key={p.status} className={cn("flex gap-2", vertical ? "items-start" : "flex-col items-center text-center")}>
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2",
              feito ? (i === 0 ? "border-destructive bg-destructive text-destructive-foreground" : i === PASSOS.length - 1 ? "border-success bg-success text-success-foreground" : "border-primary bg-primary text-primary-foreground")
                : "border-dashed border-muted-foreground/40 text-muted-foreground/50")}>
              <I className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className={cn("text-xs font-bold", !feito && "text-muted-foreground")}>{p.rotulo}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{feito ? fmtHoraTs(ts) : "—"}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PainelOcorrencia({ o, onAcionar, compacto = false }: { o: Ocorrencia; onAcionar: () => void; compacto?: boolean }) {
  const { toast } = useToast();
  const pode = usePodeAlterarEfetividade();
  const { status } = useEfetAcoes();
  const { data: eventos = [], isLoading } = useEfetEventos(o.id);
  const espera = tempoSemCobertura(o.data, o.horario_previsto, o);

  const mudar = async (s: StatusCobertura) => {
    try { await status.mutateAsync({ id: o.id, status: s }); }
    catch (e) { toast({ title: "Não foi possível atualizar", description: msg(e), variant: "destructive" }); }
  };
  const proximo: Partial<Record<StatusCobertura, { s: StatusCobertura; rotulo: string }>> = {
    acionado: { s: "aceita", rotulo: "Confirmar aceite" },
    aceita: { s: "em_deslocamento", rotulo: "A caminho" },
    em_deslocamento: { s: "aguardando_ponto", rotulo: "Chegou no posto" },
    aguardando_ponto: { s: "ponto_confirmado", rotulo: "Confirmar ponto" },
  };
  const prox = proximo[o.status];
  const aberto = !["ponto_confirmado", "nao_se_aplica", "cancelada"].includes(o.status);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Campo r="Colaborador previsto" v={o.empregado_nome} />
        <Campo r="Contrato" v={o.contrato} />
        <Campo r="Posto" v={o.posto_nome} />
        <Campo r="Turno" v={[o.turno, o.horario_previsto != null ? fmtMin(o.horario_previsto) : null].filter(Boolean).join(" · ")} />
        <Campo r="Motivo" v={ROTULO_MOTIVO[o.motivo]} destaque />
        <Campo r="Status" v={<BadgeStatus s={o.status} />} />
        <Campo r="Substituto" v={o.substituto_nome ? `${o.substituto_nome}${o.substituto_tipo === "colaborador" ? " (colaborador)" : " (diarista)"}` : "—"} />
        <Campo r="Tempo sem cobertura" v={espera == null ? (aberto ? "dia encerrado" : "—") : fmtDuracao(espera)} destaque={espera != null && espera > 60} />
      </div>

      {pode && (
        <div className="flex flex-wrap gap-2">
          {prox && <Button size="sm" className="gap-1 bg-success text-success-foreground hover:bg-success/90" disabled={status.isPending} onClick={() => mudar(prox.s)}><CheckCircle2 className="h-4 w-4" />{prox.rotulo}</Button>}
          {aberto && <Button size="sm" variant="outline" className="gap-1" onClick={onAcionar}><Phone className="h-4 w-4" />{o.substituto_nome ? "Trocar substituto" : "Acionar substituto"}</Button>}
          {o.substituto_nome && aberto && <Button size="sm" variant="outline" className="gap-1 text-destructive" disabled={status.isPending} onClick={() => mudar("nao_realizada")}><XCircle className="h-4 w-4" />Não realizada</Button>}
          {aberto && <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" disabled={status.isPending} onClick={() => mudar("nao_se_aplica")}><Ban className="h-4 w-4" />Sem necessidade</Button>}
          {!aberto && <Button size="sm" variant="ghost" className="gap-1" disabled={status.isPending} onClick={() => mudar("sem_cobertura")}>Reabrir</Button>}
          {o.substituto_tipo === "diarista" && o.status === "ponto_confirmado" && (
            <Button size="sm" variant="outline" asChild><Link to="/app/operacional/diarias">Lançar diária</Link></Button>
          )}
        </div>
      )}

      {!compacto && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Linha do tempo</p>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <ol className="relative space-y-3 border-l pl-4">
              {eventos.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-background bg-primary" />
                  <p className="text-xs font-bold tabular-nums text-primary">{fmtHoraTs(e.created_at)} <span className="font-normal text-muted-foreground">· {new Date(e.created_at).toLocaleDateString("pt-BR")}</span></p>
                  <p>{e.descricao}</p>
                  {e.autor_nome && <p className="text-xs text-muted-foreground">{e.autor_nome}</p>}
                </li>
              ))}
              {o.status !== "ponto_confirmado" && aberto && (
                <li className="text-sm text-muted-foreground">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-dashed border-muted-foreground bg-background" />
                  Aguardando {o.substituto_nome ? "o próximo passo da cobertura" : "um substituto"}…
                </li>
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function Campo({ r, v, destaque }: { r: string; v: React.ReactNode; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{r}</p>
      <div className={cn("truncate font-semibold", destaque && "text-destructive")}>{v || "—"}</div>
    </div>
  );
}

// ---- Banco de diaristas ----------------------------------------------------------

export function DiaristasDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const pode = usePodeAlterarEfetividade();
  const { data: lista = [], isLoading } = useEfetDiaristas();
  const { salvarDiarista } = useEfetAcoes();
  const [busca, setBusca] = useState("");
  const [edit, setEdit] = useState<Partial<Diarista> | null>(null);

  const vis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter((d) => !q || d.nome.toLowerCase().includes(q) || (d.cidade ?? "").toLowerCase().includes(q) || (d.cpf ?? "").includes(q));
  }, [lista, busca]);

  const salvar = async (d: Partial<Diarista>) => {
    try { await salvarDiarista.mutateAsync(d); setEdit(null); toast({ title: "Diarista salva" }); }
    catch (e) { toast({ title: "Não foi possível salvar", description: msg(e), variant: "destructive" }); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Banco de diaristas</DialogTitle>
          <DialogDescription>
            Quem pode ser chamado para cobrir falta. Começou com as {lista.filter((d) => d.origem === "diarias").length} pessoas que já receberam diária no ERP — complete os telefones.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input placeholder="Buscar nome, cidade ou CPF…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {pode && <Button className="gap-1" onClick={() => setEdit({ disponivel: true })}><Plus className="h-4 w-4" />Nova</Button>}
        </div>

        {edit && (
          <div className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
            <Input placeholder="Nome *" value={edit.nome ?? ""} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} />
            <Input placeholder="CPF" value={edit.cpf ?? ""} onChange={(e) => setEdit({ ...edit, cpf: e.target.value })} />
            <Input placeholder="Telefone / WhatsApp" value={edit.telefone ?? ""} onChange={(e) => setEdit({ ...edit, telefone: e.target.value })} />
            <Input placeholder="Cidade" value={edit.cidade ?? ""} onChange={(e) => setEdit({ ...edit, cidade: e.target.value })} />
            <Input className="sm:col-span-2" placeholder="Contratos/regiões onde aceita trabalhar" value={edit.regioes ?? ""} onChange={(e) => setEdit({ ...edit, regioes: e.target.value })} />
            <Textarea className="sm:col-span-2" rows={2} placeholder="Observação" value={edit.observacao ?? ""} onChange={(e) => setEdit({ ...edit, observacao: e.target.value })} />
            <div className="flex items-center justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={() => salvar(edit)} disabled={salvarDiarista.isPending}>Salvar</Button>
            </div>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs">
              <tr><th className="p-2 text-left">Diarista</th><th className="p-2 text-left">Contato</th><th className="p-2 text-center">Coberturas</th><th className="p-2 text-center">Diárias</th><th className="p-2 text-center">Disponível</th><th /></tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="p-4 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></td></tr>}
              {vis.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="p-2"><p className="font-semibold">{d.nome}</p><p className="text-xs text-muted-foreground">{d.cidade || d.ultimo_contrato || "—"}</p></td>
                  <td className="p-2 text-xs">{d.telefone || <span className="text-warning">sem telefone</span>}</td>
                  <td className="p-2 text-center tabular-nums">{d.confirmados}</td>
                  <td className="p-2 text-center tabular-nums">{d.diarias}</td>
                  <td className="p-2 text-center"><Switch checked={d.disponivel} disabled={!pode} onCheckedChange={(v) => salvar({ ...d, disponivel: v })} /></td>
                  <td className="p-2 text-right">{pode && <Button size="sm" variant="ghost" onClick={() => setEdit(d)}>Editar</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

