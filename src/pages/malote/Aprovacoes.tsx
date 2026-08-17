import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, ChevronLeft, ChevronRight, Hourglass, AlertTriangle, XCircle, FileText, Users, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  useItensAprovacoesMalote,
  useNomeUsuario,
  useEmpresasGrupo,
  useContratosAtivos,
  aprovadorDoNivel,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_FASE_SOLICITACAO,
  StatusDespesa,
  MaloteDespesaRow,
  TipoSolicitacao,
} from "@/hooks/useMaloteDespesa";

const TIPO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

const PAGE_SIZE = 10;

interface TileInfo {
  label: string;
  status?: StatusDespesa;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  cor: "amber" | "sky" | "violet" | "emerald" | "red" | "blue";
}

const COR_TILE: Record<TileInfo["cor"], string> = {
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
  emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
  red: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
};

const COR_TILE_CARD: Record<TileInfo["cor"], string> = {
  amber: "border-amber-200 bg-amber-50/70 hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/20 dark:hover:bg-amber-950/30",
  sky: "border-sky-200 bg-sky-50/70 hover:bg-sky-100/70 dark:border-sky-900 dark:bg-sky-950/20 dark:hover:bg-sky-950/30",
  violet: "border-violet-200 bg-violet-50/70 hover:bg-violet-100/70 dark:border-violet-900 dark:bg-violet-950/20 dark:hover:bg-violet-950/30",
  emerald: "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/70 dark:border-emerald-900 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30",
  red: "border-red-200 bg-red-50/70 hover:bg-red-100/70 dark:border-red-900 dark:bg-red-950/20 dark:hover:bg-red-950/30",
  blue: "border-blue-200 bg-blue-50/70 hover:bg-blue-100/70 dark:border-blue-900 dark:bg-blue-950/20 dark:hover:bg-blue-950/30",
};

const COR_TILE_TEXTO: Record<TileInfo["cor"], string> = {
  amber: "text-amber-700 dark:text-amber-400",
  sky: "text-sky-700 dark:text-sky-400",
  violet: "text-violet-700 dark:text-violet-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  red: "text-red-700 dark:text-red-400",
  blue: "text-blue-700 dark:text-blue-400",
};

