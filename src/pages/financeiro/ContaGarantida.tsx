import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BarChart3, Gauge, ListChecks, MoreHorizontal, Percent, Plus, Undo2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { urlLogoCartao, useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useContasGarantidas, useEstornarMovimentoContaGarantida, useMovimentosContaGarantida } from "@/hooks/useContaGarantida";
import { ContaDialog } from "./conta-garantida/ContaDialog";
import { LancamentoDialog } from "./conta-garantida/LancamentoDialog";
import {
  ROTULO_TIPO, agruparPorBanco, diasParaVencer, filtrarMovimentos, kpisDaCarteira, movimentosComSaldo, movimentosPorMes, resumoDasContas,
  type ContaGarantida as ContaGarantidaModelo, type MovimentoComSaldo, type TipoMovimento,
} from "./conta-garantida/regras";

// SIS-2026-0798: Conta Garantida nativa, no modelo do HTML enviado no chamado (Iury/Peretti, Discord): carteira de contas com limite, saldo
// utilizado e disponível; resgate, amortização e juros lançados aqui e registrados no Fluxo de Caixa (origem "Conta Garantida"); filtros;
// movimentações e gráficos. Substitui a versão que só lia a planilha de Fluxo importada (módulo ultrapassado, dados descartados).

const MENU_CODIGO = "conta-garantida";
const TODOS = "todos";
const PAGINA = 50;
const CORES = ["#FF6B35", "#0f3268", "#10b981", "#7c3aed", "#eab308", "#d9534f"];

const ESTILO_TIPO: Record<TipoMovimento, string> = {
  resgate: "border-sky-500/40 text-sky-700 dark:text-sky-300",
  amortizacao: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  juros: "border-amber-500/40 text-amber-700 dark:text-amber-300",
};

