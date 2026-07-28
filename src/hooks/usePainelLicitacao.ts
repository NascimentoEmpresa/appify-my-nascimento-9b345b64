import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGrade } from "@/hooks/useGrade";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { supabase } from "@/integrations/supabase/client";

function parseValor(v: string | null): number {
  if (!v) return 0;
  const s = v.replace(/[R$\s]/g, "");
  // Formato BR: tem vírgula como decimal (ex: "1.750.267,32")
  const parsed = s.includes(",")
    ? parseFloat(s.replace(/\./g, "").replace(",", "."))
    : parseFloat(s);
  return isNaN(parsed) ? 0 : parsed;
}

export function aberturaUrgencia(d: string | null): "critica" | "proxima" | "normal" | null {
  if (!d) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const abertura = new Date(d + "T00:00:00");
  const dias = Math.ceil((abertura.getTime() - hoje.getTime()) / 86_400_000);
  if (dias < 0) return null;
  if (dias <= 3) return "critica";
  if (dias <= 7) return "proxima";
  return "normal";
}

const STATUS_NAO_PARTICIPADO = new Set(["Não Participado", "Suspenso", "Revogado"]);

export interface PainelFilters {
  dateFrom: string | null;
  dateTo: string | null;
  responsavel: string | null;
}

export function usePainelLicitacao(filters?: PainelFilters) {
  const { empresa } = useEmpresaAtiva();
  const { data: allItems = [], isLoading } = useGrade(empresa?.id ?? null);


  const stats = useMemo(() => {
    // Aplicar filtros de período e responsável
    let items = allItems;
    if (filters?.dateFrom) {
      items = items.filter((i) => i.data && i.data >= filters.dateFrom!);
    }
    if (filters?.dateTo) {
      items = items.filter((i) => i.data && i.data <= filters.dateTo!);
    }
    if (filters?.responsavel) {
      items = items.filter((i) => i.responsavel === filters.responsavel);
    }

    const editaisLidos = items.length;
    const editaisParticipados = items.filter((i) => !STATUS_NAO_PARTICIPADO.has(i.fase)).length;

    const ativas = items.filter((i) => ["À Iniciar", "Iniciado", "Em Andamento"].includes(i.fase));
    const finalizadas = items.filter((i) => i.fase === "Finalizada");

    // Taxa de vitória: apenas itens finalizados na grade
    const ganhasItems = finalizadas.filter((i) => i.posicao === 1);
    const perdidasItems = finalizadas.filter((i) => i.posicao !== 1);
    const ganhas = ganhasItems.length;
    const perdidas = perdidasItems.length;
    const totalCapa = ganhas + perdidas;

    // Valor contratos ganhos: grade finalizados em 1º lugar, usando valor_global
    const valorGlobal = ganhasItems.reduce((s, i) => s + parseValor(i.valor_global), 0);
    const qtdPessoasGanhos = ganhasItems.reduce((s, i) => s + (i.qtd_pessoas ?? 0), 0);

    // Valor ganho no mês atual
    const agora = new Date();
    const anoMes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
    const valorMes = ganhasItems
      .filter((i) => i.updated_at && i.updated_at.startsWith(anoMes))
      .reduce((s, i) => s + parseValor(i.valor_global), 0);

    // Valor total participado (excluindo Não Participado, Suspenso, Revogado)
    const participados = items.filter((i) => !STATUS_NAO_PARTICIPADO.has(i.fase));
    const valorPipeline = participados.reduce((s, i) => s + parseValor(i.valor_global), 0);
    const taxaVitoria = totalCapa > 0 ? (ganhas / totalCapa) * 100 : 0;

    // Por responsável — helper
    function buildRespMap(source: typeof items) {
      const m = new Map<string, { responsavel: string; qtd: number; valor: number; vitorias: number; perdidas: number }>();
      source.forEach((i) => {
        const raw = i.responsavel;
        const label = raw ? raw.toUpperCase() : "Sem responsável";
        const key = raw
          ? raw.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
          : "Sem responsável";
        const cur = m.get(key) ?? { responsavel: label, qtd: 0, valor: 0, vitorias: 0, perdidas: 0 };
        cur.qtd++;
        cur.valor += parseValor(i.valor_global);
        if (i.fase === "Finalizada" && i.posicao === 1) cur.vitorias++;
        if (i.fase === "Finalizada" && i.posicao !== 1) cur.perdidas++;
        m.set(key, cur);
      });
      return Array.from(m.values())
        .map((r) => ({ ...r, taxa: r.vitorias + r.perdidas > 0 ? (r.vitorias / (r.vitorias + r.perdidas)) * 100 : 0 }))
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 8);
    }
    const itemsSemNP = items.filter((i) => !STATUS_NAO_PARTICIPADO.has(i.fase));
    const porResponsavel = buildRespMap(itemsSemNP);
    const porResponsavelComNP = buildRespMap(items);

    // Por fase (para donut)
    const faseColors: Record<string, string> = {
      "Em Andamento": "#f59e0b",
      "Finalizada (Ganho)": "#22c55e",
      "Finalizada (Perdido)": "#ef4444",
      "Suspenso": "#8b5cf6",
      "Revogado": "#6b7280",
      "À Iniciar": "#3b82f6",
      "Iniciado": "#06b6d4",
      "Não Participado": "#d1d5db",
    };
    function buildFaseMap(source: typeof items) {
      const m = new Map<string, number>();
      source.forEach((i) => {
        if (STATUS_NAO_PARTICIPADO.has(i.fase)) return;
        let label = i.fase;
        if (i.fase === "Finalizada") label = i.posicao === 1 ? "Finalizada (Ganho)" : "Finalizada (Perdido)";
        m.set(label, (m.get(label) ?? 0) + 1);
      });
      return Array.from(m.entries())
        .map(([name, value]) => ({ name, value, color: faseColors[name] ?? "#94a3b8" }))
        .sort((a, b) => b.value - a.value);
    }
    const porFase = buildFaseMap(items);
    const porFaseSemSR = buildFaseMap(items.filter((i) => i.responsavel && i.responsavel !== "Sem responsável"));

    // Evolução mensal (últimos 6 meses)
    const evolucaoMensal = Array.from({ length: 6 }, (_, idx) => {
      const d = new Date(agora.getFullYear(), agora.getMonth() - (5 - idx), 1);
      const mesNome = d.toLocaleString("pt-BR", { month: "short" }).replace(".", "");
      const mesItems = items.filter((i) => {
        const c = new Date(i.created_at);
        return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth();
      });
      return {
        mes: mesNome.charAt(0).toUpperCase() + mesNome.slice(1),
        valor: mesItems.reduce((s, i) => s + parseValor(i.valor_global), 0),
        processos: mesItems.length,
      };
    });

    // Alertas: abertura próxima
    const alertas = items
      .filter((i) => i.data && aberturaUrgencia(i.data) !== null && ["À Iniciar", "Iniciado", "Em Andamento"].includes(i.fase))
      .sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""))
      .slice(0, 6);

    // Últimos finalizados
    const ultimosFinalizados = [...finalizadas]
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
      .slice(0, 5);

    // Valor por faixa
    const faixas = [
      { label: "Até R$ 1 mi", min: 0, max: 1_000_000 },
      { label: "R$ 1 mi – R$ 10 mi", min: 1_000_000, max: 10_000_000 },
      { label: "R$ 10 mi – R$ 50 mi", min: 10_000_000, max: 50_000_000 },
      { label: "Acima de R$ 50 mi", min: 50_000_000, max: Infinity },
    ];
    const porFaixaValor = faixas.map((f) => {
      const faixaItems = items.filter((i) => {
        const v = parseValor(i.valor_global);
        return v >= f.min && v < f.max;
      });
      return {
        label: f.label,
        qtd: faixaItems.length,
        valor: faixaItems.reduce((s, i) => s + parseValor(i.valor_global), 0),
      };
    });

    // Responsáveis únicos (para filtro)
    const responsaveis = [...new Set(allItems.map((i) => i.responsavel).filter(Boolean) as string[])].sort();

    return {
      editaisLidos,
      editaisParticipados,
      total: items.length,
      ativas: ativas.length,
      finalizadas: finalizadas.length,
      ganhas,
      totalCapa,
      perdidas,
      valorGlobal,
      qtdPessoasGanhos,
      valorMes,
      valorPipeline,
      taxaVitoria,
      porResponsavel,
      porResponsavelComNP,
      porFase,
      porFaseSemSR,
      evolucaoMensal,
      alertas,
      ultimosFinalizados,
      porFaixaValor,
      responsaveis,
    };
  }, [allItems, filters]);

  return { stats, isLoading, items: allItems };
}
