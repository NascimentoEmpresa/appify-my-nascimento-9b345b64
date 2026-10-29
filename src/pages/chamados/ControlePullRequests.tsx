import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ExternalLink, GitPullRequest, Loader2, Search, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useControlePullRequests } from "@/hooks/useControlePullRequests";
import {
  FILTRO_CONTROLE_PR_PADRAO, csvControlePr, desenvolvedoresDe, filtrarControlePr, fmtDataHoraBrasilia, linhasAlteradas, paginar,
  type FiltroChamado, type FiltroControlePr, type PrControle,
} from "@/lib/sistemas/controlePullRequests";

// =====================================================================
// SISTEMAS › CONTROLE DE PULL REQUESTS (PR) — SIS-2026-0786 (29/10/2026)
//
// Pedido do Iury: a parte central do Painel_Pull_Requests_ERP.html anexo ao
// chamado (a sidebar e o topo do mockup são os do próprio ERP). Toda PR
// mergeada na main entra sozinha pelo workflow pr_registrar_painel.yml; a
// tela só lê (RPC dev_github_controle_pr, mig 20261029004900).
// =====================================================================

const MENU = "sistemas_controle_pr";
const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const fmtN = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR"));

export default function ControlePullRequests() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Controle de Pull Requests (PR)"
        subtitle="Acompanhamento das alterações de código vinculadas aos chamados do ERP"
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", "Controle de Pull Requests (PR)"]}
      />
      <AcessoGate
        menu={MENU}
        acao="visualizar"
        fallback={<Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> Você não tem acesso ao Controle de Pull Requests. Peça a liberação no Gerenciamento de Acesso.</Card>}
      >
        <Conteudo />
      </AcessoGate>
    </div>
  );
}

function Conteudo() {
  const q = useControlePullRequests();
  const [filtro, setFiltro] = useState<FiltroControlePr>(FILTRO_CONTROLE_PR_PADRAO);
  const [pagina, setPagina] = useState(1);
  const prs = useMemo(() => q.data ?? [], [q.data]);
  const devs = useMemo(() => desenvolvedoresDe(prs), [prs]);
  const filtradas = useMemo(() => filtrarControlePr(prs, filtro), [prs, filtro]);
  const pg = paginar(filtradas, pagina);

  const mudar = (parcial: Partial<FiltroControlePr>) => { setFiltro((f) => ({ ...f, ...parcial })); setPagina(1); };
  const limpar = () => { setFiltro(FILTRO_CONTROLE_PR_PADRAO); setPagina(1); };
  const exportar = () => {
    const url = URL.createObjectURL(new Blob([csvControlePr(filtradas)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "pull_requests_erp.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (q.isLoading) return <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>;
  if (q.error) return <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error).message}</Card>;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Pull requests dos desenvolvedores</h2>
          <p className="text-xs text-muted-foreground">PRs mergeadas na main. A data da aprovação é o momento do merge — quando a alteração foi para produção.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button>
          <AcessoGate menu={MENU} acao="exportar">
            <Button size="sm" onClick={exportar} disabled={!filtradas.length} className="gap-1.5"><Download className="h-4 w-4" /> Exportar CSV</Button>
          </AcessoGate>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={filtro.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar pull, chamado ou desenvolvedor" className="h-9 pl-8 text-sm" />
        </div>
        <Select value={filtro.desenvolvedor ?? "*"} onValueChange={(v) => mudar({ desenvolvedor: v === "*" ? null : v })}>
          <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="*">Todos os desenvolvedores</SelectItem>
            {devs.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtro.chamado} onValueChange={(v) => mudar({ chamado: v as FiltroChamado })}>
          <SelectTrigger className="h-9 w-48 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as PRs</SelectItem>
            <SelectItem value="com">Com chamado</SelectItem>
            <SelectItem value="sem">Sem chamado</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={filtro.de} onChange={(e) => mudar({ de: e.target.value })} title="Data inicial" className="h-9 w-40 text-sm" />
        <Input type="date" value={filtro.ate} onChange={(e) => mudar({ ate: e.target.value })} title="Data final" className="h-9 w-40 text-sm" />
      </div>

      <div className="overflow-x-auto border-t">
        <Table className="min-w-[1020px] text-sm">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="pl-4">Desenvolvedor</TableHead>
              <TableHead>Nº da Pull Request</TableHead>
              <TableHead>Chamado atendido</TableHead>
              <TableHead>Commits</TableHead>
              <TableHead>Linhas alteradas</TableHead>
              <TableHead>Arquivos alterados</TableHead>
              <TableHead>Data e hora da aprovação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pg.itens.length ? pg.itens.map((p) => <Linha key={p.numero} p={p} />) : (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {prs.length ? "Nenhum pull request encontrado para os filtros selecionados." : (
                    <span className="inline-flex items-center gap-2"><GitPullRequest className="h-4 w-4" /> Nenhuma PR registrada ainda.</span>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>Mostrando {pg.de} a {pg.ate} de {filtradas.length} pull requests</span>
        {pg.totalPaginas > 1 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={pg.pagina <= 1} onClick={() => setPagina(pg.pagina - 1)}>Anterior</Button>
            <span>Página {pg.pagina} de {pg.totalPaginas}</span>
            <Button variant="outline" size="sm" disabled={pg.pagina >= pg.totalPaginas} onClick={() => setPagina(pg.pagina + 1)}>Próxima</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Linha({ p }: { p: PrControle }) {
  const [semFoto, setSemFoto] = useState(false);
  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="flex items-center gap-2.5 font-medium">
          {p.autor_avatar && !semFoto
            ? <img src={p.autor_avatar} alt="" className="h-8 w-8 shrink-0 rounded-full" onError={() => setSemFoto(true)} />
            : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{iniciais(p.desenvolvedor)}</span>}
          <div className="min-w-0">
            <div>{p.desenvolvedor}</div>
            {p.autor_login && p.autor_login !== p.desenvolvedor && <div className="text-xs font-normal text-muted-foreground">@{p.autor_login}</div>}
          </div>
        </div>
      </TableCell>
      <TableCell>
        {p.url
          ? <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">#{p.numero} <ExternalLink className="h-3 w-3" /></a>
          : <span className="font-semibold">#{p.numero}</span>}
      </TableCell>
      <TableCell className="max-w-[420px]">
        {p.chamado_id
          ? <Link to={`/app/sistemas/chamados/${p.chamado_id}`} className="font-medium text-primary hover:underline">{p.chamado} · {p.chamado_assunto}</Link>
          : p.chamado
            ? <span className="font-medium">{p.chamado}</span>
            : <span className="text-muted-foreground">Sem chamado</span>}
        <div className="truncate text-xs text-muted-foreground" title={p.titulo}>{p.titulo}</div>
      </TableCell>
      <TableCell><span className="rounded bg-muted px-2 py-1 font-medium">{fmtN(p.commits)}</span></TableCell>
      <TableCell>
        {p.adicoes == null && p.remocoes == null ? "—" : (
          <>
            <span className="font-medium text-green-600">+{fmtN(p.adicoes ?? 0)}</span>{" "}
            <span className="font-medium text-red-600">−{fmtN(p.remocoes ?? 0)}</span>
            <div className="text-xs text-muted-foreground">{fmtN(linhasAlteradas(p))} linhas no total</div>
          </>
        )}
      </TableCell>
      <TableCell><span className="rounded bg-muted px-2 py-1 font-medium">{fmtN(p.arquivos)}</span></TableCell>
      <TableCell className="whitespace-nowrap">{fmtDataHoraBrasilia(p.mergeado_em)}</TableCell>
    </TableRow>
  );
}
