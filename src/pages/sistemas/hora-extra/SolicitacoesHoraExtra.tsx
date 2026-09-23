import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Hourglass,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useExcluirHoraExtra, useSolicitacoesHoraExtra, useStatsHoraExtra } from "@/hooks/useHoraExtra";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { cn } from "@/lib/utils";
import {
  conclusaoExibicao,
  dataLocalISO,
  formatarData,
  formatarDataHora,
  formatarDuracao,
  formatarQuantidadeChamados,
  linhasExcel,
  mensagemErro,
  podeEditarHoraExtra,
  somenteHora,
  statusExibicao,
} from "./horaExtraUtils";
import { BadgeStatus, BreadcrumbHoraExtra, CartaoMetrica, PaginacaoHoraExtra } from "./HoraExtraUI";
import ConcluirHoraExtraDialog from "./ConcluirHoraExtraDialog";
import DetalhesHoraExtraDialog from "./DetalhesHoraExtraDialog";
import EscalasHoraExtraDialog from "./EscalasHoraExtraDialog";
import NovaSolicitacaoDialog from "./NovaSolicitacaoDialog";
import type { SolicitacaoHoraExtra, StatusHoraExtra } from "./types";

function inicioMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function fimMes() {
  const d = new Date();
  return dataLocalISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
type Aba = "todas" | "minhas" | "aguardando" | "pendentes" | "concluidas";

export default function SolicitacoesHoraExtra() {
  const { user } = useAuth();
  const { data: podeAprovar = false } = useScreenAccess("sistemas_hora_extra", "aprovar");
  const { data: podeIncluir = false } = useScreenAccess("sistemas_hora_extra", "incluir");
  const { data: podeAlterar = false } = useScreenAccess("sistemas_hora_extra", "alterar");
  const { data: podeExcluir = false } = useScreenAccess("sistemas_hora_extra", "excluir");
  const [inicio, setInicio] = useState(inicioMes);
  const [fim, setFim] = useState(fimMes);
  const { data: lista = [], isLoading } = useSolicitacoesHoraExtra(inicio, fim);
  const { data: stats } = useStatsHoraExtra(inicio, fim);
  const excluir = useExcluirHoraExtra();
  const [empresa, setEmpresa] = useState("todos"),
    [setor, setSetor] = useState("todos"),
    [colaborador, setColaborador] = useState("todos"),
    [status, setStatus] = useState("todos"),
    [tipo, setTipo] = useState("todos"),
    [busca, setBusca] = useState("");
  const [aba, setAba] = useState<Aba>(podeAprovar ? "todas" : "minhas");
  const [pagina, setPagina] = useState(1),
    [porPagina, setPorPagina] = useState(10);
  const [escalas, setEscalas] = useState(false);
  const [novo, setNovo] = useState(false),
    [editar, setEditar] = useState<SolicitacaoHoraExtra | null>(null),
    [detalhes, setDetalhes] = useState<SolicitacaoHoraExtra | null>(null),
    [concluir, setConcluir] = useState<SolicitacaoHoraExtra | null>(null);
  useEffect(() => {
    if (podeAprovar) setAba("todas");
  }, [podeAprovar]);
  const hoje = useMemo(() => {
    const data = new Date();
    data.setHours(0, 0, 0, 0);
    return data;
  }, []);
  const hojeIso = useMemo(() => dataLocalISO(), []);
  const conta = (pred: (s: SolicitacaoHoraExtra) => boolean) => lista.filter(pred).length;
  const filtrada = useMemo(
    () =>
      lista.filter((s) => {
        const exibido = statusExibicao(s.status, s.data_he).label;
        const termo = `${s.numero} ${s.colaborador_nome} ${s.setor ?? ""}`.toLowerCase();
        const porAba =
          aba === "todas" ||
          (aba === "minhas" && s.colaborador_id === user?.id) ||
          (aba === "aguardando" && s.status === "aguardando_liberacao") ||
          (aba === "pendentes" && s.status === "aprovada" && new Date(`${s.data_he}T12:00:00`) < hoje) ||
          (aba === "concluidas" && s.status === "concluida");
        return (
          porAba &&
          (empresa === "todos" || s.empresa === empresa) &&
          (setor === "todos" || s.setor === setor) &&
          (colaborador === "todos" || s.colaborador_id === colaborador) &&
          (status === "todos" || exibido === status) &&
          (tipo === "todos" || s.tipo === tipo) &&
          termo.includes(busca.toLowerCase())
        );
      }),
    [lista, aba, user?.id, empresa, setor, colaborador, status, tipo, busca, hoje],
  );
  const paginaItens = filtrada.slice((pagina - 1) * porPagina, pagina * porPagina);
  const pct = (n = 0) =>
    stats?.total ? `${((n / stats.total) * 100).toFixed(1).replace(".", ",")}% do total` : "0% do total";
  const limpar = () => {
    setEmpresa("todos");
    setSetor("todos");
    setColaborador("todos");
    setStatus("todos");
    setTipo("todos");
    setBusca("");
    setInicio(inicioMes());
    setFim(fimMes());
    setPagina(1);
  };
  const apagar = async (s: SolicitacaoHoraExtra) => {
    if (!window.confirm(`Excluir a solicitação ${s.numero}?`)) return;
    try {
      await excluir.mutateAsync({ p_id: s.id });
      toast.success("Solicitação excluída.");
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível excluir."));
    }
  };
  const exportar = () => {
    const planilha = XLSX.utils.json_to_sheet(linhasExcel(filtrada));
    const pasta = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(pasta, planilha, "Horas extras");
    XLSX.writeFile(pasta, `horas-extras-${inicio}-${fim}.xlsx`);
  };
  const proximas = lista
    .filter((s) => s.status === "aprovada" && new Date(`${s.data_he}T12:00:00`) >= hoje)
    .sort((a, b) => a.data_he.localeCompare(b.data_he))
    .slice(0, 3);
  return (
    <div className="min-h-full bg-slate-50/60 p-4 text-[#07194b] md:p-6">
      <BreadcrumbHoraExtra atual="Solicitações de Hora Extra" />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Solicitações de Hora Extra</h1>
          <p className="text-sm text-slate-500">
            Acompanhe, solicite e conclua horas extras da sua equipe, com total controle e transparência.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {podeAprovar && (
            <Button variant="outline" onClick={() => setEscalas(true)}>
              <CalendarClock className="mr-2 h-4 w-4" />
              Escalas de trabalho
            </Button>
          )}
          {(podeIncluir || podeAprovar) && (
            <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => setNovo(true)}>
              + &nbsp; Nova Solicitação de HE
            </Button>
          )}
        </div>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <CartaoMetrica
          icone={<FileText />}
          valor={stats?.total ?? 0}
          titulo="Total no mês"
          detalhe={
            <span className={(stats?.variacao ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}>
              {(stats?.variacao ?? 0) >= 0 ? "↑" : "↓"} {Math.abs(stats?.variacao ?? 0)}% em relação ao mês anterior
            </span>
          }
        />
        <CartaoMetrica
          icone={<Hourglass />}
          valor={stats?.aguardando_liberacao ?? 0}
          titulo="Aguardando liberação"
          detalhe={pct(stats?.aguardando_liberacao)}
          tom="ambar"
        />
        <CartaoMetrica
          icone={<CheckCircle2 />}
          valor={stats?.aprovadas ?? 0}
          titulo="Aprovadas para execução"
          detalhe={pct(stats?.aprovadas)}
          tom="verde"
        />
        <CartaoMetrica
          icone={<Clock3 />}
          valor={stats?.pendentes_conclusao ?? 0}
          titulo="Pendentes de conclusão"
          detalhe={pct(stats?.pendentes_conclusao)}
        />
        <CartaoMetrica
          icone={<CheckCircle2 />}
          valor={stats?.concluidas ?? 0}
          titulo="Concluídas"
          detalhe={pct(stats?.concluidas)}
          tom="verde"
        />
      </div>
      <Filtros
        inicio={inicio}
        fim={fim}
        setInicio={setInicio}
        setFim={setFim}
        lista={lista}
        empresa={empresa}
        setEmpresa={setEmpresa}
        setor={setor}
        setSetor={setSetor}
        colaborador={colaborador}
        setColaborador={setColaborador}
        status={status}
        setStatus={setStatus}
        tipo={tipo}
        setTipo={setTipo}
        busca={busca}
        setBusca={setBusca}
        limpar={limpar}
      />
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_255px]">
        <div className="overflow-hidden rounded-lg border bg-white">
          <div className="flex items-center justify-between border-b px-3">
            <div className="flex overflow-x-auto">
              {(
                [
                  ...(podeAprovar ? [["todas", "Todas", lista.length]] : []),
                  ["minhas", "Minhas solicitações", conta((s) => s.colaborador_id === user?.id)],
                  ["aguardando", "Aguardando aprovação", conta((s) => s.status === "aguardando_liberacao")],
                  [
                    "pendentes",
                    "Pendentes de conclusão",
                    conta((s) => s.status === "aprovada" && new Date(`${s.data_he}T12:00:00`) < hoje),
                  ],
                  ["concluidas", "Concluídas", conta((s) => s.status === "concluida")],
                ] as [Aba, string, number][]
              ).map(([v, l, n]) => (
                <button
                  key={v}
                  onClick={() => {
                    setAba(v);
                    setPagina(1);
                  }}
                  className={cn(
                    "whitespace-nowrap border-b-2 px-4 py-3 text-xs",
                    aba === v ? "border-orange-500 font-bold text-blue-700" : "border-transparent text-slate-600",
                  )}
                >
                  {l} ({n})
                </button>
              ))}
            </div>
            <AcessoGate menu="sistemas_hora_extra" acao="aprovar">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportar}>
                    <Download className="mr-2 h-4 w-4" />
                    Exportar Excel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </AcessoGate>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="p-3">
                    <Checkbox />
                  </th>
                  <th className="p-3">ID</th>
                  <th className="p-3">Data da Solicitação</th>
                  <th className="p-3">Colaborador</th>
                  <th className="p-3">Setor</th>
                  <th className="p-3">Data da HE</th>
                  <th className="p-3">Horário</th>
                  <th className="p-3">Qtd. HE</th>
                  <th className="p-3">Chamados</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Conclusão</th>
                  <th className="p-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={12} className="p-10 text-center">
                      Carregando...
                    </td>
                  </tr>
                ) : (
                  paginaItens.map((s) => {
                    const podeConcluir =
                      s.status === "aprovada" && s.data_he <= hojeIso && s.colaborador_id === user?.id;
                    const podeEditar = podeEditarHoraExtra({
                      status: s.status,
                      ehDono: s.colaborador_id === user?.id,
                      podeAlterar,
                    });
                    const podeApagar =
                      (podeAprovar && s.status !== "concluida") ||
                      (podeExcluir &&
                        s.colaborador_id === user?.id &&
                        ["aguardando_liberacao", "reprovada"].includes(s.status));
                    const conc = conclusaoExibicao(s.status, s.data_he, hoje);
                    return (
                      <tr key={s.id} className="border-t hover:bg-slate-50">
                        <td className="p-3">
                          <Checkbox />
                        </td>
                        <td className="p-3 font-bold">{s.numero}</td>
                        <td className="p-3">{formatarDataHora(s.created_at)}</td>
                        <td className="p-3">
                          <div className="font-semibold">{s.colaborador_nome}</div>
                          <div className="text-slate-500">{s.colaborador_cargo}</div>
                        </td>
                        <td className="p-3">{s.setor}</td>
                        <td className="p-3">{formatarData(s.data_he)}</td>
                        <td className="p-3">
                          {somenteHora(s.he_inicio_previsto)} - {somenteHora(s.he_fim_previsto)}
                        </td>
                        <td className="p-3 font-bold">{formatarDuracao(s.total_previsto_min, true)}</td>
                        <td className="p-3">
                          <button className="text-blue-600 underline" onClick={() => setDetalhes(s)}>
                            <FileText className="mr-1 inline h-3.5 w-3.5" />
                            {formatarQuantidadeChamados(s.chamados?.length ?? 0)}
                          </button>
                        </td>
                        <td className="p-3">
                          <BadgeStatus solicitacao={s} />
                        </td>
                        <td className="p-3">
                          <span className={cn("inline-block rounded-md px-2 py-1 font-semibold", conc.classe)}>
                            {conc.label}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex">
                            {podeConcluir ? (
                              <Button
                                size="sm"
                                className="bg-orange-500 hover:bg-orange-600"
                                onClick={() => setConcluir(s)}
                              >
                                Concluir HE
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setDetalhes(s)}>
                                Ver
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="-ml-px px-2">
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {podeEditar && (
                                  <DropdownMenuItem onClick={() => setEditar(s)}>
                                    {s.status === "reprovada" ? "Corrigir e reenviar" : "Editar"}
                                  </DropdownMenuItem>
                                )}
                                {/* NÃO devolver "Analisar" para cá (22/09/2026). Esta tela é onde a
                                    pessoa PEDE a HE e cuida da própria solicitação; aprovar, rejeitar e
                                    validar a conclusão são atos do gestor e vivem só em
                                    /app/sistemas/hora-extra/liberacao. Ter os dois botões aqui fazia o
                                    solicitante enxergar "Aprovar Solicitação" na própria HE. */}
                                {podeApagar && (
                                  <DropdownMenuItem className="text-red-600" onClick={() => apagar(s)}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Excluir
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
                {!isLoading && !paginaItens.length && (
                  <tr>
                    <td colSpan={12} className="p-10 text-center text-slate-500">
                      Nenhuma solicitação encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginacaoHoraExtra
            pagina={pagina}
            total={filtrada.length}
            porPagina={porPagina}
            aoMudarPagina={setPagina}
            aoMudarPorPagina={(n) => {
              setPorPagina(n);
              setPagina(1);
            }}
          />
        </div>
        <aside className="space-y-3">
          <Painel titulo="Próximas HEs" link="Ver todas">
            {proximas.length ? (
              proximas.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setDetalhes(s)}
                  className="flex w-full gap-3 border-t py-3 text-left first:border-0"
                >
                  <span
                    className={cn(
                      "grid h-12 w-12 shrink-0 place-items-center rounded-lg border",
                      "bg-slate-50 font-bold leading-none",
                    )}
                  >
                    {s.data_he.slice(8)}
                    <small>
                      {new Intl.DateTimeFormat("pt-BR", { month: "short" })
                        .format(new Date(`${s.data_he}T12:00:00`))
                        .replace(".", "")
                        .toUpperCase()}
                    </small>
                  </span>
                  <span className="min-w-0 text-xs">
                    <strong className="block truncate">{s.colaborador_nome}</strong>
                    <span className="block truncate text-slate-500">{s.setor}</span>
                    <strong>
                      {somenteHora(s.he_inicio_previsto)} - {somenteHora(s.he_fim_previsto)} (
                      {formatarDuracao(s.total_previsto_min, true)})
                    </strong>
                  </span>
                </button>
              ))
            ) : (
              <p className="py-4 text-xs text-slate-500">Nenhuma HE próxima.</p>
            )}
          </Painel>
          <Painel titulo="Minhas pendências" link="Ver todas">
            <Pendencia
              cor="bg-amber-400"
              numero={conta((s) => s.colaborador_id === user?.id && s.status === "aguardando_liberacao")}
              texto="Aguardando liberação"
              aoClicar={() => setAba("aguardando")}
            />
            <Pendencia
              cor="bg-blue-500"
              numero={conta(
                (s) =>
                  s.colaborador_id === user?.id && s.status === "aprovada" && new Date(`${s.data_he}T12:00:00`) < hoje,
              )}
              texto="Pendentes de conclusão"
              aoClicar={() => setAba("pendentes")}
            />
            <Pendencia
              cor="bg-red-500"
              numero={conta((s) => s.colaborador_id === user?.id && s.status === "reprovada")}
              texto="Reprovadas"
              aoClicar={() => {
                setAba("minhas");
                setStatus("Reprovada");
              }}
            />
          </Painel>
          <Painel titulo="Resumo do mês">
            <ResumoLinha l="Total de solicitações" v={String(stats?.total ?? 0)} />
            <ResumoLinha l="Total de horas" v={formatarDuracao(stats?.total_minutos ?? 0, true)} />
            <ResumoLinha l="Média por solicitação" v={formatarDuracao(stats?.media_minutos ?? 0, true)} />
            <hr className="my-2" />
            <Legenda cor="bg-emerald-500" l="Aprovadas" n={stats?.aprovadas ?? 0} total={stats?.total ?? 0} />
            <Legenda cor="bg-blue-500" l="Pendentes" n={stats?.pendentes_conclusao ?? 0} total={stats?.total ?? 0} />
            <Legenda cor="bg-emerald-600" l="Concluídas" n={stats?.concluidas ?? 0} total={stats?.total ?? 0} />
            <Legenda
              cor="bg-amber-400"
              l="Aguardando liberação"
              n={stats?.aguardando_liberacao ?? 0}
              total={stats?.total ?? 0}
            />
          </Painel>
        </aside>
      </div>
      <NovaSolicitacaoDialog
        aberto={novo || !!editar}
        aoFechar={() => {
          setNovo(false);
          setEditar(null);
        }}
        podeAprovar={podeAprovar}
        solicitacao={editar}
      />
      <DetalhesHoraExtraDialog aberto={!!detalhes} aoFechar={() => setDetalhes(null)} solicitacao={detalhes} />
      <ConcluirHoraExtraDialog aberto={!!concluir} aoFechar={() => setConcluir(null)} solicitacao={concluir} />
      <EscalasHoraExtraDialog aberto={escalas} aoFechar={() => setEscalas(false)} />
    </div>
  );
}

function Filtros(p: {
  inicio: string;
  fim: string;
  setInicio: (v: string) => void;
  setFim: (v: string) => void;
  lista: SolicitacaoHoraExtra[];
  empresa: string;
  setEmpresa: (v: string) => void;
  setor: string;
  setSetor: (v: string) => void;
  colaborador: string;
  setColaborador: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  tipo: string;
  setTipo: (v: string) => void;
  busca: string;
  setBusca: (v: string) => void;
  limpar: () => void;
}) {
  const unicos = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter(Boolean) as string[])).sort();
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_.8fr_.8fr_.9fr_.85fr_.8fr_1.45fr_auto_auto]">
        <label className="text-xs text-slate-600">
          Período
          <div className="mt-1 flex items-center gap-1">
            <Input type="date" value={p.inicio} onChange={(e) => p.setInicio(e.target.value)} />
            <span>→</span>
            <Input type="date" value={p.fim} onChange={(e) => p.setFim(e.target.value)} />
          </div>
        </label>
        <Filtro label="Empresa" value={p.empresa} set={p.setEmpresa} opcoes={unicos(p.lista.map((x) => x.empresa))} />
        <Filtro label="Setor" value={p.setor} set={p.setSetor} opcoes={unicos(p.lista.map((x) => x.setor))} />
        <Filtro
          label="Colaborador"
          value={p.colaborador}
          set={p.setColaborador}
          opcoes={Array.from(new Map(p.lista.map((x) => [x.colaborador_id, x.colaborador_nome])).entries())}
        />
        <Filtro
          label="Status"
          value={p.status}
          set={p.setStatus}
          opcoes={["Aguardando liberação", "Aprovada para execução", "Pendente de conclusão", "Concluída", "Reprovada"]}
        />
        <Filtro
          label="Tipo de HE"
          value={p.tipo}
          set={p.setTipo}
          opcoes={[
            ["normal", "Normal"],
            ["emergencial", "Emergencial"],
          ]}
        />
        <label className="self-end">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={p.busca}
              onChange={(e) => p.setBusca(e.target.value)}
              placeholder="Buscar por ID, colaborador, setor..."
              className="pl-9"
            />
          </div>
        </label>
        <Button variant="outline" className="self-end" onClick={p.limpar}>
          Limpar filtros
        </Button>
        <Button className="self-end bg-[#07194b]">
          <Search className="mr-2 h-4 w-4" />
          Pesquisar
        </Button>
      </div>
    </div>
  );
}
function Filtro({
  label,
  value,
  set,
  opcoes,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  opcoes: (string | [string, string])[];
}) {
  return (
    <label className="text-xs text-slate-600">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm"
        value={value}
        onChange={(e) => set(e.target.value)}
      >
        <option value="todos">Todos</option>
        {opcoes.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );
}
function Painel({ titulo, link, children }: { titulo: string; link?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-white p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold">
          <CalendarClock className="mr-2 inline h-4 w-4" />
          {titulo}
        </h3>
        {link && <button className="text-[11px] text-blue-600 underline">{link}</button>}
      </div>
      {children}
    </section>
  );
}
function Pendencia({
  cor,
  numero,
  texto,
  aoClicar,
}: {
  cor: string;
  numero: number;
  texto: string;
  aoClicar: () => void;
}) {
  return (
    <button onClick={aoClicar} className="flex w-full items-center gap-2 py-2 text-xs">
      <span className={cn("h-2.5 w-2.5 rounded-full", cor)} />
      <strong className="w-5 text-base">{numero}</strong>
      <span className="flex-1 text-left text-slate-600">{texto}</span>
      <span>›</span>
    </button>
  );
}
function ResumoLinha({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between py-1 text-xs">
      <span className="text-slate-500">{l}</span>
      <strong>{v}</strong>
    </div>
  );
}
function Legenda({ cor, l, n, total }: { cor: string; l: string; n: number; total: number }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <span className={cn("h-2.5 w-2.5 rounded-full", cor)} />
      <span className="flex-1 text-slate-500">{l}</span>
      <strong>
        {n} ({total ? ((n / total) * 100).toFixed(1).replace(".", ",") : 0}%)
      </strong>
    </div>
  );
}
