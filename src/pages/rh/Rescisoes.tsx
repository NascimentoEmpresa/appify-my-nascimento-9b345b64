import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { KanbanRescisoes } from "@/components/rescisoes/KanbanRescisoes";
import { ListaRescisoes } from "@/components/rescisoes/ListaRescisoes";
import { FichaRescisao, type AbrirFicha } from "@/components/rescisoes/FichaRescisao";
import { ImportarPlanilha } from "@/components/rescisoes/ImportarPlanilha";
import { useRescisoes } from "@/hooks/useRescisoes";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  HOMOLOGACOES, STATUS_RESCISAO, TIPOS_DESLIGAMENTO,
  filtrarRescisoes, hojeIso, ordenarRescisoes, pagamentoAtrasado, patchDoMovimento, planilhaDasRescisoes,
  resumoPorStatus, semRetorno,
  type EdicaoRescisao, type FiltroRescisao, type IdentificacaoRescisao, type LinhaRescisao, type OrdemRescisao,
} from "@/lib/demissao/rescisao";
import {
  AlertTriangle, CalendarClock, Download, FileClock, KanbanSquare, List, Loader2, Plus, RefreshCw, Search,
  SlidersHorizontal, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * RESCISÕES — submódulo próprio (21/10/2026, mig 20261021000030).
 *
 * "Praticamente igual o do recrutamento, mas pra rescisões, com kanban pra
 * mudar os status — mais simples e ágil." É a PLANILHA DE RESCISÃO Geral
 * 2026 do RH virada tela:
 *   · kanban por STATUS (as colunas são o RESUMO da planilha) — arrastar muda
 *     o status e grava histórico;
 *   · lista no formato da planilha, com os mesmos filtros (o autofiltro do
 *     Excel) e a ordem por pagamento/demissão/recebido;
 *   · a régua de datas das fórmulas da planilha (demissão = último dia + 7 no
 *     trabalhado; pagamento = demissão + 5);
 *   · importar a planilha (todas as abas, linha original guardada), exportar
 *     no mesmo layout, e lançar a rescisão nova à mão.
 *
 * As solicitações do ERP aparecem sozinhas assim que chegam ao RH — o fluxo
 * delas (liberar pro SST, cancelar, devolver) continua em RH › Solicitações
 * de Demissão; aqui é só o controle da rescisão.
 */

type Visao = "kanban" | "lista";
const FILTRO_INICIAL: FiltroRescisao = { campoMes: "pagamento" };

function Kpi({ titulo, valor, icone: Icone, cor, ativo, onClick, dica }: {
  titulo: string; valor: number; icone: LucideIcon; cor: string; ativo?: boolean; onClick?: () => void; dica?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={dica}
      className={cn("flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:border-primary/40",
        ativo && "border-primary ring-2 ring-primary/30")}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", cor)}><Icone className="h-[18px] w-[18px]" /></span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</span>
        <span className="block text-xl font-bold leading-tight">{valor}</span>
      </span>
    </button>
  );
}

export default function Rescisoes() {
  const dados = useRescisoes();
  const { linhas, carregando, erro, carregar, salvar, mover, criarManual, excluir } = dados;
  const hoje = hojeIso();

  // Lançar/mover: "alterar" OU "aprovar" — a mesma régua da RLS. Apagar: "excluir".
  const { data: podeAlterar } = useScreenAccess("rescisoes_gestao", "alterar");
  const { data: podeAprovar } = useScreenAccess("rescisoes_gestao", "aprovar");
  const { data: podeExcluir } = useScreenAccess("rescisoes_gestao", "excluir");
  const podeEditar = !!podeAlterar || !!podeAprovar;

  const [visao, setVisao] = useState<Visao>(() => {
    try { return (localStorage.getItem("rescisoes.visao") as Visao) || "kanban"; } catch { return "kanban"; }
  });
  const trocarVisao = (v: Visao) => { setVisao(v); try { localStorage.setItem("rescisoes.visao", v); } catch { /* sem storage */ } };

  // ── Filtros ──────────────────────────────────────────────────────
  const [filtro, setFiltro] = useState<FiltroRescisao>(FILTRO_INICIAL);
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [ordem, setOrdem] = useState<OrdemRescisao>("pagamento");
  const muda = (p: Partial<FiltroRescisao>) => setFiltro((f) => ({ ...f, ...p }));
  const limpar = () => { setFiltro(FILTRO_INICIAL); setFContratos([]); };

  const empresas = useMemo(() => [...new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])].sort(), [linhas]);
  const linhasContrato = useMemo(() => linhas.map((l) => ({ contrato: l.contrato })), [linhas]);

  // No kanban o status é a coluna — o filtro de status vale só na lista.
  const filtroDaVisao = useMemo(() => (visao === "kanban" ? { ...filtro, statusRescisao: "" } : filtro), [visao, filtro]);
  const filtradas = useMemo(() => ordenarRescisoes(
    filtrarRescisoes(linhas, filtroDaVisao, hoje).filter((l) => passaNoFiltroContratos({ contrato: l.contrato }, "contrato", fContratos)),
    ordem,
  ), [linhas, filtroDaVisao, fContratos, ordem, hoje]);

  const resumo = useMemo(() => resumoPorStatus(linhas), [linhas]);
  const atrasadas = useMemo(() => linhas.filter((l) => pagamentoAtrasado(l, hoje)).length, [linhas, hoje]);
  const faltaProgramar = useMemo(() => linhas.filter((l) => !(l.rescisaoProgramada && l.valesProgramados) && l.statusRescisao === "Por fazer").length, [linhas]);
  const aguardandoRetorno = useMemo(() => linhas.filter(semRetorno).length, [linhas]);
  const proximos7 = useMemo(() => {
    const limite = new Date(); limite.setDate(limite.getDate() + 7);
    const ate = hojeIso(limite);
    return linhas.filter((l) => l.pagamento && l.pagamento > hoje && l.pagamento <= ate && l.statusRescisao === "Por fazer").length;
  }, [linhas, hoje]);

  const filtrosExtras = [filtro.homologacao, filtro.tipo, filtro.origem, filtro.sst, filtro.soNaoProgramadas, filtro.soSemRetorno].filter(Boolean).length;
  const algumFiltro = filtrosExtras > 0 || !!filtro.busca || !!filtro.empresa || !!filtro.mes || !!filtro.statusRescisao || !!filtro.soAtrasadas || fContratos.length > 0;

  // ── Ações ────────────────────────────────────────────────────────
  const [ficha, setFicha] = useState<AbrirFicha>(null);
  const [importando, setImportando] = useState(false);

  const moverCard = async (l: LinhaRescisao, para: string) => {
    const de = l.statusRescisao ?? "Por fazer";
    try {
      await mover(l, patchDoMovimento(l, para));
      toast.success(`${l.nome}: ${para}`, {
        action: { label: "Desfazer", onClick: () => { mover({ ...l, statusRescisao: para }, { status_rescisao: de }).catch((e) => toast.error((e as Error).message)); } },
      });
    } catch (e) {
      toast.error("Não consegui mover: " + (e as Error).message);
    }
  };

  const salvarFicha = async (l: LinhaRescisao | null, e: EdicaoRescisao, ident: IdentificacaoRescisao | null): Promise<boolean> => {
    try {
      const idLimpa = ident ? Object.fromEntries(Object.entries(ident).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])) : {};
      if (!l) await criarManual({ ...e, ...idLimpa });
      else await salvar(l, { ...e, ...(l.solicitacao ? {} : idLimpa) });
      toast.success(l ? `Rescisão de ${l.nome} salva.` : "Rescisão lançada.");
      setFicha(null);
      return true;
    } catch (err) {
      toast.error("Erro ao salvar: " + (err as Error).message);
      return false;
    }
  };

  const excluirFicha = async (l: LinhaRescisao): Promise<boolean> => {
    if (!l.rescisao) return false;
    try {
      await excluir(l.rescisao);
      toast.success("Excluída.");
      setFicha(null);
      return true;
    } catch (err) {
      toast.error("Erro ao excluir: " + (err as Error).message);
      return false;
    }
  };

  const exportar = () => {
    XLSX.writeFile(planilhaDasRescisoes(filtradas), `rescisoes-${hoje}.xlsx`);
  };

  return (
    <div className="mx-auto max-w-[1800px]">
      <PageHeader
        title="Rescisões"
        subtitle="Controle das rescisões: arraste o card para mudar o status. Datas, homologação, programadas, malote e documentação na ficha."
        module="Rescisões"
        breadcrumb={["Gestão de Rescisões"]}
        actions={
          <div className="flex flex-wrap gap-2">
            {podeEditar && (
              <Button onClick={() => setFicha({ modo: "nova" })}><Plus className="mr-1.5 h-4 w-4" /> Nova rescisão</Button>
            )}
            {podeEditar && (
              <Button variant="outline" onClick={() => setImportando(true)}><Upload className="mr-1.5 h-4 w-4" /> Importar planilha</Button>
            )}
            <Button variant="outline" onClick={exportar} disabled={!filtradas.length}><Download className="mr-1.5 h-4 w-4" /> Excel</Button>
            <Button variant="outline" size="icon" onClick={carregar} disabled={carregando} title="Atualizar">
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi titulo="Por fazer" valor={resumo["Por fazer"] ?? 0} icone={CalendarClock} cor="bg-amber-100 text-amber-800"
          ativo={visao === "lista" && filtro.statusRescisao === "Por fazer"}
          onClick={() => { trocarVisao("lista"); muda({ statusRescisao: filtro.statusRescisao === "Por fazer" ? "" : "Por fazer" }); }} />
        <Kpi titulo="Pagamento vencido" valor={atrasadas} icone={AlertTriangle} cor="bg-red-600 text-white" ativo={!!filtro.soAtrasadas}
          dica="Pagamento até hoje com a rescisão ainda por fazer" onClick={() => muda({ soAtrasadas: !filtro.soAtrasadas })} />
        <Kpi titulo="Pagam. nos próx. 7 dias" valor={proximos7} icone={CalendarClock} cor="bg-orange-100 text-orange-700"
          dica="Por fazer com pagamento nos próximos 7 dias" />
        <Kpi titulo="Falta programar" valor={faltaProgramar} icone={SlidersHorizontal} cor="bg-slate-100 text-slate-700" ativo={!!filtro.soNaoProgramadas}
          dica="Por fazer sem rescisão e vales programados" onClick={() => muda({ soNaoProgramadas: !filtro.soNaoProgramadas })} />
        <Kpi titulo="Doc. sem retorno" valor={aguardandoRetorno} icone={FileClock} cor="bg-sky-100 text-sky-700" ativo={!!filtro.soSemRetorno}
          dica="Documentação enviada e ainda sem retorno" onClick={() => muda({ soSemRetorno: !filtro.soSemRetorno })} />
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <div className="flex rounded-lg border p-0.5">
            <Button size="sm" variant={visao === "kanban" ? "secondary" : "ghost"} className="h-8" onClick={() => trocarVisao("kanban")}>
              <KanbanSquare className="mr-1.5 h-4 w-4" /> Kanban
            </Button>
            <Button size="sm" variant={visao === "lista" ? "secondary" : "ghost"} className="h-8" onClick={() => trocarVisao("lista")}>
              <List className="mr-1.5 h-4 w-4" /> Planilha
            </Button>
          </div>
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Nome, matrícula, contrato, nº…" value={filtro.busca ?? ""} onChange={(e) => muda({ busca: e.target.value })} />
          </div>
          <FiltroContratos linhas={linhasContrato} campo="contrato" selecionados={fContratos} onChange={setFContratos} rotulo="Contratos" />
          <Select value={filtro.empresa || "todas"} onValueChange={(v) => muda({ empresa: v === "todas" ? "" : v })}>
            <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas empresas</SelectItem>
              {empresas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-md border">
            <Select value={filtro.campoMes ?? "pagamento"} onValueChange={(v) => muda({ campoMes: v as FiltroRescisao["campoMes"] })}>
              <SelectTrigger className="h-9 w-[120px] border-0 shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pagamento">Pagamento</SelectItem>
                <SelectItem value="demissao">Demissão</SelectItem>
                <SelectItem value="recebido">Recebido</SelectItem>
              </SelectContent>
            </Select>
            <Input type="month" className="h-9 w-[150px] border-0 shadow-none" value={filtro.mes ?? ""} onChange={(e) => muda({ mes: e.target.value })} />
          </div>
          {visao === "lista" && (
            <Select value={filtro.statusRescisao || "todos"} onValueChange={(v) => muda({ statusRescisao: v === "todos" ? "" : v })}>
              <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {STATUS_RESCISAO.map((s) => <SelectItem key={s} value={s}>{s} ({resumo[s] ?? 0})</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Mais filtros{filtrosExtras ? ` (${filtrosExtras})` : ""}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-3">
              <div>
                <Label className="text-xs">Homologação</Label>
                <Select value={filtro.homologacao || "todas"} onValueChange={(v) => muda({ homologacao: v === "todas" ? "" : v })}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {HOMOLOGACOES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tipo de desligamento</Label>
                <Select value={filtro.tipo || "todos"} onValueChange={(v) => muda({ tipo: v === "todos" ? "" : v })}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {TIPOS_DESLIGAMENTO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Planilha SST</Label>
                  <Select value={filtro.sst || "todos"} onValueChange={(v) => muda({ sst: v === "todos" ? "" : (v as "ok" | "pendente") })}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="ok">OK</SelectItem>
                      <SelectItem value="pendente">Não / vazio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Origem</Label>
                  <Select value={filtro.origem || "todas"} onValueChange={(v) => muda({ origem: v === "todas" ? "" : (v as FiltroRescisao["origem"]) })}>
                    <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      <SelectItem value="erp">Do ERP</SelectItem>
                      <SelectItem value="planilha">Da planilha</SelectItem>
                      <SelectItem value="manual">Lançadas aqui</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!filtro.soNaoProgramadas} onCheckedChange={(v) => muda({ soNaoProgramadas: !!v })} /> Falta programar
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!filtro.soSemRetorno} onCheckedChange={(v) => muda({ soSemRetorno: !!v })} /> Documentação sem retorno
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!filtro.soAtrasadas} onCheckedChange={(v) => muda({ soAtrasadas: !!v })} /> Pagamento vencido
              </label>
            </PopoverContent>
          </Popover>
          {visao === "lista" && (
            <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemRescisao)}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pagamento">Ordem: pagamento</SelectItem>
                <SelectItem value="demissao">Ordem: demissão</SelectItem>
                <SelectItem value="recebido">Ordem: recebido</SelectItem>
                <SelectItem value="nome">Ordem: nome</SelectItem>
              </SelectContent>
            </Select>
          )}
          {algumFiltro && (
            <Button variant="ghost" size="sm" className="h-9" onClick={limpar}><X className="mr-1 h-4 w-4" /> Limpar</Button>
          )}
          <span className="ml-auto text-sm text-muted-foreground"><b className="text-foreground">{filtradas.length}</b> de {linhas.length}</span>
        </CardContent>
      </Card>

      {erro ? (
        <Card><CardContent className="py-10 text-center text-sm text-destructive">Erro ao carregar: {erro}</CardContent></Card>
      ) : carregando && !linhas.length ? (
        <p className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</p>
      ) : visao === "kanban" ? (
        <KanbanRescisoes linhas={filtradas} hoje={hoje} podeMover={podeEditar}
          onAbrir={(l) => setFicha({ modo: "editar", linha: l })} onMover={moverCard} />
      ) : filtradas.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {linhas.length === 0 ? "Nenhuma rescisão ainda — importe a planilha ou lance uma nova." : "Nada bate com o filtro atual."}
        </CardContent></Card>
      ) : (
        <Card><CardContent className="pt-4">
          <ListaRescisoes linhas={filtradas} hoje={hoje} onAbrir={(l) => setFicha({ modo: "editar", linha: l })} />
        </CardContent></Card>
      )}

      <FichaRescisao abrir={ficha} podeEditar={podeEditar} podeExcluir={!!podeExcluir}
        onFechar={() => setFicha(null)} onSalvar={salvarFicha} onExcluir={excluirFicha} />

      <ImportarPlanilha aberto={importando} onFechar={() => setImportando(false)}
        solicitacoes={dados.solicitacoes} rescisoes={dados.rescisoes} empregados={dados.empregados} quemSou={dados.quemSou}
        onImportado={() => { setImportando(false); carregar(); }} />
    </div>
  );
}
