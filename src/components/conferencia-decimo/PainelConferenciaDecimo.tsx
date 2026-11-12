import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Banknote, CheckCircle2, ClipboardCheck, Clock,
  DollarSign, FileSpreadsheet, History, Loader2, PlayCircle, Search, Undo2, Users, type LucideIcon,
} from "lucide-react";
import {
  ACOES_PRINCIPAIS, MENU, STATUS_INICIAL, STATUS_TODOS, TABELA, TABELA_EVENTOS,
  competenciaPadrao, contaAvanco, corDoStatus, explicaStatus, faltaPara, fmtBRL, fmtDataHora,
  alertaDoContrato, emAtividade, numeroDaCelula, ordemDoStatus, pct, podeAgir, prazoDaParcela,
  resumoSituacoes, rotuloParcela,
  type Acao, type ContratoDecimo, type EventoDecimo, type LinhaDecimo, type Modulo, type Parcela,
  type PessoaDecimo,
} from "@/lib/conferenciaDecimo/conferencia";
import { ImportarPlanilhaDecimo } from "./ImportarPlanilhaDecimo";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sb = supabase as unknown as SupabaseClient;

/**
 * Conferência de 13º — clone da Conferência de Ponto sem Operacional nem
 * encarregados (12/11/2026). A lista junta os contratos com o andamento da
 * parcela em SISTEMA_CONFERENCIA_DECIMO; contrato sem linha aparece
 * "Pendente RH" e a linha nasce na primeira ação.
 *
 * 13/11/2026 (mig 20261113001000): os contratos vinham de public."CONTRATOS"
 * (filiais da Senior, ATIVO = 'SIM') e o Pablo achou inativos na lista —
 * "tem que puxar todos contratos da licitação, lá eles controlam as situações
 * dos contratos". Agora vêm de decimo_contratos(): os ATIVOS da Licitação (e
 * os que já têm linha na parcela), cada um com as pessoas e a situação delas
 * ("tem uns que tem só uma pessoa com aux doença").
 *
 * Diferente do ponto, nada aqui grava direto na tabela: toda ação passa por
 * `decimo_agir` / `decimo_importar_valores`, que conferem chave e transição
 * no banco (mig 20261112220000).
 */

