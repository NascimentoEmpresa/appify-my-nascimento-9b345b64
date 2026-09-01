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
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { CheckCircle2, ChevronLeft, ChevronRight, Hourglass, AlertTriangle, XCircle, ClipboardCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useItensAprovacoesMalote,
  useNomeUsuario,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  StatusDespesa,
  MaloteDespesaRow,
  ItemLinhaMalote,
} from "@/hooks/useMaloteDespesa";

// SIS-2026-0160: fila do Financeiro — só os estágios de pagamento
// (aguardando_pagamento em diante). Itens anteriores (cotação/aprovação)
// não são relevantes aqui, ao contrário de Aprovações do Malote.
const STATUS_PAGAMENTO: StatusDespesa[] = ["ajuste_pagamento", "aguardando_pagamento", "pronto_para_pagar", "despesa_reprovada", "despesa_paga"];

// SIS-2026-0223: despesa parcelada vira N linhas (1 por parcela) a partir de
// "aguardando_pagamento" — pronto_para_pagar/ajuste_pagamento continuam
// sendo decisão sobre a despesa inteira (parcela só tem pendente/paga); só
// aguardando_pagamento/despesa_paga refletem o progresso real de cada
// parcela.
function statusEfetivo(item: ItemLinhaMalote): StatusDespesa {
  if (item.parcela && (item.despesa.status === "aguardando_pagamento" || item.despesa.status === "despesa_paga")) {
    return item.parcela.status === "paga" ? "despesa_paga" : "aguardando_pagamento";
  }
  return item.despesa.status;
}

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

function GrupoTiles({ tiles, ativo, onClick }: { tiles: TileInfo[]; ativo: StatusDespesa | ""; onClick: (s: StatusDespesa | "") => void }) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
      {tiles.map((t) => {
        const Icon = t.icon;
        const selecionado = !!t.status && ativo === t.status;
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => onClick(selecionado ? "" : t.status ?? "")}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors",
              selecionado ? "border-primary bg-primary/10 ring-1 ring-primary" : COR_TILE_CARD[t.cor]
            )}
          >
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", COR_TILE[t.cor])}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-xl font-bold leading-none">{t.count}</span>
            <span className={cn("text-[11px] leading-tight font-medium", COR_TILE_TEXTO[t.cor])}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function OpcaoResponsavel({ id }: { id: string }) {
  const { data: nome } = useNomeUsuario(id);
  return <SelectItem value={id}>{nome ?? id}</SelectItem>;
}

