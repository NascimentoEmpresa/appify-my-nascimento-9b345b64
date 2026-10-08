import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, FileText, HardHat, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDecidirEnvio, useDetalheEnvio, useEnviosPonto, urlAnexoEnvio, type EnvioPonto } from "@/hooks/usePontoEncarregados";
import { fmtDataHora } from "@/lib/conferenciaPonto/conferencia";
import { STATUS_ENVIO, corSituacao, resumoItens, rotuloSituacao } from "@/lib/conferenciaPonto/envioEncarregado";

/**
 * O que os encarregados enviaram para ESTE contrato e mês (mig
 * 20261007000023) — aparece no detalhe do contrato da Conferência de Ponto.
 * Receber/devolver exige o menu fantasma `ponto_receber_encarregados`
 * (`podeReceber`); quem só confere vê, mas não decide.
 *
 * Desde a mig 20261008000005 o envio é o OK do encarregado na linha do
 * contrato, e devolver tira esse OK — `onDecidiu` recarrega a linha.
 */
export function EnviosEncarregados({ empresa, filial, mes, podeReceber, onDecidiu }: {
  empresa: number; filial: number; mes: string; podeReceber: boolean; onDecidiu?: () => void;
}) {
  const q = useEnviosPonto({ mes, empresa, filial });
  const envios = (q.data ?? []).filter((e) => e.status !== "rascunho");
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><HardHat className="h-4 w-4" /> Ponto enviado pelos encarregados</h3>
      {q.isLoading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p>
        : q.error ? <p className="text-xs text-muted-foreground">Envios dos encarregados indisponíveis ({(q.error as Error).message}).</p>
        : !envios.length ? <p className="text-xs text-muted-foreground">Nenhum encarregado enviou o ponto deste contrato no mês ainda.</p>
        : envios.map((e) => <CartaoEnvio key={e.id} envio={e} podeReceber={podeReceber} onDecidiu={onDecidiu} />)}
    </div>
  );
}

function CartaoEnvio({ envio, podeReceber, onDecidiu }: { envio: EnvioPonto; podeReceber: boolean; onDecidiu?: () => void }) {
  const [aberto, setAberto] = useState(envio.status === "enviado");
  const [motivo, setMotivo] = useState("");
  const det = useDetalheEnvio(aberto ? envio.id : null);
  const decidir = useDecidirEnvio();
  const st = STATUS_ENVIO[envio.status];
  const r = det.data ? resumoItens(det.data.itens) : null;

  const agir = (acao: "receber" | "devolver") => {
    if (acao === "devolver" && motivo.trim().length < 10) { toast.error("Escreva o motivo da devolução (mín. 10 caracteres)."); return; }
    decidir.mutate({ id: envio.id, acao, motivo: motivo.trim() || undefined }, {
      onSuccess: () => { toast.success(acao === "receber" ? "Envio recebido." : "Devolvido ao encarregado — o OK dele saiu do contrato."); onDecidiu?.(); },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <div className="rounded-md border border-border">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs" onClick={() => setAberto((a) => !a)}>
        <Badge variant="outline" className={cn("text-[10px]", st.cor)}>{st.rotulo}</Badge>
        <span className="font-semibold">{envio.encarregado_nome ?? "Encarregado"}</span>
        <span className="text-muted-foreground">{envio.posto ? `posto ${envio.posto}` : "contrato inteiro"} · enviado {fmtDataHora(envio.enviado_em)}</span>
        {aberto ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
      </button>
      {aberto && (
        <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
          {det.isLoading || !det.data ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p> : (
            <>
              {r && (
                <p className="text-muted-foreground">
                  <b className="text-foreground">{r.total}</b> colaboradores · {r.por.ok} OK · <span className="text-red-700">{r.por.faltas} com faltas ({r.faltas})</span> ·
                  {" "}{r.por.atestado} atestado · {r.por.afastado} afastado · {r.por.ferias} férias · <span className="text-orange-700">{r.por.divergencia} divergência(s)</span> · {r.atrasos} atraso(s)
                </p>
              )}
              {envio.observacao && <p className="rounded bg-muted/50 p-2 italic">{envio.observacao}</p>}
              <div className="flex flex-wrap gap-1.5">
                {det.data.anexos.map((a) => (
                  <Button key={a.id} size="sm" variant="outline" className="h-7 gap-1 text-[11px]"
                    onClick={async () => { const u = await urlAnexoEnvio(a.storage_path); if (u) window.open(u, "_blank"); else toast.error("Não foi possível abrir o arquivo."); }}>
                    <FileText className="h-3 w-3" /> {a.nome_arquivo ?? "arquivo"}
                  </Button>
                ))}
              </div>
              {det.data.itens.some((i) => i.situacao !== "ok") && (
                <div className="max-h-56 overflow-auto rounded border border-border">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-card"><tr className="text-left text-[10px] uppercase text-muted-foreground"><th className="px-2 py-1">Colaborador</th><th className="px-2 py-1">Situação</th><th className="px-2 py-1">Faltas</th><th className="px-2 py-1">Atrasos</th><th className="px-2 py-1">HE</th><th className="px-2 py-1">Obs.</th></tr></thead>
                    <tbody>
                      {det.data.itens.filter((i) => i.situacao !== "ok" || i.atrasos || i.horas_extras).map((i) => (
                        <tr key={`${i.empregado_id}-${i.nome}`} className="border-t border-border/60">
                          <td className="px-2 py-1">{i.nome}</td>
                          <td className="px-2 py-1"><Badge variant="outline" className={cn("text-[9px]", corSituacao(i.situacao))}>{rotuloSituacao(i.situacao)}</Badge></td>
                          <td className="px-2 py-1">{i.faltas || "—"}</td><td className="px-2 py-1">{i.atrasos || "—"}</td>
                          <td className="px-2 py-1">{i.horas_extras || "—"}</td><td className="px-2 py-1">{i.observacao || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {envio.status === "enviado" && podeReceber && (
                <div className="space-y-2 border-t border-border pt-2">
                  <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Motivo, se for devolver ao encarregado (ex.: falta a folha do posto X)" className="text-xs" />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={decidir.isPending} onClick={() => agir("devolver")}><Undo2 className="h-3.5 w-3.5" /> Devolver ao encarregado</Button>
                    <Button size="sm" className="h-8 gap-1 text-xs" disabled={decidir.isPending} onClick={() => agir("receber")}><CheckCircle2 className="h-3.5 w-3.5" /> Receber</Button>
                  </div>
                </div>
              )}
              {envio.status === "recebido" && <p className="text-emerald-700">Recebido por {envio.recebido_por} em {fmtDataHora(envio.recebido_em)}.</p>}
              {envio.status === "devolvido" && <p className="text-destructive">Devolvido por {envio.devolvido_por}: {envio.devolucao_motivo}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
