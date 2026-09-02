import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMeuNome } from "@/hooks/useMeuNome";
import { usePermissoes } from "@/context/PermissoesContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import {
  ArrowRight, Building2, CheckCircle2, Clock, Loader2, Search, Stethoscope,
  ThumbsDown, ThumbsUp, UserCog, XCircle,
} from "lucide-react";
import {
  ROTULO_ORIGEM, TABELA, corDoStatus, explicaStatus, fmtData, fmtDataHora,
  origemDa, origensVisiveis, pertenceAFila, podeAgirEm, proximoStatus,
  resumoSST, statusVisiveis,
  type Etapa, type Origem, type SolicitacaoTroca,
} from "@/lib/trocaFuncao/solicitacao";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/**
 * Painel da mudança de função — a MESMA tela para as três etapas.
 *
 *   aprovacao → aprova (segue para o SST) ou reprova COM MOTIVO;
 *   sst       → marca o ASO, OU dispensa quando a função não exige exame;
 *   rh        → faz a alteração na Senior e conclui.
 *
 * Um componente só porque lista, filtro, detalhe e chat são idênticos: o que
 * muda é quem age e sobre qual status. Cópias divergiriam na primeira
 * correção feita em uma delas — foi exatamente assim que o botão do Malote e
 * o statusObr do Patrimônio quebraram.
 *
 * CONTRATO x ESCRITÓRIO (25/08/2026): eram duas telas, viraram um FILTRO.
 * Quem enxerga o quê sai da permissão, não da rota — `operacional_troca_funcao`
 * mostra as de contrato, `escritorio_troca_funcao` mostra as do
 * administrativo. As duas rotas antigas continuam de pé e caem aqui; quem só
 * tem uma permissão vê só a sua fila e o seletor de origem nem aparece.
 */

const ROTULO: Record<Etapa, { acao: string; icone: any; ajuda: string }> = {
  analista:  { acao: "Validar",  icone: ThumbsUp,    ajuda: "Validar manda para a aprovação do Operacional (ou do administrativo, se for do escritório)." },
  aprovacao: { acao: "Aprovar",  icone: ThumbsUp,    ajuda: "Aprovar manda para o SST." },
  sst:       { acao: "ASO marcado", icone: Stethoscope, ajuda: "Informe a data do ASO — ou dispense, se a função não exige exame novo. Depois segue para o RH." },
  rh:        { acao: "Concluir", icone: CheckCircle2, ajuda: "Confirme depois de alterar o cargo na Senior." },
};

function Kpi({ titulo, valor, icone: Icone, cor }: {
  titulo: string; valor: number; icone: any; cor: string;
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
        </div>
      </CardContent>
    </Card>
  );
}

