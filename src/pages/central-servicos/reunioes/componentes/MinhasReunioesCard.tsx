import { useState } from "react";
import { Link } from "react-router-dom";
import { addDays, isSameDay, isWithinInterval, subDays } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useMinhasReunioes, useOcultarReuniaoDaHome } from "../useReunioes";
import { ETAPA_COR, ETAPA_LABEL, salaResumo } from "../types";

type FiltroPeriodo = "hoje" | "proximos_7" | "proximos_30" | "ultimos_7" | "ultimos_30" | "todo_periodo";

const OPCOES_FILTRO: { value: FiltroPeriodo; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "proximos_7", label: "Próximos 7 dias" },
  { value: "proximos_30", label: "Próximos 30 dias" },
  { value: "ultimos_7", label: "Últimos 7 dias" },
  { value: "ultimos_30", label: "Últimos 30 dias" },
  { value: "todo_periodo", label: "Todo o período" },
];

function dentroDoPeriodo(dataHoraIso: string, filtro: FiltroPeriodo, agora: Date): boolean {
  const data = new Date(dataHoraIso);
  switch (filtro) {
    case "hoje": return isSameDay(data, agora);
    case "proximos_7": return isWithinInterval(data, { start: agora, end: addDays(agora, 7) });
    case "proximos_30": return isWithinInterval(data, { start: agora, end: addDays(agora, 30) });
    case "ultimos_7": return isWithinInterval(data, { start: subDays(agora, 7), end: agora });
    case "ultimos_30": return isWithinInterval(data, { start: subDays(agora, 30), end: agora });
    case "todo_periodo": return true;
  }
}

export function MinhasReunioesCard() {
  const { data: reunioes = [], isLoading } = useMinhasReunioes();
  const ocultar = useOcultarReuniaoDaHome();
  const [filtro, setFiltro] = useState<FiltroPeriodo>("hoje");
  const agora = new Date();

  const reunioesFiltradas = reunioes.filter((r) => dentroDoPeriodo(r.data_hora, filtro, agora));

  return (
    <div className="ini-card">
      <div className="ini-card-hd">
        {/* O ícone vem do mesmo conjunto do resto do ERP; emoji renderiza
            diferente em cada sistema operacional e destoa do cabeçalho. */}
        <div className="ini-hd-tx">
          <h3><CalendarDays className="ini-hd-ic" aria-hidden /> Minhas Reuniões</h3>
          <p>Acompanhe suas reuniões agendadas.</p>
        </div>
        {/* Cores por token, não literais: o cartão vive dentro do .ini-card e
            precisa acompanhar o tema junto com ele. */}
        <div className="ini-hd-acoes">
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as FiltroPeriodo)}
            className="ini-select"
          >
            {OPCOES_FILTRO.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Link to="/app/central-servicos/reunioes" className="ini-link">
            Ver agenda completa
          </Link>
        </div>
      </div>
      <div className="ini-card-body">
        {isLoading && <p className="ini-nota">Carregando…</p>}
        {!isLoading && reunioesFiltradas.length === 0 && (
          <p className="ini-nota">Nenhuma reunião nesse período.</p>
        )}
        <div className="ini-reuniao-lista">
          {reunioesFiltradas.map((r) => {
            const jaPassou = new Date(r.data_hora).getTime() < agora.getTime();
            return (
              <div key={r.id} className="ini-reuniao-item">
                <Link to={`/app/central-servicos/reunioes/${r.id}`} className="ini-reuniao-info">
                  <span className="ini-reuniao-titulo">{r.titulo}</span>
                  <span className="ini-reuniao-meta">
                    {new Date(r.data_hora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    {" · "}
                    {salaResumo(r)}
                  </span>
                </Link>
                <span className={`ini-reuniao-badge ${ETAPA_COR[r.etapa]}`}>{ETAPA_LABEL[r.etapa]}</span>
                {jaPassou && (
                  <button
                    type="button"
                    title="Remover da minha tela inicial"
                    className="ini-reuniao-remover"
                    onClick={() => ocultar.mutate(r.id)}
                  >
                    🗑️
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
