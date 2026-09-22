import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Eye,
  FileSpreadsheet,
  MoreVertical,
  Paperclip,
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
  LinhaDiaria,
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
import { PermissoesDiaria } from "./DiariaUfrgsModal";
import { DiariasUfrgsPainel } from "./DiariasUfrgsPainel";
import { TIPOS_DIARIA, TipoDiaria } from "./diariasUfrgs";
import { exportarDiariasDiaristas, hojeIso } from "./exportarDiarias";

/** Uma linha da tabela = uma diária dentro de uma solicitação (tela 1.1). */
interface LinhaTabela {
  chave: string;
  solicitacao: SolicitacaoDiaria;
  /** A diária de origem — é o que "Exportar filtrado" reagrupa. */
  linha: LinhaDiaria;
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

// A mesma tela atende TRÊS portas: /app/operacional/diarias (Operacional),
// /app/encarregados/diarias (Encarregados) e /app/financeiro/diarias
// (Financeiro, 17/09/2026 — "um espelho dessa rota de diárias"). Cada porta
// tem seu próprio código de menu, porque a permissão da sidebar é casada por
// rota — ver o comentário da rota em App.tsx e as migrations 20260930000065 e
// 20260930000155.
type MenuDiarias = "operacional_diarias" | "encarregados_diarias" | "financeiro_diarias";

/** O rótulo de módulo do cabeçalho, por porta. */
const MODULO_DA_PORTA: Record<MenuDiarias, string> = {
  operacional_diarias: "Operacional",
  encarregados_diarias: "Encarregados",
  financeiro_diarias: "Financeiro",
};

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
  // DECIDIR É DA PORTA — com uma exceção que nunca muda.
  //
  // Até 16/09/2026 este bloco lia `operacional_diarias` FIXO, porque o
  // Operacional era o único que decidia e porque o toggle padrão do
  // Gerenciamento de Acesso gravava o pacote inteiro
  // (visualizar/incluir/alterar/aprovar/exportar, ACOES_DO_TOGGLE_PADRAO em
  // ModulosMenusTab.tsx): seguir `menuCodigo` faria o encarregado ver botão
  // de aprovar por causa de uma linha que ele ganhou de brinde.
  //
  // Duas coisas mudaram desde então. ACOES_FORA_DO_TOGGLE tirou 'aprovar' e
  // 'enviar_malote' do pacote nos três menus de Diárias (src/lib/
  // acoesDoToggleAcesso.ts), então a linha só existe se alguém a ligar de
  // propósito; e o Financeiro passou a ser uma porta que TAMBÉM decide
  // (20260930000155). Com o código fixo, quem tem os flags no Financeiro
  // abriria /app/financeiro/diarias sem nenhum botão de decisão.
  //
  // A exceção segue de pé: a porta de Encarregados nunca decide, tenha o
  // usuário a permissão que tiver — aquela rota é de quem SOLICITA. Ela cai
  // duas vezes: `encarregados_diarias` não tem linha de decisão em
  // `app_menu_acao` (o switch nem existe no painel), e o `!apenasMinhas`
  // abaixo barra até o admin que a abrir por engano. No banco, diaria_decide()
  // também não olha aquele menu.
  const { data: podeAprovar = false } = useScreenAccess(menuCodigo, "aprovar");
  // Excluir é ação própria, fora do pacote do toggle: quem confere e quem
  // decide não são necessariamente quem pode apagar da lista.
  const { data: podeExcluir = false } = useScreenAccess(menuCodigo, "excluir");
  // Mandar para o Malote é o flag "enviar para malote" pedido em 17/09/2026.
  // É separado de 'aprovar' porque aprovar diz "a conta está certa" e enviar
  // DESPACHA o pagamento — cria despesa, rateio e parcela na Controladoria.
  const { data: podeEnviarMalote = false } = useScreenAccess(menuCodigo, "enviar_malote");
  const { data: podeIncluir = false } = useScreenAccess(menuCodigo, "incluir");
  // 'exportar' faz parte do pacote do toggle: quem tem a tela conferindo pode
  // levar o relatório para o Excel.
  const { data: podeExportar = false } = useScreenAccess(menuCodigo, "exportar");
  // Editar a TABELA DE VALORES dos sindicatos da Diária UFRGS (22/09/2026).
  //
  // O código do menu é FIXO, não segue a porta: é um menu fantasma próprio
  // (20260930000212), criado exatamente para esta permissão não vir de brinde
  // com a tela. E o pedido é explícito — "somente na rota
  // /app/financeiro/diarias" —, daí o `menuCodigo === "financeiro_diarias"`
  // logo abaixo: quem tiver a chave e abrir a mesma tela pela porta do
  // Operacional ou de Encarregados não vê o botão. Não é confiança no
  // frontend; diaria_ufrgs_tarifa_salvar() checa a chave de novo no banco.
  const { data: podeEditarTarifas = false } = useScreenAccess(
    "financeiro_diarias_tarifas",
    "alterar",
  );
  const podeDecidir = podeAprovar && !apenasMinhas;
  const podeExcluirAqui = podeExcluir && !apenasMinhas;

