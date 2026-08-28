import { useMemo, useState } from "react";
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ModoModalDiaria, SolicitacaoDiariaModal } from "./SolicitacaoDiariaModal";
import {
  CONTRATOS_DISPONIVEIS,
  POSTOS_DISPONIVEIS,
  STATUS_SOLICITACAO,
  SolicitacaoDiaria,
  StatusSolicitacao,
  fmtBRL,
  fmtData,
  labelTurno,
  soDigitos,
  valorTotalLinha,
  valorTotalSolicitacao,
} from "./diarias";

/** Uma linha da tabela = uma diária dentro de uma solicitação (tela 1.1). */
interface LinhaTabela {
  chave: string;
  solicitacao: SolicitacaoDiaria;
  data: string;
  turno: string;
  qtVt: number;
  valorUnitVt: number;
  valorDiaria: number;
  valorTotal: number;
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ClipboardList;
  label: string;
  value: string;
  tone: "primary" | "warning" | "success" | "muted";
}) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
    success: "bg-success/10 text-success",
    muted: "bg-muted text-muted-foreground",
  };
  const fundo = {
    primary: "",
    warning: "bg-warning/5",
    success: "",
    muted: "",
  };
  return (
    <Card className={cn("flex items-center gap-3 p-4", fundo[tone])}>
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-bold leading-none">{value}</p>
      </div>
    </Card>
  );
}

