import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRightLeft, Briefcase, Building2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Crown, GitBranch,
  History, Loader2, Network, RefreshCw, Search, ShieldAlert, UserX, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useHierarquiaPostos, useMoverPosto, useSincronizarPostos } from "@/hooks/useHierarquiaPostos";
import {
  caminho, filtrarArvore, lideres, podeMover, responsaveisPorContrato, resumo, tituloDeLideranca,
  type Hierarquia, type NoPosto, type Ocupante,
} from "@/lib/rh/hierarquiaPostos";

// =====================================================================
// RH › HIERARQUIA DE POSTOS (mig 20261007000024, 07/10/2026)
//
// Réplica da hierarquia de postos da Senior (estrutura 003 "Hagg 2026",
// hierarquia 002 "Hierarquia de Ponto", revisão 001 de 01/04/2026), com cada
// colaborador no posto que a Senior dá a ele (EMPREGADOS."Posto", ao vivo).
// É a base de "quem responde por qual contrato" — ponto e acesso por
// contrato vêm depois (RPC rh_hier_minha_area). Abas:
//   · Árvore — supervisores → analistas → líderes → postos, com ocupantes,
//     vagas × ocupados e contratos de cada ramo;
//   · Líderes — todo posto com postos abaixo e quem o ocupa;
//   · Contratos — quem responde por cada contrato;
//   · Pendências — postos fora da hierarquia, ativos sem posto, postos
//     vazios / acima das vagas, líderes sem ninguém.
// Contas em src/lib/rh/hierarquiaPostos.ts (com teste).
// =====================================================================

const COR_NIVEL = ["#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#ca8a04", "#ea580c"];
const fmt = (n: number) => n.toLocaleString("pt-BR");

export default function HierarquiaPostos() {
  const q = useHierarquiaPostos();
  const h = q.data;
  const [sel, setSel] = useState<string | null>(null);
  const [aba, setAba] = useState("arvore");
  const sinc = useSincronizarPostos();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hierarquia de Postos"
        subtitle="A hierarquia de postos da Senior (Hagg 2026) com cada colaborador no seu lugar — quem responde por quem e por qual contrato."
        module="Recursos Humanos"
        breadcrumb={["Recursos Humanos", "Hierarquia de Postos"]}
        actions={h?.podeAlterar ? (
          <Button variant="outline" className="gap-1.5" disabled={sinc.isPending}
            onClick={() => sinc.mutate(undefined, { onSuccess: (n) => toast.success(n ? `${n} posto(s) novo(s) da Senior.` : "Nenhum posto novo na Senior."), onError: (e) => toast.error((e as Error).message) })}>
            {sinc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Buscar postos novos da Senior
          </Button>
        ) : undefined}
      />
      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando a hierarquia…</Card>
      ) : q.error || !h ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <>
          <Resumo h={h} onIr={setAba} />
          <Tabs value={aba} onValueChange={setAba}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="arvore" className="gap-1.5"><Network className="h-3.5 w-3.5" /> Árvore</TabsTrigger>
              <TabsTrigger value="lideres" className="gap-1.5"><Crown className="h-3.5 w-3.5" /> Líderes</TabsTrigger>
              <TabsTrigger value="contratos" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Contratos</TabsTrigger>
              <TabsTrigger value="pendencias" className="gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Pendências</TabsTrigger>
              {h.historico.length > 0 && <TabsTrigger value="historico" className="gap-1.5"><History className="h-3.5 w-3.5" /> Alterações</TabsTrigger>}
            </TabsList>
            <TabsContent value="arvore"><Arvore h={h} onAbrir={setSel} /></TabsContent>
            <TabsContent value="lideres"><Lideres h={h} onAbrir={setSel} /></TabsContent>
            <TabsContent value="contratos"><Contratos h={h} onAbrir={setSel} /></TabsContent>
            <TabsContent value="pendencias"><Pendencias h={h} onAbrir={setSel} /></TabsContent>
            <TabsContent value="historico"><Historico h={h} /></TabsContent>
          </Tabs>
          <DetalhePosto h={h} codigo={sel} onFechar={() => setSel(null)} onAbrir={setSel} />
        </>
      )}
    </div>
  );
}

