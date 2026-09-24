import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Landmark, TrendingUp, ArrowDownToLine, TimerOff, X, Plus, PiggyBank,
  Pencil, Trash2, History, MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { urlLogoCartao, useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useFormasPagamento } from "@/hooks/useMaloteFormaPagamento";
import {
  useAplicacoesFinanceiras,
  useCriarAplicacao,
  useEditarAplicacao,
  useAtualizarRendimento,
  useResgatarAplicacao,
  useExcluirAplicacao,
  useHistoricoAplicacao,
  type AplicacaoFinanceiraLinha,
  type ProdutoAplicacao,
  type TipoAplicacao,
  type StatusAplicacaoExibicao,
} from "@/hooks/useAplicacaoFinanceira";

// SIS-2026-0473 (Iury, mockup HTML via Discord): submódulo Aplicações
// Financeiras, parecido com Débito Automático — registra aplicações
// (CDB/Fundo DI/Conta remunerada/etc.) e resgates (parciais ou totais), e
// alimenta o Fluxo de Caixa: aplicar é saída, cada resgate é entrada
// própria. Rendimento é informativo/manual (sem cálculo de indexador/CDI).

const MENU_CODIGO = "financeiro-aplicacao-financeira";

const PRODUTOS: ProdutoAplicacao[] = ["CDB", "Fundo DI", "Conta remunerada", "Poupança", "Outro"];
const TIPO_APLICACAO_LABEL: Record<TipoAplicacao, string> = {
  aplicacao_inicial: "Aplicação inicial",
  reaplicacao: "Reaplicação",
  aporte_adicional: "Aporte adicional",
};