const data = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
const compacto = (v: number) => new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export default function ContaGarantida() {
  const navigate = useNavigate();
  const { data: contas = [], isLoading, isError, error } = useContasGarantidas();
  const { data: movimentos = [] } = useMovimentosContaGarantida();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const estornar = useEstornarMovimentoContaGarantida();

  const [fEmpresa, setFEmpresa] = useState(TODOS);
  const [fBanco, setFBanco] = useState(TODOS);
  const [fConta, setFConta] = useState(TODOS);
  const [fDe, setFDe] = useState("");
  const [fAte, setFAte] = useState("");
  const [fTipo, setFTipo] = useState<string>(TODOS);
  const [fStatus, setFStatus] = useState(TODOS);
  const [limite, setLimite] = useState(PAGINA);

  const [contaEditando, setContaEditando] = useState<ContaGarantidaModelo | null>(null);
  const [contaAberta, setContaAberta] = useState(false);
  const [lancando, setLancando] = useState<TipoMovimento | null>(null);
  const [contaDoLancamento, setContaDoLancamento] = useState<string | undefined>();
  const [aEstornar, setAEstornar] = useState<MovimentoComSaldo | null>(null);
  const [motivo, setMotivo] = useState("");

  const bancoPorId = useMemo(() => new Map(bancos.map((b) => [b.id, b])), [bancos]);
  const nomeBanco = (id: string) => bancoPorId.get(id)?.nome ?? "—";
  const nomeEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome ?? "—";
  const nomeClassificacao = useMemo(() => new Map(classificacoes.map((c) => [c.id, c.nome])), [classificacoes]);

  const resumos = useMemo(() => resumoDasContas(contas, movimentos), [contas, movimentos]);
  const resumosFiltrados = useMemo(
    () =>
      resumos.filter(
        (r) =>
          (fEmpresa === TODOS || r.conta.empresa_id === fEmpresa) &&
          (fBanco === TODOS || r.conta.banco_id === fBanco) &&
          (fConta === TODOS || r.conta.id === fConta) &&
          (fStatus === TODOS || r.conta.status === fStatus),
      ),
    [resumos, fEmpresa, fBanco, fConta, fStatus],
  );
  const idsVisiveis = useMemo(() => new Set(resumosFiltrados.map((r) => r.conta.id)), [resumosFiltrados]);
  const comSaldo = useMemo(() => movimentosComSaldo(movimentos), [movimentos]);
  const ultimoMovimento = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of movimentos) {
      if (x.cancelado_em) continue;
      const atual = m.get(x.conta_garantida_id);
      if (!atual || x.data_movimento > atual) m.set(x.conta_garantida_id, x.data_movimento);
    }
    return m;
  }, [movimentos]);
  const movFiltrados = useMemo(
    () => filtrarMovimentos(comSaldo, idsVisiveis, { de: fDe, ate: fAte, tipo: fTipo === TODOS ? "" : (fTipo as TipoMovimento) }),
    [comSaldo, idsVisiveis, fDe, fAte, fTipo],
  );
  const kpis = useMemo(() => kpisDaCarteira(resumosFiltrados, movimentos, { de: fDe, ate: fAte }), [resumosFiltrados, movimentos, fDe, fAte]);

  const ativasFiltradas = resumosFiltrados.filter((r) => r.conta.status === "ativa");
  const dadosBancos = useMemo(() => agruparPorBanco(resumosFiltrados, nomeBanco), [resumosFiltrados, bancos]);
  const dadosMeses = useMemo(() => movimentosPorMes(movFiltrados), [movFiltrados]);
  const dadosContas = ativasFiltradas.map((r) => ({ nome: `${nomeBanco(r.conta.banco_id)} ${r.conta.conta}`, limite: r.conta.limite, utilizado: r.saldo }));
  const dividaTotal = dadosBancos.reduce((s, b) => s + b.utilizado, 0);
  const dadosDonut = dadosBancos.filter((b) => b.utilizado > 0).map((b) => ({ banco: b.banco, valor: b.utilizado }));

  const alertasVencimento = useMemo(
    () =>
      ativasFiltradas
        .map((r) => ({ r, dias: diasParaVencer(r.conta.vencimento) }))
        .filter((x): x is { r: typeof x.r; dias: number } => x.dias !== null && x.dias <= 30),
    [ativasFiltradas],
  );

  const contasDoBancoFiltro = contas.filter((c) => (fBanco === TODOS || c.banco_id === fBanco) && (fEmpresa === TODOS || c.empresa_id === fEmpresa));
  const algumFiltro = [fEmpresa, fBanco, fConta, fTipo, fStatus].some((v) => v !== TODOS) || !!fDe || !!fAte;
  const limparFiltros = () => {
    setFEmpresa(TODOS); setFBanco(TODOS); setFConta(TODOS); setFTipo(TODOS); setFStatus(TODOS); setFDe(""); setFAte("");
  };

  function lancar(tipo: TipoMovimento, contaId?: string) {
    setContaDoLancamento(contaId ?? (fConta !== TODOS ? fConta : undefined));
    setLancando(tipo);
  }
  function abrirConta(conta: ContaGarantidaModelo | null) {
    setContaEditando(conta);
    setContaAberta(true);
  }
  async function confirmarEstorno() {
    if (!aEstornar) return;
    if (!motivo.trim()) {
      toast.error("Informe o motivo do estorno.");
      return;
    }
    try {
      await estornar.mutateAsync({ movimentoId: aEstornar.id, motivo: motivo.trim() });
      toast.success("Lançamento estornado: saiu da conta e do Fluxo de Caixa.");
      setAEstornar(null);
      setMotivo("");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível estornar o lançamento.");
    }
  }

  const contaPorId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);
  const contasAtivasParaLancar = resumos.filter((r) => r.conta.status === "ativa");
  const movimentosDaContaEditada = contaEditando ? movimentos.filter((m) => m.conta_garantida_id === contaEditando.id).length : 0;
  const saldoDaContaEditada = contaEditando ? (resumos.find((r) => r.conta.id === contaEditando.id)?.saldo ?? 0) : 0;

  return (
    <AcessoGate menu={MENU_CODIGO} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-5">
        <PageHeader
          module="Financeiro"
          breadcrumb={["Gestão Financeira", "Conta Garantida"]}
          title="Conta Garantida"
          subtitle="Controle limites, utilizações, amortizações, juros e disponibilidade das linhas de crédito por empresa e instituição financeira. Tudo o que é lançado aqui entra no Fluxo de Caixa."
          actions={
            <>
              <AcessoGate menu={MENU_CODIGO} acao="alterar">
                <Button onClick={() => abrirConta(null)}><Plus className="mr-2 h-4 w-4" /> Nova Conta</Button>
              </AcessoGate>
              <AcessoGate menu={MENU_CODIGO} acao="incluir">
                <Button variant="outline" onClick={() => lancar("resgate")}><ArrowDownToLine className="mr-2 h-4 w-4" /> Novo Resgate</Button>
                <Button variant="outline" onClick={() => lancar("amortizacao")}><ArrowUpFromLine className="mr-2 h-4 w-4" /> Nova Amortização</Button>
                <Button variant="outline" onClick={() => lancar("juros")}><Percent className="mr-2 h-4 w-4" /> Lançar Juros</Button>
              </AcessoGate>
            </>
          }
        />

        {isError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            Não foi possível carregar as contas garantidas{(error as any)?.message ? `: ${(error as any).message}` : ""}. Se a migration do chamado SIS-2026-0798 ainda não foi aplicada, é por isso.
          </div>
        )}

        {alertasVencimento.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Vencimento próximo:{" "}
              {alertasVencimento.map(({ r, dias }) => `${nomeBanco(r.conta.banco_id)} ${r.conta.conta} (${dias <= 0 ? "vencida" : `${dias}d`})`).join(", ")}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiTile label="Limite Contratado" valor={formatBRL(kpis.limite)} sub="Contas ativas" icon={<Wallet />} cor="slate" />
          <KpiTile label="Saldo Utilizado" valor={formatBRL(kpis.utilizado)} sub={`${kpis.utilizadoPct.toFixed(1).replace(".", ",")}% do limite`} icon={<Gauge />} cor="red" valorClass="text-red-600 dark:text-red-400" />
          <KpiTile label="Limite Disponível" valor={formatBRL(kpis.disponivel)} sub="Disponível para novas utilizações" icon={<ArrowDownToLine />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
          <KpiTile label="Total Amortizado" valor={formatBRL(kpis.amortizado)} sub={fDe || fAte ? "No período filtrado" : "Em todo o histórico"} icon={<ArrowUpFromLine />} cor="sky" valorClass="text-emerald-600 dark:text-emerald-400" />
          <KpiTile label="Juros / Encargos" valor={formatBRL(kpis.juros)} sub="Acumulado" icon={<Percent />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" />
        </div>

        <div className="card-elevated space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            {algumFiltro && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={limparFiltros}><X className="mr-1 h-3 w-3" /> Limpar filtros</Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Filtro rotulo="Empresa">
              <Select value={fEmpresa} onValueChange={(v) => { setFEmpresa(v); setFConta(TODOS); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todas</SelectItem>
                  {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </Filtro>
            <Filtro rotulo="Banco / Instituição">
              <Select value={fBanco} onValueChange={(v) => { setFBanco(v); setFConta(TODOS); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos</SelectItem>
                  {[...new Set(contas.map((c) => c.banco_id))].map((id) => <SelectItem key={id} value={id}>{nomeBanco(id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Filtro>
            <Filtro rotulo="Conta">
              <Select value={fConta} onValueChange={setFConta}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todas</SelectItem>
                  {contasDoBancoFiltro.map((c) => <SelectItem key={c.id} value={c.id}>{c.numero} · {nomeBanco(c.banco_id)} · {c.conta}</SelectItem>)}
                </SelectContent>
              </Select>
            </Filtro>
            <Filtro rotulo="Data inicial"><Input type="date" className="h-8 text-xs" value={fDe} onChange={(e) => setFDe(e.target.value)} /></Filtro>
            <Filtro rotulo="Data final"><Input type="date" className="h-8 text-xs" value={fAte} onChange={(e) => setFAte(e.target.value)} /></Filtro>
            <Filtro rotulo="Tipo de movimento">
              <Select value={fTipo} onValueChange={setFTipo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos</SelectItem>
                  {(Object.keys(ROTULO_TIPO) as TipoMovimento[]).map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Filtro>
            <Filtro rotulo="Status">
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos</SelectItem>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="encerrada">Encerrada</SelectItem>
                </SelectContent>
              </Select>
            </Filtro>
          </div>
        </div>

        <div className="card-elevated overflow-hidden">
          <div className="border-b px-4 py-3"><p className="text-sm font-semibold">Carteira de Contas Garantidas</p></div>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Limite</TableHead>
                  <TableHead className="text-right">Saldo Utilizado</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead>Utilização</TableHead>
                  <TableHead>Taxa</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={12} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!isLoading && resumosFiltrados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                      {contas.length === 0 ? "Nenhuma conta garantida cadastrada. Use “Nova Conta” para começar." : "Nenhuma conta nos filtros escolhidos."}
                    </TableCell>
                  </TableRow>
                )}
                {resumosFiltrados.map((r) => {
                  const dias = diasParaVencer(r.conta.vencimento);
                  return (
                    <TableRow key={r.conta.id} className={r.conta.status === "encerrada" ? "opacity-60" : undefined}>
                      <TableCell className="whitespace-nowrap text-xs font-semibold">{r.conta.numero}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{nomeEmpresa(r.conta.empresa_id)}</TableCell>
                      <TableCell>
                        <BancoBadge nome={nomeBanco(r.conta.banco_id)} logoUrl={urlLogoCartao(bancoPorId.get(r.conta.banco_id)?.logo_path)} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.conta.conta}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs font-semibold">{formatBRL(r.conta.limite)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs">{formatBRL(r.saldo)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">{formatBRL(r.disponivel)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${r.utilizacaoPct}%` }} /></div>
                          <span className="text-xs">{r.utilizacaoPct.toFixed(1).replace(".", ",")}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{r.conta.taxa || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {r.conta.vencimento ? data(r.conta.vencimento) : "—"}
                        {r.conta.status === "ativa" && dias !== null && dias <= 30 && (
                          <span className="ml-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">{dias <= 0 ? "vencida" : `${dias}d`}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.conta.status === "ativa" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>
                          {r.conta.status === "ativa" ? "Ativa" : "Encerrada"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <AcessoGate menu={MENU_CODIGO} acao="alterar">
                              <DropdownMenuItem onClick={() => abrirConta(r.conta)}>Editar conta</DropdownMenuItem>
                            </AcessoGate>
                            {r.conta.status === "ativa" && (
                              <AcessoGate menu={MENU_CODIGO} acao="incluir">
                                <DropdownMenuItem onClick={() => lancar("resgate", r.conta.id)}>Novo resgate</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => lancar("amortizacao", r.conta.id)}>Nova amortização</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => lancar("juros", r.conta.id)}>Lançar juros</DropdownMenuItem>
                              </AcessoGate>
                            )}
                            <DropdownMenuItem onClick={() => setFConta(r.conta.id)}>Filtrar movimentações</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        <Tabs defaultValue="fluxo">
          <TabsList className="grid h-auto max-w-xs grid-cols-2 gap-1 p-1">
            <TabsTrigger value="fluxo" className="flex items-center gap-2"><ListChecks className="h-4 w-4" /> Fluxo</TabsTrigger>
            <TabsTrigger value="graficos" className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Gráficos</TabsTrigger>
          </TabsList>

          <TabsContent value="fluxo" className="mt-4 flex flex-col gap-4">
            <div className="card-elevated overflow-hidden">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <p className="text-sm font-semibold">Movimentações Recentes</p>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate("/app/financeiro/gestao-financeira/fluxo-caixa")}>
                  Ver no Fluxo de Caixa
                </Button>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Conta</TableHead>
                      <TableHead>Movimento</TableHead>
                      <TableHead>Histórico</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Saldo após movimento</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movFiltrados.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma movimentação encontrada.</TableCell></TableRow>
                    )}
                    {movFiltrados.slice(0, limite).map((m) => {
                      const conta = contaPorId.get(m.conta_garantida_id);
                      const estornado = !!m.cancelado_em;
                      const historico = [m.classificacao_id ? nomeClassificacao.get(m.classificacao_id) : null, m.observacao].filter(Boolean).join(" · ");
                      return (
                        <TableRow key={m.id} className={estornado ? "text-muted-foreground" : undefined}>
                          <TableCell className="whitespace-nowrap text-xs">{data(m.data_movimento)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-medium">
                            {conta?.numero ?? "—"}
                            <span className="block text-[10px] font-normal text-muted-foreground">{conta ? `${nomeBanco(conta.banco_id)} · ${conta.conta}` : ""}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={ESTILO_TIPO[m.tipo]}>{ROTULO_TIPO[m.tipo]}</Badge>
                            {m.historico && <Badge variant="outline" className="ml-1 text-muted-foreground" title="Já está no Fluxo de Caixa (carga do passado)">Histórico</Badge>}
                            {estornado && <Badge variant="outline" className="ml-1 border-red-500/40 text-red-600" title={m.motivo_cancelamento ?? undefined}>Estornado</Badge>}
                          </TableCell>
                          <TableCell className="max-w-[380px] truncate text-xs" title={historico || undefined}>{historico || "—"}</TableCell>
                          <TableCell className={`whitespace-nowrap text-right text-xs ${estornado ? "line-through" : ""}`}>{formatBRL(m.valor)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs font-semibold">{m.saldoApos === null ? "—" : formatBRL(m.saldoApos)}</TableCell>
                          <TableCell>
                            {!estornado && (
                              <AcessoGate menu={MENU_CODIGO} acao="excluir">
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Estornar lançamento" onClick={() => { setMotivo(""); setAEstornar(m); }}>
                                  <Undo2 className="h-3.5 w-3.5" />
                                </Button>
                              </AcessoGate>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {movFiltrados.length > limite && (
                <div className="border-t p-2 text-center">
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => setLimite((l) => l + PAGINA)}>
                    Mostrar mais ({movFiltrados.length - limite} restantes)
                  </Button>
                </div>
              )}
            </div>

            <div className="card-elevated order-first p-4">
              <p className="mb-3 text-sm font-semibold">Utilização por Conta</p>
              {ativasFiltradas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sem contas ativas nos filtros.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {ativasFiltradas.map((r) => {
                    const dias = diasParaVencer(r.conta.vencimento);
                    const ultimo = ultimoMovimento.get(r.conta.id);
                    const cor = r.utilizacaoPct >= 90 ? "bg-red-500" : r.utilizacaoPct >= 70 ? "bg-amber-500" : "bg-primary";
                    return (
                      <div key={r.conta.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <BancoBadge nome={nomeBanco(r.conta.banco_id)} logoUrl={urlLogoCartao(bancoPorId.get(r.conta.banco_id)?.logo_path)} />
                            <p className="mt-1 truncate text-[11px] text-muted-foreground">{r.conta.numero} · {r.conta.conta} · {nomeEmpresa(r.conta.empresa_id)}</p>
                          </div>
                          <span className="text-xl font-bold leading-none">{r.utilizacaoPct.toFixed(1).replace(".", ",")}%</span>
                        </div>
                        <div className="my-3 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${cor}`} style={{ width: `${r.utilizacaoPct}%` }} /></div>
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div><p className="text-muted-foreground">Limite</p><p className="font-semibold">{formatBRL(r.conta.limite)}</p></div>
                          <div><p className="text-muted-foreground">Utilizado</p><p className="font-semibold text-red-600 dark:text-red-400">{formatBRL(r.saldo)}</p></div>
                          <div><p className="text-muted-foreground">Disponível</p><p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatBRL(r.disponivel)}</p></div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-t pt-2 text-[10px] text-muted-foreground">
                          <span>{r.conta.taxa || "Taxa não informada"}</span>
                          <span>
                            {r.conta.vencimento ? `Vence em ${data(r.conta.vencimento)}${dias !== null && dias <= 30 ? (dias <= 0 ? " (vencida)" : ` (${dias}d)`) : ""}` : "Sem vencimento"}
                          </span>
                          <span>{ultimo ? `Último movimento: ${data(ultimo)}` : "Sem movimentos"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="graficos" className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card-elevated p-4">
              <p className="text-sm font-semibold">Utilização do Limite por Banco</p>
              <p className="mb-2 text-[11px] text-muted-foreground">Saldo devedor e limite disponível por instituição</p>
              {dadosBancos.length === 0 ? <Vazio /> : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={dadosBancos} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="banco" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compacto} />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="utilizado" name="Saldo utilizado" fill="#ff7139" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="disponivel" name="Limite disponível" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card-elevated p-4">
              <p className="text-sm font-semibold">Distribuição da Dívida por Banco</p>
              <p className="mb-2 text-[11px] text-muted-foreground">Participação de cada banco no saldo utilizado</p>
              {dadosDonut.length === 0 ? <Vazio texto="Sem saldo devedor nas contas filtradas." /> : (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={dadosDonut} dataKey="valor" nameKey="banco" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {dadosDonut.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(nome: string, p: any) => `${nome} · ${dividaTotal ? ((p.payload.valor / dividaTotal) * 100).toFixed(1).replace(".", ",") : 0}%`} />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card-elevated p-4">
              <p className="text-sm font-semibold">Resgates e Amortizações por Mês</p>
              <p className="mb-2 text-[11px] text-muted-foreground">Movimentações registradas, sem as estornadas</p>
              {dadosMeses.length === 0 ? <Vazio /> : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={dadosMeses} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compacto} />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="resgates" name="Resgates" fill="#ff7139" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="amortizacoes" name="Amortizações" fill="#0f3268" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card-elevated p-4">
              <p className="text-sm font-semibold">Limite Contratado vs. Saldo Utilizado</p>
              <p className="mb-2 text-[11px] text-muted-foreground">Comparação por conta garantida</p>
              {dadosContas.length === 0 ? <Vazio /> : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={dadosContas} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="nome" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compacto} />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="limite" name="Limite contratado" fill="#bed2ed" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="utilizado" name="Saldo utilizado" fill="#0f3268" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <ContaDialog
          open={contaAberta}
          onClose={() => setContaAberta(false)}
          conta={contaEditando}
          saldo={saldoDaContaEditada}
          temMovimentos={movimentosDaContaEditada > 0}
        />
        <LancamentoDialog
          tipo={lancando}
          onClose={() => setLancando(null)}
          contas={contasAtivasParaLancar}
          movimentos={movimentos}
          nomeBanco={nomeBanco}
          nomeEmpresa={nomeEmpresa}
          contaInicialId={contaDoLancamento}
        />

        <Dialog open={!!aEstornar} onOpenChange={(o) => !o && setAEstornar(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Estornar lançamento</DialogTitle>
              <DialogDescription>
                {aEstornar ? `${aEstornar.numero} — ${ROTULO_TIPO[aEstornar.tipo]} de ${formatBRL(aEstornar.valor)} em ${data(aEstornar.data_movimento)}. ` : ""}
                O lançamento deixa de contar no saldo da conta e sai do Fluxo de Caixa; ele continua listado aqui como estornado, com o motivo.
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label className="text-xs">Motivo do estorno *</Label>
              <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} placeholder="Ex.: lançado com valor errado" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAEstornar(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={confirmarEstorno} disabled={estornar.isPending}>{estornar.isPending ? "Estornando…" : "Estornar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AcessoGate>
  );
}

function Filtro({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold">{rotulo}</Label>
      {children}
    </div>
  );
}

function Vazio({ texto = "Nenhum dado para os filtros selecionados." }: { texto?: string }) {
  return <p className="flex h-[230px] items-center justify-center text-sm text-muted-foreground">{texto}</p>;
}
