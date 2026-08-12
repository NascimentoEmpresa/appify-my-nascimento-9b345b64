import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import {
  useSolicitacoesParaCotar, STATUS_SUPRIMENTOS, ROTULO_COTACAO,
  fmtBRL, fmtData, fmtDataHora,
} from "@/hooks/useMaloteCotacao";
import { STATUS_BADGE_CLASS, type StatusDespesa } from "@/hooks/useMaloteDespesa";
import {
  Hourglass, RefreshCw, XCircle, CheckCircle2, Ban, Search, Inbox, ShieldAlert, FilterX,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SIS-2026-0112 — a fila de Suprimentos no fluxo do Malote.
 *
 * O Malote é o tronco; esta é a etapa em que uma solicitação depende de
 * Suprimentos cotar. Enquanto não cotar, ela fica parada lá.
 *
 * A lista mostra só a **fase Solicitação**. A fase Despesa
 * (pendente_aprovacao, aguardando_pagamento, despesa_paga…) é do Malote e não
 * aparece aqui: Suprimentos não tem o que fazer nela, e mostrar encheria a
 * tela de item inacionável.
 */

const TODOS = "__todos__";

const ICONE: Partial<Record<StatusDespesa, React.ElementType>> = {
  aguardando_cotacao: Hourglass,
  cotacao_realizada: RefreshCw,
  solicitacao_reprovada: XCircle,
  cotacao_aprovada: CheckCircle2,
  cancelada: Ban,
};

const COR_CARD: Partial<Record<StatusDespesa, string>> = {
  aguardando_cotacao: "border-amber-400/50 bg-amber-50/60 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300",
  cotacao_realizada: "border-blue-400/50 bg-blue-50/60 text-blue-700 dark:bg-blue-950/20 dark:text-blue-300",
  solicitacao_reprovada: "border-red-400/50 bg-red-50/60 text-red-700 dark:bg-red-950/20 dark:text-red-300",
  cotacao_aprovada: "border-emerald-400/50 bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300",
  cancelada: "border-border bg-muted/40 text-muted-foreground",
};

const DESCRICAO: Partial<Record<StatusDespesa, string>> = {
  aguardando_cotacao: "Aguardando envio da cotação",
  cotacao_realizada: "Aguardando aprovação da cotação",
  solicitacao_reprovada: "Cotações não aprovadas",
  cotacao_aprovada: "Cotações aprovadas e finalizadas",
  cancelada: "Cotações canceladas",
};

export default function CotacoesMalote() {
  const navegar = useNavigate();
  const { data: empresaId } = useEmpresaId();
  const { data: itens = [], isLoading, error } = useSolicitacoesParaCotar(empresaId ?? null);

  const [status, setStatus] = useState<string>(TODOS);
  const [classificacao, setClassificacao] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");

  const contagem = useMemo(() => {
    const c: Partial<Record<StatusDespesa, number>> = {};
    for (const s of STATUS_SUPRIMENTOS) c[s] = 0;
    for (const i of itens) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [itens]);

  const classificacoes = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of itens) if (i.classificacao) m.set(i.classificacao.id, i.classificacao.nome);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [itens]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (status !== TODOS && i.status !== status) return false;
      if (classificacao !== TODOS && i.classificacao_id !== classificacao) return false;
      if (!t) return true;
      return [i.numero, i.nome, i.motivo, i.classificacao?.nome, String(i.valor_total)]
        .filter(Boolean).join(" ").toLowerCase().includes(t);
    });
  }, [itens, status, classificacao, busca]);

  const temFiltro = status !== TODOS || classificacao !== TODOS || !!busca.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cotações do Malote"
        module="Suprimentos"
        breadcrumb={["Materiais & Catálogo", "Cotações do Malote"]}
        subtitle="Solicitações do Malote que dependem de Suprimentos cotar."
      />

      {/* Cards de contagem — só os cinco status que são desta fase */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {STATUS_SUPRIMENTOS.map((s) => {
          const Icone = ICONE[s] ?? Hourglass;
          const ativo = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(ativo ? TODOS : s)}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-shadow hover:shadow-sm",
                COR_CARD[s],
                ativo && "ring-2 ring-primary ring-offset-1",
              )}
            >
              <Icone className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-2xl font-bold leading-none">{contagem[s] ?? 0}</p>
                <p className="mt-1 text-xs font-semibold">{ROTULO_COTACAO[s]}</p>
                <p className="text-[11px] opacity-80">{DESCRICAO[s]}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
        <div className="min-w-[12rem] flex-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {STATUS_SUPRIMENTOS.map((s) => (
                <SelectItem key={s} value={s}>{ROTULO_COTACAO[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[12rem] flex-1">
          <label className="text-xs text-muted-foreground">Classificação</label>
          <Select value={classificacao} onValueChange={setClassificacao}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {classificacoes.map(([id, nome]) => (
                <SelectItem key={id} value={id}>{nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[16rem] flex-[2]">
          <label className="text-xs text-muted-foreground">Buscar</label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)}
                   placeholder="Nº da despesa, nome, motivo, classificação…" />
          </div>
        </div>

        {temFiltro && (
          <Button variant="outline" onClick={() => { setStatus(TODOS); setClassificacao(TODOS); setBusca(""); }}>
            <FilterX className="mr-2 h-4 w-4" /> Limpar filtros
          </Button>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="font-medium">Não foi possível carregar as solicitações.</p>
          <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Inbox className="h-12 w-12 text-muted-foreground/50" />
          <p className="font-medium">
            {temFiltro ? "Nenhuma solicitação neste filtro." : "Nenhuma solicitação para cotar."}
          </p>
          <p className="text-sm text-muted-foreground">
            {temFiltro ? "Tente outro filtro." : "Quando o Malote enviar uma solicitação, ela aparece aqui."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Nº da Despesa</th>
                <th className="px-3 py-2 text-left font-medium">Nome / Motivo</th>
                <th className="px-3 py-2 text-left font-medium">Classificação</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-3 py-2 text-left font-medium">Pagamento</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Exceção</th>
                <th className="px-3 py-2 text-left font-medium">Última atualização</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => (
                <tr
                  key={i.id}
                  onClick={() => navegar(`/app/suprimentos/cotacoes-malote/${i.id}`)}
                  className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                >
                  <td className="px-3 py-2 font-medium">{i.numero}</td>
                  <td className="max-w-[18rem] px-3 py-2">
                    <p className="truncate">{i.nome}</p>
                    {i.motivo && <p className="truncate text-xs text-muted-foreground">{i.motivo}</p>}
                  </td>
                  <td className="px-3 py-2">{i.classificacao?.nome ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(i.valor_total)}</td>
                  <td className="px-3 py-2">{fmtData(i.data_pagamento)}</td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      STATUS_BADGE_CLASS[i.status])}>
                      {ROTULO_COTACAO[i.status] ?? i.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {i.excecao
                      ? <span className="font-medium text-red-600">Sim</span>
                      : <span className="text-muted-foreground">Não</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDataHora(i.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Mostrando {filtrados.length} de {itens.length} solicitações.
      </p>
    </div>
  );
}