// ---- Resumo -------------------------------------------------------------------------

function Resumo({ h, onIr }: { h: Hierarquia; onIr: (aba: string) => void }) {
  const r = useMemo(() => resumo(h), [h]);
  const pct = r.ativos ? Math.round((r.ativosNaArvore / r.ativos) * 100) : 0;
  const cards: { rotulo: string; valor: string; dica: string; icone: typeof Users; tom?: string; aba?: string }[] = [
    { rotulo: "Postos na hierarquia", valor: fmt(r.naArvore), dica: `de ${fmt(r.postos)} postos da estrutura · ${r.niveis} níveis`, icone: GitBranch },
    { rotulo: "Líderes", valor: fmt(r.lideres), dica: `postos com postos abaixo · ${r.lideresSemOcupante} sem ninguém`, icone: Crown, aba: "lideres" },
    { rotulo: "Colaboradores no lugar", valor: `${pct}%`, dica: `${fmt(r.ativosNaArvore)} de ${fmt(r.ativos)} ativos estão em postos da árvore`, icone: Users, tom: pct >= 95 ? "text-success" : "text-warning" },
    { rotulo: "Contratos cobertos", valor: fmt(r.contratos), dica: "contratos com algum posto na árvore", icone: Building2, aba: "contratos" },
    { rotulo: "Em postos fora da hierarquia", valor: fmt(r.ativosFora), dica: `${fmt(r.fora)} postos sem lugar na árvore`, icone: AlertTriangle, tom: r.ativosFora ? "text-destructive" : undefined, aba: "pendencias" },
    { rotulo: "Sem posto", valor: fmt(r.semPosto), dica: "ativos sem posto da estrutura Hagg 2026", icone: UserX, tom: r.semPosto ? "text-destructive" : undefined, aba: "pendencias" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.rotulo} className={cn("p-4", c.aba && "cursor-pointer hover:border-primary/50")} onClick={() => c.aba && onIr(c.aba)}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><c.icone className="h-3.5 w-3.5" /> {c.rotulo}</p>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", c.tom)}>{c.valor}</p>
          <p className="text-[11px] text-muted-foreground">{c.dica}</p>
        </Card>
      ))}
    </div>
  );
}

// ---- Árvore -------------------------------------------------------------------------