function GrupoTiles({ titulo, tiles, ativo, onClick }: { titulo: string; tiles: TileInfo[]; ativo: StatusDespesa | ""; onClick: (s: StatusDespesa | "") => void }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold">{titulo}</p>
        <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
          {tiles.map((t) => {
            const Icon = t.icon;
            const selecionado = !!t.status && ativo === t.status;
            return (
              <button
                key={t.label}
                type="button"
                onClick={() => onClick(selecionado ? "" : t.status ?? "")}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-colors",
                  selecionado ? "border-primary bg-primary/10 ring-1 ring-primary" : COR_TILE_CARD[t.cor]
                )}
              >
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", COR_TILE[t.cor])}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-lg font-bold leading-none">{t.count}</span>
                <span className={cn("text-[10px] leading-tight font-medium", COR_TILE_TEXTO[t.cor])}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Aprovacoes() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: itens = [], isLoading } = useItensAprovacoesMalote();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [status, setStatus] = useState<StatusDespesa | "">("");
  const [tipo, setTipo] = useState<TipoSolicitacao | "">("");
  const [classificacao, setClassificacao] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [excecao, setExcecao] = useState<"" | "sim" | "nao">("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);

  const empresasMap = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const contratosMap = useMemo(() => new Map(contratos.map((c) => [c.id, c.nome])), [contratos]);
  const contratosDaEmpresa = useMemo(
    () => (empresaId ? contratos.filter((c) => c.empresa_id === empresaId) : contratos),
    [contratos, empresaId]
  );
  const classificacoesDisponiveis = useMemo(() => {
    const nomes = new Set<string>();
    itens.forEach((d) => d.classificacao?.nome && nomes.add(d.classificacao.nome));
    return Array.from(nomes).sort();
  }, [itens]);

  function limparFiltros() {
    setDataDe("");
    setDataAte("");
    setStatus("");
    setTipo("");
    setClassificacao("");
    setEmpresaId("");
    setContratoId("");
    setExcecao("");
    setBusca("");
    setPagina(1);
  }

  function setStatusFiltro(s: StatusDespesa | "") {
    setStatus(s);
    setPagina(1);
  }

  const filtrados = useMemo(() => {
    return itens.filter((d) => {
      if (status && d.status !== status) return false;
      if (tipo && d.tipo !== tipo) return false;
      if (classificacao && d.classificacao?.nome !== classificacao) return false;
      if (empresaId && d.empresa_id !== empresaId) return false;
      if (contratoId && d.contrato_id !== contratoId) return false;
      if (excecao === "sim" && !d.excecao) return false;
      if (excecao === "nao" && d.excecao) return false;
      if (dataDe && d.updated_at < dataDe) return false;
      if (dataAte && d.updated_at > dataAte + "T23:59:59") return false;
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (!d.numero.toLowerCase().includes(q) && !d.nome.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [itens, status, tipo, classificacao, empresaId, contratoId, excecao, dataDe, dataAte, busca]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE);

  function contar(s: StatusDespesa) {
    return itens.filter((d) => d.status === s).length;
  }

  const minhasPendentes = itens.filter(
    (d) => d.status === "pendente_aprovacao" && d.nivel_aprovacao_atual != null && aprovadorDoNivel(d, d.nivel_aprovacao_atual) === user?.id
  ).length;
  const outrasPendentes = contar("pendente_aprovacao") - minhasPendentes;

  const tilesSolicitacoes: TileInfo[] = [
    { label: STATUS_LABEL.aguardando_aprovacao_inicial, status: "aguardando_aprovacao_inicial", count: contar("aguardando_aprovacao_inicial"), icon: Hourglass, cor: "violet" },
    { label: STATUS_LABEL.aguardando_cotacao, status: "aguardando_cotacao", count: contar("aguardando_cotacao"), icon: Hourglass, cor: "sky" },
    { label: "Cotação pendente", status: "cotacao_realizada", count: contar("cotacao_realizada"), icon: FileText, cor: "amber" },
    { label: STATUS_LABEL.cotacao_aprovada, status: "cotacao_aprovada", count: contar("cotacao_aprovada"), icon: CheckCircle2, cor: "emerald" },
    { label: "Cotação/solicitação reprovada", status: "solicitacao_reprovada", count: contar("solicitacao_reprovada"), icon: XCircle, cor: "red" },
  ];

  const tilesDespesas: TileInfo[] = [
    { label: "Aguardando minha aprovação", status: "pendente_aprovacao", count: minhasPendentes, icon: Users, cor: "amber" },
    { label: "Pendente aprovação (outros níveis)", count: outrasPendentes, icon: Hourglass, cor: "sky" },
    { label: STATUS_LABEL.necessidade_de_ajuste, status: "necessidade_de_ajuste", count: contar("necessidade_de_ajuste"), icon: AlertTriangle, cor: "amber" },
    { label: STATUS_LABEL.aguardando_pagamento, status: "aguardando_pagamento", count: contar("aguardando_pagamento"), icon: Hourglass, cor: "blue" },
    { label: STATUS_LABEL.despesa_paga, status: "despesa_paga", count: contar("despesa_paga"), icon: CheckCircle2, cor: "emerald" },
    { label: STATUS_LABEL.despesa_reprovada, status: "despesa_reprovada", count: contar("despesa_reprovada"), icon: XCircle, cor: "red" },
  ];

  function abrirItem(despesa: MaloteDespesaRow) {
    const tela = STATUS_FASE_SOLICITACAO.includes(despesa.status) ? "solicitacao" : "despesa";
    navigate(tela === "solicitacao" ? `/app/malote/solicitacao/${despesa.id}` : `/app/malote/despesa/${despesa.id}`);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Aprovações do Malote"
        subtitle="Itens de despesas e solicitações que aguardam ou passaram pela sua aprovação."
        module="Malote"
        breadcrumb={["Malote", "Aprovações"]}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Data de</Label>
              <Input type="date" className="h-8 text-xs" value={dataDe} onChange={(e) => { setDataDe(e.target.value); setPagina(1); }} />
            </div>
            <div>
              <Label className="text-xs">Data até</Label>
              <Input type="date" className="h-8 text-xs" value={dataAte} onChange={(e) => { setDataAte(e.target.value); setPagina(1); }} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status || "todas"} onValueChange={(v) => { setStatusFiltro(v === "todas" ? "" : (v as StatusDespesa)); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {(Object.entries(STATUS_LABEL) as [StatusDespesa, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={tipo || "todos"} onValueChange={(v) => { setTipo(v === "todos" ? "" : (v as TipoSolicitacao)); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {(Object.entries(TIPO_LABEL) as [TipoSolicitacao, string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Select value={classificacao || "todas"} onValueChange={(v) => { setClassificacao(v === "todas" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {classificacoesDisponiveis.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={empresaId || "todas"} onValueChange={(v) => { setEmpresaId(v === "todas" ? "" : v); setContratoId(""); setPagina(1); }}>
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
              <Label className="text-xs">Contrato</Label>
              <Select value={contratoId || "todos"} onValueChange={(v) => { setContratoId(v === "todos" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {contratosDaEmpresa.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Exceção</Label>
              <Select value={excecao || "todas"} onValueChange={(v) => { setExcecao(v === "todas" ? "" : (v as "sim" | "nao")); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="sim">Sim</SelectItem>
                  <SelectItem value="nao">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 sm:col-span-3 lg:col-span-4">
              <Label className="text-xs">Buscar por nº ou nome</Label>
              <Input className="h-8 text-xs" placeholder="Buscar por nº da despesa ou nome..." value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GrupoTiles titulo="Solicitações (cotação)" tiles={tilesSolicitacoes} ativo={status} onClick={setStatusFiltro} />
        <GrupoTiles titulo="Despesas" tiles={tilesDespesas} ativo={status} onClick={setStatusFiltro} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nº</TableHead>
                  <TableHead>Nome / Motivo</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Empresa / Contrato</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                  <TableHead>Data de Pagamento</TableHead>
                  <TableHead>Solicitante</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Exceção</TableHead>
                  <TableHead>Última atualização</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && visiveis.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                        Nenhum item encontrado com os filtros atuais.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {visiveis.map((despesa) => (
                  <LinhaItem
                    key={despesa.id}
                    despesa={despesa}
                    nomeEmpresa={empresasMap.get(despesa.empresa_id)}
                    nomeContrato={despesa.contrato_id ? contratosMap.get(despesa.contrato_id) : undefined}
                    onAbrir={() => abrirItem(despesa)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {filtrados.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
              <span>
                Mostrando {(paginaAtual - 1) * PAGE_SIZE + 1}–{Math.min(paginaAtual * PAGE_SIZE, filtrados.length)} de {filtrados.length} itens
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={paginaAtual <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="font-medium">Página {paginaAtual} de {totalPaginas}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LinhaItem({
  despesa,
  nomeEmpresa,
  nomeContrato,
  onAbrir,
}: {
  despesa: MaloteDespesaRow;
  nomeEmpresa?: string;
  nomeContrato?: string;
  onAbrir: () => void;
}) {
  const { data: solicitanteNome } = useNomeUsuario(despesa.created_by);
  const isSolicitacao = STATUS_FASE_SOLICITACAO.includes(despesa.status);
  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onAbrir}>
      <TableCell className="text-sm">{isSolicitacao ? "Solicitação" : "Despesa"}</TableCell>
      <TableCell className="font-mono text-xs">{despesa.numero}</TableCell>
      <TableCell className="text-sm">
        <p>{despesa.nome}</p>
        {despesa.motivo && <p className="text-xs text-muted-foreground">{despesa.motivo}</p>}
      </TableCell>
      <TableCell className="text-sm">{despesa.classificacao?.nome ?? "—"}</TableCell>
      <TableCell className="text-sm">
        <p>{nomeEmpresa ?? "—"}</p>
        {nomeContrato && <p className="text-xs text-muted-foreground">{nomeContrato}</p>}
      </TableCell>
      <TableCell className="text-right text-sm">
        {Number(despesa.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </TableCell>
      <TableCell className="text-sm">{despesa.data_pagamento ? new Date(despesa.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
      <TableCell className="text-sm">{solicitanteNome ?? "—"}</TableCell>
      <TableCell>
        <Badge className={STATUS_BADGE_CLASS[despesa.status]}>
          {STATUS_LABEL[despesa.status]}
          {despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? ` N${despesa.nivel_aprovacao_atual}` : ""}
        </Badge>
      </TableCell>
      <TableCell className="text-sm">{despesa.excecao ? "Sim" : "Não"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{new Date(despesa.updated_at).toLocaleString("pt-BR")}</TableCell>
    </TableRow>
  );
}
