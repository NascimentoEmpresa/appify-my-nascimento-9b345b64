import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { CreditCard, Calendar, TrendingDown, PieChart, Plus, Pencil, X, Settings, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { usePermissoes } from "@/context/PermissoesContext";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { BandeiraBadge } from "@/components/financeiro/BandeiraBadge";
import { useFluxoCaixaMalote } from "@/hooks/useFluxoCaixaMalote";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useTiposFormaPagamento } from "@/hooks/useMaloteFormaPagamento";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import {
  useCartoesCredito,
  useSalvarCartaoCredito,
  useExcluirCartaoCredito,
  useCartaoBancos,
  useSalvarCartaoBanco,
  useAtualizarStatusCartaoBanco,
  useCartaoBandeiras,
  useSalvarCartaoBandeira,
  useAtualizarStatusCartaoBandeira,
  calcularFatura,
  urlLogoCartao,
  CartaoCatalogoItem,
  CartaoCredito as CartaoCreditoRow,
} from "@/hooks/useMaloteCartaoCredito";

interface FormState {
  id?: string;
  nomeCartao: string;
  tipoFormaPagamento: string;
  empresaId: string;
  bancoId: string;
  bandeiraId: string;
  diaFechamento: string;
  diaVencimento: string;
  limite: string;
  ativo: boolean;
}

const VAZIO: FormState = {
  nomeCartao: "",
  tipoFormaPagamento: "",
  empresaId: "",
  bancoId: "",
  bandeiraId: "",
  diaFechamento: "",
  diaVencimento: "",
  limite: "",
  ativo: true,
};

function paraFormState(c: CartaoCreditoRow): FormState {
  return {
    id: c.id,
    nomeCartao: c.nome_cartao,
    tipoFormaPagamento: c.tipo_forma_pagamento,
    empresaId: c.empresa_id,
    bancoId: c.banco_id,
    bandeiraId: c.bandeira_id,
    diaFechamento: String(c.dia_fechamento),
    diaVencimento: String(c.dia_vencimento),
    limite: String(c.limite),
    ativo: c.ativo,
  };
}

const DIAS_MES = Array.from({ length: 31 }, (_, i) => i + 1);

function mesAtualISO() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

// Próxima ocorrência do dia de vencimento a partir de hoje (se já passou
// neste mês, projeta pro mês seguinte) — pra virar a data mostrada no KPI
// "Próximo Vencimento".
function proximaOcorrencia(dia: number): Date {
  const hoje = new Date();
  const candidato = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
  if (candidato < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) {
    candidato.setMonth(candidato.getMonth() + 1);
  }
  return candidato;
}

