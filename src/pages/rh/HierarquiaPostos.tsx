import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRightLeft, Briefcase, Building2, CheckCircle2, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Crown, GitBranch,
  History, Loader2, Network, RefreshCw, RotateCcw, Search, ShieldAlert, UserMinus, UserPlus, UserX, Users, X,
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
import {
  useHierarquiaPostos, useMoverPosto, useOcupantePosto, useSincronizarPostos, useVagasPosto, useVoltarPostoSenior,
} from "@/hooks/useHierarquiaPostos";
import {
  buscarOcupantes, caminho, contratosDoPosto, contratosSemResponsavel, filtrarArvore, lideres, podeMover, responsaveisPorContrato, resumo,
  tituloDeLideranca, type Hierarquia, type NoPosto, type Ocupante,
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
//
// 08/10/2026 (mig 20261008000005) — pedido do Pablo: "tem que ser possível
// editar as informações da hierarquia, ajustar tudo, trocar os encarregados
// etc., tudo conectado com a EMPREGADOS — as pessoas selecionadas, nada
// digitado". No detalhe do posto: colocar, trocar e tirar pessoas
// (escolhidas da EMPREGADOS), voltar ao posto da Senior, vagas e o lugar do
// posto. Trocar pessoa é AJUSTE do ERP (a sincronia reescreve o posto da
// Senior). E a hierarquia passou a valer no ponto: o responsável de cada
// contrato (aba Contratos) é quem dá o OK na Conferência de Ponto.
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
            <th className="px-3 py-2" title="Quem dá o OK do ponto do contrato na Conferência de Ponto">Responsável pelo ponto</th>
            <th className="px-3 py-2">Líder(es) direto(s)</th><th className="px-3 py-2">Cadeia acima</th>
          </tr></thead>
          <tbody>
            {rs.map((c) => {
              const cadeia = c.lideres[0] ? caminho(h, c.lideres[0].codigo).slice(0, -1) : [];
              return (
                <tr key={c.chave} className="border-t border-border/60 align-top">
                  <td className="px-3 py-1.5 font-medium">{c.contrato}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.postos}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(c.colaboradores)}</td>
                  <td className="px-3 py-1.5">
                    {c.responsaveis.length ? c.responsaveis.map((r) => (
                      <button key={`${r.posto}-${r.ocupante.id}`} type="button" className="flex items-center gap-1 text-left hover:underline" onClick={() => onAbrir(r.posto)}
                        title={`${r.posto} · ${h.porCodigo.get(r.posto)?.titulo ?? ""}`}>
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                        <span className="font-medium">{r.ocupante.nome}</span>
                        {!r.ocupante.temLogin && <Badge variant="outline" className="border-warning/50 text-[9px] text-warning" title="Sem login vinculado: não consegue dar o OK no ERP">sem login</Badge>}
                      </button>
                    )) : <span className="text-destructive">ninguém</span>}
                  </td>
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
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Responsável pelo ponto = quem ocupa o posto de liderança mais próximo acima dos postos do contrato (posto vago passa para o de cima); é quem dá o OK na Conferência de Ponto dos encarregados.
        Os postos de liderança do próprio contrato só contam se ele não tiver outros postos ocupados. Líder direto = o posto de liderança logo acima de cada posto.
        Contrato pelo código empresa + filial do posto (cadastro CONTRATOS).
      </p>
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
  const semResp = contratosSemResponsavel(h);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="border-b border-border px-3 py-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-destructive" /> Contratos ativos sem responsável pelo ponto ({semResp.length})</p>
          <p className="text-[11px] text-muted-foreground">Nenhum posto do contrato está abaixo de um líder ocupado: ninguém dá o OK do encarregado — o Operacional terá que marcar no lugar.</p>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs"><tbody>
            {semResp.map((c) => <tr key={c.chave} className="border-t border-border/60"><td className="px-3 py-1">{c.nome}</td><td className="px-3 py-1 text-right font-mono text-[10px] text-muted-foreground">{c.chave}</td></tr>)}
            {!semResp.length && <tr><td className="px-3 py-6 text-center text-muted-foreground">Todo contrato ativo tem responsável.</td></tr>}
          </tbody></table>
        </div>
      </Card>
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
        <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Posto</th><th className="px-3 py-2">O que mudou</th><th className="px-3 py-2">Motivo</th><th className="px-3 py-2">Quem</th></tr></thead>
        <tbody>
          {h.historico.map((x) => {
            const t = (c: string | null | undefined, vazio = "fora da hierarquia") => (c ? `${c} ${h.porCodigo.get(c)?.titulo ?? ""}` : vazio);
            const mudou = x.tipo === "ocupante" ? <><b>{x.empregado_nome ?? `#${x.empregado_id}`}</b>: {t(x.valor_antes, "sem posto")} → {t(x.valor_depois, "sem posto")}</>
              : x.tipo === "vagas" ? <>Vagas: {x.valor_antes ?? "—"} → {x.valor_depois ?? "—"}</>
              : <>Lugar: abaixo de {t(x.pai_antes)} → {t(x.pai_depois)}</>;
            return (
              <tr key={x.id} className="border-t border-border/60">
                <td className="px-3 py-1.5 text-muted-foreground">{new Date(x.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="px-3 py-1.5">{t(x.posto_codigo)}</td><td className="px-3 py-1.5">{mudou}</td>
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
  const respPor = contratosDoPosto(h, n.codigo);
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
          {respPor.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2 dark:bg-emerald-950/20">
              <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Responsável pelo ponto de</p>
              <div className="flex flex-wrap gap-1">{respPor.map((c) => <Badge key={c.chave} variant="outline" className="border-emerald-300 text-[10px]">{c.nome}</Badge>)}</div>
              <p className="mt-1 text-[10px] text-muted-foreground">Quem está neste posto dá o OK do encarregado na Conferência de Ponto destes contratos.</p>
            </div>
          )}
          <OcupantesEditaveis key={`oc-${n.codigo}`} h={h} n={n} />
          {h.podeAlterar && <EditarVagas key={`vg-${n.codigo}-${n.vagas}`} n={n} />}
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

// ---- Quem está no posto (com edição) --------------------------------------------------

type ModoOcupante = { tipo: "colocar" } | { tipo: "trocar"; sai: Ocupante } | { tipo: "tirar"; sai: Ocupante };

/**
 * A lista de quem ocupa o posto e, para quem pode alterar a hierarquia, as
 * três mudanças: colocar alguém, trocar alguém por outro (o caso do
 * "trocar o encarregado") e tirar alguém. A pessoa sempre vem da EMPREGADOS
 * (SeletorColaborador) — não há campo de nome livre. Tudo vira ajuste do
 * ERP; "voltar ao da Senior" desfaz.
 */
function OcupantesEditaveis({ h, n }: { h: Hierarquia; n: NoPosto }) {
  const [modo, setModo] = useState<ModoOcupante | null>(null);
  const [entra, setEntra] = useState<Ocupante | null>(null);
  const [motivo, setMotivo] = useState("");
  const ocupante = useOcupantePosto();
  const voltar = useVoltarPostoSenior();
  const ocupado = ocupante.isPending || voltar.isPending;
  const fechar = () => { setModo(null); setEntra(null); setMotivo(""); };
  const abrir = (m: ModoOcupante) => { setModo(m); setEntra(null); setMotivo(""); };

  const confirmar = () => {
    if (!modo) return;
    if (modo.tipo !== "tirar" && !entra) { toast.error("Escolha o colaborador."); return; }
    const sai = modo.tipo === "colocar" ? null : modo.sai.id;
    ocupante.mutate({ posto: n.codigo, entra: modo.tipo === "tirar" ? null : entra!.id, sai, motivo }, {
      onSuccess: () => {
        toast.success(modo.tipo === "trocar" ? `${modo.sai.nome} trocado por ${entra!.nome}.` : modo.tipo === "tirar" ? `${modo.sai.nome} saiu do posto.` : `${entra!.nome} colocado no posto.`);
        fechar();
      },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  const tituloPosto = (c: string | null) => (c ? `${c}${h.porCodigo.get(c) ? ` · ${h.porCodigo.get(c)!.titulo}` : ""}` : "sem posto");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Quem está neste posto ({n.ocupantes.length})</p>
        {h.podeAlterar && !modo && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => abrir({ tipo: "colocar" })}><UserPlus className="h-3.5 w-3.5" /> Colocar pessoa</Button>
        )}
      </div>
      {n.ocupantes.length ? (
        <ul className="max-h-72 space-y-1 overflow-auto">
          {n.ocupantes.map((o) => (
            <li key={o.id} className="rounded-md border border-border/60 px-2 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{o.nome} <span className="text-muted-foreground">· cad. {o.cadastro ?? "—"}</span></span>
                <span className="flex shrink-0 items-center gap-1">
                  {o.situacao && o.situacao !== "Trabalhando" && <Badge variant="outline" className="text-[9px]">{o.situacao}</Badge>}
                  {o.temLogin ? <Badge variant="secondary" className="text-[9px]">login ERP</Badge> : null}
                  {h.podeAlterar && !modo && (
                    <>
                      <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[10px]" title="Trocar por outra pessoa" onClick={() => abrir({ tipo: "trocar", sai: o })}><ArrowRightLeft className="h-3 w-3" /> Trocar</Button>
                      <Button size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[10px] text-destructive" title="Tirar deste posto" onClick={() => abrir({ tipo: "tirar", sai: o })}><UserMinus className="h-3 w-3" /></Button>
                    </>
                  )}
                </span>
              </div>
              {o.ajustado && (
                <div className="mt-1 flex items-center justify-between gap-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="truncate">Ajustado no ERP · na Senior: {tituloPosto(o.postoSenior)}</span>
                  {h.podeAlterar && (
                    <button type="button" className="flex shrink-0 items-center gap-0.5 font-semibold hover:underline" disabled={ocupado}
                      onClick={() => voltar.mutate({ empregado: o.id }, { onSuccess: () => toast.success(`${o.nome} voltou ao posto da Senior.`), onError: (e) => toast.error((e as Error).message) })}>
                      <RotateCcw className="h-3 w-3" /> voltar ao da Senior
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">Ninguém neste posto.</p>}

      {modo && (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">
              {modo.tipo === "colocar" ? "Colocar pessoa neste posto" : modo.tipo === "trocar" ? `Trocar ${modo.sai.nome} por…` : `Tirar ${modo.sai.nome} deste posto?`}
            </p>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={fechar} aria-label="Cancelar"><X className="h-3.5 w-3.5" /></Button>
          </div>
          {modo.tipo === "tirar" ? (
            <p className="text-[11px] text-muted-foreground">Fica sem posto no ERP{modo.sai.postoSenior ? ` (a Senior continua dizendo ${modo.sai.postoSenior})` : ""}. Dá para desfazer com "voltar ao da Senior".</p>
          ) : (
            <SeletorColaborador h={h} escolhido={entra} onEscolher={setEntra} postoAtual={n.codigo} />
          )}
          {modo.tipo === "trocar" && <p className="text-[11px] text-muted-foreground">{modo.sai.nome} sai do posto e fica sem posto no ERP; quem entra deixa o posto em que está hoje.</p>}
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivo (opcional, fica no histórico)" className="text-xs" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={fechar}>Cancelar</Button>
            <Button size="sm" className="h-8 text-xs" variant={modo.tipo === "tirar" ? "destructive" : "default"} disabled={ocupado || (modo.tipo !== "tirar" && !entra)} onClick={confirmar}>
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : modo.tipo === "colocar" ? "Colocar no posto" : modo.tipo === "trocar" ? "Trocar" : "Tirar do posto"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Vale no ERP (hierarquia e ponto) e fica no histórico. Na Senior, ajuste também quando for oficial.</p>
        </div>
      )}
    </div>
  );
}

/** Escolha de colaborador ativo da EMPREGADOS: busca por nome/cadastro/cargo e clique — sem nome digitado à mão. */
function SeletorColaborador({ h, escolhido, onEscolher, postoAtual }: {
  h: Hierarquia; escolhido: Ocupante | null; onEscolher: (o: Ocupante | null) => void; postoAtual: string;
}) {
  const [busca, setBusca] = useState("");
  const achados = useMemo(() => buscarOcupantes(h, busca), [h, busca]);
  if (escolhido) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-xs">
        <div className="min-w-0">
          <p className="truncate font-semibold">{escolhido.nome}</p>
          <p className="truncate text-[10px] text-muted-foreground">cad. {escolhido.cadastro ?? "—"} · {escolhido.cargo ?? "—"} · hoje em {escolhido.posto ? `${escolhido.posto} ${h.porCodigo.get(escolhido.posto)?.titulo ?? ""}` : "nenhum posto"}</p>
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => onEscolher(null)}>trocar</Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
        <Input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar colaborador ativo (nome, cadastro, cargo)…" className="h-8 pl-8 text-xs" />
      </div>
      {busca.trim().length >= 2 && (
        <ul className="max-h-56 overflow-auto rounded-md border bg-background">
          {achados.map((o) => (
            <li key={o.id}>
              <button type="button" disabled={o.posto === postoAtual} onClick={() => onEscolher(o)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
                <span className="min-w-0 truncate">{o.nome} <span className="text-muted-foreground">· cad. {o.cadastro ?? "—"} · {o.cargo ?? "—"}</span></span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{o.posto === postoAtual ? "já está aqui" : o.posto ?? "sem posto"}</span>
              </button>
            </li>
          ))}
          {!achados.length && <li className="px-2 py-2 text-xs text-muted-foreground">Ninguém ativo com esse nome.</li>}
        </ul>
      )}
    </div>
  );
}

function EditarVagas({ n }: { n: NoPosto }) {
  const [vagas, setVagas] = useState(n.vagas != null ? String(n.vagas) : "");
  const salvar = useVagasPosto();
  const novo = vagas.trim() === "" ? null : Number(vagas);
  const mudou = novo !== (n.vagas ?? null);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs">
      <span className="font-semibold text-muted-foreground">Vagas do posto</span>
      <Input type="number" min={0} value={vagas} onChange={(e) => setVagas(e.target.value)} className="h-7 w-20 text-xs" />
      <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={!mudou || salvar.isPending || (novo != null && (!Number.isInteger(novo) || novo < 0))}
        onClick={() => salvar.mutate({ posto: n.codigo, vagas: novo }, { onSuccess: () => toast.success("Vagas atualizadas."), onError: (e) => toast.error((e as Error).message) })}>
        {salvar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
      </Button>
      <span className="text-[10px] text-muted-foreground">vieram da planilha da Senior; a busca de postos novos não reescreve</span>
    </div>
  );
}
