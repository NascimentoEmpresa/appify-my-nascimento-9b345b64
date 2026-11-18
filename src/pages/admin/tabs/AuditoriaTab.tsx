/**
 * Configurações do ERP › Auditoria sensível.
 *
 * Refeita em 18/11/2026 a pedido do Pablo: a aba mostrava os últimos 150
 * registros de audit_log como JSON cru (UPDATE / public.profiles / uuid) e
 * ninguém entendia quem tinha feito o quê. Agora lê a RPC
 * auditoria_sensivel_eventos (mig 20261118234500), que pagina no servidor e já
 * devolve o evento classificado — quem fez, para quem, tela/módulo/ação,
 * campos antes → depois. A frase em português sai de src/lib/auditoriaSensivel.ts.
 *
 * Só busca quando o filtro muda ou quando a pessoa clica em Atualizar (nada de
 * reler sozinha — src/lib/atualizarTela.ts). O JSON cru continua disponível,
 * recolhido, em "Dados técnicos".
 */
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ChevronDown, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import { usePermissoes } from "@/context/PermissoesContext";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  TIPOS_AUDITORIA,
  eventosParaCsv,
  formatarDataHora,
  fraseEvento,
  inicioDoDiaBrasilia,
  linhasDetalhe,
  periodoDoPreset,
  seloEvento,
  type EventoAuditoria,
  type PresetPeriodo,
  type ResumoAuditoria,
  type TipoAuditoria,
} from "@/lib/auditoriaSensivel";

const POR_PAGINA = 50;
const TODOS = "__todos__";