export default function PagamentoMalote() {
  const navigate = useNavigate();
  const { data: todosItens = [], isLoading } = useItensAprovacoesMalote();
  const itens = useMemo(() => todosItens.filter((item) => STATUS_PAGAMENTO.includes(item.despesa.status)), [todosItens]);

  // SIS-2026-0285 (Iury): filtro de data puxava só de "Última atualização" —
  // agora tem os dois períodos, independentes (E lógico quando os dois
  // estão preenchidos).
  const [dataAtualizacaoDe, setDataAtualizacaoDe] = useState("");
  const [dataAtualizacaoAte, setDataAtualizacaoAte] = useState("");
  const [dataPagamentoDe, setDataPagamentoDe] = useState("");
  const [dataPagamentoAte, setDataPagamentoAte] = useState("");
  const [status, setStatus] = useState<StatusDespesa | "">("");
  const [classificacao, setClassificacao] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);

  const classificacoesDisponiveis = useMemo(() => {
    const nomes = new Set<string>();
    itens.forEach((item) => item.despesa.classificacao?.nome && nomes.add(item.despesa.classificacao.nome));
    return Array.from(nomes).sort();
  }, [itens]);

  const responsaveisDisponiveis = useMemo(() => {
    return Array.from(new Set(itens.map((item) => item.despesa.created_by)));
  }, [itens]);

  function limparFiltros() {
    setDataAtualizacaoDe("");
    setDataAtualizacaoAte("");
    setDataPagamentoDe("");
    setDataPagamentoAte("");
    setStatus("");
    setClassificacao("");
    setResponsavelId("");
    setBusca("");
    setPagina(1);
  }

  function setStatusFiltro(s: StatusDespesa | "") {
    setStatus(s);
    setPagina(1);
  }

  const filtrados = useMemo(() => {
    return itens.filter((item) => {
      const d = item.despesa;
      if (status && statusEfetivo(item) !== status) return false;
      if (classificacao && d.classificacao?.nome !== classificacao) return false;
      if (responsavelId && d.created_by !== responsavelId) return false;
      if (dataAtualizacaoDe && d.updated_at < dataAtualizacaoDe) return false;
      if (dataAtualizacaoAte && d.updated_at > dataAtualizacaoAte + "T23:59:59") return false;
      if (dataPagamentoDe || dataPagamentoAte) {
        const dp = item.parcela ? item.parcela.data_pagamento_real ?? item.parcela.data_vencimento : d.data_pagamento;
        if (dataPagamentoDe && (!dp || dp < dataPagamentoDe)) return false;
        if (dataPagamentoAte && (!dp || dp > dataPagamentoAte)) return false;
      }
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (!d.numero.toLowerCase().includes(q) && !d.nome.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [itens, status, classificacao, responsavelId, dataAtualizacaoDe, dataAtualizacaoAte, dataPagamentoDe, dataPagamentoAte, busca]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE);

  function contar(s: StatusDespesa) {
    return itens.filter((item) => statusEfetivo(item) === s).length;
  }

  const tiles: TileInfo[] = [
    { label: STATUS_LABEL.ajuste_pagamento, status: "ajuste_pagamento", count: contar("ajuste_pagamento"), icon: AlertTriangle, cor: "amber" },
    { label: STATUS_LABEL.aguardando_pagamento, status: "aguardando_pagamento", count: contar("aguardando_pagamento"), icon: Hourglass, cor: "blue" },
    { label: STATUS_LABEL.pronto_para_pagar, status: "pronto_para_pagar", count: contar("pronto_para_pagar"), icon: ClipboardCheck, cor: "violet" },
    { label: STATUS_LABEL.despesa_reprovada, status: "despesa_reprovada", count: contar("despesa_reprovada"), icon: XCircle, cor: "red" },
    { label: STATUS_LABEL.despesa_paga, status: "despesa_paga", count: contar("despesa_paga"), icon: CheckCircle2, cor: "emerald" },
  ];

  function abrirItem(despesa: MaloteDespesaRow) {
    navigate(`/app/malote/despesa/${despesa.id}`);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Pagamento Malote"
        subtitle="Acompanhe os itens que estão aguardando pagamento, que já foram pagos ou que necessitam de ajuste."
        module="Malote"
        breadcrumb={["Malote", "Pagamento Malote"]}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <DateRangeFilter
              label="Última atualização"
              de={dataAtualizacaoDe}
              ate={dataAtualizacaoAte}
              onChange={(de, ate) => { setDataAtualizacaoDe(de); setDataAtualizacaoAte(ate); setPagina(1); }}
            />
            <DateRangeFilter
              label="Data de pagamento"
              de={dataPagamentoDe}
              ate={dataPagamentoAte}
              onChange={(de, ate) => { setDataPagamentoDe(de); setDataPagamentoAte(ate); setPagina(1); }}
            />
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
              <Label className="text-xs">Status</Label>
              <Select value={status || "todos"} onValueChange={(v) => { setStatusFiltro(v === "todos" ? "" : (v as StatusDespesa)); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {STATUS_PAGAMENTO.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Responsável</Label>
              <Select value={responsavelId || "todos"} onValueChange={(v) => { setResponsavelId(v === "todos" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {responsaveisDisponiveis.map((id) => (
                    <OpcaoResponsavel key={id} id={id} />
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Nome / Histórico</Label>
              <Input className="h-8 text-xs" placeholder="Buscar por nº ID ou nome..." value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <GrupoTiles tiles={tiles} ativo={status} onClick={setStatusFiltro} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº ID</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Data de Pagamento</TableHead>
                  <TableHead>Nome / Histórico</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                  <TableHead>Forma de Pagamento</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Atualizado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && visiveis.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                        Nenhum item encontrado com os filtros atuais.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {visiveis.map((item) => (
                  <LinhaItem key={`${item.despesa.id}-${item.parcela?.id ?? "unica"}`} item={item} onAbrir={() => abrirItem(item.despesa)} />
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

function LinhaItem({ item, onAbrir }: { item: ItemLinhaMalote; onAbrir: () => void }) {
  const { despesa, parcela } = item;
  const { data: solicitanteNome } = useNomeUsuario(despesa.created_by);
  const status = statusEfetivo(item);
  const valor = parcela ? parcela.valor : despesa.valor_aprovado ?? despesa.valor_total;
  const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
  return (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onAbrir}>
      <TableCell className="font-mono text-xs">{despesa.numero}</TableCell>
      <TableCell className="text-sm">
        {parcela ? `${parcela.numero_parcela}/${despesa.numero_parcelas}` : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-sm">{dataPagamento ? new Date(dataPagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
      <TableCell className="text-sm">
        <p>{despesa.nome}</p>
        {despesa.motivo && <p className="text-xs text-muted-foreground">{despesa.motivo}</p>}
      </TableCell>
      <TableCell className="text-sm">{despesa.classificacao?.nome ?? "—"}</TableCell>
      <TableCell className="text-right text-sm">
        {Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </TableCell>
      <TableCell className="text-sm">{despesa.forma_pagamento ?? "—"}</TableCell>
      <TableCell className="text-sm">{solicitanteNome ?? "—"}</TableCell>
      <TableCell>
        <Badge className={STATUS_BADGE_CLASS[status]}>{STATUS_LABEL[status]}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{new Date(despesa.updated_at).toLocaleString("pt-BR")}</TableCell>
    </TableRow>
  );
}
