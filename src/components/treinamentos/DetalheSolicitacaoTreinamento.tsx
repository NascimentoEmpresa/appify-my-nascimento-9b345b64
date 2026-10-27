import { useState } from "react";
import { Ban, CalendarCheck, CalendarClock, CalendarX, CheckCircle2, Copy, History, Loader2, Pencil, ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import { useDecidirTreinamento, useEventosTreinamento, useResponderDataTreinamento, type AcaoTreinamento } from "@/hooks/useSolicitacoesTreinamento";
import {
  ROTULO_EVENTO, STATUS_SOL_TREINAMENTO, acoesEncarregado, acoesPermitidas, datasPrevistas, fmtDataIso, rotuloStatus, secoesFicha, textoOficio,
  type SolicitacaoTreinamento,
} from "@/lib/treinamentos/solicitacaoTreinamento";

// =====================================================================
// A ficha de uma Solicitação de Treinamento (mig 20261026000910) — a mesma
// janela nos dois lados:
//   encarregado: lê o que pediu, acompanha a decisão, conversa, cancela
//                (pendente) ou corrige e reenvia (devolvida para ajuste);
//   Treinamentos: aprova (com ou sem data), devolve para ajuste, reprova,
//                agenda, marca como realizado, cancela; e "Copiar
//                informações para o ofício" (a ficha em texto).
// A conversa é o ConversaSolicitacao (SISTEMA_COMENTARIOS, modulo
// 'treinamento') — o mesmo fio dos dois lados.
//
// 27/10/2026 (Pablo, mig 20261027000120): Treinamentos ACEITA ou reprova
// (presencial e online) e INFORMA a data — escolhendo uma das datas que o
// encarregado sugeriu ou outra. Informar nunca agenda direto: a data fica
// "aguardando aprovação" e o encarregado aprova (→ Agendada) ou pede outra
// com motivo (→ volta para Treinamentos). Remarcar passa pelo mesmo caminho.
// =====================================================================

const fmtDataHora = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

const ACAO: Record<AcaoTreinamento, { rotulo: string; icone: typeof ThumbsUp; cor?: string; motivo?: "obrigatorio" | "opcional"; agenda?: "obrigatoria" | "opcional" }> = {
  aprovar:       { rotulo: "Aceitar", icone: ThumbsUp, agenda: "opcional", motivo: "opcional" },
  informar_data: { rotulo: "Informar / remarcar data", icone: CalendarCheck, agenda: "obrigatoria", motivo: "opcional" },
  concluir:      { rotulo: "Marcar como realizado", icone: CheckCircle2, motivo: "opcional" },
  devolver:      { rotulo: "Devolver para ajuste", icone: Undo2, motivo: "obrigatorio" },
  reprovar:      { rotulo: "Reprovar", icone: ThumbsDown, cor: "text-red-600", motivo: "obrigatorio" },
  cancelar:      { rotulo: "Cancelar", icone: Ban, cor: "text-red-600", motivo: "obrigatorio" },
};

export function DetalheSolicitacaoTreinamento({ solicitacao: s, lado, podeDecidir, onFechar, onCorrigir }: {
  solicitacao: SolicitacaoTreinamento | null;
  lado: "encarregado" | "treinamentos";
  podeDecidir?: boolean;
  onFechar: () => void;
  onCorrigir?: (s: SolicitacaoTreinamento) => void;
}) {
  const eventos = useEventosTreinamento(s?.id ?? null);
  const decidir = useDecidirTreinamento();
  const responder = useResponderDataTreinamento();
  const [acao, setAcao] = useState<AcaoTreinamento | null>(null);
  const [form, setForm] = useState({ motivo: "", data_confirmada: "", horario_confirmado: "", instrutor: "", obs: "" });
  const [pedindoOutra, setPedindoOutra] = useState(false);
  const [motivoData, setMotivoData] = useState("");

  if (!s) return null;
  const encarregado = lado === "encarregado";
  const devolvida = s.status === "pendente" && !!s.devolucao_motivo;
  const doEncarregado = encarregado ? acoesEncarregado(s) : [];
  const acoes: AcaoTreinamento[] = encarregado ? (doEncarregado.includes("cancelar") ? ["cancelar"] : []) : podeDecidir ? acoesPermitidas(s) : [];
  const cfg = acao ? ACAO[acao] : null;
  const sugeridas = datasPrevistas(s);
  const dataInformada = s.status === "data_informada";
  const dataAprovada = s.status === "agendada" || (s.status === "concluida" && !!s.data_aprovada_em);

  const abrirAcao = (a: AcaoTreinamento) => {
    setAcao(a);
    setForm({ motivo: "", data_confirmada: s.data_confirmada ?? (sugeridas.length === 1 ? sugeridas[0] : ""),
      horario_confirmado: s.horario_confirmado ?? "", instrutor: s.instrutor ?? "", obs: "" });
  };
  const confirmar = async () => {
    if (!acao || !cfg) return;
    if (cfg.motivo === "obrigatorio" && !form.motivo.trim()) { toast.error("Informe o motivo."); return; }
    if (cfg.agenda === "obrigatoria" && !form.data_confirmada) { toast.error("Informe a data do treinamento."); return; }
    try {
      await decidir.mutateAsync({
        id: s.id, acao, motivo: form.motivo.trim() || undefined,
        ...(cfg.agenda ? { data_confirmada: form.data_confirmada || undefined, horario_confirmado: form.horario_confirmado.trim() || undefined, instrutor: form.instrutor.trim() || undefined } : {}),
        obs: form.obs.trim() || undefined,
      });
      toast.success(cfg.agenda && form.data_confirmada ? "Data informada — aguardando a aprovação do encarregado." : `${cfg.rotulo}: feito.`);
      setAcao(null);
    } catch (e) { toast.error((e as Error).message); }
  };
  const responderData = async (aprovar: boolean) => {
    if (!aprovar && !motivoData.trim()) { toast.error("Diga por que precisa de outra data."); return; }
    try {
      await responder.mutateAsync({ id: s.id, aprovar, motivo: aprovar ? undefined : motivoData.trim() });
      toast.success(aprovar ? "Data aprovada — treinamento agendado." : "Pedido de outra data enviado a Treinamentos.");
      setPedindoOutra(false); setMotivoData("");
    } catch (e) { toast.error((e as Error).message); }
  };
  const copiarOficio = async () => {
    try { await navigator.clipboard.writeText(textoOficio(s)); toast.success("Informações copiadas para o ofício."); }
    catch { toast.error("Não consegui copiar — selecione o texto da ficha manualmente."); }
  };

  return (
    <Dialog open={!!s} onOpenChange={(v) => { if (!v) { setAcao(null); setPedindoOutra(false); onFechar(); } }}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="text-muted-foreground">{s.protocolo}</span> {s.treinamento}
            <Badge variant="outline" className={cn("font-semibold", devolvida ? "border-orange-300 bg-orange-100 text-orange-800" : STATUS_SOL_TREINAMENTO[s.status].cor)}>{rotuloStatus(s)}</Badge>
            {s.urgencia === "prioritario" && <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">Prioritário</Badge>}
          </DialogTitle>
          <DialogDescription>
            {s.contrato_nome} · pedido por {s.solicitante_nome ?? "—"} em {fmtDataHora(s.created_at)}
            {s.confirmado_em ? ` · informações confirmadas em ${fmtDataHora(s.confirmado_em)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* O encarregado aprova a data (ou pede outra) */}
        {encarregado && dataInformada && doEncarregado.includes("aprovar_data") && (
          <div className="space-y-2 rounded-lg border border-violet-300 bg-violet-50 p-3 text-sm text-violet-950">
            <p className="flex items-center gap-1.5 font-semibold"><CalendarClock className="h-4 w-4" />
              Treinamentos informou a data: {fmtDataIso(s.data_confirmada)}{s.horario_confirmado ? ` · ${s.horario_confirmado}` : ""}</p>
            <p>Confirme se a data serve para a equipe. Se não servir, peça outra dizendo o motivo.</p>
            {pedindoOutra ? (
              <div className="space-y-2">
                <Textarea rows={2} value={motivoData} placeholder="Por que precisa de outra data? (obrigatório)" onChange={(e) => setMotivoData(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setPedindoOutra(false); setMotivoData(""); }}>Voltar</Button>
                  <Button size="sm" variant="destructive" onClick={() => responderData(false)} disabled={responder.isPending}>
                    {responder.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Pedir outra data
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => responderData(true)} disabled={responder.isPending}>
                  {responder.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarCheck className="mr-1.5 h-4 w-4" />} Aprovar data
                </Button>
                <Button size="sm" variant="outline" className="text-red-600" onClick={() => setPedindoOutra(true)}><CalendarX className="mr-1.5 h-4 w-4" /> Pedir outra data</Button>
              </div>
            )}
          </div>
        )}

        {/* Decisão de Treinamentos */}
        {(s.data_confirmada || s.instrutor || s.obs_treinamentos || s.motivo_reprovacao || s.devolucao_motivo || s.cancelamento_motivo || s.data_recusa_motivo) && (
          <div className={cn("rounded-lg border p-3 text-sm",
            s.status === "reprovada" || s.status === "cancelada" ? "border-red-200 bg-red-50" : devolvida ? "border-orange-200 bg-orange-50" : "border-emerald-200 bg-emerald-50")}>
            {s.data_confirmada && (
              <div><b>{dataAprovada ? "Data aprovada" : dataInformada ? "Data informada (aguardando o encarregado)" : "Última data informada"}:</b> {fmtDataIso(s.data_confirmada)}
                {s.horario_confirmado ? ` · ${s.horario_confirmado}` : ""}{dataAprovada && s.data_aprovada_em ? ` — aprovada em ${fmtDataHora(s.data_aprovada_em)}` : ""}</div>
            )}
            {s.status === "aprovada" && s.data_recusa_motivo && <div><b>Encarregado pediu outra data:</b> {s.data_recusa_motivo}</div>}
            {s.instrutor && <div><b>Instrutor:</b> {s.instrutor}</div>}
            {s.obs_treinamentos && <div><b>Observação de Treinamentos:</b> {s.obs_treinamentos}</div>}
            {devolvida && <div><b>Ajuste pedido por Treinamentos:</b> {s.devolucao_motivo}</div>}
            {s.motivo_reprovacao && <div><b>Motivo da reprovação:</b> {s.motivo_reprovacao}</div>}
            {s.cancelamento_motivo && <div><b>Cancelada por {s.cancelada_por ?? "—"}:</b> {s.cancelamento_motivo}</div>}
            {s.decidido_por && <div className="mt-1 text-xs text-muted-foreground">Decidido por {s.decidido_por} em {fmtDataHora(s.decidido_em)}</div>}
          </div>
        )}

        {/* Ações */}
        <div className="flex flex-wrap gap-2">
          {!encarregado && (
            <Button variant="outline" size="sm" onClick={copiarOficio}><Copy className="mr-1.5 h-4 w-4" /> Copiar informações para o ofício</Button>
          )}
          {encarregado && devolvida && onCorrigir && (
            <Button size="sm" onClick={() => onCorrigir(s)}><Pencil className="mr-1.5 h-4 w-4" /> Corrigir e reenviar</Button>
          )}
          {!acao && acoes.map((a) => {
            const c = ACAO[a]; const I = c.icone;
            const principal = a === "aprovar" || (a === "informar_data" && s.status === "aprovada");
            return <Button key={a} size="sm" variant={principal ? "default" : "outline"} className={cn(!principal && c.cor)} onClick={() => abrirAcao(a)}><I className="mr-1.5 h-4 w-4" /> {c.rotulo}</Button>;
          })}
        </div>
        {acao && cfg && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-semibold">{cfg.rotulo}</p>
            {cfg.agenda && (
              <>
                {sugeridas.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Datas sugeridas pelo encarregado:</span>
                    {sugeridas.map((d) => (
                      <button key={d} type="button" onClick={() => setForm({ ...form, data_confirmada: d })}
                        className={cn("rounded-full border px-2.5 py-0.5", form.data_confirmada === d ? "border-slate-900 bg-slate-900 text-white" : "hover:border-slate-400")}>
                        {fmtDataIso(d)}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div><label className="text-xs font-medium">Data do treinamento{cfg.agenda === "obrigatoria" ? " *" : ""}</label>
                    <Input type="date" value={form.data_confirmada} onChange={(e) => setForm({ ...form, data_confirmada: e.target.value })} /></div>
                  <div><label className="text-xs font-medium">Horário</label>
                    <Input value={form.horario_confirmado} placeholder="08:00 às 12:00" onChange={(e) => setForm({ ...form, horario_confirmado: e.target.value })} /></div>
                  <div><label className="text-xs font-medium">Instrutor</label>
                    <Input value={form.instrutor} onChange={(e) => setForm({ ...form, instrutor: e.target.value })} /></div>
                </div>
              </>
            )}
            {acao === "aprovar" && <p className="text-xs text-muted-foreground">Com a data já informada, ela vai para o encarregado <b>aprovar</b>; sem data, fica <b>Aceita</b> e você informa depois.</p>}
            {acao === "informar_data" && <p className="text-xs text-muted-foreground">A data vai para o encarregado <b>aprovar</b> — só depois disso o treinamento fica Agendado.</p>}
            <Textarea rows={2} value={cfg.motivo === "obrigatorio" ? form.motivo : form.obs}
              placeholder={cfg.motivo === "obrigatorio" ? (acao === "devolver" ? "O que o encarregado precisa ajustar (obrigatório)" : "Motivo (obrigatório)") : "Observação para o encarregado (opcional)"}
              onChange={(e) => setForm(cfg.motivo === "obrigatorio" ? { ...form, motivo: e.target.value } : { ...form, obs: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setAcao(null)}>Voltar</Button>
              <Button size="sm" variant={cfg.cor ? "destructive" : "default"} onClick={confirmar} disabled={decidir.isPending}>
                {decidir.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Confirmar
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* Ficha */}
          <div className="space-y-3">
            {secoesFicha(s).map((sec) => (
              <div key={sec.titulo} className="rounded-lg border p-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{sec.titulo}</p>
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(150px,auto)_1fr]">
                  {sec.itens.map(([r, v]) => [
                    <dt key={r + "r"} className="text-muted-foreground">{r}</dt>,
                    <dd key={r + "v"} className={cn("whitespace-pre-wrap", (v === "Não" || v === "Não informado") && sec.titulo === "Checklist do local" && "text-amber-700")}>{v}</dd>,
                  ])}
                </dl>
              </div>
            ))}
            <div className="rounded-lg border p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><History className="h-3.5 w-3.5" /> Histórico</p>
              {eventos.isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p> : (
                <ol className="space-y-1 text-sm">
                  {(eventos.data ?? []).map((e) => (
                    <li key={e.id} className="flex flex-wrap gap-x-2">
                      <span className="text-xs text-muted-foreground">{fmtDataHora(e.created_at)}</span>
                      <b>{ROTULO_EVENTO[e.acao] ?? e.acao}</b>
                      <span className="text-muted-foreground">· {e.autor_nome ?? "—"}</span>
                      {e.texto && <span className="w-full whitespace-pre-wrap text-xs">{e.texto}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
          {/* Conversa */}
          <div className="flex h-[480px] flex-col rounded-lg border">
            <div className="min-h-0 flex-1 p-2">
              <ConversaSolicitacao modulo="treinamento" entidadeId={s.id} preencher
                aviso={encarregado ? "A mensagem chega ao setor de Treinamentos." : "A mensagem chega ao encarregado que pediu."} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
