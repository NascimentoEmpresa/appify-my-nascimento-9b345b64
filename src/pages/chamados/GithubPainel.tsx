import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowLeft, Database, ExternalLink, FileCode2, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed,
  Loader2, Minus, Plus, RefreshCw, Search, ShieldAlert, Timer, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGithubPainel, useSincronizarGithub, type ProgressoSync } from "@/hooks/useGithubPainel";
import {
  calendario, contadores, ehBot, filtrarPainel, FILTRO_GITHUB_PADRAO, fmtHoras, fmtN, mensalPrs, porAutor, porBranch, punchcard, semanal,
  type FiltroGithub, type LinhaAutor, type PainelGithub, type PrGithub,
} from "@/lib/sistemas/githubPainel";

// =====================================================================
// PAINEL DO DESENVOLVEDOR › GITHUB (mig 20261007000022, 07/10/2026)
//
// Pedido do Pablo: "painel completo tipo dashboard do GitHub: todos os
// commits e PRs já lançadas, contadores, quem movimenta mais o BD".
// Lê o cache do banco (dev_github_painel); "Sincronizar com o GitHub" chama
// a Edge dev-github-sync em lotes. Contas em src/lib/sistemas/githubPainel.ts.
// =====================================================================

const REPO_URL = "https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64";
const VERDES = ["hsl(var(--muted))", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const CORES = ["#2563eb", "#16a34a", "#db2777", "#f59e0b", "#7c3aed", "#94a3b8"];
const COR_ESTADO: Record<string, string> = { merged: "#8250df", open: "#1a7f37", closed: "#cf222e" };
const ROTULO_ESTADO: Record<string, string> = { merged: "Mergeada", open: "Aberta", closed: "Fechada" };
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const PERIODOS = [{ v: "30", r: "30 dias" }, { v: "90", r: "90 dias" }, { v: "365", r: "12 meses" }, { v: "todos", r: "Tudo" }];
const fmtData = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("pt-BR") : "—");
const fmtDataHora = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const avatarDe = (autor: string, avatar?: string | null) => avatar || (/^[A-Za-z0-9-]+$/.test(autor) ? `https://github.com/${autor}.png?size=48` : null);

