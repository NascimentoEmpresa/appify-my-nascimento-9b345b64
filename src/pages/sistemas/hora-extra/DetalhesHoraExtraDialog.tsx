import { useState } from "react";
import { Clock3, FileText, Link2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { urlAssinadaHoraExtra } from "@/hooks/useHoraExtra";
import { cn } from "@/lib/utils";
import { formatarData, formatarDuracao, mensagemErro, somenteHora } from "./horaExtraUtils";
import { BadgeExecucao, BadgeStatus } from "./HoraExtraUI";
import type { SolicitacaoHoraExtra } from "./types";

export default function DetalhesHoraExtraDialog({
  aberto,
  aoFechar,
  solicitacao,
}: {
  aberto: boolean;
  aoFechar: () => void;
  solicitacao: SolicitacaoHoraExtra | null;
}) {
  const [abrindo, setAbrindo] = useState<string | null>(null);
  if (!solicitacao) return null;
  const abrir = async (id: string, caminho: string) => {
    try {
      setAbrindo(id);
      window.open(await urlAssinadaHoraExtra(caminho), "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível abrir o anexo."));
    } finally {
      setAbrindo(null);
    }
  };
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="text-xl text-[#07194b]">Detalhes da Solicitação de HE</DialogTitle>
            <BadgeStatus solicitacao={solicitacao} />
          </div>
          <DialogDescription>Informações registradas na solicitação e na conclusão.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <Info rotulo="ID" valor={`#${solicitacao.numero}`} />
          <Info rotulo="Colaborador" valor={solicitacao.colaborador_nome} />
          <Info rotulo="Data da HE" valor={formatarData(solicitacao.data_he)} />
          <Info rotulo="Tipo" valor={solicitacao.tipo === "normal" ? "Normal" : "Emergencial"} />
          <Info rotulo="Escala de trabalho" valor={solicitacao.escala_nome || "—"} />
          <Info
            rotulo="Jornada / trabalhado no dia"
            valor={
              `${formatarDuracao(solicitacao.jornada_minutos ?? 0, true)} / ` +
              formatarDuracao(solicitacao.trabalhado_real_min ?? solicitacao.trabalhado_previsto_min ?? 0, true)
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-blue-50 p-4 text-blue-700">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FileText className="h-4 w-4" />
              Total previsto
            </div>
            <div className="mt-2 text-xl font-extrabold">{formatarDuracao(solicitacao.total_previsto_min)}</div>
          </div>
          <div className="rounded-lg bg-emerald-50 p-4 text-emerald-700">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FileText className="h-4 w-4" />
              Total real
            </div>
            <div className="mt-2 text-xl font-extrabold">
              {solicitacao.total_real_min == null ? "—" : formatarDuracao(solicitacao.total_real_min)}
            </div>
          </div>
        </div>
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-bold text-[#07194b]">
            <Clock3 className="h-4 w-4" />
            Horário de ponto
          </h3>
          <div className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs">
            {[
              ["Entrada", solicitacao.ponto_entrada_real || solicitacao.ponto_entrada],
              ["Saída", solicitacao.ponto_saida_intervalo_real || solicitacao.ponto_saida_intervalo],
              ["Retorno", solicitacao.ponto_retorno_intervalo_real || solicitacao.ponto_retorno_intervalo],
              ["Saída", solicitacao.ponto_saida_real || solicitacao.ponto_saida],
              ["Início da HE", solicitacao.he_inicio_real || solicitacao.he_inicio_previsto],
              ["Término da HE", solicitacao.he_fim_real || solicitacao.he_fim_previsto],
            ].map(([r, v]) => (
              <div key={`${r}-${v}`}>
                <div className="text-slate-500">{r}</div>
                <div className="mt-1 rounded border bg-white px-2 py-2 font-semibold">{somenteHora(v)}</div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-bold text-[#07194b]">
            <Link2 className="h-4 w-4" />
            Chamados
          </h3>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="p-2">ID</th>
                  <th className="p-2">Previsto</th>
                  <th className="p-2">Concluído</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {solicitacao.chamados?.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2 font-semibold text-blue-700">
                      #{c.chamado_numero}
                      {c.adicional && <span className="ml-1 text-[10px] text-slate-400">adicional</span>}
                    </td>
                    <td className="p-2">{c.percentual_previsto == null ? "—" : `${c.percentual_previsto}%`}</td>
                    <td className="p-2">{c.percentual_concluido == null ? "—" : `${c.percentual_concluido}%`}</td>
                    <td className="p-2">
                      <BadgeExecucao status={c.status_execucao} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h3 className="mb-2 font-bold text-[#07194b]">Observações</h3>
          <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-600">
            {solicitacao.resumo_conclusao || solicitacao.justificativa || "Nenhuma observação informada."}
          </div>
        </section>
        {!!solicitacao.anexos?.length && (
          <section>
            <h3 className="mb-2 flex items-center gap-2 font-bold text-[#07194b]">
              <Paperclip className="h-4 w-4" />
              Anexos
            </h3>
            <div className="space-y-2">
              {solicitacao.anexos.map((a) => (
                <button
                  key={a.id}
                  disabled={abrindo === a.id}
                  onClick={() => abrir(a.id, a.storage_path)}
                  className={cn(
                    "flex w-full items-center justify-between rounded border px-3 py-2",
                    "text-left text-sm text-blue-700 hover:bg-blue-50",
                  )}
                >
                  <span>{a.nome_arquivo}</span>
                  <span className="text-xs text-slate-400">{a.fase}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <div className="text-right">
          <Button variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{rotulo}</div>
      <div className="font-semibold text-[#07194b]">{valor}</div>
    </div>
  );
}
