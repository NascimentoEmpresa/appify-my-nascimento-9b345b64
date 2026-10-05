import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, CalendarClock, AlertTriangle, TimerOff, X, Plus, ArrowLeftRight, FileInput, Pencil, Trash2, History, MoreHorizontal, BellRing, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { urlLogoCartao } from "@/hooks/useMaloteCartaoCredito";
import { DebitoAutomaticoLinha, TipoOrigemDebito, useDebitoAutomaticoLista, useExcluirDebito } from "@/hooks/useDebitoAutomatico";
import { DebitoAutomaticoModal } from "./debito-automatico/DebitoAutomaticoModal";
import { HistoricoDebitoDialog } from "./debito-automatico/HistoricoDebitoDialog";
import { AVencerTab, vencimentoDe } from "./debito-automatico/AVencerTab";
import { AnexosDebito } from "./debito-automatico/AnexosDebito";
import { DIAS_AVISO_VENCIMENTO, diasParaVencer } from "./debito-automatico/parcelas";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const MENU_CODIGO = "financeiro-debito-automatico";

const TIPO_ORIGEM_LABEL: Record<TipoOrigemDebito, string> = {
  debito_automatico: "Débito Automático",
  movimentacao_financeira: "Movimentação Financeira",
  nota_recebida: "Nota Recebida",
};

// Data local (sv-SE = yyyy-mm-dd) — toISOString() é UTC e virava o dia às 21h.
const hoje = () => new Date().toLocaleDateString("sv-SE");

