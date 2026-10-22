import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertCircle, CheckCircle2, Eye, FileText, Info, Loader2, Pencil, RotateCcw, Star, Users, XCircle, Gauge,
} from "lucide-react";
import {
  PRIORIDADES, STATUS_CHAMADO, StatCard, StatusBadge, PrioridadeBadge, fmtData, fmtDataHora, iniciais, moduloLabel,
} from "./types";
import {
  ADERENCIA_LABEL, CAMPO_AJUSTE_LABEL, COMPLEXIDADE_LABEL, CRITERIOS_INDICE, TEMAS,
  analiseQualidade, avaliarChamado, calcularKpis, leituraControladoria, rankingSolicitantes, resumoTemas,
  temaCor, temaLabel,
  type AjusteMonitor, type CampoAjuste, type ChamadoMonitor, type LinhaMonitor,
} from "@/lib/chamados/monitoramento";

// =====================================================================
// MONITORAMENTO DE CHAMADOS (22/10/2026, mig 20261022000180).
//
// Visão gerencial da QUALIDADE DAS SOLICITAÇÕES de desenvolvimento: tema,
// índice 0–10 por critérios explícitos, efetividade da entrega, ranking por
// solicitante e leitura para a Controladoria. Os fatos vêm da RPC
// chamados_monitoramento (uma chamada, já com contagens e avaliações); as
// regras moram em src/lib/chamados/monitoramento.ts — esta tela só filtra e
// desenha. Nada é digitado de novo pelo solicitante.
//
// Ajuste manual (ação "alterar" do menu): grava em
// CHAMADO_SISTEMA_MONITOR_AJUSTE com justificativa; o histórico aparece no
// detalhe do chamado.
// =====================================================================

const MENU = "central_servicos_chamados_monitoramento";
const TODOS = "__todos__";
const POR_PAGINA = 25;

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const inicioAnoISO = () => `${new Date().getFullYear()}-01-01`;
const fmt1 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1).replace(".", ","));

const corIndice = (n: number) => (n >= 7.5 ? "text-success" : n >= 5 ? "text-warning" : "text-destructive");
const bgIndice = (n: number) => (n >= 7.5 ? "bg-success" : n >= 5 ? "bg-warning" : "bg-destructive");

