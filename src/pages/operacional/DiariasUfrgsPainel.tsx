import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileSpreadsheet,
  MoreVertical,
  PenLine,
  RotateCcw,
  Search,
  Tags,
  Wallet,
} from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import {
  mensagemErroDiaria,
  useCriarDiariaUfrgs,
  useDecidirDiariaUfrgs,
  useDiariasUfrgs,
  useEditarDiariaUfrgs,
  useEnviarMaloteUfrgs,
  useEventosUfrgs,
  useExcluirDiariaUfrgs,
  useLotacoesUfrgs,
  usePostosUfrgs,
  useRegistrarVisualizacaoUfrgs,
  useRemoverTarifaUfrgs,
  useSalvarTarifaUfrgs,
  useSolicitarAjusteUfrgs,
  useTarifasUfrgs,
  useVisualizacoesUfrgs,
} from "@/hooks/useDiariasUfrgs";
import { DiariaUfrgsModal, ModoModalUfrgs, PermissoesDiaria } from "./DiariaUfrgsModal";
import { TarifasUfrgsModal } from "./TarifasUfrgsModal";
import {
  DiariaUfrgs,
  STATUS_SOLICITACAO,
  StatusSolicitacao,
  brlDeCentavos,
  fmtData,
  sindicatosUfrgs,
  tituloColuna,
  visivelNaLista,
} from "./diariasUfrgs";
import { exportarDiariasUfrgs, hojeIso } from "./exportarDiarias";

/**
 * A lista de Diárias UFRGS — o painel que aparece nas TRÊS rotas quando o
 * filtro de tipo está em "Diárias UFRGS".
 *
 * As colunas são as da planilha, na ordem dela, com os títulos vindos de
 * COLUNAS_UFRGS (a mesma constante que o modal e a exportação usam). A tela é
 * a planilha: quem já trabalha no Excel encontra as colunas onde espera.
 *
 * Os dois botões de exportar são o pedido literal — "um botão de exportar
 * tudo e outro botão de exportar filtrado" — e os dois geram o MESMO layout
 * (ver exportarDiarias.ts); o que muda é só o conjunto de linhas.
 */

export interface PainelUfrgsProps {
  /** Código de menu da rota — é dele que saem os flags de acesso. */
  menuCodigo: string;
  /** true na rota de Encarregados: a lista mostra só o que a pessoa criou. */
  apenasMinhas: boolean;
  permissoes: PermissoesDiaria;
  podeExportar: boolean;
  /** Vira true quando o menu "Criar diária" pede uma UFRGS nova. */
  abrirNova: boolean;
  onNovaConsumida: () => void;
}

interface StatProps {
  icon: typeof ClipboardList;
  label: string;
  value: string;
  tone: "primary" | "warning" | "info" | "success" | "muted";
}

function StatCard({ icon: Icon, label, value, tone }: StatProps) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    muted: "bg-muted text-muted-foreground",
  };
  const fundo = { primary: "", warning: "bg-warning/5", info: "bg-info/5", success: "", muted: "" };
  return (
    <Card className={cn("flex items-center gap-3 p-4", fundo[tone])}>
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          tones[tone],
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-2xl font-bold leading-none">{value}</p>
      </div>
    </Card>
  );
}

/**
 * Célula de leitura da tabela. No topo do módulo pelo mesmo motivo dos campos
 * do modal: componente declarado dentro do pai remonta a cada render.
 */
function Col({ children, className }: { children: React.ReactNode; className?: string }) {
  return <TableCell className={className}>{children}</TableCell>;
}