export default function ControleDiarias() {
  const { toast } = useToast();
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoDiaria[]>([]);

  // Filtros
  const [busca, setBusca] = useState("");
  const [contrato, setContrato] = useState("todos");
  const [posto, setPosto] = useState("todos");
  const [status, setStatus] = useState("todos");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  // Paginação
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);

  // Modal
  const [modal, setModal] = useState<{ modo: ModoModalDiaria; s: SolicitacaoDiaria | null } | null>(
    null,
  );

  const limparFiltros = () => {
    setBusca("");
    setContrato("todos");
    setPosto("todos");
    setStatus("todos");
    setDe("");
    setAte("");
    setPagina(1);
  };

  // Cards de resumo — sempre sobre a base inteira, como nas telas aprovadas.
  const resumo = useMemo(() => {
    const aprovadas = solicitacoes.filter((s) => s.status === "aprovada");
    return {
      total: solicitacoes.length,
      solicitadas: solicitacoes.filter((s) => s.status !== "aprovada").length,
      aprovadas: aprovadas.length,
      valorAprovado: aprovadas.reduce((acc, s) => acc + valorTotalSolicitacao(s), 0),
    };
  }, [solicitacoes]);

  const linhas = useMemo<LinhaTabela[]>(() => {
    const termo = busca.trim().toLowerCase();
    const termoDigitos = soDigitos(busca);

    const casaBusca = (s: SolicitacaoDiaria) => {
      if (!termo) return true;
      if (s.id.toLowerCase().includes(termo)) return true;
      if (s.faltanteNome.toLowerCase().includes(termo)) return true;
      if (s.diaristaNome.toLowerCase().includes(termo)) return true;
      if (termoDigitos.length >= 3) {
        if (soDigitos(s.faltanteCpf).includes(termoDigitos)) return true;
        if (soDigitos(s.diaristaCpf).includes(termoDigitos)) return true;
      }
      return false;
    };

    const out: LinhaTabela[] = [];
    for (const s of solicitacoes) {
      if (!casaBusca(s)) continue;
      if (contrato !== "todos" && s.contratoId !== contrato) continue;
      if (posto !== "todos" && s.posto !== posto) continue;
      if (status !== "todos" && s.status !== status) continue;
      for (const l of s.diarias) {
        if (de && l.data < de) continue;
        if (ate && l.data > ate) continue;
        out.push({
          chave: `${s.id}-${l.id}`,
          solicitacao: s,
          data: l.data,
          turno: labelTurno(l.turno),
          qtVt: l.qtVt,
          valorUnitVt: l.valorUnitVt,
          valorDiaria: l.valorDiaria,
          valorTotal: valorTotalLinha(l),
        });
      }
    }
    return out;
  }, [solicitacoes, busca, contrato, posto, status, de, ate]);

  const totalPaginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const visiveis = linhas.slice(inicio, inicio + porPagina);

  const paginasVisiveis = useMemo(() => {
    if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i + 1);
    const p: (number | "...")[] = [1, 2, 3, 4, 5];
    if (paginaAtual > 5 && paginaAtual < totalPaginas - 1) p.splice(0, 5, 1, "...", paginaAtual, "...");
    return [...p, "...", totalPaginas] as (number | "...")[];
  }, [totalPaginas, paginaAtual]);

  const proximoId = useMemo(() => {
    const maior = solicitacoes.reduce((acc, s) => Math.max(acc, Number(s.id.split("-").pop()) || 0), 0);
    return `SD-2025-${String(maior + 1).padStart(6, "0")}`;
  }, [solicitacoes]);

  const abrir = (s: SolicitacaoDiaria) =>
    setModal({ modo: s.status === "solicitada" ? "aprovar" : "visualizar", s });

  const postosDisponiveis =
    contrato === "todos"
      ? POSTOS_DISPONIVEIS
      : (CONTRATOS_DISPONIVEIS.find((c) => c.id === contrato)?.postos ?? POSTOS_DISPONIVEIS);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controle de Diárias"
        subtitle="Gerencie as solicitações de pagamento de diárias."
        module="Operacional"
        breadcrumb={["Controle de Diárias"]}
      />

      {/* Cards de resumo */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={ClipboardList} label="Total de solicitações" value={String(resumo.total)} tone="primary" />
        <StatCard icon={CalendarCheck2} label="Solicitadas" value={String(resumo.solicitadas)} tone="warning" />
        <StatCard icon={CheckCircle2} label="Aprovadas" value={String(resumo.aprovadas)} tone="success" />
        <StatCard icon={Wallet} label="Valor total aprovado" value={`R$ ${fmtBRL(resumo.valorAprovado)}`} tone="muted" />
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Pesquisar</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setPagina(1);
                }}
                placeholder="Pesquisar por ID, nome ou CPF..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="w-40 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Contrato</Label>
            <Select
              value={contrato}
              onValueChange={(v) => {
                setContrato(v);
                setPosto("todos");
                setPagina(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {CONTRATOS_DISPONIVEIS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.numero}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Posto</Label>
            <Select
              value={posto}
              onValueChange={(v) => {
                setPosto(v);
                setPagina(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {postosDisponiveis.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPagina(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {(Object.keys(STATUS_SOLICITACAO) as StatusSolicitacao[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {STATUS_SOLICITACAO[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Data da diária</Label>
            <div className="flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                type="date"
                value={de}
                onChange={(e) => {
                  setDe(e.target.value);
                  setPagina(1);
                }}
                className="w-36"
                aria-label="Início do período"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="date"
                value={ate}
                onChange={(e) => {
                  setAte(e.target.value);
                  setPagina(1);
                }}
                className="w-36"
                aria-label="Fim do período"
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={limparFiltros}>
              <RotateCcw className="mr-2 h-4 w-4" /> Limpar filtros
            </Button>
            <Button onClick={() => setModal({ modo: "nova", s: null })}>
              <Plus className="mr-2 h-4 w-4" /> Solicitação de pagamento de diária
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Lista de solicitações de diárias</h2>
        </div>
        {/* A tabela tem 16 colunas: em vez de fixar uma largura mínima grande
            (que obrigaria a rolar a página para o lado em telas menores ou com
            zoom), ela encolhe junto com a viewport — fonte e respiro menores,
            e os textos longos quebram em vez de esticar a coluna. */}
        <div className="w-full overflow-x-auto">
          <Table className="w-full table-auto text-xs [&_td]:px-2 [&_td]:py-2.5 [&_th]:h-10 [&_th]:px-2 [&_th]:text-[11px]">
            <TableHeader>
              <TableRow>
                <TableHead>ID da Solicitação</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead>Posto</TableHead>
                <TableHead>Nome do Faltante</TableHead>
                <TableHead>CPF do Faltante</TableHead>
                <TableHead>Nome do Diarista</TableHead>
                <TableHead>CPF do Diarista</TableHead>
                <TableHead>Pix</TableHead>
                <TableHead>Data da Diária</TableHead>
                <TableHead>Turno</TableHead>
                <TableHead className="text-right">Qt VT</TableHead>
                <TableHead className="text-right">Valor Unit VT (R$)</TableHead>
                <TableHead className="text-right">Valor Diária (R$)</TableHead>
                <TableHead className="text-right">Valor Total (R$)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={16} className="py-10 text-center text-sm text-muted-foreground">
                    Nenhuma solicitação encontrada com os filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
              {visiveis.map((l) => {
                const st = STATUS_SOLICITACAO[l.solicitacao.status];
                return (
                  <TableRow
                    key={l.chave}
                    className="cursor-pointer"
                    onClick={() => abrir(l.solicitacao)}
                  >
                    <TableCell className="whitespace-nowrap font-medium">{l.solicitacao.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.solicitacao.contratoId}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.solicitacao.posto}</TableCell>
                    <TableCell className="min-w-[7rem]">{l.solicitacao.faltanteNome}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.solicitacao.faltanteCpf}</TableCell>
                    <TableCell className="min-w-[7rem]">{l.solicitacao.diaristaNome}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.solicitacao.diaristaCpf}</TableCell>
                    <TableCell className="break-all">{l.solicitacao.pix}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtData(l.data)}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.turno}</TableCell>
                    <TableCell className="text-right">{l.qtVt}</TableCell>
                    <TableCell className="text-right">{fmtBRL(l.valorUnitVt)}</TableCell>
                    <TableCell className="text-right">{fmtBRL(l.valorDiaria)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtBRL(l.valorTotal)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] font-semibold", st.cls)}>
                        {st.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => abrir(l.solicitacao)}
                          aria-label={`Abrir ${l.solicitacao.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais ações">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => abrir(l.solicitacao)}>
                              Abrir solicitação
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                navigator.clipboard?.writeText(l.solicitacao.id);
                                toast({ title: "ID copiado", description: l.solicitacao.id });
                              }}
                            >
                              Copiar ID
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Rodapé / paginação */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {linhas.length === 0
              ? "Nenhuma solicitação"
              : `Mostrando ${inicio + 1} a ${Math.min(inicio + porPagina, linhas.length)} de ${linhas.length} solicitações`}
          </p>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={paginaAtual === 1}
              onClick={() => setPagina(paginaAtual - 1)}
              aria-label="Página anterior"
            >
              ‹
            </Button>
            {paginasVisiveis.map((p, i) =>
              p === "..." ? (
                <span key={`e${i}`} className="px-1.5 text-xs text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === paginaAtual ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8 text-xs"
                  onClick={() => setPagina(p)}
                >
                  {p}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={paginaAtual === totalPaginas}
              onClick={() => setPagina(paginaAtual + 1)}
              aria-label="Próxima página"
            >
              ›
            </Button>
          </div>

          <Select
            value={String(porPagina)}
            onValueChange={(v) => {
              setPorPagina(Number(v));
              setPagina(1);
            }}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} por página
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {modal && (
        <SolicitacaoDiariaModal
          aberto
          modo={modal.modo}
          solicitacao={modal.s}
          existentes={solicitacoes}
          proximoId={proximoId}
          solicitanteAtual="Iury de Jesus Silva"
          onFechar={() => setModal(null)}
          onSalvar={(nova) => {
            setSolicitacoes((p) => [nova, ...p]);
            setModal(null);
            toast({
              title: "Solicitação salva",
              description: `${nova.id} entrou na lista com status Solicitada.`,
            });
          }}
          onAprovar={(id, motivo, dataPagamento) => {
            setSolicitacoes((p) =>
              p.map((s) =>
                s.id === id
                  ? { ...s, status: "aprovada", maloteMotivo: motivo, maloteDataPagamento: dataPagamento }
                  : s,
              ),
            );
            setModal(null);
            toast({ title: "Solicitação aprovada", description: `${id} foi enviada para o Malote.` });
          }}
          onReprovar={(id) => {
            setSolicitacoes((p) => p.map((s) => (s.id === id ? { ...s, status: "reprovada" } : s)));
            setModal(null);
            toast({ title: "Solicitação reprovada", description: id, variant: "destructive" });
          }}
        />
      )}
    </div>
  );
}