// RPCs novas ainda fora do types.ts gerado.
type ClienteRpc = { rpc: (nome: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
const rpc = (nome: string, args: Record<string, unknown>) => (supabase as unknown as ClienteRpc).rpc(nome, args);

const TOM_SELO: Record<string, string> = {
  sucesso: "border-success/30 bg-success/10 text-success",
  perigo: "border-destructive/30 bg-destructive/10 text-destructive",
  aviso: "border-warning/30 bg-warning/10 text-warning",
  neutro: "border-border bg-muted text-muted-foreground",
};

function hojeIso() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function AuditoriaTab() {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const canSee = can("visualizar", undefined, "administracao");

  const [preset, setPreset] = useState<PresetPeriodo>("7d");
  const [deData, setDeData] = useState(hojeIso());
  const [ateData, setAteData] = useState(hojeIso());
  const [tipo, setTipo] = useState<string>(TODOS);
  const [ator, setAtor] = useState<string>("");
  const [alvo, setAlvo] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [aberto, setAberto] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);
  const buscaAtrasada = useDebounce(busca.trim(), 400);

  // Período em ISO (UTC); dias contados no calendário de Brasília.
  const periodo = useMemo(() => {
    if (preset !== "personalizado") {
      const p = periodoDoPreset(preset);
      return { de: p.de.toISOString(), ate: p.ate.toISOString() };
    }
    const de = inicioDoDiaBrasilia(deData);
    const ate = new Date(inicioDoDiaBrasilia(ateData).getTime() + 86_400_000);
    return { de: de.toISOString(), ate: ate.toISOString() };
  }, [preset, deData, ateData]);
  const periodoValido = new Date(periodo.ate) > new Date(periodo.de);

  const filtros = {
    _de: periodo.de,
    _ate: periodo.ate,
    _tipo: tipo === TODOS ? null : tipo,
    _ator: ator || null,
    _alvo: alvo || null,
    _busca: buscaAtrasada.length >= 2 ? buscaAtrasada : null,
  };
  const chaveFiltros = JSON.stringify(filtros);
  const mudar = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(0); setAberto(null); };

  // Pessoas para os filtros "Quem fez" e "Pessoa afetada" (~160 logins).
  const pessoasQ = useQuery({
    enabled: canSee,
    queryKey: ["auditoria_sensivel_pessoas"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,display_name,email").order("display_name").limit(2000);
      if (error) throw error;
      return (data ?? []).map((p) => ({ value: p.id, label: p.display_name?.trim() || p.email || p.id, hint: p.email ?? undefined }));
    },
  });

  const resumoQ = useQuery({
    enabled: canSee && periodoValido,
    queryKey: ["auditoria_sensivel_resumo", periodo.de, periodo.ate],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await rpc("auditoria_sensivel_resumo", { _de: periodo.de, _ate: periodo.ate });
      if (error) throw error;
      return data as ResumoAuditoria;
    },
  });

  const eventosQ = useQuery({
    enabled: canSee && periodoValido,
    queryKey: ["auditoria_sensivel_eventos", chaveFiltros, pagina],
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await rpc("auditoria_sensivel_eventos", { ...filtros, _limite: POR_PAGINA, _offset: pagina * POR_PAGINA });
      if (error) throw error;
      return data as { total: number; itens: EventoAuditoria[] };
    },
  });

  const atualizar = () => {
    qc.invalidateQueries({ queryKey: ["auditoria_sensivel_resumo"] });
    qc.invalidateQueries({ queryKey: ["auditoria_sensivel_eventos"] });
  };

  const exportarCsv = async () => {
    setExportando(true);
    try {
      const { data, error } = await rpc("auditoria_sensivel_eventos", { ...filtros, _limite: 5000, _offset: 0 });
      if (error) throw error;
      const r = data as { total: number; itens: EventoAuditoria[] };
      const blob = new Blob([eventosParaCsv(r.itens)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auditoria-sensivel-${periodo.de.slice(0, 10)}-a-${periodo.ate.slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (r.total > r.itens.length) toast.warning(`Exportados ${r.itens.length} de ${r.total} eventos. Diminua o período para pegar todos.`);
    } catch (e) {
      toast.error(`Não foi possível exportar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportando(false);
    }
  };

  if (!canSee) {
    return <section className="card-elevated p-6 text-sm text-muted-foreground">Apenas quem tem acesso à Administração pode ver a trilha de auditoria.</section>;
  }

  const pessoas = pessoasQ.data ?? [];
  const opcoesAtor = [{ value: "sistema", label: "Sistema (automático, sem usuário)" }, ...pessoas];
  const total = eventosQ.data?.total ?? 0;
  const itens = eventosQ.data?.itens ?? [];
  const r = resumoQ.data;

  return (
    <div className="space-y-4">
      <section className="card-elevated">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold">Auditoria de ações sensíveis</h2>
            <p className="text-xs text-muted-foreground">
              Quem deu ou tirou permissão, criou ou desativou login, vinculou empregado e quem entrou no sistema. Horários de Brasília.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/app/admin/smoke-helena"
              className="inline-flex h-9 items-center rounded-md border border-primary/40 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10"
            >
              Smoke Test Helena →
            </a>
            <Button size="sm" variant="outline" onClick={exportarCsv} disabled={exportando || total === 0} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> {exportando ? "Exportando…" : "Exportar CSV"}
            </Button>
            <Button size="sm" variant="outline" onClick={atualizar} className="gap-1.5">
              <RefreshCw className={cn("h-3.5 w-3.5", (eventosQ.isFetching || resumoQ.isFetching) && "animate-spin")} /> Atualizar
            </Button>
          </div>
        </header>

        {/* Filtros */}
        <div className="grid gap-2 border-b border-border px-5 py-3 sm:grid-cols-2 xl:grid-cols-[170px_1fr_1fr_1fr_1.2fr]">
          <div className="space-y-1.5">
            <Select value={preset} onValueChange={(v) => mudar(setPreset)(v as PresetPeriodo)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="90d">Últimos 90 dias</SelectItem>
                <SelectItem value="personalizado">Escolher datas…</SelectItem>
              </SelectContent>
            </Select>
            {preset === "personalizado" && (
              <div className="flex items-center gap-1">
                <Input type="date" value={deData} max={ateData} onChange={(e) => mudar(setDeData)(e.target.value)} className="h-8 px-1.5 text-xs" />
                <span className="text-xs text-muted-foreground">a</span>
                <Input type="date" value={ateData} min={deData} onChange={(e) => mudar(setAteData)(e.target.value)} className="h-8 px-1.5 text-xs" />
              </div>
            )}
          </div>
          <Select value={tipo} onValueChange={mudar(setTipo)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os tipos</SelectItem>
              {TIPOS_AUDITORIA.map((t) => <SelectItem key={t.id} value={t.id}>{t.rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
          <SearchableSelect
            value={ator}
            onChange={mudar(setAtor)}
            options={opcoesAtor}
            placeholder="Quem fez: todos"
            searchPlaceholder="Buscar pessoa…"
            allowClear
            triggerClassName="h-9"
          />
          <SearchableSelect
            value={alvo}
            onChange={mudar(setAlvo)}
            options={pessoas}
            placeholder="Pessoa afetada: todas"
            searchPlaceholder="Buscar pessoa…"
            allowClear
            triggerClassName="h-9"
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar: nome, tela, módulo, e-mail…"
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setPagina(0); }}
              className="h-9 pl-8"
            />
          </div>
        </div>

        {/* Resumo do período */}
        <div className="grid gap-px bg-border sm:grid-cols-3 xl:grid-cols-6">
          <Contador titulo="Permissões dadas" valor={r?.permissoes_dadas} extra={r ? `${r.perfis_concedidos} perfil(is) dado(s)` : undefined} tom="text-success" />
          <Contador titulo="Permissões tiradas" valor={r?.permissoes_removidas} extra={r ? `${r.perfis_removidos} perfil(is) tirado(s)` : undefined} tom="text-destructive" />
          <Contador titulo="Logins novos" valor={r?.usuarios_criados} extra={r ? `${r.logins_vinculados} vinculado(s) a empregado` : undefined} />
          <Contador titulo="Contas desativadas" valor={r?.contas_desativadas} extra={r ? `${r.contas_ativadas} reativada(s)` : undefined} tom="text-warning" />
          <Contador
            titulo={r?.entradas_fonte === "sessoes" ? "Aberturas do ERP" : "Entradas no sistema"}
            valor={r?.entradas}
            extra={r ? `${r.pessoas_que_entraram} pessoa(s)` : undefined}
          />
          <Contador titulo="Telas novas liberadas" valor={r?.modulos_liberados} extra={r ? `${r.total} evento(s) no período` : undefined} />
        </div>
        {r && r.top_atores.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-5 py-2.5 text-xs">
            <span className="font-medium text-muted-foreground">Quem mais alterou:</span>
            {r.top_atores.map((a) => (
              <button
                key={a.id ?? "sistema"}
                onClick={() => mudar(setAtor)(a.id ?? "sistema")}
                className="rounded px-1 hover:bg-secondary"
                title="Filtrar por esta pessoa"
              >
                <span className="font-semibold">{a.nome}</span> <span className="text-muted-foreground">({a.eventos})</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Lista */}
      <section className="card-elevated">
        <div className="flex items-center justify-between border-b border-border px-5 py-2.5 text-xs text-muted-foreground">
          <span>{eventosQ.isLoading ? "Carregando…" : `${total} evento(s)`}</span>
          {total > POR_PAGINA && (
            <Paginacao pagina={pagina} total={total} onMudar={(p) => { setPagina(p); setAberto(null); }} />
          )}
        </div>
        {!periodoValido && <p className="px-5 py-6 text-center text-sm text-muted-foreground">A data final precisa ser depois da inicial.</p>}
        {eventosQ.isError && (
          <p className="px-5 py-6 text-center text-sm text-destructive">
            {/* A Edge/front sobem antes da migration no merge; até ela entrar a RPC não existe. */}
            {/auditoria_sensivel_eventos|PGRST202|schema cache/i.test((eventosQ.error as Error)?.message ?? "")
              ? "A auditoria nova ainda está sendo instalada no banco. Tente de novo em alguns minutos."
              : `Não foi possível carregar: ${(eventosQ.error as Error)?.message}`}
          </p>
        )}
        {!eventosQ.isLoading && !eventosQ.isError && itens.length === 0 && periodoValido && (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">Nenhum evento neste filtro.</p>
        )}
        <ul className={cn("divide-y divide-border", eventosQ.isFetching && !eventosQ.isLoading && "opacity-60")}>
          {itens.map((e) => (
            <LinhaEvento key={e.id} e={e} aberto={aberto === e.id} onAlternar={() => setAberto(aberto === e.id ? null : e.id)} />
          ))}
        </ul>
        {total > POR_PAGINA && (
          <div className="flex justify-end border-t border-border px-5 py-2.5">
            <Paginacao pagina={pagina} total={total} onMudar={(p) => { setPagina(p); setAberto(null); window.scrollTo({ top: 0 }); }} />
          </div>
        )}
      </section>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Permissões por pessoa, perfis de acesso, vínculo login ↔ empregado e quem chamou criar/excluir login, redefinir senha, trocar e-mail
        ou encerrar sessão passaram a ser registrados em 18/11/2026 — antes disso não há registro de quem fez. Tentativa de login com senha
        errada não é registrada pelo servidor de autenticação. "Sistema" = ação automática (robô, gatilho ou função sem usuário).
      </p>
    </div>
  );
}

function Contador({ titulo, valor, extra, tom }: { titulo: string; valor?: number; extra?: string; tom?: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className={cn("font-display text-2xl font-bold", tom)}>{valor ?? "—"}</p>
      {extra && <p className="text-[11px] text-muted-foreground">{extra}</p>}
    </div>
  );
}

function Paginacao({ pagina, total, onMudar }: { pagina: number; total: number; onMudar: (p: number) => void }) {
  const ultima = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">
        {pagina * POR_PAGINA + 1}–{Math.min(total, (pagina + 1) * POR_PAGINA)} de {total}
      </span>
      <Button size="sm" variant="outline" className="h-7 px-2" disabled={pagina === 0} onClick={() => onMudar(pagina - 1)}>Anterior</Button>
      <Button size="sm" variant="outline" className="h-7 px-2" disabled={pagina >= ultima} onClick={() => onMudar(pagina + 1)}>Próxima</Button>
    </div>
  );
}

const ROTULO_TIPO: Record<TipoAuditoria, string> = Object.fromEntries(TIPOS_AUDITORIA.map((t) => [t.id, t.rotulo])) as Record<TipoAuditoria, string>;

function LinhaEvento({ e, aberto, onAlternar }: { e: EventoAuditoria; aberto: boolean; onAlternar: () => void }) {
  const selo = seloEvento(e);
  const detalhes = linhasDetalhe(e);
  const [tecnico, setTecnico] = useState(false);
  const temMais = detalhes.length > 0 || !!e.bruto;
  return (
    <li className="px-5 py-2.5 text-sm">
      <button type="button" onClick={temMais ? onAlternar : undefined} className={cn("flex w-full items-start gap-3 text-left", temMais && "cursor-pointer")}>
        <span className="mt-0.5 w-4 shrink-0 text-muted-foreground">
          {temMais ? (aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
        </span>
        <span className={cn("chip mt-0.5 w-[84px] shrink-0 justify-center border text-[11px]", TOM_SELO[selo.tom])}>{selo.texto}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug">{fraseEvento(e)}</span>
          {!aberto && detalhes.length > 0 && (
            <span className="block truncate text-xs text-muted-foreground">
              {detalhes.slice(0, 3).join(" · ")}{detalhes.length > 3 ? ` · +${detalhes.length - 3}` : ""}
            </span>
          )}
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-mono text-[11px] text-muted-foreground">{formatarDataHora(e.ts)}</span>
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground/80">{ROTULO_TIPO[e.tipo] ?? e.tipo}</span>
        </span>
      </button>
      {aberto && (
        <div className="ml-[116px] mt-2 space-y-2">
          {detalhes.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {detalhes.map((d, i) => <li key={i}>• {d}</li>)}
            </ul>
          )}
          {!!e.bruto && (
            <div>
              <button type="button" onClick={() => setTecnico(!tecnico)} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                {tecnico ? "Esconder dados técnicos" : "Ver dados técnicos"}
              </button>
              {tecnico && (
                <pre className="mt-1 max-h-60 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-relaxed">{JSON.stringify(e.bruto, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
