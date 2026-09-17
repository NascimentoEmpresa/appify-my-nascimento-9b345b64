import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  MoreVertical,
  PenLine,
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
import { useAuth } from "@/hooks/useAuth";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  mensagemErroDiaria,
  useAjustarSolicitacaoDiaria,
  useContratosDiaria,
  useCriarSolicitacaoDiaria,
  useDecidirSolicitacaoDiaria,
  useExcluirSolicitacaoDiaria,
  usePostosDiaria,
  useRegistrarVisualizacaoDiaria,
  useSolicitacoesDiaria,
  useSolicitarAjusteDiaria,
  useVisualizacoesDiaria,
} from "@/hooks/useDiarias";
import { ModoModalDiaria, SolicitacaoDiariaModal } from "./SolicitacaoDiariaModal";
import {
  STATUS_SOLICITACAO,
  SolicitacaoDiaria,
  StatusSolicitacao,
  fmtBRL,
  fmtData,
  labelTipoPix,
  labelTurno,
  soDigitos,
  valorTotalLinha,
  valorTotalSolicitacao,
  visivelNaLista,
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
  tone: "primary" | "warning" | "info" | "success" | "muted";
}) {
  const tones = {
    primary: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
    info: "bg-info/10 text-info",
    success: "bg-success/10 text-success",
    muted: "bg-muted text-muted-foreground",
  };
  const fundo = {
    primary: "",
    warning: "bg-warning/5",
    info: "bg-info/5",
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

// A mesma tela atende duas portas: /app/operacional/diarias (Operacional) e
// /app/encarregados/diarias (Encarregados). Cada porta tem seu próprio código
// de menu, porque a permissão da sidebar é casada por rota — ver o comentário
// da rota em App.tsx e a migration 20260930000065.
type MenuDiarias = "operacional_diarias" | "encarregados_diarias";

export default function ControleDiarias({
  menuCodigo = "operacional_diarias",
}: { menuCodigo?: MenuDiarias } = {}) {
  const { toast } = useToast();
  const { user } = useAuth();
  // A porta de Encarregados é "minhas solicitações": ela mostra só o que o
  // próprio usuário criou, e isso é da ROTA, não da permissão. A RLS já
  // recorta o usuário externo (que não tem `operacional_diarias`), mas quem
  // tem os dois menus entrava por aqui e via a base inteira — que é
  // exatamente o que o pedido de 16/09/2026 diz que não pode acontecer.
  const apenasMinhas = menuCodigo === "encarregados_diarias";
  const {
    data: solicitacoes = [],
    isLoading,
    isError: falhaSolicitacoes,
    error: erroSolicitacoes,
  } = useSolicitacoesDiaria(apenasMinhas);
  const { data: contratos = [] } = useContratosDiaria();
  const criar = useCriarSolicitacaoDiaria();
  const decidir = useDecidirSolicitacaoDiaria();
  const ajustar = useAjustarSolicitacaoDiaria();
  const pedirAjuste = useSolicitarAjusteDiaria();
  const excluir = useExcluirSolicitacaoDiaria();
  const registrarVisualizacao = useRegistrarVisualizacaoDiaria();
  // Aprovar é SEMPRE do Operacional, nunca do menu da porta pela qual a tela
  // foi aberta — por isso o código aqui é fixo, e não `menuCodigo`. O toggle
  // padrão do Gerenciamento de Acesso grava o pacote inteiro
  // (visualizar/incluir/alterar/aprovar/exportar, ACOES_DO_TOGGLE_PADRAO em
  // ModulosMenusTab.tsx), então ligar a chave de Encarregados grava um
  // 'aprovar' que o backend deliberadamente ignora: diaria_pode() nega
  // 'aprovar' para `encarregados_diarias`, e diaria_guard() só reconhece
  // `operacional_diarias`. Se este hook seguisse `menuCodigo`, o encarregado
  // veria os botões de aprovar/reprovar e levaria erro do banco ao clicar.
  //
  // 16/09/2026: e agora a permissão também EXISTE no painel de acesso. Antes
  // não havia switch de 'aprovar' em Diária nenhuma (nenhum dos dois menus
  // tinha linha em `app_menu_acao`), então ligar a tela do Operacional ligava
  // junto o poder de decidir — não dava para liberar "só para conferir".
  // Ver 20260930000153.
  const { data: podeAprovar = false } = useScreenAccess("operacional_diarias", "aprovar");
  // Excluir é ação própria, fora do pacote do toggle: quem confere e quem
  // decide não são necessariamente quem pode apagar da lista.
  const { data: podeExcluir = false } = useScreenAccess("operacional_diarias", "excluir");
  // Mas a porta de Encarregados nunca decide, tenha o usuário a permissão que
  // tiver: aquela rota é de quem SOLICITA. Um admin abrindo-a por engano não
  // pode ver botão de aprovar ali.
  const podeDecidir = podeAprovar && !apenasMinhas;
  const podeExcluirAqui = podeExcluir && !apenasMinhas;

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
    // "Paga" continua sendo uma diária aprovada — entra no card e no valor.
    const aprovadas = solicitacoes.filter((s) => s.status === "aprovada" || s.status === "paga");
    // A excluída sai de TODOS os números: ela existe só como histórico, e
    // contá-la faria "Total de solicitações" divergir da lista abaixo.
    const vivas = solicitacoes.filter((s) => s.status !== "excluida");
    return {
      total: vivas.length,
      solicitadas: vivas.filter((s) => s.status === "solicitada").length,
      emAjuste: vivas.filter((s) => s.status === "em_ajuste").length,
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
      // Exclusão lógica: some da lista de trabalho e só reaparece quando
      // alguém filtra por "Excluída" de propósito.
      if (!visivelNaLista(s, status)) continue;
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

  /**
   * Com que cara a solicitação abre.
   *
   * "ajustar" vem primeiro porque é o único modo que pertence ao DONO: uma
   * solicitação devolvida é dele para corrigir, mesmo que ele também tenha
   * permissão de aprovar (caso do funcionário interno que lançou a própria).
   */
  const modoDe = (s: SolicitacaoDiaria): ModoModalDiaria => {
    if (s.status === "em_ajuste" && s.solicitanteId === user?.id) return "ajustar";
    if (s.status === "solicitada" && podeDecidir && s.solicitanteId !== user?.id) return "aprovar";
    return "visualizar";
  };

  const abrir = (s: SolicitacaoDiaria) => {
    // "Qualquer usuário que entrar nela" — o carimbo é de quem ABRE, não de
    // quem decide. A RPC só grava a primeira vez de cada pessoa.
    registrarVisualizacao.mutate(s.uuid);
    setModal({ modo: modoDe(s), s });
  };

  // Notificação de "diária para ajustar" leva para
  // /app/encarregados/diarias?solicitacao=<uuid>. Abrir a solicitação certa é
  // o que faz a notificação valer a pena; sem isto ela largaria a pessoa numa
  // lista para procurar de novo o que já tinha sido apontado.
  const [params, setParams] = useSearchParams();
  const idDaUrl = params.get("solicitacao");
  const [linkConsumido, setLinkConsumido] = useState<string | null>(null);
  useEffect(() => {
    if (!idDaUrl || idDaUrl === linkConsumido || solicitacoes.length === 0) return;
    setLinkConsumido(idDaUrl);
    const alvo = solicitacoes.find((s) => s.uuid === idDaUrl);
    if (alvo) abrir(alvo);
    else
      toast({
        title: "Solicitação não encontrada",
        description: "Ela pode ter sido excluída ou não estar visível para você.",
        variant: "destructive",
      });
    // O parâmetro sai da URL depois de usado: recarregar a página não pode
    // reabrir um modal que a pessoa já fechou.
    const limpo = new URLSearchParams(params);
    limpo.delete("solicitacao");
    setParams(limpo, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda uma vez por id; incluir `abrir`/`params` reabriria o modal a cada render.
  }, [idDaUrl, linkConsumido, solicitacoes]);

  // Só faz sentido filtrar por posto depois de escolher o contrato — posto é
  // do contrato, e a lista de "todos os postos da casa" não ajudaria ninguém.
  const { data: postosDisponiveis = [] } = usePostosDiaria(
    contrato === "todos" ? null : contrato,
  );

  // Quem já abriu a solicitação que está no modal. Consulta própria, por
  // solicitação: pendurar isto na lista (até 2000 linhas com anexos
  // aninhados) sairia caro para desenhar um rodapé.
  const { data: visualizacoes = [] } = useVisualizacoesDiaria(modal?.s?.uuid);

  // Decidir é sempre sobre a solicitação DE OUTRO — diaria_guard() recusa
  // "quem solicitou a diária não pode aprovar ou reprovar a própria".
  //
  // As duas coisas viajam SEPARADAS para o modal de propósito. Antes elas iam
  // fundidas num `podeDecidir` só, e o resultado foi o relato de 17/09/2026:
  // quem criou a diária e depois a abria pelo Operacional via só "Excluir" no
  // menu, sem uma palavra sobre o porquê — parecia tela quebrada. O modal
  // precisa distinguir "você não tem permissão" de "esta é sua" para dizer
  // qual dos dois é.
  const souOSolicitante = !!modal?.s && modal.s.solicitanteId === user?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controle de Diárias"
        subtitle="Gerencie as solicitações de pagamento de diárias."
        module="Operacional"
        breadcrumb={["Controle de Diárias"]}
      />

      {/* Cards de resumo */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={ClipboardList} label="Total de solicitações" value={String(resumo.total)} tone="primary" />
        <StatCard icon={CalendarCheck2} label="Solicitadas" value={String(resumo.solicitadas)} tone="warning" />
        {/* Na porta de Encarregados este card é a lista de tarefas da pessoa;
            na do Operacional, o que está parado esperando o solicitante. */}
        <StatCard
          icon={PenLine}
          label={apenasMinhas ? "Para você ajustar" : "Em ajuste"}
          value={String(resumo.emAjuste)}
          tone="info"
        />
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
                {contratos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
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
                  <SelectItem key={p.id} value={p.nome}>
                    {p.nome}
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
            <AcessoGate menu={menuCodigo} acao="incluir">
              <Button onClick={() => setModal({ modo: "nova", s: null })}>
                <Plus className="mr-2 h-4 w-4" /> Solicitação de pagamento de diária
              </Button>
            </AcessoGate>
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
                    {isLoading
                      ? "Carregando solicitações..."
                      : falhaSolicitacoes
                        ? mensagemErroDiaria(
                            erroSolicitacoes,
                            "Não foi possível carregar as solicitações de diárias.",
                          )
                      : "Nenhuma solicitação encontrada com os filtros aplicados."}
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
                    <TableCell className="min-w-[7rem]">{l.solicitacao.contratoNome}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.solicitacao.posto}</TableCell>
                    <TableCell className="min-w-[7rem]">{l.solicitacao.faltanteNome}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.solicitacao.faltanteCpf}</TableCell>
                    <TableCell className="min-w-[7rem]">{l.solicitacao.diaristaNome}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.solicitacao.diaristaCpf}</TableCell>
                    <TableCell className="break-all">
                      {l.solicitacao.pixTipo && (
                        <span className="mr-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {labelTipoPix(l.solicitacao.pixTipo)}
                        </span>
                      )}
                      {l.solicitacao.pix}
                    </TableCell>
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
          salvando={
            criar.isPending ||
            decidir.isPending ||
            ajustar.isPending ||
            pedirAjuste.isPending ||
            excluir.isPending
          }
          visualizacoes={visualizacoes}
          podeDecidir={podeDecidir}
          souOSolicitante={souOSolicitante}
          podeExcluir={podeExcluirAqui}
          onFechar={() => setModal(null)}
          onSalvar={async (nova) => {
            try {
              const { numero } = await criar.mutateAsync(nova);
              setModal(null);
              toast({
                title: "Solicitação salva",
                description: `${numero} entrou na lista com status Solicitada.`,
              });
            } catch (e: unknown) {
              // A duplicidade de escala barrada pela trigger chega aqui: a
              // mensagem do banco já diz qual data e turno bateram.
              toast({
                title: "Não foi possível salvar",
                description: mensagemErroDiaria(e, "Erro ao gravar a solicitação."),
                variant: "destructive",
              });
            }
          }}
          onAprovar={async (uuid, despesa) => {
            try {
              await decidir.mutateAsync({
                id: uuid,
                status: "aprovada",
                despesa,
              });
              setModal(null);
              toast({ title: "Solicitação aprovada", description: "Enviada para o Malote." });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível aprovar",
                description: mensagemErroDiaria(e, "Erro ao aprovar."),
                variant: "destructive",
              });
            }
          }}
          onReprovar={async (uuid) => {
            try {
              await decidir.mutateAsync({ id: uuid, status: "reprovada" });
              setModal(null);
              toast({ title: "Solicitação reprovada", variant: "destructive" });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível reprovar",
                description: mensagemErroDiaria(e, "Erro ao reprovar."),
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
                description: `${modal.s?.solicitante ?? "O solicitante"} foi notificado do que precisa mudar.`,
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
                title: "Solicitação excluída",
                description: "Ela sai da lista, mas continua no histórico.",
              });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível excluir",
                description: mensagemErroDiaria(e, "Erro ao excluir a solicitação."),
                variant: "destructive",
              });
            }
          }}
          onReenviar={async (dados) => {
            if (!modal.s) return;
            try {
              await ajustar.mutateAsync({ ...dados, uuid: modal.s.uuid });
              setModal(null);
              toast({
                title: "Solicitação reenviada",
                description: `${modal.s.id} voltou para a fila com status Solicitada.`,
              });
            } catch (e: unknown) {
              toast({
                title: "Não foi possível reenviar",
                description: mensagemErroDiaria(e, "Erro ao gravar o ajuste."),
                variant: "destructive",
              });
            }
          }}
        />
      )}
    </div>
  );
}