function Kpi({ titulo, valor, sub, icone: Icone, cor }: {
  titulo: string; valor: string; sub?: string; icone: LucideIcon; cor: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", cor)}>
          <Icone className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
          <p className="text-2xl font-bold leading-tight">{valor}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function Barra({ titulo, feito, total, cor }: { titulo: string; feito: number; total: number; cor: string }) {
  const p = pct(feito, total);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{p}% ({feito}/{total})</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-700", cor)} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export function PainelConferenciaDecimo({ modulo }: { modulo: Modulo }) {
  const { can } = usePermissoes();
  const inicial = useMemo(() => competenciaPadrao(), []);
  const [ano, setAno] = useState(inicial.ano);
  const [parcela, setParcela] = useState<Parcela>(inicial.parcela);
  const [contratos, setContratos] = useState<ContratoDecimo[]>([]);
  const [linhas, setLinhas] = useState<LinhaDecimo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSituacao, setFSituacao] = useState<"" | "alerta">("");
  const [aberta, setAberta] = useState<LinhaDecimo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [importando, setImportando] = useState(false);

  const pode = useCallback(
    (menu: string) => can("visualizar", undefined, menu) || can("alterar", undefined, menu),
    [can],
  );
  const veValores = pode(MENU.valor) || pode(MENU.pagar);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [ct, cf] = await Promise.all([
      sb.rpc("decimo_contratos", { p_ano: ano, p_parcela: parcela }),
      sb.from(TABELA).select("*").eq("ano", ano).eq("parcela", parcela),
    ]);
    if (ct.error) toast.error("Erro ao carregar os contratos: " + ct.error.message);
    if (cf.error) toast.error("Erro ao carregar o andamento: " + cf.error.message);
    setContratos((ct.data as ContratoDecimo[] | null) ?? []);
    setLinhas((cf.data as LinhaDecimo[] | null) ?? []);
    setCarregando(false);
  }, [ano, parcela]);

  useEffect(() => { carregar(); }, [carregar]);

  // decimo_contratos já traz os contratos que têm linha nesta parcela, mesmo
  // encerrados depois — o 13º deles ainda pode estar para pagar.
  const juntas: LinhaDecimo[] = useMemo(() => {
    const idx = new Map(linhas.filter(l => l.contrato_id).map(l => [l.contrato_id, l]));
    const out: LinhaDecimo[] = contratos.map(c => {
      const extra = { nome_empresa: c.empresa, cliente: c.cliente, status_contrato: c.status_contrato, pessoas: c.pessoas ?? [] };
      const achada = idx.get(c.contrato_id);
      if (achada) return { ...achada, contrato_nome: achada.contrato_nome ?? c.nome, ...extra };
      return {
        id: null, contrato_id: c.contrato_id, contrato_nome: c.nome, ...extra,
        ano, parcela, status: STATUS_INICIAL,
        valor: null, qtd_colaboradores: null, valor_origem: null, planilha_nome: null,
        devolucao_motivo: null,
        conferindo_por: null, conferindo_em: null, confirmado_por: null, confirmado_em: null,
        valor_por: null, valor_em: null, liberado_por: null, liberado_em: null,
        pago_por: null, pago_em: null, atualizado_em: null, atualizado_por: null,
      };
    });
    return out.sort((a, b) =>
      ordemDoStatus(a.status) - ordemDoStatus(b.status) ||
      String(a.contrato_nome ?? "").localeCompare(String(b.contrato_nome ?? "")));
  }, [contratos, linhas, ano, parcela]);

  useEffect(() => {
    setAberta(a => (a ? juntas.find(j => j.contrato_id === a.contrato_id) ?? a : a));
  }, [juntas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return juntas.filter(l => {
      if (fStatus && l.status !== fStatus) return false;
      if (fSituacao === "alerta" && !alertaDoContrato(l.pessoas ?? [])) return false;
      if (!q) return true;
      return [l.contrato_nome, l.nome_empresa, l.cliente, ...(l.pessoas ?? []).map(p => p.nome)]
        .some(v => String(v ?? "").toLowerCase().includes(q));
    });
  }, [juntas, busca, fStatus, fSituacao]);

  const avanco = useMemo(() => contaAvanco(juntas.map(l => l.status)), [juntas]);
  const { totalLiberado, totalPago } = useMemo(() => {
    const soma = (st: string) => juntas.filter(l => l.status === st).reduce((s, l) => s + Number(l.valor ?? 0), 0);
    return { totalLiberado: soma("Liberado Financeiro"), totalPago: soma("Pago") };
  }, [juntas]);
  const aguardando = useMemo(
    () => juntas.filter(l => ACOES_PRINCIPAIS.some(a => podeAgir(l.status, a, pode, modulo))).length,
    [juntas, pode, modulo],
  );

  const prazo = useMemo(() => prazoDaParcela(ano, parcela), [ano, parcela]);
  const falta = faltaPara(prazo);

  /** Uma ação, sempre pela RPC. `p_status_esperado` é a trava de concorrência. */
  const agir = async (linha: LinhaDecimo, acao: Acao, extra: { observacao?: string; valor?: number } = {}) => {
    if (!podeAgir(linha.status, acao, pode, modulo)) {
      toast.error("Esta ação não vale agora, não é deste módulo ou você não tem a permissão.");
      return false;
    }
    setSalvando(true);
    const { data, error } = await sb.rpc("decimo_agir", {
      p_contrato_id: linha.contrato_id,
      p_ano: ano, p_parcela: parcela, p_acao: acao,
      p_valor: extra.valor ?? null, p_observacao: extra.observacao ?? null,
      p_status_esperado: linha.status,
    });
    setSalvando(false);
    if (error) {
      toast.error(error.message);
      if (error.code === "40001") { setAberta(null); carregar(); }
      return false;
    }
    toast.success(`${linha.contrato_nome ?? "Contrato"} → ${data?.status ?? "salvo"}`);
    if (acao !== "informar_valor") setAberta(null);
    carregar();
    return true;
  };

  const anos = useMemo(() => {
    const atual = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => atual + 1 - i);
  }, []);

  return (
    <div className="space-y-4">
      {/* ── Competência e prazo ── */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Ano anterior" onClick={() => setAno(a => a - 1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Select value={String(ano)} onValueChange={v => setAno(Number(v))}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Set([...anos, ano])].sort((a, b) => b - a).map(a =>
                  <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" aria-label="Próximo ano" onClick={() => setAno(a => a + 1)}>
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="ml-2 inline-flex rounded-lg border p-0.5">
              {([1, 2] as Parcela[]).map(p => (
                <button key={p} onClick={() => setParcela(p)}
                        className={cn("rounded-md px-3 py-1.5 text-sm font-medium",
                                      parcela === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                  {rotuloParcela(p)}
                </button>
              ))}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Prazo legal de pagamento · {prazo.toLocaleDateString("pt-BR")}
            </p>
            <p className={cn("text-lg font-bold leading-tight tabular-nums", falta ? "text-foreground" : "text-destructive")}>
              {falta ? `faltam ${falta}` : "prazo encerrado"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Avanço ── */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <Barra titulo="RH — liberados ao Financeiro" feito={avanco.rh} total={avanco.total} cor="bg-violet-500" />
          <Barra titulo="Financeiro — pagos" feito={avanco.financeiro} total={avanco.total} cor="bg-emerald-500" />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Contratos na parcela" valor={String(avanco.total)} icone={ClipboardCheck} cor="bg-slate-100 text-slate-700" />
        <Kpi titulo="Aguardando você" valor={String(aguardando)} sub="contratos em que você pode agir"
             icone={Clock} cor="bg-amber-100 text-amber-700" />
        {veValores && (
          <>
            <Kpi titulo="Liberado ao financeiro" valor={fmtBRL(totalLiberado)} icone={DollarSign} cor="bg-indigo-100 text-indigo-700" />
            <Kpi titulo="Pago na parcela" valor={fmtBRL(totalPago)} icone={Banknote} cor="bg-emerald-100 text-emerald-700" />
          </>
        )}
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por contrato, cliente, empresa ou colaborador…"
                 value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Button variant={fSituacao ? "default" : "outline"} onClick={() => setFSituacao(v => (v ? "" : "alerta"))}
                title="Contratos com gente afastada, de férias ou sem ninguém trabalhando">
          <AlertTriangle className="mr-2 h-4 w-4" /> Com situação a olhar
        </Button>
        <Select value={fStatus || "todos"} onValueChange={v => setFStatus(v === "todos" ? "" : v)}>
          <SelectTrigger className="sm:w-60"><SelectValue placeholder="Todos os status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {STATUS_TODOS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {modulo === "rh" && pode(MENU.valor) && (
          <Button variant="outline" onClick={() => setImportando(true)}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Importar planilha da Senior
          </Button>
        )}
        <Button variant="outline" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
        </Button>
      </div>

      {/* ── Lista ── */}
      <Card>
        <CardContent className="p-0">
          {carregando ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…
            </div>
          ) : filtradas.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">
              {juntas.length === 0 ? "Nenhum contrato ativo na Licitação." : "Nada bate com o filtro atual."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead className="hidden lg:table-cell">Empresa</TableHead>
                    <TableHead>Status</TableHead>
                    {veValores && <TableHead className="text-right">Valor</TableHead>}
                    <TableHead className="hidden md:table-cell">Pessoas e situação</TableHead>
                    <TableHead className="hidden md:table-cell text-right">Atualizado</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map(l => {
                    const temAcao = ACOES_PRINCIPAIS.some(a => podeAgir(l.status, a, pode, modulo));
                    return (
                      <TableRow key={l.contrato_id} className="cursor-pointer" onClick={() => setAberta(l)}>
                        <TableCell>
                          <div className="font-medium">{l.contrato_nome || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.cliente || "—"}
                            {l.status_contrato && l.status_contrato !== "ativo" && (
                              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                                contrato {l.status_contrato}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{l.nome_empresa || "—"}</TableCell>
                        <TableCell>
                          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", corDoStatus(l.status))}>
                            {l.status}
                          </span>
                        </TableCell>
                        {veValores && (
                          <TableCell className="text-right tabular-nums">
                            {fmtBRL(l.valor)}
                            {l.valor_origem === "planilha" && (
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">planilha</div>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="hidden md:table-cell">
                          <ResumoPessoas pessoas={l.pessoas ?? []} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-right text-xs text-muted-foreground">
                          {fmtDataHora(l.atualizado_em)}
                        </TableCell>
                        <TableCell>
                          <Button variant={temAcao ? "default" : "ghost"} size="sm"
                                  onClick={e => { e.stopPropagation(); setAberta(l); }}>
                            {temAcao ? "Agir" : "Ver"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DetalheContrato linha={aberta} pode={pode} modulo={modulo} salvando={salvando}
                       veValores={veValores} onFechar={() => setAberta(null)} onAgir={agir} />

      {importando && (
        <ImportarPlanilhaDecimo
          ano={ano} parcela={parcela}
          onFechar={() => setImportando(false)}
          onImportou={() => { setImportando(false); carregar(); }}
        />
      )}
    </div>
  );
}

// ── Detalhe + ações ──────────────────────────────────────────────────
function DetalheContrato({ linha, pode, modulo, salvando, veValores, onFechar, onAgir }: {
  linha: LinhaDecimo | null;
  pode: (menu: string) => boolean;
  modulo: Modulo;
  salvando: boolean;
  veValores: boolean;
  onFechar: () => void;
  onAgir: (l: LinhaDecimo, a: Acao, extra?: { observacao?: string; valor?: number }) => Promise<boolean>;
}) {
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [eventos, setEventos] = useState<EventoDecimo[]>([]);

  useEffect(() => {
    setValor(linha?.valor != null ? String(linha.valor).replace(".", ",") : "");
    setMotivo("");
    setEventos([]);
    if (!linha?.id) return;
    (async () => {
      const { data } = await sb.from(TABELA_EVENTOS)
        .select("*").eq("conferencia_id", linha.id).order("criado_em", { ascending: false }).limit(50);
      setEventos(data ?? []);
    })();
  }, [linha?.id, linha?.valor, linha?.status]);

  if (!linha) return null;
  const l = linha;
  const p = (a: Acao) => podeAgir(l.status, a, pode, modulo);

  const valorDigitado = () => {
    const v = numeroDaCelula(valor);   // "1.234,56", "1234,56" e "1234.56"
    return v != null && v > 0 ? Math.round(v * 100) / 100 : null;
  };
  const salvarValor = () => {
    const v = valorDigitado();
    if (v == null) { toast.error("Informe um valor maior que zero."); return; }
    onAgir(l, "informar_valor", { valor: v });
  };
  const liberar = () => {
    const v = valorDigitado();
    if (v == null) { toast.error("Informe o valor do 13º antes de liberar."); return; }
    onAgir(l, "liberar", v !== Number(l.valor ?? NaN) ? { valor: v } : {});
  };
  const comMotivo = (a: Acao) => {
    if (motivo.trim().length < 10) { toast.error("Escreva o motivo (mín. 10 caracteres)."); return; }
    onAgir(l, a, { observacao: motivo.trim() });
  };

  const algumaAcao = (["andamento", "confirmar", "reabrir", "informar_valor", "liberar",
                       "marcar_pago", "devolver_rh", "problema"] as Acao[]).some(p);

  return (
    <Dialog open onOpenChange={v => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            {l.contrato_nome || "Contrato"} · 13º {l.ano} · {rotuloParcela(l.parcela)}
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", corDoStatus(l.status))}>
              {l.status}
            </span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{explicaStatus(l.status)}</p>

        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <Info rotulo="Empresa" valor={l.nome_empresa} />
          <Info rotulo="Cliente" valor={l.cliente ?? null} />
          <Info rotulo="Contrato na Licitação" valor={l.status_contrato ?? null} />
          {veValores && (
            <Info rotulo="Valor do 13º"
                  valor={l.valor != null
                    ? `${fmtBRL(l.valor)}${l.valor_origem === "planilha" ? ` · planilha${l.planilha_nome ? ` (${l.planilha_nome})` : ""}` : " · digitado"}`
                    : null} />
          )}
          <Info rotulo="Colaboradores na planilha" valor={l.qtd_colaboradores != null ? String(l.qtd_colaboradores) : null} />
          <Info rotulo="Última atualização"
                valor={l.atualizado_por ? `${l.atualizado_por} · ${fmtDataHora(l.atualizado_em)}` : null} />
        </div>

        <PessoasDoContrato pessoas={l.pessoas ?? []} />

        {l.devolucao_motivo && (l.status === "Devolvido RH" || l.status === "Problema") && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="mb-1 text-sm font-semibold text-destructive">
              {l.status === "Problema" ? "Problema apontado" : "Motivo da devolução"}
            </h3>
            <p className="whitespace-pre-wrap text-sm">{l.devolucao_motivo}</p>
          </div>
        )}

        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <Etapa rotulo="Em conferência (RH)" quem={l.conferindo_por} quando={l.conferindo_em} />
          <Etapa rotulo="Conferido (RH)" quem={l.confirmado_por} quando={l.confirmado_em} />
          <Etapa rotulo="Valor informado" quem={l.valor_por} quando={l.valor_em}
                 extra={l.valor != null && veValores ? fmtBRL(l.valor) : null} />
          <Etapa rotulo="Liberado ao Financeiro" quem={l.liberado_por} quando={l.liberado_em} />
          <Etapa rotulo="Pago (Financeiro)" quem={l.pago_por} quando={l.pago_em} />
        </div>

        {algumaAcao ? (
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">O que você pode fazer agora</h3>

            {(p("informar_valor") || p("liberar")) && (
              <div className="space-y-1.5">
                <Label htmlFor="valor-decimo">Valor do 13º do contrato <span className="text-destructive">*</span></Label>
                <div className="flex flex-wrap gap-2">
                  <Input id="valor-decimo" inputMode="decimal" className="sm:w-56" placeholder="0,00"
                         value={valor} onChange={e => setValor(e.target.value)} />
                  {p("informar_valor") && (
                    <Button variant="outline" disabled={salvando} onClick={salvarValor}>Salvar valor</Button>
                  )}
                </div>
              </div>
            )}

            {(p("devolver_rh") || p("problema")) && (
              <div className="space-y-1.5">
                <Label htmlFor="motivo-decimo">
                  Motivo <span className="text-xs text-muted-foreground">(obrigatório para devolver ou marcar problema)</span>
                </Label>
                <Textarea id="motivo-decimo" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                          placeholder="O que precisa ser corrigido?" />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {p("andamento") && (
                <Button variant="outline" disabled={salvando} onClick={() => onAgir(l, "andamento")}>
                  <PlayCircle className="mr-2 h-4 w-4" /> Começar a conferir
                </Button>
              )}
              {p("confirmar") && (
                <Button disabled={salvando} onClick={() => onAgir(l, "confirmar")}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar a conferência
                </Button>
              )}
              {p("liberar") && (
                <Button disabled={salvando} onClick={liberar}>
                  <DollarSign className="mr-2 h-4 w-4" /> Liberar ao Financeiro
                </Button>
              )}
              {p("reabrir") && (
                <Button variant="ghost" disabled={salvando} onClick={() => onAgir(l, "reabrir")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Voltar para conferência
                </Button>
              )}
              {p("marcar_pago") && (
                <Button disabled={salvando} onClick={() => onAgir(l, "marcar_pago")}>
                  <Banknote className="mr-2 h-4 w-4" /> Marcar como pago
                </Button>
              )}
              {p("devolver_rh") && (
                <Button variant="destructive" disabled={salvando} onClick={() => comMotivo("devolver_rh")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Devolver ao RH
                </Button>
              )}
              {p("problema") && (
                <Button variant="outline" disabled={salvando} onClick={() => comMotivo("problema")}>
                  <AlertTriangle className="mr-2 h-4 w-4" /> Marcar problema
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            Este contrato não está na sua etapa — você está acompanhando o andamento.
          </p>
        )}

        <div className="rounded-lg border p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="h-4 w-4" /> Histórico ({eventos.length})
          </h3>
          {eventos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada aconteceu com este contrato nesta parcela ainda.</p>
          ) : (
            <ul className="space-y-2">
              {eventos.map(e => (
                <li key={e.id} className="border-l-2 border-muted pl-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">
                      {e.acao === "importar_planilha" ? "Valor importado" : e.acao === "informar_valor" ? "Valor informado" : e.para_status}
                    </span>
                    <span className="text-xs text-muted-foreground">{e.usuario_nome || "—"} · {fmtDataHora(e.criado_em)}</span>
                  </div>
                  {e.observacao && <p className="text-muted-foreground">{e.observacao}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Lista: "3 pessoas · 1 em Auxílio Doença" — vermelho quando ninguém trabalha. */
function ResumoPessoas({ pessoas }: { pessoas: PessoaDecimo[] }) {
  const alerta = alertaDoContrato(pessoas);
  return (
    <div className="text-sm">
      <span className="tabular-nums">{pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}</span>
      {alerta && (
        <div className={cn("mt-0.5 inline-flex max-w-[260px] items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                           alerta.nivel === "forte" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}
             title={alerta.texto}>
          <AlertTriangle className="h-3 w-3 shrink-0" /> <span className="truncate">{alerta.texto}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Detalhe: as pessoas ativas do contrato e a situação de cada uma, pela
 * mesma ligação do RH › Ativos/Contratos. "Tem uns que tem só uma pessoa com
 * aux doença, aí tem que mostrar essa situação em detalhes" (Pablo, 13/11).
 */
function PessoasDoContrato({ pessoas }: { pessoas: PessoaDecimo[] }) {
  const resumo = resumoSituacoes(pessoas);
  const alerta = alertaDoContrato(pessoas);
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Users className="h-4 w-4" /> Pessoas no contrato ({pessoas.length})
      </h3>
      {alerta && (
        <p className={cn("mb-2 rounded-md px-3 py-2 text-sm",
                         alerta.nivel === "forte" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800")}>
          {alerta.texto}
        </p>
      )}
      {resumo.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {resumo.map(s => (
            <span key={s.situacao}
                  className={cn("rounded-full border px-2 py-0.5 text-xs font-medium",
                                emAtividade(s.situacao) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
              {s.situacao}: {s.n}
            </span>
          ))}
        </div>
      )}
      {pessoas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma pessoa ativa da Senior ligada a este contrato (a ligação é a do RH › Ativos/Contratos).
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Nome</th>
                <th className="hidden p-2 text-left sm:table-cell">Cargo</th>
                <th className="p-2 text-left">Situação</th>
                <th className="hidden p-2 text-right sm:table-cell">Admissão</th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p, i) => (
                <tr key={`${p.cadastro ?? ""}-${p.nome}-${i}`} className="border-t">
                  <td className="p-2">
                    {p.nome}
                    {p.cadastro && <span className="ml-1 text-xs text-muted-foreground">· {p.cadastro}</span>}
                  </td>
                  <td className="hidden p-2 text-muted-foreground sm:table-cell">{p.cargo || "—"}</td>
                  <td className={cn("p-2", !emAtividade(p.situacao) && "font-medium text-amber-700")}>{p.situacao || "—"}</td>
                  <td className="hidden p-2 text-right tabular-nums text-muted-foreground sm:table-cell">{fmtData(p.admissao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Admissão vem como texto da Senior: ISO ou DD/MM/AAAA (os dois convivem). */
function fmtData(s?: string | null) {
  const t = String(s ?? "").trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : t || "—";
}

function Info({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="text-sm font-medium">{valor || "—"}</p>
    </div>
  );
}

function Etapa({ rotulo, quem, quando, extra }: {
  rotulo: string; quem?: string | null; quando?: string | null; extra?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-medium">{rotulo}:</span>
      {quem ? (
        <>
          <span>{quem}</span>
          <span className="text-xs text-muted-foreground">{fmtDataHora(quando)}</span>
          {extra && <span className="text-muted-foreground">— {extra}</span>}
        </>
      ) : (
        <span className="text-muted-foreground">ainda não</span>
      )}
    </div>
  );
}
