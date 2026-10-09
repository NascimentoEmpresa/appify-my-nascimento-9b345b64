// =====================================================================
// OPERACIONAL › EFETIVIDADE E COBERTURAS — peças comuns às 5 telas
// (branch local efetividade, mig 20261008000030).
//
//   /app/operacional/efetividade            1. Painel do Dia
//   /app/operacional/efetividade/postos     2. Controle de Postos
//   /app/operacional/efetividade/posto      3. Detalhamento do Posto
//   /app/operacional/efetividade/faltas     4. Faltas e Coberturas
//   /app/operacional/efetividade/historico  5. Histórico e Indicadores
//
// Um menu só (ope_efetividade) governa as cinco pelo prefixo da rota. Os
// filtros moram na URL (?d=AAAA-MM-DD&c=empresa-filial&enc=&t=&p=) para a
// troca de aba manter a data e o contrato, e para o link poder ser mandado
// no WhatsApp do encarregado.
// =====================================================================
import { useMemo } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AlertTriangle, BarChart3, CalendarDays, CheckCircle2, CircleDashed, Clock, FileText, History,
  Loader2, MapPin, Phone, RefreshCw, RotateCcw, ShieldAlert, UserCheck, Users, XCircle,
} from "lucide-react";
import { useEfetBase, useEfetOcorrencias } from "@/hooks/useEfetividade";
import {
  avaliarTodos, chaveContrato, chavePosto, fmtDataBR, linkTel, linkWhatsapp, somaDias, ROTULO_SITUACAO, ROTULO_STATUS, ROTULO_TURNO,
  type ContratoEfet, type EstadoCobertura, type LinhaDia, type SituacaoEfet, type StatusContrato, type StatusCobertura, type Turno,
} from "@/lib/efetividade";

export const BASE_ROTA = "/app/operacional/efetividade";

// ---- Filtros na URL -----------------------------------------------------------

export interface Filtros {
  data: string | null;      // null = último dia sincronizado
  contrato: string | null;  // "empresa-filial"
  encarregado: string | null;
  turno: Turno | null;
  posto: string | null;
}

export function useFiltros() {
  const [sp, setSp] = useSearchParams();
  const filtros: Filtros = {
    data: sp.get("d"),
    contrato: sp.get("c"),
    encarregado: sp.get("enc"),
    turno: (sp.get("t") as Turno | null) || null,
    posto: sp.get("p"),
  };
  const set = (patch: Partial<Record<"d" | "c" | "enc" | "t" | "p" | "oc" | "ini" | "fim", string | null>>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    setSp(n, { replace: true });
  };
  const limpar = () => { const n = new URLSearchParams(); if (sp.get("d")) n.set("d", sp.get("d")!); setSp(n, { replace: true }); };
  return { filtros, set, limpar, sp };
}

/** Hoje no fuso local (AAAA-MM-DD). */
export const hojeLocal = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };

/** Último dia que o espelho da Senior tem batida (RPC da mig 20261007000021). */
export function useSincronizadoAte() {
  return useQuery({
    queryKey: ["efetividade", "sincronizado-ate"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as { rpc: (f: string) => Promise<{ data: string | null; error: { message: string } | null }> })
        .rpc("diaria_ponto_sincronizado_ate");
      if (error) throw error;
      return data ?? null;
    },
  });
}

// ---- O dia avaliado (Painel, Postos, Faltas, Detalhe) ---------------------------

/**
 * Carrega a empresa toda para o dia e a véspera (a comparação "vs. dia
 * anterior"), aplica os filtros e devolve as linhas avaliadas.
 */