export default function GithubPainel() {
  const nav = useNavigate();
  const q = useGithubPainel();
  const [prog, setProg] = useState<ProgressoSync | null>(null);
  const sync = useSincronizarGithub(setProg);
  const [filtro, setFiltro] = useState<FiltroGithub>(FILTRO_GITHUB_PADRAO);
  const p = useMemo(() => (q.data ? filtrarPainel(q.data, filtro) : undefined), [q.data, filtro]);
  const autores = useMemo(() => (q.data ? porAutor(q.data).filter((a) => !filtro.semBots || !a.bot).map((a) => a.autor) : []), [q.data, filtro.semBots]);

  const sincronizar = () => {
    setProg(null);
    sync.mutate(60, {
      onSuccess: (r) => toast.success(`GitHub sincronizado: ${r.novas} PR(s) novas/alteradas, ${r.detalhadas} detalhadas${r.pendentes ? ` — faltam ${r.pendentes}, clique de novo` : ""}.`),
      onError: (e) => toast.error((e as Error).message),
      onSettled: () => setProg(null),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="GitHub — Repositório do ERP"
        subtitle="Commits, pull requests, contribuidores e quem mais mexe no banco"
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor", "GitHub"]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => nav("/app/sistemas/chamados/dev")} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Painel</Button>
            <Button variant="outline" asChild className="gap-1.5"><a href={REPO_URL} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Abrir no GitHub</a></Button>
            <Button onClick={sincronizar} disabled={sync.isPending} className="gap-1.5">
              {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar com o GitHub
            </Button>
          </div>
        }
      />

      <Card className="flex flex-wrap items-center gap-3 p-3 text-xs">
        <Select value={filtro.dias ? String(filtro.dias) : "todos"} onValueChange={(v) => setFiltro((f) => ({ ...f, dias: v === "todos" ? null : Number(v) }))}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{PERIODOS.map((x) => <SelectItem key={x.v} value={x.v}>{x.r}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filtro.autor ?? "*"} onValueChange={(v) => setFiltro((f) => ({ ...f, autor: v === "*" ? null : v }))}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="*">Todos os contribuidores</SelectItem>
            {autores.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-muted-foreground"><Switch checked={filtro.semBots} onCheckedChange={(c) => setFiltro((f) => ({ ...f, semBots: c }))} /> Esconder bots</label>
        <span className="ml-auto text-muted-foreground">
          {sync.isPending && prog ? `Sincronizando… lote ${prog.lote}: ${prog.detalhadas} PRs detalhadas, faltam ${prog.pendentes}` :
            q.data?.sync?.ultima_em ? `Última sincronização: ${fmtDataHora(q.data.sync.ultima_em)}${q.data.sync.ultima_por ? ` por ${q.data.sync.ultima_por}` : ""}` : "Ainda não sincronizado"}
          {q.data?.pendentes ? ` · ${q.data.pendentes} PR(s) sem detalhe` : ""}
        </span>
      </Card>
      {q.data?.sync?.ultimo_erro && <p className="text-xs text-destructive">Último erro da sincronização: {q.data.sync.ultimo_erro}</p>}

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>
      ) : q.error || !p ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : !q.data!.prs.length ? (
        <Card className="space-y-2 p-8 text-center">
          <GitPullRequest className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">Nenhum dado do GitHub ainda</p>
          <p className="text-xs text-muted-foreground">Clique em <b>Sincronizar com o GitHub</b> para trazer as PRs e os commits do repositório. A primeira carga é feita em lotes e pode levar alguns minutos.</p>
        </Card>
      ) : (
        <Conteudo p={p} />
      )}
    </div>
  );
}

function Conteudo({ p }: { p: PainelGithub }) {
  const c = useMemo(() => contadores(p), [p]);
  const autores = useMemo(() => porAutor(p), [p]);
  const kpis: { icone: typeof Users; rotulo: string; valor: string; dica?: string; cor?: string }[] = [
    { icone: GitCommitHorizontal, rotulo: "Commits", valor: fmtN(c.commits), dica: `${fmtN(c.diasComCommit)} dias com commit` },
    { icone: GitPullRequest, rotulo: "Pull requests", valor: fmtN(c.prs), dica: `${fmtN(c.abertas)} abertas${c.rascunhos ? ` (${c.rascunhos} rascunho)` : ""}`, cor: COR_ESTADO.open },
    { icone: GitMerge, rotulo: "Mergeadas", valor: fmtN(c.mergeadas), dica: `${c.prs ? Math.round((c.mergeadas / c.prs) * 100) : 0}% das PRs`, cor: COR_ESTADO.merged },
    { icone: GitPullRequestClosed, rotulo: "Fechadas sem merge", valor: fmtN(c.fechadasSemMerge), cor: COR_ESTADO.closed },
    { icone: Timer, rotulo: "Tempo até o merge", valor: fmtHoras(c.medianaHorasAteMerge), dica: "mediana, da abertura ao merge" },
    { icone: Plus, rotulo: "Linhas adicionadas", valor: fmtN(c.adicoes), cor: "#1a7f37" },
    { icone: Minus, rotulo: "Linhas removidas", valor: fmtN(c.remocoes), cor: "#cf222e" },
    { icone: Database, rotulo: "Migrations criadas", valor: fmtN(c.migrations), dica: `${fmtN(c.linhasSql)} linhas de SQL` },
    { icone: Users, rotulo: "Contribuidores", valor: fmtN(c.contribuidores), dica: `${fmtN(c.arquivos)} arquivos alterados` },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.rotulo} className="p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><k.icone className="h-3.5 w-3.5" style={k.cor ? { color: k.cor } : undefined} /> {k.rotulo}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums" style={k.cor ? { color: k.cor } : undefined}>{k.valor}</p>
            {k.dica && <p className="text-[11px] text-muted-foreground">{k.dica}</p>}
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        PRs com chamado (SIS-…): <b className="text-foreground">{fmtN(c.comChamado)}</b> · sem chamado: <b className="text-foreground">{fmtN(c.semChamado)}</b>
        {c.mediaCommitsPorPr != null && <> · média de {c.mediaCommitsPorPr.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} commits por PR</>}
      </p>

      <CalendarioContribuicoes p={p} />

      <div className="grid gap-4 lg:grid-cols-2">
        <GraficoSemanal p={p} />
        <GraficoMensalPrs p={p} />
      </div>

      <Contribuidores autores={autores} />

      <div className="grid gap-4 lg:grid-cols-3">
        <QuemMexeNoBanco autores={autores} p={p} />
        <Branches p={p} />
      </div>

      <Punchcard p={p} />

      <Tabs defaultValue="prs">
        <TabsList>
          <TabsTrigger value="prs" className="gap-1.5"><GitPullRequest className="h-3.5 w-3.5" /> Pull requests</TabsTrigger>
          <TabsTrigger value="commits" className="gap-1.5"><GitCommitHorizontal className="h-3.5 w-3.5" /> Commits</TabsTrigger>
        </TabsList>
        <TabsContent value="prs"><ListaPrs prs={p.prs} /></TabsContent>
        <TabsContent value="commits"><ListaCommits p={p} /></TabsContent>
      </Tabs>
    </>
  );
}

// ---- Calendário estilo GitHub ------------------------------------------------------------

function CalendarioContribuicoes({ p }: { p: PainelGithub }) {
  const sem = useMemo(() => calendario(p.commits), [p]);
  const total = sem.flat().reduce((s, x) => s + x.n, 0);
  const rotulos = sem.map((col, i) => {
    const m = Number(col[0].dia.slice(5, 7)) - 1;
    const anterior = i > 0 ? Number(sem[i - 1][0].dia.slice(5, 7)) - 1 : -1;
    return m !== anterior ? MESES[m] : "";
  });
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-semibold">{fmtN(total)} commits nos últimos 12 meses</p>
      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          <div className="ml-8 flex gap-[3px] text-[10px] text-muted-foreground">
            {rotulos.map((r, i) => <span key={i} className="w-[11px] overflow-visible whitespace-nowrap">{r}</span>)}
          </div>
          <div className="flex gap-[3px]">
            <div className="mr-1 flex w-7 flex-col gap-[3px] text-[10px] text-muted-foreground">
              {DIAS.map((d, i) => <span key={d} className="h-[11px] leading-[11px]">{i % 2 ? d : ""}</span>)}
            </div>
            {sem.map((col, i) => (
              <div key={i} className="flex flex-col gap-[3px]">
                {col.map((cel) => (
                  <div key={cel.dia} title={cel.futuro ? "" : `${cel.n} commit(s) em ${fmtData(cel.dia + "T12:00:00")}`}
                    className="h-[11px] w-[11px] rounded-[2px]"
                    style={{ background: cel.futuro ? "transparent" : VERDES[cel.nivel], outline: cel.futuro ? "none" : "1px solid hsl(var(--border) / 0.4)" }} />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            Menos {VERDES.map((c, i) => <span key={i} className="h-[11px] w-[11px] rounded-[2px]" style={{ background: c }} />)} Mais
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---- Gráficos ------------------------------------------------------------------------------

function GraficoSemanal({ p }: { p: PainelGithub }) {
  const s = useMemo(() => semanal(p.commits, 26), [p]);
  const dados = s.dados.map((d) => ({ ...d, rotulo: `${String(d.semana).slice(8, 10)}/${String(d.semana).slice(5, 7)}` }));
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-semibold">Commits por semana (26 semanas)</p>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={dados} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval={3} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {s.series.map((a, i) => <Area key={a} type="monotone" dataKey={a} stackId="1" stroke={CORES[i % CORES.length]} fill={CORES[i % CORES.length]} fillOpacity={0.55} />)}
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

function GraficoMensalPrs({ p }: { p: PainelGithub }) {
  const dados = useMemo(() => mensalPrs(p.prs).map((m) => ({ ...m, rotulo: `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(2, 4)}` })), [p]);
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-semibold">Pull requests por mês</p>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
          <YAxis yAxisId="n" tick={{ fontSize: 10 }} allowDecimals={false} />
          <YAxis yAxisId="m" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar yAxisId="n" dataKey="abertas" name="Abertas no mês" fill="#94a3b8" radius={[3, 3, 0, 0]} />
          <Bar yAxisId="n" dataKey="mergeadas" name="Mergeadas" fill={COR_ESTADO.merged} radius={[3, 3, 0, 0]} />
          <Line yAxisId="m" dataKey="migrations" name="Migrations" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ---- Contribuidores ------------------------------------------------------------------------------
// Histórico por pessoa, em ordem alfabética — sem posição, medalha, barra
// nem "maior sequência": o painel é registro do trabalho, não competição
// (pedido do Pablo, 09/10/2026).

function Avatar({ autor, avatar }: { autor: string; avatar?: string | null }) {
  const src = avatarDe(autor, avatar);
  return src
    ? <img src={src} alt="" className="h-6 w-6 rounded-full border border-border" loading="lazy" />
    : <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[10px] font-bold">{autor.slice(0, 2).toUpperCase()}</span>;
}

function Contribuidores({ autores }: { autores: LinhaAutor[] }) {
  const linhas = [...autores].sort((a, b) => a.autor.localeCompare(b.autor, "pt-BR", { sensitivity: "base" }));
  return (
    <Card className="overflow-hidden">
      <p className="flex items-center gap-1.5 border-b border-border px-4 py-2.5 text-sm font-semibold"><Users className="h-4 w-4 text-muted-foreground" /> Contribuidores <span className="font-normal text-muted-foreground">— histórico por pessoa</span></p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-muted/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2">Contribuidor</th>
            {["Commits", "PRs", "Mergeadas", "+ linhas", "− linhas", "Migrations", "Dias com commit"].map((r) => <th key={r} className="px-3 py-2 text-right">{r}</th>)}
            <th className="px-3 py-2">Primeiro commit</th><th className="px-3 py-2">Último commit</th>
          </tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.autor} className="border-t border-border/60">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar autor={l.autor} avatar={l.avatar} />
                    <p className="font-medium">{l.autor}{l.bot && <Badge variant="secondary" className="ml-1 text-[9px]">bot</Badge>}</p>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(l.commits)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(l.prs)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(l.mergeadas)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">+{fmtN(l.adicoes)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">−{fmtN(l.remocoes)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(l.migrations)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtN(l.diasAtivos)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{fmtDataHora(l.primeiro)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{fmtDataHora(l.ultimo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">Commits contam pelo autor do commit (login do GitHub; sem login, o nome do git). PRs, linhas e migrations contam pelo autor da PR.</p>
    </Card>
  );
}

// ---- Banco de dados ------------------------------------------------------------------------------

function QuemMexeNoBanco({ autores, p }: { autores: LinhaAutor[]; p: PainelGithub }) {
  const dados = autores.filter((a) => a.migrations > 0).sort((a, b) => a.autor.localeCompare(b.autor, "pt-BR", { sensitivity: "base" }))
    .map((a) => ({ nome: a.autor, migrations: a.migrations, linhas: a.linhasSql }));
  const recentes = useMemo(() => p.prs.filter((x) => x.migrations_lista?.length)
    .flatMap((x) => (x.migrations_lista ?? []).map((m) => ({ m, pr: x.numero, autor: x.autor_login ?? "?", data: x.mergeado_em ?? x.criado_em, url: x.url })))
    .sort((a, b) => b.m.localeCompare(a.m)).slice(0, 40), [p]);
  return (
    <Card className="p-4 lg:col-span-2">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Database className="h-4 w-4 text-primary" /> Migrations por pessoa</p>
      <p className="mb-3 text-[11px] text-muted-foreground">Migrations (.sql em supabase/migrations) adicionadas nas PRs de cada pessoa, e as linhas de SQL escritas.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {dados.length ? (
          <ResponsiveContainer width="100%" height={Math.max(200, dados.length * 34)}>
            <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="nome" width={110} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number, k: string) => [fmtN(v), k === "migrations" ? "Migrations" : "Linhas de SQL"]} />
              <Bar dataKey="migrations" radius={[0, 3, 3, 0]}>
                {dados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                <LabelList dataKey="migrations" position="right" fontSize={11} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma migration no período.</p>}
        <div className="max-h-72 overflow-auto rounded-md border border-border">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card"><tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-2 py-1.5">Migration</th><th className="px-2 py-1.5">Autor</th><th className="px-2 py-1.5">PR</th></tr></thead>
            <tbody>
              {recentes.map((r) => (
                <tr key={`${r.pr}-${r.m}`} className="border-t border-border/60">
                  <td className="max-w-[220px] truncate px-2 py-1 font-mono" title={r.m}><FileCode2 className="mr-1 inline h-3 w-3 text-muted-foreground" />{r.m}</td>
                  <td className="px-2 py-1">{r.autor}</td>
                  <td className="px-2 py-1">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">#{r.pr}</a> : `#${r.pr}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function Branches({ p }: { p: PainelGithub }) {
  const br = useMemo(() => porBranch(p.prs).slice(0, 8), [p]);
  const est = ["merged", "open", "closed"].map((e) => ({ nome: ROTULO_ESTADO[e], n: p.prs.filter((x) => x.estado === e).length, cor: COR_ESTADO[e] })).filter((x) => x.n);
  return (
    <Card className="p-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><GitBranch className="h-4 w-4" /> PRs por branch e estado</p>
      <ResponsiveContainer width="100%" height={150}>
        <PieChart>
          <Pie data={est} dataKey="n" nameKey="nome" innerRadius={38} outerRadius={62} paddingAngle={2}>{est.map((e) => <Cell key={e.nome} fill={e.cor} />)}</Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 space-y-1.5">
        {br.map((b) => (
          <div key={b.branch} className="text-xs">
            <div className="flex justify-between"><span className="font-mono">{b.branch}</span><span className="tabular-nums text-muted-foreground">{b.prs} PRs · {b.mergeadas} merge</span></div>
            <div className="mt-0.5 h-1.5 rounded bg-muted"><div className="h-full rounded" style={{ width: `${(b.prs / Math.max(1, br[0].prs)) * 100}%`, background: COR_ESTADO.merged }} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Punchcard({ p }: { p: PainelGithub }) {
  const g = useMemo(() => punchcard(p.commits), [p]);
  const max = Math.max(1, ...g.flat());
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-semibold">Quando os commits acontecem (dia × hora)</p>
      <div className="overflow-x-auto">
        <table className="text-[10px] text-muted-foreground">
          <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} className="w-6 font-normal">{h % 3 === 0 ? `${h}h` : ""}</th>)}</tr></thead>
          <tbody>
            {g.map((linha, d) => (
              <tr key={d}>
                <td className="pr-2 text-right">{DIAS[d]}</td>
                {linha.map((n, h) => (
                  <td key={h} className="p-[2px]" title={`${DIAS[d]} ${h}h: ${n} commit(s)`}>
                    <div className="mx-auto rounded-full bg-primary" style={{ width: 4 + (n / max) * 16, height: 4 + (n / max) * 16, opacity: n ? 0.25 + (n / max) * 0.75 : 0.08 }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Listas -------------------------------------------------------------------------------------------

function ListaPrs({ prs }: { prs: PrGithub[] }) {
  const [busca, setBusca] = useState("");
  const [estado, setEstado] = useState("todos");
  const [limite, setLimite] = useState(50);
  const t = busca.trim().toLowerCase();
  const lista = prs.filter((x) => (estado === "todos" || x.estado === estado)
    && (!t || `#${x.numero} ${x.titulo} ${x.autor_login ?? ""} ${x.chamado ?? ""} ${x.branch_origem ?? ""}`.toLowerCase().includes(t)));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative"><Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" /><Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº, título, autor, chamado…" className="h-8 w-72 pl-8 text-xs" /></div>
        {["todos", "open", "merged", "closed"].map((e) => (
          <Button key={e} size="sm" variant={estado === e ? "default" : "outline"} className="h-7 text-xs" onClick={() => setEstado(e)}>
            {e === "todos" ? "Todas" : ROTULO_ESTADO[e]} ({e === "todos" ? prs.length : prs.filter((x) => x.estado === e).length})
          </Button>
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {lista.slice(0, limite).map((x) => {
          const Icone = x.estado === "merged" ? GitMerge : x.estado === "closed" ? GitPullRequestClosed : GitPullRequest;
          return (
            <div key={x.numero} className="flex items-start gap-3 px-4 py-2.5 text-xs hover:bg-muted/30">
              <Icone className="mt-0.5 h-4 w-4 shrink-0" style={{ color: COR_ESTADO[x.estado] }} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{x.titulo}</a> : x.titulo}
                  {x.rascunho && <Badge variant="secondary" className="ml-1 text-[9px]">rascunho</Badge>}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  #{x.numero} · {x.autor_login ?? "?"} · <span className="font-mono">{x.branch_origem} → {x.branch_destino}</span> · aberta {fmtData(x.criado_em)}
                  {x.mergeado_em && <> · merge em {fmtData(x.mergeado_em)} ({fmtHoras((new Date(x.mergeado_em).getTime() - new Date(x.criado_em).getTime()) / 3_600_000)})</>}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-[11px] tabular-nums">
                {x.commits != null && <span className="text-muted-foreground"><GitCommitHorizontal className="mr-0.5 inline h-3 w-3" />{x.commits}</span>}
                {x.adicoes != null && <span className="text-[#1a7f37]">+{fmtN(x.adicoes)}</span>}
                {x.remocoes != null && <span className="text-[#cf222e]">−{fmtN(x.remocoes)}</span>}
                {!!x.migrations && <Badge variant="outline" className="gap-1 text-[10px]"><Database className="h-3 w-3" />{x.migrations}</Badge>}
                {x.commits == null && <Badge variant="secondary" className="text-[9px]">sem detalhe</Badge>}
              </div>
            </div>
          );
        })}
        {!lista.length && <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma PR com esses filtros.</p>}
      </div>
      {lista.length > limite && <div className="border-t border-border p-2 text-center"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLimite((l) => l + 100)}>Mostrar mais ({lista.length - limite})</Button></div>}
    </Card>
  );
}

function ListaCommits({ p }: { p: PainelGithub }) {
  const [limite, setLimite] = useState(80);
  const urlPr = new Map(p.prs.map((x) => [x.numero, x.url]));
  const commits = [...p.commits].sort((a, b) => b.data.localeCompare(a.data));
  let diaAnterior = "";
  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-border/60">
        {commits.slice(0, limite).map((c) => {
          const dia = fmtData(c.data);
          const cab = dia !== diaAnterior ? (diaAnterior = dia) : null;
          return (
            <div key={c.sha}>
              {cab && <p className="bg-muted/40 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><GitCommitHorizontal className="mr-1 inline h-3 w-3" />Commits em {cab}</p>}
              <div className="flex items-center gap-3 px-4 py-2 text-xs">
                <Avatar autor={c.autor} avatar={c.login ? null : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={c.mensagem}>{c.mensagem || "(sem mensagem)"}</p>
                  <p className="text-[11px] text-muted-foreground">{c.autor}{ehBot(c.autor) ? " (bot)" : ""} · {fmtDataHora(c.data)}</p>
                </div>
                {c.pr != null && (urlPr.get(c.pr) ? <a href={urlPr.get(c.pr)!} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">#{c.pr}</a> : <span className="text-[11px]">#{c.pr}</span>)}
                <code className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">{c.sha}</code>
              </div>
            </div>
          );
        })}
      </div>
      {commits.length > limite && <div className="border-t border-border p-2 text-center"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLimite((l) => l + 200)}>Mostrar mais ({commits.length - limite})</Button></div>}
    </Card>
  );
}