export function PainelTrocaFuncao({ etapa }: { etapa: Etapa }) {
  const meuNome = useMeuNome();
  const { can } = usePermissoes();
  const [linhas, setLinhas] = useState<SolicitacaoTroca[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fOrigem, setFOrigem] = useState("");
  const [fSetor, setFSetor] = useState("");
  const [aberta, setAberta] = useState<SolicitacaoTroca | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Campos da decisão, dentro do detalhe.
  const [motivoReprova, setMotivoReprova] = useState("");
  const [asoData, setAsoData] = useState("");
  const [observacao, setObservacao] = useState("");

  /**
   * SST e RH tratam as duas origens — não faz sentido esconder metade do
   * trabalho deles por causa de um menu de aprovação que não é o deles.
   * Na aprovação, sim: cada permissão abre uma origem.
   */
  const origens: Origem[] = useMemo(() => {
    // Analista, SST e RH tratam as duas origens. No analista isso é o próprio
    // desenho da etapa: a validação do escritório saiu do RH e veio para cá
    // junto com a de contrato (02/09/2026).
    if (etapa !== "aprovacao") return ["contrato", "escritorio"];
    return origensVisiveis(
      can("visualizar", undefined, "operacional_troca_funcao"),
      can("visualizar", undefined, "escritorio_troca_funcao"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa, can]);

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await sb.from(TABELA)
      .select("*").in("status", statusVisiveis(etapa))
      .order("criado_em", { ascending: false }).limit(500);
    if (error) toast.error("Erro ao carregar: " + error.message);
    // O recorte por origem é feito aqui, não no banco: a RLS é aberta e quem
    // gateia é o menu, então é a permissão de quem abriu que decide.
    setLinhas((data ?? []).filter((r: SolicitacaoTroca) => pertenceAFila(r, etapa, origens)));
    setCarregando(false);
  };

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [etapa, origens.join()]);

  /** Os setores que APARECEM na fila — lista curta e sempre verdadeira. */
  const setores = useMemo(
    () => [...new Set(linhas.map(r => (r.setor ?? "").trim()).filter(Boolean))].sort(),
    [linhas],
  );

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter(r => {
      if (fStatus && r.status !== fStatus) return false;
      if (fOrigem && origemDa(r) !== fOrigem) return false;
      if (fSetor && (r.setor ?? "") !== fSetor) return false;
      if (!q) return true;
      return [r.colaborador_nome, r.cargo_atual, r.cargo_novo, r.local, r.setor, r.solicitante_nome]
        .some(v => String(v ?? "").toLowerCase().includes(q));
    });
  }, [linhas, busca, fStatus, fOrigem, fSetor]);

  const pendentes = linhas.filter(r => podeAgirEm(r, etapa, origens)).length;
  const concluidas = linhas.filter(r => r.status === "Concluída").length;
  const reprovadas = linhas.filter(r => r.status === "Reprovada").length;

  const abrir = (r: SolicitacaoTroca) => {
    setAberta(r); setMotivoReprova(""); setAsoData(r.sst_aso_data ?? ""); setObservacao("");
  };

  const decidir = async (acao: "aprovar" | "reprovar" | "aso" | "dispensar_aso" | "concluir") => {
    if (!aberta) return;
    // A origem só muda o destino na mão do analista — é lá que contrato e
    // escritório se separam. Passar sempre evita ter que lembrar disso aqui.
    const destino = proximoStatus(aberta.status, acao, aberta.e_escritorio);
    if (!destino) { toast.error("Esta ação não vale no estado atual da solicitação."); return; }
    if (acao === "reprovar" && !motivoReprova.trim()) {
      toast.error("Escreva o motivo — sem ele o encarregado não sabe o que corrigir.");
      return;
    }
    if (acao === "aso" && !asoData) { toast.error("Informe a data do ASO."); return; }
    // Dispensar é decisão, não atalho: sem o porquê escrito, o RH recebe uma
    // troca sem exame e sem ninguém para perguntar.
    if (acao === "dispensar_aso" && !observacao.trim()) {
      toast.error("Escreva por que a troca não precisa de ASO.");
      return;
    }

    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = { status: destino };
    if (acao === "aprovar" || acao === "reprovar") {
      patch.aprovador_nome = meuNome;
      patch.aprovador_em = agora;
      patch.aprovador_motivo = acao === "reprovar" ? motivoReprova.trim() : (observacao.trim() || null);
    }
    if (acao === "aso" || acao === "dispensar_aso") {
      patch.sst_por = meuNome; patch.sst_em = agora;
      patch.sst_aso_dispensado = acao === "dispensar_aso";
      patch.sst_aso_data = acao === "dispensar_aso" ? null : asoData;
      patch.sst_observacao = observacao.trim() || null;
    }
    if (acao === "concluir") {
      patch.rh_por = meuNome; patch.rh_em = agora; patch.rh_observacao = observacao.trim() || null;
    }

    setSalvando(true);
    // O `.eq("status", aberta.status)` é trava de concorrência: se alguém
    // decidiu enquanto esta tela estava aberta, o update não pega nada em vez
    // de atropelar a decisão do outro.
    const { data, error } = await sb.from(TABELA).update(patch)
      .eq("id", aberta.id).eq("status", aberta.status).select("id");
    setSalvando(false);
    if (error) { toast.error("Não deu para salvar: " + error.message); return; }
    if (!data?.length) {
      toast.error("Alguém já decidiu esta solicitação enquanto você olhava. Recarregando.");
      setAberta(null); carregar(); return;
    }
    toast.success(
      acao === "reprovar" ? "Solicitação reprovada."
      : acao === "aprovar"
        ? (etapa === "analista"
            ? `Validada — segue para ${aberta.e_escritorio ? "a aprovação do administrativo" : "o Operacional"}.`
            : "Aprovada — segue para o SST.")
      : acao === "aso" ? "ASO registrado — segue para o RH."
      : acao === "dispensar_aso" ? "ASO dispensado — segue para o RH."
      : "Troca de função concluída.",
    );
    setAberta(null); carregar();
  };

  const podeAgir = !!aberta && podeAgirEm(aberta, etapa, origens);
  const rot = ROTULO[etapa];
  // O seletor de origem só faz sentido para quem enxerga mais de uma. Para a
  // Fernanda, que só vê administrativo, um filtro de uma opção só é ruído.
  const mostraOrigem = origens.length > 1;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi titulo="Aguardando você" valor={pendentes} icone={Clock} cor="bg-amber-100 text-amber-700" />
        <Kpi titulo="Concluídas" valor={concluidas} icone={CheckCircle2} cor="bg-emerald-100 text-emerald-700" />
        <Kpi titulo="Reprovadas" valor={reprovadas} icone={XCircle} cor="bg-red-100 text-red-700" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por nome, cargo, contrato, setor…"
                 value={busca} onChange={e => setBusca(e.target.value)} />
        </div>

        {mostraOrigem && (
          <Select value={fOrigem || "todas"} onValueChange={v => setFOrigem(v === "todas" ? "" : v)}>
            <SelectTrigger className="sm:w-56"><SelectValue placeholder="Contrato e escritório" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Contrato e escritório</SelectItem>
              {origens.map(o => <SelectItem key={o} value={o}>{ROTULO_ORIGEM[o]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {setores.length > 0 && (
          <Select value={fSetor || "todos"} onValueChange={v => setFSetor(v === "todos" ? "" : v)}>
            <SelectTrigger className="sm:w-52"><SelectValue placeholder="Todos os setores" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os setores</SelectItem>
              {setores.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        <Select value={fStatus || "todos"} onValueChange={v => setFStatus(v === "todos" ? "" : v)}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="Todos os status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {statusVisiveis(etapa).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {carregando ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando…
            </div>
          ) : filtradas.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">
              {linhas.length === 0 ? "Nenhuma solicitação por aqui." : "Nada bate com o filtro atual."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Troca</TableHead>
                    <TableHead>Local</TableHead>
                    <TableHead>Setor</TableHead>
                    <TableHead>Pedido por</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aberta em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map(r => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => abrir(r)}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.id}</TableCell>
                      <TableCell className="font-medium">{r.colaborador_nome}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <span className="text-muted-foreground">{r.cargo_atual || "—"}</span>
                        <ArrowRight className="mx-1.5 inline h-3 w-3" />
                        <span className="font-medium">{r.cargo_novo}</span>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="flex items-center gap-1.5">
                          {r.e_escritorio ? <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                                          : <UserCog className="h-3.5 w-3.5 text-muted-foreground" />}
                          {r.local || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.setor || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.solicitante_nome || "—"}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", corDoStatus(r.status))}>
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{fmtDataHora(r.criado_em)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- detalhe ---- */}
      <Dialog open={!!aberta} onOpenChange={o => !o && setAberta(null)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          {aberta && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">
                  Mudança de função #{aberta.id} — {aberta.colaborador_nome}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", corDoStatus(aberta.status))}>
                    {aberta.status}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                    {ROTULO_ORIGEM[origemDa(aberta)]}
                  </span>
                  <span className="text-sm text-muted-foreground">{explicaStatus(aberta.status)}</span>
                </div>

                <div className="flex items-center justify-center gap-4 rounded-xl border bg-muted/30 p-4">
                  <div className="text-center">
                    <p className="text-xs uppercase text-muted-foreground">Cargo atual</p>
                    <p className="font-semibold">{aberta.cargo_atual || "—"}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-primary" />
                  <div className="text-center">
                    <p className="text-xs uppercase text-muted-foreground">Cargo novo</p>
                    <p className="font-semibold text-primary">{aberta.cargo_novo}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Info rotulo="CPF" valor={aberta.colaborador_cpf} />
                  <Info rotulo="Admissão" valor={fmtData(aberta.colaborador_admissao)} />
                  <Info rotulo="Local / contrato" valor={aberta.local} />
                  <Info rotulo="Setor" valor={aberta.setor} />
                  <Info rotulo="Posto" valor={aberta.posto} />
                  <Info rotulo="Pedido por" valor={aberta.solicitante_nome} />
                  <Info rotulo="A partir de" valor={fmtData(aberta.data_pretendida)} />
                </div>

                {aberta.motivo && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Motivo</p>
                    <p className="whitespace-pre-wrap text-sm">{aberta.motivo}</p>
                  </div>
                )}

                {/* Trilha: quem decidiu o quê e quando. */}
                <div className="space-y-2 rounded-lg border p-3 text-sm">
                  <Trilha rotulo="Aprovação" quem={aberta.aprovador_nome} quando={aberta.aprovador_em}
                          extra={aberta.aprovador_motivo} />
                  <Trilha rotulo="SST" quem={aberta.sst_por} quando={aberta.sst_em}
                          extra={[resumoSST(aberta), aberta.sst_observacao].filter(Boolean).join(" · ")} />
                  <Trilha rotulo="Alteração na Senior (RH)" quem={aberta.rh_por} quando={aberta.rh_em}
                          extra={aberta.rh_observacao} />
                </div>

                {/* ---- ação da etapa ---- */}
                {podeAgir ? (
                  <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <p className="text-sm font-medium">{rot.ajuda}</p>

                    {etapa === "sst" && (
                      <div className="space-y-1.5">
                        <Label>Data do ASO <span className="text-xs text-muted-foreground">(obrigatória para marcar; deixe em branco para dispensar)</span></Label>
                        <Input type="date" className="sm:w-56" value={asoData}
                               onChange={e => setAsoData(e.target.value)} />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label>
                        Observação
                        <span className="text-xs text-muted-foreground">
                          {etapa === "sst" ? " (obrigatória para dispensar o ASO)" : " (opcional)"}
                        </span>
                      </Label>
                      <Textarea rows={2} value={observacao} onChange={e => setObservacao(e.target.value)}
                                placeholder={etapa === "sst" ? "Ex.: mesma função de risco, ASO vigente não vence antes da troca." : ""} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button disabled={salvando}
                              onClick={() => decidir(etapa === "sst" ? "aso" : etapa === "rh" ? "concluir" : "aprovar")}>
                        {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <rot.icone className="mr-2 h-4 w-4" />}
                        {rot.acao}
                      </Button>

                      {etapa === "sst" && (
                        <Button variant="outline" disabled={salvando} onClick={() => decidir("dispensar_aso")}>
                          Dispensar ASO e seguir
                        </Button>
                      )}

                      {etapa === "aprovacao" && (
                        <Button variant="destructive" disabled={salvando} onClick={() => decidir("reprovar")}>
                          <ThumbsDown className="mr-2 h-4 w-4" /> Reprovar
                        </Button>
                      )}
                    </div>

                    {etapa === "aprovacao" && (
                      <div className="space-y-1.5">
                        <Label>Motivo da reprovação <span className="text-xs text-muted-foreground">(obrigatório para reprovar)</span></Label>
                        <Textarea rows={2} value={motivoReprova} onChange={e => setMotivoReprova(e.target.value)}
                                  placeholder="O que precisa ser corrigido?" />
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    Esta solicitação não está na sua etapa — você está acompanhando o andamento.
                  </p>
                )}

                <ConversaSolicitacao
                  modulo="troca_funcao"
                  entidadeId={aberta.id}
                  aviso="A mensagem aparece para quem pediu e para quem trata a solicitação."
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
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

function Trilha({ rotulo, quem, quando, extra }: {
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
