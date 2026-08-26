import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMeuNome } from "@/hooks/useMeuNome";
import { useAuth } from "@/hooks/useAuth";
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
  AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Banknote, CheckCircle2,
  ClipboardCheck, Clock, DollarSign, History, Loader2, Search, Undo2,
} from "lucide-react";
import {
  MENU, MENU_DA_ACAO, TABELA, TABELA_EVENTOS, addMeses, contaAvanco, corDoStatus,
  explicaStatus, faltaPara, fmtBRL, fmtDataHora, mesLegivel,
  mesPadrao, ordemDoStatus, pct, podeAgir, prazoDoMes, proximoStatus,
  STATUS_INICIAL, STATUS_TODOS,
  type Acao, type EventoConferencia, type LinhaConferencia, type StatusPonto,
} from "@/lib/conferenciaPonto/conferencia";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/**
 * Conferência de Ponto — a tela do fluxo mensal.
 *
 * Porte do dashboard Flask (`sistema_rh/conferencia_ponto`). A lista é a
 * junção de duas coisas: os CONTRATOS ativos (cadastro, fonte única) e o
 * andamento do mês em SISTEMA_CONFERENCIA_PONTO. Contrato sem linha do mês
 * aparece como "Pendente Operacional" mesmo sem existir no banco — a linha
 * nasce na primeira ação, e é por isso que `id` pode ser null aqui.
 *
 * Preparar o mês inteiro de antemão era um botão no sistema antigo; aqui não
 * precisa, porque a linha se cria sozinha quando alguém age. Um botão que só
 * cria 58 linhas vazias para depois preenchê-las é trabalho que a UNIQUE
 * (empresa, filial, mês) já faz de graça.
 */

interface ContratoCad {
  Empresa: number;
  Filial: number;
  "NOME EMPRESA": string | null;
  "NOME CONTRATO": string | null;
  ANALISTA: string | null;
  SUPERVISOR: number | null;
}

