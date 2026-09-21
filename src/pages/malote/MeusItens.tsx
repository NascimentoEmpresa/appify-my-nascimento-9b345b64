import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableHeadOrdenavel } from "@/components/ui/table-head-ordenavel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Plus, ListChecks, Search, X, Trash2, RotateCcw } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  useMinhasDespesas,
  useContratosAtivos,
  useEmpresasGrupo,
  useEmpresaPrimeiraLinhaRateio,
  useDespesasLixeira,
  useRestaurarDespesa,
  MaloteDespesaRow,
  ItemLinhaMalote,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_FASE_SOLICITACAO,
  souLancadorDespesa,
  classificacaoTemLancadorConfigurado,
} from "@/hooks/useMaloteDespesa";
import { ExcluirPermanentementeButton } from "./ExcluirPermanentementeButton";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useOrdenacaoTabela } from "@/hooks/useOrdenacaoTabela";
import { useEstadoPersistido } from "@/hooks/useEstadoPersistido";
import { ordenarPor } from "@/lib/ordenarTabela";
import { JustificativaPendenteBadge } from "./JustificativaPendenteBadge";
import {
  CABECALHOS_EXCEL_MEUS_ITENS,
  aindaESolicitacao,
  aprovadoresPendentes,
  dataPagamentoDe,
  montarLinhasExcelMeusItens,
  nomeArquivoMeusItens,
  statusEfetivo,
  tipoLabelDe,
  valorDe,
} from "./meusItensUtils";

// SIS-2026-0316: colunas ordenáveis (clicar no cabeçalho, mesmo padrão do
// Windows Explorer). Ficam de fora as que não têm um valor único e
// comparável de forma útil: Parcela (composto X/Y), Aprovador pendente
// (lista/tooltip) e Justificativa (badge de estado, não dado ordenável).
type ColunaMeusItens =
  | "tipo"
  | "numero"
  | "data_pagamento"
  | "classificacao"
  | "nome"
  | "empresa"
  | "forma_pagamento"
  | "valor"
  | "status"
  | "excecao"
  | "atualizacao";

type ChipKey =
  | "todos"
  | "rascunho"
  | "aguardando_cotacao"
  | "cotacao_aprovada"
  | "pendente_n1"
  | "pendente_n2"
  | "pendente_n3"
  | "aguardando_pagamento"
  | "necessidade_de_ajuste"
  | "despesa_paga"
  | "despesa_reprovada";

const CHIPS: { key: ChipKey; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "rascunho", label: "Rascunho" },
  { key: "aguardando_cotacao", label: "Aguardando cotação" },
  { key: "cotacao_aprovada", label: "Cotação aprovada" },
  { key: "pendente_n1", label: "Pendente aprovação N1" },
  { key: "pendente_n2", label: "Pendente aprovação N2" },
  { key: "pendente_n3", label: "Pendente aprovação N3" },
  { key: "aguardando_pagamento", label: "Aguardando pagamento" },
  { key: "necessidade_de_ajuste", label: "Necessita de ajuste" },
  { key: "despesa_paga", label: "Despesa" },
  { key: "despesa_reprovada", label: "Despesa Reprovada" },
];

function itemMatchesChip(item: ItemLinhaMalote, chip: ChipKey): boolean {
  const status = statusEfetivo(item);
  switch (chip) {
    case "todos":
      return true;
    case "rascunho":
      return status === "rascunho";
    case "aguardando_cotacao":
      return status === "aguardando_cotacao" || status === "cotacao_realizada";
    case "cotacao_aprovada":
      return status === "cotacao_aprovada";
    case "pendente_n1":
      return status === "pendente_aprovacao" && item.despesa.nivel_aprovacao_atual === 1;
    case "pendente_n2":
      return status === "pendente_aprovacao" && item.despesa.nivel_aprovacao_atual === 2;
    case "pendente_n3":
      return status === "pendente_aprovacao" && item.despesa.nivel_aprovacao_atual === 3;
    case "aguardando_pagamento":
      return status === "aguardando_pagamento";
    case "necessidade_de_ajuste":
      return status === "necessidade_de_ajuste";
    case "despesa_paga":
      return status === "despesa_paga";
    case "despesa_reprovada":
      return status === "despesa_reprovada";
  }
}

