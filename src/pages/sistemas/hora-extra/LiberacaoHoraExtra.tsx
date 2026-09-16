import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Clock3, FileText, Hourglass, Search } from "lucide-react";
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
import { useSolicitacoesHoraExtra, useStatsHoraExtra } from "@/hooks/useHoraExtra";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  dataLocalISO,
  formatarData,
  formatarDataHora,
  formatarDuracao,
  formatarQuantidadeChamados,
} from "./horaExtraUtils";
import { BadgeStatus, BreadcrumbHoraExtra, CartaoMetrica, PaginacaoHoraExtra } from "./HoraExtraUI";
import DecisaoHoraExtraDialog from "./DecisaoHoraExtraDialog";
import DetalhesHoraExtraDialog from "./DetalhesHoraExtraDialog";
import NovaSolicitacaoDialog from "./NovaSolicitacaoDialog";
import type { SolicitacaoHoraExtra } from "./types";

function inicioMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function fimMes() {
  const d = new Date();
  return dataLocalISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export default function LiberacaoHoraExtra() {
  const { data: podeAprovar = false } = useScreenAccess("sistemas_hora_extra", "aprovar");
  const [inicio, setInicio] = useState(inicioMes),
    [fim, setFim] = useState(fimMes);
  const { data: lista = [], isLoading } = useSolicitacoesHoraExtra(inicio, fim);
  const { data: stats } = useStatsHoraExtra(inicio, fim);
  const [empresa, setEmpresa] = useState("todos"),
    [setor, setSetor] = useState("todos"),
    [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1),
    [porPagina, setPorPagina] = useState(10);
  const [novo, setNovo] = useState(false),
    [decisao, setDecisao] = useState<SolicitacaoHoraExtra | null>(null),
    [detalhes, setDetalhes] = useState<SolicitacaoHoraExtra | null>(null);
  const filtrada = useMemo(
    () =>
      lista
        .filter((s) => {
          const numerosChamados = (s.chamados || []).map((c) => c.chamado_numero).join(" ");
          const textoBusca = `${s.colaborador_nome} ${s.numero} ${s.justificativa} ${numerosChamados}`;
          return (
            (empresa === "todos" || s.empresa === empresa) &&
            (setor === "todos" || s.setor === setor) &&
            textoBusca.toLowerCase().includes(busca.toLowerCase())
          );
        })
        .sort((a, b) => {
          const pa = ["aguardando_liberacao", "aguardando_validacao"].includes(a.status) ? 0 : 1;
          const pb = ["aguardando_liberacao", "aguardando_validacao"].includes(b.status) ? 0 : 1;
          return pa - pb || b.created_at.localeCompare(a.created_at);
        }),
    [lista, empresa, setor, busca],
  );
  const itens = filtrada.slice((pagina - 1) * porPagina, pagina * porPagina);
  const unicos = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter(Boolean) as string[])).sort();
  return (
    <div className="min-h-full bg-slate-50/60 p-4 text-[#07194b] md:p-6">
      <BreadcrumbHoraExtra atual="Liberação de HE" />
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">Liberação de Hora Extra</h1>
          <p className="text-sm text-slate-500">Analise e aprove as solicitações de horas extras da sua equipe</p>
        </div>
        <AcessoGate menu="sistemas_hora_extra" acao="aprovar">
          <Button onClick={() => setNovo(true)} className="bg-orange-500 hover:bg-orange-600">
            + &nbsp; Nova Solicitação de HE
          </Button>
        </AcessoGate>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <CartaoMetrica
          icone={<Hourglass />}
          valor={stats?.aguardando_liberacao ?? 0}
          titulo="Aguardando liberação"
          tom="ambar"
        />
        <CartaoMetrica icone={<Clock3 />} valor={stats?.aguardando_validacao ?? 0} titulo="Aguardando validação" />
        <CartaoMetrica icone={<CheckCircle2 />} valor={stats?.liberadas ?? 0} titulo="Aprovadas no mês" tom="verde" />
        <CartaoMetrica
          icone={<Clock3 />}
          valor={formatarDuracao(stats?.horas_aprovadas_min ?? 0, true)}
          titulo="Horas aprovadas (mês)"
        />
      </div>
      <div className="mb-3 rounded-lg border bg-white p-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.3fr_.8fr_.8fr_1.8fr_auto_auto]">
          <label className="text-xs text-slate-600">
            Período
            <div className="mt-1 flex items-center gap-1">
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              <span>→</span>
              <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
          </label>
          <Filtro label="Empresa" valor={empresa} set={setEmpresa} itens={unicos(lista.map((s) => s.empresa))} />
          <Filtro label="Setor" valor={setor} set={setSetor} itens={unicos(lista.map((s) => s.setor))} />
          <label className="self-end">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <Input
                className="pl-9"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por colaborador, chamado, motivo..."
              />
            </div>
          </label>
          <Button
            variant="outline"
            className="self-end"
            onClick={() => {
              setEmpresa("todos");
              setSetor("todos");
              setBusca("");
              setInicio(inicioMes());
              setFim(fimMes());
            }}
          >
            Limpar filtros
          </Button>
          <Button className="self-end bg-[#07194b]">
            <Search className="mr-2 h-4 w-4" />
            Pesquisar
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-xs">
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
                <th className="p-3">Qtd. HE</th>
                <th className="p-3">Chamados</th>
                <th className="p-3">Status</th>
                <th className="p-3">Ações</th>
                <th className="p-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="p-10 text-center">
                    Carregando...
                  </td>
                </tr>
              ) : (
                itens.map((s) => {
                  const pendente = ["aguardando_liberacao", "aguardando_validacao"].includes(s.status);
                  return (
                    <tr key={s.id} className="border-t hover:bg-slate-50">
                      <td className="p-3">
                        <Checkbox />
                      </td>
                      <td className="p-3 font-bold">{s.numero}</td>
                      <td className="p-3">{formatarDataHora(s.created_at)}</td>
                      <td className="p-3">
                        <strong>{s.colaborador_nome}</strong>
                        <div className="text-slate-500">{s.colaborador_cargo}</div>
                      </td>
                      <td className="p-3">{s.setor}</td>
                      <td className="p-3">{formatarData(s.data_he)}</td>
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
                        {pendente && podeAprovar ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="outline">
                                {s.status === "aguardando_validacao" ? "Validar" : "Aprovar"}
                                <ChevronDown className="ml-2 h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onClick={() => setDecisao(s)}>Analisar solicitação</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setDetalhes(s)}>
                            Ver
                          </Button>
                        )}
                      </td>
                      <td className="max-w-[230px] truncate p-3 text-slate-500" title={s.justificativa}>
                        {s.justificativa}
                      </td>
                    </tr>
                  );
                })
              )}
              {!isLoading && !itens.length && (
                <tr>
                  <td colSpan={11} className="p-10 text-center text-slate-500">
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
      <NovaSolicitacaoDialog aberto={novo} aoFechar={() => setNovo(false)} podeAprovar={podeAprovar} />
      <DecisaoHoraExtraDialog aberto={!!decisao} aoFechar={() => setDecisao(null)} solicitacao={decisao} />
      <DetalhesHoraExtraDialog aberto={!!detalhes} aoFechar={() => setDetalhes(null)} solicitacao={detalhes} />
    </div>
  );
}
function Filtro({
  label,
  valor,
  set,
  itens,
}: {
  label: string;
  valor: string;
  set: (v: string) => void;
  itens: string[];
}) {
  return (
    <label className="text-xs text-slate-600">
      {label}
      <select
        className="mt-1 h-10 w-full rounded-md border bg-white px-2 text-sm"
        value={valor}
        onChange={(e) => set(e.target.value)}
      >
        <option value="todos">Todos</option>
        {itens.map((i) => (
          <option key={i}>{i}</option>
        ))}
      </select>
    </label>
  );
}
