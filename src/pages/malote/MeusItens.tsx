import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus, ListChecks, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useMinhasDespesas,
  useContratosAtivos,
  useEmpresasGrupo,
  MaloteDespesaRow,
  StatusDespesa,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_FASE_SOLICITACAO,
} from "@/hooks/useMaloteDespesa";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { SolicitacaoModal } from "./SolicitacaoModal";

const ORIGEM_LABEL: Record<string, string> = {
  solicitacao: "Solicitação",
  despesa_unica: "Despesa",
  despesa_multi_classificacao: "Rateio de Classificação",
};

const FORMA_PAGAMENTO_LABEL: Record<string, string> = {
  pix: "Pix",
  ted: "TED",
  boleto: "Boleto",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
};

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

function itemMatchesChip(item: MaloteDespesaRow, chip: ChipKey): boolean {
  switch (chip) {
    case "todos":
      return true;
    case "rascunho":
      return item.status === "rascunho";
    case "aguardando_cotacao":
      return item.status === "aguardando_cotacao" || item.status === "cotacao_realizada";
    case "cotacao_aprovada":
      return item.status === "cotacao_aprovada";
    case "pendente_n1":
      return item.status === "pendente_aprovacao" && item.nivel_aprovacao_atual === 1;
    case "pendente_n2":
      return item.status === "pendente_aprovacao" && item.nivel_aprovacao_atual === 2;
    case "pendente_n3":
      return item.status === "pendente_aprovacao" && item.nivel_aprovacao_atual === 3;
    case "aguardando_pagamento":
      return item.status === "aguardando_pagamento";
    case "necessidade_de_ajuste":
      return item.status === "necessidade_de_ajuste";
    case "despesa_paga":
      return item.status === "despesa_paga";
    case "despesa_reprovada":
      return item.status === "despesa_reprovada";
  }
}

function aprovadorPendente(item: MaloteDespesaRow): string | null {
  if (item.status !== "pendente_aprovacao" || !item.nivel_aprovacao_atual) return null;
  const c = item.classificacao;
  if (!c) return null;
  if (item.nivel_aprovacao_atual === 1) return c.aprovador1_nome ?? null;
  if (item.nivel_aprovacao_atual === 2) return c.aprovador2_nome ?? null;
  return c.aprovador3_nome ?? null;
}

export default function MeusItens() {
  const navigate = useNavigate();
  const { data: itens = [], isLoading } = useMinhasDespesas();
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: empresas = [] } = useEmpresasGrupo();

  const [tab, setTab] = useState<"todos" | "solicitacoes" | "despesas">("todos");
  const [chip, setChip] = useState<ChipKey>("todos");
  const [periodoInicio, setPeriodoInicio] = useState("");
  const [periodoFim, setPeriodoFim] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [excecao, setExcecao] = useState<"todos" | "sim" | "nao">("todos");
  const [busca, setBusca] = useState("");
  const [solicitacaoModalId, setSolicitacaoModalId] = useState<string | null>(null);

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
    for (const item of itens) {
      for (const c of CHIPS) {
        if (itemMatchesChip(item, c.key)) map[c.key]++;
      }
    }
    return map;
  }, [itens]);

  const filtrados = useMemo(() => {
    return itens.filter((item) => {
      if (tab === "solicitacoes" && item.origem !== "solicitacao") return false;
      if (tab === "despesas" && item.origem === "solicitacao") return false;
      if (!itemMatchesChip(item, chip)) return false;
      if (classificacaoId && item.classificacao_id !== classificacaoId) return false;
      if (empresaId && item.empresa_id !== empresaId) return false;
      if (excecao === "sim" && !item.excecao) return false;
      if (excecao === "nao" && item.excecao) return false;
      if (periodoInicio && (!item.data_pagamento || item.data_pagamento < periodoInicio)) return false;
      if (periodoFim && (!item.data_pagamento || item.data_pagamento > periodoFim)) return false;
      if (busca.trim()) {
        const alvo = `${item.numero} ${item.nome}`.toLowerCase();
        if (!alvo.includes(busca.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [itens, tab, chip, classificacaoId, empresaId, excecao, periodoInicio, periodoFim, busca]);

  function limparFiltros() {
    setPeriodoInicio("");
    setPeriodoFim("");
    setClassificacaoId("");
    setEmpresaId("");
    setExcecao("todos");
    setBusca("");
    setChip("todos");
  }

  function abrirItem(item: MaloteDespesaRow) {
    if (item.origem === "solicitacao" && STATUS_FASE_SOLICITACAO.includes(item.status)) {
      setSolicitacaoModalId(item.id);
    } else if (item.origem === "solicitacao" && item.status === "cotacao_aprovada") {
      navigate(`/app/malote/criar-despesa?solicitacaoId=${item.id}`);
    } else {
      navigate(`/app/malote/despesa/${item.id}`);
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
          <Button asChild>
            <Link to="/app/malote/criar-despesa">
              <Plus className="h-4 w-4 mr-2" /> Criar Despesa
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <Label className="text-xs">Período (de)</Label>
              <Input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Período (até)</Label>
              <Input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} />
            </div>
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
                <TableHead>Tipo</TableHead>
                <TableHead>Nº / ID</TableHead>
                <TableHead>Data de pagamento</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Nome da Despesa</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Forma de pagamento</TableHead>
                <TableHead>Valor (R$)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aprovador pendente</TableHead>
                <TableHead>Exceção</TableHead>
                <TableHead>Última atualização</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    Nenhum item encontrado para os filtros selecionados.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((item) => {
                const aprovador = aprovadorPendente(item);
                return (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => abrirItem(item)}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        <ListChecks className="h-3.5 w-3.5 text-muted-foreground" /> {ORIGEM_LABEL[item.origem] ?? item.origem}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.numero}</TableCell>
                    <TableCell>{item.data_pagamento ? new Date(item.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell>{item.classificacao?.nome ?? "—"}</TableCell>
                    <TableCell className="font-medium">{item.nome}</TableCell>
                    <TableCell>{empresas.find((e) => e.id === item.empresa_id)?.nome ?? "—"}</TableCell>
                    <TableCell>{item.forma_pagamento ? FORMA_PAGAMENTO_LABEL[item.forma_pagamento] ?? item.forma_pagamento : "—"}</TableCell>
                    <TableCell>{Number(item.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE_CLASS[item.status]}>
                        {STATUS_LABEL[item.status]}
                        {item.status === "pendente_aprovacao" && item.nivel_aprovacao_atual ? ` N${item.nivel_aprovacao_atual}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{aprovador ?? "—"}</TableCell>
                    <TableCell>
                      {item.excecao ? <span className="text-red-600 dark:text-red-400 text-sm">Sim</span> : <span className="text-muted-foreground text-sm">Não</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(item.updated_at).toLocaleString("pt-BR")}</TableCell>
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

      {solicitacaoModalId && <SolicitacaoModal despesaId={solicitacaoModalId} onClose={() => setSolicitacaoModalId(null)} />}
    </div>
  );
}
