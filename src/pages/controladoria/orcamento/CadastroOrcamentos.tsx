import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Pencil, Plus, Settings2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useClassificacoesOrcamento, usePlanejamentosOrcamento, TipoClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { getStatusVigencia, STATUS_LABEL, STATUS_BADGE_CLASS, fmtMoney, fmtDate, OrcamentoComStatus } from "./utils";
import { OrcamentoFormModal } from "./OrcamentoFormModal";

const ORIGEM_LABEL: Record<TipoClassificacaoOrcamento, string> = {
  contrato: "Contrato",
  administrativo: "Administrativo",
};

function fmtAprovador(nome: string | null | undefined, limitePct: number | null | undefined) {
  if (!nome) return "—";
  return limitePct != null ? `${nome} — até ${limitePct}%` : nome;
}

function AprovadorHeadTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        O percentual é o limite da alçada de aprovação desse aprovador sobre o valor do orçamento.
      </TooltipContent>
    </Tooltip>
  );
}

// Tabela tem muitas colunas de aprovador (1/2/3 + solicitação) — mostrar só
// o primeiro nome evita o scroll lateral; nome completo + alçada fica no
// tooltip pra não perder informação.
function AprovadorCell({ nome, limitePct }: { nome: string | null | undefined; limitePct?: number | null }) {
  if (!nome) return <span className="text-muted-foreground">—</span>;
  const primeiroNome = nome.split(" ")[0];
  const label = limitePct != null ? `${primeiroNome} ${limitePct}%` : primeiroNome;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{fmtAprovador(nome, limitePct)}</TooltipContent>
    </Tooltip>
  );
}