const STATUS_BADGE: Record<StatusAplicacaoExibicao, { label: string; className: string }> = {
  ativa: { label: "Ativa", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" },
  resgatada: { label: "Resgatada", className: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300" },
  vencida: { label: "Vencida", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
};

const hoje = () => new Date().toISOString().slice(0, 10);
const fmtData = (iso: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—");

export default function AplicacoesFinanceiras() {
  const { data: linhas = [], isLoading } = useAplicacoesFinanceiras();
  const { data: empresas = [] } = useEmpresasGrupo();
  const excluir = useExcluirAplicacao();

  const [dialogNova, setDialogNova] = useState(false);
  const [registroEditar, setRegistroEditar] = useState<AplicacaoFinanceiraLinha | null>(null);
  const [registroRendimento, setRegistroRendimento] = useState<AplicacaoFinanceiraLinha | null>(null);
  const [registroResgate, setRegistroResgate] = useState<AplicacaoFinanceiraLinha | null>(null);
  const [registroHistorico, setRegistroHistorico] = useState<AplicacaoFinanceiraLinha | null>(null);
  const [registroExcluir, setRegistroExcluir] = useState<AplicacaoFinanceiraLinha | null>(null);

  const [empresaFiltro, setEmpresaFiltro] = useState("");
  const [bancoFiltro, setBancoFiltro] = useState("");
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [vencimentoFiltro, setVencimentoFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");

  function limparFiltros() {
    setEmpresaFiltro(""); setBancoFiltro(""); setProdutoFiltro("");
    setDataDe(""); setDataAte(""); setVencimentoFiltro(""); setStatusFiltro("");
  }

  const bancosDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.banco_id && l.banco_nome && map.set(l.banco_id, l.banco_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const filtradas = useMemo(() => {
    return linhas.filter((l) => {
      if (empresaFiltro && l.empresa_id !== empresaFiltro) return false;
      if (bancoFiltro && l.banco_id !== bancoFiltro) return false;
      if (produtoFiltro && l.produto !== produtoFiltro) return false;
      if (dataDe && l.data_aplicacao < dataDe) return false;
      if (dataAte && l.data_aplicacao > dataAte) return false;
      if (vencimentoFiltro && (l.data_vencimento ?? "").slice(0, 7) !== vencimentoFiltro) return false;
      if (statusFiltro && l.status_exibicao !== statusFiltro) return false;
      return true;
    });
  }, [linhas, empresaFiltro, bancoFiltro, produtoFiltro, dataDe, dataAte, vencimentoFiltro, statusFiltro]);

  const kpis = useMemo(() => {
    const ativas = linhas.filter((l) => l.status === "ativa");
    const totalAplicado = ativas.reduce((s, l) => s + Number(l.saldo_principal), 0);
    const rendimentoAcumulado = ativas.reduce((s, l) => s + Number(l.rendimento_acumulado), 0);
    const totalResgatado = linhas.reduce((s, l) => s + Number(l.total_principal_resgatado) + Number(l.total_rendimento_resgatado), 0);
    const vencidas = ativas.filter((l) => l.status_exibicao === "vencida").length;
    return { totalAplicado, rendimentoAcumulado, totalResgatado, vencidas };
  }, [linhas]);

  async function confirmarExcluir() {
    if (!registroExcluir) return;
    try {
      await excluir.mutateAsync(registroExcluir.id);
      toast.success("Aplicação excluída.");
      setRegistroExcluir(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir aplicação.");
    }
  }

  return (
    <AcessoGate menu={MENU_CODIGO} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Aplicações Financeiras"
          subtitle="Registre aplicações, acompanhe saldos, rendimentos, vencimentos e resgates por empresa e instituição financeira."
          module="Financeiro"
          breadcrumb={["Financeiro", "Gestão Financeira", "Aplicações Financeiras"]}
          actions={
            <AcessoGate menu={MENU_CODIGO} acao="incluir">
              <Button size="sm" onClick={() => setDialogNova(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Nova Aplicação
              </Button>
            </AcessoGate>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label="Total Aplicado (ativas)" valor={formatBRL(kpis.totalAplicado)} icon={<Landmark />} cor="slate" />
          <KpiTile label="Rendimento Acumulado" valor={formatBRL(kpis.rendimentoAcumulado)} icon={<TrendingUp />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
          <KpiTile label="Total Resgatado" valor={formatBRL(kpis.totalResgatado)} icon={<ArrowDownToLine />} cor="sky" />
          <KpiTile label="Vencidas" valor={String(kpis.vencidas)} icon={<TimerOff />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" />
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Filtros</p>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
                <X className="h-3.5 w-3.5" /> Limpar filtros
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
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
                <Label className="text-xs">Banco / Instituição</Label>
                <Select value={bancoFiltro || "todos"} onValueChange={(v) => setBancoFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {bancosDisponiveis.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tipo de Aplicação</Label>
                <Select value={produtoFiltro || "todos"} onValueChange={(v) => setProdutoFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {PRODUTOS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Data Inicial</Label>
                <Input type="date" className="h-8 text-xs" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Data Final</Label>
                <Input type="date" className="h-8 text-xs" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Vencimento</Label>
                <Input type="month" className="h-8 text-xs" value={vencimentoFiltro} onChange={(e) => setVencimentoFiltro(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={statusFiltro || "todos"} onValueChange={(v) => setStatusFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="ativa">Ativa</SelectItem>
                    <SelectItem value="resgatada">Resgatada</SelectItem>
                    <SelectItem value="vencida">Vencida</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Carteira de Aplicações</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="[&>th]:px-2 [&>th]:py-2">
                    <TableHead>ID</TableHead>
                    <TableHead>Data Aplicação</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="w-8">Banco</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Indexador</TableHead>
                    <TableHead>Taxa</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor Aplicado</TableHead>
                    <TableHead className="text-right">Rendimento</TableHead>
                    <TableHead className="text-right">Saldo Atual</TableHead>
                    <TableHead>Liquidez</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center w-8">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-10">Carregando...</TableCell></TableRow>
                  )}
                  {!isLoading && filtradas.length === 0 && (
                    <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-10">Nenhuma aplicação encontrada com os filtros atuais.</TableCell></TableRow>
                  )}
                  {filtradas.map((l) => {
                    const badge = STATUS_BADGE[l.status_exibicao];
                    return (
                      <TableRow key={l.id} className="[&>td]:px-2 [&>td]:py-2">
                        <TableCell className="font-mono text-xs whitespace-nowrap">{l.numero}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtData(l.data_aplicacao)}</TableCell>
                        <TableCell className="text-xs max-w-[90px] truncate" title={l.empresa_nome ?? ""}>{l.empresa_nome ?? "—"}</TableCell>
                        <TableCell>{l.banco_nome ? <BancoBadge nome={l.banco_nome} logoUrl={urlLogoCartao(l.banco_logo_path)} showNome={false} /> : "—"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{l.produto}</Badge></TableCell>
                        <TableCell className="text-xs">{l.indexador ?? "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{l.taxa ?? "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{fmtData(l.data_vencimento)}</TableCell>
                        <TableCell className="text-right text-xs font-medium whitespace-nowrap">{formatBRL(l.valor_aplicado)}</TableCell>
                        <TableCell className="text-right text-xs whitespace-nowrap text-emerald-600 dark:text-emerald-400">{formatBRL(l.rendimento_acumulado)}</TableCell>
                        <TableCell className="text-right text-xs font-semibold whitespace-nowrap">{formatBRL(l.saldo_atual)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{l.liquidez ?? "—"}</TableCell>
                        <TableCell><Badge className={badge.className}>{badge.label}</Badge></TableCell>
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
                              <AcessoGate menu={MENU_CODIGO} acao="alterar">
                                <>
                                  {l.status === "ativa" && (
                                    <DropdownMenuItem onClick={() => setRegistroRendimento(l)}>
                                      <TrendingUp className="mr-2 h-3.5 w-3.5" /> Atualizar rendimento
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => setRegistroEditar(l)}>
                                    <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                                  </DropdownMenuItem>
                                  {l.status === "ativa" && (
                                    <DropdownMenuItem onClick={() => setRegistroResgate(l)}>
                                      <PiggyBank className="mr-2 h-3.5 w-3.5" /> Registrar Resgate
                                    </DropdownMenuItem>
                                  )}
                                </>
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
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {filtradas.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">Mostrando {filtradas.length} aplicação{filtradas.length === 1 ? "" : "ões"}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <DialogNovaAplicacao open={dialogNova} onClose={() => setDialogNova(false)} />
      <DialogEditarAplicacao registro={registroEditar} onClose={() => setRegistroEditar(null)} />
      <DialogAtualizarRendimento registro={registroRendimento} onClose={() => setRegistroRendimento(null)} />
      <DialogResgatarAplicacao registro={registroResgate} onClose={() => setRegistroResgate(null)} />
      <DialogHistoricoAplicacao registro={registroHistorico} onClose={() => setRegistroHistorico(null)} />

      <AlertDialog open={!!registroExcluir} onOpenChange={(o) => !o && setRegistroExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir aplicação?</AlertDialogTitle>
            <AlertDialogDescription>
              {registroExcluir?.numero} — {registroExcluir?.descricao}. Só é possível excluir aplicações sem nenhum
              resgate registrado. Essa ação não pode ser desfeita.
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

// ── Dialog: Nova Aplicação ───────────────────────────────────────────────

function DialogNovaAplicacao({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: formasPagamento = [] } = useFormasPagamento();
  const criar = useCriarAplicacao();

  const [dataAplicacao, setDataAplicacao] = useState(hoje());
  const [competencia, setCompetencia] = useState(hoje().slice(0, 7));
  const [empresaId, setEmpresaId] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [produto, setProduto] = useState<ProdutoAplicacao | "">("");
  const [tipoAplicacao, setTipoAplicacao] = useState<TipoAplicacao | "">("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [indexador, setIndexador] = useState("");
  const [taxa, setTaxa] = useState("");
  const [dataVencimento, setDataVencimento] = useState("");
  const [liquidez, setLiquidez] = useState("");

  function limpar() {
    setDataAplicacao(hoje()); setCompetencia(hoje().slice(0, 7)); setEmpresaId(""); setBancoId("");
    setProduto(""); setTipoAplicacao(""); setFormaPagamento(""); setDescricao(""); setValor("");
    setIndexador(""); setTaxa(""); setDataVencimento(""); setLiquidez("");
  }

  async function salvar() {
    const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!dataAplicacao || !competencia || !empresaId || !bancoId || !produto || !tipoAplicacao || !formaPagamento || !descricao.trim() || !valorNum) {
      toast.error("Preencha os campos obrigatórios da aplicação.");
      return;
    }
    try {
      await criar.mutateAsync({
        data_aplicacao: dataAplicacao,
        competencia: competencia + "-01",
        empresa_id: empresaId,
        banco_id: bancoId,
        produto,
        tipo_aplicacao: tipoAplicacao,
        forma_pagamento: formaPagamento,
        descricao: descricao.trim(),
        valor_aplicado: valorNum,
        indexador: indexador.trim() || null,
        taxa: taxa.trim() || null,
        data_vencimento: dataVencimento || null,
        liquidez: liquidez.trim() || null,
      });
      toast.success("Aplicação financeira registrada.");
      limpar();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar aplicação.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incluir Aplicação Financeira</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Data de Aplicação *</Label>
            <Input type="date" className="h-9" value={dataAplicacao} onChange={(e) => setDataAplicacao(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Competência *</Label>
            <Input type="month" className="h-9" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Empresa *</Label>
            <Select value={empresaId} onValueChange={setEmpresaId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Banco *</Label>
            <Select value={bancoId} onValueChange={setBancoId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{bancos.filter((b) => b.ativo).map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Produto *</Label>
            <Select value={produto} onValueChange={(v) => setProduto(v as ProdutoAplicacao)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{PRODUTOS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tipo de Aplicação *</Label>
            <Select value={tipoAplicacao} onValueChange={(v) => setTipoAplicacao(v as TipoAplicacao)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPO_APLICACAO_LABEL) as TipoAplicacao[]).map((t) => (
                  <SelectItem key={t} value={t}>{TIPO_APLICACAO_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Classificação *</Label>
            <Input className="h-9" value="Aplicação Financeira" readOnly disabled />
          </div>
          <div>
            <Label className="text-xs">Forma de Pagamento *</Label>
            <Select value={formaPagamento} onValueChange={setFormaPagamento}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{formasPagamento.filter((f) => f.ativo).map((f) => <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Descrição *</Label>
            <Input className="h-9" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva a aplicação financeira" />
          </div>
          <div>
            <Label className="text-xs">Valor (R$) *</Label>
            <Input className="h-9" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <Label className="text-xs">Indexador</Label>
            <Input className="h-9" value={indexador} onChange={(e) => setIndexador(e.target.value)} placeholder="Ex: CDI, Prefixado" />
          </div>
          <div>
            <Label className="text-xs">Taxa</Label>
            <Input className="h-9" value={taxa} onChange={(e) => setTaxa(e.target.value)} placeholder="Ex: 101% CDI" />
          </div>
          <div>
            <Label className="text-xs">Data de Vencimento</Label>
            <Input type="date" className="h-9" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Liquidez</Label>
            <Input className="h-9" value={liquidez} onChange={(e) => setLiquidez(e.target.value)} placeholder="Ex: Diária, D+1, No vencimento" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={criar.isPending}>Cancelar</Button>
          <Button onClick={salvar} disabled={criar.isPending}>{criar.isPending ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog: Editar campos informativos ──────────────────────────────────

function DialogEditarAplicacao({ registro, onClose }: { registro: AplicacaoFinanceiraLinha | null; onClose: () => void }) {
  return (
    <Dialog open={!!registro} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm p-5">
        {/* key={registro.id} força remontagem a cada aplicação diferente —
            sem isso, o estado local (useState) do formulário sobreviveria
            entre uma edição e a próxima, mostrando os valores do registro
            anterior por um instante (ou pior, salvando por cima). */}
        {registro && <FormularioEditarAplicacao key={registro.id} registro={registro} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function FormularioEditarAplicacao({ registro, onClose }: { registro: AplicacaoFinanceiraLinha; onClose: () => void }) {
  const editar = useEditarAplicacao();
  const [indexador, setIndexador] = useState(registro.indexador ?? "");
  const [taxa, setTaxa] = useState(registro.taxa ?? "");
  const [dataVencimento, setDataVencimento] = useState(registro.data_vencimento ?? "");
  const [liquidez, setLiquidez] = useState(registro.liquidez ?? "");
  const [descricao, setDescricao] = useState(registro.descricao);

  async function salvar() {
    try {
      await editar.mutateAsync({
        id: registro.id,
        campos: { indexador: indexador || null, taxa: taxa || null, data_vencimento: dataVencimento || null, liquidez: liquidez || null, descricao: descricao.trim() },
      });
      toast.success("Aplicação atualizada.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao editar aplicação.");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar aplicação</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {registro.numero} — {formatBRL(registro.valor_aplicado)}. Valor aplicado não pode ser alterado — exclua e
          recadastre se estiver errado.
        </p>
        <div>
          <Label className="text-xs">Descrição</Label>
          <Input className="h-9" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Indexador</Label>
          <Input className="h-9" value={indexador} onChange={(e) => setIndexador(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Taxa</Label>
          <Input className="h-9" value={taxa} onChange={(e) => setTaxa(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Data de Vencimento</Label>
          <Input type="date" className="h-9" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Liquidez</Label>
          <Input className="h-9" value={liquidez} onChange={(e) => setLiquidez(e.target.value)} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} disabled={editar.isPending}>Cancelar</Button>
        <Button size="sm" onClick={salvar} disabled={editar.isPending}>{editar.isPending ? "Salvando..." : "Salvar"}</Button>
      </DialogFooter>
    </>
  );
}

// ── Dialog: Atualizar rendimento (manual) ───────────────────────────────

function DialogAtualizarRendimento({ registro, onClose }: { registro: AplicacaoFinanceiraLinha | null; onClose: () => void }) {
  const atualizar = useAtualizarRendimento();
  const [valor, setValor] = useState("");

  if (!registro) return null;

  async function confirmar() {
    if (!registro) return;
    const v = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!v || v <= 0) {
      toast.error("Informe um valor de rendimento positivo.");
      return;
    }
    try {
      await atualizar.mutateAsync({ id: registro.id, valor: v });
      toast.success("Rendimento atualizado.");
      setValor("");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao atualizar rendimento.");
    }
  }

  return (
    <Dialog open={!!registro} onOpenChange={(v) => { if (!v) { setValor(""); onClose(); } }}>
      <DialogContent className="sm:max-w-sm p-5">
        <DialogHeader>
          <DialogTitle>Atualizar rendimento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {registro.numero} — rendimento acumulado hoje: {formatBRL(registro.rendimento_acumulado)}. Informe só o
            valor a somar (manual, sem cálculo automático de indexador).
          </p>
          <div>
            <Label className="text-xs">Rendimento a somar (R$)</Label>
            <Input className="h-9" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={atualizar.isPending}>Cancelar</Button>
          <Button size="sm" onClick={confirmar} disabled={atualizar.isPending}>{atualizar.isPending ? "Salvando..." : "Confirmar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog: Registrar Resgate (parcial ou total) ────────────────────────

function DialogResgatarAplicacao({ registro, onClose }: { registro: AplicacaoFinanceiraLinha | null; onClose: () => void }) {
  const resgatar = useResgatarAplicacao();
  const [dataResgate, setDataResgate] = useState(hoje());
  const [tipo, setTipo] = useState<"parcial" | "total">("total");
  const [valorPrincipal, setValorPrincipal] = useState("");
  const [valorRendimento, setValorRendimento] = useState("");
  const [observacao, setObservacao] = useState("");

  if (!registro) return null;

  function limpar() {
    setDataResgate(hoje()); setTipo("total"); setValorPrincipal(""); setValorRendimento(""); setObservacao("");
  }

  async function confirmar() {
    if (!registro) return;
    const principal = tipo === "total" ? registro.saldo_principal : Number(valorPrincipal.replace(/\./g, "").replace(",", "."));
    const rendimento = tipo === "total" ? registro.rendimento_acumulado : Number((valorRendimento || "0").replace(/\./g, "").replace(",", "."));
    if (!dataResgate || !principal || principal <= 0) {
      toast.error("Informe a data e o valor do principal resgatado.");
      return;
    }
    try {
      await resgatar.mutateAsync({ id: registro.id, dataResgate, valorPrincipal: principal, valorRendimento: rendimento, tipo, observacao: observacao.trim() || null });
      toast.success(tipo === "total" ? "Resgate total registrado — aplicação encerrada." : "Resgate parcial registrado.");
      limpar();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar resgate.");
    }
  }

  return (
    <Dialog open={!!registro} onOpenChange={(v) => { if (!v) { limpar(); onClose(); } }}>
      <DialogContent className="sm:max-w-sm p-5">
        <DialogHeader>
          <DialogTitle>Registrar Resgate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {registro.numero} — saldo disponível: {formatBRL(registro.saldo_principal)} de principal +{" "}
            {formatBRL(registro.rendimento_acumulado)} de rendimento.
          </p>
          <div>
            <Label className="text-xs">Tipo de Resgate</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as "parcial" | "total")}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total (encerra a aplicação)</SelectItem>
                <SelectItem value="parcial">Parcial (mantém o restante ativo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Data do Resgate *</Label>
            <Input type="date" className="h-9" value={dataResgate} onChange={(e) => setDataResgate(e.target.value)} />
          </div>
          {tipo === "parcial" && (
            <>
              <div>
                <Label className="text-xs">Valor do Principal Resgatado (R$) *</Label>
                <Input className="h-9" value={valorPrincipal} onChange={(e) => setValorPrincipal(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label className="text-xs">Valor do Rendimento Resgatado (R$)</Label>
                <Input className="h-9" value={valorRendimento} onChange={(e) => setValorRendimento(e.target.value)} placeholder="0,00" />
              </div>
            </>
          )}
          <div>
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value.slice(0, 300))} placeholder="Ex: resgate para pagamento de fornecedor X" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={resgatar.isPending}>Cancelar</Button>
          <Button size="sm" onClick={confirmar} disabled={resgatar.isPending}>{resgatar.isPending ? "Salvando..." : "Registrar como resgatada"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Dialog: Histórico de eventos ─────────────────────────────────────────

const EVENTO_LABEL: Record<string, string> = {
  criacao: "Criação",
  edicao: "Edição",
  rendimento_atualizado: "Rendimento atualizado",
  resgate_parcial: "Resgate parcial",
  resgate_total: "Resgate total",
  exclusao: "Exclusão",
};

function DialogHistoricoAplicacao({ registro, onClose }: { registro: AplicacaoFinanceiraLinha | null; onClose: () => void }) {
  const { data: eventos = [], isLoading } = useHistoricoAplicacao(registro?.id ?? null);

  return (
    <Dialog open={!!registro} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico — {registro?.numero}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Carregando...</p>
        ) : eventos.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Nenhum evento registrado.</p>
        ) : (
          <div className="space-y-2">
            {eventos.map((ev) => (
              <div key={ev.id} className="border-b border-border pb-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{EVENTO_LABEL[ev.tipo_evento] ?? ev.tipo_evento}</span>
                  <span className="text-muted-foreground">{new Date(ev.created_at).toLocaleString("pt-BR")}</span>
                </div>
                {ev.descricao && <p className="text-muted-foreground mt-0.5">{ev.descricao}</p>}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