function AprovadorPendenteCell({ despesa }: { despesa: MaloteDespesaRow }) {
  const nomes = aprovadoresPendentes(despesa);
  if (!nomes) return <span className="text-muted-foreground">—</span>;
  const label = nomes.length > 1 ? `${nomes[0]} +${nomes.length - 1}` : nomes[0];
  if (nomes.length === 1) return <span>{label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{nomes.join(", ")}</TooltipContent>
    </Tooltip>
  );
}

export default function MeusItens() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePermissoes();
  const { data: itens = [], isLoading } = useMinhasDespesas();
  // [SEM-CHAMADO] (achado do usuário): "Mover para a lixeira" só existia na
  // própria despesa, mas depois disso ela some de Meus Itens/Aprovações e
  // só reaparecia na Lixeira do Fluxo de Caixa (financeiro) — ninguém do
  // Malote deveria precisar ir até lá só pra terminar uma exclusão. Lixeira
  // própria aqui, mesmo padrão (Restaurar + Excluir permanentemente).
  const [lixeiraAberta, setLixeiraAberta] = useState(false);
  const podeVerLixeira = can("excluir", "malote", "malote_despesa_visualizar") || can("excluir", "malote", "malote_solicitacao_visualizar");
  const { data: despesasLixeira = [] } = useDespesasLixeira();
  const restaurarDespesa = useRestaurarDespesa();
  async function handleRestaurar(id: string) {
    try {
      await restaurarDespesa.mutateAsync(id);
      toast.success("Restaurado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao restaurar.");
    }
  }
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: empresas = [] } = useEmpresasGrupo();
  // SIS-2026-0288 (Iury, achado testando DM-2026-0180): coluna/filtro de
  // Empresa usava despesa.empresa_id direto — contexto de sessão de quem
  // lançou, não a empresa do rateio de verdade (mesmo ajuste já feito em
  // Aprovações e Pagamento Malote, pra não voltar a divergir entre telas).
  const despesaIdsTodos = useMemo(() => Array.from(new Set(itens.map((i) => i.despesa.id))), [itens]);
  const { data: empresaPrimeiraLinhaPorDespesa } = useEmpresaPrimeiraLinhaRateio(despesaIdsTodos);
  function empresaIdResolvida(despesa: MaloteDespesaRow): string | null {
    return empresaPrimeiraLinhaPorDespesa?.get(despesa.id) ?? despesa.empresa_id ?? null;
  }

  // SIS-2026-0350 (Cálita): aba, chip e filtros persistem no sessionStorage
  // pra sobreviver ao entrar numa despesa e voltar.
  const F = "malote_meus_itens";
  const [tab, setTab] = useEstadoPersistido<"todos" | "solicitacoes" | "despesas">(F, "tab", "todos");
  const [chip, setChip] = useEstadoPersistido<ChipKey>(F, "chip", "todos");
  // SIS-2026-0285 (Iury): só existia período por Data de pagamento — agora
  // tem também Última atualização, os dois independentes (E lógico).
  const [periodoInicio, setPeriodoInicio] = useEstadoPersistido(F, "periodoInicio", "");
  const [periodoFim, setPeriodoFim] = useEstadoPersistido(F, "periodoFim", "");
  const [dataAtualizacaoDe, setDataAtualizacaoDe] = useEstadoPersistido(F, "dataAtualizacaoDe", "");
  const [dataAtualizacaoAte, setDataAtualizacaoAte] = useEstadoPersistido(F, "dataAtualizacaoAte", "");
  const [classificacaoId, setClassificacaoId] = useEstadoPersistido(F, "classificacaoId", "");
  const [empresaId, setEmpresaId] = useEstadoPersistido(F, "empresaId", "");
  const [excecao, setExcecao] = useEstadoPersistido<"todos" | "sim" | "nao">(F, "excecao", "todos");
  const [busca, setBusca] = useEstadoPersistido(F, "busca", "");
  const ordenacao = useOrdenacaoTabela<ColunaMeusItens>();

  // SIS-2026-0323 (Iury): os chips contavam sempre em cima de `itens` cru
  // — mudar a aba (Solicitações/Despesas) ou um filtro do painel (Empresa,
  // Classificação, Exceção, período, busca) não refletia nos números dos
  // chips, só na tabela. Mesmo predicado de `filtrados`, sem o próprio
  // `chip` (cada chip representa um valor dele mesmo — incluí-lo zeraria
  // os demais ao selecionar um).
  const itensComFiltrosDoPainel = useMemo(() => {
    return itens.filter((item) => {
      const { despesa, parcela } = item;
      if (tab === "solicitacoes" && !aindaESolicitacao(despesa)) return false;
      if (tab === "despesas" && aindaESolicitacao(despesa)) return false;
      if (classificacaoId && despesa.classificacao_id !== classificacaoId) return false;
      if (empresaId && empresaIdResolvida(despesa) !== empresaId) return false;
      if (excecao === "sim" && !despesa.excecao) return false;
      if (excecao === "nao" && despesa.excecao) return false;
      const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
      if (periodoInicio && (!dataPagamento || dataPagamento < periodoInicio)) return false;
      if (periodoFim && (!dataPagamento || dataPagamento > periodoFim)) return false;
      if (dataAtualizacaoDe && despesa.updated_at < dataAtualizacaoDe) return false;
      if (dataAtualizacaoAte && despesa.updated_at > dataAtualizacaoAte + "T23:59:59") return false;
      if (busca.trim()) {
        const alvo = `${despesa.numero} ${despesa.nome}`.toLowerCase();
        if (!alvo.includes(busca.trim().toLowerCase())) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, tab, classificacaoId, empresaId, empresaPrimeiraLinhaPorDespesa, excecao, periodoInicio, periodoFim, dataAtualizacaoDe, dataAtualizacaoAte, busca]);

  const contagens = useMemo(() => {
    const map: Record<ChipKey, number> = {
      todos: 0,
      rascunho: 0,
      aguardando_cotacao: 0,
      cotacao_aprovada: 0,
      pendente_n1: 0,
      pendente_n2: 0,
      pendente_n3: 0,
      aguardando_pagamento: 0,
      necessidade_de_ajuste: 0,
      despesa_paga: 0,
      despesa_reprovada: 0,
    };
    for (const item of itensComFiltrosDoPainel) {
      for (const c of CHIPS) {
        if (itemMatchesChip(item, c.key)) map[c.key]++;
      }
    }
    return map;
  }, [itensComFiltrosDoPainel]);

  const filtrados = useMemo(() => {
    return itens.filter((item) => {
      const { despesa, parcela } = item;
      if (tab === "solicitacoes" && !aindaESolicitacao(despesa)) return false;
      if (tab === "despesas" && aindaESolicitacao(despesa)) return false;
      if (!itemMatchesChip(item, chip)) return false;
      if (classificacaoId && despesa.classificacao_id !== classificacaoId) return false;
      if (empresaId && empresaIdResolvida(despesa) !== empresaId) return false;
      if (excecao === "sim" && !despesa.excecao) return false;
      if (excecao === "nao" && despesa.excecao) return false;
      const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
      if (periodoInicio && (!dataPagamento || dataPagamento < periodoInicio)) return false;
      if (periodoFim && (!dataPagamento || dataPagamento > periodoFim)) return false;
      if (dataAtualizacaoDe && despesa.updated_at < dataAtualizacaoDe) return false;
      if (dataAtualizacaoAte && despesa.updated_at > dataAtualizacaoAte + "T23:59:59") return false;
      if (busca.trim()) {
        const alvo = `${despesa.numero} ${despesa.nome}`.toLowerCase();
        if (!alvo.includes(busca.trim().toLowerCase())) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, tab, chip, classificacaoId, empresaId, empresaPrimeiraLinhaPorDespesa, excecao, periodoInicio, periodoFim, dataAtualizacaoDe, dataAtualizacaoAte, busca]);

  // SIS-2026-0316: clique no cabeçalho ordena — ver ColunaMeusItens acima
  // pra saber por que algumas colunas ficam de fora.
  const ordenados = useMemo(() => {
    const acessores: Record<ColunaMeusItens, (item: ItemLinhaMalote) => string | number | null> = {
      tipo: (item) => tipoLabelDe(item.despesa),
      numero: (item) => item.despesa.numero,
      data_pagamento: (item) => dataPagamentoDe(item),
      classificacao: (item) => item.despesa.classificacao?.nome ?? null,
      nome: (item) => item.despesa.nome,
      empresa: (item) => empresas.find((e) => e.id === empresaIdResolvida(item.despesa))?.nome ?? null,
      forma_pagamento: (item) => item.despesa.forma_pagamento ?? null,
      valor: (item) => valorDe(item),
      status: (item) => STATUS_LABEL[statusEfetivo(item)],
      excecao: (item) => (item.despesa.excecao ? 1 : 0),
      atualizacao: (item) => item.despesa.updated_at,
    };
    return ordenacao.coluna ? ordenarPor(filtrados, acessores[ordenacao.coluna], ordenacao.direcao) : filtrados;
  }, [filtrados, ordenacao.coluna, ordenacao.direcao, empresas, empresaPrimeiraLinhaPorDespesa]);

  function exportar(escopo: "filtrado" | "completo") {
    const lista = escopo === "filtrado" ? ordenados : itens;
    try {
      const linhas = montarLinhasExcelMeusItens(
        lista,
        (despesa) => empresas.find((empresa) => empresa.id === empresaIdResolvida(despesa))?.nome ?? "",
      );
      const ws = linhas.length > 0
        ? XLSX.utils.json_to_sheet(linhas)
        : XLSX.utils.aoa_to_sheet([CABECALHOS_EXCEL_MEUS_ITENS]);
      ws["!cols"] = [16, 16, 12, 20, 28, 36, 28, 24, 16, 28, 32, 12, 36, 22].map((wch) => ({ wch }));
      if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Meus Itens");
      XLSX.writeFile(wb, nomeArquivoMeusItens(escopo));
      toast.success(`Planilha exportada com ${lista.length} ite${lista.length === 1 ? "m" : "ns"}.`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível exportar a planilha.");
    }
  }

  function limparFiltros() {
    setPeriodoInicio("");
    setPeriodoFim("");
    setDataAtualizacaoDe("");
    setDataAtualizacaoAte("");
    setClassificacaoId("");
    setEmpresaId("");
    setExcecao("todos");
    setBusca("");
    setChip("todos");
  }

  function abrirItem(despesa: MaloteDespesaRow) {
    if (despesa.origem === "solicitacao" && STATUS_FASE_SOLICITACAO.includes(despesa.status)) {
      navigate(`/app/malote/solicitacao/${despesa.id}`);
    } else if (despesa.origem === "solicitacao" && despesa.status === "cotacao_aprovada") {
      // SIS-2026-0340 (Iury): com "Lançador da despesa" configurado na
      // Classificação, o solicitante deixa de poder converter — mas o
      // Iury confirmou que o item continua listado aqui (não desaparece de
      // Meus Itens). Só muda o destino do clique: sem lançador configurado,
      // ou sendo ela mesma um dos lançadores, continua indo pra
      // criar-despesa; senão, vira só acompanhamento (tela de Solicitação,
      // que já lida com status fora de STATUS_FASE_SOLICITACAO mostrando
      // tudo travado/somente leitura).
      if (classificacaoTemLancadorConfigurado(despesa) && !souLancadorDespesa(despesa, user?.id)) {
        navigate(`/app/malote/solicitacao/${despesa.id}`);
      } else {
        navigate(`/app/malote/criar-despesa?solicitacaoId=${despesa.id}`);
      }
    } else {
      navigate(`/app/malote/despesa/${despesa.id}`);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Meus Itens"
        subtitle="Acompanhe todas as suas despesas e solicitações."
        module="Malote"
        breadcrumb={["Malote", "Meus Itens"]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => exportar("filtrado")}
              disabled={isLoading || ordenados.length === 0}
              title="Exporta só o que está na tela, com os filtros e a ordem atuais"
            >
              <Download className="h-4 w-4 mr-2" /> Exportar filtrado
            </Button>
            <Button
              variant="outline"
              onClick={() => exportar("completo")}
              disabled={isLoading || itens.length === 0}
              title="Exporta todos os seus itens, ignorando filtros, aba e status"
            >
              <Download className="h-4 w-4 mr-2" /> Exportar tudo
            </Button>
            <Button asChild>
              <Link to="/app/malote/criar-despesa">
                <Plus className="h-4 w-4 mr-2" /> Criar Despesa
              </Link>
            </Button>
            {podeVerLixeira && (
              <Button variant="outline" onClick={() => setLixeiraAberta(true)} className="gap-1.5">
                <Trash2 className="h-4 w-4" /> Lixeira{despesasLixeira.length > 0 && ` (${despesasLixeira.length})`}
              </Button>
            )}
          </div>
        }
      />

      <Dialog open={lixeiraAberta} onOpenChange={setLixeiraAberta}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lixeira do Malote</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            {despesasLixeira.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">A lixeira está vazia.</p>
            )}
            {despesasLixeira.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted-foreground">{d.numero}</p>
                  <p className="truncate">{d.nome}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium">{formatBRL(d.valor_total)}</span>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleRestaurar(d.id)} disabled={restaurarDespesa.isPending}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                  </Button>
                  <ExcluirPermanentementeButton
                    despesaId={d.id}
                    numero={d.numero}
                    menu={d.origem === "solicitacao" ? "malote_solicitacao_visualizar" : "malote_despesa_visualizar"}
                  />
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <DateRangeFilter
              label="Data de pagamento"
              de={periodoInicio}
              ate={periodoFim}
              onChange={(de, ate) => { setPeriodoInicio(de); setPeriodoFim(ate); }}
            />
            <DateRangeFilter
              label="Última atualização"
              de={dataAtualizacaoDe}
              ate={dataAtualizacaoAte}
              onChange={(de, ate) => { setDataAtualizacaoDe(de); setDataAtualizacaoAte(ate); }}
            />
            <div>
              <Label className="text-xs">Classificação</Label>
              <SearchableSelect
                value={classificacaoId}
                onChange={setClassificacaoId}
                allowClear
                placeholder="Todas"
                options={classificacoes.map((c) => ({ value: c.id, label: c.nome }))}
              />
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <SearchableSelect
                value={empresaId}
                onChange={setEmpresaId}
                allowClear
                placeholder="Todas"
                options={empresas.map((e) => ({ value: e.id, label: e.nome }))}
              />
            </div>
            <div>
              <Label className="text-xs">Exceção</Label>
              <Select value={excecao} onValueChange={(v) => setExcecao(v as typeof excecao)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="sim">Sim</SelectItem>
                  <SelectItem value="nao">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Busca rápida</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº ou nome" />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="gap-1.5 text-muted-foreground">
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            className={cn(
              "flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors min-w-[120px]",
              chip === c.key ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50"
            )}
          >
            <span className="text-lg font-semibold leading-none">{contagens[c.key]}</span>
            <span className="text-xs text-muted-foreground mt-1">{c.label}</span>
          </button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
          <TabsTrigger value="despesas">Despesas do Malote</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeadOrdenavel coluna="tipo" ordenacao={ordenacao}>Tipo</TableHeadOrdenavel>
                <TableHeadOrdenavel coluna="numero" ordenacao={ordenacao}>Nº / ID</TableHeadOrdenavel>
                <TableHead>Parcela</TableHead>
                <TableHeadOrdenavel coluna="data_pagamento" ordenacao={ordenacao}>Data de pagamento</TableHeadOrdenavel>
                <TableHeadOrdenavel coluna="classificacao" ordenacao={ordenacao}>Classificação</TableHeadOrdenavel>
                <TableHeadOrdenavel coluna="nome" ordenacao={ordenacao}>Nome da Despesa</TableHeadOrdenavel>
                <TableHeadOrdenavel coluna="empresa" ordenacao={ordenacao}>Empresa</TableHeadOrdenavel>
                <TableHeadOrdenavel coluna="forma_pagamento" ordenacao={ordenacao}>Forma de pagamento</TableHeadOrdenavel>
                <TableHeadOrdenavel coluna="valor" ordenacao={ordenacao}>Valor (R$)</TableHeadOrdenavel>
                <TableHeadOrdenavel coluna="status" ordenacao={ordenacao}>Status</TableHeadOrdenavel>
                <TableHead>Aprovador pendente</TableHead>
                <TableHeadOrdenavel coluna="excecao" ordenacao={ordenacao}>Exceção</TableHeadOrdenavel>
                <TableHead>Justificativa</TableHead>
                <TableHeadOrdenavel coluna="atualizacao" ordenacao={ordenacao}>Última atualização</TableHeadOrdenavel>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                    Nenhum item encontrado para os filtros selecionados.
                  </TableCell>
                </TableRow>
              )}
              {ordenados.map((item) => {
                const { despesa, parcela } = item;
                const status = statusEfetivo(item);
                const valor = parcela ? parcela.valor : despesa.valor_total;
                const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
                return (
                  <TableRow
                    key={`${despesa.id}-${parcela?.id ?? "unica"}`}
                    className={cn(
                      "cursor-pointer",
                      despesa.excecao && "bg-destructive/5 hover:bg-destructive/10 dark:bg-destructive/10 dark:hover:bg-destructive/15",
                    )}
                    onClick={() => abrirItem(despesa)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        <ListChecks className="h-3.5 w-3.5 text-muted-foreground" /> {tipoLabelDe(despesa)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{despesa.numero}</TableCell>
                    <TableCell className="text-sm">
                      {parcela ? `${parcela.numero_parcela}/${despesa.numero_parcelas}` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{dataPagamento ? new Date(dataPagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell>{despesa.classificacao?.nome ?? "—"}</TableCell>
                    <TableCell className="font-medium">{despesa.nome}</TableCell>
                    <TableCell>{empresas.find((e) => e.id === empresaIdResolvida(despesa))?.nome ?? "—"}</TableCell>
                    <TableCell>{despesa.forma_pagamento ?? "—"}</TableCell>
                    <TableCell>{Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE_CLASS[status]}>
                        {STATUS_LABEL[status]}
                        {status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? ` N${despesa.nivel_aprovacao_atual}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <AprovadorPendenteCell despesa={despesa} />
                    </TableCell>
                    <TableCell>
                      {despesa.excecao ? <Badge variant="destructive">Sim</Badge> : <span className="text-muted-foreground text-sm">Não</span>}
                    </TableCell>
                    <TableCell>
                      <JustificativaPendenteBadge despesa={despesa} parcela={parcela} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(despesa.updated_at).toLocaleString("pt-BR")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Dica importante</p>
        <p>Itens em "Rascunho" podem ser editados ou excluídos. Após enviados, seguem o fluxo de aprovação.</p>
      </div>

    </div>
  );
}