// SIS-2026-0256: novo submódulo abaixo de Fluxo de Caixa — lança direto no
// Fluxo de Caixa itens que NÃO passam pelo Malote (aluguel, transferência
// entre empresas do grupo, nota recebida). Recorrência é manual (decisão do
// Iury): cada competência é um lançamento novo, sem geração automática.
export default function DebitoAutomatico() {
  const { data: linhas = [], isLoading } = useDebitoAutomaticoLista();
  const { data: empresas = [] } = useEmpresasGrupo();
  const excluir = useExcluirDebito();

  const [modalTipo, setModalTipo] = useState<TipoOrigemDebito | null>(null);
  const [registroEditar, setRegistroEditar] = useState<DebitoAutomaticoLinha | null>(null);
  // Movimentação Financeira: a linha-par (saída/entrada) do registro em
  // edição, pra o modal aplicar os campos comuns nas 2 juntas.
  const [parEditar, setParEditar] = useState<DebitoAutomaticoLinha | null>(null);
  const [registroHistorico, setRegistroHistorico] = useState<DebitoAutomaticoLinha | null>(null);
  const [registroExcluir, setRegistroExcluir] = useState<DebitoAutomaticoLinha | null>(null);
  const [registroAnexos, setRegistroAnexos] = useState<DebitoAutomaticoLinha | null>(null);
  // SIS-2026-0570: aba "A vencer" (débitos futuros/pendentes por vencimento).
  const [aba, setAba] = useState<"lancamentos" | "a_vencer">("lancamentos");
  const [filtroAVencer, setFiltroAVencer] = useState<"todos" | "vencidos" | "proximos" | "futuros">("todos");

  const [tipoOrigemFiltro, setTipoOrigemFiltro] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [empresaFiltro, setEmpresaFiltro] = useState("");
  const [bancoFiltro, setBancoFiltro] = useState("");

  function limparFiltros() {
    setTipoOrigemFiltro("");
    setTipoFiltro("");
    setDataDe("");
    setDataAte("");
    setCompetencia("");
    setStatusFiltro("");
    setEmpresaFiltro("");
    setBancoFiltro("");
  }

  const bancosDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.banco_id && l.banco_nome && map.set(l.banco_id, l.banco_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const filtradas = useMemo(() => {
    return linhas.filter((l) => {
      if (tipoOrigemFiltro && l.tipo_origem !== tipoOrigemFiltro) return false;
      if (tipoFiltro && l.tipo !== tipoFiltro) return false;
      if (dataDe && l.data_pagamento < dataDe) return false;
      if (dataAte && l.data_pagamento > dataAte) return false;
      if (competencia && l.competencia.slice(0, 7) !== competencia) return false;
      if (statusFiltro && l.status !== statusFiltro) return false;
      if (empresaFiltro && l.empresa_id !== empresaFiltro) return false;
      if (bancoFiltro && l.banco_id !== bancoFiltro) return false;
      return true;
    });
  }, [linhas, tipoOrigemFiltro, tipoFiltro, dataDe, dataAte, competencia, statusFiltro, empresaFiltro, bancoFiltro]);

  const kpis = useMemo(() => {
    const h = hoje();
    const pendentes = linhas.filter((l) => l.status === "pendente");
    const saldoAtual = pendentes.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
    const debitosHoje = pendentes.filter((l) => l.tipo === "saida" && l.data_pagamento === h).reduce((s, l) => s + Number(l.valor), 0);
    const debitosEmAberto = pendentes.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
    const debitosVencidos = pendentes.filter((l) => l.tipo === "saida" && l.data_pagamento < h).reduce((s, l) => s + Number(l.valor), 0);
    // Aviso de vencimento: pendentes (parcelas e avulsos) que vencem em até
    // DIAS_AVISO_VENCIMENTO dias, mais os que já venceram.
    const aVencer = pendentes.filter((l) => diasParaVencer(vencimentoDe(l), h) <= DIAS_AVISO_VENCIMENTO);
    const proximos = pendentes.filter((l) => {
      const d = diasParaVencer(vencimentoDe(l), h);
      return d >= 0 && d <= DIAS_AVISO_VENCIMENTO;
    });
    const vencidosQtd = aVencer.length - proximos.length;
    const proximosSaida = proximos.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
    return {
      saldoAtual, debitosHoje, debitosEmAberto, debitosVencidos,
      proximosQtd: proximos.length, proximosSaida, vencidosQtd,
    };
  }, [linhas]);

  function abrirAVencer(filtro: "todos" | "vencidos" | "proximos" | "futuros") {
    setFiltroAVencer(filtro);
    setAba("a_vencer");
  }

  // SIS-2026-0413: o botão Editar do Fluxo de Caixa traz o usuário pra cá
  // com ?editar=<id> — assim que a lista carrega, abre direto no modal de
  // edição desse registro (em vez de deixar a pessoa procurar na tabela).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const idParaEditar = searchParams.get("editar");
    if (!idParaEditar || linhas.length === 0) return;
    const registro = linhas.find((l) => l.id === idParaEditar);
    if (registro) abrirEdicao(registro);
    setSearchParams((prev) => { prev.delete("editar"); return prev; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas]);

  function abrirEdicao(registro: DebitoAutomaticoLinha) {
    const par = registro.movimentacao_par_id ? linhas.find((l) => l.id === registro.movimentacao_par_id) ?? null : null;
    setRegistroEditar(registro);
    setParEditar(par);
    setModalTipo(registro.tipo_origem);
  }

  async function confirmarExcluir() {
    if (!registroExcluir) return;
    try {
      await excluir.mutateAsync(registroExcluir.id);
      toast.success("Lançamento movido para a lixeira.");
      setRegistroExcluir(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir lançamento.");
    }
  }

  return (
    <AcessoGate menu={MENU_CODIGO} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Débito Automático"
          subtitle="Lance no Fluxo de Caixa débitos, movimentações entre empresas e notas recebidas que não passam pelo Malote."
          module="Financeiro"
          breadcrumb={["Financeiro", "Gestão Financeira", "Débito Automático"]}
          actions={
            <AcessoGate menu={MENU_CODIGO} acao="incluir">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setModalTipo("debito_automatico")}>
                  <Plus className="mr-1.5 h-4 w-4" /> Incluir Débito Automático
                </Button>
                <Button size="sm" variant="outline" onClick={() => setModalTipo("movimentacao_financeira")}>
                  <ArrowLeftRight className="mr-1.5 h-4 w-4" /> Incluir Movimentação Financeira
                </Button>
                <Button size="sm" variant="outline" onClick={() => setModalTipo("nota_recebida")}>
                  <FileInput className="mr-1.5 h-4 w-4" /> Incluir Nota Recebida
                </Button>
              </div>
            </AcessoGate>
          }
        />

        {(kpis.proximosQtd > 0 || kpis.vencidosQtd > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <span className="flex items-center gap-2">
              <BellRing className="h-4 w-4 shrink-0" />
              {kpis.vencidosQtd > 0 && <strong>{kpis.vencidosQtd} vencido{kpis.vencidosQtd === 1 ? "" : "s"}.</strong>}
              {kpis.proximosQtd > 0 && (
                <span>
                  {kpis.proximosQtd} vencimento{kpis.proximosQtd === 1 ? "" : "s"} nos próximos {DIAS_AVISO_VENCIMENTO} dias
                  {kpis.proximosSaida > 0 && <> — saídas de {formatBRL(kpis.proximosSaida)}</>}.
                </span>
              )}
            </span>
            <Button size="sm" variant="outline" className="h-7 border-amber-400 text-xs" onClick={() => abrirAVencer(kpis.vencidosQtd > 0 ? "todos" : "proximos")}>
              Ver na aba A vencer
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiTile label="Saldo Atual (Débitos)" valor={formatBRL(kpis.saldoAtual)} icon={<Wallet />} cor="slate" />
          <KpiTile label="Débitos Hoje" valor={formatBRL(kpis.debitosHoje)} icon={<CalendarClock />} cor="sky" />
          <KpiTile label="Débitos em Aberto" valor={formatBRL(kpis.debitosEmAberto)} icon={<AlertTriangle />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" />
          <KpiTile label="Débitos Vencidos" valor={formatBRL(kpis.debitosVencidos)} icon={<TimerOff />} cor="red" valorClass="text-red-600 dark:text-red-400" />
          <KpiTile
            label={`Vencendo em ${DIAS_AVISO_VENCIMENTO} dias`}
            valor={formatBRL(kpis.proximosSaida)}
            icon={<BellRing />}
            cor="amber"
            onClick={() => abrirAVencer("proximos")}
          />
        </div>

        <Tabs value={aba} onValueChange={(v) => setAba(v as "lancamentos" | "a_vencer")} className="space-y-4">
          <TabsList>
            <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
            <TabsTrigger value="a_vencer">A vencer</TabsTrigger>
          </TabsList>

          <TabsContent value="a_vencer" className="mt-0">
            <AVencerTab key={filtroAVencer} linhas={linhas} hoje={hoje()} filtroInicial={filtroAVencer} onEditar={abrirEdicao} />
          </TabsContent>

          <TabsContent value="lancamentos" className="mt-0 space-y-6">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Filtros</p>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
                <X className="h-3.5 w-3.5" /> Limpar filtros
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
              <div>
                <Label className="text-xs">Tipo de Débito</Label>
                <Select value={tipoFiltro || "todos"} onValueChange={(v) => setTipoFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="saida">Saída</SelectItem>
                    <SelectItem value="entrada">Entrada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tipo de Débito (Origem)</Label>
                <Select value={tipoOrigemFiltro || "todos"} onValueChange={(v) => setTipoOrigemFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {(Object.keys(TIPO_ORIGEM_LABEL) as TipoOrigemDebito[]).map((t) => (
                      <SelectItem key={t} value={t}>{TIPO_ORIGEM_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Data de Início</Label>
                <Input type="date" className="h-8 text-xs" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Data de Fim</Label>
                <Input type="date" className="h-8 text-xs" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Competência</Label>
                <Input type="month" className="h-8 text-xs" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFiltro || "todos"} onValueChange={(v) => setStatusFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="pago">Pago</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Empresa</Label>
                <Select value={empresaFiltro || "todas"} onValueChange={(v) => setEmpresaFiltro(v === "todas" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Banco</Label>
                <Select value={bancoFiltro || "todos"} onValueChange={(v) => setBancoFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {bancosDisponiveis.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Débitos Automáticos</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="[&>th]:px-2 [&>th]:py-2">
                    <TableHead>ID</TableHead>
                    <TableHead>Data Pgto.</TableHead>
                    <TableHead>Compet.</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Classificação</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-8">Banco</TableHead>
                    <TableHead>Forma Pgto.</TableHead>
                    <TableHead className="text-right">Valor (R$)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center w-8">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-10">Carregando...</TableCell></TableRow>
                  )}
                  {!isLoading && filtradas.length === 0 && (
                    <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-10">Nenhum registro encontrado com os filtros atuais.</TableCell></TableRow>
                  )}
                  {filtradas.map((l) => (
                    <TableRow key={l.id} className="[&>td]:px-2 [&>td]:py-2">
                      <TableCell className="font-mono text-xs whitespace-nowrap">{l.numero}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(l.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(l.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}</TableCell>
                      <TableCell className="text-xs max-w-[110px] truncate" title={TIPO_ORIGEM_LABEL[l.tipo_origem]}>{TIPO_ORIGEM_LABEL[l.tipo_origem]}</TableCell>
                      <TableCell>
                        {l.tipo === "entrada" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Entrada</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">Saída</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs max-w-[90px] truncate" title={l.empresa_nome ?? ""}>{l.empresa_nome ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[130px] truncate" title={l.contrato_nome ?? ""}>{l.contrato_nome ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[110px] truncate" title={l.classificacao_nome ?? ""}>{l.classificacao_nome ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate" title={l.descricao}>{l.descricao}</TableCell>
                      <TableCell>
                        {l.banco_nome ? <BancoBadge nome={l.banco_nome} logoUrl={urlLogoCartao(l.banco_logo_path)} showNome={false} /> : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[110px] truncate" title={l.forma_pagamento}>{l.forma_pagamento}</TableCell>
                      <TableCell className="text-right text-xs font-medium whitespace-nowrap">{formatBRL(l.valor)}</TableCell>
                      <TableCell>
                        <Badge variant={l.status === "pago" ? "default" : "outline"} className={l.status === "pago" ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
                          {l.status === "pago" ? "Pago" : "Pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setRegistroHistorico(l)}>
                              <History className="mr-2 h-3.5 w-3.5" /> Histórico
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setRegistroAnexos(l)}>
                              <Paperclip className="mr-2 h-3.5 w-3.5" /> Anexos
                            </DropdownMenuItem>
                            <AcessoGate menu={MENU_CODIGO} acao="alterar">
                              <DropdownMenuItem onClick={() => abrirEdicao(l)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                              </DropdownMenuItem>
                            </AcessoGate>
                            <AcessoGate menu={MENU_CODIGO} acao="excluir">
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setRegistroExcluir(l)}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                              </DropdownMenuItem>
                            </AcessoGate>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {filtradas.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">Mostrando {filtradas.length} registro{filtradas.length === 1 ? "" : "s"}</p>
            )}
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!registroAnexos} onOpenChange={(o) => !o && setRegistroAnexos(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Anexos — {registroAnexos?.numero}</DialogTitle>
            <DialogDescription>{registroAnexos?.descricao}</DialogDescription>
          </DialogHeader>
          {registroAnexos && (
            <div className="space-y-4">
              <AnexosDebito debitoId={registroAnexos.id} tipo="lancamento" titulo="Nota / boleto" />
              <AnexosDebito debitoId={registroAnexos.id} tipo="comprovante" titulo="Comprovante de pagamento" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {modalTipo && (
        <DebitoAutomaticoModal
          open
          tipoOrigem={modalTipo}
          registroEditar={registroEditar}
          registroParEditar={parEditar}
          onClose={() => {
            setModalTipo(null);
            setRegistroEditar(null);
            setParEditar(null);
          }}
        />
      )}

      <HistoricoDebitoDialog open={!!registroHistorico} registro={registroHistorico} onClose={() => setRegistroHistorico(null)} />

      <AlertDialog open={!!registroExcluir} onOpenChange={(o) => !o && setRegistroExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {registroExcluir?.numero} — {registroExcluir?.descricao}.
              {registroExcluir?.tipo_origem === "movimentacao_financeira" && " As 2 linhas dessa Movimentação Financeira (saída e entrada) vão junto."}
              {" "}Vai para a lixeira — dá pra restaurar depois pelo Fluxo de Caixa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExcluir}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AcessoGate>
  );
}
