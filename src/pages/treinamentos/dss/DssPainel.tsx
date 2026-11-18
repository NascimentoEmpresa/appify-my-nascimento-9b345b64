import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Building2, CheckCircle2, ClipboardCheck, Download, Eye, Loader2, Plus, Search, ShieldCheck, Trash2, UserX, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useDss, useDssPorColaborador, useExcluirRascunhoDss, usePainelDss } from "@/hooks/useDss";
import {
  MENU_DSS, ROTULO_STATUS_PESSOA, agregarPorContrato, calcularIndicadoresDss, fmtPctDss, hojeIso, intervaloMes,
  intervaloSemana, pct, rotuloSemana, segundaDaSemana, statusPessoa,
} from "@/lib/treinamentos/dss";
import { EMPRESAS_TREINAMENTO, fmtDataBr, siglaEmpresa } from "@/lib/treinamentos/contratoTreinamento";
import { Kpi } from "@/pages/treinamentos/contratos/componentes";
import { BarraPct, DssFormDialog, SeloContrato, SeloPessoa, SeloSituacao, exportarXlsx, fmtDataHoraBr } from "./componentes";

// =====================================================================
// TREINAMENTOS › DSS — Diálogo Semanal de Segurança (SIS-2026-0891,
// mig 20261119100000). Painel do SST: indicadores, contratos com o DSS
// feito / com pendência, a lista dos DSS e a consulta por colaborador.
// Filtros: período (semana / mês / tudo), empresa, contrato, status.
// O colaborador lê e assina no Portal do Colaborador (/colaborador/dss).
// =====================================================================

type Periodo = "semana" | "mes" | "tudo";
const TODOS = "todos";