export function DiariasUfrgsPainel({
  menuCodigo,
  apenasMinhas,
  permissoes,
  podeExportar,
  abrirNova,
  onNovaConsumida,
}: PainelUfrgsProps) {
  const { toast } = useToast();
  const { user } = useAuth();

  const {
    data: diarias = [],
    isLoading,
    isError,
    error,
  } = useDiariasUfrgs(apenasMinhas);
  const { data: lotacoes = [] } = useLotacoesUfrgs();
  const { data: postos = [] } = usePostosUfrgs();
  const { data: tarifas = [] } = useTarifasUfrgs();

  const criar = useCriarDiariaUfrgs();
  const editar = useEditarDiariaUfrgs();
  const salvarTarifa = useSalvarTarifaUfrgs();
  const removerTarifa = useRemoverTarifaUfrgs();
  const decidir = useDecidirDiariaUfrgs();
  const enviarMalote = useEnviarMaloteUfrgs();
  const pedirAjuste = useSolicitarAjusteUfrgs();
  const excluir = useExcluirDiariaUfrgs();
  const registrarVisualizacao = useRegistrarVisualizacaoUfrgs();

  // Filtros
  const [busca, setBusca] = useState("");
  const [sindicato, setSindicato] = useState("todos");
  const [lotacao, setLotacao] = useState("todas");
  const [posto, setPosto] = useState("todos");
  const [status, setStatus] = useState("todos");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  const [modal, setModal] = useState<{ modo: ModoModalUfrgs; d: DiariaUfrgs | null } | null>(null);
  // A tabela de tarifas é um modal IRMÃO do da diária, não um aninhado: os
  // dois podem ficar abertos ao mesmo tempo (abrir as tarifas de dentro de
  // uma diária não faz perder o que já estava preenchido nela), e quem tem as
  // mutações e a lista de diárias do aviso de impacto é o painel.
  const [tarifasAbertas, setTarifasAbertas] = useState(false);

  /** Os sindicatos do filtro saem da TABELA, não de uma constante — ver sindicatosUfrgs(). */
  const sindicatosDisponiveis = useMemo(() => sindicatosUfrgs(tarifas), [tarifas]);

  const limparFiltros = () => {
    setBusca("");
    setSindicato("todos");
    setLotacao("todas");
    setPosto("todos");
    setStatus("todos");
    setDe("");
    setAte("");
    setPagina(1);
  };

  // O menu "Criar diária" fica no cabeçalho da tela (é um só para os dois
  // tipos), então o pedido de "nova UFRGS" chega por prop e é consumido aqui.
  useEffect(() => {
    if (!abrirNova) return;
    setModal({ modo: "nova", d: null });
    onNovaConsumida();
  }, [abrirNova, onNovaConsumida]);

  // Cards de resumo — sempre sobre a base inteira, como na diária de diarista.
  const resumo = useMemo(() => {
    // "Paga" continua sendo uma diária aprovada: entra no card e no valor.
    const aprovadas = diarias.filter((d) => d.status === "aprovada" || d.status === "paga");
    // A excluída sai de TODOS os números: ela existe só como histórico, e
    // contá-la faria o total divergir da lista abaixo.
    const vivas = diarias.filter((d) => d.status !== "excluida");
    return {
      total: vivas.length,
      solicitadas: vivas.filter((d) => d.status === "solicitada").length,
      emAjuste: vivas.filter((d) => d.status === "em_ajuste").length,
      aprovadas: aprovadas.length,
      valorFaturar: aprovadas.reduce((a, d) => a + d.valorFaturarCentavos, 0),
    };
  }, [diarias]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const casaBusca = (d: DiariaUfrgs) =>
      !termo ||
      d.id.toLowerCase().includes(termo) ||
      d.motoristaNome.toLowerCase().includes(termo) ||
      d.matricula.toLowerCase().includes(termo) ||
      d.numeroOficio.toLowerCase().includes(termo) ||
      d.destino.toLowerCase().includes(termo) ||
      d.fiscal.toLowerCase().includes(termo);

    return diarias.filter((d) => {
      // Exclusão lógica: some da lista de trabalho e só reaparece quando
      // alguém filtra por "Excluída" de propósito.
      if (!visivelNaLista(d, status)) return false;
      if (!casaBusca(d)) return false;
      if (sindicato !== "todos" && d.sindicato !== sindicato) return false;
      if (lotacao !== "todas" && d.lotacao !== lotacao) return false;
      if (posto !== "todos" && d.posto !== posto) return false;
      if (status !== "todos" && d.status !== status) return false;
      // O período filtra pela SAÍDA — é a data que organiza o relatório.
      if (de && d.saida < de) return false;
      if (ate && d.saida > ate) return false;
      return true;
    });
  }, [diarias, busca, sindicato, lotacao, posto, status, de, ate]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;
  const visiveis = filtradas.slice(inicio, inicio + porPagina);

  const paginasVisiveis = useMemo(() => {
    if (totalPaginas <= 7) return Array.from({ length: totalPaginas }, (_, i) => i + 1);
    const p: (number | "...")[] = [1, 2, 3, 4, 5];
    if (paginaAtual > 5 && paginaAtual < totalPaginas - 1)
      p.splice(0, 5, 1, "...", paginaAtual, "...");
    return [...p, "...", totalPaginas] as (number | "...")[];
  }, [totalPaginas, paginaAtual]);

  const abrir = (d: DiariaUfrgs) => {
    // "mostre nos logs os usuários que visualizaram aquela diária,
    // independente da rota" — o carimbo é de quem ABRE. A RPC só grava a
    // primeira vez de cada pessoa.
    registrarVisualizacao.mutate(d.uuid);
    // O dono de uma diária devolvida cai direto no formulário: é dele para
    // corrigir. Todo o resto abre em leitura, com as ações no rodapé.
    const modo: ModoModalUfrgs =
      d.status === "em_ajuste" && d.solicitanteId === user?.id && permissoes.incluir
        ? "editar"
        : "visualizar";
    setModal({ modo, d });
  };

  // A notificação de "diária UFRGS para ajustar" leva para
  // ...?tipo=ufrgs&diaria=<uuid>. Abrir a diária certa é o que faz a
  // notificação valer a pena; sem isso ela largaria a pessoa numa lista.
  const [params, setParams] = useSearchParams();
  const idDaUrl = params.get("diaria");
  const [linkConsumido, setLinkConsumido] = useState<string | null>(null);
  useEffect(() => {
    if (!idDaUrl || idDaUrl === linkConsumido || diarias.length === 0) return;
    setLinkConsumido(idDaUrl);
    const alvo = diarias.find((d) => d.uuid === idDaUrl);
    if (alvo) abrir(alvo);
    else
      toast({
        title: "Diária não encontrada",
        description: "Ela pode ter sido excluída ou não estar visível para você.",
        variant: "destructive",
      });
    // O parâmetro sai da URL depois de usado: recarregar a página não pode
    // reabrir um modal que a pessoa já fechou.
    const limpo = new URLSearchParams(params);
    limpo.delete("diaria");
    setParams(limpo, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda uma vez por id; incluir `abrir`/`params` reabriria o modal a cada render.
  }, [idDaUrl, linkConsumido, diarias]);

  const { data: visualizacoes = [] } = useVisualizacoesUfrgs(modal?.d?.uuid);
  const { data: eventos = [] } = useEventosUfrgs(modal?.d?.uuid);

  const salvando =
    criar.isPending ||
    editar.isPending ||
    decidir.isPending ||
    enviarMalote.isPending ||
    pedirAjuste.isPending ||
    excluir.isPending;

  const exportar = (linhas: DiariaUfrgs[], sufixo: string) => {
    if (linhas.length === 0) {
      toast({
        title: "Nada para exportar",
        description: "Nenhuma diária UFRGS no conjunto escolhido.",
        variant: "destructive",
      });
      return;
    }
    try {
      exportarDiariasUfrgs(linhas, {
        nomeArquivo: `diarias-ufrgs-${sufixo}-${hojeIso()}`,
        empresa: linhas[0]?.contratoEmpresa,
        contrato: linhas[0]?.contratoNome,
        postos,
        tarifas,
      });
      toast({
        title: "Excel gerado",
        description: `${linhas.length} ${linhas.length === 1 ? "diária" : "diárias"} no relatório.`,
      });
    } catch (e: unknown) {
      toast({
        title: "Não foi possível gerar o Excel",
        description: mensagemErroDiaria(e, "Erro ao montar a planilha."),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {/* Cards de resumo */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={ClipboardList} label="Total de diárias" value={String(resumo.total)} tone="primary" />
        <StatCard icon={CalendarCheck2} label="Solicitadas" value={String(resumo.solicitadas)} tone="warning" />
        <StatCard
          icon={PenLine}
          label={apenasMinhas ? "Para você ajustar" : "Em ajuste"}
          value={String(resumo.emAjuste)}
          tone="info"
        />
        <StatCard icon={CheckCircle2} label="Aprovadas" value={String(resumo.aprovadas)} tone="success" />
        <StatCard
          icon={Wallet}
          label="Valor à faturar aprovado"
          value={`R$ ${brlDeCentavos(resumo.valorFaturar)}`}
          tone="muted"
        />
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
                placeholder="Nº, motorista, matrícula, ofício, destino ou fiscal..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="w-44 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {tituloColuna("sindicato")}
            </Label>
            <Select
              value={sindicato}
              onValueChange={(v) => {
                setSindicato(v);
                setPagina(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {sindicatosDisponiveis.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-36 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {tituloColuna("lotacao")}
            </Label>
            <Select
              value={lotacao}
              onValueChange={(v) => {
                setLotacao(v);
                setPagina(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {lotacoes.map((l) => (
                  <SelectItem key={l.lotacao} value={l.lotacao}>
                    {l.lotacao}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-32 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              {tituloColuna("posto")}
            </Label>
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
                {postos.map((p) => (
                  <SelectItem key={p.codigo} value={p.codigo}>
                    {p.codigo}
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
            <Label className="text-xs font-medium text-muted-foreground">Data de saída</Label>
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

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={limparFiltros}>
              <RotateCcw className="mr-2 h-4 w-4" /> Limpar filtros
            </Button>
            {/* O mesmo modal que o botão do bloco 1 da diária abre. Existe
                também aqui porque atualizar a tabela de um sindicato é uma
                tarefa por si — quem faz isso não precisa abrir uma diária
                qualquer antes só para chegar no botão. */}
            {permissoes.editarTarifas && (
              <Button variant="outline" onClick={() => setTarifasAbertas(true)}>
                <Tags className="mr-2 h-4 w-4" /> Tarifas dos sindicatos
              </Button>
            )}
            {podeExportar && (
              <>
                <Button variant="outline" onClick={() => exportar(diarias, "completo")}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar tudo
                </Button>
                <Button variant="outline" onClick={() => exportar(filtradas, "filtrado")}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar filtrado
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Tabela — as colunas da planilha, na ordem dela */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Diárias UFRGS</h2>
          <p className="text-[11px] text-muted-foreground">
            As colunas são as mesmas da planilha de pagamento — o Excel exportado sai no layout do
            relatório.
          </p>
        </div>
        <div className="w-full overflow-x-auto">
          <Table className="w-full table-auto text-xs [&_td]:px-2 [&_td]:py-2.5 [&_th]:h-10 [&_th]:px-2 [&_th]:text-[11px]">
            <TableHeader>
              <TableRow>
                <TableHead>{tituloColuna("item")}</TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>{tituloColuna("matricula")}</TableHead>
                <TableHead>{tituloColuna("motoristaNome")}</TableHead>
                <TableHead>{tituloColuna("sindicato")}</TableHead>
                <TableHead>{tituloColuna("lotacao")}</TableHead>
                <TableHead>{tituloColuna("numeroOficio")}</TableHead>
                <TableHead>{tituloColuna("saida")}</TableHead>
                <TableHead>{tituloColuna("retorno")}</TableHead>
                <TableHead>{tituloColuna("destino")}</TableHead>
                <TableHead>{tituloColuna("dataDeposito")}</TableHead>
                <TableHead>{tituloColuna("posto")}</TableHead>
                <TableHead className="text-right">{tituloColuna("qtHospedagem")}</TableHead>
                <TableHead className="text-right">{tituloColuna("qtCafe")}</TableHead>
                <TableHead className="text-right">{tituloColuna("qtAlmoco")}</TableHead>
                <TableHead className="text-right">{tituloColuna("qtJanta")}</TableHead>
                <TableHead className="text-right">{tituloColuna("valorTotal")}</TableHead>
                <TableHead className="text-right">{tituloColuna("valorVa")}</TableHead>
                <TableHead className="text-right">{tituloColuna("valorLiquido")}</TableHead>
                <TableHead className="text-right">{tituloColuna("tributos")}</TableHead>
                <TableHead className="text-right">{tituloColuna("valorFaturar")}</TableHead>
                <TableHead>{tituloColuna("fiscal")}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={24} className="py-10 text-center text-sm text-muted-foreground">
                    {isLoading
                      ? "Carregando diárias UFRGS..."
                      : isError
                        ? mensagemErroDiaria(error, "Não foi possível carregar as diárias UFRGS.")
                        : "Nenhuma diária UFRGS encontrada com os filtros aplicados."}
                  </TableCell>
                </TableRow>
              )}
              {visiveis.map((d, i) => {
                const st = STATUS_SOLICITACAO[d.status];
                return (
                  <TableRow key={d.uuid} className="cursor-pointer" onClick={() => abrir(d)}>
                    {/* "Item" é a posição na lista, como na planilha. */}
                    <Col className="whitespace-nowrap text-muted-foreground">{inicio + i + 1}</Col>
                    <Col className="whitespace-nowrap font-medium">{d.id}</Col>
                    <Col className="whitespace-nowrap">{d.matricula || "—"}</Col>
                    <Col className="min-w-[9rem]">{d.motoristaNome}</Col>
                    <Col className="whitespace-nowrap">{d.sindicato}</Col>
                    <Col className="whitespace-nowrap">{d.lotacao}</Col>
                    <Col className="whitespace-nowrap">{d.numeroOficio}</Col>
                    <Col className="whitespace-nowrap">{fmtData(d.saida)}</Col>
                    <Col className="whitespace-nowrap">{fmtData(d.retorno)}</Col>
                    <Col className="min-w-[8rem]">{d.destino}</Col>
                    <Col className="whitespace-nowrap">
                      {d.dataDeposito ? (
                        fmtData(d.dataDeposito)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Col>
                    <Col className="whitespace-nowrap">{d.posto || "—"}</Col>
                    <Col className="text-right">{d.qtHospedagem}</Col>
                    <Col className="text-right">{d.qtCafe}</Col>
                    <Col className="text-right">{d.qtAlmoco}</Col>
                    <Col className="text-right">{d.qtJanta}</Col>
                    <Col className="text-right tabular-nums">{brlDeCentavos(d.valorTotalCentavos)}</Col>
                    <Col className="text-right tabular-nums">{brlDeCentavos(d.valorVaCentavos)}</Col>
                    <Col
                      className={cn(
                        "text-right tabular-nums",
                        d.valorLiquidoCentavos < 0 && "text-destructive",
                      )}
                    >
                      {brlDeCentavos(d.valorLiquidoCentavos)}
                    </Col>
                    <Col className="text-right tabular-nums">{brlDeCentavos(d.tributosCentavos)}</Col>
                    <Col className="text-right font-medium tabular-nums">
                      {brlDeCentavos(d.valorFaturarCentavos)}
                    </Col>
                    <Col className="min-w-[9rem]">{d.fiscal || "—"}</Col>
                    <Col>
                      <Badge variant="outline" className={cn("text-[10px] font-semibold", st.cls)}>
                        {st.label}
                      </Badge>
                    </Col>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => abrir(d)}
                          aria-label={`Abrir ${d.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Mais ações"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => abrir(d)}>
                              Abrir diária
                            </DropdownMenuItem>
                            {permissoes.incluir &&
                              (d.status === "solicitada" || d.status === "em_ajuste") && (
                                <DropdownMenuItem
                                  onClick={() => {
                                    registrarVisualizacao.mutate(d.uuid);
                                    setModal({ modo: "editar", d });
                                  }}
                                >
                                  Editar diária
                                </DropdownMenuItem>
                              )}
                            <DropdownMenuItem
                              onClick={() => {
                                navigator.clipboard?.writeText(d.id);
                                toast({ title: "Nº copiado", description: d.id });
                              }}
                            >
                              Copiar nº
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
            {filtradas.length === 0
              ? "Nenhuma diária"
              : `Mostrando ${inicio + 1} a ${Math.min(inicio + porPagina, filtradas.length)} de ${filtradas.length} diárias`}
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
        <DiariaUfrgsModal
          aberto
          modo={modal.modo}
          diaria={modal.d}
          existentes={diarias}
          salvando={salvando}
          visualizacoes={visualizacoes}
          eventos={eventos}
          permissoes={permissoes}
          souOSolicitante={!!modal.d && modal.d.solicitanteId === user?.id}
          onEditarTarifas={() => setTarifasAbertas(true)}
          onFechar={() => setModal(null)}
          onPedirEdicao={(d) => setModal({ modo: "editar", d })}
          onSalvar={async (nova) => {
            try {
              const { numero } = await criar.mutateAsync(nova);
              setModal(null);
              toast({
                title: "Diária UFRGS salva",
                description: `${numero} entrou na lista com status Solicitada.`,
              });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível salvar",
                description: mensagemErroDiaria(e, "Erro ao gravar a diária."),
                variant: "destructive",
              });
            }
          }}
          onEditar={async (dados) => {
            if (!modal.d) return;
            try {
              await editar.mutateAsync({ ...dados, uuid: modal.d.uuid });
              const voltouParaFila = modal.d.status === "em_ajuste";
              setModal(null);
              toast({
                title: voltouParaFila ? "Diária reenviada" : "Diária atualizada",
                description: voltouParaFila
                  ? `${modal.d.id} voltou para a fila com status Solicitada.`
                  : `${modal.d.id} foi atualizada.`,
              });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível salvar",
                description: mensagemErroDiaria(e, "Erro ao gravar a edição."),
                variant: "destructive",
              });
            }
          }}
          onDecidir={async (uuid, novoStatus) => {
            try {
              await decidir.mutateAsync({ id: uuid, status: novoStatus });
              setModal(null);
              toast(
                novoStatus === "aprovada"
                  ? {
                      title: "Diária aprovada",
                      description: "Ela já pode ser enviada para o malote.",
                    }
                  : { title: "Diária reprovada", variant: "destructive" },
              );
            } catch (e: unknown) {
              toast({
                title: "Não foi possível decidir",
                description: mensagemErroDiaria(e, "Erro ao registrar a decisão."),
                variant: "destructive",
              });
            }
          }}
          onEnviarMalote={async (uuid, despesa) => {
            try {
              const { anexosComFalha, falhas } = await enviarMalote.mutateAsync({
                id: uuid,
                despesa,
              });
              setModal(null);
              toast({
                title: "Enviada para o Malote",
                description: anexosComFalha
                  ? `A despesa foi criada, mas um ou mais anexos falharam${falhas.length ? ` (${falhas.join(", ")})` : ""}. Reenvie os arquivos pelo Malote.`
                  : "A despesa entrou na fila de aprovação do Malote.",
                variant: anexosComFalha ? "destructive" : undefined,
              });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível enviar para o malote",
                description: mensagemErroDiaria(e, "Erro ao criar a despesa."),
                variant: "destructive",
              });
            }
          }}
          onSolicitarAjuste={async (uuid, motivo) => {
            try {
              await pedirAjuste.mutateAsync({ id: uuid, motivo });
              setModal(null);
              toast({
                title: "Devolvida para ajuste",
                description: `${modal.d?.solicitante ?? "Quem lançou"} foi notificado do que precisa mudar.`,
              });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível devolver para ajuste",
                description: mensagemErroDiaria(e, "Erro ao solicitar o ajuste."),
                variant: "destructive",
              });
            }
          }}
          onExcluir={async (uuid, motivo) => {
            try {
              await excluir.mutateAsync({ id: uuid, motivo });
              setModal(null);
              toast({
                title: "Diária excluída",
                description: "Ela sai da lista, mas continua no histórico.",
              });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível excluir",
                description: mensagemErroDiaria(e, "Erro ao excluir a diária."),
                variant: "destructive",
              });
            }
          }}
        />
      )}

      {/* Tarifas dos sindicatos — o pedido de 22/09/2026. A RPC é quem valida
          e quem recalcula as diárias em aberto; aqui só se conta o resultado,
          porque "mudei e não sei o que aconteceu" é o que faz a pessoa
          desconfiar da tela e voltar a pedir por chamado. */}
      <TarifasUfrgsModal
        aberto={tarifasAbertas}
        tarifas={tarifas}
        diarias={diarias}
        sindicatoFoco={modal?.d?.sindicato}
        salvando={salvarTarifa.isPending || removerTarifa.isPending}
        onFechar={() => setTarifasAbertas(false)}
        onSalvar={async (r) => {
          try {
            const res = await salvarTarifa.mutateAsync(r);
            toast({
              title: res.criada
                ? `Tarifa de ${r.sindicato} criada`
                : `Tarifa de ${r.sindicato} corrigida`,
              description:
                (res.criada
                  ? `Vale a partir de ${fmtData(r.vigenciaInicio)}. `
                  : `A tabela de ${fmtData(r.vigenciaInicio)} foi atualizada. `) +
                (res.recalculadas > 0
                  ? `${res.recalculadas} ${res.recalculadas === 1 ? "diária em aberto foi recalculada" : "diárias em aberto foram recalculadas"}.`
                  : "Nenhuma diária em aberto precisou ser recalculada.") +
                (res.congeladas > 0
                  ? ` ${res.congeladas} já aprovada(s) ou paga(s) continuam com o valor faturado.`
                  : ""),
            });
          } catch (e: unknown) {
            toast({
              title: "Não foi possível salvar a tarifa",
              description: mensagemErroDiaria(e, "Erro ao gravar a tarifa."),
              variant: "destructive",
            });
          }
        }}
        onRemover={async (id) => {
          try {
            const recalculadas = await removerTarifa.mutateAsync(id);
            toast({
              title: "Vigência removida",
              description:
                recalculadas > 0
                  ? `${recalculadas} ${recalculadas === 1 ? "diária em aberto voltou" : "diárias em aberto voltaram"} para a tabela anterior.`
                  : "Nenhuma diária em aberto usava esta tabela.",
            });
          } catch (e: unknown) {
            toast({
              title: "Não foi possível remover",
              description: mensagemErroDiaria(e, "Erro ao remover a vigência."),
              variant: "destructive",
            });
          }
        }}
      />
    </>
  );
}