export function useDiaEfetividade(filtros: Filtros) {
  const { data: sinc, isLoading: carregandoSinc } = useSincronizadoAte();
  const data = filtros.data ?? sinc ?? null;
  const ontem = data ? somaDias(data, -1) : null;
  const base = useEfetBase(ontem, data);
  const ocs = useEfetOcorrencias(ontem, data);
  const sincAte = base.data?.sincronizado_ate ?? sinc ?? null;

  const contratos = useMemo(() => base.data?.contratos ?? [], [base.data]);
  const contratoMap = useMemo(() => new Map(contratos.map((c) => [chaveContrato(c.empresa, c.filial), c])), [contratos]);

  const filtrar = (ls: LinhaDia[]) => ls.filter((l) => {
    const c = l.p.c;
    if (filtros.contrato && chaveContrato(c.empresa, c.filial) !== filtros.contrato) return false;
    if (filtros.turno && l.p.turno !== filtros.turno) return false;
    if (filtros.posto && chavePosto(c) !== filtros.posto) return false;
    if (filtros.encarregado) {
      const k = contratoMap.get(chaveContrato(c.empresa, c.filial));
      if (!k?.encarregados.some((e) => String(e.id) === filtros.encarregado)) return false;
    }
    return l.dia.situacao !== "fora_contrato";
  });

  const linhas = useMemo(
    () => (data ? filtrar(avaliarTodos(base.preps, data, sincAte, ocs.data ?? [])) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base.preps, data, sincAte, ocs.data, filtros.contrato, filtros.turno, filtros.posto, filtros.encarregado, contratoMap],
  );
  const linhasOntem = useMemo(
    () => (ontem ? filtrar(avaliarTodos(base.preps, ontem, sincAte, ocs.data ?? [])) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base.preps, ontem, sincAte, ocs.data, filtros.contrato, filtros.turno, filtros.posto, filtros.encarregado, contratoMap],
  );

  return {
    data, ontem, sincAte, base, ocorrencias: ocs.data ?? [], ocs, contratos, contratoMap, linhas, linhasOntem,
    carregando: carregandoSinc || base.isLoading || ocs.isLoading,
    erro: (base.error ?? ocs.error) as Error | null,
  };
}

// ---- Cabeçalho + abas -----------------------------------------------------------

const ABAS = [
  { to: BASE_ROTA, label: "Painel do Dia", icon: BarChart3, exato: true },
  { to: `${BASE_ROTA}/postos`, label: "Controle de Postos", icon: Users },
  { to: `${BASE_ROTA}/posto`, label: "Detalhamento do Posto", icon: FileText },
  { to: `${BASE_ROTA}/faltas`, label: "Faltas e Coberturas", icon: AlertTriangle },
  { to: `${BASE_ROTA}/historico`, label: "Histórico e Indicadores", icon: History },
];

