import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Box, Check, CheckCircle2, Clock, Database, Edit, FileArchive, FileText, History,
  Loader2, MessageSquarePlus, MoreHorizontal, Paperclip, PieChart, Search, Send, Settings, Tags,
  Trash2, Undo2, Wallet,
} from "lucide-react";
import {
  MENU_DOC_CANAA, MENU_DOC_CANAA_FINANCEIRO, MENU_DOC_CANAA_OPERACIONAL, MENU_DOC_CANAA_ORCAMENTO,
  ProtocoloDocCanaa, STATUS_BADGE_CLASSE_DOC_CANAA, STATUS_LABEL_DOC_CANAA, StatusDocCanaa, TRANSICOES_DOC_CANAA,
  abrirArquivoDocCanaa, competenciaAtual, formatarBRL, labelCompetencia, ultimoDiaUtil,
  useAdicionarObsDocCanaa, useAnexarComprovanteMaloteDocCanaa, useCompetenciasDocCanaa,
  useConcluirPagamentoDocCanaa, useExcluirProtocoloDocCanaa, useMudarStatusDocCanaa, usePlanosDocCanaa,
  useProtocolosDocCanaa,
} from "@/hooks/useDocCanaa";
import { LancarDocumento } from "./doc-canaa/LancarDocumento";
import {
  AlterarPlanoDialog, ComprovanteDialog, ConfigOrcamentoDialog, EditarProtocoloDialog, ExportarZipDialog,
  HistoricoDialog, TextoDialog,
} from "./doc-canaa/DocCanaaDialogs";

// DOC CANAA — Gestão de Documentos da Escola Canaã. Migrado do blueprint
// Flask legado `sistema_canaa` (/canaa) com as mesmas três telas: Lançar
// Documento, Gestão de Malote (fila Operacional → Financeiro) e Base de
// Dados. Os "setores" do legado (OPERACIONAL/FINANCEIRO/CONTROLADORIA) viram
// menus fantasma liberados por usuário — ver migration 20260930000257.

const STATUS_FILA_FINANCEIRO: StatusDocCanaa[] = ["enviado_malote", "enviado_financeiro", "pago"];
const STATUS_FORA_ORCAMENTO: StatusDocCanaa[] = ["devolvido_operacao", "devolvido_financeiro", "excluido"];

const erroMsg = (e: unknown) => (e as { message?: string })?.message ?? "Erro inesperado.";

type DialogTexto = { tipo: "devolver_base" | "devolver_operacao" | "obs" | "excluir" | "estornar"; ids: string[] } | null;
type DialogComprovante = { tipo: "malote" | "pagamento"; protocolo: ProtocoloDocCanaa } | null;

function StatusBadge({ status }: { status: StatusDocCanaa }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap border", STATUS_BADGE_CLASSE_DOC_CANAA[status])}>{STATUS_LABEL_DOC_CANAA[status]}</Badge>;
}

function LinkArquivo({ path, rotulo, variante = "outline" }: { path: string | null; rotulo: string; variante?: "outline" | "ghost" }) {
  if (!path) return <span className="text-muted-foreground">—</span>;
  return (
    <Button
      size="sm" variant={variante} className="h-7 gap-1 px-2 text-xs"
      onClick={(e) => { e.stopPropagation(); abrirArquivoDocCanaa(path).catch((err) => toast.error(erroMsg(err))); }}
    >
      <FileText className="h-3.5 w-3.5" />{rotulo}
    </Button>
  );
}