  /** Os flags, como o painel da UFRGS e o modal dele os consomem. */
  const permissoes: PermissoesDiaria = {
    incluir: podeIncluir,
    excluir: podeExcluirAqui,
    aprovar: podeDecidir,
    enviarMalote: podeEnviarMalote && !apenasMinhas,
    editarTarifas: podeEditarTarifas && menuCodigo === "financeiro_diarias",
  };

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

  /**
   * Qual tipo de diária a tela está mostrando.
   *
   * Vive na URL (?tipo=ufrgs), não em estado local: é assim que a notificação
   * de "diária UFRGS para ajustar" consegue abrir a lista certa, que o F5 não
   * joga a pessoa de volta na outra aba, e que alguém consegue mandar o link
   * de "as diárias UFRGS de setembro" para um colega.
   */
  const [params, setParams] = useSearchParams();
  const tipo: TipoDiaria = params.get("tipo") === "ufrgs" ? "ufrgs" : "diaristas";
  const trocarTipo = (novo: TipoDiaria) => {
    const proximos = new URLSearchParams(params);
    // "diaristas" é o padrão e sai da URL: link sem parâmetro continua
    // abrindo a tela como sempre abriu.
    if (novo === "diaristas") proximos.delete("tipo");
    else proximos.set("tipo", novo);
    setParams(proximos, { replace: true });
  };
  // "Criar diária UFRGS" é pedido daqui (o menu do botão é UM para os dois
  // tipos) e consumido pelo painel da UFRGS, que é quem tem o modal.
  const [novaUfrgs, setNovaUfrgs] = useState(false);

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
          linha: l,
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

  /**
   * O que "Exportar filtrado" leva: exatamente as linhas que a tabela mostra.
   *
   * Reagrupado a partir de `linhas` (já filtradas) em vez de reaplicar os
   * filtros sobre as solicitações: o intervalo de datas recorta DIAS dentro de
   * uma solicitação, então exportar a solicitação inteira traria dias que a
   * pessoa não está vendo — e relatório que não bate com a tela é reclamação
   * na mesma semana.
   */
  const filtradasParaExportar = useMemo<SolicitacaoDiaria[]>(() => {
    const mapa = new Map<string, SolicitacaoDiaria>();
    for (const l of linhas) {
      const existente = mapa.get(l.solicitacao.uuid);
      if (existente) existente.diarias.push(l.linha);
      else mapa.set(l.solicitacao.uuid, { ...l.solicitacao, diarias: [l.linha] });
    }
    return [...mapa.values()];
  }, [linhas]);

