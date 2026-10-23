import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertCircle, BarChart3, CalendarDays, CheckCircle2, Download, Eye, FileText, Info, Loader2, MessageSquare, Pencil,
  RotateCcw, Search, Star, Users, XCircle,
} from "lucide-react";
import {
  PRIORIDADES, STATUS_CHAMADO, StatusBadge, PrioridadeBadge, fmtData, fmtDataHora, iniciais, moduloLabel,
} from "./types";
import {
  ADERENCIA_LABEL, CAMPO_AJUSTE_LABEL, COMPLEXIDADE_LABEL, CRITERIOS_INDICE, TEMAS,
  analiseQualidade, avaliarChamado, calcularKpis, leituraControladoria, rankingSolicitantes, resumoTemas,
  temaCor, temaLabel,
  type AjusteMonitor, type CampoAjuste, type ChamadoMonitor, type LinhaMonitor,
} from "@/lib/chamados/monitoramento";
import { cn } from "@/lib/utils";

// =====================================================================
// MONITORAMENTO DE CHAMADOS (22/10/2026, mig 20261022000180).
//
// Visão gerencial da QUALIDADE DAS SOLICITAÇÕES de desenvolvimento: tema,
// índice 0–10 por critérios explícitos, efetividade da entrega, ranking por
// solicitante e leitura para a Controladoria. Os fatos vêm da RPC
// chamados_monitoramento (uma chamada, já com contagens e avaliações); as
// regras moram em src/lib/chamados/monitoramento.ts — esta tela só filtra e
// desenha. Nada é digitado de novo pelo solicitante.
//
// LAYOUT (22/10/2026, à tarde): refeito para ficar igual ao mockup que o
// Pablo mandou ("frontend tem que ficar exatamente como esse") — cabeçalho
// com o quadro azul e o Resumo dos Temas ao lado, 6 indicadores, filtros em
// linha aplicados no "Pesquisar", tabela com seleção e três ações (ver,
// histórico, critérios), Ranking e Análise de qualidade lado a lado. Na tela
// o índice se chama "inteligência", como no mockup; as regras não mudaram.
//
// Ajuste manual (ação "alterar" do menu): grava em
// CHAMADO_SISTEMA_MONITOR_AJUSTE com justificativa; o histórico aparece no
// detalhe do chamado.
// =====================================================================

// As três RPCs da mig 20261022000180 não estão no types.ts gerado.
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc(fn, args);

const MENU = "central_servicos_chamados_monitoramento";
const TODOS = "__todos__";
const POR_PAGINA = 25;

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const inicioAnoISO = () => `${new Date().getFullYear()}-01-01`;
const fmt1 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1).replace(".", ","));
const fmtISO = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");

const corIndice = (n: number) => (n >= 7.5 ? "text-success" : n >= 5 ? "text-warning" : "text-destructive");
const bgIndice = (n: number) => (n >= 8 ? "bg-success" : n >= 6 ? "bg-warning" : "bg-destructive");
const pilulaIndice = (n: number) => (n >= 8.2
  ? "border-success/30 bg-success/10 text-success"
  : n >= 6 ? "border-warning/30 bg-warning/10 text-warning" : "border-destructive/30 bg-destructive/10 text-destructive");

// Avatar com cor fixa por pessoa (o mockup tem um tom por solicitante).
const CORES_AVATAR = [
  "bg-blue-100 text-blue-700", "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700",
  "bg-violet-100 text-violet-700", "bg-rose-100 text-rose-700", "bg-cyan-100 text-cyan-700", "bg-amber-100 text-amber-700",
];
const corAvatar = (chave: string) => CORES_AVATAR[[...chave].reduce((s, ch) => s + ch.charCodeAt(0), 0) % CORES_AVATAR.length];

interface Filtros {
  de: string; ate: string; solic: string; setor: string; modulo: string; tema: string; prioridade: string; status: string;
}
const filtrosIniciais = (): Filtros => ({
  de: inicioAnoISO(), ate: hojeISO(), solic: TODOS, setor: TODOS, modulo: TODOS, tema: TODOS, prioridade: TODOS, status: TODOS,
});

type Foco = "resumo" | "historico" | "criterios";

