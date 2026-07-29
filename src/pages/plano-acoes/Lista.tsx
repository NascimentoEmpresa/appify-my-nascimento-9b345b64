import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { isSameDay, isWithinInterval, subDays } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { usePlanoAcoes } from "@/hooks/usePlanoAcoes";
import { usePlanoAcaoPermissao } from "@/hooks/usePlanoAcaoPermissao";
import { usePlanoAcaoFilterOptions, matchResponsavel } from "@/hooks/usePlanoAcaoFilterOptions";
import { STATUS_LABELS, STATUS_COR, PRIORIDADE_LABEL, PRIORIDADE_COR, STATUS_ORDEM, PRIORIDADES } from "@/types/planoAcao";
import { Plus, Search, AlertTriangle, Clock, CheckCircle2, ArrowUp, ArrowDown } from "lucide-react";

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? s : d.toLocaleDateString("pt-BR");
};

type FiltroInclusao = "todos" | "hoje" | "ultimos_7" | "ultimos_30" | "personalizado";

const OPCOES_PERIODO_INCLUSAO: { value: FiltroInclusao; label: string }[] = [
  { value: "todos", label: "Todo o período" },
  { value: "hoje", label: "Hoje" },
  { value: "ultimos_7", label: "Últimos 7 dias" },
  { value: "ultimos_30", label: "Últimos 30 dias" },
  { value: "personalizado", label: "Personalizado" },
];

// "Data de inclusão" (created_at) é sempre passado/presente — por isso só
// presets retroativos, sem "próximos X dias" (que só faz sentido pra datas
// futuras, como em MinhasReunioesCard.tsx).
function dentroPeriodoInclusao(createdAt: string | null, periodo: FiltroInclusao, dataIni: string, dataFim: string): boolean {
  if (periodo === "todos" || !createdAt) return true;
  const data = new Date(createdAt);
  if (isNaN(+data)) return true;
  const agora = new Date();
  if (periodo === "hoje") return isSameDay(data, agora);
  if (periodo === "ultimos_7") return isWithinInterval(data, { start: subDays(agora, 7), end: agora });
  if (periodo === "ultimos_30") return isWithinInterval(data, { start: subDays(agora, 30), end: agora });
  // personalizado
  if (!dataIni && !dataFim) return true;
  if (dataIni && data < new Date(`${dataIni}T00:00:00`)) return false;
  if (dataFim && data > new Date(`${dataFim}T23:59:59.999`)) return false;
  return true;
}

type SortKey = "atualizada" | "comite" | "responsavel";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

// "atualizada" mantém o comportamento já existente (1º clique = mais
// recentes primeiro); as colunas de texto começam em ordem alfabética A→Z.
const SORT_DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = { atualizada: "desc", comite: "asc", responsavel: "asc" };

const cmpTexto = (a: string | null, b: string | null, dirMul: number): number => {
  // Vazio sempre por último, independente da direção.
  const aVazio = !a, bVazio = !b;
  if (aVazio && bVazio) return 0;
  if (aVazio) return 1;
  if (bVazio) return -1;
  return a!.localeCompare(b!, "pt-BR", { sensitivity: "base" }) * dirMul;
};