export default function MonitoramentoChamados() {
  const { data: podeAlterar = false } = useScreenAccess(MENU, "alterar");

  const [de, setDe] = useState(inicioAnoISO);
  const [ate, setAte] = useState(hojeISO);
  const [fSolic, setFSolic] = useState(TODOS);
  const [fSetor, setFSetor] = useState(TODOS);
  const [fModulo, setFModulo] = useState(TODOS);
  const [fTema, setFTema] = useState(TODOS);
  const [fPrioridade, setFPrioridade] = useState(TODOS);
  const [fStatus, setFStatus] = useState(TODOS);
  const [pagina, setPagina] = useState(1);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const periodoOk = !!de && !!ate && de <= ate;
  const { data: chamados = [], isLoading, error } = useQuery({
    queryKey: ["chamados-monitoramento", de, ate],
    enabled: periodoOk,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chamados_monitoramento", { p_de: de, p_ate: ate });
      if (error) throw error;
      return (data ?? []) as ChamadoMonitor[];
    },
  });

  // Avaliação de TODOS do período (uma vez por carga), depois o filtro.
  const todas: LinhaMonitor[] = useMemo(() => {
    const agora = new Date();
    return chamados.map((c) => ({ c, a: avaliarChamado(c, agora) }));
  }, [chamados]);

  const opcoes = useMemo(() => {
    const solic = new Map<string, string>();
    const setores = new Set<string>();
    const modulos = new Map<string, string>();
    for (const { c } of todas) {
      solic.set(c.solicitante_id, c.solicitante_nome ?? "—");
      if (c.setor?.trim()) setores.add(c.setor.trim());
      const mk = c.modulo_sistema ?? "";
      if (mk) modulos.set(mk, moduloLabel(c));
    }
    return {
      solicitantes: [...solic.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      setores: [...setores].sort((a, b) => a.localeCompare(b, "pt-BR")),
      modulos: [...modulos.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    };
  }, [todas]);

  const filtradas = useMemo(() => todas.filter(({ c, a }) =>
    (fSolic === TODOS || c.solicitante_id === fSolic)
    && (fSetor === TODOS || (c.setor?.trim() ?? "") === fSetor)
    && (fModulo === TODOS || c.modulo_sistema === fModulo)
    && (fTema === TODOS || a.tema === fTema)
    && (fPrioridade === TODOS || c.prioridade === fPrioridade)
    && (fStatus === TODOS || c.status === fStatus),
  ), [todas, fSolic, fSetor, fModulo, fTema, fPrioridade, fStatus]);

  const kpis = useMemo(() => calcularKpis(filtradas), [filtradas]);
  const temas = useMemo(() => resumoTemas(filtradas), [filtradas]);
  const ranking = useMemo(() => rankingSolicitantes(filtradas), [filtradas]);
  const qualidade = useMemo(() => analiseQualidade(filtradas), [filtradas]);
  const leitura = useMemo(() => leituraControladoria(filtradas), [filtradas]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtradas.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  const limpar = () => {
    setDe(inicioAnoISO()); setAte(hojeISO());
    setFSolic(TODOS); setFSetor(TODOS); setFModulo(TODOS); setFTema(TODOS); setFPrioridade(TODOS); setFStatus(TODOS);
    setPagina(1);
  };
  const filtro = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  const pct = (n: number) => (kpis.total ? Math.round((n / kpis.total) * 100) : 0);
  const detalhe = detalheId ? todas.find((l) => l.c.id === detalheId) ?? null : null;

  return (
    <div>
      <PageHeader
        title="Monitoramento de Chamados"
        subtitle="Analise os chamados por solicitante para medir efetividade, relevância operacional e qualidade das demandas no ERP."
        module="Central de Serviços"
        breadcrumb={["Chamados de Sistemas", "Monitoramento de Chamados"]}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card className="border-info/30 bg-info/5 p-4">
          <p className="flex items-start gap-1.5 text-sm font-semibold text-info">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Este painel analisa o conteúdo das solicitações e identifica os principais temas, prioridades e o nível de qualidade de cada demanda.
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Tudo é calculado a partir do que já está no chamado (título, descrição, anexos, conversa, prazos e avaliações), por regras fixas:
            o mesmo chamado sempre recebe a mesma nota, e cada nota mostra o porquê. Chamado não concluído tem avaliação <b>preliminar</b>;
            a efetividade só existe depois da entrega. Cancelados contam à parte e não pesam contra o solicitante.
          </p>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-sm font-bold">Resumo dos Temas das Solicitações</p>
          {temas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem solicitações no filtro.</p>
          ) : (
            <div className="space-y-1.5">
              {temas.map((t) => {
                const max = Math.max(...temas.map((x) => x.qtd));
                const ativo = fTema === t.tema;
                return (
                  <button
                    key={t.tema}
                    type="button"
                    onClick={() => filtro(setFTema)(ativo ? TODOS : t.tema)}
                    className={`grid w-full grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_2.5rem_2.5rem] items-center gap-2 rounded px-1 text-left text-xs hover:bg-muted/60 ${ativo ? "bg-muted" : ""}`}
                    title="Filtrar por este tema"
                  >
                    <span className="truncate text-primary">{t.label}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full" style={{ width: `${(t.qtd / max) * 100}%`, background: t.cor }} />
                    </span>
                    <span className="text-right font-bold">{t.qtd}</span>
                    <span className="text-right text-muted-foreground">{t.pct}%</span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard icon={Users} label="Solicitantes avaliados" value={kpis.solicitantes} hint="no período" />
        <StatCard icon={FileText} label="Total de solicitações" value={kpis.total} hint={kpis.canceladas ? `+ ${kpis.canceladas} cancelada(s) à parte` : "período selecionado"} tone="info" />
        <StatCard icon={CheckCircle2} label="Concluídas" value={kpis.concluidas} hint={`${pct(kpis.concluidas)}% do total`} tone="success" />
        <StatCard icon={RotateCcw} label="Em andamento" value={kpis.emAndamento} hint={`${pct(kpis.emAndamento)}% do total`} tone="warning" />
        <StatCard icon={AlertCircle} label="Pendentes" value={kpis.pendentes} hint={`${pct(kpis.pendentes)}% · ${kpis.reprovadas} reprovada(s)`} tone="destructive" />
        <StatCard icon={Gauge} label="Efetividade média" value={kpis.efetividadeMedia == null ? "—" : `${kpis.efetividadeMedia}%`} hint="só entregas concluídas" tone="success" />
        <StatCard icon={Star} label="Índice de qualidade" value={kpis.indiceMedio == null ? "—" : `${fmt1(kpis.indiceMedio)} / 10`} hint="média das solicitações" tone="warning" />
      </div>

      {/* Filtros */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <div className="space-y-1">
            <Label className="text-xs">Abertura de</Label>
            <Input type="date" value={de} onChange={(e) => filtro(setDe)(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">até</Label>
            <Input type="date" value={ate} onChange={(e) => filtro(setAte)(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Solicitante</Label>
            <SearchableSelect
              value={fSolic}
              onChange={filtro(setFSolic)}
              options={[{ value: TODOS, label: "Todos os solicitantes" }, ...opcoes.solicitantes]}
              placeholder="Todos os solicitantes"
            />
          </div>
          <FiltroSelect label="Setor" value={fSetor} onChange={filtro(setFSetor)} todos="Todos os setores"
            opcoes={opcoes.setores.map((s) => ({ value: s, label: s }))} />
          <FiltroSelect label="Módulo / Sistema" value={fModulo} onChange={filtro(setFModulo)} todos="Todos os módulos" opcoes={opcoes.modulos} />
          <FiltroSelect label="Tema" value={fTema} onChange={filtro(setFTema)} todos="Todos os temas"
            opcoes={TEMAS.map((t) => ({ value: t.value, label: t.label }))} />
          <FiltroSelect label="Prioridade" value={fPrioridade} onChange={filtro(setFPrioridade)} todos="Todas"
            opcoes={Object.entries(PRIORIDADES).map(([value, p]) => ({ value, label: p.label }))} />
          <FiltroSelect label="Status" value={fStatus} onChange={filtro(setFStatus)} todos="Todos"
            opcoes={Object.entries(STATUS_CHAMADO).map(([value, s]) => ({ value, label: s.label }))} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {!periodoOk ? <span className="text-destructive">Período inválido.</span>
              : <>{filtradas.length} chamado(s) no filtro · período pela data de abertura</>}
          </p>
          <Button variant="outline" size="sm" onClick={limpar} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Limpar filtros</Button>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="mb-4 p-4">
        <p className="mb-3 text-sm font-bold">Detalhamento das solicitações por solicitante</p>
        {error ? (
          <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando chamados…</div>
        ) : filtradas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum chamado no filtro.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Solicitante</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead>Nº do chamado</TableHead>
                    <TableHead className="min-w-[180px]">Assunto</TableHead>
                    <TableHead>Tema</TableHead>
                    <TableHead>Módulo / Sistema</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Complexidade</TableHead>
                    <TableHead>Efetividade</TableHead>
                    <TableHead>Aderência</TableHead>
                    <TableHead>Índice</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Prazo (dias)</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead>Conclusão</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map(({ c, a }) => (
                    <TableRow key={c.id} className={a.cancelado ? "opacity-60" : undefined}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{iniciais(c.solicitante_nome)}</AvatarFallback></Avatar>
                          <span className="max-w-[130px] truncate font-medium" title={c.solicitante_nome ?? ""}>{c.solicitante_nome ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate" title={c.setor ?? ""}>{c.setor ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap font-bold">{c.numero ?? "—"}</TableCell>
                      <TableCell className="max-w-[240px] truncate" title={c.assunto}>{c.assunto}</TableCell>
                      <TableCell>
                        <span
                          className="inline-block max-w-[170px] truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ color: temaCor(a.tema), borderColor: `${temaCor(a.tema)}55`, background: `${temaCor(a.tema)}14` }}
                          title={`${temaLabel(a.tema)}${a.ajustado.includes("tema") ? " (ajustado)" : ""}`}
                        >
                          {temaLabel(a.tema)}{a.ajustado.includes("tema") && " *"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{moduloLabel(c)}</TableCell>
                      <TableCell><PrioridadeBadge prioridade={c.prioridade} /></TableCell>
                      <TableCell>{COMPLEXIDADE_LABEL[a.complexidade]}{a.ajustado.includes("complexidade") && " *"}</TableCell>
                      <TableCell>
                        {a.efetividade == null ? (
                          <span className="text-muted-foreground" title={a.efetividadeMotivo}>—</span>
                        ) : (
                          <div className="flex items-center gap-1.5" title={a.efetividadeMotivo}>
                            <span className="w-8 font-bold">{a.efetividade}%</span>
                            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                              <span className={`block h-full ${a.efetividade >= 80 ? "bg-success" : a.efetividade >= 60 ? "bg-info" : "bg-warning"}`} style={{ width: `${a.efetividade}%` }} />
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{ADERENCIA_LABEL[a.aderencia]}{a.ajustado.includes("aderencia") && " *"}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1 whitespace-nowrap" title={a.preliminar ? "Avaliação preliminar — chamado ainda não concluído" : "Avaliação final"}>
                          <span className={`h-2 w-2 rounded-full ${bgIndice(a.indice)}`} />
                          <b className={corIndice(a.indice)}>{fmt1(a.indice)}</b>
                          {a.preliminar && <span className="text-[10px] text-muted-foreground">prel.</span>}
                          {a.ajustado.includes("indice") && " *"}
                        </span>
                      </TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-right">{fmt1(a.prazoDias)}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtData(c.created_at)}</TableCell>
                      <TableCell className="whitespace-nowrap">{c.status === "concluido" ? fmtData(c.concluido_em) : "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver chamado, critérios e histórico" onClick={() => setDetalheId(c.id)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>* ajustado manualmente · "prel." = avaliação preliminar (não concluído)</span>
              {totalPaginas > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
                  <span>Página {paginaAtual} de {totalPaginas}</span>
                  <Button variant="outline" size="sm" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 text-sm font-bold">Ranking dos solicitantes</p>
          {ranking.length === 0 ? <p className="text-xs text-muted-foreground">Sem dados.</p> : (
            <div className="max-h-[360px] overflow-y-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Solicitante</TableHead>
                    <TableHead className="text-right">Chamados</TableHead>
                    <TableHead className="text-right">Média do índice</TableHead>
                    <TableHead className="text-right">Efetividade média</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranking.map((r, i) => (
                    <TableRow key={r.solicitante_id} className="cursor-pointer" onClick={() => filtro(setFSolic)(r.solicitante_id)} title="Filtrar por este solicitante">
                      <TableCell>
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                          i === 0 ? "bg-warning text-warning-foreground" : i === 1 ? "bg-muted-foreground/30" : i === 2 ? "bg-orange-400 text-white" : ""}`}>{i + 1}</span>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{r.nome}</p>
                        <p className="text-[10px] text-muted-foreground">{r.setor ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-right">{r.total}<span className="text-muted-foreground"> ({r.concluidos} concl.)</span></TableCell>
                      <TableCell className="text-right"><b className={corIndice(r.indiceMedio)}>{fmt1(r.indiceMedio)}</b></TableCell>
                      <TableCell className="text-right font-bold text-primary">{r.efetividadeMedia == null ? "—" : `${r.efetividadeMedia}%`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">O desempenho do solicitante é só a consolidação das solicitações dele. Cancelados não entram.</p>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-bold">Análise de qualidade das solicitações</p>
          <div className="space-y-2">
            <BarraQualidade label="Solicitações com objetivo claro" pct={qualidade.objetivoClaro} cor="bg-success" />
            <BarraQualidade label="Solicitações com grande relevância operacional" pct={qualidade.relevanciaOperacional} cor="bg-info" />
            <BarraQualidade label="Solicitações que trazem melhoria de processo" pct={qualidade.melhoriaProcesso} cor="bg-warning" />
            <BarraQualidade label="Solicitações com visão estratégica" pct={qualidade.visaoEstrategica} cor="bg-primary" />
            <BarraQualidade label="Solicitações com baixa especificação" pct={qualidade.baixaEspecificacao} cor="bg-destructive" />
          </div>
          <div className="mt-4 rounded-md border border-info/30 bg-info/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-info"><Info className="h-3.5 w-3.5" /> Leitura da Controladoria</p>
            <p className="mt-1 text-xs text-muted-foreground">{leitura}</p>
          </div>
        </Card>
      </div>

      {detalhe && (
        <DetalheDialog linha={detalhe} podeAlterar={podeAlterar} onClose={() => setDetalheId(null)} />
      )}
    </div>
  );
}

function FiltroSelect({ label, value, onChange, todos, opcoes }: {
  label: string; value: string; onChange: (v: string) => void; todos: string;
  opcoes: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={todos} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>{todos}</SelectItem>
          {opcoes.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function BarraQualidade({ label, pct, cor }: { label: string; pct: number; cor: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] items-center gap-3 text-xs">
      <span className="truncate">{label}</span>
      <b className="text-right">{pct}%</b>
      <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${cor}`} style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

// ---- Detalhe: critérios, conversa e histórico de ajustes -----------------
interface DetalheRpc {
  eventos: Array<{ id: string; tipo: string; texto: string | null; autor: string | null; created_at: string }>;
  anexos: Array<{ nome: string; campo: string; created_at: string }>;
  ajustes: AjusteMonitor[];
}

function valorExibido(campo: CampoAjuste, l: LinhaMonitor): string {
  const { a } = l;
  switch (campo) {
    case "tema": return a.tema;
    case "complexidade": return a.complexidade;
    case "aderencia": return a.aderencia;
    case "efetividade": return a.efetividade == null ? "" : String(a.efetividade);
    case "indice": return String(a.indice);
  }
}

function rotuloValor(campo: string, v: string | null): string {
  if (v == null || v === "") return "automático";
  if (campo === "tema") return temaLabel(v);
  if (campo === "complexidade") return COMPLEXIDADE_LABEL[v as keyof typeof COMPLEXIDADE_LABEL] ?? v;
  if (campo === "aderencia") return ADERENCIA_LABEL[v as keyof typeof ADERENCIA_LABEL] ?? v;
  if (campo === "efetividade") return `${v}%`;
  return v.replace(".", ",");
}

function DetalheDialog({ linha, podeAlterar, onClose }: { linha: LinhaMonitor; podeAlterar: boolean; onClose: () => void }) {
  const { c, a } = linha;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["chamado-monitoramento-detalhe", c.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chamado_monitoramento_detalhe", { p_chamado_id: c.id });
      if (error) throw error;
      return data as DetalheRpc;
    },
  });

  const [campo, setCampo] = useState<CampoAjuste>("tema");
  const [valor, setValor] = useState<string>("");
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async (voltarAutomatico: boolean) => {
    if (justificativa.trim().length < 10) {
      toast({ title: "Explique o ajuste", description: "A justificativa precisa de pelo menos 10 caracteres.", variant: "destructive" });
      return;
    }
    if (!voltarAutomatico && !valor.trim()) {
      toast({ title: "Informe o novo valor", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const { error } = await (supabase as any).rpc("chamado_monitoramento_ajustar", {
      p_chamado_id: c.id, p_campo: campo, p_valor: voltarAutomatico ? null : valor.trim(),
      p_valor_anterior: valorExibido(campo, linha), p_justificativa: justificativa.trim(),
    });
    setSalvando(false);
    if (error) {
      toast({ title: "Não foi possível ajustar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ajuste registrado", description: `${CAMPO_AJUSTE_LABEL[campo]}: ${voltarAutomatico ? "voltou ao automático" : rotuloValor(campo, valor.trim())}` });
    setValor(""); setJustificativa("");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["chamados-monitoramento"] }),
      qc.invalidateQueries({ queryKey: ["chamado-monitoramento-detalhe", c.id] }),
    ]);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {c.numero} <StatusBadge status={c.status} /> <PrioridadeBadge prioridade={c.prioridade} />
          </DialogTitle>
          <DialogDescription>{c.assunto} — {c.solicitante_nome ?? "—"} ({c.setor ?? "sem setor"}) · aberto em {fmtData(c.created_at)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-3">
            <p className="text-[11px] text-muted-foreground">Índice de qualidade {a.preliminar && "(preliminar)"}</p>
            <p className={`text-2xl font-bold ${corIndice(a.indice)}`}>{fmt1(a.indice)}<span className="text-sm text-muted-foreground"> / 10</span></p>
            {a.ajustado.includes("indice") && <p className="text-[10px] text-muted-foreground">automático: {fmt1(a.indiceAuto)}</p>}
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted-foreground">Efetividade da entrega</p>
            <p className="text-2xl font-bold">{a.efetividade == null ? "—" : `${a.efetividade}%`}</p>
            <p className="text-[10px] text-muted-foreground">{a.efetividadeMotivo}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted-foreground">Tema</p>
            <p className="text-sm font-bold" style={{ color: temaCor(a.tema) }}>{temaLabel(a.tema)}</p>
            <p className="text-[10px] text-muted-foreground">
              {a.ajustado.includes("tema") ? `ajustado (automático: ${temaLabel(a.temaAuto.tema)})` : a.temaAuto.motivo}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">Complexidade {COMPLEXIDADE_LABEL[a.complexidade]} · Aderência {ADERENCIA_LABEL[a.aderencia]}</p>
          </Card>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold">Critérios do índice</p>
          <Table className="text-xs">
            <TableBody>
              {CRITERIOS_INDICE.map((k) => {
                const n = a.criterios[k.key];
                return (
                  <TableRow key={k.key}>
                    <TableCell className="py-1.5 font-medium">{k.titulo} <span className="text-muted-foreground">({Math.round(k.peso * 100)}%)</span></TableCell>
                    <TableCell className={`py-1.5 text-right font-bold ${n.nota == null ? "text-muted-foreground" : corIndice(n.nota)}`}>{fmt1(n.nota)}</TableCell>
                    <TableCell className="py-1.5 text-muted-foreground">{n.motivo}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold">Descrição do solicitante</p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs [overflow-wrap:anywhere]">{c.descricao || "—"}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {c.anexos_abertura} anexo(s) na abertura · {c.anexos_total} no total · {c.comentarios} mensagem(ns) · {c.pedidos_info} pedido(s) de informação · {c.reaberturas} reabertura(s)
            {c.prazo_previsto && <> · prazo previsto {fmtData(c.prazo_previsto)}</>}
          </p>
        </div>

        {podeAlterar && (
          <Card className="space-y-2 border-warning/30 bg-warning/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold"><Pencil className="h-3.5 w-3.5" /> Ajuste manual (fica no histórico)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={campo} onValueChange={(v) => { setCampo(v as CampoAjuste); setValor(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CAMPO_AJUSTE_LABEL) as CampoAjuste[]).map((k) => <SelectItem key={k} value={k}>{CAMPO_AJUSTE_LABEL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
              {campo === "tema" ? (
                <Select value={valor} onValueChange={setValor}>
                  <SelectTrigger><SelectValue placeholder="Novo tema" /></SelectTrigger>
                  <SelectContent>{TEMAS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : campo === "complexidade" || campo === "aderencia" ? (
                <Select value={valor} onValueChange={setValor}>
                  <SelectTrigger><SelectValue placeholder="Novo valor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="media">Média</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  inputMode="decimal"
                  placeholder={campo === "indice" ? "0 a 10" : "0 a 100"}
                  value={valor}
                  onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ""))}
                />
              )}
            </div>
            <Textarea rows={2} placeholder="Justificativa (obrigatória)" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Atual: {rotuloValor(campo, valorExibido(campo, linha))}{a.ajustado.includes(campo) ? " (ajustado)" : " (automático)"}</p>
            <div className="flex flex-wrap justify-end gap-2">
              {a.ajustado.includes(campo) && (
                <Button variant="outline" size="sm" disabled={salvando} onClick={() => salvar(true)}>Voltar ao automático</Button>
              )}
              <Button size="sm" disabled={salvando} onClick={() => salvar(false)} className="gap-1.5">
                {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Registrar ajuste
              </Button>
            </div>
          </Card>
        )}

        <div>
          <p className="mb-1 text-xs font-bold">Histórico de ajustes</p>
          {isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p>
            : !data?.ajustes.length ? <p className="text-xs text-muted-foreground">Nenhum ajuste manual — tudo automático.</p>
            : (
              <ul className="space-y-1.5">
                {data.ajustes.map((j) => (
                  <li key={j.id} className="rounded-md border p-2 text-xs">
                    <p><b>{CAMPO_AJUSTE_LABEL[j.campo] ?? j.campo}</b>: {rotuloValor(j.campo, j.valor_anterior)} → <b>{rotuloValor(j.campo, j.valor)}</b></p>
                    <p className="text-muted-foreground">{j.justificativa}</p>
                    <p className="text-[10px] text-muted-foreground">{j.autor_nome ?? "—"} · {fmtDataHora(j.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div>
          <p className="mb-1 text-xs font-bold">Histórico do chamado</p>
          {isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p>
            : !data?.eventos.length ? <p className="text-xs text-muted-foreground">Sem movimentações.</p>
            : (
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {data.eventos.map((e) => (
                  <li key={e.id} className="text-xs">
                    <span className="text-muted-foreground">{fmtDataHora(e.created_at)} · {e.autor ?? "—"}:</span>{" "}
                    <span className="break-words [overflow-wrap:anywhere]">{e.texto || e.tipo}</span>
                  </li>
                ))}
              </ul>
            )}
          {!!data?.anexos.length && (
            <p className="mt-1 text-[11px] text-muted-foreground">Anexos: {data.anexos.map((x) => x.nome).join(", ")}</p>
          )}
        </div>

        {c.status === "cancelado" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> Cancelado pelo solicitante — fora das médias e do ranking.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