function Arvore({ h, onAbrir }: { h: Hierarquia; onAbrir: (c: string) => void }) {
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(h.raizes.map((r) => r.codigo)));
  const filtro = useMemo(() => filtrarArvore(h, busca), [h, busca]);
  const alternar = (c: string) => setAbertos((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const tudo = () => setAbertos(new Set([...h.porCodigo.values()].filter((n) => n.filhos.length).map((n) => n.codigo)));

  const Linha = ({ n }: { n: NoPosto }) => {
    if (filtro && !filtro.visiveis.has(n.codigo)) return null;
    const aberto = filtro ? true : abertos.has(n.codigo);
    const lider = n.filhos.length > 0;
    const excesso = n.vagas != null && n.ocupantes.length > n.vagas;
    const vazio = !n.ocupantes.length && (n.vagas ?? 0) > 0;
    return (
      <>
        <div className={cn("group flex items-center gap-1.5 border-b border-border/40 py-1 pr-2 text-xs hover:bg-muted/40", filtro?.achados.has(n.codigo) && "bg-amber-50 dark:bg-amber-950/20")}
          style={{ paddingLeft: 8 + n.nivel * 22 }}>
          {lider ? (
            <button type="button" className="rounded p-0.5 hover:bg-muted" onClick={() => alternar(n.codigo)} aria-label={aberto ? "Recolher" : "Abrir"}>
              {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-[18px]" />}
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: lider ? COR_NIVEL[n.nivel % COR_NIVEL.length] : "hsl(var(--muted-foreground) / 0.4)" }} />
          <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onAbrir(n.codigo)} title={n.descricao}>
            <span className="font-mono text-[10px] text-muted-foreground">{n.codigo}</span>{" "}
            <span className={cn(lider && "font-semibold")}>{n.titulo}</span>
            {n.contrato && <span className="text-muted-foreground"> · {n.contrato}</span>}
          </button>
          <span className="hidden max-w-[220px] truncate text-[11px] text-muted-foreground md:inline" title={n.ocupantes.map((o) => o.nome).join(", ")}>
            {n.ocupantes.length === 1 ? n.ocupantes[0].nome : n.ocupantes.length > 1 ? `${n.ocupantes[0].nome} +${n.ocupantes.length - 1}` : ""}
          </span>
          <Badge variant="outline" className={cn("shrink-0 text-[10px] tabular-nums", excesso && "border-destructive/50 text-destructive", vazio && "border-warning/50 text-warning")}
            title="ocupantes / vagas da Senior">
            {n.ocupantes.length}{n.vagas != null ? `/${n.vagas}` : ""}
          </Badge>
          {lider && <Badge variant="secondary" className="shrink-0 text-[10px]" title="postos e colaboradores abaixo">{n.ramo.postos - 1} postos · {fmt(n.ramo.colaboradores - n.ocupantes.length)} pess.</Badge>}
        </div>
        {aberto && n.filhos.map((f) => <Linha key={f.codigo} n={f} />)}
      </>
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Posto, cargo, contrato ou colaborador…" className="h-8 w-80 pl-8 text-xs" /></div>
        {filtro && <span className="text-xs text-muted-foreground">{filtro.achados.size} posto(s) encontrado(s)</span>}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={tudo}><ChevronsUpDown className="h-3.5 w-3.5" /> Abrir tudo</Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setAbertos(new Set())}><ChevronsDownUp className="h-3.5 w-3.5" /> Recolher</Button>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">{h.raizes.map((r) => <Linha key={r.codigo} n={r} />)}</div>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Número à direita = ocupantes / vagas da Senior (vermelho: acima das vagas; amarelo: sem ninguém). Clique no posto para ver o caminho até o topo, quem está nele e os contratos do ramo.
      </p>
    </Card>
  );
}

// ---- Líderes ------------------------------------------------------------------------

function Lideres({ h, onAbrir }: { h: Hierarquia; onAbrir: (c: string) => void }) {
  const ls = useMemo(() => lideres(h), [h]);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Posto de liderança</th><th className="px-3 py-2">Quem ocupa</th><th className="px-3 py-2">Responde a</th>
            <th className="px-3 py-2 text-right">Postos abaixo</th><th className="px-3 py-2 text-right">Pessoas abaixo</th><th className="px-3 py-2">Contratos</th>
          </tr></thead>
          <tbody>
            {ls.map((l) => (
              <tr key={l.posto.codigo} className="cursor-pointer border-t border-border/60 hover:bg-muted/40" onClick={() => onAbrir(l.posto.codigo)}>
                <td className="px-3 py-1.5" style={{ paddingLeft: 12 + l.posto.nivel * 14 }}>
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: COR_NIVEL[l.posto.nivel % COR_NIVEL.length] }} />
                  <span className="font-mono text-[10px] text-muted-foreground">{l.posto.codigo}</span> <b>{l.posto.titulo}</b>
                </td>
                <td className="px-3 py-1.5">{l.ocupantes.length ? l.ocupantes.map((o) => o.nome).join(", ") : <span className="text-destructive">ninguém no posto</span>}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{l.chefe ? `${l.chefe.titulo}${l.chefe.ocupantes[0] ? ` (${l.chefe.ocupantes[0].nome})` : ""}` : "— topo —"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.postosAbaixo}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(l.colaboradoresAbaixo)}</td>
                <td className="max-w-[320px] truncate px-3 py-1.5 text-muted-foreground" title={l.contratos.join(" · ")}>{l.contratos.join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Contratos ----------------------------------------------------------------------

function Contratos({ h, onAbrir }: { h: Hierarquia; onAbrir: (c: string) => void }) {
  const rs = useMemo(() => responsaveisPorContrato(h), [h]);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Contrato</th><th className="px-3 py-2 text-right">Postos</th><th className="px-3 py-2 text-right">Colaboradores</th>
            <th className="px-3 py-2">Líder(es) direto(s)</th><th className="px-3 py-2">Cadeia acima</th>
          </tr></thead>
          <tbody>
            {rs.map((c) => {
              const cadeia = c.lideres[0] ? caminho(h, c.lideres[0].codigo).slice(0, -1) : [];
              return (
                <tr key={c.contrato} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-medium">{c.contrato}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.postos}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(c.colaboradores)}</td>
                  <td className="px-3 py-1.5">
                    {c.lideres.map((l) => (
                      <button key={l.codigo} type="button" className="mr-2 text-primary hover:underline" onClick={() => onAbrir(l.codigo)}>
                        {l.titulo}{l.ocupantes[0] ? ` — ${l.ocupantes[0].nome}` : " — (vago)"}
                      </button>
                    ))}
                  </td>
                  <td className="max-w-[340px] truncate px-3 py-1.5 text-muted-foreground" title={cadeia.map((n) => n.titulo).join(" › ")}>
                    {cadeia.map((n) => n.ocupantes[0]?.nome ?? n.titulo).join(" › ") || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">Líder direto = o posto de liderança mais próximo acima dos postos daquele contrato. Contrato pelo código empresa + filial do posto (cadastro CONTRATOS).</p>
    </Card>
  );
}

// ---- Pendências ---------------------------------------------------------------------

function Pendencias({ h, onAbrir }: { h: Hierarquia; onAbrir: (c: string) => void }) {
  const arv = [...h.porCodigo.values()].filter((n) => n.naHierarquia);
  const acima = arv.filter((n) => n.vagas != null && n.ocupantes.length > n.vagas).sort((a, b) => (b.ocupantes.length - (b.vagas ?? 0)) - (a.ocupantes.length - (a.vagas ?? 0)));
  const vazios = arv.filter((n) => !n.ocupantes.length && (n.vagas ?? 0) > 0);
  const lideresVagos = lideres(h).filter((l) => !l.ocupantes.length);
  const foraComGente = h.fora.filter((n) => n.ocupantes.length);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BlocoPostos titulo="Postos fora da hierarquia, com gente" dica="A Senior não põe estes postos debaixo de ninguém: ninguém responde por estes colaboradores no ponto." postos={foraComGente} onAbrir={onAbrir} mostrarFora />
      <Card className="overflow-hidden">
        <p className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-sm font-semibold"><UserX className="h-4 w-4 text-destructive" /> Ativos sem posto da estrutura ({h.semPosto.length})</p>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs"><tbody>
            {h.semPosto.map((o) => (
              <tr key={o.id} className="border-t border-border/60"><td className="px-3 py-1">{o.nome}</td><td className="px-3 py-1 text-muted-foreground">{o.cargo ?? "—"}</td>
                <td className="px-3 py-1 font-mono text-[10px] text-muted-foreground">{o.posto ?? "sem posto"}{o.nomePosto ? ` · ${o.nomePosto}` : ""}</td></tr>
            ))}
          </tbody></table>
        </div>
      </Card>
      <BlocoPostos titulo="Líderes sem ninguém no posto" dica="Posto de liderança vago: o ramo abaixo fica sem responsável." postos={lideresVagos.map((l) => l.posto)} onAbrir={onAbrir} />
      <BlocoPostos titulo="Postos com mais gente que vagas" dica="Ocupantes acima das vagas cadastradas na Senior." postos={acima} onAbrir={onAbrir} />
      <BlocoPostos titulo="Postos com vaga e ninguém" dica="Têm vaga na Senior e ninguém alocado." postos={vazios} onAbrir={onAbrir} />
    </div>
  );
}

function BlocoPostos({ titulo, dica, postos, onAbrir, mostrarFora }: { titulo: string; dica: string; postos: NoPosto[]; onAbrir: (c: string) => void; mostrarFora?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-3 py-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" /> {titulo} ({postos.length})</p>
        <p className="text-[11px] text-muted-foreground">{dica}</p>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-xs"><tbody>
          {postos.map((n) => (
            <tr key={n.codigo} className="cursor-pointer border-t border-border/60 hover:bg-muted/40" onClick={() => onAbrir(n.codigo)}>
              <td className="px-3 py-1"><span className="font-mono text-[10px] text-muted-foreground">{n.codigo}</span> {n.titulo}</td>
              <td className="px-3 py-1 text-muted-foreground">{n.contrato ?? `filial ${n.filial ?? "?"}`}</td>
              <td className="px-3 py-1 text-right tabular-nums">{n.ocupantes.length}{n.vagas != null ? `/${n.vagas}` : ""}{mostrarFora ? " pess." : ""}</td>
            </tr>
          ))}
          {!postos.length && <tr><td className="px-3 py-6 text-center text-muted-foreground">Nada aqui.</td></tr>}
        </tbody></table>
      </div>
    </Card>
  );
}

function Historico({ h }: { h: Hierarquia }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-xs">
        <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Posto</th><th className="px-3 py-2">De → Para</th><th className="px-3 py-2">Motivo</th><th className="px-3 py-2">Quem</th></tr></thead>
        <tbody>
          {h.historico.map((x) => {
            const t = (c: string | null) => (c ? `${c} ${h.porCodigo.get(c)?.titulo ?? ""}` : "fora da hierarquia");
            return (
              <tr key={x.id} className="border-t border-border/60">
                <td className="px-3 py-1.5 text-muted-foreground">{new Date(x.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="px-3 py-1.5">{t(x.posto_codigo)}</td><td className="px-3 py-1.5">{t(x.pai_antes)} → {t(x.pai_depois)}</td>
                <td className="px-3 py-1.5">{x.motivo}</td><td className="px-3 py-1.5 text-muted-foreground">{x.autor_nome}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ---- Detalhe de um posto ------------------------------------------------------------

function DetalhePosto({ h, codigo, onFechar, onAbrir }: { h: Hierarquia; codigo: string | null; onFechar: () => void; onAbrir: (c: string) => void }) {
  const n = codigo ? h.porCodigo.get(codigo) : undefined;
  const [novoPai, setNovoPai] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const mover = useMoverPosto();
  const opcoes = useMemo(() => [...h.porCodigo.values()].filter((x) => x.naHierarquia && (x.filhos.length || tituloDeLideranca(x.titulo)))
    .map((x) => ({ value: x.codigo, label: `${x.codigo} · ${x.titulo}${x.ocupantes[0] ? ` — ${x.ocupantes[0].nome}` : ""}` })), [h]);
  if (!n) return null;
  const cam = caminho(h, n.codigo);
  const salvar = (remover = false) => {
    if (!motivo.trim()) { toast.error("Informe o motivo da mudança."); return; }
    if (!remover && !novoPai) { toast.error("Escolha o novo posto acima."); return; }
    if (!remover && !podeMover(h, n.codigo, novoPai)) { toast.error("Não dá para pôr o posto abaixo de um posto que está abaixo dele."); return; }
    mover.mutate({ posto: n.codigo, novoPai: remover ? null : novoPai, motivo, remover }, {
      onSuccess: () => { toast.success(remover ? "Posto tirado da hierarquia." : "Posto movido."); setMotivo(""); setNovoPai(""); },
      onError: (e) => toast.error((e as Error).message),
    });
  };
  return (
    <Sheet open={!!n} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Briefcase className="h-5 w-5 text-primary" /> {n.titulo}</SheetTitle>
          <SheetDescription><span className="font-mono">{n.codigo}</span> · {n.descricao}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          {!n.naHierarquia && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">Este posto está FORA da hierarquia na Senior — ninguém responde por ele.</p>}
          {cam.length > 1 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Caminho até o topo</p>
              <ol className="space-y-1">
                {cam.map((c, i) => (
                  <li key={c.codigo} className="text-xs" style={{ paddingLeft: i * 12 }}>
                    <button type="button" className={cn("text-left hover:underline", c.codigo === n.codigo ? "font-semibold" : "text-primary")} onClick={() => onAbrir(c.codigo)}>
                      {c.titulo}
                    </button>
                    <span className="text-muted-foreground">{c.ocupantes.length ? ` — ${c.ocupantes.map((o) => o.nome).join(", ")}` : " — (vago)"}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border p-2"><p className="text-[10px] text-muted-foreground">Ocupantes / vagas</p><p className="text-lg font-bold">{n.ocupantes.length}{n.vagas != null ? `/${n.vagas}` : ""}</p></div>
            <div className="rounded-md border p-2"><p className="text-[10px] text-muted-foreground">Postos abaixo</p><p className="text-lg font-bold">{n.ramo.postos - 1}</p></div>
            <div className="rounded-md border p-2"><p className="text-[10px] text-muted-foreground">Pessoas abaixo</p><p className="text-lg font-bold">{fmt(n.ramo.colaboradores - n.ocupantes.length)}</p></div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Contrato{n.ramo.contratos.length > 1 ? "s do ramo" : ""}</p>
            <div className="flex flex-wrap gap-1">{(n.ramo.contratos.length ? n.ramo.contratos : [n.contrato ?? `filial ${n.filial}`]).map((c) => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}</div>
          </div>
          <ListaOcupantes titulo="Quem está neste posto" ocupantes={n.ocupantes} />
          {n.filhos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Postos diretamente abaixo ({n.filhos.length})</p>
              <ul className="space-y-0.5">
                {n.filhos.map((f) => (
                  <li key={f.codigo} className="flex items-center justify-between gap-2 text-xs">
                    <button type="button" className="truncate text-left text-primary hover:underline" onClick={() => onAbrir(f.codigo)}>{f.codigo} · {f.titulo}</button>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{f.ocupantes.length}{f.vagas != null ? `/${f.vagas}` : ""}{f.filhos.length ? ` · ${f.ramo.postos - 1} abaixo` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {h.podeAlterar && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold"><ArrowRightLeft className="h-3.5 w-3.5" /> Mudar o lugar deste posto</p>
              <SearchableSelect value={novoPai} onChange={setNovoPai} options={opcoes.filter((o) => o.value !== n.codigo)} placeholder="Novo posto acima…" searchPlaceholder="Buscar posto de liderança…" triggerClassName="h-8 w-full text-xs" />
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivo (fica no histórico)" className="text-xs" />
              <div className="flex justify-end gap-2">
                {n.naHierarquia && !n.filhos.length && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={mover.isPending} onClick={() => salvar(true)}>Tirar da hierarquia</Button>}
                <Button size="sm" className="h-8 text-xs" disabled={mover.isPending} onClick={() => salvar(false)}>{mover.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mover"}</Button>
              </div>
              <p className="text-[10px] text-muted-foreground">A mudança vale no ERP e fica no histórico. Para valer no ponto da Senior, ajuste também lá.</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ListaOcupantes({ titulo, ocupantes }: { titulo: string; ocupantes: Ocupante[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{titulo} ({ocupantes.length})</p>
      {ocupantes.length ? (
        <ul className="max-h-60 space-y-0.5 overflow-auto">
          {ocupantes.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{o.nome} <span className="text-muted-foreground">· cad. {o.cadastro ?? "—"}</span></span>
              <span className="flex shrink-0 items-center gap-1">
                {o.situacao && o.situacao !== "Trabalhando" && <Badge variant="outline" className="text-[9px]">{o.situacao}</Badge>}
                {o.temLogin && <Badge variant="secondary" className="text-[9px]">login ERP</Badge>}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">Ninguém neste posto.</p>}
    </div>
  );
}