export default function DssPainel() {
  const nav = useNavigate();
  const hoje = hojeIso();
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [semana, setSemana] = useState(segundaDaSemana(hoje));
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [empresa, setEmpresa] = useState(TODOS);
  const [contrato, setContrato] = useState(TODOS);
  const [statusContrato, setStatusContrato] = useState<"todos" | "concluido" | "pendente">("todos");
  const [buscaColab, setBuscaColab] = useState("");
  const [novo, setNovo] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const podeExportar = useScreenAccess(MENU_DSS, "exportar").data === true;
  const podeIncluir = useScreenAccess(MENU_DSS, "incluir").data === true;

  const intervalo = periodo === "semana" ? intervaloSemana(semana) : periodo === "mes" ? intervaloMes(mes) : { de: null, ate: null };
  const painel = usePainelDss(intervalo.de, intervalo.ate);
  const editando = useDss(editandoId ?? undefined);
  const excluir = useExcluirRascunhoDss();
  const porColab = useDssPorColaborador(buscaColab, intervalo.de, intervalo.ate);

  const linhasTodas = useMemo(() => painel.data?.contratos ?? [], [painel.data]);
  const opcoesContrato = useMemo(() => {
    const m = new Map<string, { chave: string; nome: string; empresa: number }>();
    for (const l of linhasTodas) {
      if (empresa !== TODOS && String(l.empresa) !== empresa) continue;
      m.set(`${l.empresa}/${l.filial}`, { chave: `${l.empresa}/${l.filial}`, nome: l.contrato_nome, empresa: l.empresa });
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
  }, [linhasTodas, empresa]);

  const linhas = useMemo(() => linhasTodas.filter((l) =>
    (empresa === TODOS || String(l.empresa) === empresa) && (contrato === TODOS || `${l.empresa}/${l.filial}` === contrato),
  ), [linhasTodas, empresa, contrato]);
  const ind = calcularIndicadoresDss(linhas);
  const contratos = agregarPorContrato(linhas).filter((c) => c.status !== "sem_destinatarios" && (statusContrato === "todos" || c.status === statusContrato));

  const dssLista = useMemo(() => {
    const filtrando = empresa !== TODOS || contrato !== TODOS;
    return (painel.data?.dss ?? []).map((d) => {
      const ls = linhas.filter((l) => l.dss_id === d.id);
      const dest = ls.reduce((a, l) => a + l.destinatarios, 0);
      const ass = ls.reduce((a, l) => a + l.assinaram, 0);
      return { ...d, dest, ass, pct: pct(ass, dest), contratos: ls.length };
    }).filter((d) => !filtrando || d.contratos > 0);
  }, [painel.data, linhas, empresa, contrato]);

  const colabLinhas = (porColab.data ?? []).filter((l) =>
    (empresa === TODOS || String(l.empresa) === empresa) && (contrato === TODOS || `${l.empresa}/${l.filial}` === contrato));

  const rotuloPeriodo = periodo === "semana" ? rotuloSemana(semana) : periodo === "mes" ? `Mês ${mes.slice(5, 7)}/${mes.slice(0, 4)}` : "Todo o período";

  const exportar = () => exportarXlsx(`dss-${intervalo.de ?? "todos"}.xlsx`, [
    { nome: "Por contrato", linhas: contratos.map((c) => ({
      Empresa: siglaEmpresa(c.empresa), Contrato: c.contrato_nome, Destinatários: c.destinatarios, Acessaram: c.acessaram,
      Assinaram: c.assinaram, "Assinaram em papel": c.assinaram_papel, Pendentes: c.destinatarios - c.assinaram,
      "% conclusão": c.pct, Status: c.status === "concluido" ? "Concluído" : "Com pendências",
    })) },
    { nome: "DSS", linhas: dssLista.map((d) => ({
      Tema: d.tema, Semana: fmtDataBr(d.semana_ref), Situação: d.situacao, "Disponível de": fmtDataBr(d.disponivel_de),
      "Disponível até": d.disponivel_ate ? fmtDataBr(d.disponivel_ate) : "", Destinatários: d.dest, Assinaram: d.ass, "% conclusão": d.pct,
    })) },
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title="DSS – Diálogo Semanal de Segurança" module="Treinamentos" breadcrumb={["DSS"]}
        subtitle="Publique o DSS da semana para os contratos e acompanhe quem leu e assinou pelo Portal do Colaborador."
        actions={<div className="flex gap-2">
          {podeExportar && <Button variant="outline" onClick={exportar} disabled={!painel.data}><Download className="mr-2 h-4 w-4" />Exportar</Button>}
          <AcessoGate menu={MENU_DSS} acao="incluir">
            <Button onClick={() => setNovo(true)}><Plus className="mr-2 h-4 w-4" />Novo DSS</Button>
          </AcessoGate>
        </div>} />

      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label className="text-xs">Período</Label>
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="semana">Semana</SelectItem>
              <SelectItem value="mes">Mês</SelectItem>
              <SelectItem value="tudo">Tudo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{periodo === "semana" ? "Qualquer dia da semana" : periodo === "mes" ? "Mês" : "—"}</Label>
          {periodo === "semana" && <Input type="date" value={semana} onChange={(e) => e.target.value && setSemana(segundaDaSemana(e.target.value))} />}
          {periodo === "mes" && <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />}
          {periodo === "tudo" && <Input disabled value="Todos os DSS" />}
        </div>
        <div>
          <Label className="text-xs">Empresa</Label>
          <Select value={empresa} onValueChange={(v) => { setEmpresa(v); setContrato(TODOS); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {EMPRESAS_TREINAMENTO.map((e) => <SelectItem key={e.codigo} value={String(e.codigo)}>{e.sigla}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Contrato</Label>
          <Select value={contrato} onValueChange={setContrato}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {opcoesContrato.map((c) => <SelectItem key={c.chave} value={c.chave}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status do contrato</Label>
          <Select value={statusContrato} onValueChange={(v) => setStatusContrato(v as typeof statusContrato)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="concluido">Concluídos</SelectItem>
              <SelectItem value="pendente">Com pendências</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{rotuloPeriodo}{periodo === "semana" ? " · o período considera a semana de referência de cada DSS" : ""}</p>

      {painel.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</div>
      ) : painel.isError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{(painel.error as Error).message}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icone={Users} rotulo="Colaboradores" valor={ind.destinatarios.toLocaleString("pt-BR")} dica="que deveriam fazer o DSS" cor="bg-slate-100 text-slate-700" />
            <Kpi icone={Eye} rotulo="Acessaram" valor={ind.acessaram.toLocaleString("pt-BR")} dica={`${ind.naoAcessaram} não acessaram`} cor="bg-sky-100 text-sky-700" />
            <Kpi icone={ClipboardCheck} rotulo="Assinaram" valor={ind.assinaram.toLocaleString("pt-BR")} dica={`${ind.assinaramPapel} em papel`} cor="bg-emerald-100 text-emerald-700" />
            <Kpi icone={UserX} rotulo="Pendentes" valor={ind.pendentes.toLocaleString("pt-BR")} dica={`${ind.aguardando} leram e não assinaram`} cor="bg-amber-100 text-amber-700" />
            <Kpi icone={ShieldCheck} rotulo="% de conclusão" valor={fmtPctDss(ind.pctConclusao)} cor="bg-primary/10 text-primary" />
            <Kpi icone={CheckCircle2} rotulo="Contratos concluídos" valor={ind.contratosConcluidos} dica={`de ${ind.contratos}`} cor="bg-emerald-100 text-emerald-700" />
            <Kpi icone={Building2} rotulo="Contratos com pendência" valor={ind.contratosPendentes} cor="bg-red-100 text-red-700" />
          </div>

          <Tabs defaultValue="contratos">
            <TabsList>
              <TabsTrigger value="contratos">Por contrato</TabsTrigger>
              <TabsTrigger value="dss">DSS ({dssLista.length})</TabsTrigger>
              <TabsTrigger value="colaborador">Por colaborador</TabsTrigger>
            </TabsList>

            <TabsContent value="contratos">
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Contrato</TableHead><TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Colaboradores</TableHead><TableHead className="text-right">Acessaram</TableHead>
                    <TableHead className="text-right">Assinaram</TableHead><TableHead className="text-right">Pendentes</TableHead>
                    <TableHead>Conclusão</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {contratos.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum DSS publicado neste período{empresa !== TODOS || contrato !== TODOS ? " para o filtro escolhido" : ""}.
                    </TableCell></TableRow>}
                    {contratos.map((c) => (
                      <TableRow key={c.chave}>
                        <TableCell className="font-medium">{c.contrato_nome}</TableCell>
                        <TableCell>{siglaEmpresa(c.empresa)}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.destinatarios}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.acessaram}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.assinaram}{c.assinaram_papel ? <span className="text-xs text-muted-foreground"> ({c.assinaram_papel} papel)</span> : null}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.destinatarios - c.assinaram}</TableCell>
                        <TableCell><BarraPct valor={c.pct} /></TableCell>
                        <TableCell><SeloContrato status={c.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="dss">
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Tema</TableHead><TableHead>Semana</TableHead><TableHead>Situação</TableHead>
                    <TableHead>Disponível</TableHead><TableHead>Público</TableHead><TableHead>Conclusão</TableHead><TableHead />
                  </TableRow></TableHeader>
                  <TableBody>
                    {dssLista.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum DSS neste período. {podeIncluir ? "Use “Novo DSS” para criar o da semana." : ""}
                    </TableCell></TableRow>}
                    {dssLista.map((d) => (
                      <TableRow key={d.id} className={d.situacao !== "rascunho" ? "cursor-pointer" : undefined}
                        onClick={() => d.situacao !== "rascunho" && nav(`/app/treinamentos/dss/${d.id}`)}>
                        <TableCell className="font-medium">{d.tema}</TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDataBr(d.semana_ref)}</TableCell>
                        <TableCell><SeloSituacao situacao={d.situacao} vigente={d.vigente} /></TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDataBr(d.disponivel_de)} → {d.disponivel_ate ? fmtDataBr(d.disponivel_ate) : "até encerrar"}</TableCell>
                        <TableCell className="text-xs">{d.todos_contratos ? "Todos os contratos" : `${d.contratos || "—"} contrato(s)`}</TableCell>
                        <TableCell>{d.situacao === "rascunho" ? <span className="text-xs text-muted-foreground">—</span>
                          : <div className="flex items-center gap-2"><BarraPct valor={d.pct} /><span className="text-xs text-muted-foreground">{d.ass}/{d.dest}</span></div>}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {d.situacao === "rascunho" ? (
                            <AcessoGate menu={MENU_DSS} acao="incluir">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="outline" onClick={() => setEditandoId(d.id)}>Editar</Button>
                                <Button size="sm" variant="ghost" title="Excluir rascunho" onClick={() => {
                                  if (!window.confirm(`Excluir o rascunho "${d.tema}"?`)) return;
                                  excluir.mutate(d.id, { onError: (e) => toast.error((e as Error).message), onSuccess: () => toast.success("Rascunho excluído.") });
                                }}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </AcessoGate>
                          ) : <Button size="sm" variant="outline" asChild><Link to={`/app/treinamentos/dss/${d.id}`}>Abrir</Link></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="colaborador" className="space-y-3">
              <div className="relative max-w-md">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Nome, matrícula ou CPF (mínimo 3 caracteres)" value={buscaColab} onChange={(e) => setBuscaColab(e.target.value)} />
              </div>
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Colaborador</TableHead><TableHead>Contrato</TableHead><TableHead>DSS</TableHead>
                    <TableHead>Semana</TableHead><TableHead>Status</TableHead><TableHead>Acesso</TableHead><TableHead>Assinatura</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {buscaColab.trim().length < 3 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Digite para buscar o histórico de DSS de um colaborador no período.</TableCell></TableRow>}
                    {porColab.isFetching && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Buscando…</TableCell></TableRow>}
                    {buscaColab.trim().length >= 3 && !porColab.isFetching && colabLinhas.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nenhum DSS encontrado para essa busca no período.</TableCell></TableRow>}
                    {colabLinhas.map((l) => (
                      <TableRow key={`${l.dss_id}-${l.empregado_id}`}>
                        <TableCell><p className="font-medium">{l.nome}</p><p className="text-xs text-muted-foreground">{l.matricula ? `Mat. ${l.matricula}` : ""}{l.cargo ? ` · ${l.cargo}` : ""}</p></TableCell>
                        <TableCell className="text-xs">{l.contrato_nome}</TableCell>
                        <TableCell><Link className="text-primary underline" to={`/app/treinamentos/dss/${l.dss_id}`}>{l.tema}</Link></TableCell>
                        <TableCell className="whitespace-nowrap">{fmtDataBr(l.semana_ref)}</TableCell>
                        <TableCell><SeloPessoa status={statusPessoa(l)} /></TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDataHoraBr(l.acessado_em)}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{fmtDataHoraBr(l.assinado_em)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {podeExportar && colabLinhas.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => exportarXlsx("dss-colaborador.xlsx", [{ nome: "Colaborador", linhas: colabLinhas.map((l) => ({
                  Colaborador: l.nome, Matrícula: l.matricula ?? "", Contrato: l.contrato_nome, DSS: l.tema, Semana: fmtDataBr(l.semana_ref),
                  Status: ROTULO_STATUS_PESSOA[statusPessoa(l)], Acesso: fmtDataHoraBr(l.acessado_em), Assinatura: fmtDataHoraBr(l.assinado_em),
                })) }])}><Download className="mr-2 h-4 w-4" />Exportar busca</Button>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      <DssFormDialog aberto={novo} onFechar={() => setNovo(false)}
        onSalvo={(id, publicado) => { if (publicado) nav(`/app/treinamentos/dss/${id}`); }} />
      <DssFormDialog aberto={!!editandoId && !!editando.data} editando={editando.data ?? null} onFechar={() => setEditandoId(null)}
        onSalvo={(id, publicado) => { if (publicado) nav(`/app/treinamentos/dss/${id}`); }} />
    </div>
  );
}