export default function DocCanaa() {
  const { data: podeIncluir } = useScreenAccess(MENU_DOC_CANAA, "incluir");
  const { data: podeAlterar } = useScreenAccess(MENU_DOC_CANAA, "alterar");
  const { data: podeExcluir } = useScreenAccess(MENU_DOC_CANAA, "excluir");
  const { data: podeOperacional } = useScreenAccess(MENU_DOC_CANAA_OPERACIONAL, "visualizar");
  const { data: podeFinanceiro } = useScreenAccess(MENU_DOC_CANAA_FINANCEIRO, "visualizar");
  const { data: podeEstornar } = useScreenAccess(MENU_DOC_CANAA_FINANCEIRO, "alterar");

  const [aba, setAba] = useState<string>("base");
  const [abaDefinida, setAbaDefinida] = useState(false);
  useEffect(() => {
    // Abre na aba mais útil pra quem entra: fila (Operacional/Financeiro) >
    // lançamento > base. Só na primeira resolução das permissões.
    if (abaDefinida || podeIncluir === undefined || podeOperacional === undefined || podeFinanceiro === undefined) return;
    setAba(podeOperacional || podeFinanceiro ? "gestao" : podeIncluir ? "lancar" : "base");
    setAbaDefinida(true);
  }, [abaDefinida, podeIncluir, podeOperacional, podeFinanceiro]);

  const [competencia, setCompetencia] = useState(competenciaAtual());
  const { data: competencias = [competenciaAtual()] } = useCompetenciasDocCanaa();
  const { data: protocolos = [], isLoading } = useProtocolosDocCanaa(competencia);
  const { data: planos = [] } = usePlanosDocCanaa();

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusDocCanaa | "todos">("todos");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  useEffect(() => { setSelecionados(new Set()); }, [competencia, aba]);

  const [dlgTexto, setDlgTexto] = useState<DialogTexto>(null);
  const [dlgComprovante, setDlgComprovante] = useState<DialogComprovante>(null);
  const [historicoDe, setHistoricoDe] = useState<ProtocoloDocCanaa | null>(null);
  const [editarDe, setEditarDe] = useState<ProtocoloDocCanaa | null>(null);
  const [planoDe, setPlanoDe] = useState<ProtocoloDocCanaa | null>(null);
  const [zipAberto, setZipAberto] = useState(false);
  const [configAberto, setConfigAberto] = useState(false);

  const mudarStatus = useMudarStatusDocCanaa();
  const anexarMalote = useAnexarComprovanteMaloteDocCanaa();
  const concluirPagamento = useConcluirPagamentoDocCanaa();
  const adicionarObs = useAdicionarObsDocCanaa();
  const excluir = useExcluirProtocoloDocCanaa();

  // ── Filtros ───────────────────────────────────────────────────────────
  const casaBusca = (p: ProtocoloDocCanaa) => {
    if (!busca.trim()) return true;
    const q = busca.trim().toLowerCase();
    return [p.favorecido, p.despesa, p.documento, p.plano?.nome, p.observacao, String(p.numero)]
      .some((c) => c?.toLowerCase().includes(q));
  };
  const casaStatus = (p: ProtocoloDocCanaa) => filtroStatus === "todos" || p.status === filtroStatus;

  // Financeiro "puro" só enxerga a fila a partir do malote (igual ao legado).
  const fila = useMemo(
    () => protocolos.filter((p) =>
      (podeOperacional || STATUS_FILA_FINANCEIRO.includes(p.status)) && casaBusca(p) && casaStatus(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [protocolos, podeOperacional, busca, filtroStatus],
  );
  const base = useMemo(
    () => protocolos.filter((p) => casaBusca(p) && casaStatus(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [protocolos, busca, filtroStatus],
  );

  // ── KPIs e orçamento ──────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const k = { total: 0, valor: 0, aguardando: 0, malote: 0, financeiro: 0, pago: 0, devolvido: 0, acima: 0 };
    for (const p of protocolos) {
      k.total++;
      k.valor += p.valor;
      if (p.status === "aguardando_operacional" || p.status === "conferido") k.aguardando++;
      if (p.status === "enviado_malote") k.malote++;
      if (p.status === "enviado_financeiro") k.financeiro++;
      if (p.status === "pago") k.pago++;
      if (p.status === "devolvido_operacao" || p.status === "devolvido_financeiro") k.devolvido++;
      if (p.acima_orcamento) k.acima++;
    }
    return k;
  }, [protocolos]);

  const orcamento = useMemo(() => {
    const usado: Record<string, number> = {};
    for (const p of protocolos) {
      if (STATUS_FORA_ORCAMENTO.includes(p.status)) continue;
      usado[p.plano_id] = (usado[p.plano_id] ?? 0) + p.valor;
    }
    return planos
      .filter((pl) => pl.limite_mensal !== null && (pl.ativo || usado[pl.id]))
      .map((pl) => ({ ...pl, usado: usado[pl.id] ?? 0, pct: pl.limite_mensal ? ((usado[pl.id] ?? 0) / pl.limite_mensal) * 100 : 0 }));
  }, [planos, protocolos]);

  const hoje = new Date();
  const prazo = ultimoDiaUtil(hoje.getFullYear(), hoje.getMonth());

  // ── Seleção ────────────────────────────────────────────────────────────
  const selecionadosLista = protocolos.filter((p) => selecionados.has(p.id));
  const unico = selecionadosLista.length === 1 ? selecionadosLista[0] : null;
  const toggle = (id: string) => setSelecionados((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleTodos = (lista: ProtocoloDocCanaa[]) => setSelecionados((s) =>
    lista.every((p) => s.has(p.id)) ? new Set() : new Set(lista.map((p) => p.id)));

  const podeTransicionar = (para: StatusDocCanaa) =>
    selecionadosLista.length > 0 && selecionadosLista.every((p) => TRANSICOES_DOC_CANAA[p.status].includes(para));

  const aplicarStatus = async (ids: string[], status: StatusDocCanaa, obs?: string) => {
    try {
      const n = await mudarStatus.mutateAsync({ ids, status, obs });
      toast.success(`${n} documento(s) → ${STATUS_LABEL_DOC_CANAA[status]}.`);
      setSelecionados(new Set());
    } catch (e) { toast.error(erroMsg(e)); }
  };

  const enviarAoFinanceiro = () => {
    const semComp = selecionadosLista.filter((p) => p.valor > 0 && !p.comprovante_malote_path);
    if (semComp.length) {
      toast.error(`Sem comprovante de malote: #${semComp.map((p) => p.numero).join(", #")}.`);
      return;
    }
    aplicarStatus(selecionadosLista.map((p) => p.id), "enviado_financeiro");
  };

  const podeEditar = (p: ProtocoloDocCanaa) =>
    !["pago", "excluido"].includes(p.status) &&
    (!!podeAlterar || (!!podeIncluir && ["aguardando_operacional", "devolvido_operacao"].includes(p.status)));

  // ── Textos dos diálogos ────────────────────────────────────────────────
  const cfgTexto = dlgTexto && {
    devolver_base: { titulo: "Devolver para a Base", rotulo: "Motivo da devolução", confirmar: "Devolver", obrigatorio: true },
    devolver_operacao: { titulo: "Devolver para a Operação", rotulo: "Motivo da devolução", confirmar: "Devolver", obrigatorio: true },
    obs: { titulo: "Adicionar Observação", rotulo: "Observação", confirmar: "Salvar", obrigatorio: true },
    excluir: { titulo: "Excluir Documento", rotulo: "Motivo (opcional)", confirmar: "Excluir", obrigatorio: false },
    estornar: { titulo: "Estornar Pagamento", rotulo: "Motivo do estorno", confirmar: "Estornar", obrigatorio: true },
  }[dlgTexto.tipo];

  const confirmarTexto = async (texto: string) => {
    if (!dlgTexto) return;
    const { tipo, ids } = dlgTexto;
    if (tipo === "devolver_base") await aplicarStatus(ids, "devolvido_operacao", texto);
    else if (tipo === "devolver_operacao") await aplicarStatus(ids, "devolvido_financeiro", texto);
    else if (tipo === "estornar") await aplicarStatus(ids, "enviado_financeiro", texto);
    else if (tipo === "obs") {
      await adicionarObs.mutateAsync({ id: ids[0], obs: texto });
      toast.success("Observação adicionada.");
    } else if (tipo === "excluir") {
      await excluir.mutateAsync({ id: ids[0], motivo: texto });
      toast.success("Documento excluído.");
      setSelecionados(new Set());
    }
  };

  // ── Blocos de UI reaproveitados ────────────────────────────────────────
  const seletorCompetencia = (
    <Select value={competencia} onValueChange={setCompetencia}>
      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
      <SelectContent>
        {competencias.map((c) => <SelectItem key={c} value={c}>{labelCompetencia(c)}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const filtros = (
    <div className="flex flex-wrap items-center gap-2">
      {seletorCompetencia}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="w-56 pl-8" placeholder="Pesquisar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as StatusDocCanaa | "todos")}>
        <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos os status</SelectItem>
          {(Object.keys(STATUS_LABEL_DOC_CANAA) as StatusDocCanaa[]).filter((s) => s !== "excluido").map((s) => (
            <SelectItem key={s} value={s}>{STATUS_LABEL_DOC_CANAA[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const menuLinha = (p: ProtocoloDocCanaa) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button size="icon" variant="ghost" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => abrirArquivoDocCanaa(p.doc_path).catch((e) => toast.error(erroMsg(e)))}>
          <FileText className="mr-2 h-4 w-4" /> Ver documento
        </DropdownMenuItem>
        {p.comprovante_malote_path && (
          <DropdownMenuItem onClick={() => abrirArquivoDocCanaa(p.comprovante_malote_path!).catch((e) => toast.error(erroMsg(e)))}>
            <Paperclip className="mr-2 h-4 w-4" /> Comprovante de malote
          </DropdownMenuItem>
        )}
        {p.comprovante_pagamento_path && (
          <DropdownMenuItem onClick={() => abrirArquivoDocCanaa(p.comprovante_pagamento_path!).catch((e) => toast.error(erroMsg(e)))}>
            <Wallet className="mr-2 h-4 w-4" /> Comprovante de pagamento
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setHistoricoDe(p)}>
          <History className="mr-2 h-4 w-4" /> Histórico
        </DropdownMenuItem>
        {podeEditar(p) && (
          <DropdownMenuItem onClick={() => setEditarDe(p)}>
            <Edit className="mr-2 h-4 w-4" /> Editar
          </DropdownMenuItem>
        )}
        {p.status === "devolvido_operacao" && podeIncluir && (
          <DropdownMenuItem onClick={() => aplicarStatus([p.id], "aguardando_operacional", "Reenviado após correção")}>
            <Send className="mr-2 h-4 w-4" /> Reenviar ao Operacional
          </DropdownMenuItem>
        )}
        {podeExcluir && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => setDlgTexto({ tipo: "excluir", ids: [p.id] })}>
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const obsCelula = (p: ProtocoloDocCanaa) => (
    <div className="max-w-56 space-y-0.5">
      {p.acima_orcamento && (
        <div className="flex items-center gap-1 text-xs font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> Acima do orçamento (saldo {formatarBRL(p.saldo_orcamento)})
        </div>
      )}
      <div className="truncate text-xs text-muted-foreground" title={p.observacao ?? ""}>{p.observacao || (p.acima_orcamento ? "" : "—")}</div>
    </div>
  );

  const linhaVazia = (colunas: number, texto: string) => (
    <TableRow><TableCell colSpan={colunas} className="py-10 text-center text-muted-foreground">
      {isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : texto}
    </TableCell></TableRow>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        module="Financeiro"
        title="DOC CANAA"
        subtitle="Gestão de documentos da Escola Canaã — lançamento, conferência, malote e pagamento."
        breadcrumb={["Ferramentas", "DOC CANAA"]}
        actions={
          <div className="flex gap-2">
            <AcessoGate menu={MENU_DOC_CANAA_ORCAMENTO} acao="visualizar">
              <Button variant="outline" className="gap-1.5" onClick={() => setConfigAberto(true)}>
                <Settings className="h-4 w-4" /> Orçamento
              </Button>
            </AcessoGate>
            <AcessoGate menu={MENU_DOC_CANAA} acao="exportar">
              <Button variant="outline" className="gap-1.5" onClick={() => setZipAberto(true)}>
                <FileArchive className="h-4 w-4" /> Exportar ZIP
              </Button>
            </AcessoGate>
          </div>
        }
      />

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          {podeIncluir && <TabsTrigger value="lancar" className="gap-1.5"><FileText className="h-4 w-4" /> Lançar Documento</TabsTrigger>}
          {(podeOperacional || podeFinanceiro) && <TabsTrigger value="gestao" className="gap-1.5"><Box className="h-4 w-4" /> Gestão de Malote</TabsTrigger>}
          <TabsTrigger value="base" className="gap-1.5"><Database className="h-4 w-4" /> Base de Dados</TabsTrigger>
        </TabsList>

        {/* ══ LANÇAR DOCUMENTO ══ */}
        {podeIncluir && (
          <TabsContent value="lancar" className="mt-4">
            <LancarDocumento />
          </TabsContent>
        )}

        {/* ══ GESTÃO DE MALOTE ══ */}
        {(podeOperacional || podeFinanceiro) && (
          <TabsContent value="gestao" className="mt-4 space-y-4">
            {podeOperacional && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
                <Clock className="h-4 w-4 text-primary" />
                <span><b>Prazo Operacional:</b> envio limite até <b>{prazo.toLocaleDateString("pt-BR")}</b></span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <KpiTile label="Documentos" valor={String(kpis.total)} sub={formatarBRL(kpis.valor)} icon={<FileText />} cor="slate" onClick={() => setFiltroStatus("todos")} />
              <KpiTile label="Com Operacional" valor={String(kpis.aguardando)} icon={<Clock />} cor="amber" onClick={() => setFiltroStatus("aguardando_operacional")} />
              <KpiTile label="No Malote" valor={String(kpis.malote)} icon={<Box />} cor="sky" onClick={() => setFiltroStatus("enviado_malote")} />
              <KpiTile label="No Financeiro" valor={String(kpis.financeiro)} icon={<Send />} cor="sky" onClick={() => setFiltroStatus("enviado_financeiro")} />
              <KpiTile label="Pagos" valor={String(kpis.pago)} icon={<CheckCircle2 />} cor="emerald" onClick={() => setFiltroStatus("pago")} />
              <KpiTile
                label="Devolvidos" valor={String(kpis.devolvido)} icon={<Undo2 />} cor="red"
                valorClass={kpis.devolvido > 0 ? "text-destructive" : undefined}
                sub={kpis.acima ? `${kpis.acima} acima do orçamento` : undefined}
              />
            </div>

            {orcamento.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <PieChart className="h-4 w-4 text-primary" /> Consumo do Orçamento — {labelCompetencia(competencia)}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {orcamento.map((o) => (
                      <div key={o.id} className="rounded-lg border p-3">
                        <div className="mb-1.5 flex justify-between text-xs">
                          <span className="truncate font-semibold" title={o.nome}>{o.nome}</span>
                          <span className={cn("text-muted-foreground", o.pct > 100 && "font-semibold text-destructive")}>{Math.round(o.pct)}%</span>
                        </div>
                        <Progress
                          value={Math.min(o.pct, 100)}
                          className={cn("h-1.5",
                            o.pct > 90 ? "[&>div]:bg-red-500" : o.pct > 70 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500")}
                        />
                        <div className="mt-1.5 text-right text-xs">
                          <span className="font-medium">{formatarBRL(o.usado)}</span>
                          <span className="text-muted-foreground"> / {formatarBRL(o.limite_mensal)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="sticky bottom-4 z-10 shadow-lg">
              <CardContent className="space-y-3 p-3">
                {podeOperacional && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operacional</span>
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={!podeTransicionar("conferido") || mudarStatus.isPending}
                      onClick={() => aplicarStatus(selecionadosLista.map((p) => p.id), "conferido")}>
                      <Check className="h-4 w-4" /> Conferido
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-destructive" disabled={!podeTransicionar("devolvido_operacao")}
                      onClick={() => setDlgTexto({ tipo: "devolver_base", ids: selecionadosLista.map((p) => p.id) })}>
                      <Undo2 className="h-4 w-4" /> Devolver p/ Base
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={!podeTransicionar("enviado_malote") || mudarStatus.isPending}
                      onClick={() => aplicarStatus(selecionadosLista.map((p) => p.id), "enviado_malote")}>
                      <Box className="h-4 w-4" /> Enviar ao Malote
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={!unico || ["pago", "excluido"].includes(unico.status)}
                      onClick={() => unico && setDlgComprovante({ tipo: "malote", protocolo: unico })}>
                      <Paperclip className="h-4 w-4" /> Anexar Comp. Malote
                    </Button>
                    <Button size="sm" className="gap-1.5" disabled={!podeTransicionar("enviado_financeiro") || mudarStatus.isPending}
                      onClick={enviarAoFinanceiro}>
                      <Send className="h-4 w-4" /> Enviar ao Financeiro
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-1.5" disabled={!unico || ["pago", "excluido"].includes(unico.status)}
                      onClick={() => unico && setPlanoDe(unico)}>
                      <Tags className="h-4 w-4" /> Alterar Plano
                    </Button>
                  </div>
                )}
                {podeFinanceiro && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Financeiro</span>
                    <Button size="sm" className="gap-1.5" disabled={!unico || unico.status !== "enviado_financeiro"}
                      onClick={() => unico && setDlgComprovante({ tipo: "pagamento", protocolo: unico })}>
                      <Wallet className="h-4 w-4" /> Concluir Pagamento
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-destructive" disabled={!podeTransicionar("devolvido_financeiro")}
                      onClick={() => setDlgTexto({ tipo: "devolver_operacao", ids: selecionadosLista.map((p) => p.id) })}>
                      <Undo2 className="h-4 w-4" /> Devolver p/ Operação
                    </Button>
                    {podeEstornar && (
                      <Button size="sm" variant="ghost" className="gap-1.5" disabled={!selecionadosLista.length || !selecionadosLista.every((p) => p.status === "pago")}
                        onClick={() => setDlgTexto({ tipo: "estornar", ids: selecionadosLista.map((p) => p.id) })}>
                        <Undo2 className="h-4 w-4" /> Estornar Pagamento
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={!unico} onClick={() => unico && setDlgTexto({ tipo: "obs", ids: [unico.id] })}>
                      <MessageSquarePlus className="h-4 w-4" /> Add Obs
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={!unico} onClick={() => unico && setHistoricoDe(unico)}>
                      <History className="h-4 w-4" /> Histórico
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {selecionadosLista.length ? `${selecionadosLista.length} selecionado(s) · ${formatarBRL(selecionadosLista.reduce((s, p) => s + p.valor, 0))}` : "Selecione documentos na tabela"}
                    </span>
                  </div>
                  {filtros}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox checked={fila.length > 0 && fila.every((p) => selecionados.has(p.id))} onCheckedChange={() => toggleTodos(fila)} />
                        </TableHead>
                        <TableHead>#</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Favorecido</TableHead>
                        <TableHead>Despesa</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Doc</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Comprovantes</TableHead>
                        <TableHead>Observações</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fila.map((p) => (
                        <TableRow key={p.id} className={cn("cursor-pointer", selecionados.has(p.id) && "bg-primary/5")} onClick={() => toggle(p.id)}>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox checked={selecionados.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{p.numero}</TableCell>
                          <TableCell className="whitespace-nowrap">{new Date(p.data_competencia + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell className="font-medium">{p.favorecido}</TableCell>
                          <TableCell>{p.despesa}</TableCell>
                          <TableCell className="text-xs">{p.plano?.nome ?? "—"}</TableCell>
                          <TableCell><LinkArquivo path={p.doc_path} rotulo={p.documento} /></TableCell>
                          <TableCell className="whitespace-nowrap text-right font-medium">{formatarBRL(p.valor)}</TableCell>
                          <TableCell><StatusBadge status={p.status} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {p.comprovante_malote_path && <LinkArquivo path={p.comprovante_malote_path} rotulo="Malote" variante="ghost" />}
                              {p.comprovante_pagamento_path && <LinkArquivo path={p.comprovante_pagamento_path} rotulo="Pgto" variante="ghost" />}
                              {!p.comprovante_malote_path && !p.comprovante_pagamento_path && <span className="text-muted-foreground">—</span>}
                            </div>
                          </TableCell>
                          <TableCell>{obsCelula(p)}</TableCell>
                          <TableCell>{menuLinha(p)}</TableCell>
                        </TableRow>
                      ))}
                      {fila.length === 0 && linhaVazia(12, `Nenhum documento pendente para ${labelCompetencia(competencia)}.`)}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ══ BASE DE DADOS ══ */}
        <TabsContent value="base" className="mt-4 space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Database className="h-4 w-4 text-primary" /> {base.length} documento(s) · {formatarBRL(base.reduce((s, p) => s + p.valor, 0))}
              </div>
              {filtros}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Competência</TableHead>
                      <TableHead>Favorecido</TableHead>
                      <TableHead>Despesa</TableHead>
                      <TableHead>Plano</TableHead>
                      <TableHead>Doc</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Observações</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {base.map((p) => (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => setHistoricoDe(p)}>
                        <TableCell className="text-xs text-muted-foreground">{p.numero}</TableCell>
                        <TableCell className="whitespace-nowrap">{new Date(p.data_competencia + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                        <TableCell className="font-medium">{p.favorecido}</TableCell>
                        <TableCell>{p.despesa}</TableCell>
                        <TableCell className="text-xs">{p.plano?.nome ?? "—"}</TableCell>
                        <TableCell><LinkArquivo path={p.doc_path} rotulo={p.documento} /></TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium">{formatarBRL(p.valor)}</TableCell>
                        <TableCell><StatusBadge status={p.status} /></TableCell>
                        <TableCell>{obsCelula(p)}</TableCell>
                        <TableCell>{menuLinha(p)}</TableCell>
                      </TableRow>
                    ))}
                    {base.length === 0 && linhaVazia(10, `Base vazia para ${labelCompetencia(competencia)}.`)}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ══ DIÁLOGOS ══ */}
      {cfgTexto && (
        <TextoDialog
          open={!!dlgTexto}
          titulo={cfgTexto.titulo}
          descricao={dlgTexto!.ids.length > 1 ? `${dlgTexto!.ids.length} documentos selecionados` : undefined}
          rotulo={cfgTexto.rotulo}
          confirmar={cfgTexto.confirmar}
          obrigatorio={cfgTexto.obrigatorio}
          onOpenChange={(o) => !o && setDlgTexto(null)}
          onConfirmar={confirmarTexto}
        />
      )}
      <ComprovanteDialog
        open={!!dlgComprovante}
        titulo={dlgComprovante?.tipo === "pagamento" ? "Concluir Pagamento" : "Anexar Comprovante de Malote"}
        protocolo={dlgComprovante?.protocolo ?? null}
        comObs={dlgComprovante?.tipo === "pagamento"}
        onOpenChange={(o) => !o && setDlgComprovante(null)}
        onEnviar={async (arquivo, obs) => {
          if (!dlgComprovante) return;
          if (dlgComprovante.tipo === "malote") {
            await anexarMalote.mutateAsync({ id: dlgComprovante.protocolo.id, arquivo });
            toast.success("Comprovante de malote anexado.");
          } else {
            await concluirPagamento.mutateAsync({ id: dlgComprovante.protocolo.id, arquivo, obs });
            toast.success("Pagamento concluído.");
            setSelecionados(new Set());
          }
        }}
      />
      <HistoricoDialog protocolo={historicoDe} onOpenChange={(o) => !o && setHistoricoDe(null)} />
      <EditarProtocoloDialog protocolo={editarDe} onOpenChange={(o) => !o && setEditarDe(null)} />
      <AlterarPlanoDialog protocolo={planoDe} onOpenChange={(o) => !o && setPlanoDe(null)} />
      <ExportarZipDialog open={zipAberto} competencias={competencias} competenciaInicial={competencia} onOpenChange={setZipAberto} />
      <ConfigOrcamentoDialog open={configAberto} onOpenChange={setConfigAberto} />
    </div>
  );
}
