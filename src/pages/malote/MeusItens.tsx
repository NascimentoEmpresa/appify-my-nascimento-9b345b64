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
  ItemLinhaMalote,
  StatusDespesa,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_FASE_SOLICITACAO,
} from "@/hooks/useMaloteDespesa";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";

const ORIGEM_LABEL: Record<string, string> = {
  solicitacao: "Solicitação",
  despesa_unica: "Despesa",
  despesa_multi_classificacao: "Rateio de Classificação",
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

// SIS-2026-0223: despesa parcelada vira N linhas (1 por parcela) a partir de
// "aguardando_pagamento" — pros chips/status de pagamento, o que conta é o
// status da PARCELA (paga/pendente), não o bruto da despesa, senão as N
// linhas cairiam sempre no mesmo chip (todas "aguardando" até a despesa
// inteira ficar paga na última parcela).
function statusEfetivo(item: ItemLinhaMalote): StatusDespesa {
  // pronto_para_pagar/ajuste_pagamento continuam sendo decisão sobre a
  // despesa inteira (parcela só tem pendente/paga) — só aguardando_pagamento
  // e despesa_paga refletem o progresso real de CADA parcela.
  if (item.parcela && (item.despesa.status === "aguardando_pagamento" || item.despesa.status === "despesa_paga")) {
    return item.parcela.status === "paga" ? "despesa_paga" : "aguardando_pagamento";
  }
  return item.despesa.status;
}

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

// `origem` não muda depois que a Solicitação vira Despesa (fica "solicitacao"
// pra sempre) — quem decide se ainda é Solicitação é o status atual, mesma
// lógica de Aprovacoes.tsx: a partir de cotacao_aprovada em diante já é
// Despesa (Tipo e agrupamento das abas Solicitações/Despesas do Malote).
function aindaESolicitacao(despesa: MaloteDespesaRow): boolean {
  return despesa.origem === "solicitacao" && STATUS_FASE_SOLICITACAO.includes(despesa.status);
}

function tipoLabelDe(despesa: MaloteDespesaRow): string {
  if (despesa.origem === "solicitacao") return aindaESolicitacao(despesa) ? "Solicitação" : "Despesa";
  return ORIGEM_LABEL[despesa.origem] ?? despesa.origem;
}

// SIS-2026-0236: nível pode ter mais de um aprovador — mostra o primeiro
// + indicador "+N" (mesmo padrão de ClassificacoesMalote.tsx/OrcamentoGeral.tsx).
function formatarAprovadores(nomes: string[] | undefined): string | null {
  if (!nomes || nomes.length === 0) return null;
  return nomes.length > 1 ? `${nomes[0]} +${nomes.length - 1}` : nomes[0];
}

function aprovadorPendente(despesa: MaloteDespesaRow): string | null {
  if (despesa.status !== "pendente_aprovacao" || !despesa.nivel_aprovacao_atual) return null;
  const c = despesa.classificacao;
  if (!c) return null;
  if (despesa.nivel_aprovacao_atual === 1) return formatarAprovadores(c.aprovador1_nomes);
  if (despesa.nivel_aprovacao_atual === 2) return formatarAprovadores(c.aprovador2_nomes);
  return formatarAprovadores(c.aprovador3_nomes);
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
      const { despesa, parcela } = item;
      if (tab === "solicitacoes" && !aindaESolicitacao(despesa)) return false;
      if (tab === "despesas" && aindaESolicitacao(despesa)) return false;
      if (!itemMatchesChip(item, chip)) return false;
      if (classificacaoId && despesa.classificacao_id !== classificacaoId) return false;
      if (empresaId && despesa.empresa_id !== empresaId) return false;
      if (excecao === "sim" && !despesa.excecao) return false;
      if (excecao === "nao" && despesa.excecao) return false;
      const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
      if (periodoInicio && (!dataPagamento || dataPagamento < periodoInicio)) return false;
      if (periodoFim && (!dataPagamento || dataPagamento > periodoFim)) return false;
      if (busca.trim()) {
        const alvo = `${despesa.numero} ${despesa.nome}`.toLowerCase();
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

  function abrirItem(despesa: MaloteDespesaRow) {
    if (despesa.origem === "solicitacao" && STATUS_FASE_SOLICITACAO.includes(despesa.status)) {
      navigate(`/app/malote/solicitacao/${despesa.id}`);
    } else if (despesa.origem === "solicitacao" && despesa.status === "cotacao_aprovada") {
      navigate(`/app/malote/criar-despesa?solicitacaoId=${despesa.id}`);
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
                const { despesa, parcela } = item;
                const aprovador = aprovadorPendente(despesa);
                const status = statusEfetivo(item);
                const valor = parcela ? parcela.valor : despesa.valor_total;
                const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
                return (
                  <TableRow key={`${despesa.id}-${parcela?.id ?? "unica"}`} className="cursor-pointer" onClick={() => abrirItem(despesa)}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        <ListChecks className="h-3.5 w-3.5 text-muted-foreground" /> {tipoLabelDe(despesa)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {despesa.numero}
                      {parcela && <span className="text-muted-foreground"> ({parcela.numero_parcela}/{despesa.numero_parcelas})</span>}
                    </TableCell>
                    <TableCell>{dataPagamento ? new Date(dataPagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                    <TableCell>{despesa.classificacao?.nome ?? "—"}</TableCell>
                    <TableCell className="font-medium">{despesa.nome}</TableCell>
                    <TableCell>{empresas.find((e) => e.id === despesa.empresa_id)?.nome ?? "—"}</TableCell>
                    <TableCell>{despesa.forma_pagamento ?? "—"}</TableCell>
                    <TableCell>{Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE_CLASS[status]}>
                        {STATUS_LABEL[status]}
                        {status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? ` N${despesa.nivel_aprovacao_atual}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{aprovador ?? "—"}</TableCell>
                    <TableCell>
                      {despesa.excecao ? <span className="text-red-600 dark:text-red-400 text-sm">Sim</span> : <span className="text-muted-foreground text-sm">Não</span>}
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