export default function PlanoAcoesLista() {
  const { data: rows = [], isLoading } = usePlanoAcoes();
  const { can, loading: lp } = usePlanoAcaoPermissao();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const firstRenderRef = useRef(true);

  // Filtros persistidos na URL — sobrevivem à navegação via botão Voltar do browser
  const busca   = searchParams.get("q")      ?? "";
  const fStatus = searchParams.get("status") ?? "__all";
  const fPrior  = searchParams.get("prior")  ?? "__all";
  const fComite = searchParams.get("comite") ?? "__all";
  const fArea   = searchParams.get("area")   ?? "__all";
  const fResp   = searchParams.get("resp")   ?? "__all";
  const fEmpresa = searchParams.get("empresa") ?? "__all";
  const fPeriodo = (searchParams.get("periodo") as FiltroInclusao | null) ?? "todos";
  const fDataIni = searchParams.get("dataIni") ?? "";
  const fDataFim = searchParams.get("dataFim") ?? "";
  const [sort, setSort] = useState<SortState>(null);
  const toggleSort = (key: SortKey) => setSort(prev =>
    !prev || prev.key !== key ? { key, dir: SORT_DEFAULT_DIR[key] } : { key, dir: prev.dir === "asc" ? "desc" : "asc" }
  );

  const setFilter = (key: string, value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value && value !== "__all") next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  };

  const { comites, areas, responsaveis, empresas } = usePlanoAcaoFilterOptions(rows);

  // Na montagem: se a URL não tem filtros, tenta restaurar do sessionStorage
  // Isso garante persistência mesmo ao navegar pelo Sidebar (que não passa params)
  useEffect(() => {
    if (!searchParams.toString()) {
      const saved = sessionStorage.getItem("planoAcoesFilters");
      if (saved) setSearchParams(new URLSearchParams(saved), { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Salva filtros no sessionStorage quando mudam (pula apenas o primeiro render)
  useEffect(() => {
    if (firstRenderRef.current) { firstRenderRef.current = false; return; }
    sessionStorage.setItem("planoAcoesFilters", searchParams.toString());
  }, [searchParams]);

  // Reseta filtros cujos valores deixaram de existir (troca de empresa, etc.)
  // Só executa após os dados estarem carregados para não limpar filtros válidos
  useEffect(() => {
    if (isLoading || rows.length === 0) return;
    if (fComite !== "__all" && !comites.some(o => o.value === fComite)) setFilter("comite", "__all");
    if (fArea   !== "__all" && !areas.some(o => o.value === fArea))     setFilter("area",   "__all");
    if (fResp   !== "__all" && !responsaveis.some(o => o.value === fResp)) setFilter("resp", "__all");
    if (fEmpresa !== "__all" && !empresas.some(o => o.value === fEmpresa)) setFilter("empresa", "__all");
  }, [comites, areas, responsaveis, empresas, isLoading, rows.length]);

  const filtered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = rows.filter(r => {
      if (fStatus !== "__all" && r.status_normalizado !== fStatus) return false;
      if (fPrior  !== "__all" && r.prioridade_normalizada !== fPrior) return false;
      if (fComite !== "__all" && r.comite !== fComite) return false;
      if (fArea   !== "__all" && r.area !== fArea) return false;
      if (!matchResponsavel(r, fResp)) return false;
      if (fEmpresa !== "__all" && r.empresa_id !== fEmpresa) return false;
      if (!dentroPeriodoInclusao(r.created_at, fPeriodo, fDataIni, fDataFim)) return false;
      if (!q) return true;
      return [r.titulo, r.problema, r.acao, r.responsavel_nome_origem, r.id_importacao]
        .filter(Boolean).some(s => (s as string).toLowerCase().includes(q));
    });
    if (!sort) return base;
    const sorted = [...base];
    const dirMul = sort.dir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      if (sort.key === "atualizada") {
        const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return (ta - tb) * dirMul;
      }
      if (sort.key === "comite") {
        const cCmp = cmpTexto(a.comite, b.comite, dirMul);
        return cCmp !== 0 ? cCmp : cmpTexto(a.area, b.area, dirMul);
      }
      return cmpTexto(a.responsavel_nome_origem, b.responsavel_nome_origem, dirMul);
    });
    return sorted;
  }, [rows, busca, fStatus, fPrior, fComite, fArea, fResp, fEmpresa, fPeriodo, fDataIni, fDataFim, sort]);

  if (lp) return null;
  if (!can("visualizar")) return <ForbiddenCard />;

  return (
    <div>
      <PageHeader
        title="Plano de Ações"
        subtitle="Gerenciador de Tarefas Nascimento — todas as ações, com filtros, status e pendências"
        module="Plano de Ações"
        breadcrumb={["Lista geral"]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/app/plano-acoes/dashboard">Dashboard</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/app/plano-acoes/kanban">Kanban</Link></Button>
            {can("importar") && <Button asChild variant="outline" size="sm"><Link to="/app/plano-acoes/importar">Importar</Link></Button>}
            {can("criar") && <Button asChild size="sm"><Link to="/app/plano-acoes/nova"><Plus className="mr-1 h-4 w-4" />Nova ação</Link></Button>}
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar por título, problema, ação, responsável..."
              value={busca}
              onChange={e => setFilter("q", e.target.value)}
            />
          </div>
          <Select value={fStatus} onValueChange={v => setFilter("status", v)}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos os status</SelectItem>
              {STATUS_ORDEM.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fPrior} onValueChange={v => setFilter("prior", v)}>
            <SelectTrigger><SelectValue placeholder="Prioridade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todas as prioridades</SelectItem>
              {PRIORIDADES.map(p => <SelectItem key={p} value={p}>{PRIORIDADE_LABEL[p]}</SelectItem>)}
            </SelectContent>
          </Select>
          <SearchableSelect value={fComite === "__all" ? "" : fComite} onChange={v => setFilter("comite", v || "__all")} options={comites} placeholder="Todos os comitês" searchPlaceholder="Buscar comitê..." allowClear />
          <SearchableSelect value={fArea === "__all" ? "" : fArea}     onChange={v => setFilter("area",   v || "__all")} options={areas}   placeholder="Todos os setores"  searchPlaceholder="Buscar setor..."  allowClear />
          <SearchableSelect value={fResp  === "__all" ? "" : fResp}    onChange={v => setFilter("resp",   v || "__all")} options={responsaveis} placeholder="Todos os responsáveis" searchPlaceholder="Buscar responsável..." allowClear />
          <SearchableSelect value={fEmpresa === "__all" ? "" : fEmpresa} onChange={v => setFilter("empresa", v || "__all")} options={empresas} placeholder="Todas as empresas" searchPlaceholder="Buscar empresa..." allowClear />
          <Select value={fPeriodo} onValueChange={v => setFilter("periodo", v === "todos" ? "" : v)}>
            <SelectTrigger><SelectValue placeholder="Data de inclusão" /></SelectTrigger>
            <SelectContent>
              {OPCOES_PERIODO_INCLUSAO.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {fPeriodo === "personalizado" && (
            <>
              <div>
                <Input type="date" value={fDataIni} onChange={e => setFilter("dataIni", e.target.value)} placeholder="Período inicial" />
              </div>
              <div>
                <Input type="date" value={fDataFim} onChange={e => setFilter("dataFim", e.target.value)} placeholder="Período final" />
              </div>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{filtered.length} de {rows.length} ações</span>
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> {rows.filter(r => r.status_normalizado === "atrasada").length} atrasadas</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-amber-600" /> {rows.filter(r => r.pendencia_evidencia).length} aguardam evidência</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> {rows.filter(r => r.status_normalizado === "concluida_validada").length} validadas</span>
          </span>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="max-h-[calc(100vh-360px)] overflow-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 z-10 bg-muted/50 backdrop-blur">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="p-2 px-3">ID</th>
                <th className="p-2">Empresa</th>
                <th className="p-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("comite")}
                    className="flex items-center gap-1 hover:text-foreground"
                    title="Ordenar por Comitê / Setor"
                  >
                    Comitê / Setor
                    {sort?.key === "comite" && sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                  </button>
                </th>
                <th className="p-2">Título / Problema</th>
                <th className="p-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("responsavel")}
                    className="flex items-center gap-1 hover:text-foreground"
                    title="Ordenar por Responsável"
                  >
                    Responsável
                    {sort?.key === "responsavel" && sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                  </button>
                </th>
                <th className="p-2">Criada em</th>
                <th className="p-2">Prior.</th>
                <th className="p-2">Status</th>
                <th className="p-2">Pend.</th>
                <th className="p-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("atualizada")}
                    className="flex items-center gap-1 hover:text-foreground"
                    title={sort?.key === "atualizada" && sort.dir === "desc" ? "Mostrando mais recentes — clique para mais antigas" : "Mostrando mais antigas — clique para mais recentes"}
                  >
                    Atualizada
                    {sort?.key === "atualizada" && sort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Carregando...</td></tr>
              )}
              {!isLoading && filtered.length === 0 && rows.length === 0 && (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">
                  Você ainda não tem planos de ação visíveis nesta empresa.<br />
                  <span className="text-xs">A visibilidade segue a hierarquia: você vê os planos sob sua responsabilidade, da sua equipe (setor/área/comitê que lidera ou gerencia) ou de toda a empresa, conforme suas permissões. Solicite ao administrador (Erica, Yuri ou Helena) se faltar acesso.</span>
                </td></tr>
              )}
              {!isLoading && filtered.length === 0 && rows.length > 0 && (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Nenhuma ação encontrada com os filtros atuais.</td></tr>
              )}
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                  <td className="p-2 px-3 font-mono text-xs text-muted-foreground">{r.id_importacao ?? r.id.slice(0,8)}</td>
                  <td className="p-2 text-xs">{r.empresas?.codigo ?? "—"}</td>
                  <td className="p-2">
                    <div className="text-xs font-medium">{r.comite ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground">{r.area ?? "—"}</div>
                  </td>
                  <td className="p-2 max-w-[420px]">
                    <Link
                      to={`/app/plano-acoes/${r.id}`}
                      state={{ listSearch: location.search }}
                      className="line-clamp-2 text-foreground hover:text-primary"
                    >
                      {r.titulo || r.problema || "(sem título)"}
                    </Link>
                  </td>
                  <td className="p-2 text-xs">
                    <div>{r.responsavel_nome_origem ?? "—"}</div>
                    {r.lider_comite_nome_origem && <div className="text-[11px] text-muted-foreground">Comitê: {r.lider_comite_nome_origem}</div>}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
                  <td className="p-2">
                    {r.prioridade_normalizada && (
                      <Badge variant="outline" className={`text-[10px] ${PRIORIDADE_COR[r.prioridade_normalizada] ?? ""}`}>
                        {PRIORIDADE_LABEL[r.prioridade_normalizada] ?? r.prioridade_normalizada}
                      </Badge>
                    )}
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[10px] ${STATUS_COR[r.status_normalizado] ?? ""}`}>
                      {STATUS_LABELS[r.status_normalizado] ?? r.status_normalizado}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {r.pendencia_responsavel && <span title="Sem responsável vinculado" className="rounded bg-destructive/10 px-1 text-[10px] text-destructive">resp</span>}
                      {r.pendencia_datas && <span title="Sem datas planejadas" className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-400">dat</span>}
                      {r.pendencia_evidencia && <span title="Concluída sem evidência" className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-400">evid</span>}
                    </div>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{fmtDate(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function ForbiddenCard() {
  return (
    <div>
      <PageHeader title="Plano de Ações" module="Plano de Ações" />
      <Card className="p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h3 className="font-display text-lg font-bold">Acesso restrito</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Você não tem permissão para acessar o módulo Plano de Ações.<br />
          Solicite ao administrador do módulo (Erica, Yuri ou Helena) sua liberação na tela de Configurações.
        </p>
      </Card>
    </div>
  );
}