export function CabecalhoEfetividade({
  titulo, subtitulo, icone: Icone, data, sincAte, ultimaSinc, onAtualizar, atualizando, extra,
}: {
  titulo: string; subtitulo: string; icone: typeof Users; data?: string | null; sincAte?: string | null;
  ultimaSinc?: string | null; onAtualizar?: () => void; atualizando?: boolean; extra?: React.ReactNode;
}) {
  const { search } = useLocation();
  const { pathname } = useLocation();
  // Só os filtros que fazem sentido em todas as abas atravessam a troca.
  const qs = useMemo(() => {
    const sp = new URLSearchParams(search);
    const n = new URLSearchParams();
    for (const k of ["d", "c", "enc", "t"]) if (sp.get(k)) n.set(k, sp.get(k)!);
    const s = n.toString();
    return s ? `?${s}` : "";
  }, [search]);

  return (
    <div className="mb-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Icone className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Operacional · Efetividade e Coberturas</p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground lg:text-3xl">{titulo}</h1>
            <p className="text-sm text-muted-foreground">{subtitulo}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          {data !== undefined && (
            <Card className="flex items-center gap-3 px-3 py-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <div className="text-xs leading-tight">
                <p>Data selecionada: <b>{fmtDataBR(data)}</b></p>
                <p className="flex items-center gap-1 text-muted-foreground">
                  <span className={cn("inline-block h-2 w-2 rounded-full", sincAte && data && data <= sincAte ? "bg-success" : "bg-warning")} />
                  Ponto da Senior até {fmtDataBR(sincAte)}
                  {ultimaSinc && <> · carga {new Date(ultimaSinc).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</>}
                </p>
              </div>
            </Card>
          )}
          {onAtualizar && (
            <Button variant="outline" onClick={onAtualizar} disabled={atualizando} className="gap-2">
              {atualizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
            </Button>
          )}
        </div>
      </div>

      <nav className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {ABAS.map((a, i) => {
          const ativo = a.exato ? pathname === a.to : pathname.startsWith(a.to) && !(a.to === `${BASE_ROTA}/posto` && pathname.startsWith(`${BASE_ROTA}/postos`));
          return (
            <NavLink
              key={a.to}
              to={a.to + qs}
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors",
                ativo ? "border-primary bg-primary text-primary-foreground shadow-sm" : "bg-card text-foreground hover:border-primary/50 hover:text-primary",
              )}
            >
              <a.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{i + 1}. {a.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

/** Aviso honesto quando o dia escolhido ainda não tem ponto (o espelho é diário). */
export function AvisoSincronizacao({ data, sincAte }: { data: string | null; sincAte: string | null }) {
  if (!data) return null;
  if (!sincAte) {
    return (
      <Card className="mb-4 flex items-start gap-3 border-destructive/40 bg-destructive/5 p-3 text-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p>O espelho de marcações da Senior não respondeu. Sem ele não há como saber quem bateu ponto.</p>
      </Card>
    );
  }
  if (data <= sincAte) return null;
  return (
    <Card className="mb-4 flex items-start gap-3 border-warning/40 bg-warning/5 p-3 text-sm">
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <p>
        O ponto da Senior chega no ERP uma vez por dia e vai até <b>{fmtDataBR(sincAte)}</b>. Em <b>{fmtDataBR(data)}</b> ninguém
        é marcado como faltoso pelo relógio — quem a escala espera aparece como <b>aguardando ponto</b>. As faltas avisadas
        (encarregado, WhatsApp) entram por <b>Faltas e Coberturas › Registrar falta</b> e já contam aqui.
      </p>
    </Card>
  );
}

// ---- Barra de filtros --------------------------------------------------------------

export function BarraFiltros({
  contratos, filtros, set, limpar, sincAte, postos, mostrar = ["data", "contrato", "encarregado", "turno"],
}: {
  contratos: ContratoEfet[];
  filtros: Filtros;
  set: ReturnType<typeof useFiltros>["set"];
  limpar: () => void;
  sincAte: string | null;
  postos?: { value: string; label: string; hint?: string }[];
  mostrar?: ("data" | "contrato" | "encarregado" | "turno" | "posto")[];
}) {
  const opcContratos = useMemo(() => contratos.map((c) => ({
    value: chaveContrato(c.empresa, c.filial), label: c.nome, hint: `${c.ativos} ativos${c.empresa_nome ? ` · ${c.empresa_nome}` : ""}`,
  })), [contratos]);
  const opcEncarregados = useMemo(() => {
    const m = new Map<string, { value: string; label: string; n: number }>();
    for (const c of contratos) for (const e of c.encarregados) {
      const k = String(e.id);
      if (!m.has(k)) m.set(k, { value: k, label: e.nome, n: 0 });
      m.get(k)!.n++;
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
      .map((e) => ({ value: e.value, label: e.label, hint: `${e.n} contrato${e.n > 1 ? "s" : ""}` }));
  }, [contratos]);
  const opcTurno = (Object.keys(ROTULO_TURNO) as Turno[]).map((t) => ({ value: t, label: ROTULO_TURNO[t] }));

  return (
    <Card className="mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
      {mostrar.includes("data") && (
        <label className="space-y-1 text-xs font-semibold">
          Data
          <Input type="date" value={filtros.data ?? sincAte ?? ""} onChange={(e) => set({ d: e.target.value || null })} />
        </label>
      )}
      {mostrar.includes("contrato") && (
        <div className="space-y-1 text-xs font-semibold lg:col-span-2">
          Contrato
          <SearchableSelect value={filtros.contrato ?? ""} onChange={(v) => set({ c: v || null, p: null })} options={opcContratos}
            placeholder="Todos os contratos" searchPlaceholder="Buscar contrato…" allowClear />
        </div>
      )}
      {mostrar.includes("posto") && postos && (
        <div className="space-y-1 text-xs font-semibold">
          Posto
          <SearchableSelect value={filtros.posto ?? ""} onChange={(v) => set({ p: v || null })} options={postos}
            placeholder="Todos" searchPlaceholder="Buscar posto…" allowClear />
        </div>
      )}
      {mostrar.includes("encarregado") && (
        <div className="space-y-1 text-xs font-semibold">
          Encarregado
          <SearchableSelect value={filtros.encarregado ?? ""} onChange={(v) => set({ enc: v || null })} options={opcEncarregados}
            placeholder="Todos" searchPlaceholder="Buscar encarregado…" allowClear />
        </div>
      )}
      {mostrar.includes("turno") && (
        <div className="space-y-1 text-xs font-semibold">
          Turno
          <SearchableSelect value={filtros.turno ?? ""} onChange={(v) => set({ t: v || null })} options={opcTurno} placeholder="Todos" allowClear />
        </div>
      )}
      <Button variant="outline" onClick={limpar} className="gap-2"><RotateCcw className="h-4 w-4" /> Limpar</Button>
    </Card>
  );
}

// ---- Visual ----------------------------------------------------------------------

const TONS: Record<string, string> = {
  primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success", info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning", destructive: "bg-destructive/10 text-destructive", muted: "bg-muted text-muted-foreground",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

/**
 * Indicador com comparação. `melhorSobe`: a seta fica verde quando sobe
 * (presentes) ou quando desce (faltas).
 */
export function Kpi({
  icon: Icon, rotulo, valor, anterior, tom = "primary", melhorSobe = true, sufixo, dica, formatoDelta = "pct", onClick, ativo,
}: {
  icon: typeof Users; rotulo: string; valor: number | null; anterior?: number | null; tom?: string; melhorSobe?: boolean;
  sufixo?: string; dica?: string; formatoDelta?: "pct" | "pp"; onClick?: () => void; ativo?: boolean;
}) {
  let delta: React.ReactNode = null;
  if (valor != null && anterior != null) {
    const diff = formatoDelta === "pp" ? (valor - anterior) : anterior ? ((valor - anterior) / anterior) * 100 : null;
    if (diff != null && Number.isFinite(diff)) {
      const sobe = diff > 0;
      const bom = diff === 0 ? null : sobe === melhorSobe;
      delta = (
        <span className={cn("text-xs font-semibold", bom == null ? "text-muted-foreground" : bom ? "text-success" : "text-destructive")}>
          {diff === 0 ? "=" : sobe ? "↑" : "↓"} {Math.abs(diff).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{formatoDelta === "pp" ? " p.p." : "%"}
        </span>
      );
    }
  }
  const Comp = onClick ? "button" : "div";
  return (
    <Card className={cn("p-0 transition-shadow", onClick && "hover:shadow-md", ativo && "ring-2 ring-primary")}>
      <Comp onClick={onClick} className="flex w-full items-center gap-3 p-3 text-left">
        <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", TONS[tom])}><Icon className="h-6 w-6" /></div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-muted-foreground">{rotulo}</p>
          <p className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums leading-tight">
              {valor == null ? "—" : valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{sufixo}
            </span>
            {delta}
          </p>
          {(dica || anterior != null) && <p className="truncate text-[11px] text-muted-foreground">{dica ?? "vs. dia anterior"}</p>}
        </div>
      </Comp>
    </Card>
  );
}

export function Secao({ titulo, icone: Icone, sub, acoes, children, className, corpoClassName }: {
  titulo: string; icone: typeof Users; sub?: React.ReactNode; acoes?: React.ReactNode; children: React.ReactNode; className?: string; corpoClassName?: string;
}) {
  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icone className="h-4 w-4" /></div>
          <div className="min-w-0">
            <p className="font-display text-base font-bold leading-tight">{titulo}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
        {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
      </div>
      <div className={cn("flex-1", corpoClassName)}>{children}</div>
    </Card>
  );
}

const COR_SITUACAO: Record<SituacaoEfet, string> = {
  presente: "bg-success/10 text-success border-success/30",
  falta: "bg-destructive/10 text-destructive border-destructive/30",
  atestado: "bg-violet-500/10 text-violet-700 border-violet-500/30 dark:text-violet-300",
  afastamento: "bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-300",
  ferias: "bg-info/10 text-info border-info/30",
  folga: "bg-muted text-muted-foreground border-border",
  feriado: "bg-muted text-muted-foreground border-border",
  aguardando: "bg-warning/10 text-warning border-warning/30",
  sem_registro: "bg-muted text-muted-foreground border-dashed border-border",
  fora_contrato: "bg-muted text-muted-foreground border-border",
};

export function BadgeSituacao({ s }: { s: SituacaoEfet }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold", COR_SITUACAO[s])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{ROTULO_SITUACAO[s]}
    </span>
  );
}

const COR_STATUS: Record<StatusCobertura, { cls: string; icon: typeof Users }> = {
  sem_cobertura: { cls: "bg-destructive/10 text-destructive", icon: XCircle },
  acionado: { cls: "bg-info/10 text-info", icon: Phone },
  aceita: { cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300", icon: UserCheck },
  em_deslocamento: { cls: "bg-info/10 text-info", icon: MapPin },
  aguardando_ponto: { cls: "bg-warning/10 text-warning", icon: Clock },
  ponto_confirmado: { cls: "bg-success/10 text-success", icon: CheckCircle2 },
  nao_realizada: { cls: "bg-destructive/10 text-destructive", icon: XCircle },
  nao_se_aplica: { cls: "bg-muted text-muted-foreground", icon: CircleDashed },
  cancelada: { cls: "bg-muted text-muted-foreground", icon: CircleDashed },
};

export function BadgeStatus({ s }: { s: StatusCobertura | null | undefined }) {
  const st = s ?? "sem_cobertura";
  const { cls, icon: I } = COR_STATUS[st];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", cls)}>
      <I className="h-3 w-3" />{ROTULO_STATUS[st]}
    </span>
  );
}

export function BadgeCobertura({ e }: { e: EstadoCobertura | null }) {
  if (!e) return <span className="text-muted-foreground">—</span>;
  const map: Record<EstadoCobertura, [string, string]> = {
    coberto: ["Coberto", "bg-success/10 text-success"],
    em_andamento: ["Em andamento", "bg-info/10 text-info"],
    descoberto: ["Descoberto", "bg-destructive/10 text-destructive"],
    dispensado: ["Dispensado", "bg-muted text-muted-foreground"],
  };
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", map[e][1])}>{map[e][0]}</span>;
}

export function BadgeContrato({ s }: { s: StatusContrato }) {
  const map: Record<StatusContrato, [string, string]> = {
    normal: ["Normal", "bg-success/10 text-success"],
    atencao: ["Atenção", "bg-warning/10 text-warning"],
    critico: ["Crítico", "bg-destructive/10 text-destructive"],
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold", map[s][1])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{map[s][0]}
    </span>
  );
}

/** Célula de percentual com fundo proporcional (verde ≥ 95, âmbar ≥ 91, vermelho abaixo). */
export function CelulaPct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const cls = v >= 0.95 ? "bg-success/15 text-success" : v >= 0.91 ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive";
  return <span className={cn("inline-block min-w-[3.5rem] rounded px-1.5 py-0.5 text-center text-xs font-bold tabular-nums", cls)}>{(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>;
}

export function Contato({ rotulo, nome, telefone }: { rotulo: string; nome: string | null | undefined; telefone: string | null | undefined }) {
  const wa = linkWhatsapp(telefone);
  const tel = linkTel(telefone);
  return (
    <div className="flex items-center gap-2 border-b py-2 last:border-0">
      <Phone className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">{rotulo}:</span> <span>{nome || "—"}</span>
        <p className="text-xs text-muted-foreground">{telefone || "sem telefone no cadastro"}</p>
      </div>
      <a href={wa ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!wa}
        className={cn("rounded-md border px-2 py-1 text-xs font-semibold", wa ? "border-success/40 text-success hover:bg-success/10" : "pointer-events-none opacity-40")}>
        WhatsApp
      </a>
      <a href={tel ?? undefined} aria-disabled={!tel}
        className={cn("rounded-md border px-2 py-1 text-xs font-semibold", tel ? "text-primary hover:bg-primary/10" : "pointer-events-none opacity-40")}>
        Ligar
      </a>
    </div>
  );
}

export function Carregando({ texto = "Lendo o ponto da Senior…" }: { texto?: string }) {
  return (
    <Card className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {texto}
    </Card>
  );
}

export function Erro({ erro }: { erro: Error | null }) {
  if (!erro) return null;
  const semMig = /function .*does not exist|Could not find the function|relation .* does not exist/i.test(erro.message);
  return (
    <Card className="mb-4 flex items-start gap-3 border-destructive/40 bg-destructive/5 p-3 text-sm">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div>
        <p className="font-semibold">Não foi possível carregar.</p>
        <p className="text-muted-foreground">
          {semMig ? "A migration 20261008000030_operacional_efetividade.sql ainda não foi aplicada no banco." : erro.message}
        </p>
      </div>
    </Card>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return <p className="p-6 text-center text-sm text-muted-foreground">{texto}</p>;
}

/** Paginação simples no cliente. */
export function Paginacao({ pagina, total, porPagina, onPagina }: { pagina: number; total: number; porPagina: number; onPagina: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return <p className="px-4 py-2 text-xs text-muted-foreground">{total} registro{total === 1 ? "" : "s"}</p>;
  const ini = (pagina - 1) * porPagina + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
      <span>Mostrando {ini} a {Math.min(total, pagina * porPagina)} de {total}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)}>Anterior</Button>
        <span className="px-2 font-semibold text-foreground">{pagina} / {paginas}</span>
        <Button size="sm" variant="outline" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)}>Próxima</Button>
      </div>
    </div>
  );
}

export const linkPosto = (l: LinhaDia | { empresa: number; filial: number; posto_codigo: string | null; posto_nome: string }, data: string | null) => {
  const c = "p" in l ? l.p.c : l;
  const sp = new URLSearchParams({ c: chaveContrato(c.empresa, c.filial), p: chavePosto(c) });
  if (data) sp.set("d", data);
  return `${BASE_ROTA}/posto?${sp.toString()}`;
};
