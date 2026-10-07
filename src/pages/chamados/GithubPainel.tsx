import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, ExternalLink, GitCommitHorizontal, GitMerge, GitPullRequest, Loader2, Minus, Pencil, Plus, RefreshCw, ShieldAlert, Timer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useGithubDados, useSalvarNomeDev, useSincronizarGithub } from "@/hooks/useGithubPainel";
import {
  COR_OUTROS, CORES_DEV, PERIODOS_GH, fmtHoras, fmtLinhas, noPeriodo, porDev, rotuloPeriodoGh, serie, totais,
  type DevGithub, type LinhaDev, type PrGithub,
} from "@/lib/sistemas/githubPainel";

// =====================================================================
// SISTEMAS › CHAMADOS › PAINEL DO DESENVOLVEDOR › GitHub (07/10/2026,
// mig 20261007000015 + Edge github-painel-sync)
//
// "Quantas PRs um dev lançou, quantos commits, podendo ver dos outros,
// quantas linhas de código foram alteradas." Lê do banco (abre na hora); ao
// abrir, pede à Edge para trazer do GitHub o que mudou (no máximo a cada
// 15 min — o botão "Atualizar do GitHub" força). Cada dev tem uma cor fixa
// (ordem do ranking geral, não do filtro). Liberação: a do Painel do
// Desenvolvedor (chamados_sistemas_dev). Contas em src/lib/sistemas/githubPainel.ts.
// =====================================================================

const MENU = "chamados_sistemas_dev";
const REPO_URL = "https://github.com/NascimentoEmpresa/appify-my-nascimento-9b345b64";
const VERDE = "#16a34a", VERMELHO = "#dc2626";
const fmtN = (n: number) => n.toLocaleString("pt-BR");