export default function CadastroOrcamentos() {
  const { data: empresaId } = useEmpresaId();
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: orcamentos = [], isLoading } = usePlanejamentosOrcamento(empresaId);

  const [filtroClassificacao, setFiltroClassificacao] = useState("todas");
  const [filtroOrigem, setFiltroOrigem] = useState("todas");
  const [filtroResponsavel, setFiltroResponsavel] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroInicio, setFiltroInicio] = useState("");
  const [filtroFim, setFiltroFim] = useState("");
  const [busca, setBusca] = useState("");

  const responsaveis = useMemo(
    () => [...new Set(classificacoes.map((c) => c.setor_responsavel).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [classificacoes]
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<OrcamentoComStatus | null>(null);

  const comStatus: OrcamentoComStatus[] = useMemo(
    () => orcamentos.map((o) => ({ ...o, status: getStatusVigencia(o.inicio_vigencia, o.fim_vigencia) })),
    [orcamentos]
  );

  const stats = useMemo(() => {
    const naVigencia = comStatus.filter((o) => o.status === "na_vigencia");
    const entrarao = comStatus.filter((o) => o.status === "entrara_em_vigencia");
    const historico = comStatus.filter((o) => o.status === "historico");
    const valorTotal = naVigencia.reduce((s, o) => s + Number(o.valor || 0), 0);
    const mediaMensal = naVigencia.length > 0 ? valorTotal / naVigencia.length : 0;
    return { naVigencia: naVigencia.length, entrarao: entrarao.length, historico: historico.length, valorTotal, mediaMensal };
  }, [comStatus]);

  const filtrados = useMemo(() => {
    return comStatus
      .filter((o) => {
        if (filtroClassificacao !== "todas" && o.classificacao_id !== filtroClassificacao) return false;
        if (filtroOrigem !== "todas" && o.classificacao?.tipo !== filtroOrigem) return false;
        if (filtroResponsavel !== "todos" && o.classificacao?.setor_responsavel !== filtroResponsavel) return false;
        if (filtroStatus !== "todos" && o.status !== filtroStatus) return false;
        if (filtroInicio && o.fim_vigencia < filtroInicio) return false;
        if (filtroFim && o.inicio_vigencia > filtroFim) return false;
        if (busca) {
          const alvo = `${o.classificacao?.nome ?? ""} ${o.detalhe}`.toLowerCase();
          if (!alvo.includes(busca.toLowerCase())) return false;
        }
        return true;
      })
      .sort((a, b) => b.inicio_vigencia.localeCompare(a.inicio_vigencia));
  }, [comStatus, filtroClassificacao, filtroOrigem, filtroResponsavel, filtroStatus, filtroInicio, filtroFim, busca]);

  function abrirNovo() {
    setEditando(null);
    setModalOpen(true);
  }

  function abrirEditar(row: OrcamentoComStatus) {
    setEditando(row);
    setModalOpen(true);
  }

  function limparFiltros() {
    setFiltroClassificacao("todas");
    setFiltroOrigem("todas");
    setFiltroResponsavel("todos");
    setFiltroStatus("todos");
    setFiltroInicio("");
    setFiltroFim("");
    setBusca("");
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Orçamento Administrativo"
        subtitle="Visualize e gerencie todos os orçamentos cadastrados."
        module="Controladoria & Orçamento"
        breadcrumb={["Orçamento", "Orçamento Administrativo"]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/controladoria/cadastro-classificacao">
                <Settings2 className="h-4 w-4 mr-2" />
                Classificações
              </Link>
            </Button>
            <Button onClick={abrirNovo}>
              <Plus className="h-4 w-4 mr-2" />
              Novo Orçamento
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Na vigência</CardDescription>
            <CardTitle className="text-3xl">{stats.naVigencia}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Vão entrar em vigência</CardDescription>
            <CardTitle className="text-3xl">{stats.entrarao}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Histórico</CardDescription>
            <CardTitle className="text-3xl">{stats.historico}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valor total orçado</CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(stats.valorTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Média mensal orçada</CardDescription>
            <CardTitle className="text-2xl">{fmtMoney(stats.mediaMensal)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">Filtros</CardTitle>
          <Button variant="outline" size="sm" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <div>
            <Label className="text-xs">Classificação</Label>
            <Select value={filtroClassificacao} onValueChange={setFiltroClassificacao}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {classificacoes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Origem</Label>
            <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="contrato">Contrato</SelectItem>
                <SelectItem value="administrativo">Administrativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Responsável</Label>
            <Select value={filtroResponsavel} onValueChange={setFiltroResponsavel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {responsaveis.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="na_vigencia">{STATUS_LABEL.na_vigencia}</SelectItem>
                <SelectItem value="entrara_em_vigencia">{STATUS_LABEL.entrara_em_vigencia}</SelectItem>
                <SelectItem value="historico">{STATUS_LABEL.historico}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Início do período</Label>
            <Input type="date" value={filtroInicio} onChange={(e) => setFiltroInicio(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Fim do período</Label>
            <Input type="date" value={filtroFim} onChange={(e) => setFiltroFim(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Buscar</Label>
            <Input
              placeholder="Classificação ou detalhe..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lista de Orçamentos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classificação</TableHead>
                <TableHead>Detalhe</TableHead>
                <TableHead>Requer Solicitação?</TableHead>
                <TableHead>Aprovador da Solicitação</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Aprovador 1 <AprovadorHeadTooltip />
                  </span>
                </TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Aprovador 2 <AprovadorHeadTooltip />
                  </span>
                </TableHead>
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Aprovador 3 <AprovadorHeadTooltip />
                  </span>
                </TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                    Nenhum orçamento encontrado.
                  </TableCell>
                </TableRow>
              )}
              {filtrados.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.classificacao?.nome ?? "-"}</TableCell>
                  <TableCell>{o.detalhe}</TableCell>
                  <TableCell>
                    <Badge variant={o.classificacao?.requer_solicitacao ? "default" : "outline"}>
                      {o.classificacao?.requer_solicitacao ? "Sim" : "Não"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {o.classificacao?.requer_solicitacao ? (
                      <AprovadorCell nome={o.classificacao?.aprovador_solicitacao_nome} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{o.classificacao?.tipo ? ORIGEM_LABEL[o.classificacao.tipo] : "—"}</TableCell>
                  <TableCell>{o.classificacao?.setor_responsavel ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <AprovadorCell nome={o.classificacao?.aprovador1_nome} limitePct={o.classificacao?.aprovador1_limite_pct} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <AprovadorCell nome={o.classificacao?.aprovador2_nome} limitePct={o.classificacao?.aprovador2_limite_pct} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <AprovadorCell nome={o.classificacao?.aprovador3_nome} limitePct={o.classificacao?.aprovador3_limite_pct} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fmtDate(o.inicio_vigencia)} – {fmtDate(o.fim_vigencia)}
                  </TableCell>
                  <TableCell>{fmtMoney(o.valor)}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE_CLASS[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {o.status !== "historico" && (
                      <Button variant="ghost" size="icon" onClick={() => abrirEditar(o)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OrcamentoFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        empresaId={empresaId ?? null}
        classificacoes={classificacoes}
        orcamentos={comStatus}
        editando={editando}
      />
    </div>
  );
}
