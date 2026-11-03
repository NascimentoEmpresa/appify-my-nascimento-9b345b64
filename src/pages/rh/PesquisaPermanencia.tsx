import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import QRCode from "qrcode";
import {
  AlertTriangle, ClipboardList, Copy, ExternalLink, Link2, ListChecks, Loader2, Plus, QrCode, Send, Sparkles, TrendingDown, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useUsuariosEmpresa } from "@/hooks/useUsuariosEmpresa";
import { useSetoresEmpresa } from "@/hooks/useSetoresEmpresa";
import { PRIORIDADES, PRIORIDADE_LABEL, STATUS_LABELS } from "@/types/planoAcao";
import {
  perguntarIA, useAplicacoes, useCriarPlanoPesquisa, usePlanosPesquisa, useRespostasPesquisa, useSalvarAplicacao, useTurnoverPesquisa,
  type Aplicacao, type MsgIA, type OrigemPlano,
} from "@/hooks/usePesquisaPermanencia";
import {
  CATEGORIA_ROTULO, MIN_RESPOSTAS_GRUPO, PERGUNTAS, agrupar, agruparTurnover, chaveDe, contarPergunta, filtrar, filtrarTurnover,
  indicadores, pontosDeAtencao, resumoGerencial, taxaTurnover,
  type Dimensao, type Filtro, type Grupo, type LinhaResposta, type LinhaTurnover, type PontoAtencao,
} from "../../../supabase/functions/_shared/pesquisa-permanencia";

// =====================================================================
// RH › PESQUISA DE PERMANÊNCIA (mig 20261028001200)
//
// Chamado do RH/Operação: "mapear nos contratos os motivos do excesso de
// rotatividade", com a pesquisa selecionando contrato, posto e função, e
// "gerar plano de ação a partir das respostas". Pablo: "mesmo que precise de
// um agente de i.a respondendo sobre". Abas:
//   · Relatórios — os do documento do RH: por contrato/posto/função, por
//     motivo, por prioridade, por período e o resumo gerencial (empresa ×
//     fiscais × órgão), com quantidades e %; grupo com menos de 3 respostas
//     não é detalhado (anonimato);
//   · Rotatividade — turnover do mesmo recorte (conta do Relatórios ›
//     Turn-over) lado a lado com o que as pessoas responderam;
//   · Plano de ação — ações criadas daqui no Plano de Ações de sempre;
//   · Aplicações — as rodadas da pesquisa (link e QR Code públicos);
//   · Assistente I.A — Edge Function pesquisa-permanencia-ia.
// Contas em supabase/functions/_shared/pesquisa-permanencia.ts (com teste).
// =====================================================================

const MENU = "rh_pesquisa_permanencia";
const TODOS = "__todos__";
const fmt = (n: number) => n.toLocaleString("pt-BR");
const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const linkPublico = (token: string) => `${window.location.origin}/pesquisa-permanencia/${token}`;