function Kpi({ titulo, valor, sub, icone: Icone, cor }: {
  titulo: string; valor: string; sub?: string; icone: any; cor: string;
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

function Barra({ titulo, feito, total, cor }: {
  titulo: string; feito: number; total: number; cor: string;
}) {
  const p = pct(feito, total);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{p}% ({feito}/{total})</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width] duration-700", cor)}
             style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

export function PainelConferenciaPonto() {
  const meuNome = useMeuNome();
  const { user } = useAuth();
  const { can } = usePermissoes();

  const [mes, setMes] = useState(mesPadrao());
  const [contratos, setContratos] = useState<ContratoCad[]>([]);
  const [linhas, setLinhas] = useState<LinhaConferencia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [aberta, setAberta] = useState<LinhaConferencia | null>(null);
  const [salvando, setSalvando] = useState(false);

  /** As quatro chaves do Acesso por Usuário, resolvidas uma vez só. */
  const pode = useCallback(
    (menu: string) => can("visualizar", undefined, menu) || can("alterar", undefined, menu),
    [can],
  );

  // ── Carregamento ───────────────────────────────────────────────────
  // Duas consultas em paralelo: o cadastro (que não muda com o mês) e o
  // andamento (que muda). Juntar no banco exigiria uma view, e a regra de
  // "contrato sem linha = pendente" vive melhor perto da tela.
  const carregar = useCallback(async () => {
    setCarregando(true);
    const [ct, cf] = await Promise.all([
      sb.from("CONTRATOS")
        .select('"Empresa","Filial","NOME EMPRESA","NOME CONTRATO","ANALISTA","SUPERVISOR"')
        .eq("ATIVO", "SIM"),
      sb.from(TABELA).select("*").eq("mes_referencia", mes),
    ]);
    if (ct.error) toast.error("Erro ao carregar os contratos: " + ct.error.message);
    if (cf.error) toast.error("Erro ao carregar o andamento: " + cf.error.message);
    setContratos(ct.data ?? []);
    setLinhas(cf.data ?? []);
    setCarregando(false);
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  /** O cadastro + o andamento do mês, na mesma linha. */
  const juntas: LinhaConferencia[] = useMemo(() => {
    const idx = new Map(linhas.map(l => [`${l.contrato_empresa}__${l.contrato_filial}`, l]));
    return contratos.map(c => {
      const achada = idx.get(`${c.Empresa}__${c.Filial}`);
      if (achada) {
        return { ...achada, nome_empresa: c["NOME EMPRESA"], analista_nome: null, supervisor_nome: null };
      }
      // Contrato sem linha ainda: existe na tela, não no banco.
      return {
        id: null,
        contrato_empresa: c.Empresa,
        contrato_filial: c.Filial,
        contrato_nome: c["NOME CONTRATO"],
        nome_empresa: c["NOME EMPRESA"],
        analista_nome: null,
        supervisor_nome: null,
        mes_referencia: mes,
        status: STATUS_INICIAL,
        valor_folha: null,
        devolucao_motivo: null,
        aprovado_por: null, aprovado_em: null,
        confirmado_por: null, confirmado_em: null,
        valor_por: null, valor_em: null,
        pago_por: null, pago_em: null,
        atualizado_em: null, atualizado_por: null,
      };
    }).sort((a, b) =>
      ordemDoStatus(a.status) - ordemDoStatus(b.status) ||
      String(a.contrato_nome ?? "").localeCompare(String(b.contrato_nome ?? "")),
    );
  }, [contratos, linhas, mes]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return juntas.filter(l => {
      if (fStatus && l.status !== fStatus) return false;
      if (!q) return true;
      return [l.contrato_nome, l.nome_empresa, String(l.contrato_filial)]
        .some(v => String(v ?? "").toLowerCase().includes(q));
    });
  }, [juntas, busca, fStatus]);

  const avanco = useMemo(() => contaAvanco(juntas.map(l => l.status)), [juntas]);
  const totalLiberado = useMemo(
    () => juntas.filter(l => l.status === "Liberado Financeiro").reduce((s, l) => s + Number(l.valor_folha ?? 0), 0),
    [juntas],
  );
  const totalPago = useMemo(
    () => juntas.filter(l => l.status === "Pago").reduce((s, l) => s + Number(l.valor_folha ?? 0), 0),
    [juntas],
  );

  const prazo = useMemo(() => prazoDoMes(mes), [mes]);
  const falta = faltaPara(prazo);

  // ── A ação ─────────────────────────────────────────────────────────
  /**
   * Grava a ação. Se a linha do mês ainda não existe, cria — é o `upsert`
   * que faz o "preparar o mês" ser desnecessário. A trava de concorrência é
   * o `.eq("status", ...)`: se alguém decidiu enquanto a tela estava aberta,
   * o update não pega nada em vez de atropelar a decisão do outro.
   */
  const agir = async (
    linha: LinhaConferencia,
    acao: Acao,
    extra: { observacao?: string; valor?: number } = {},
  ) => {
    const destino = proximoStatus(linha.status, acao);
    if (!destino) { toast.error("Esta ação não vale no estado atual do contrato."); return false; }
    if (!pode(MENU_DA_ACAO[acao])) { toast.error("Você não tem essa permissão."); return false; }

    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = { status: destino, atualizado_por: meuNome };
    if (acao === "aprovar")        { patch.aprovado_por = meuNome;   patch.aprovado_em = agora; }
    if (acao === "confirmar")      { patch.confirmado_por = meuNome; patch.confirmado_em = agora; }
    if (acao === "informar_valor") { patch.valor_por = meuNome;      patch.valor_em = agora; patch.valor_folha = extra.valor; }
    if (acao === "marcar_pago")    { patch.pago_por = meuNome;       patch.pago_em = agora; }
    if (acao === "devolver_op" || acao === "devolver_rh" || acao === "problema") {
      patch.devolucao_motivo = extra.observacao ?? null;
    }

    setSalvando(true);
    let id = linha.id;
    let erro: string | null = null;

    if (id) {
      const { data, error } = await sb.from(TABELA).update(patch)
        .eq("id", id).eq("status", linha.status).select("id");
      if (error) erro = error.message;
      else if (!data?.length) erro = "__concorrencia__";
    } else {
      // Nasce já no status de destino — não há estado intermediário para
      // alguém ver pela metade.
      const { data, error } = await sb.from(TABELA).insert({
        contrato_empresa: linha.contrato_empresa,
        contrato_filial: linha.contrato_filial,
        contrato_nome: linha.contrato_nome,
        mes_referencia: mes,
        ...patch,
      }).select("id").single();
      if (error) erro = error.message;
      else id = data?.id ?? null;
    }

    if (erro === "__concorrencia__") {
      setSalvando(false);
      toast.error("Alguém mexeu neste contrato enquanto você olhava. Recarregando.");
      setAberta(null); carregar();
      return false;
    }
    if (erro) { setSalvando(false); toast.error("Não deu para salvar: " + erro); return false; }

    // A trilha é append-only e não pode derrubar a ação se falhar.
    if (id) {
      await sb.from(TABELA_EVENTOS).insert({
        conferencia_id: id, acao, de_status: linha.status, para_status: destino,
        observacao: extra.observacao ?? (extra.valor != null ? fmtBRL(extra.valor) : null),
        usuario_nome: meuNome, usuario_email: user?.email ?? null,
      });
    }

    setSalvando(false);
    toast.success(`${linha.contrato_nome ?? "Contrato"} → ${destino}`);
    setAberta(null);
    carregar();
    return true;
  };

  return (
    <div className="space-y-4">
      {/* ── Mês e prazo ── */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setMes(m => addMeses(m, -1))}
                    aria-label="Mês anterior">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[140px] text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Mês de referência</p>
              <p className="text-lg font-bold leading-tight">{mesLegivel(mes)}</p>
            </div>
            <Button variant="outline" size="icon" onClick={() => setMes(m => addMeses(m, 1))}
                    aria-label="Próximo mês">
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Input type="month" className="ml-2 w-40" value={mes}
                   onChange={e => e.target.value && setMes(e.target.value)} />
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Prazo de fechamento · {prazo.toLocaleDateString("pt-BR")} 17h
            </p>
            <p className={cn("text-lg font-bold leading-tight tabular-nums",
                             falta ? "text-foreground" : "text-destructive")}>
              {falta ? `faltam ${falta}` : "prazo encerrado"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Avanço por setor ── */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <Barra titulo="Operação — enviados ao RH" feito={avanco.operacional} total={avanco.total} cor="bg-orange-500" />
          <Barra titulo="RH — conferidos" feito={avanco.rh} total={avanco.total} cor="bg-violet-500" />
          <Barra titulo="Financeiro — pagos" feito={avanco.financeiro} total={avanco.total} cor="bg-emerald-500" />
        </CardContent>
      </Card>

      {/* ── Números ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Contratos no mês" valor={String(avanco.total)} icone={ClipboardCheck} cor="bg-slate-100 text-slate-700" />
        <Kpi titulo="Aguardando você" icone={Clock} cor="bg-amber-100 text-amber-700"
             valor={String(juntas.filter(l =>
               (["aprovar", "confirmar", "informar_valor", "marcar_pago"] as Acao[])
                 .some(a => podeAgir(l.status, a, pode)),
             ).length)}
             sub="contratos em que você pode agir" />
        {/* Valores só para quem informa valor ou paga — não é número de todo mundo. */}
        {(pode(MENU.valor) || pode(MENU.pagar)) && (
          <>
            <Kpi titulo="Liberado ao financeiro" valor={fmtBRL(totalLiberado)} icone={DollarSign} cor="bg-indigo-100 text-indigo-700" />
            <Kpi titulo="Pago no mês" valor={fmtBRL(totalPago)} icone={Banknote} cor="bg-emerald-100 text-emerald-700" />
          </>
        )}
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por contrato, empresa ou filial…"
                 value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Select value={fStatus || "todos"} onValueChange={v => setFStatus(v === "todos" ? "" : v)}>
          <SelectTrigger className="sm:w-64"><SelectValue placeholder="Todos os status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {STATUS_TODOS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
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
              {juntas.length === 0
                ? "Nenhum contrato ativo no cadastro."
                : "Nada bate com o filtro atual."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead className="hidden lg:table-cell">Empresa</TableHead>
                    <TableHead>Status</TableHead>
                    {(pode(MENU.valor) || pode(MENU.pagar)) && <TableHead className="text-right">Valor</TableHead>}
                    <TableHead className="hidden md:table-cell text-right">Atualizado</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map(l => {
                    const temAcao = (["aprovar", "confirmar", "informar_valor", "marcar_pago"] as Acao[])
                      .some(a => podeAgir(l.status, a, pode));
                    return (
                      <TableRow key={`${l.contrato_empresa}__${l.contrato_filial}`}
                                className="cursor-pointer" onClick={() => setAberta(l)}>
                        <TableCell>
                          <div className="font-medium">{l.contrato_nome || "—"}</div>
                          <div className="text-xs text-muted-foreground">Filial {l.contrato_filial}</div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {l.nome_empresa || "—"}
                        </TableCell>
                        <TableCell>
                          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", corDoStatus(l.status))}>
                            {l.status}
                          </span>
                        </TableCell>
                        {(pode(MENU.valor) || pode(MENU.pagar)) && (
                          <TableCell className="text-right tabular-nums">
                            {l.valor_folha != null ? fmtBRL(l.valor_folha) : "—"}
                          </TableCell>
                        )}
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

      <DetalheContrato
        linha={aberta} pode={pode} salvando={salvando}
        onFechar={() => setAberta(null)} onAgir={agir}
      />
    </div>
  );
}

// ── Detalhe + ações ──────────────────────────────────────────────────
function DetalheContrato({ linha, pode, salvando, onFechar, onAgir }: {
  linha: LinhaConferencia | null;
  pode: (menu: string) => boolean;
  salvando: boolean;
  onFechar: () => void;
  onAgir: (l: LinhaConferencia, a: Acao, extra?: { observacao?: string; valor?: number }) => Promise<boolean>;
}) {
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [eventos, setEventos] = useState<EventoConferencia[]>([]);

  useEffect(() => {
    setValor(linha?.valor_folha != null ? String(linha.valor_folha) : "");
    setMotivo("");
    setEventos([]);
    if (!linha?.id) return;
    (async () => {
      const { data } = await sb.from(TABELA_EVENTOS)
        .select("*").eq("conferencia_id", linha.id).order("criado_em", { ascending: false }).limit(50);
      setEventos(data ?? []);
    })();
  }, [linha?.id, linha?.valor_folha]);

  if (!linha) return null;
  const l = linha;
  const p = (a: Acao) => podeAgir(l.status, a, pode);

  const informarValor = () => {
    const v = Number(String(valor).replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) { toast.error("Informe um valor maior que zero."); return; }
    onAgir(l, "informar_valor", { valor: v });
  };

  const devolver = (a: Acao) => {
    // Devolver sem motivo devolve o contrato ao ponto de partida sem ninguém
    // saber o que corrigir — a mesma regra da reprovação nas outras telas.
    if (motivo.trim().length < 10) { toast.error("Escreva o motivo (mín. 10 caracteres)."); return; }
    onAgir(l, a, { observacao: motivo.trim() });
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            {l.contrato_nome || "Contrato"} · {mesLegivel(l.mes_referencia)}
            <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", corDoStatus(l.status))}>
              {l.status}
            </span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{explicaStatus(l.status)}</p>

        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <Info rotulo="Empresa" valor={l.nome_empresa} />
          <Info rotulo="Filial" valor={String(l.contrato_filial)} />
          {(pode(MENU.valor) || pode(MENU.pagar)) && (
            <Info rotulo="Valor da folha" valor={l.valor_folha != null ? fmtBRL(l.valor_folha) : null} />
          )}
          <Info rotulo="Última atualização"
                valor={l.atualizado_por ? `${l.atualizado_por} · ${fmtDataHora(l.atualizado_em)}` : null} />
        </div>

        {l.devolucao_motivo && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="mb-1 text-sm font-semibold text-destructive">Motivo da devolução</h3>
            <p className="whitespace-pre-wrap text-sm">{l.devolucao_motivo}</p>
          </div>
        )}

        {/* Trilha das quatro etapas */}
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <Etapa rotulo="Aprovado (Operacional)" quem={l.aprovado_por} quando={l.aprovado_em} />
          <Etapa rotulo="Confirmado (RH)" quem={l.confirmado_por} quando={l.confirmado_em} />
          <Etapa rotulo="Valor informado" quem={l.valor_por} quando={l.valor_em}
                 extra={l.valor_folha != null && (pode(MENU.valor) || pode(MENU.pagar)) ? fmtBRL(l.valor_folha) : null} />
          <Etapa rotulo="Pago (Financeiro)" quem={l.pago_por} quando={l.pago_em} />
        </div>

        {/* ── Ações disponíveis para ESTA pessoa neste status ── */}
        {(p("aprovar") || p("confirmar") || p("informar_valor") || p("marcar_pago") ||
          p("devolver_op") || p("devolver_rh")) ? (
          <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">O que você pode fazer agora</h3>

            {p("informar_valor") && (
              <div className="space-y-1.5">
                <Label htmlFor="valor-folha">Valor da folha <span className="text-destructive">*</span></Label>
                <Input id="valor-folha" inputMode="decimal" className="sm:w-56" placeholder="0,00"
                       value={valor} onChange={e => setValor(e.target.value)} />
              </div>
            )}

            {(p("devolver_op") || p("devolver_rh")) && (
              <div className="space-y-1.5">
                <Label htmlFor="motivo-dev">
                  Motivo <span className="text-xs text-muted-foreground">(obrigatório para devolver)</span>
                </Label>
                <Textarea id="motivo-dev" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
                          placeholder="O que precisa ser corrigido?" />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {p("aprovar") && (
                <Button disabled={salvando} onClick={() => onAgir(l, "aprovar")}>
                  <BadgeCheck className="mr-2 h-4 w-4" /> Aprovar e enviar ao RH
                </Button>
              )}
              {p("confirmar") && (
                <Button disabled={salvando} onClick={() => onAgir(l, "confirmar")}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar a aprovação
                </Button>
              )}
              {p("informar_valor") && (
                <Button disabled={salvando} onClick={informarValor}>
                  <DollarSign className="mr-2 h-4 w-4" /> Informar valor e enviar ao financeiro
                </Button>
              )}
              {p("marcar_pago") && (
                <Button disabled={salvando} onClick={() => onAgir(l, "marcar_pago")}>
                  <Banknote className="mr-2 h-4 w-4" /> Marcar como pago
                </Button>
              )}
              {p("devolver_op") && (
                <Button variant="destructive" disabled={salvando} onClick={() => devolver("devolver_op")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Devolver ao Operacional
                </Button>
              )}
              {p("devolver_rh") && (
                <Button variant="destructive" disabled={salvando} onClick={() => devolver("devolver_rh")}>
                  <Undo2 className="mr-2 h-4 w-4" /> Devolver ao RH
                </Button>
              )}
              {p("problema") && (
                <Button variant="outline" disabled={salvando} onClick={() => devolver("problema")}>
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

        {/* Trilha completa */}
        <div className="rounded-lg border p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="h-4 w-4" /> Histórico ({eventos.length})
          </h3>
          {eventos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada aconteceu com este contrato ainda.</p>
          ) : (
            <ul className="space-y-2">
              {eventos.map(e => (
                <li key={e.id} className="border-l-2 border-muted pl-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{e.para_status}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.usuario_nome || "—"} · {fmtDataHora(e.criado_em)}
                    </span>
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