export default function GithubPainel() {
  const nav = useNavigate();
  const q = useGithubDados();
  const sync = useSincronizarGithub();
  const [dias, setDias] = useState<number>(90);
  const [dev, setDev] = useState<string>("todos");
  const [editandoNomes, setEditandoNomes] = useState(false);

  // Ao abrir: traz do GitHub o que mudou (a Edge decide se precisa).
  const pediu = useRef(false);
  useEffect(() => {
    if (pediu.current) return;
    pediu.current = true;
    sync.mutate(false);
  }, [sync]);

  const d = q.data;
  // Cor por dev: ordem do ranking de TODO o histórico (estável entre filtros).
  const cores = useMemo(() => {
    const ordem = d ? porDev(d.prs, d.devs).map((x) => x.login) : [];
    return Object.fromEntries(ordem.map((l, i) => [l, CORES_DEV[i] ?? COR_OUTROS])) as Record<string, string>;
  }, [d]);
  const recorte = useMemo(() => {
    if (!d) return [] as PrGithub[];
    const p = noPeriodo(d.prs, dias);
    return dev === "todos" ? p : p.filter((x) => x.autor === dev);
  }, [d, dias, dev]);
  const ranking = useMemo(() => (d ? porDev(noPeriodo(d.prs, dias), d.devs) : []), [d, dias]);
  const t = useMemo(() => totais(recorte), [recorte]);
  const logins = useMemo(() => (dev === "todos" ? ranking.map((r) => r.login) : [dev]), [ranking, dev]);
  const nome = (l: string) => d?.devs.find((x) => x.login === l)?.nome || l;
  const porSemana = dias > 0 && dias <= 90;
  const sPrs = useMemo(() => serie(recorte, logins, () => 1, porSemana ? "semana" : "mes"), [recorte, logins, porSemana]);
  const sLinhas = useMemo(() => serie(recorte, logins, (p) => p.adicoes + p.remocoes, porSemana ? "semana" : "mes"), [recorte, logins, porSemana]);
  const sCommits = useMemo(() => serie(recorte, logins, (p) => p.commits, porSemana ? "semana" : "mes"), [recorte, logins, porSemana]);

  const syncPrs = d?.sync.find((s) => s.id === "prs")?.sincronizado_em;
  const atualizar = async () => {
    try {
      const r = await sync.mutateAsync(true);
      if (r.prs_erro || r.commits_erro) toast.warning(r.prs_erro || r.commits_erro); else toast.success(`GitHub atualizado — PRs: ${r.prs}.`);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="GitHub — desenvolvimento" subtitle="PRs, commits e linhas de código de cada dev, direto do repositório do ERP"
        module="Sistemas" breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor", "GitHub"]}
        actions={<Button variant="outline" onClick={() => nav("/app/sistemas/chamados/dev")} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Painel do Desenvolvedor</Button>} />
      <AcessoGate menu={MENU} acao="visualizar" fallback={<Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> Acesso restrito a desenvolvedores.</Card>}>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
            <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODOS_GH.map((p) => <SelectItem key={p.valor} value={String(p.valor)}>{p.rotulo}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={dev} onValueChange={setDev}>
            <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os devs</SelectItem>
              {(d?.devs ?? []).map((x) => <SelectItem key={x.login} value={x.login}>{x.nome}{x.nome !== x.login ? ` (${x.login})` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            {sync.isPending ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> buscando no GitHub…</span>
              : syncPrs ? `atualizado em ${new Date(syncPrs).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
          <Button size="sm" variant="outline" disabled={sync.isPending} onClick={atualizar}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Atualizar do GitHub</Button>
          <AcessoGate menu={MENU} acao="alterar"><Button size="sm" variant="ghost" onClick={() => setEditandoNomes(true)}><Pencil className="mr-1 h-3.5 w-3.5" /> Nomes</Button></AcessoGate>
        </div>

        {q.isLoading ? (
          <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>
        ) : q.error || !d ? (
          <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Numero icone={GitPullRequest} titulo="PRs abertas" valor={fmtN(t.prs)} dica={`${t.abertas} ainda em aberto`} />
              <Numero icone={GitMerge} titulo="Mergeadas" valor={fmtN(t.mergeadas)} dica={t.prs ? `${Math.round((t.mergeadas * 100) / t.prs)}% das PRs` : "—"} />
              <Numero icone={GitCommitHorizontal} titulo="Commits" valor={fmtN(t.commits)} dica="nas PRs do período" />
              <Numero icone={Plus} titulo="Linhas adicionadas" valor={fmtLinhas(t.adicoes)} dica={`${fmtN(t.arquivos)} arquivos alterados`} cor={VERDE} />
              <Numero icone={Minus} titulo="Linhas removidas" valor={fmtLinhas(t.remocoes)} dica={`saldo ${fmtLinhas(t.adicoes - t.remocoes)}`} cor={VERMELHO} />
              <Numero icone={Timer} titulo="Até o merge" valor={fmtHoras(t.horasAteMerge)} dica="mediana, da abertura ao merge" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <GraficoDevs titulo={`PRs por ${porSemana ? "semana" : "mês"}`} dados={sPrs} logins={logins} cores={cores} nome={nome} />
              <GraficoDevs titulo={`Commits por ${porSemana ? "semana" : "mês"}`} subtitulo="commits das PRs abertas no período" dados={sCommits} logins={logins} cores={cores} nome={nome} />
            </div>
            <GraficoDevs titulo={`Linhas alteradas por ${porSemana ? "semana" : "mês"}`} subtitulo="adicionadas + removidas, somadas das PRs" dados={sLinhas} logins={logins} cores={cores} nome={nome} formatar={fmtLinhas} altura={240} />

            <Ranking linhas={dev === "todos" ? ranking : ranking.filter((r) => r.login === dev)} cores={cores} />
            <UltimasPrs prs={recorte.slice(0, 20)} cores={cores} nome={nome} />
            <CommitsMain semanas={d.semanas} sync={d.sync.find((s) => s.id === "commits")?.sincronizado_em ?? null} nome={nome} cores={cores} />
          </>
        )}
        <DialogNomes aberto={editandoNomes} onClose={() => setEditandoNomes(false)} devs={d?.devs ?? []} />
      </AcessoGate>
    </div>
  );
}

function Numero({ icone: Icone, titulo, valor, dica, cor }: { icone: typeof Plus; titulo: string; valor: string; dica: string; cor?: string }) {
  return (
    <Card className="p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icone className="h-3.5 w-3.5" /> {titulo}</p>
      <p className="mt-1 text-2xl font-black tabular-nums" style={cor ? { color: cor } : undefined}>{valor}</p>
      <p className="truncate text-[11px] text-muted-foreground">{dica}</p>
    </Card>
  );
}

function GraficoDevs({ titulo, subtitulo, dados, logins, cores, nome, formatar = fmtN, altura = 220 }: {
  titulo: string; subtitulo?: string; dados: Record<string, number | string>[]; logins: string[]; cores: Record<string, string>;
  nome: (l: string) => string; formatar?: (n: number) => string; altura?: number;
}) {
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold">{titulo}</p>
      {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
      {dados.length === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">Nada no período.</p> : (
        <ResponsiveContainer width="100%" height={altura}>
          <BarChart data={dados} margin={{ top: 12, right: 8, left: -8, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="periodo" tickFormatter={(v) => rotuloPeriodoGh(String(v))} tick={{ fontSize: 11 }} minTickGap={8} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatar(Number(v))} allowDecimals={false} width={48} />
            <Tooltip labelFormatter={(l) => rotuloPeriodoGh(String(l))} formatter={(v: number, n: string) => [formatar(v), nome(n)]} />
            {logins.length > 1 && <Legend formatter={(v) => nome(String(v))} wrapperStyle={{ fontSize: 11 }} />}
            {logins.map((l) => <Bar key={l} dataKey={l} name={l} fill={cores[l] ?? COR_OUTROS} radius={[3, 3, 0, 0]} stroke="hsl(var(--card))" strokeWidth={1} />)}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function Ranking({ linhas, cores }: { linhas: LinhaDev[]; cores: Record<string, string> }) {
  const maxLinhas = Math.max(...linhas.map((l) => l.adicoes + l.remocoes), 1);
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 pt-4"><p className="text-sm font-semibold">Por dev no período</p><p className="text-xs text-muted-foreground">PRs abertas no período escolhido; linhas e commits vêm dessas PRs</p></div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Dev</th><th className="px-2 py-2 text-right font-medium">PRs</th><th className="px-2 py-2 text-right font-medium">Mergeadas</th>
              <th className="px-2 py-2 text-right font-medium">Em aberto</th><th className="px-2 py-2 text-right font-medium">Commits</th>
              <th className="px-2 py-2 font-medium">Linhas (+ / −)</th><th className="px-2 py-2 text-right font-medium">Arquivos</th>
              <th className="px-2 py-2 text-right font-medium">Linhas/PR</th><th className="px-4 py-2 text-right font-medium">Até o merge</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.login} className="border-t">
                <td className="px-4 py-2"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: cores[l.login] ?? COR_OUTROS }} /><b>{l.nome}</b>{l.nome !== l.login && <span className="text-muted-foreground">{l.login}</span>}</span></td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtN(l.prs)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtN(l.mergeadas)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{l.abertas || "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtN(l.commits)}</td>
                <td className="min-w-48 px-2 py-2">
                  <div className="flex items-center gap-2 tabular-nums"><span style={{ color: VERDE }}>+{fmtLinhas(l.adicoes)}</span><span style={{ color: VERMELHO }}>−{fmtLinhas(l.remocoes)}</span></div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted" style={{ width: `${Math.max(4, ((l.adicoes + l.remocoes) / maxLinhas) * 100)}%` }}>
                    <div style={{ width: `${(l.adicoes / Math.max(1, l.adicoes + l.remocoes)) * 100}%`, background: VERDE }} /><div className="flex-1" style={{ background: VERMELHO }} />
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtN(l.arquivos)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtN(l.linhasPorPr)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtHoras(l.horasAteMerge)}</td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">Nenhuma PR no período.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const SELO: Record<string, string> = { MERGED: "Mergeada", OPEN: "Aberta", CLOSED: "Fechada" };

function UltimasPrs({ prs, cores, nome }: { prs: PrGithub[]; cores: Record<string, string>; nome: (l: string) => string }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 pt-4"><p className="text-sm font-semibold">Últimas PRs</p></div>
      <div className="mt-3 max-h-[420px] overflow-auto">
        <table className="w-full text-xs">
          <tbody>
            {prs.map((p) => (
              <tr key={p.numero} className="border-t">
                <td className="whitespace-nowrap px-4 py-1.5"><a href={`${REPO_URL}/pull/${p.numero}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">#{p.numero}<ExternalLink className="h-3 w-3" /></a></td>
                <td className="max-w-[420px] truncate px-2 py-1.5" title={p.titulo ?? ""}>{p.titulo}</td>
                <td className="whitespace-nowrap px-2 py-1.5"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: cores[p.autor] ?? COR_OUTROS }} />{nome(p.autor)}</span></td>
                <td className="px-2 py-1.5"><Badge variant="outline" className="text-[10px]">{SELO[p.estado] ?? p.estado}</Badge></td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"><span style={{ color: VERDE }}>+{fmtN(p.adicoes)}</span> <span style={{ color: VERMELHO }}>−{fmtN(p.remocoes)}</span></td>
                <td className="whitespace-nowrap px-4 py-1.5 text-right text-muted-foreground">{new Date(p.criado_em).toLocaleDateString("pt-BR")}</td>
              </tr>
            ))}
            {prs.length === 0 && <tr><td className="px-4 py-6 text-center text-muted-foreground">Nenhuma PR no período.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Commits na main pela estatística do GitHub (aparece quando o GitHub termina de calcular). */
function CommitsMain({ semanas, sync, nome, cores }: { semanas: { autor: string; commits: number; adicoes: number; remocoes: number }[]; sync: string | null; nome: (l: string) => string; cores: Record<string, string> }) {
  const tot = useMemo(() => {
    const m = new Map<string, { commits: number; adicoes: number; remocoes: number }>();
    semanas.forEach((s) => { const a = m.get(s.autor) ?? { commits: 0, adicoes: 0, remocoes: 0 }; a.commits += s.commits; a.adicoes += s.adicoes; a.remocoes += s.remocoes; m.set(s.autor, a); });
    return [...m.entries()].sort((a, b) => b[1].commits - a[1].commits);
  }, [semanas]);
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold">Commits na main (desde o início do repositório)</p>
      <p className="mb-3 text-xs text-muted-foreground">Estatística de contribuidores do próprio GitHub — conta também commits que não passaram por PR.</p>
      {tot.length === 0 ? <p className="text-xs text-muted-foreground">O GitHub ainda está calculando esta estatística — ela aparece numa próxima atualização.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tot.map(([login, v]) => (
            <div key={login} className="rounded-lg border p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: cores[login] ?? COR_OUTROS }} />{nome(login)}</p>
              <p className="mt-1 text-xl font-black tabular-nums">{fmtN(v.commits)} <span className="text-xs font-normal text-muted-foreground">commits</span></p>
              <p className="text-[11px] tabular-nums"><span style={{ color: VERDE }}>+{fmtLinhas(v.adicoes)}</span> <span style={{ color: VERMELHO }}>−{fmtLinhas(v.remocoes)}</span></p>
            </div>
          ))}
        </div>
      )}
      {sync && <p className="mt-2 text-[10px] text-muted-foreground">calculado em {new Date(sync).toLocaleString("pt-BR")}</p>}
    </Card>
  );
}

function DialogNomes({ aberto, onClose, devs }: { aberto: boolean; onClose: () => void; devs: DevGithub[] }) {
  const salvar = useSalvarNomeDev();
  const [nomes, setNomes] = useState<Record<string, string>>({});
  useEffect(() => { if (aberto) setNomes(Object.fromEntries(devs.map((d) => [d.login, d.nome]))); }, [aberto, devs]);
  const gravar = async () => {
    try {
      for (const d of devs) if ((nomes[d.login] ?? "").trim() && nomes[d.login].trim() !== d.nome) await salvar.mutateAsync({ login: d.login, nome: nomes[d.login].trim() });
      toast.success("Nomes salvos."); onClose();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nome de cada login do GitHub</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {devs.map((d) => (
            <div key={d.login} className="flex items-center gap-2">
              <span className="w-40 truncate font-mono text-xs text-muted-foreground" title={d.login}>{d.login}</span>
              <Input value={nomes[d.login] ?? ""} onChange={(e) => setNomes({ ...nomes, [d.login]: e.target.value })} className="h-8" />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Login novo que aparecer no GitHub entra aqui sozinho, com o próprio login como nome.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={salvar.isPending} onClick={gravar}>Salvar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
