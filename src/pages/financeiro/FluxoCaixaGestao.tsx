import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { TrendingDown, TrendingUp, Wallet, LineChart, X, Trash2, RotateCcw, Pencil, Eye, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  useFluxoCaixaCombinado,
  useAjustarLinhaFluxoCaixa,
  useReverterAjusteFluxoCaixa,
  type FluxoCaixaMaloteLinha,
} from "@/hooks/useFluxoCaixaMalote";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useFormasPagamento } from "@/hooks/useMaloteFormaPagamento";
import { useExcluirDespesaSoft, useRestaurarDespesa, useDespesasLixeira } from "@/hooks/useMaloteDespesa";
import { useExcluirDebito, useRestaurarDebito, useDebitoAutomaticoLixeira } from "@/hooks/useDebitoAutomatico";
import { useExcluirItemFatura, useRestaurarItemFatura, useCartaoFaturaLixeira } from "@/hooks/useCartaoFatura";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { ExcluirPermanentementeButton } from "@/pages/malote/ExcluirPermanentementeButton";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { urlLogoCartao, useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";

// SIS-2026-0413: menu_codigo de cada origem, pra gatear o botão Excluir de
// cada linha (não existe um menu_codigo próprio do Fluxo de Caixa pra
// "excluir" — a ação é gateada pela tela dona do dado, igual o resto do
// ERP faz pra qualquer ação em cascata entre telas).
// SIS-2026-0473: Aplicação Financeira não usa nem Editar (ajuste isolado
// escreveria origem='aplicacao_financeira' em financeiro_fluxo_caixa_ajuste,
// que a CHECK da tabela não aceita de propósito) nem Excluir/Restaurar daqui
// (a RPC de exclusão é hard-delete e bloqueia se já teve resgate, sem
// suportar lixeira) — as duas linhas (aplicar/resgate) só se gerenciam pela
// própria tela de Aplicações Financeiras. Os dois botões ficam ocultos pra
// essa origem (ver render da linha, abaixo); as entradas nos Records abaixo
// só existem pra satisfazer o tipo exaustivo.
const MENU_POR_ORIGEM: Record<FluxoCaixaMaloteLinha["origem"], string> = {
  malote: "malote_despesa_visualizar",
  debito_automatico: "financeiro-debito-automatico",
  cartao_fatura: "financeiro-cartao-credito",
  aplicacao_financeira: "financeiro-aplicacao-financeira",
};

interface RateioDetalheItem {
  id: string;
  nome: string;
  valor: number;
}

const LABEL_ORIGEM: Record<FluxoCaixaMaloteLinha["origem"], string> = {
  malote: "Pagamento Malote",
  debito_automatico: "Débito Automático",
  cartao_fatura: "Fatura Cartão de Crédito",
  aplicacao_financeira: "Aplicação Financeira",
};

// SIS-2026-0413 (complemento): a tabela renderizava todas as linhas
// filtradas de uma vez — mesmo padrão de paginação de PlanilhaCusto.tsx.
const PAGE_SIZE = 50;

// SIS-2026-0160: início do Fluxo de Caixa. SIS-2026-0256 somou o Débito
// Automático (entrada e saída) ao Pagamento Malote (só saída) como segunda
// fonte — os cards de Entradas/Saldo ainda ficam zerados (nenhuma das duas
// fontes hoje resolve saldo bancário real).
export default function FluxoCaixaGestao() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: linhasBrutas = [], isLoading } = useFluxoCaixaCombinado();

  // SIS-2026-0464: a view de origem já entrega 1 linha por linha de RATEIO
  // (JOIN com malote_despesa_rateio_linha) — uma despesa dividida entre
  // vários contratos aparecia repetida no Fluxo de Caixa, uma vez por
  // contrato, cada uma com sua fatia do valor. Agrupa de volta em 1 linha
  // por lançamento (mesmo despesa_id + mesma parcela, quando parcelado),
  // somando o valor; se o grupo tiver mais de 1 contrato distinto, mostra
  // "Rateio" em vez de escolher um dos nomes arbitrariamente.
  //
  // SIS-2026-0537 (Iury): guarda o detalhe por contrato (nome + fatia do
  // valor) em `rateioDetalhe`, pra tela poder expandir a linha e mostrar
  // como o rateio foi feito, em vez de só o rótulo "Rateio".
  const linhas = useMemo(() => {
    const grupos = new Map<
      string,
      { base: FluxoCaixaMaloteLinha; valor: number; contratos: Map<string, { nome: string; valor: number }> }
    >();
    for (const l of linhasBrutas) {
      const chave = `${l.despesa_id}::${l.numero_parcela ?? ""}`;
      let grupo = grupos.get(chave);
      if (!grupo) {
        grupo = { base: l, valor: 0, contratos: new Map() };
        grupos.set(chave, grupo);
      }
      grupo.valor += Number(l.valor) || 0;
      if (l.contrato_id && l.contrato_nome) {
        const atual = grupo.contratos.get(l.contrato_id);
        grupo.contratos.set(l.contrato_id, { nome: l.contrato_nome, valor: (atual?.valor ?? 0) + (Number(l.valor) || 0) });
      }
    }
    return Array.from(grupos.values()).map(({ base, valor, contratos }) => {
      if (contratos.size > 1) {
        const rateioDetalhe = Array.from(contratos.entries())
          .map(([id, { nome, valor: valorContrato }]) => ({ id, nome, valor: valorContrato }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        return { ...base, valor, contrato_id: null, contrato_nome: "Rateio", rateioDetalhe };
      }
      return { ...base, valor, rateioDetalhe: undefined as RateioDetalheItem[] | undefined };
    });
  }, [linhasBrutas]);
  // SIS-2026-0221/0439: "Forma de pagamento" vem do catálogo nomeado
  // cadastrável em Configurações do Malote → Formas de Pagamento.
  const { data: formasPagamento = [] } = useFormasPagamento();
  const formasPagamentoAtivas = useMemo(() => formasPagamento.filter((f) => f.ativo), [formasPagamento]);

  // SIS-2026-0413: 1 mutation de excluir/restaurar por origem — a linha
  // sabe de qual tabela ela veio (l.origem), o handler escolhe a certa.
  const excluirDespesa = useExcluirDespesaSoft();
  const excluirDebito = useExcluirDebito();
  const excluirItemFatura = useExcluirItemFatura();
  const restaurarDespesa = useRestaurarDespesa();
  const restaurarDebito = useRestaurarDebito();
  const restaurarItemFatura = useRestaurarItemFatura();

  const [itemExcluir, setItemExcluir] = useState<FluxoCaixaMaloteLinha | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [lixeiraAberta, setLixeiraAberta] = useState(false);

  const { data: despesasLixeira = [] } = useDespesasLixeira();
  const { data: debitosLixeira = [] } = useDebitoAutomaticoLixeira();
  const { data: itensFaturaLixeira = [] } = useCartaoFaturaLixeira();

  // SIS-2026-0489: Editar grava em financeiro_fluxo_caixa_ajuste (ver
  // useFluxoCaixaMalote.ts) — nunca mais na despesa/débito/fatura de
  // origem, valendo pras 3 origens (Débito Automático deixou de só
  // navegar pra tela própria).
  const ajustarLinha = useAjustarLinhaFluxoCaixa();
  const reverterAjuste = useReverterAjusteFluxoCaixa();
  const { data: bancosCartao = [] } = useCartaoBancos();
  const { data: classificacoesCatalogo = [] } = useClassificacoesOrcamentoAdmin();
  const [itemEditar, setItemEditar] = useState<FluxoCaixaMaloteLinha | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [editData, setEditData] = useState("");
  const [editTipo, setEditTipo] = useState<"entrada" | "saida">("saida");
  const [editClassificacaoId, setEditClassificacaoId] = useState("");
  const [editDescricao, setEditDescricao] = useState("");
  const [editCompetencia, setEditCompetencia] = useState("");
  const [editEmpresaId, setEditEmpresaId] = useState("");
  const [editFormaPagamento, setEditFormaPagamento] = useState("");
  const [editBancoId, setEditBancoId] = useState("");

  function abrirEditar(l: FluxoCaixaMaloteLinha) {
    setItemEditar(l);
    setEditData(l.data_pagamento ?? "");
    setEditTipo(l.tipo);
    setEditClassificacaoId(l.classificacao_id ?? "");
    setEditDescricao(l.descricao ?? "");
    setEditCompetencia(l.competencia?.slice(0, 7) ?? "");
    setEditEmpresaId(l.empresa_id ?? "");
    setEditFormaPagamento(l.forma_pagamento ?? "");
    setEditBancoId(l.banco_id ?? "");
  }

  async function confirmarEditar() {
    if (!itemEditar) return;
    setSalvandoEdicao(true);
    try {
      await ajustarLinha.mutateAsync({
        origem: itemEditar.origem,
        despesaId: itemEditar.despesa_id,
        numeroParcela: itemEditar.numero_parcela,
        dataPagamento: editData || null,
        tipo: editTipo,
        classificacaoId: editClassificacaoId || null,
        descricao: editDescricao.trim() || null,
        competencia: editCompetencia ? `${editCompetencia}-01` : null,
        empresaId: editEmpresaId || null,
        formaPagamento: editFormaPagamento || null,
        bancoId: editBancoId || null,
      });
      toast.success("Atualizado só neste Fluxo de Caixa — o lançamento original não muda.");
      setItemEditar(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar.");
    } finally {
      setSalvandoEdicao(false);
    }
  }

  async function confirmarExcluir() {
    if (!itemExcluir) return;
    setExcluindo(true);
    try {
      if (itemExcluir.origem === "malote") await excluirDespesa.mutateAsync(itemExcluir.despesa_id);
      else if (itemExcluir.origem === "debito_automatico") await excluirDebito.mutateAsync(itemExcluir.despesa_id);
      else await excluirItemFatura.mutateAsync(itemExcluir.despesa_id);
      toast.success("Lançamento movido para a lixeira.");
      setItemExcluir(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir lançamento.");
    } finally {
      setExcluindo(false);
    }
  }

  async function restaurar(origem: FluxoCaixaMaloteLinha["origem"], id: string) {
    try {
      if (origem === "malote") await restaurarDespesa.mutateAsync(id);
      else if (origem === "debito_automatico") await restaurarDebito.mutateAsync(id);
      else await restaurarItemFatura.mutateAsync(id);
      toast.success("Restaurado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao restaurar.");
    }
  }

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  // SIS-2026-0537 (Iury): "retornar a coluna de Centro de custo" — filtro
  // removido no SIS-2026-0489, pedido de volta — a coluna na view nunca
  // saiu (CartaoCredito.tsx já dependia dela).
  const [contratoId, setContratoId] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  // SIS-2026-0307: "após o pagamento alimentamos o fluxo de caixa" (usuário)
  // — Banco entra aqui, não em Pagamento Malote/Meus Itens.
  const [bancoId, setBancoId] = useState("");
  // SIS-2026-0038 (achado do usuário): vindo do botão "Ver no Fluxo de
  // Caixa" em Pagamento Malote (?busca=<numero da despesa>), ou digitado
  // direto aqui — busca por ID (numero) ou descrição, igual ao padrão de
  // busca livre já usado em PagamentoMalote.tsx.
  const [busca, setBusca] = useState(searchParams.get("busca") ?? "");
  const [page, setPage] = useState(1);
  // SIS-2026-0537 (Iury): "se um item for rateado, o centro de custo deve
  // aparecer como 'Rateio' e se clicar nele ele mostra abaixo como foi
  // dividido na mesma página, só 'expandindo' o item" — sub-linhas embaixo
  // da linha pai (padrão árvore), sem sair da tela.
  const [linhasExpandidas, setLinhasExpandidas] = useState<Set<string>>(new Set());
  function alternarExpansao(chave: string) {
    setLinhasExpandidas((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }

  const empresasDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.empresa_id && l.empresa_nome && map.set(l.empresa_id, l.empresa_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const contratosDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.contrato_id && l.contrato_nome && map.set(l.contrato_id, l.contrato_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const classificacoesDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.classificacao_id && l.classificacao_nome && map.set(l.classificacao_id, l.classificacao_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  // SIS-2026-0307: mesmo padrão dos filtros acima — deriva direto das
  // linhas já carregadas (a view já entrega banco_nome pronto), sem
  // depender de outro hook nem da RLS de malote_cartao_banco pra esta tela.
  const bancosDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.banco_id && l.banco_nome && map.set(l.banco_id, l.banco_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  // SIS-2026-0464: achado real — o filtro usava tiposFormaPagamentoAtivos
  // (catálogo malote_tipo_forma_pagamento, só os `ativo`), mas
  // malote_despesa.forma_pagamento é texto livre, SEM FK pro catálogo — um
  // tipo desativado/renomeado depois de já usado some do filtro só, nunca
  // do dado. Igual aos outros filtros desta tela, deriva as opções direto
  // das linhas carregadas: garante que toda opção do filtro bate com algo.
  const formasPagamentoDisponiveis = useMemo(() => {
    const set = new Set<string>();
    linhas.forEach((l) => l.forma_pagamento && set.add(l.forma_pagamento));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [linhas]);

  function limparFiltros() {
    setDataDe("");
    setDataAte("");
    setCompetencia("");
    setEmpresaId("");
    setContratoId("");
    setClassificacaoId("");
    setFormaPagamento("");
    setBancoId("");
    setBusca("");
    setPage(1);
  }

  const filtradas = useMemo(() => {
    const buscaNorm = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (dataDe && (!l.data_pagamento || l.data_pagamento < dataDe)) return false;
      if (dataAte && (!l.data_pagamento || l.data_pagamento > dataAte)) return false;
      if (competencia && l.competencia?.slice(0, 7) !== competencia) return false;
      if (empresaId && l.empresa_id !== empresaId) return false;
      if (contratoId && l.contrato_id !== contratoId) return false;
      if (classificacaoId && l.classificacao_id !== classificacaoId) return false;
      if (formaPagamento && l.forma_pagamento !== formaPagamento) return false;
      if (bancoId && l.banco_id !== bancoId) return false;
      if (
        buscaNorm &&
        !(l.id_malote ?? "").toLowerCase().includes(buscaNorm) &&
        !(l.descricao ?? "").toLowerCase().includes(buscaNorm)
      ) return false;
      return true;
    });
  }, [linhas, dataDe, dataAte, competencia, empresaId, contratoId, classificacaoId, formaPagamento, bancoId, busca]);

  // SIS-2026-0256: com o Débito Automático somado à fonte, "Saídas" precisa
  // filtrar por tipo — antes só existia saída (Malote), então somar tudo
  // dava no mesmo.
  const totalSaidas = useMemo(() => filtradas.filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0), [filtradas]);
  const totalEntradas = useMemo(() => filtradas.filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0), [filtradas]);

  const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtradas.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Fluxo de Caixa"
        subtitle="Acompanhe as entradas e saídas financeiras provenientes do Pagamento Malote e do Débito Automático."
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Fluxo de Caixa"]}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLixeiraAberta(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Lixeira
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Saldo Atual" valor="—" icon={<Wallet />} cor="slate" valorClass="text-muted-foreground" />
        <KpiTile
          label="Entradas (filtro atual)"
          valor={formatBRL(totalEntradas)}
          icon={<TrendingUp />}
          cor="emerald"
          valorClass="text-emerald-600 dark:text-emerald-400"
        />
        <KpiTile
          label="Saídas (filtro atual)"
          valor={formatBRL(totalSaidas)}
          icon={<TrendingDown />}
          cor="red"
          valorClass="text-red-600 dark:text-red-400"
        />
        <KpiTile label="Saldo Projetado" valor="—" icon={<LineChart />} cor="sky" valorClass="text-muted-foreground" />
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Saldo Atual e Saldo Projetado ainda não têm fonte de dado. Entradas e Saídas somam Pagamento Malote (só saída)
        e Débito Automático (entrada e saída).
      </p>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Data de</Label>
              <Input type="date" className="h-8 text-xs" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Data até</Label>
              <Input type="date" className="h-8 text-xs" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Competência</Label>
              <Input type="month" className="h-8 text-xs" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={empresaId || "todas"} onValueChange={(v) => setEmpresaId(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {empresasDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Contrato</Label>
              <Select value={contratoId || "todos"} onValueChange={(v) => setContratoId(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {contratosDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Select value={classificacaoId || "todas"} onValueChange={(v) => setClassificacaoId(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {classificacoesDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Forma de Pagamento</Label>
              <Select value={formaPagamento || "todas"} onValueChange={(v) => setFormaPagamento(v === "todas" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {formasPagamentoDisponiveis.map((nome) => (
                    <SelectItem key={nome} value={nome}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Banco</Label>
              <Select value={bancoId || "todos"} onValueChange={(v) => setBancoId(v === "todos" ? "" : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {bancosDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Buscar por ID ou descrição</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Digite o ID (ex. SD-2026-0038) ou a descrição..."
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">Movimentações do Fluxo de Caixa</p>
            <p className="text-xs text-muted-foreground">Dados alimentados pelo Pagamento Malote e pelo Débito Automático.</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {/* SIS-2026-0306 (Iury): ordem das colunas ajustada — ID,
                    Data de Pagamento, Tipo, Classificação, Descrição,
                    Competência, Empresa, Contrato, Banco, Forma de
                    Pagamento, Valor.
                    SIS-2026-0537 (Iury): Contrato tinha saído da tela no
                    SIS-2026-0489, pedido de volta — a coluna na view nunca
                    saiu (CartaoCredito.tsx já dependia dela). */}
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="text-center">ID</TableHead>
                  <TableHead className="text-center">Data de Pagamento</TableHead>
                  <TableHead className="text-center">Tipo</TableHead>
                  <TableHead className="text-center">Classificação</TableHead>
                  <TableHead className="text-center">Descrição</TableHead>
                  <TableHead className="text-center">Competência</TableHead>
                  <TableHead className="text-center">Empresa</TableHead>
                  <TableHead className="text-center">Contrato</TableHead>
                  <TableHead className="text-center">Banco</TableHead>
                  <TableHead className="text-center">Forma de Pagamento</TableHead>
                  <TableHead className="text-center">Valor (R$)</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && filtradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <TrendingDown className="h-8 w-8 text-muted-foreground/50" />
                        Nenhuma movimentação encontrada com os filtros atuais.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {pageRows.map((l) => {
                  // SIS-2026-0254: despesa parcelada agora pode gerar mais
                  // de 1 linha (1 por parcela paga) com o mesmo
                  // despesa_id — key precisa incluir o número da parcela.
                  const chave = `${l.despesa_id}-${l.numero_parcela ?? "unica"}`;
                  const temRateio = l.contrato_nome === "Rateio" && !!l.rateioDetalhe?.length;
                  const expandida = linhasExpandidas.has(chave);
                  return (
                  <>
                  <TableRow key={chave}>
                    <TableCell className="text-center">
                      {temRateio && (
                        <button
                          type="button"
                          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                          title={expandida ? "Recolher rateio" : "Ver rateio por contrato"}
                          onClick={() => alternarExpansao(chave)}
                        >
                          {expandida ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-mono text-xs">{l.id_malote}</TableCell>
                    <TableCell className="text-center text-sm">{l.data_pagamento ? new Date(l.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell className="text-center">
                      {l.tipo === "entrada" ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Entrada</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">Saída</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-sm">{l.classificacao_nome ?? "—"}</TableCell>
                    <TableCell className="text-center text-sm">
                      <span className="inline-flex items-center gap-1">
                        {l.descricao}
                        {l.ajustado && (
                          <span
                            title="Editado só no Fluxo de Caixa — o lançamento original não mudou"
                            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            ajustado
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-sm">{l.competencia ? new Date(l.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "—"}</TableCell>
                    <TableCell className="text-center text-sm">{l.empresa_nome ?? "—"}</TableCell>
                    <TableCell className="text-center text-sm">
                      {temRateio ? (
                        <button
                          type="button"
                          className="underline decoration-dotted hover:text-foreground"
                          onClick={() => alternarExpansao(chave)}
                        >
                          Rateio
                        </button>
                      ) : (
                        l.contrato_nome ?? "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {l.banco_nome ? <BancoBadge nome={l.banco_nome} logoUrl={urlLogoCartao(l.banco_logo_path)} /> : "—"}
                    </TableCell>
                    <TableCell className="text-center text-sm">{l.forma_pagamento ?? "—"}</TableCell>
                    <TableCell className="text-center text-sm font-medium">{formatBRL(l.valor)}</TableCell>
                    <TableCell className="text-center">
                      {l.origem === "aplicacao_financeira" ? (
                        <span className="text-xs text-muted-foreground" title="Gerencie em Aplicações Financeiras">
                          ver em Aplicações
                        </span>
                      ) : (
                        <div className="flex items-center justify-center gap-0.5">
                          {/* SIS-2026-0038 (achado do usuário): "e vice versa,
                              podendo visualizar a despesa lá em malote,
                              clicando no fluxo" — só faz sentido pra origem
                              malote, é a única com tela de despesa própria. */}
                          {l.origem === "malote" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Ver despesa no Malote"
                              onClick={() => navigate(`/app/malote/despesa/${l.despesa_id}`)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {/* SIS-2026-0489: edição agora é um ajuste isolado do
                              Fluxo de Caixa (não escreve mais na despesa/débito/
                              fatura de origem) — permissão própria da tela, não
                              mais a da tela dona do dado (essa continua valendo
                              só pro Excluir, que apaga o lançamento de verdade). */}
                          <AcessoGate menu="financeiro-fluxo-caixa-gestao" acao="alterar">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Editar (só neste Fluxo de Caixa)"
                              onClick={() => abrirEditar(l)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </AcessoGate>
                          <AcessoGate menu={MENU_POR_ORIGEM[l.origem]} acao="excluir">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              disabled={l.origem === "malote" && l.numero_parcela != null}
                              title={
                                l.origem === "malote" && l.numero_parcela != null
                                  ? "Despesa parcelada — exclua a despesa inteira pela tela do Malote"
                                  : "Excluir"
                              }
                              onClick={() => setItemExcluir(l)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AcessoGate>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                  {temRateio && expandida && l.rateioDetalhe!.map((c) => (
                    <TableRow key={`${chave}-${c.id}`} className="bg-muted/30 hover:bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={7} className="text-right text-xs text-muted-foreground pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 opacity-50" /> {c.nome}
                        </span>
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-center text-xs font-medium text-muted-foreground">{formatBRL(c.valor)}</TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                  </>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">
                {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtradas.length)} de {filtradas.length} registros
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={currentPage === 1}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
                >«</button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
                >‹</button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                  const p = start + i;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded border text-xs font-medium ${
                        p === currentPage
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted"
                      }`}
                    >{p}</button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
                >›</button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
                >»</button>
              </div>
            </div>
          )}
          {totalPages === 1 && filtradas.length > 0 && (
            <p className="text-xs text-muted-foreground pt-1">Mostrando {filtradas.length} registro{filtradas.length === 1 ? "" : "s"}</p>
          )}
        </CardContent>
      </Card>

      {/* Confirmar exclusão (soft — vai pra lixeira, dá pra restaurar) */}
      <AlertDialog open={!!itemExcluir} onOpenChange={(o) => !o && setItemExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemExcluir?.id_malote} — {itemExcluir?.descricao}. Vai para a lixeira ({itemExcluir && LABEL_ORIGEM[itemExcluir.origem]}) —
              dá pra restaurar depois pelo botão Lixeira aqui em cima.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExcluir} disabled={excluindo}>
              {excluindo ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* SIS-2026-0489: edita Data de Pagamento, Tipo, Classificação,
          Descrição, Competência, Empresa, Banco e Forma de Pagamento —
          grava em financeiro_fluxo_caixa_ajuste, nunca na despesa/débito/
          fatura de origem. Vale pras 3 origens (antes Débito Automático só
          navegava pra tela própria, Cartão só editava a Data da Compra). */}
      <Dialog open={!!itemEditar} onOpenChange={(o) => !o && setItemEditar(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar lançamento (só neste Fluxo de Caixa)</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            {itemEditar?.id_malote} — {LABEL_ORIGEM[itemEditar?.origem ?? "malote"]}
          </p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Data de Pagamento</Label>
              <Input type="date" className="h-9" value={editData} onChange={(e) => setEditData(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={editTipo} onValueChange={(v) => setEditTipo(v as "entrada" | "saida")}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entrada">Entrada</SelectItem>
                  <SelectItem value="saida">Saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Select value={editClassificacaoId || "_"} onValueChange={(v) => setEditClassificacaoId(v === "_" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">—</SelectItem>
                  {classificacoesCatalogo.filter((c) => c.ativo).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Input className="h-9" value={editDescricao} onChange={(e) => setEditDescricao(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Competência</Label>
              <Input type="month" className="h-9" value={editCompetencia} onChange={(e) => setEditCompetencia(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={editEmpresaId || "_"} onValueChange={(v) => setEditEmpresaId(v === "_" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">—</SelectItem>
                  {empresasDisponiveis.map(([id, nome]) => (
                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Forma de Pagamento</Label>
              <Select value={editFormaPagamento || "_"} onValueChange={(v) => setEditFormaPagamento(v === "_" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">—</SelectItem>
                  {formasPagamentoAtivas.map((f) => (
                    <SelectItem key={f.id} value={f.nome}>{f.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Banco</Label>
              <Select value={editBancoId || "_"} onValueChange={(v) => setEditBancoId(v === "_" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">—</SelectItem>
                  {bancosCartao.filter((b) => b.ativo).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            {itemEditar?.ajustado && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                disabled={salvandoEdicao}
                onClick={async () => {
                  if (!itemEditar) return;
                  setSalvandoEdicao(true);
                  try {
                    await reverterAjuste.mutateAsync({
                      origem: itemEditar.origem,
                      despesaId: itemEditar.despesa_id,
                      numeroParcela: itemEditar.numero_parcela,
                    });
                    toast.success("Ajuste revertido — voltou ao lançamento original.");
                    setItemEditar(null);
                  } catch (e: any) {
                    toast.error(e.message ?? "Erro ao reverter.");
                  } finally {
                    setSalvandoEdicao(false);
                  }
                }}
              >
                Reverter ajuste
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setItemEditar(null)} disabled={salvandoEdicao}>Cancelar</Button>
              <Button onClick={confirmarEditar} disabled={salvandoEdicao}>{salvandoEdicao ? "Salvando…" : "Salvar"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lixeira — itens excluídos das 3 origens, cada um com Restaurar */}
      <Dialog open={lixeiraAberta} onOpenChange={setLixeiraAberta}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Lixeira do Fluxo de Caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            {despesasLixeira.length === 0 && debitosLixeira.length === 0 && itensFaturaLixeira.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">A lixeira está vazia.</p>
            )}

            {despesasLixeira.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Pagamento Malote</p>
                {despesasLixeira.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">{d.numero}</p>
                      <p className="truncate">{d.nome}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{formatBRL(d.valor_total)}</span>
                      <AcessoGate menu="malote_despesa_visualizar" acao="excluir">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => restaurar("malote", d.id)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                        </Button>
                      </AcessoGate>
                      {/* [SEM-CHAMADO] (achado do usuário): faltava excluir
                          permanentemente de dentro da própria Lixeira — só
                          dava pra excluir de dentro da despesa, mas ao mover
                          pra lixeira ela some de Meus Itens/Aprovações, sem
                          jeito de voltar lá pra terminar de excluir. */}
                      <ExcluirPermanentementeButton
                        despesaId={d.id}
                        numero={d.numero}
                        menu={d.origem === "solicitacao" ? "malote_solicitacao_visualizar" : "malote_despesa_visualizar"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {debitosLixeira.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Débito Automático</p>
                {debitosLixeira.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">{d.numero}</p>
                      <p className="truncate">{d.descricao}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{formatBRL(d.valor)}</span>
                      <AcessoGate menu="financeiro-debito-automatico" acao="excluir">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => restaurar("debito_automatico", d.id)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                        </Button>
                      </AcessoGate>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {itensFaturaLixeira.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Fatura Cartão de Crédito</p>
                {itensFaturaLixeira.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">{i.nome_cartao}</p>
                      <p className="truncate">{i.descricao}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{formatBRL(i.valor)}</span>
                      <AcessoGate menu="financeiro-cartao-credito" acao="excluir">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => restaurar("cartao_fatura", i.id)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                        </Button>
                      </AcessoGate>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
