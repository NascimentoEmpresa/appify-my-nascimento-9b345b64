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
import { PlanilhaRescisoes } from "@/components/rescisoes/PlanilhaRescisoes";
import { FichaRescisao, type AbrirFicha } from "@/components/rescisoes/FichaRescisao";
import { ImportarPlanilha } from "@/components/rescisoes/ImportarPlanilha";
import { useRescisoes } from "@/hooks/useRescisoes";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  HOMOLOGACOES, STATUS_RESCISAO, TIPOS_DESLIGAMENTO,
  corStatusRescisao, demissaoCancelada, filtrarRescisoes, hojeIso, ordenarRescisoes, pagamentoAtrasado,
  planilhaDasRescisoes, rescisaoConcluida, resumoPorStatus, semRetorno,
  type EdicaoRescisao, type FiltroRescisao, type IdentificacaoRescisao, type LinhaRescisao, type OrdemRescisao, type RescisaoRH,
} from "@/lib/demissao/rescisao";
import {
  AlertTriangle, Ban, CalendarClock, Download, FileClock, Loader2, Plus, RefreshCw, Search, SlidersHorizontal, Upload, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * RECURSOS HUMANOS › RESCISÕES (22/10/2026, mig 20261022000400).
 *
 * "Tem que parecer a planilha só que melhor e integrado ao sistema de
 * demissões … e não pode ter um módulo só pra rescisões, tem que ficar dentro
 * de recursos humanos." Substitui o módulo próprio com kanban de 21/10:
 *   · a tela É a planilha (PlanilhaRescisoes), as mesmas colunas, editável
 *     na célula;
 *   · os 10 status da lista suspensa do Excel; as abas separam o que está em
 *     aberto das concluídas (Rescisão OK / Rescisão e documentos OK) e o
 *     RESUMO da planilha virou a faixa de status clicável;
 *   · a demissão chega sozinha: o encarregado solicita → aprovação → o RH
 *     libera em Solicitações de Demissão → a linha nasce aqui ("Rescisão por
 *     fazer"), com as datas e o tipo já preenchidos.
 * A rota (/app/rh/rescisoes) e o menu (rescisoes_gestao) são os mesmos — só
 * mudaram de módulo, então ninguém perdeu acesso.
 */

const FILTRO_INICIAL: FiltroRescisao = { situacao: "abertas", campoMes: "pagamento" };
type Aba = NonNullable<FiltroRescisao["situacao"]>;

function Alerta({ titulo, valor, icone: Icone, cor, ativo, onClick, dica }: {
  titulo: string; valor: number; icone: LucideIcon; cor: string; ativo?: boolean; onClick?: () => void; dica?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={dica}
      className={cn("flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:border-primary/40",
        ativo && "border-primary ring-2 ring-primary/30", valor === 0 && "opacity-60")}>
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
  const { linhas, carregando, erro, carregar, salvar, atualizar, criarManual, excluir } = dados;
  const hoje = hojeIso();

  // Lançar/editar: "alterar" OU "aprovar" — a mesma régua da RLS. Apagar: "excluir".
  const { data: podeAlterar } = useScreenAccess("rescisoes_gestao", "alterar");
  const { data: podeAprovar } = useScreenAccess("rescisoes_gestao", "aprovar");
  const { data: podeExcluir } = useScreenAccess("rescisoes_gestao", "excluir");
  const podeEditar = !!podeAlterar || !!podeAprovar;

  // ── Filtros ──────────────────────────────────────────────────────
  const [filtro, setFiltro] = useState<FiltroRescisao>(FILTRO_INICIAL);
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [ordem, setOrdem] = useState<OrdemRescisao>("pagamento");
  const muda = (p: Partial<FiltroRescisao>) => setFiltro((f) => ({ ...f, ...p }));
  const limpar = () => { setFiltro((f) => ({ ...FILTRO_INICIAL, situacao: f.situacao })); setFContratos([]); };
  const trocarAba = (a: Aba) => setFiltro((f) => ({ ...f, situacao: a, statusRescisao: "" }));

  const empresas = useMemo(() => [...new Set(linhas.map((l) => l.empresa).filter(Boolean) as string[])].sort(), [linhas]);
  const linhasContrato = useMemo(() => linhas.map((l) => ({ contrato: l.contrato })), [linhas]);

  const filtradas = useMemo(() => ordenarRescisoes(
    filtrarRescisoes(linhas, filtro, hoje).filter((l) => passaNoFiltroContratos({ contrato: l.contrato }, "contrato", fContratos)),
    ordem,
  ), [linhas, filtro, fContratos, ordem, hoje]);

  const resumo = useMemo(() => resumoPorStatus(linhas), [linhas]);
  const nAbertas = useMemo(() => linhas.filter((l) => !rescisaoConcluida(l.statusRescisao)).length, [linhas]);
  const atrasadas = useMemo(() => linhas.filter((l) => pagamentoAtrasado(l, hoje)).length, [linhas, hoje]);
  const aguardandoRetorno = useMemo(() => linhas.filter(semRetorno).length, [linhas]);
  const canceladas = useMemo(() => linhas.filter((l) => demissaoCancelada(l) && !rescisaoConcluida(l.statusRescisao)).length, [linhas]);
  const [soCanceladas, setSoCanceladas] = useState(false);
  const proximos7 = useMemo(() => {
    const limite = new Date(); limite.setDate(limite.getDate() + 7);
    const ate = hojeIso(limite);
    return linhas.filter((l) => l.pagamento && l.pagamento > hoje && l.pagamento <= ate && !rescisaoConcluida(l.statusRescisao)).length;
  }, [linhas, hoje]);

  const visiveis = useMemo(
    () => (soCanceladas ? filtradas.filter((l) => demissaoCancelada(l) && !rescisaoConcluida(l.statusRescisao)) : filtradas),
    [filtradas, soCanceladas],
  );

  const filtrosExtras = [filtro.homologacao, filtro.tipo, filtro.origem, filtro.sst, filtro.soNaoProgramadas, filtro.soSemRetorno].filter(Boolean).length;
  const algumFiltro = filtrosExtras > 0 || !!filtro.busca || !!filtro.empresa || !!filtro.mes || !!filtro.statusRescisao
    || !!filtro.soAtrasadas || fContratos.length > 0 || soCanceladas;

  // ── Ações ────────────────────────────────────────────────────────
  const [ficha, setFicha] = useState<AbrirFicha>(null);
  const [importando, setImportando] = useState(false);

  const salvarCelula = async (l: LinhaRescisao, patch: Partial<RescisaoRH>) => {
    try {
      await atualizar(l, patch);
    } catch (e) {
      toast.error(`Não salvou (${l.nome}): ${(e as Error).message}`);
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
    XLSX.writeFile(planilhaDasRescisoes(visiveis), `rescisoes-${hoje}.xlsx`);
  };

  const abas: { id: Aba; rotulo: string; n: number }[] = [
    { id: "abertas", rotulo: "Em aberto", n: nAbertas },
    { id: "concluidas", rotulo: "Concluídas", n: linhas.length - nAbertas },
    { id: "", rotulo: "Todas", n: linhas.length },
  ];
  const statusDaAba = STATUS_RESCISAO.filter((s) => (filtro.situacao === "abertas" ? !rescisaoConcluida(s) : filtro.situacao === "concluidas" ? rescisaoConcluida(s) : true));

  return (
    <div className="mx-auto max-w-[1900px]">
      <PageHeader
        title="Rescisões"
        subtitle="A planilha de rescisão do RH. A demissão entra aqui sozinha quando o RH libera a solicitação."
        module="Recursos Humanos"
        breadcrumb={["Rescisões"]}
        actions={
          <div className="flex flex-wrap gap-2">
            {podeEditar && (
              <Button onClick={() => setFicha({ modo: "nova" })}><Plus className="mr-1.5 h-4 w-4" /> Nova rescisão</Button>
            )}
            {podeEditar && (
              <Button variant="outline" onClick={() => setImportando(true)}><Upload className="mr-1.5 h-4 w-4" /> Importar planilha</Button>
            )}
            <Button variant="outline" onClick={exportar} disabled={!visiveis.length}><Download className="mr-1.5 h-4 w-4" /> Excel</Button>
            <Button variant="outline" size="icon" onClick={carregar} disabled={carregando} title="Atualizar">
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        }
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Alerta titulo="Pagamento vencido" valor={atrasadas} icone={AlertTriangle} cor="bg-red-600 text-white" ativo={!!filtro.soAtrasadas}
          dica="Pagamento até hoje com a rescisão ainda por fazer" onClick={() => muda({ soAtrasadas: !filtro.soAtrasadas, situacao: "abertas" })} />
        <Alerta titulo="Pagamento nos próx. 7 dias" valor={proximos7} icone={CalendarClock} cor="bg-orange-100 text-orange-700"
          dica="Em aberto com pagamento nos próximos 7 dias" onClick={() => { setOrdem("pagamento"); trocarAba("abertas"); }} />
        <Alerta titulo="Documentação sem retorno" valor={aguardandoRetorno} icone={FileClock} cor="bg-sky-100 text-sky-700" ativo={!!filtro.soSemRetorno}
          dica="Documentação enviada e ainda sem retorno" onClick={() => muda({ soSemRetorno: !filtro.soSemRetorno })} />
        <Alerta titulo="Demissão cancelada no ERP" valor={canceladas} icone={Ban} cor="bg-rose-100 text-rose-700" ativo={soCanceladas}
          dica="A solicitação foi cancelada depois de entrar na planilha — conferir e excluir a linha" onClick={() => setSoCanceladas((v) => !v)} />
      </div>

      <Card className="mb-3">
        <CardContent className="space-y-3 py-3">
          {/* Abas + o RESUMO da planilha (contagem por status, clicável). */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border p-0.5">
              {abas.map((a) => (
                <Button key={a.id || "todas"} size="sm" variant={filtro.situacao === a.id ? "secondary" : "ghost"} className="h-8"
                  onClick={() => trocarAba(a.id)}>
                  {a.rotulo} <span className="ml-1.5 rounded bg-muted px-1.5 text-xs tabular-nums">{a.n}</span>
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusDaAba.map((s) => (
                <button key={s} type="button"
                  onClick={() => muda({ statusRescisao: filtro.statusRescisao === s ? "" : s })}
                  className={cn("rounded-md border px-2 py-1 text-[11px] font-bold uppercase transition", corStatusRescisao(s),
                    filtro.statusRescisao === s ? "ring-2 ring-primary ring-offset-1" : "opacity-90 hover:opacity-100",
                    (resumo[s] ?? 0) === 0 && filtro.statusRescisao !== s && "opacity-40")}>
                  {s} <span className="tabular-nums">{resumo[s] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
                  <Checkbox checked={!!filtro.soNaoProgramadas} onCheckedChange={(v) => muda({ soNaoProgramadas: !!v })} /> Falta programar (rescisão e vales)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!filtro.soSemRetorno} onCheckedChange={(v) => muda({ soSemRetorno: !!v })} /> Documentação sem retorno
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!filtro.soAtrasadas} onCheckedChange={(v) => muda({ soAtrasadas: !!v })} /> Pagamento vencido
                </label>
              </PopoverContent>
            </Popover>
            <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemRescisao)}>
              <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pagamento">Ordem: pagamento</SelectItem>
                <SelectItem value="demissao">Ordem: demissão</SelectItem>
                <SelectItem value="recebido">Ordem: recebido</SelectItem>
                <SelectItem value="nome">Ordem: nome</SelectItem>
              </SelectContent>
            </Select>
            {algumFiltro && (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { limpar(); setSoCanceladas(false); }}><X className="mr-1 h-4 w-4" /> Limpar</Button>
            )}
            <span className="ml-auto text-sm text-muted-foreground"><b className="text-foreground">{visiveis.length}</b> de {linhas.length}</span>
          </div>
        </CardContent>
      </Card>

      {erro ? (
        <Card><CardContent className="py-10 text-center text-sm text-destructive">Erro ao carregar: {erro}</CardContent></Card>
      ) : carregando && !linhas.length ? (
        <p className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando…</p>
      ) : visiveis.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {linhas.length === 0
            ? "Nenhuma rescisão ainda. Importe a planilha do RH, ou espere o RH liberar uma demissão: ela entra aqui sozinha."
            : "Nada bate com o filtro atual."}
        </CardContent></Card>
      ) : (
        <PlanilhaRescisoes linhas={visiveis} hoje={hoje} podeEditar={podeEditar}
          onAbrir={(l) => setFicha({ modo: "editar", linha: l })} onSalvar={salvarCelula} />
      )}

      <FichaRescisao abrir={ficha} podeEditar={podeEditar} podeExcluir={!!podeExcluir}
        onFechar={() => setFicha(null)} onSalvar={salvarFicha} onExcluir={excluirFicha} />

      <ImportarPlanilha aberto={importando} onFechar={() => setImportando(false)}
        solicitacoes={dados.solicitacoes} rescisoes={dados.rescisoes} empregados={dados.empregados} quemSou={dados.quemSou}
        onImportado={() => { setImportando(false); carregar(); }} />
    </div>
  );
}