  const exportar = (lista: SolicitacaoDiaria[], sufixo: string) => {
    if (lista.length === 0) {
      toast({
        title: "Nada para exportar",
        description: "Nenhuma diária de diarista no conjunto escolhido.",
        variant: "destructive",
      });
      return;
    }
    try {
      exportarDiariasDiaristas(lista, `diarias-diaristas-${sufixo}-${hojeIso()}`);
      const dias = lista.reduce((a, s) => a + s.diarias.length, 0);
      toast({
        title: "Excel gerado",
        description: `${lista.length} ${lista.length === 1 ? "solicitação" : "solicitações"} e ${dias} ${dias === 1 ? "diária" : "diárias"}.`,
      });
    } catch (e: unknown) {
      toast({
        title: "Não foi possível gerar o Excel",
        description: mensagemErroDiaria(e, "Erro ao montar a planilha."),
        variant: "destructive",
      });
    }
  };

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

  // O modal distingue não ter a permissão de não poder decidir a própria
  // solicitação; por isso recebe as duas informações separadamente.
  const souOSolicitante = !!modal?.s && modal.s.solicitanteId === user?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Controle de Diárias"
        subtitle="Gerencie as diárias de diaristas e as diárias UFRGS."
        module={MODULO_DA_PORTA[menuCodigo]}
        breadcrumb={["Controle de Diárias"]}
      />

      {/* Seletor de tipo + o menu de criar.
          Os dois ficam ACIMA das duas listas porque valem para as duas: o
          filtro é "podendo alternar entre diária de diaristas e diárias
          UFRGS", e o botão de criar é um só, com as duas opções no menu
          suspenso — que é exatamente o pedido de 17/09/2026. */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Tipo de diária</span>
          <div className="flex rounded-md border border-border p-0.5">
            {TIPOS_DIARIA.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => trocarTipo(t.value)}
                title={t.descricao}
                className={cn(
                  "rounded px-3 py-1.5 text-xs font-medium transition-colors",
                  tipo === t.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {podeIncluir && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Criar diária
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuItem
                onClick={() => {
                  trocarTipo("diaristas");
                  setModal({ modo: "nova", s: null });
                }}
              >
                <div>
                  <p className="text-sm">Diárias de diaristas</p>
                  <p className="text-[11px] text-muted-foreground">
                    Cobertura de posto por faltante/diarista, com VT e turno.
                  </p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  // Trocar de aba ANTES de pedir o modal: quem cria uma UFRGS
                  // precisa ver a lista dela depois de salvar, não voltar para
                  // a lista de diaristas com a diária nova invisível.
                  trocarTipo("ufrgs");
                  setNovaUfrgs(true);
                }}
              >
                <div>
                  <p className="text-sm">Diárias UFRGS</p>
                  <p className="text-[11px] text-muted-foreground">
                    Viagem de motorista, com ofício, destino e a conta da planilha.
                  </p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Card>

      {tipo === "ufrgs" && (
        <DiariasUfrgsPainel
          menuCodigo={menuCodigo}
          apenasMinhas={apenasMinhas}
          permissoes={permissoes}
          podeExportar={podeExportar}
          abrirNova={novaUfrgs}
          onNovaConsumida={() => setNovaUfrgs(false)}
        />
      )}

      {tipo === "diaristas" && (
        <>
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
              {/* "dois botão de exportar excel, um botão de exportar tudo e
                  outro botão de exportar filtrado" — nas três rotas, nos dois
                  tipos. Aqui saem as diárias de diarista; o relatório no layout
                  da planilha da UFRGS é o do outro painel (ver
                  exportarDiarias.ts, que explica por que os dois layouts não
                  são o mesmo). */}
              <AcessoGate menu={menuCodigo} acao="exportar">
                <Button variant="outline" onClick={() => exportar(solicitacoes, "completo")}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar tudo
                </Button>
                <Button variant="outline" onClick={() => exportar(filtradasParaExportar, "filtrado")}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" /> Exportar filtrado
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
                        <span className="flex items-center gap-1">
                          <Badge variant="outline" className={cn("text-[10px] font-semibold", st.cls)}>
                            {st.label}
                          </Badge>
                          {l.solicitacao.comprovantesPagamento.length > 0 && (
                            <Paperclip
                              className="h-3 w-3 shrink-0 text-success"
                              aria-label="Comprovante de pagamento anexado"
                            />
                          )}
                        </span>
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
        </>
      )}

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