export default function PesquisaPermanencia() {
  return (
    <AcessoGate menu={MENU} acao="visualizar" fallback={
      <div className="p-6"><Card className="p-6 text-sm text-muted-foreground">Você não tem acesso à Pesquisa de Permanência. Peça a liberação em Administração › Acesso por Usuário.</Card></div>
    }>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const resp = useRespostasPesquisa();
  const turn = useTurnoverPesquisa(12);
  const apl = useAplicacoes();
  const { data: podeAlterar = false } = useScreenAccess(MENU, "alterar");
  const [filtro, setFiltro] = useState<Filtro>({});
  const [planoDe, setPlanoDe] = useState<OrigemPlano | null>(null);

  const todas = resp.data ?? [];
  const linhas = useMemo(() => filtrar(todas, filtro), [todas, filtro]);
  const turnover = useMemo(() => filtrarTurnover(turn.data?.linhas ?? [], filtro), [turn.data, filtro]);

  const novoPlano = (o: Partial<OrigemPlano> & { motivo: string }) => setPlanoDe({
    aplicacao_id: filtro.aplicacao ?? null, empresa: null, filial: null, contrato: null, posto: null, posto_nome: null, funcao: null, ...o,
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader title="Pesquisa de Permanência" breadcrumb={["RH", "Contratos"]}
        subtitle="Motivos de permanência e de saída por contrato, posto e função — com a rotatividade do mesmo recorte e o plano de ação." />

      <Filtros todas={todas} turnover={turn.data?.linhas ?? []} aplicacoes={apl.data ?? []} filtro={filtro} setFiltro={setFiltro} />

      <Tabs defaultValue="relatorios">
        <TabsList className="flex-wrap">
          <TabsTrigger value="relatorios"><ClipboardList className="mr-1.5 h-4 w-4" />Relatórios</TabsTrigger>
          <TabsTrigger value="rotatividade"><TrendingDown className="mr-1.5 h-4 w-4" />Rotatividade</TabsTrigger>
          <TabsTrigger value="planos"><ListChecks className="mr-1.5 h-4 w-4" />Plano de ação</TabsTrigger>
          <TabsTrigger value="aplicacoes"><QrCode className="mr-1.5 h-4 w-4" />Aplicações</TabsTrigger>
          <TabsTrigger value="ia"><Sparkles className="mr-1.5 h-4 w-4" />Assistente I.A</TabsTrigger>
        </TabsList>

        <TabsContent value="relatorios">
          {resp.isLoading ? <Carregando /> : resp.error ? <Erro msg={(resp.error as Error).message} /> : (
            <Relatorios linhas={linhas} turnover={turnover} podeAlterar={podeAlterar} novoPlano={novoPlano} />
          )}
        </TabsContent>
        <TabsContent value="rotatividade">
          {turn.isLoading ? <Carregando /> : turn.error ? <Erro msg={(turn.error as Error).message} /> : (
            <Rotatividade linhas={linhas} turnover={turnover} meses={turn.data?.meses ?? []} podeAlterar={podeAlterar} novoPlano={novoPlano} />
          )}
        </TabsContent>
        <TabsContent value="planos">
          <Planos podeAlterar={podeAlterar} novoPlano={() => novoPlano({ motivo: "" })} />
        </TabsContent>
        <TabsContent value="aplicacoes">
          <Aplicacoes lista={apl.data ?? []} carregando={apl.isLoading} podeAlterar={podeAlterar} />
        </TabsContent>
        <TabsContent value="ia">
          <AssistenteIA filtro={filtro} />
        </TabsContent>
      </Tabs>

      {planoDe && <DialogPlano origem={planoDe} fechar={() => setPlanoDe(null)} />}
    </div>
  );
}

const Carregando = () => <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
const Erro = ({ msg }: { msg: string }) => <Card className="p-4 text-sm text-destructive">{msg}</Card>;

// ─── Filtros ───────────────────────────────────────────────────────────────

function Filtros({ todas, turnover, aplicacoes, filtro, setFiltro }: {
  todas: LinhaResposta[]; turnover: LinhaTurnover[]; aplicacoes: Aplicacao[]; filtro: Filtro; setFiltro: (f: Filtro) => void;
}) {
  // Contratos/postos/funções de quem respondeu E de quem tem rotatividade.
  const base = useMemo(() => [
    ...todas,
    ...turnover.map((t) => ({ ...t, mes: "", aplicacao_id: "", r: {} })),
  ], [todas, turnover]);
  const opcoes = (d: Dimensao, sub: typeof base) => {
    const m = new Map<string, string>();
    for (const l of sub) m.set(chaveDe(l, d), d === "contrato" ? l.contrato : d === "posto" ? (l.posto ? `${l.posto} · ${l.posto_nome ?? ""}` : `Sem posto · ${l.contrato}`) : chaveDe(l, d));
    return [{ value: TODOS, label: "Todos" }, ...[...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))];
  };
  const noContrato = filtro.contrato ? base.filter((l) => chaveDe(l, "contrato") === filtro.contrato) : base;
  const noPosto = filtro.posto ? noContrato.filter((l) => chaveDe(l, "posto") === filtro.posto) : noContrato;
  const meses = [...new Set(todas.map((l) => l.mes))].sort();
  const v = (x: string | null | undefined) => x ?? TODOS;
  const set = (k: keyof Filtro, x: string) => setFiltro({ ...filtro, [k]: x === TODOS || !x ? null : x });

  return (
    <Card className="grid gap-3 p-4 md:grid-cols-6">
      <div className="md:col-span-2"><Label className="text-xs">Contrato</Label>
        <SearchableSelect value={v(filtro.contrato)} options={opcoes("contrato", base)} onChange={(x) => setFiltro({ ...filtro, contrato: x === TODOS || !x ? null : x, posto: null, funcao: null })} /></div>
      <div className="md:col-span-2"><Label className="text-xs">Posto de trabalho</Label>
        <SearchableSelect value={v(filtro.posto)} options={opcoes("posto", noContrato)} onChange={(x) => setFiltro({ ...filtro, posto: x === TODOS || !x ? null : x, funcao: null })} /></div>
      <div className="md:col-span-2"><Label className="text-xs">Função</Label>
        <SearchableSelect value={v(filtro.funcao)} options={opcoes("funcao", noPosto)} onChange={(x) => set("funcao", x)} /></div>
      <div className="md:col-span-2"><Label className="text-xs">Aplicação</Label>
        <Select value={v(filtro.aplicacao)} onValueChange={(x) => set("aplicacao", x)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {aplicacoes.map((a) => <SelectItem key={a.id} value={a.id}>{a.titulo}</SelectItem>)}
          </SelectContent>
        </Select></div>
      <div><Label className="text-xs">De (mês)</Label>
        <Select value={v(filtro.de)} onValueChange={(x) => set("de", x)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={TODOS}>Início</SelectItem>{meses.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select></div>
      <div><Label className="text-xs">Até (mês)</Label>
        <Select value={v(filtro.ate)} onValueChange={(x) => set("ate", x)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={TODOS}>Hoje</SelectItem>{meses.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select></div>
      <div className="flex items-end md:col-span-2">
        <Button variant="ghost" size="sm" onClick={() => setFiltro({})} disabled={!Object.values(filtro).some(Boolean)}>Limpar filtros</Button>
      </div>
    </Card>
  );
}

// ─── Relatórios ────────────────────────────────────────────────────────────

type NovoPlano = (o: Partial<OrigemPlano> & { motivo: string }) => void;

/** Origem do plano a partir de um grupo (contrato/posto/função). */
function origemDoGrupo(g: Grupo, d: Dimensao): Partial<OrigemPlano> {
  const l = g.linhas[0];
  if (d === "contrato") return { empresa: l.empresa, filial: l.filial, contrato: l.contrato };
  if (d === "posto") return { empresa: l.empresa, filial: l.filial, contrato: l.contrato, posto: l.posto, posto_nome: l.posto_nome };
  if (d === "funcao") return { funcao: g.chave };
  return {};
}

function Relatorios({ linhas, turnover, podeAlterar, novoPlano }: { linhas: LinhaResposta[]; turnover: LinhaTurnover[]; podeAlterar: boolean; novoPlano: NovoPlano }) {
  const [dim, setDim] = useState<Dimensao>("contrato");
  const ind = useMemo(() => indicadores(linhas), [linhas]);
  const resumo = useMemo(() => resumoGerencial(linhas), [linhas]);
  const pontos = useMemo(() => [...pontosDeAtencao(linhas, "contrato"), ...pontosDeAtencao(linhas, "posto"), ...pontosDeAtencao(linhas, "funcao")], [linhas]);
  const grupos = useMemo(() => agrupar(linhas, dim), [linhas, dim]);
  const tv = useMemo(() => dim === "mes" || dim === "aplicacao" ? new Map() : new Map(agruparTurnover(turnover, dim).map((g) => [g.chave, g])), [turnover, dim]);
  const periodos = useMemo(() => agrupar(linhas, "mes"), [linhas]);

  if (!linhas.length) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma resposta neste recorte ainda. Abra uma aplicação na aba <b>Aplicações</b> e mande o link/QR Code para os contratos.</Card>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Respostas" valor={fmt(ind.n)} />
        <Kpi rotulo="Satisfação" valor={fmtPct(ind.satisfacao)} dica="% das avaliações das perguntas 3 a 7 que foram positivas" />
        <Kpi rotulo="Insatisfação" valor={fmtPct(ind.insatisfacao)} ruim={ind.insatisfacao >= 25} dica="% das avaliações das perguntas 3 a 7 que foram negativas" />
        <Kpi rotulo="Recomendação" valor={`${ind.recomendacao.toLocaleString("pt-BR")} pts`} ruim={ind.recomendacao < 0} dica='"Sim, com certeza" − "Não indicaria" (pergunta 7)' />
        <Kpi rotulo="Acha outra empresa melhor" valor={fmtPct(ind.prefereOutra)} ruim={ind.prefereOutra >= 25} />
        <Kpi rotulo="Turnover mensal médio" valor={fmtPct(taxaTurnover(turnover.flatMap((t) => t.trab), turnover.flatMap((t) => t.dem)))} dica="Últimos 12 meses, mesmo recorte do filtro (conta do Relatórios › Turn-over)" />
      </div>

      {/* Resumo gerencial */}
      <Card className="p-4">
        <h3 className="mb-3 font-semibold">Resumo gerencial — pontos de atenção</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {resumo.filter((c) => c.categoria !== "pessoal").map((c) => (
            <div key={c.categoria} className="rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{c.rotulo}</p>
                <Badge variant={c.pctRespondentes >= 30 ? "destructive" : "secondary"}>{fmtPct(c.pctRespondentes)} avaliam mal</Badge>
              </div>
              {c.riscoSaida.some((x) => x.n > 0) && (
                <div className="mt-2 text-xs">
                  <p className="font-medium text-muted-foreground">Levaria a pedir demissão</p>
                  {c.riscoSaida.filter((x) => x.n > 0).map((x) => <p key={x.cod}>{x.rotulo}: <b>{fmt(x.n)}</b> ({fmtPct(x.pct)}) · mais importante p/ {fmt(x.principal)}</p>)}
                </div>
              )}
              <div className="mt-2 space-y-0.5 text-xs">
                {c.detalhes.slice(0, 6).map((d, i) => <p key={i}><span className="text-muted-foreground">{d.rotulo}</span>: <b>{fmt(d.n)}</b></p>)}
                {!c.detalhes.length && <p className="text-muted-foreground">Nenhum problema apontado.</p>}
              </div>
            </div>
          ))}
        </div>
        {resumo.find((c) => c.categoria === "pessoal")!.riscoSaida[0]?.n > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Questões pessoais, familiares ou de transporte como motivo de saída: {fmt(resumo.find((c) => c.categoria === "pessoal")!.riscoSaida[0].n)} ({fmtPct(resumo.find((c) => c.categoria === "pessoal")!.riscoSaida[0].pct)}).</p>
        )}
        {pontos.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-amber-500" />Onde está pior que o geral</p>
            <div className="space-y-1">
              {pontos.slice(0, 15).map((p, i) => <LinhaPonto key={i} p={p} podeAlterar={podeAlterar} novoPlano={novoPlano} linhas={linhas} />)}
            </div>
          </div>
        )}
      </Card>

      {/* Por contrato / posto / função */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Por {dim === "contrato" ? "contrato" : dim === "posto" ? "posto de trabalho" : "função"}</h3>
          <div className="flex gap-1">
            {(["contrato", "posto", "funcao"] as Dimensao[]).map((d) => (
              <Button key={d} size="sm" variant={dim === d ? "default" : "outline"} onClick={() => setDim(d)}>{d === "contrato" ? "Contrato" : d === "posto" ? "Posto" : "Função"}</Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2">{dim === "contrato" ? "Contrato" : dim === "posto" ? "Posto" : "Função"}</th>
              <th className="px-2 text-right">Resp.</th><th className="px-2 text-right">Satisf.</th><th className="px-2 text-right">Insatisf.</th>
              <th className="px-2 text-right">Não indica</th><th className="px-2 text-right">Outra melhor</th>
              <th className="px-2 text-right">Empresa</th><th className="px-2 text-right">Fiscais</th><th className="px-2 text-right">Órgão</th>
              <th className="px-2">Motivo de saída mais importante</th><th className="px-2 text-right">Turnover</th><th />
            </tr></thead>
            <tbody>
              {grupos.map((g) => {
                const t = tv.get(g.chave);
                return (
                  <tr key={g.chave} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 font-medium">{g.rotulo}</td>
                    <td className="px-2 text-right">{g.linhas.length}</td>
                    {g.reservado ? (
                      <td colSpan={8} className="px-2 text-xs text-muted-foreground">Menos de {MIN_RESPOSTAS_GRUPO} respostas — não detalhado (anonimato); entra nos totais.</td>
                    ) : (<>
                      <td className="px-2 text-right">{fmtPct(g.ind.satisfacao)}</td>
                      <td className={cn("px-2 text-right", g.ind.insatisfacao >= 25 && "font-semibold text-red-600")}>{fmtPct(g.ind.insatisfacao)}</td>
                      <td className="px-2 text-right">{fmtPct(g.ind.naoIndicaria)}</td>
                      <td className="px-2 text-right">{fmtPct(g.ind.prefereOutra)}</td>
                      <td className="px-2 text-right">{fmtPct(g.ind.sinais.empresa)}</td>
                      <td className="px-2 text-right">{fmtPct(g.ind.sinais.fiscais)}</td>
                      <td className="px-2 text-right">{fmtPct(g.ind.sinais.orgao)}</td>
                      <td className="px-2 text-xs">{g.ind.riscoPrincipal ? `${g.ind.riscoPrincipal.rotulo} (${g.ind.riscoPrincipal.n})` : "—"}</td>
                    </>)}
                    <td className="px-2 text-right">{fmtPct(t?.taxa)}</td>
                    <td className="pl-2 text-right">
                      {podeAlterar && !g.reservado && (
                        <Button size="sm" variant="ghost" title="Gerar plano de ação" onClick={() => novoPlano({
                          ...origemDoGrupo(g, dim),
                          motivo: `${g.rotulo}: ${g.linhas.length} respostas, insatisfação ${fmtPct(g.ind.insatisfacao)}`
                            + (g.ind.riscoPrincipal ? `, motivo de saída mais importante "${g.ind.riscoPrincipal.rotulo}" (${g.ind.riscoPrincipal.n})` : "")
                            + (t?.taxa != null ? `, turnover mensal ${fmtPct(t.taxa)}` : "") + ".",
                        })}><Plus className="h-4 w-4" /></Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Por motivo e por prioridade */}
      <div className="grid gap-4 lg:grid-cols-2">
        {PERGUNTAS.map((p) => <CartaoPergunta key={p.id} pid={p.id} linhas={linhas} />)}
      </div>

      {/* Por período */}
      <Card className="p-4">
        <h3 className="mb-1 font-semibold">Por período</h3>
        <p className="mb-3 text-xs text-muted-foreground">Compare as aplicações mês a mês para ver se houve melhora ou piora.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2">Mês</th><th className="px-2 text-right">Resp.</th><th className="px-2 text-right">Satisf.</th>
              <th className="px-2 text-right">Insatisf.</th><th className="px-2 text-right">Recomendação</th><th className="px-2 text-right">Outra melhor</th>
              <th className="px-2">Prioridade mais pedida</th>
            </tr></thead>
            <tbody>
              {periodos.map((g, i) => {
                const ant = periodos[i - 1];
                const seta = (a: number, b: number | undefined, menorMelhor = false) => b === undefined || a === b ? "" : (a > b) !== menorMelhor ? " ▲" : " ▼";
                return (
                  <tr key={g.chave} className="border-b last:border-0">
                    <td className="py-1.5 pr-2 font-medium">{g.rotulo}</td>
                    <td className="px-2 text-right">{g.linhas.length}</td>
                    <td className="px-2 text-right">{fmtPct(g.ind.satisfacao)}{seta(g.ind.satisfacao, ant?.ind.satisfacao)}</td>
                    <td className="px-2 text-right">{fmtPct(g.ind.insatisfacao)}{seta(g.ind.insatisfacao, ant?.ind.insatisfacao, true)}</td>
                    <td className="px-2 text-right">{g.ind.recomendacao.toLocaleString("pt-BR")} pts{seta(g.ind.recomendacao, ant?.ind.recomendacao)}</td>
                    <td className="px-2 text-right">{fmtPct(g.ind.prefereOutra)}</td>
                    <td className="px-2 text-xs">{g.ind.prioridadePrincipal?.rotulo ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">▲/▼ = subiu/desceu em relação ao mês anterior (a seta da insatisfação é invertida: ▼ é melhora).</p>
      </Card>
    </div>
  );
}

function LinhaPonto({ p, podeAlterar, novoPlano, linhas }: { p: PontoAtencao; podeAlterar: boolean; novoPlano: NovoPlano; linhas: LinhaResposta[] }) {
  const g = agrupar(linhas.filter((l) => chaveDe(l, p.dimensao) === p.chave), p.dimensao)[0];
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs dark:bg-amber-950/30">
      <span><b>{p.rotulo}</b> ({p.n} resp.): {p.descricao} — <b>{fmtPct(p.valor)}</b> contra {fmtPct(p.geral)} no geral</span>
      {podeAlterar && g && (
        <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" onClick={() => novoPlano({
          ...origemDoGrupo(g, p.dimensao),
          motivo: `${p.rotulo}: ${p.descricao} em ${fmtPct(p.valor)} das respostas (${p.n}), contra ${fmtPct(p.geral)} no geral.`,
        })}>Plano de ação</Button>
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, ruim, dica }: { rotulo: string; valor: string; ruim?: boolean; dica?: string }) {
  return (
    <Card className="p-3" title={dica}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={cn("text-xl font-bold", ruim && "text-red-600")}>{valor}</p>
    </Card>
  );
}

function CartaoPergunta({ pid, linhas }: { pid: string; linhas: LinhaResposta[] }) {
  const p = PERGUNTAS.find((x) => x.id === pid)!;
  const c = useMemo(() => contarPergunta(linhas, pid), [linhas, pid]);
  const max = Math.max(1, ...c.opcoes.map((o) => o.pct));
  return (
    <Card className="p-4">
      <p className="text-sm font-semibold">{p.numero}. {p.tema}</p>
      <p className="mb-3 text-xs text-muted-foreground">{p.titulo} · {fmt(c.total)} respostas{p.max > 1 ? " · até 3 escolhas (soma passa de 100%)" : ""}</p>
      <div className="space-y-2">
        {[...c.opcoes].sort((a, b) => b.n - a.n).map((o) => (
          <div key={o.cod}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span>{o.rotulo}</span>
              <span className="shrink-0 font-medium">{fmt(o.n)} · {fmtPct(o.pct)}{p.max > 1 && <span className="text-muted-foreground"> · mais importante {fmt(o.principal)}</span>}</span>
            </div>
            <div className="mt-0.5 h-2 rounded bg-muted">
              <div className="h-2 rounded bg-emerald-500" style={{ width: `${(o.pct / max) * 100}%` }} />
              {p.max > 1 && <div className="-mt-2 h-2 rounded bg-emerald-800" style={{ width: `${(o.pctPrincipal / max) * 100}%` }} />}
            </div>
            {o.comp.some((x) => x.n > 0) && (
              <div className="ml-3 mt-1 space-y-0.5 border-l pl-2 text-[11px] text-muted-foreground">
                {o.comp.filter((x) => x.n > 0).map((x) => <p key={x.cod}>{x.rotulo}: <b className="text-foreground">{fmt(x.n)}</b> ({fmtPct(x.pct)})</p>)}
                {o.textos.length > 0 && <p>Empresas citadas: {o.textos.slice(0, 6).map((t) => `${t.texto} (${t.n})`).join(", ")}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Rotatividade ──────────────────────────────────────────────────────────

function Rotatividade({ linhas, turnover, meses, podeAlterar, novoPlano }: {
  linhas: LinhaResposta[]; turnover: LinhaTurnover[]; meses: string[]; podeAlterar: boolean; novoPlano: NovoPlano;
}) {
  const [dim, setDim] = useState<"contrato" | "posto" | "funcao">("contrato");
  const grupos = useMemo(() => agruparTurnover(turnover, dim).filter((g) => g.efetivoMedio > 0 || g.demissoes > 0), [turnover, dim]);
  const pesquisa = useMemo(() => new Map(agrupar(linhas, dim).map((g) => [g.chave, g])), [linhas, dim]);
  const [limite, setLimite] = useState(50);
  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Onde a rotatividade se concentra</h3>
        <div className="flex gap-1">
          {(["contrato", "posto", "funcao"] as const).map((d) => (
            <Button key={d} size="sm" variant={dim === d ? "default" : "outline"} onClick={() => setDim(d)}>{d === "contrato" ? "Contrato" : d === "posto" ? "Posto" : "Função"}</Button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {meses.length ? `${meses[0]} a ${meses[meses.length - 1]}` : ""} · turnover mensal médio = demissões ÷ soma do efetivo no fim de cada mês × 100
        (a conta do Relatórios › Turn-over, recortada pela filial da Senior, posto e função). Ao lado, o que as pessoas de lá responderam.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-2">{dim === "contrato" ? "Contrato" : dim === "posto" ? "Posto" : "Função"}</th>
            <th className="px-2 text-right">Efetivo médio</th><th className="px-2 text-right">Admissões</th><th className="px-2 text-right">Demissões</th>
            <th className="px-2 text-right">Turnover</th><th className="px-2 text-right">Respostas</th><th className="px-2 text-right">Insatisf.</th>
            <th className="px-2">Motivo de saída mais importante</th><th />
          </tr></thead>
          <tbody>
            {grupos.slice(0, limite).map((g) => {
              const p = pesquisa.get(g.chave);
              const l = turnover.find((t) => chaveDe({ ...t, mes: "", aplicacao_id: "" }, dim) === g.chave);
              return (
                <tr key={g.chave} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 font-medium">{g.rotulo}</td>
                  <td className="px-2 text-right">{fmt(g.efetivoMedio)}</td>
                  <td className="px-2 text-right">{fmt(g.admissoes)}</td>
                  <td className="px-2 text-right">{fmt(g.demissoes)}</td>
                  <td className={cn("px-2 text-right font-semibold", (g.taxa ?? 0) >= 5 && "text-red-600")}>{fmtPct(g.taxa)}</td>
                  <td className="px-2 text-right">{p ? p.linhas.length : <span className="text-muted-foreground">0</span>}</td>
                  <td className="px-2 text-right">{p && !p.reservado ? fmtPct(p.ind.insatisfacao) : "—"}</td>
                  <td className="px-2 text-xs">{p && !p.reservado ? p.ind.riscoPrincipal?.rotulo ?? "—" : <span className="text-muted-foreground">{p ? "poucas respostas" : "sem respostas"}</span>}</td>
                  <td className="pl-2 text-right">
                    {podeAlterar && l && (
                      <Button size="sm" variant="ghost" title="Gerar plano de ação" onClick={() => novoPlano({
                        ...(dim === "funcao" ? { funcao: g.chave } : { empresa: l.empresa, filial: l.filial, contrato: l.contrato, ...(dim === "posto" ? { posto: l.posto, posto_nome: l.posto_nome } : {}) }),
                        motivo: `${g.rotulo}: turnover mensal médio ${fmtPct(g.taxa)} (${g.demissoes} demissões, efetivo médio ${g.efetivoMedio})`
                          + (p && !p.reservado && p.ind.riscoPrincipal ? `; na pesquisa (${p.linhas.length} respostas) o motivo de saída mais importante é "${p.ind.riscoPrincipal.rotulo}".` : "."),
                      })}><Plus className="h-4 w-4" /></Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {grupos.length > limite && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimite((x) => x + 100)}>Mostrar mais ({grupos.length - limite})</Button>}
    </Card>
  );
}

// ─── Plano de ação ─────────────────────────────────────────────────────────

function Planos({ podeAlterar, novoPlano }: { podeAlterar: boolean; novoPlano: () => void }) {
  const q = usePlanosPesquisa();
  const lista = q.data ?? [];
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Ações geradas pela pesquisa</h3>
          <p className="text-xs text-muted-foreground">Ficam no Plano de Ações (responsável, prazo, andamento e evidências são tratados lá). Gere a partir dos relatórios, da rotatividade ou daqui.</p>
        </div>
        {podeAlterar && <Button size="sm" onClick={novoPlano}><Plus className="mr-1 h-4 w-4" />Nova ação</Button>}
      </div>
      {q.isLoading ? <Carregando /> : q.error ? <Erro msg={(q.error as Error).message} /> : !lista.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma ação ainda.</p>
      ) : (
        <div className="space-y-2">
          {lista.map((p) => (
            <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="font-medium">{p.titulo}</p>
                <p className="text-xs text-muted-foreground">
                  {[p.contrato, p.posto ? `${p.posto}${p.posto_nome ? ` · ${p.posto_nome}` : ""}` : null, p.funcao].filter(Boolean).join(" › ") || "Geral"}
                  {p.responsavel ? ` · ${p.responsavel}` : ""}{p.prazo ? ` · prazo ${new Date(p.prazo + "T12:00").toLocaleDateString("pt-BR")}` : ""}
                </p>
                {p.motivo && <p className="mt-1 text-xs">{p.motivo}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{STATUS_LABELS[p.status as keyof typeof STATUS_LABELS] ?? p.status}</Badge>
                <Button size="sm" variant="outline" asChild><a href={`/app/plano-acoes/${p.id}`}><ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir</a></Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DialogPlano({ origem, fechar }: { origem: OrigemPlano; fechar: () => void }) {
  const { empresa } = useEmpresaAtiva();
  const usuarios = useUsuariosEmpresa();
  const setores = useSetoresEmpresa();
  const criar = useCriarPlanoPesquisa();
  const onde = [origem.contrato, origem.posto ? `${origem.posto}${origem.posto_nome ? ` · ${origem.posto_nome}` : ""}` : null, origem.funcao].filter(Boolean).join(" › ");
  const [titulo, setTitulo] = useState(onde ? `Permanência — ${onde}` : "Permanência — ");
  const [problema, setProblema] = useState(origem.motivo);
  const [acao, setAcao] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [prioridade, setPrioridade] = useState("alta");
  const [responsavel, setResponsavel] = useState<string | null>(null);
  const [prazo, setPrazo] = useState("");

  const salvar = () => {
    if (!empresa?.id) { toast.error("Escolha a empresa ativa no topo da tela."); return; }
    if (!titulo.trim() || !responsavel || !area) { toast.error("Preencha título, setor e responsável."); return; }
    criar.mutate(
      { empresaId: empresa.id, titulo: titulo.trim(), problema, acao, area, prioridade, responsavel, prazo: prazo || null, origem: { ...origem, motivo: problema } },
      { onSuccess: () => { toast.success("Ação criada no Plano de Ações."); fechar(); }, onError: (e) => toast.error(e.message) },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar plano de ação</DialogTitle>
          <DialogDescription>{onde || "Sem recorte"} — vai para o Plano de Ações, ligado a este ponto da pesquisa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Título</Label><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
          <div><Label>Problema (o que a pesquisa mostrou)</Label><Textarea rows={3} value={problema} onChange={(e) => setProblema(e.target.value)} /></div>
          <div><Label>Ação</Label><Textarea rows={3} value={acao} onChange={(e) => setAcao(e.target.value)} placeholder="O que será feito, onde e como medir" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Setor *</Label>
              <SearchableSelect value={area} options={(setores.data ?? []).map((s) => ({ value: s, label: s }))} onChange={(v) => setArea(v || null)} placeholder="Setor" /></div>
            <div><Label>Prioridade</Label>
              <Select value={prioridade} onValueChange={setPrioridade}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORIDADES.filter((p) => p !== "nao_informada").map((p) => <SelectItem key={p} value={p}>{PRIORIDADE_LABEL[p]}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>Responsável *</Label>
              <SearchableSelect value={responsavel} onChange={(v) => setResponsavel(v || null)}
                options={(usuarios.data ?? []).map((u) => ({ value: u.id, label: u.display_name ?? u.email ?? u.id }))}
                placeholder={usuarios.error ? "Sem permissão para listar usuários" : "Selecione"} disabled={!!usuarios.error} /></div>
            <div><Label>Prazo</Label><Input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={fechar}>Cancelar</Button>
            <Button onClick={salvar} disabled={criar.isPending}>{criar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Criar ação</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Aplicações ────────────────────────────────────────────────────────────

function Aplicacoes({ lista, carregando, podeAlterar }: { lista: Aplicacao[]; carregando: boolean; podeAlterar: boolean }) {
  const salvar = useSalvarAplicacao();
  const [editando, setEditando] = useState<Partial<Aplicacao> | null>(null);
  const [qr, setQr] = useState<{ titulo: string; url: string; img: string } | null>(null);

  const mostrarQr = async (a: Aplicacao) => {
    const url = linkPublico(a.token);
    const img = await QRCode.toDataURL(url, { margin: 1, width: 640, errorCorrectionLevel: "M" });
    setQr({ titulo: a.titulo, url, img });
  };
  const gravar = () => {
    if (!editando?.titulo?.trim()) { toast.error("Dê um nome para a aplicação."); return; }
    salvar.mutate(
      { id: editando.id ?? null, titulo: editando.titulo, inicia_em: editando.inicia_em || null, encerra_em: editando.encerra_em || null, ativa: editando.ativa ?? true },
      { onSuccess: () => { toast.success("Aplicação salva."); setEditando(null); }, onError: (e) => toast.error(e.message) },
    );
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Aplicações da pesquisa</h3>
          <p className="text-xs text-muted-foreground">Cada aplicação é uma rodada com link e QR Code próprios (a pessoa responde sem login e sem nome). Comparar rodadas = relatório por período.</p>
        </div>
        {podeAlterar && <Button size="sm" onClick={() => setEditando({ titulo: `Pesquisa de Permanência — ${new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`, ativa: true })}><Plus className="mr-1 h-4 w-4" />Nova aplicação</Button>}
      </div>
      {carregando ? <Carregando /> : !lista.length ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma aplicação ainda.</p> : (
        <div className="space-y-2">
          {lista.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <p className="font-medium">{a.titulo} <Badge variant={a.aberta ? "default" : "secondary"} className="ml-1">{a.aberta ? "Recebendo respostas" : "Fechada"}</Badge></p>
                <p className="text-xs text-muted-foreground">
                  <Users className="mr-1 inline h-3 w-3" />{fmt(a.respostas)} respostas
                  {a.inicia_em ? ` · de ${new Date(a.inicia_em + "T12:00").toLocaleDateString("pt-BR")}` : ""}
                  {a.encerra_em ? ` até ${new Date(a.encerra_em + "T12:00").toLocaleDateString("pt-BR")}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(linkPublico(a.token)); toast.success("Link copiado."); }}><Copy className="mr-1 h-3.5 w-3.5" />Link</Button>
                <Button size="sm" variant="outline" onClick={() => mostrarQr(a)}><QrCode className="mr-1 h-3.5 w-3.5" />QR Code</Button>
                <Button size="sm" variant="outline" asChild><a href={linkPublico(a.token)} target="_blank" rel="noreferrer"><Link2 className="mr-1 h-3.5 w-3.5" />Abrir</a></Button>
                {podeAlterar && <Button size="sm" variant="ghost" onClick={() => setEditando(a)}>Editar</Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editando && (
        <Dialog open onOpenChange={(o) => !o && setEditando(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editando.id ? "Editar aplicação" : "Nova aplicação"}</DialogTitle>
              <DialogDescription>Sem datas = recebe respostas enquanto estiver ativa.</DialogDescription></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome</Label><Input value={editando.titulo ?? ""} onChange={(e) => setEditando({ ...editando, titulo: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Início</Label><Input type="date" value={editando.inicia_em ?? ""} onChange={(e) => setEditando({ ...editando, inicia_em: e.target.value })} /></div>
                <div><Label>Fim</Label><Input type="date" value={editando.encerra_em ?? ""} onChange={(e) => setEditando({ ...editando, encerra_em: e.target.value })} /></div>
              </div>
              <div className="flex items-center gap-2"><Switch checked={editando.ativa ?? true} onCheckedChange={(v) => setEditando({ ...editando, ativa: v })} /><Label>Ativa (recebendo respostas)</Label></div>
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                <Button onClick={gravar} disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Salvar</Button></div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {qr && (
        <Dialog open onOpenChange={(o) => !o && setQr(null)}>
          <DialogContent className="max-w-sm text-center">
            <DialogHeader><DialogTitle>{qr.titulo}</DialogTitle><DialogDescription>Imprima e deixe no posto, ou mande no grupo do contrato.</DialogDescription></DialogHeader>
            <img src={qr.img} alt="QR Code da pesquisa" className="mx-auto w-64" />
            <p className="break-all text-xs text-muted-foreground">{qr.url}</p>
            <Button asChild><a href={qr.img} download="pesquisa-permanencia-qrcode.png">Baixar imagem</a></Button>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// ─── Assistente I.A ────────────────────────────────────────────────────────

const SUGESTOES = [
  "Por que o contrato com maior turnover perde tanta gente?",
  "Quais funções têm mais risco de saída e por quê?",
  "O que é problema dos fiscais e o que é problema nosso?",
  "Que ações dariam mais resultado nos próximos 60 dias?",
];

function AssistenteIA({ filtro }: { filtro: Filtro }) {
  const [msgs, setMsgs] = useState<MsgIA[]>([]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs, carregando]);

  const enviar = async (modo: "analise" | "pergunta", pergunta?: string) => {
    const historico = msgs;
    if (modo === "pergunta") { if (!pergunta?.trim()) return; setMsgs((m) => [...m, { role: "user", content: pergunta }]); setTexto(""); }
    else setMsgs((m) => [...m, { role: "user", content: "Gerar a análise gerencial com plano de ação sugerido." }]);
    setCarregando(true);
    try {
      const r = await perguntarIA({ modo, pergunta, historico, filtro });
      setMsgs((m) => [...m, { role: "assistant", content: r }]);
    } catch (e) {
      toast.error((e as Error).message);
      setMsgs((m) => m.slice(0, -1));
    } finally { setCarregando(false); }
  };
  const recorte = Object.entries(filtro).filter(([, v]) => v).length;

  return (
    <Card className="flex flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 font-semibold"><Sparkles className="h-4 w-4 text-violet-500" />Assistente de rotatividade</h3>
          <p className="text-xs text-muted-foreground">Lê os agregados da pesquisa e o turnover {recorte ? "do recorte filtrado acima" : "de todos os contratos"} e responde citando os números. Não vê respostas individuais nem nomes.</p>
        </div>
        <div className="flex gap-1.5">
          {msgs.length > 0 && <Button size="sm" variant="ghost" onClick={() => setMsgs([])}>Limpar</Button>}
          <Button size="sm" onClick={() => enviar("analise")} disabled={carregando}><Sparkles className="mr-1 h-4 w-4" />Gerar análise</Button>
        </div>
      </div>
      <div className="min-h-[240px] space-y-3 rounded-lg bg-muted/40 p-3">
        {!msgs.length && !carregando && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Exemplos:</p>
            {SUGESTOES.map((s) => <button key={s} className="block rounded-md border bg-background px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => enviar("pergunta", s)}>{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("rounded-lg px-3 py-2 text-sm", m.role === "user" ? "ml-auto max-w-[85%] bg-primary text-primary-foreground" : "bg-background")}>
            {m.role === "assistant"
              ? <div className="prose prose-sm max-w-none dark:prose-invert prose-h2:mb-1 prose-h2:mt-3 prose-h2:text-sm prose-p:my-1 prose-ul:my-1"><ReactMarkdown>{m.content}</ReactMarkdown></div>
              : m.content}
          </div>
        ))}
        {carregando && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Analisando…</div>}
        <div ref={fim} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); enviar("pergunta", texto); }}>
        <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ex.: por que o contrato X perde tanta gente?"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar("pergunta", texto); } }} />
        <Button type="submit" disabled={carregando || !texto.trim()}><Send className="h-4 w-4" /></Button>
      </form>
    </Card>
  );
}