export default function MonitoramentoChamados() {
  const { data: podeAlterar = false } = useScreenAccess(MENU, "alterar");

  // Rascunho (o que está nos campos) × aplicado (o que a tela mostra): os
  // filtros valem no "Pesquisar", como no mockup. O tema clicado no resumo
  // aplica na hora.
  const [rascunho, setRascunho] = useState<Filtros>(filtrosIniciais);
  const [f, setF] = useState<Filtros>(filtrosIniciais);
  const muda = (p: Partial<Filtros>) => setRascunho((r) => ({ ...r, ...p }));
  const pesquisar = () => { setF(rascunho); setPagina(1); };
  const limpar = () => { const z = filtrosIniciais(); setRascunho(z); setF(z); setPagina(1); };
  const aplicarTema = (tema: string) => { setRascunho((r) => ({ ...r, tema })); setF((x) => ({ ...x, tema })); setPagina(1); };

  const [pagina, setPagina] = useState(1);
  const [detalhe, setDetalhe] = useState<{ id: string; foco: Foco } | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [rankingCompleto, setRankingCompleto] = useState(false);

  const periodoOk = !!f.de && !!f.ate && f.de <= f.ate;
  const { data: chamados = [], isLoading, error } = useQuery({
    queryKey: ["chamados-monitoramento", f.de, f.ate],
    enabled: periodoOk,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await rpc("chamados_monitoramento", { p_de: f.de, p_ate: f.ate });
      if (error) throw error;
      return (data ?? []) as ChamadoMonitor[];
    },
  });

  // Avaliação de TODOS do período (uma vez por carga), depois o filtro.
  const todas: LinhaMonitor[] = useMemo(() => {
    const agora = new Date();
    return chamados.map((c) => ({ c, a: avaliarChamado(c, agora) }));
  }, [chamados]);

  const opcoes = useMemo(() => {
    const solic = new Map<string, string>();
    const setores = new Set<string>();
    const modulos = new Map<string, string>();
    for (const { c } of todas) {
      solic.set(c.solicitante_id, c.solicitante_nome ?? "—");
      if (c.setor?.trim()) setores.add(c.setor.trim());
      const mk = c.modulo_sistema ?? "";
      if (mk) modulos.set(mk, moduloLabel(c));
    }
    return {
      solicitantes: [...solic.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
      setores: [...setores].sort((a, b) => a.localeCompare(b, "pt-BR")),
      modulos: [...modulos.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    };
  }, [todas]);

  const filtradas = useMemo(() => todas.filter(({ c, a }) =>
    (f.solic === TODOS || c.solicitante_id === f.solic)
    && (f.setor === TODOS || (c.setor?.trim() ?? "") === f.setor)
    && (f.modulo === TODOS || c.modulo_sistema === f.modulo)
    && (f.tema === TODOS || a.tema === f.tema)
    && (f.prioridade === TODOS || c.prioridade === f.prioridade)
    && (f.status === TODOS || c.status === f.status),
  ), [todas, f]);

  useEffect(() => { setSelecionados(new Set()); }, [filtradas]);

  const kpis = useMemo(() => calcularKpis(filtradas), [filtradas]);
  const temas = useMemo(() => resumoTemas(filtradas), [filtradas]);
  const ranking = useMemo(() => rankingSolicitantes(filtradas), [filtradas]);
  const qualidade = useMemo(() => analiseQualidade(filtradas), [filtradas]);
  const leitura = useMemo(() => leituraControladoria(filtradas), [filtradas]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtradas.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every(({ c }) => selecionados.has(c.id));

  const pct = (n: number) => (kpis.total ? Math.round((n / kpis.total) * 100) : 0);
  const linhaDetalhe = detalhe ? todas.find((l) => l.c.id === detalhe.id) ?? null : null;
  const maxTema = Math.max(1, ...temas.map((t) => t.qtd));

  const exportarSelecionados = () => {
    const linhas = filtradas.filter(({ c }) => selecionados.has(c.id));
    const cab = ["Solicitante", "Setor", "Nº do chamado", "Assunto", "Tema", "Módulo / Sistema", "Prioridade", "Efetividade (%)", "Inteligência", "Status", "Prazo médio (dias)", "Abertura", "Conclusão"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const corpo = linhas.map(({ c, a }) => [
      c.solicitante_nome, c.setor, c.numero, c.assunto, temaLabel(a.tema), moduloLabel(c), PRIORIDADES[c.prioridade]?.label ?? c.prioridade,
      a.efetividade ?? "", fmt1(a.indice), STATUS_CHAMADO[c.status]?.label ?? c.status, fmt1(a.prazoDias),
      fmtData(c.created_at), c.status === "concluido" ? fmtData(c.concluido_em) : "",
    ].map(esc).join(";"));
    const blob = new Blob(["﻿" + [cab.map(esc).join(";"), ...corpo].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `monitoramento-chamados-${hojeISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* ── Cabeçalho: título + explicação | Resumo dos Temas ── */}
      <div className="mb-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,640px)]">
        <div>
          <PageHeader
            className="mb-4"
            title="Monitoramento de Chamados"
            subtitle="Analise os chamados por solicitante para medir efetividade, relevância operacional e qualidade das demandas no ERP."
            module="Central de Serviços"
            breadcrumb={["Chamados de Sistemas", "Monitoramento de Chamados"]}
          />
          <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-3">
            <p className="flex items-start gap-2 text-sm font-semibold text-info">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              Este painel analisa o conteúdo das solicitações e identifica os principais temas, prioridades e o nível de inteligência de cada demanda.
            </p>
            <p className="ml-6 mt-1 text-xs text-muted-foreground">
              As informações são geradas automaticamente a partir do título e da descrição do chamado.
            </p>
          </div>
        </div>

        <Card className="p-4">
          <p className="mb-2 text-sm font-bold text-foreground">Resumo dos Temas das Solicitações</p>
          {temas.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem solicitações no filtro.</p>
          ) : (
            <div className="space-y-1">
              {temas.map((t) => {
                const ativo = f.tema === t.tema;
                return (
                  <button
                    key={t.tema}
                    type="button"
                    onClick={() => aplicarTema(ativo ? TODOS : t.tema)}
                    title="Filtrar por este tema"
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_2.25rem_2.75rem] items-center gap-3 rounded px-1 py-0.5 text-left text-[13px] hover:bg-muted/60",
                      ativo && "bg-muted",
                    )}
                  >
                    <span className="truncate text-primary">{t.label}</span>
                    <span className="h-3 overflow-hidden rounded-sm bg-muted">
                      <span className="block h-full rounded-sm" style={{ width: `${(t.qtd / maxTema) * 100}%`, background: t.cor }} />
                    </span>
                    <span className="text-right font-bold">{t.qtd}</span>
                    <span className="text-right text-muted-foreground">{t.pct}%</span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Indicadores ── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Indicador icone={Users} cor="bg-info/10 text-info" valor={kpis.solicitantes} rotulo="Solicitantes avaliados" dica="Total de solicitantes no período" />
        <Indicador icone={FileText} cor="bg-info/10 text-info" valor={kpis.total} rotulo="Total de solicitações"
          dica={kpis.canceladas ? `Período selecionado · + ${kpis.canceladas} cancelada(s) à parte` : "Período selecionado"} />
        <Indicador icone={CheckCircle2} cor="bg-success/10 text-success" valor={kpis.concluidas} rotulo="Concluídas" dica={`${pct(kpis.concluidas)}% do total`} />
        <Indicador icone={RotateCcw} cor="bg-warning/10 text-warning" valor={kpis.emAndamento} rotulo="Em andamento" dica={`${pct(kpis.emAndamento)}% do total`} />
        <Indicador icone={AlertCircle} cor="bg-destructive/10 text-destructive" valor={kpis.pendentes} rotulo="Pendentes" dica={`${pct(kpis.pendentes)}% do total`} />
        <Indicador icone={Star} cor="bg-warning/10 text-warning" valor={kpis.indiceMedio == null ? "—" : `${fmt1(kpis.indiceMedio)} / 10`}
          rotulo="Índice de inteligência" dica="Média geral das solicitações" />
      </div>

      {/* ── Filtros (aplicados no Pesquisar) ── */}
      <div className="mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.6fr)_minmax(0,0.6fr)_auto_auto]">
        <div className="space-y-1">
          <Label className="text-xs">Período</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-10 w-full justify-between bg-background px-3 font-normal">
                <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" />{fmtISO(rascunho.de)} - {fmtISO(rascunho.ate)}</span>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Abertura de</Label>
                <Input type="date" value={rascunho.de} onChange={(e) => muda({ de: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">até</Label>
                <Input type="date" value={rascunho.ate} onChange={(e) => muda({ ate: e.target.value })} />
              </div>
              {rascunho.de > rascunho.ate && <p className="text-xs text-destructive">A data inicial passa da final.</p>}
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Solicitante</Label>
          <SearchableSelect
            value={rascunho.solic}
            onChange={(v) => muda({ solic: v })}
            options={[{ value: TODOS, label: "Todos os solicitantes" }, ...opcoes.solicitantes]}
            placeholder="Todos os solicitantes"
          />
        </div>
        <FiltroSelect label="Setor" value={rascunho.setor} onChange={(v) => muda({ setor: v })} todos="Todos os setores"
          opcoes={opcoes.setores.map((s) => ({ value: s, label: s }))} />
        <FiltroSelect label="Módulo / Sistema" value={rascunho.modulo} onChange={(v) => muda({ modulo: v })} todos="Todos os módulos" opcoes={opcoes.modulos} />
        <FiltroSelect label="Resumo do Tema da Solicitação" value={rascunho.tema} onChange={(v) => muda({ tema: v })} todos="Todos os temas"
          opcoes={TEMAS.map((t) => ({ value: t.value, label: t.label }))} />
        <FiltroSelect label="Prioridade" value={rascunho.prioridade} onChange={(v) => muda({ prioridade: v })} todos="Todas"
          opcoes={Object.entries(PRIORIDADES).map(([value, p]) => ({ value, label: p.label }))} />
        <FiltroSelect label="Status" value={rascunho.status} onChange={(v) => muda({ status: v })} todos="Todos"
          opcoes={Object.entries(STATUS_CHAMADO).map(([value, s]) => ({ value, label: s.label }))} />
        <Button variant="outline" className="h-10 gap-1.5 bg-background" onClick={limpar}><RotateCcw className="h-4 w-4" /> Limpar filtros</Button>
        <Button className="h-10 gap-1.5 px-6" onClick={pesquisar} disabled={!rascunho.de || !rascunho.ate || rascunho.de > rascunho.ate}>
          <Search className="h-4 w-4" /> Pesquisar
        </Button>
      </div>

      {/* ── Detalhamento ── */}
      <Card className="mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">Detalhamento das solicitações por solicitante</p>
          {selecionados.size > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {selecionados.size} selecionado(s)
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={exportarSelecionados}><Download className="h-3.5 w-3.5" /> Exportar</Button>
            </div>
          )}
        </div>
        {error ? (
          <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando chamados…</div>
        ) : filtradas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nenhum chamado no filtro.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] border-collapse text-xs">
                <thead>
                  <tr className="border-b text-left text-[11px] font-semibold text-muted-foreground">
                    <th className="w-8 py-2 pl-1">
                      <Checkbox
                        checked={todosVisiveisMarcados}
                        onCheckedChange={(v) => setSelecionados((s) => {
                          const n = new Set(s);
                          for (const { c } of visiveis) { if (v) n.add(c.id); else n.delete(c.id); }
                          return n;
                        })}
                        aria-label="Selecionar todos da página"
                      />
                    </th>
                    <th className="py-2 pr-2">Solicitante</th>
                    <th className="py-2 pr-2">Setor</th>
                    <th className="py-2 pr-2">Nº do chamado</th>
                    <th className="py-2 pr-2">Assunto</th>
                    <th className="py-2 pr-2">Resumo do Tema da Solicitação</th>
                    <th className="py-2 pr-2">Módulo / Sistema</th>
                    <th className="py-2 pr-2">Prioridade</th>
                    <th className="py-2 pr-2">Efetividade</th>
                    <th className="py-2 pr-2">Inteligência</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2 leading-tight">Prazo médio<br />(dias)</th>
                    <th className="py-2 pr-2">Abertura</th>
                    <th className="py-2 pr-2">Conclusão</th>
                    <th className="py-2 pr-1 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map(({ c, a }) => (
                    <tr key={c.id} className={cn("border-b last:border-0 hover:bg-muted/40", a.cancelado && "opacity-70")}>
                      <td className="py-2 pl-1">
                        <Checkbox
                          checked={selecionados.has(c.id)}
                          onCheckedChange={(v) => setSelecionados((s) => { const n = new Set(s); if (v) n.add(c.id); else n.delete(c.id); return n; })}
                          aria-label={`Selecionar ${c.numero ?? "chamado"}`}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", corAvatar(c.solicitante_id))}>
                            {iniciais(c.solicitante_nome)}
                          </span>
                          <span className="line-clamp-2 max-w-[110px] font-medium" title={c.solicitante_nome ?? ""}>{c.solicitante_nome ?? "—"}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-2"><span className="line-clamp-2 max-w-[110px]" title={c.setor ?? ""}>{c.setor ?? "—"}</span></td>
                      <td className="whitespace-nowrap py-2 pr-2 font-bold">{c.numero ? `#${c.numero}` : "—"}</td>
                      <td className="py-2 pr-2"><span className="line-clamp-2 max-w-[200px]" title={c.assunto}>{c.assunto}</span></td>
                      <td className="py-2 pr-2">
                        <span
                          className="line-clamp-2 block max-w-[160px] rounded-md px-2 py-1 text-[11px] font-semibold leading-tight"
                          style={{ color: temaCor(a.tema), background: `${temaCor(a.tema)}1f` }}
                          title={`${temaLabel(a.tema)}${a.ajustado.includes("tema") ? " (ajustado manualmente)" : ""}`}
                        >
                          {temaLabel(a.tema)}{a.ajustado.includes("tema") && " *"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-2">{moduloLabel(c)}</td>
                      <td className="py-2 pr-2"><PrioridadeBadge prioridade={c.prioridade} /></td>
                      <td className="py-2 pr-2">
                        {a.efetividade == null ? (
                          <span className="text-muted-foreground" title={a.efetividadeMotivo}>—</span>
                        ) : (
                          <div className="flex items-center gap-2" title={a.efetividadeMotivo}>
                            <span className="w-8 font-bold">{a.efetividade}%</span>
                            <span className="h-2 w-14 overflow-hidden rounded-full bg-muted">
                              <span className={cn("block h-full rounded-full", a.efetividade >= 80 ? "bg-success" : "bg-info")} style={{ width: `${a.efetividade}%` }} />
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-1.5 whitespace-nowrap" title={a.preliminar ? "Avaliação preliminar — chamado ainda não concluído" : "Avaliação final"}>
                          <span className={cn("h-2 w-2 rounded-full", bgIndice(a.indice))} />
                          <b>{fmt1(a.indice)}</b>
                          {a.ajustado.includes("indice") && " *"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-2 [&>*]:whitespace-nowrap"><StatusBadge status={c.status} /></td>
                      <td className="py-2 pr-2">{a.prazoDias == null ? "-" : a.prazoDias.toFixed(1)}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{fmtData(c.created_at)}</td>
                      <td className="whitespace-nowrap py-2 pr-2">{c.status === "concluido" || c.status === "cancelado" ? fmtData(c.concluido_em) : "-"}</td>
                      <td className="py-2 pr-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver o chamado" onClick={() => setDetalhe({ id: c.id, foco: "resumo" })}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Histórico do chamado e dos ajustes" onClick={() => setDetalhe({ id: c.id, foco: "historico" })}>
                            <MessageSquare className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Critérios da avaliação" onClick={() => setDetalhe({ id: c.id, foco: "criterios" })}>
                            <BarChart3 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                * ajustado manualmente · não concluído = avaliação preliminar · cancelados à parte, sem pesar no solicitante
                {kpis.efetividadeMedia != null && <> · efetividade média das entregas: <b className="text-foreground">{kpis.efetividadeMedia}%</b></>}
              </span>
              {totalPaginas > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
                  <span>Página {paginaAtual} de {totalPaginas}</span>
                  <Button variant="outline" size="sm" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      {/* ── Ranking | Análise de qualidade ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <p className="mb-2 text-sm font-bold">Ranking dos solicitantes</p>
          {ranking.length === 0 ? <p className="text-xs text-muted-foreground">Sem dados.</p> : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-[11px] font-semibold text-muted-foreground">
                    <th className="w-10 py-1.5">#</th>
                    <th className="py-1.5">Solicitante</th>
                    <th className="py-1.5 text-center">Total de chamados</th>
                    <th className="py-1.5 text-center">Média de inteligência</th>
                    <th className="py-1.5 text-center">Efetividade média</th>
                  </tr>
                </thead>
                <tbody>
                  {(rankingCompleto ? ranking : ranking.slice(0, 5)).map((r, i) => (
                    <tr key={r.solicitante_id} className="cursor-pointer hover:bg-muted/40" title="Filtrar por este solicitante"
                      onClick={() => { setRascunho((x) => ({ ...x, solic: r.solicitante_id })); setF((x) => ({ ...x, solic: r.solicitante_id })); setPagina(1); }}>
                      <td className="py-1.5">
                        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                          i === 0 ? "bg-amber-400 text-white" : i === 1 ? "bg-slate-400 text-white" : i === 2 ? "bg-orange-500 text-white" : "")}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="py-1.5 font-medium">{r.nome}</td>
                      <td className="py-1.5 text-center">{r.total}</td>
                      <td className="py-1.5 text-center">
                        <span className={cn("inline-block min-w-[44px] rounded border px-2 py-0.5 font-semibold", pilulaIndice(r.indiceMedio))}>{fmt1(r.indiceMedio)}</span>
                      </td>
                      <td className="py-1.5 text-center font-bold text-info">{r.efetividadeMedia == null ? "—" : `${r.efetividadeMedia}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ranking.length > 5 && (
                <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => setRankingCompleto((v) => !v)}>
                  {rankingCompleto ? "Mostrar só os 5 primeiros" : `Ver o ranking completo (${ranking.length})`}
                </button>
              )}
            </>
          )}
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-bold">Análise de qualidade das solicitações</p>
          <div className="space-y-2.5">
            <BarraQualidade label="Solicitações com objetivo claro" pct={qualidade.objetivoClaro} cor="bg-success" />
            <BarraQualidade label="Solicitações com grande relevância operacional" pct={qualidade.relevanciaOperacional} cor="bg-info" />
            <BarraQualidade label="Solicitações que trazem melhoria de processo" pct={qualidade.melhoriaProcesso} cor="bg-warning" />
            <BarraQualidade label="Solicitações com visão estratégica" pct={qualidade.visaoEstrategica} cor="bg-destructive" />
          </div>
          <div className="mt-4 rounded-md border border-info/30 bg-info/5 p-3">
            <p className="flex items-start gap-2 text-xs">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <span><b className="text-info">Leitura da Controladoria:</b><br /><span className="text-muted-foreground">{leitura}</span></span>
            </p>
          </div>
        </Card>
      </div>

      {linhaDetalhe && detalhe && (
        <DetalheDialog linha={linhaDetalhe} foco={detalhe.foco} podeAlterar={podeAlterar} onClose={() => setDetalhe(null)} />
      )}
    </div>
  );
}

function Indicador({ icone: Icone, cor, valor, rotulo, dica }: {
  icone: LucideIcon; cor: string; valor: React.ReactNode; rotulo: string; dica: string;
}) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", cor)}><Icone className="h-6 w-6" /></span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-tight">{valor}</p>
        <p className="text-sm text-muted-foreground">{rotulo}</p>
        <p className="truncate text-[11px] text-muted-foreground/80">{dica}</p>
      </div>
    </Card>
  );
}

function FiltroSelect({ label, value, onChange, todos, opcoes }: {
  label: string; value: string; onChange: (v: string) => void; todos: string;
  opcoes: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="block truncate text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-background"><SelectValue placeholder={todos} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>{todos}</SelectItem>
          {opcoes.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function BarraQualidade({ label, pct, cor }: { label: string; pct: number; cor: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_2.75rem_minmax(0,1fr)] items-center gap-3 text-xs">
      <span className="truncate">{label}</span>
      <b className="text-right text-sm">{pct}%</b>
      <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", cor)} style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

// ---- Detalhe: critérios, conversa e histórico de ajustes -----------------
interface DetalheRpc {
  eventos: Array<{ id: string; tipo: string; texto: string | null; autor: string | null; created_at: string }>;
  anexos: Array<{ nome: string; campo: string; created_at: string }>;
  ajustes: AjusteMonitor[];
}

function valorExibido(campo: CampoAjuste, l: LinhaMonitor): string {
  const { a } = l;
  switch (campo) {
    case "tema": return a.tema;
    case "complexidade": return a.complexidade;
    case "aderencia": return a.aderencia;
    case "efetividade": return a.efetividade == null ? "" : String(a.efetividade);
    case "indice": return String(a.indice);
  }
}

function rotuloValor(campo: string, v: string | null): string {
  if (v == null || v === "") return "automático";
  if (campo === "tema") return temaLabel(v);
  if (campo === "complexidade") return COMPLEXIDADE_LABEL[v as keyof typeof COMPLEXIDADE_LABEL] ?? v;
  if (campo === "aderencia") return ADERENCIA_LABEL[v as keyof typeof ADERENCIA_LABEL] ?? v;
  if (campo === "efetividade") return `${v}%`;
  return v.replace(".", ",");
}

function DetalheDialog({ linha, foco, podeAlterar, onClose }: { linha: LinhaMonitor; foco: Foco; podeAlterar: boolean; onClose: () => void }) {
  // As três ações da linha abrem o mesmo detalhe, cada uma na sua seção.
  useEffect(() => {
    if (foco === "resumo") return;
    const t = setTimeout(() => document.getElementById(`monitor-${foco}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(t);
  }, [foco]);
  const { c, a } = linha;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["chamado-monitoramento-detalhe", c.id],
    queryFn: async () => {
      const { data, error } = await rpc("chamado_monitoramento_detalhe", { p_chamado_id: c.id });
      if (error) throw error;
      return data as DetalheRpc;
    },
  });

  const [campo, setCampo] = useState<CampoAjuste>("tema");
  const [valor, setValor] = useState<string>("");
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async (voltarAutomatico: boolean) => {
    if (justificativa.trim().length < 10) {
      toast({ title: "Explique o ajuste", description: "A justificativa precisa de pelo menos 10 caracteres.", variant: "destructive" });
      return;
    }
    if (!voltarAutomatico && !valor.trim()) {
      toast({ title: "Informe o novo valor", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const { error } = await rpc("chamado_monitoramento_ajustar", {
      p_chamado_id: c.id, p_campo: campo, p_valor: voltarAutomatico ? null : valor.trim(),
      p_valor_anterior: valorExibido(campo, linha), p_justificativa: justificativa.trim(),
    });
    setSalvando(false);
    if (error) {
      toast({ title: "Não foi possível ajustar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ajuste registrado", description: `${CAMPO_AJUSTE_LABEL[campo]}: ${voltarAutomatico ? "voltou ao automático" : rotuloValor(campo, valor.trim())}` });
    setValor(""); setJustificativa("");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["chamados-monitoramento"] }),
      qc.invalidateQueries({ queryKey: ["chamado-monitoramento-detalhe", c.id] }),
    ]);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {c.numero} <StatusBadge status={c.status} /> <PrioridadeBadge prioridade={c.prioridade} />
          </DialogTitle>
          <DialogDescription>{c.assunto} — {c.solicitante_nome ?? "—"} ({c.setor ?? "sem setor"}) · aberto em {fmtData(c.created_at)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="p-3">
            <p className="text-[11px] text-muted-foreground">Índice de inteligência {a.preliminar && "(preliminar)"}</p>
            <p className={`text-2xl font-bold ${corIndice(a.indice)}`}>{fmt1(a.indice)}<span className="text-sm text-muted-foreground"> / 10</span></p>
            {a.ajustado.includes("indice") && <p className="text-[10px] text-muted-foreground">automático: {fmt1(a.indiceAuto)}</p>}
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted-foreground">Efetividade da entrega</p>
            <p className="text-2xl font-bold">{a.efetividade == null ? "—" : `${a.efetividade}%`}</p>
            <p className="text-[10px] text-muted-foreground">{a.efetividadeMotivo}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted-foreground">Tema</p>
            <p className="text-sm font-bold" style={{ color: temaCor(a.tema) }}>{temaLabel(a.tema)}</p>
            <p className="text-[10px] text-muted-foreground">
              {a.ajustado.includes("tema") ? `ajustado (automático: ${temaLabel(a.temaAuto.tema)})` : a.temaAuto.motivo}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">Complexidade {COMPLEXIDADE_LABEL[a.complexidade]} · Aderência {ADERENCIA_LABEL[a.aderencia]}</p>
          </Card>
        </div>

        <div>
          <p id="monitor-criterios" className="mb-1 scroll-mt-4 text-xs font-bold">Critérios do índice de inteligência</p>
          <Table className="text-xs">
            <TableBody>
              {CRITERIOS_INDICE.map((k) => {
                const n = a.criterios[k.key];
                return (
                  <TableRow key={k.key}>
                    <TableCell className="py-1.5 font-medium">{k.titulo} <span className="text-muted-foreground">({Math.round(k.peso * 100)}%)</span></TableCell>
                    <TableCell className={`py-1.5 text-right font-bold ${n.nota == null ? "text-muted-foreground" : corIndice(n.nota)}`}>{fmt1(n.nota)}</TableCell>
                    <TableCell className="py-1.5 text-muted-foreground">{n.motivo}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div>
          <p className="mb-1 text-xs font-bold">Descrição do solicitante</p>
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs [overflow-wrap:anywhere]">{c.descricao || "—"}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {c.anexos_abertura} anexo(s) na abertura · {c.anexos_total} no total · {c.comentarios} mensagem(ns) · {c.pedidos_info} pedido(s) de informação · {c.reaberturas} reabertura(s)
            {c.prazo_previsto && <> · prazo previsto {fmtData(c.prazo_previsto)}</>}
          </p>
        </div>

        {podeAlterar && (
          <Card className="space-y-2 border-warning/30 bg-warning/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold"><Pencil className="h-3.5 w-3.5" /> Ajuste manual (fica no histórico)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={campo} onValueChange={(v) => { setCampo(v as CampoAjuste); setValor(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CAMPO_AJUSTE_LABEL) as CampoAjuste[]).map((k) => <SelectItem key={k} value={k}>{CAMPO_AJUSTE_LABEL[k]}</SelectItem>)}
                </SelectContent>
              </Select>
              {campo === "tema" ? (
                <Select value={valor} onValueChange={setValor}>
                  <SelectTrigger><SelectValue placeholder="Novo tema" /></SelectTrigger>
                  <SelectContent>{TEMAS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : campo === "complexidade" || campo === "aderencia" ? (
                <Select value={valor} onValueChange={setValor}>
                  <SelectTrigger><SelectValue placeholder="Novo valor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixa">Baixa</SelectItem>
                    <SelectItem value="media">Média</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  inputMode="decimal"
                  placeholder={campo === "indice" ? "0 a 10" : "0 a 100"}
                  value={valor}
                  onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ""))}
                />
              )}
            </div>
            <Textarea rows={2} placeholder="Justificativa (obrigatória)" value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">Atual: {rotuloValor(campo, valorExibido(campo, linha))}{a.ajustado.includes(campo) ? " (ajustado)" : " (automático)"}</p>
            <div className="flex flex-wrap justify-end gap-2">
              {a.ajustado.includes(campo) && (
                <Button variant="outline" size="sm" disabled={salvando} onClick={() => salvar(true)}>Voltar ao automático</Button>
              )}
              <Button size="sm" disabled={salvando} onClick={() => salvar(false)} className="gap-1.5">
                {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Registrar ajuste
              </Button>
            </div>
          </Card>
        )}

        <div>
          <p id="monitor-historico" className="mb-1 scroll-mt-4 text-xs font-bold">Histórico de ajustes</p>
          {isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p>
            : !data?.ajustes.length ? <p className="text-xs text-muted-foreground">Nenhum ajuste manual — tudo automático.</p>
            : (
              <ul className="space-y-1.5">
                {data.ajustes.map((j) => (
                  <li key={j.id} className="rounded-md border p-2 text-xs">
                    <p><b>{CAMPO_AJUSTE_LABEL[j.campo] ?? j.campo}</b>: {rotuloValor(j.campo, j.valor_anterior)} → <b>{rotuloValor(j.campo, j.valor)}</b></p>
                    <p className="text-muted-foreground">{j.justificativa}</p>
                    <p className="text-[10px] text-muted-foreground">{j.autor_nome ?? "—"} · {fmtDataHora(j.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div>
          <p className="mb-1 text-xs font-bold">Histórico do chamado</p>
          {isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p>
            : !data?.eventos.length ? <p className="text-xs text-muted-foreground">Sem movimentações.</p>
            : (
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {data.eventos.map((e) => (
                  <li key={e.id} className="text-xs">
                    <span className="text-muted-foreground">{fmtDataHora(e.created_at)} · {e.autor ?? "—"}:</span>{" "}
                    <span className="break-words [overflow-wrap:anywhere]">{e.texto || e.tipo}</span>
                  </li>
                ))}
              </ul>
            )}
          {!!data?.anexos.length && (
            <p className="mt-1 text-[11px] text-muted-foreground">Anexos: {data.anexos.map((x) => x.nome).join(", ")}</p>
          )}
        </div>

        {c.status === "cancelado" && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><XCircle className="h-3.5 w-3.5" /> Cancelado pelo solicitante — fora das médias e do ranking.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