// Exclusão de verdade (não "inativar") — mesmo padrão de "burocracia
// proposital" já usado em ExcluirPermanentementeButton.tsx (Malote):
// digitar o nome do cartão de novo pra confirmar, sem volta. Diferente
// daquele botão (que é só pra dado de teste, restrito ao Administrador
// Geral), aqui qualquer usuário com a ação "excluir" do menu Cartão de
// Crédito pode usar — mas a barreira de digitar o nome continua, pra não
// ser 1 clique só.
function BotaoExcluirCartao({ cartao }: { cartao: CartaoCreditoRow }) {
  const excluir = useExcluirCartaoCredito();
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState("");

  async function handleExcluir() {
    try {
      await excluir.mutateAsync(cartao.id);
      toast.success("Cartão excluído.");
      setAberto(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir cartão.");
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive"
        onClick={() => {
          setConfirmacao("");
          setAberto(true);
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      <AlertDialog open={aberto} onOpenChange={setAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{cartao.nome_cartao}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga o cadastro do cartão de forma definitiva — não tem como desfazer. As despesas do Malote já
              pagas nessa forma de pagamento continuam existindo, só deixam de aparecer vinculadas a este cartão.
              Digite <span className="font-mono font-semibold text-foreground">{cartao.nome_cartao}</span> pra confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div>
            <Label className="text-xs">Confirmação</Label>
            <Input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoFocus />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluir.isPending}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={confirmacao !== cartao.nome_cartao || excluir.isPending}
              onClick={handleExcluir}
            >
              {excluir.isPending ? "Excluindo..." : "Excluir"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Uma aba do dialog "Gerenciar Bancos e Bandeiras" — lista + formulário de
// adicionar, reaproveitado pra bancos e bandeiras (mesma forma de dado:
// nome + logo opcional + ativo). Mesmo padrão de upload de
// IdentidadeTab.tsx (src/pages/admin/tabs/IdentidadeTab.tsx), mas com
// bucket público (getPublicUrl em vez de createSignedUrl).
function AbaCatalogo({
  itens,
  onAdicionar,
  onAtivarInativar,
  salvando,
}: {
  itens: CartaoCatalogoItem[];
  onAdicionar: (nome: string, arquivo: File | null) => Promise<void>;
  onAtivarInativar: (id: string, ativo: boolean) => void;
  salvando: boolean;
}) {
  const [nome, setNome] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);

  async function adicionar() {
    if (!nome.trim()) return toast.error("Informe o nome.");
    await onAdicionar(nome, arquivo);
    setNome("");
    setArquivo(null);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Banrisul" />
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-xs hover:bg-secondary">
            <Upload className="h-3.5 w-3.5" /> {arquivo ? arquivo.name.slice(0, 16) : "Logo (opcional)"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button size="sm" onClick={adicionar} disabled={salvando}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-border divide-y divide-border max-h-72 overflow-y-auto">
        {itens.length === 0 && <p className="p-3 text-xs text-muted-foreground">Nada cadastrado ainda.</p>}
        {itens.map((item) => (
          <div key={item.id} className="flex items-center justify-between px-3 py-2">
            <BancoBadge nome={item.nome} logoUrl={urlLogoCartao(item.logo_path)} />
            <div className="flex items-center gap-2">
              {item.ativo ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
              <Button variant="ghost" size="sm" onClick={() => onAtivarInativar(item.id, !item.ativo)}>
                {item.ativo ? "Inativar" : "Ativar"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// SIS-2026-0224: Submódulo Cartão de Crédito (Financeiro > Gestão
// Financeira), abaixo de Fluxo de Caixa — conferência de faturas dos
// cartões corporativos. "Nome no Malote (Tipo)" liga o cartão a um valor
// de malote_tipo_forma_pagamento (o mesmo catálogo usado em Criar Despesa
// pro campo "Forma de pagamento") — é isso que casa os lançamentos pagos
// no Malote com o cartão certo, sem heurística de texto. Banco/Bandeira
// são catálogos próprios (malote_cartao_banco/malote_cartao_bandeira),
// geridos dentro desta mesma tela — dropdown fechado, sem texto livre.
export default function CartaoCredito() {
  const { can } = usePermissoes();
  const podeExcluir = can("excluir", "financeiro", "financeiro-cartao-credito");
  const { data: cartoes = [], isLoading } = useCartoesCredito();
  const { data: lancamentos = [] } = useFluxoCaixaMalote();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: tiposFormaPagamento = [] } = useTiposFormaPagamento();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: bandeiras = [] } = useCartaoBandeiras();
  const salvar = useSalvarCartaoCredito();
  const salvarBanco = useSalvarCartaoBanco();
  const statusBanco = useAtualizarStatusCartaoBanco();
  const salvarBandeira = useSalvarCartaoBandeira();
  const statusBandeira = useAtualizarStatusCartaoBandeira();

  const tiposAtivos = useMemo(() => tiposFormaPagamento.filter((t) => t.ativo), [tiposFormaPagamento]);
  const opcoesTipo = useMemo(
    () => tiposAtivos.map((t) => ({ value: t.nome, label: t.nome })),
    [tiposAtivos]
  );

  const bancosAtivos = useMemo(() => bancos.filter((b) => b.ativo), [bancos]);
  const bandeirasAtivas = useMemo(() => bandeiras.filter((b) => b.ativo), [bandeiras]);
  const bancosPorId = useMemo(() => new Map(bancos.map((b) => [b.id, b])), [bancos]);
  const bandeirasPorId = useMemo(() => new Map(bandeiras.map((b) => [b.id, b])), [bandeiras]);
  const opcoesBanco = useMemo(() => bancosAtivos.map((b) => ({ value: b.id, label: b.nome })), [bancosAtivos]);
  const opcoesBandeira = useMemo(() => bandeirasAtivas.map((b) => ({ value: b.id, label: b.nome })), [bandeirasAtivas]);

  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<FormState | null>(null);
  const [openCatalogo, setOpenCatalogo] = useState(false);

  const [competencia, setCompetencia] = useState(mesAtualISO());
  const [filtroCartaoId, setFiltroCartaoId] = useState("");
  const [filtroEmpresaId, setFiltroEmpresaId] = useState("");
  const [filtroBancoId, setFiltroBancoId] = useState("");
  const [filtroBandeiraId, setFiltroBandeiraId] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  // SIS-2026-0254 (Iury): filtro de Data, dentro do mesmo card de Filtros
  // dos demais — reflete em "Cartões de Crédito Cadastrados" e em
  // "Lançamentos recebidos do Fluxo de Caixa".
  const [lancamentosDataDe, setLancamentosDataDe] = useState("");
  const [lancamentosDataAte, setLancamentosDataAte] = useState("");

  const empresasPorId = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);

  // Utilizado (soma de tudo que já foi pago via aquele cartão no Malote,
  // sem controle de quitação de fatura — decisão explícita desta rodada)
  // e Fatura do Mês (só a competência selecionada), por cartão.
  function calcularUtilizadoEFatura(cartao: CartaoCreditoRow) {
    const doCartao = lancamentos.filter((l) => l.forma_pagamento === cartao.tipo_forma_pagamento);
    const utilizado = doCartao.reduce((s, l) => s + Number(l.valor), 0);
    const faturaMes = doCartao
      .filter((l) => l.data_pagamento && calcularFatura(l.data_pagamento, cartao.dia_fechamento) === competencia)
      .reduce((s, l) => s + Number(l.valor), 0);
    return { utilizado, faturaMes };
  }

  const cartoesFiltrados = useMemo(() => {
    return cartoes.filter((c) => {
      if (filtroCartaoId && c.id !== filtroCartaoId) return false;
      if (filtroEmpresaId && c.empresa_id !== filtroEmpresaId) return false;
      if (filtroBancoId && c.banco_id !== filtroBancoId) return false;
      if (filtroBandeiraId && c.bandeira_id !== filtroBandeiraId) return false;
      if (filtroStatus === "ativo" && !c.ativo) return false;
      if (filtroStatus === "inativo" && c.ativo) return false;
      return true;
    });
  }, [cartoes, filtroCartaoId, filtroEmpresaId, filtroBancoId, filtroBandeiraId, filtroStatus]);

  function limparFiltros() {
    setFiltroCartaoId("");
    setFiltroEmpresaId("");
    setFiltroBancoId("");
    setFiltroBandeiraId("");
    setFiltroStatus("");
    setLancamentosDataDe("");
    setLancamentosDataAte("");
  }

  const cartoesAtivos = useMemo(() => cartoes.filter((c) => c.ativo), [cartoes]);

  const kpiFaturaTotalMes = useMemo(
    () => cartoesFiltrados.reduce((s, c) => s + calcularUtilizadoEFatura(c).faturaMes, 0),
    [cartoesFiltrados, lancamentos, competencia]
  );
  const kpiLimiteUtilizado = useMemo(
    () => cartoesAtivos.reduce((s, c) => s + calcularUtilizadoEFatura(c).utilizado, 0),
    [cartoesAtivos, lancamentos]
  );
  const kpiProximoVencimento = useMemo(() => {
    if (cartoesAtivos.length === 0) return null;
    return cartoesAtivos
      .map((c) => proximaOcorrencia(c.dia_vencimento))
      .sort((a, b) => a.getTime() - b.getTime())[0];
  }, [cartoesAtivos]);

  // Só entram lançamentos cuja forma de pagamento bate com um cartão já
  // cadastrado (ativo ou não, pra não sumir histórico de cartão inativado).
  const tiposCadastrados = useMemo(() => new Map(cartoes.map((c) => [c.tipo_forma_pagamento, c.nome_cartao])), [cartoes]);
  // SIS-2026-0254 (Iury): resolve o cartão de cada lançamento a partir da
  // forma de pagamento — usado pra aplicar os filtros de Cartão/Banco/
  // Bandeira/Status (que não existem direto no lançamento) na tabela de
  // Lançamentos, do mesmo jeito que já valem pra tabela de Cartões.
  const cartaoPorTipoFormaPagamento = useMemo(() => new Map(cartoes.map((c) => [c.tipo_forma_pagamento, c])), [cartoes]);
  // SIS-2026-0254 (Iury): "a div de Filtros não está conectada com
  // Lançamentos" — todos os filtros do card acima (Competência, Cartão,
  // Empresa, Banco, Bandeira, Status, Data) agora valem também aqui, não só
  // pra "Cartões de Crédito Cadastrados".
  const lancamentosDeCartao = useMemo(
    () =>
      lancamentos.filter((l) => {
        if (!l.forma_pagamento || !tiposCadastrados.has(l.forma_pagamento)) return false;
        const cartaoDoLancamento = cartaoPorTipoFormaPagamento.get(l.forma_pagamento);
        if (competencia && l.competencia !== competencia) return false;
        if (filtroCartaoId && cartaoDoLancamento?.id !== filtroCartaoId) return false;
        if (filtroEmpresaId && l.empresa_id !== filtroEmpresaId) return false;
        if (filtroBancoId && cartaoDoLancamento?.banco_id !== filtroBancoId) return false;
        if (filtroBandeiraId && cartaoDoLancamento?.bandeira_id !== filtroBandeiraId) return false;
        if (filtroStatus === "ativo" && !cartaoDoLancamento?.ativo) return false;
        if (filtroStatus === "inativo" && cartaoDoLancamento?.ativo) return false;
        if (lancamentosDataDe && (!l.data_pagamento || l.data_pagamento < lancamentosDataDe)) return false;
        if (lancamentosDataAte && (!l.data_pagamento || l.data_pagamento > lancamentosDataAte)) return false;
        return true;
      }),
    [
      lancamentos,
      tiposCadastrados,
      cartaoPorTipoFormaPagamento,
      competencia,
      filtroCartaoId,
      filtroEmpresaId,
      filtroBancoId,
      filtroBandeiraId,
      filtroStatus,
      lancamentosDataDe,
      lancamentosDataAte,
    ]
  );

  function abrirNovo() {
    setEditando({ ...VAZIO });
    setOpen(true);
  }

  function abrirEditar(c: CartaoCreditoRow) {
    setEditando(paraFormState(c));
    setOpen(true);
  }

  async function handleSalvar() {
    if (!editando) return;
    if (!editando.nomeCartao.trim()) return toast.error("Informe o nome do cartão.");
    if (!editando.tipoFormaPagamento) return toast.error("Selecione o Nome no Malote (Tipo).");
    if (!editando.empresaId) return toast.error("Selecione a empresa.");
    if (!editando.bancoId) return toast.error("Selecione o banco.");
    if (!editando.bandeiraId) return toast.error("Selecione a bandeira.");
    if (!editando.diaFechamento) return toast.error("Selecione o dia de fechamento.");
    if (!editando.diaVencimento) return toast.error("Selecione o dia de vencimento.");
    const limite = Number(editando.limite.replace(",", "."));
    if (!editando.limite || !Number.isFinite(limite) || limite < 0) return toast.error("Informe um limite válido.");

    // Regra 4 do Anexo 1: não permitir dois cartões ATIVOS com a mesma
    // combinação Empresa + Nome no Malote (Tipo) — mesma checagem do
    // índice único do banco, feita aqui antes pra dar um erro amigável.
    if (editando.ativo) {
      const duplicado = cartoes.some(
        (c) =>
          c.id !== editando.id &&
          c.ativo &&
          c.empresa_id === editando.empresaId &&
          c.tipo_forma_pagamento === editando.tipoFormaPagamento
      );
      if (duplicado) {
        toast.error("Já existe um cartão ativo com essa mesma Empresa + Nome no Malote.");
        return;
      }
    }

    try {
      await salvar.mutateAsync({
        id: editando.id,
        nome_cartao: editando.nomeCartao,
        tipo_forma_pagamento: editando.tipoFormaPagamento,
        empresa_id: editando.empresaId,
        banco_id: editando.bancoId,
        bandeira_id: editando.bandeiraId,
        dia_fechamento: Number(editando.diaFechamento),
        dia_vencimento: Number(editando.diaVencimento),
        limite,
        ativo: editando.ativo,
      });
      toast.success("Cartão salvo.");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar cartão.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Cartão de Crédito"
        subtitle="Controle e acompanhamento dos cartões de crédito cadastrados e faturas por mês."
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Cartão de Crédito"]}
        actions={
          <>
            <Button variant="outline" onClick={() => setOpenCatalogo(true)}>
              <Settings className="h-4 w-4 mr-2" />
              Gerenciar Bancos e Bandeiras
            </Button>
            <Button onClick={abrirNovo}>
              <Plus className="h-4 w-4 mr-2" />
              Cadastrar Cartão
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile
          label="Fatura Total do Mês"
          valor={formatBRL(kpiFaturaTotalMes)}
          icon={<TrendingDown />}
          cor="red"
          valorClass="text-red-600 dark:text-red-400"
        />
        <KpiTile label="Cartões Ativos" valor={String(cartoesAtivos.length)} icon={<CreditCard />} cor="emerald" />
        <KpiTile
          label="Próximo Vencimento"
          valor={kpiProximoVencimento ? kpiProximoVencimento.toLocaleDateString("pt-BR") : "—"}
          icon={<Calendar />}
          cor="sky"
        />
        <KpiTile
          label="Limite Utilizado"
          valor={formatBRL(kpiLimiteUtilizado)}
          icon={<PieChart />}
          cor="amber"
          valorClass="text-amber-600 dark:text-amber-400"
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <Label className="text-xs">Competência</Label>
              <Input type="month" className="h-8 text-xs" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Cartão de Crédito</Label>
              <Select value={filtroCartaoId || "todos"} onValueChange={(v) => setFiltroCartaoId(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {cartoes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome_cartao}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={filtroEmpresaId || "todas"} onValueChange={(v) => setFiltroEmpresaId(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Banco</Label>
              <Select value={filtroBancoId || "todos"} onValueChange={(v) => setFiltroBancoId(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {bancos.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Bandeira</Label>
              <Select value={filtroBandeiraId || "todas"} onValueChange={(v) => setFiltroBandeiraId(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {bandeiras.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus || "todos"} onValueChange={(v) => setFiltroStatus(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* SIS-2026-0254 (Iury): filtro de Data movido pra dentro deste
                card — junto com os demais, reflete tanto em "Cartões de
                Crédito Cadastrados" quanto em "Lançamentos recebidos do
                Fluxo de Caixa" abaixo (antes só existia dentro da div de
                Lançamentos, desconectado do resto). */}
            <DateRangeFilter
              label="Data"
              de={lancamentosDataDe}
              ate={lancamentosDataAte}
              onChange={(de, ate) => { setLancamentosDataDe(de); setLancamentosDataAte(ate); }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cartões de Crédito Cadastrados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cartão</TableHead>
                <TableHead>Nome no Malote</TableHead>
                <TableHead className="text-center">Empresa</TableHead>
                <TableHead className="text-center">Banco</TableHead>
                <TableHead className="text-center">Bandeira</TableHead>
                <TableHead className="text-center">Fechamento</TableHead>
                <TableHead className="text-center">Vencimento</TableHead>
                <TableHead className="text-right">Limite</TableHead>
                <TableHead className="text-right">Utilizado</TableHead>
                <TableHead className="text-right">Fatura do Mês</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">Carregando...</TableCell>
                </TableRow>
              )}
              {!isLoading && cartoesFiltrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    {cartoes.length === 0 ? "Nenhum cartão cadastrado ainda." : "Nenhum cartão encontrado com esse filtro."}
                  </TableCell>
                </TableRow>
              )}
              {cartoesFiltrados.map((c) => {
                const { utilizado, faturaMes } = calcularUtilizadoEFatura(c);
                const banco = bancosPorId.get(c.banco_id);
                const bandeira = bandeirasPorId.get(c.bandeira_id);
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nome_cartao}</TableCell>
                    <TableCell className="text-sm">{c.tipo_forma_pagamento}</TableCell>
                    <TableCell className="text-sm text-center">{empresasPorId.get(c.empresa_id) ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      {banco ? (
                        <div className="flex justify-center">
                          <BancoBadge nome={banco.nome} logoUrl={urlLogoCartao(banco.logo_path)} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {bandeira ? (
                        <div className="flex justify-center">
                          <BandeiraBadge nome={bandeira.nome} logoUrl={urlLogoCartao(bandeira.logo_path)} />
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-center">Dia {c.dia_fechamento}</TableCell>
                    <TableCell className="text-sm text-center">Dia {c.dia_vencimento}</TableCell>
                    <TableCell className="text-right text-sm">{formatBRL(c.limite)}</TableCell>
                    <TableCell className="text-right text-sm">{formatBRL(utilizado)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatBRL(faturaMes)}</TableCell>
                    <TableCell className="text-center">
                      {c.ativo ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => abrirEditar(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {podeExcluir && <BotaoExcluirCartao cartao={c} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lançamentos recebidos do Fluxo de Caixa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <p className="text-xs text-muted-foreground -mt-1">
            Lançamentos conforme os pagamentos em cartões de crédito recebidos no Fluxo de Caixa. Respeita os
            filtros do card acima.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Competência</TableHead>
                {/* SIS-2026-0254 (Iury): "poderia vir após Competência". */}
                <TableHead>Parcela</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Cartão Vinculado</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lancamentosDeCartao.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    Nenhum lançamento em cartão de crédito ainda.
                  </TableCell>
                </TableRow>
              )}
              {lancamentosDeCartao.map((l) => (
                // SIS-2026-0254: despesa parcelada agora pode gerar mais de
                // 1 linha (1 por parcela paga) com o mesmo despesa_id —
                // key precisa incluir o número da parcela.
                <TableRow key={`${l.despesa_id}-${l.numero_parcela ?? "unica"}`}>
                  <TableCell className="font-mono text-xs">{l.id_malote}</TableCell>
                  <TableCell className="text-sm">{l.data_pagamento ? new Date(l.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                  <TableCell className="text-sm">{l.competencia ? new Date(l.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {l.numero_parcela ? `${l.numero_parcela}/${l.numero_parcelas}` : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">{l.empresa_nome ?? "—"}</TableCell>
                  <TableCell className="text-sm">{l.contrato_nome ?? "—"}</TableCell>
                  <TableCell className="text-sm">{l.classificacao_nome ?? "—"}</TableCell>
                  <TableCell className="text-sm">{l.descricao}</TableCell>
                  <TableCell className="text-sm">{tiposCadastrados.get(l.forma_pagamento!) ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{formatBRL(l.valor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar Cartão" : "Cadastrar Cartão de Crédito"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome do Cartão <span className="text-destructive">*</span></Label>
              <Input
                value={editando?.nomeCartao ?? ""}
                onChange={(e) => setEditando((v) => (v ? { ...v, nomeCartao: e.target.value } : v))}
                placeholder="Ex: Cartão Corporativo HAGG"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome no Malote (Tipo) <span className="text-destructive">*</span></Label>
                <SearchableSelect
                  value={editando?.tipoFormaPagamento ?? ""}
                  onChange={(v) => setEditando((s) => (s ? { ...s, tipoFormaPagamento: v } : s))}
                  options={opcoesTipo}
                  placeholder="Selecione o tipo..."
                  searchPlaceholder="Buscar tipo..."
                />
              </div>
              <div>
                <Label>Empresa <span className="text-destructive">*</span></Label>
                <Select
                  value={editando?.empresaId ?? ""}
                  onValueChange={(v) => setEditando((s) => (s ? { ...s, empresaId: v } : s))}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione a empresa..." /></SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Banco <span className="text-destructive">*</span></Label>
                <SearchableSelect
                  value={editando?.bancoId ?? ""}
                  onChange={(v) => setEditando((s) => (s ? { ...s, bancoId: v } : s))}
                  options={opcoesBanco}
                  placeholder="Selecione o banco..."
                  searchPlaceholder="Buscar banco..."
                />
                {editando?.bancoId && bancosPorId.get(editando.bancoId) && (
                  <div className="mt-1.5">
                    <BancoBadge
                      nome={bancosPorId.get(editando.bancoId)!.nome}
                      logoUrl={urlLogoCartao(bancosPorId.get(editando.bancoId)!.logo_path)}
                    />
                  </div>
                )}
              </div>
              <div>
                <Label>Bandeira <span className="text-destructive">*</span></Label>
                <SearchableSelect
                  value={editando?.bandeiraId ?? ""}
                  onChange={(v) => setEditando((s) => (s ? { ...s, bandeiraId: v } : s))}
                  options={opcoesBandeira}
                  placeholder="Selecione a bandeira..."
                  searchPlaceholder="Buscar bandeira..."
                />
                {editando?.bandeiraId && bandeirasPorId.get(editando.bandeiraId) && (
                  <div className="mt-1.5">
                    <BandeiraBadge
                      nome={bandeirasPorId.get(editando.bandeiraId)!.nome}
                      logoUrl={urlLogoCartao(bandeirasPorId.get(editando.bandeiraId)!.logo_path)}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fechamento <span className="text-destructive">*</span></Label>
                <Select
                  value={editando?.diaFechamento ?? ""}
                  onValueChange={(v) => setEditando((s) => (s ? { ...s, diaFechamento: v } : s))}
                >
                  <SelectTrigger><SelectValue placeholder="Dia..." /></SelectTrigger>
                  <SelectContent>
                    {DIAS_MES.map((d) => (
                      <SelectItem key={d} value={String(d)}>Dia {d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vencimento <span className="text-destructive">*</span></Label>
                <Select
                  value={editando?.diaVencimento ?? ""}
                  onValueChange={(v) => setEditando((s) => (s ? { ...s, diaVencimento: v } : s))}
                >
                  <SelectTrigger><SelectValue placeholder="Dia..." /></SelectTrigger>
                  <SelectContent>
                    {DIAS_MES.map((d) => (
                      <SelectItem key={d} value={String(d)}>Dia {d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Limite do Cartão <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="R$ 0,00"
                  value={editando?.limite ?? ""}
                  onChange={(e) => setEditando((v) => (v ? { ...v, limite: e.target.value } : v))}
                />
              </div>
              <div>
                <Label>Status <span className="text-destructive">*</span></Label>
                <Select
                  value={editando?.ativo ? "ativo" : "inativo"}
                  onValueChange={(v) => setEditando((s) => (s ? { ...s, ativo: v === "ativo" } : s))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSalvar} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openCatalogo} onOpenChange={setOpenCatalogo}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gerenciar Bancos e Bandeiras</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="bancos">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="bancos">Bancos</TabsTrigger>
              <TabsTrigger value="bandeiras">Bandeiras</TabsTrigger>
            </TabsList>
            <TabsContent value="bancos" className="mt-3">
              <AbaCatalogo
                itens={bancos}
                salvando={salvarBanco.isPending}
                onAdicionar={async (nome, arquivo) => {
                  try {
                    await salvarBanco.mutateAsync({ nome, arquivo });
                    toast.success("Banco adicionado.");
                  } catch (e: any) {
                    toast.error(e.message ?? "Erro ao adicionar banco.");
                  }
                }}
                onAtivarInativar={(id, ativo) => statusBanco.mutate({ id, ativo })}
              />
            </TabsContent>
            <TabsContent value="bandeiras" className="mt-3">
              <AbaCatalogo
                itens={bandeiras}
                salvando={salvarBandeira.isPending}
                onAdicionar={async (nome, arquivo) => {
                  try {
                    await salvarBandeira.mutateAsync({ nome, arquivo });
                    toast.success("Bandeira adicionada.");
                  } catch (e: any) {
                    toast.error(e.message ?? "Erro ao adicionar bandeira.");
                  }
                }}
                onAtivarInativar={(id, ativo) => statusBandeira.mutate({ id, ativo })}
              />
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCatalogo(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
