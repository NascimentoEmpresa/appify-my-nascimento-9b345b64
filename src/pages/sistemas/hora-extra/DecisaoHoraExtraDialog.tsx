import { useState, type ReactNode } from "react";
import { CalendarDays, Check, Clock3, FileText, Info, Link2, Timer, UserRound, UsersRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useLiberarHoraExtra, useValidarHoraExtra } from "@/hooks/useHoraExtra";
import { cn } from "@/lib/utils";
import { diaSemana, formatarData, formatarDuracao, mensagemErro } from "./horaExtraUtils";
import { BadgeStatus } from "./HoraExtraUI";
import type { SolicitacaoHoraExtra } from "./types";

export default function DecisaoHoraExtraDialog({
  aberto,
  aoFechar,
  solicitacao,
}: {
  aberto: boolean;
  aoFechar: () => void;
  solicitacao: SolicitacaoHoraExtra | null;
}) {
  const liberar = useLiberarHoraExtra();
  const validar = useValidarHoraExtra();
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState("");
  if (!solicitacao) return null;
  const conclusao = solicitacao.status === "aguardando_validacao";
  const decidir = async (aprovar: boolean) => {
    if (!aprovar && !motivo.trim()) {
      setRejeitando(true);
      toast.error(conclusao ? "Informe o motivo da devolução." : "Informe o motivo da rejeição.");
      return;
    }
    try {
      if (conclusao) await validar.mutateAsync({ p_id: solicitacao.id, p_aprovar: aprovar, p_motivo: motivo || null });
      else await liberar.mutateAsync({ p_id: solicitacao.id, p_aprovar: aprovar, p_motivo: motivo || null });
      toast.success(
        aprovar
          ? conclusao
            ? "Conclusão aprovada."
            : "Solicitação aprovada."
          : conclusao
            ? "Conclusão devolvida para ajuste."
            : "Solicitação rejeitada.",
      );
      setMotivo("");
      setRejeitando(false);
      aoFechar();
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível registrar a decisão."));
    }
  };
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[94vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl text-[#07194b]">Detalhes da Solicitação de HE</DialogTitle>
          <DialogDescription>Confira as informações da solicitação e tome uma decisão.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4 rounded-lg border bg-slate-50 p-4">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-blue-100 text-blue-600">
            <FileText />
          </span>
          <div>
            <div className="text-xs text-slate-500">ID da Solicitação</div>
            <div className="flex items-center gap-3 text-lg font-bold text-[#07194b]">
              {solicitacao.numero}
              <BadgeStatus solicitacao={solicitacao} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-5 py-1">
          <InfoItem
            icone={<UserRound />}
            rotulo="Colaborador"
            valor={solicitacao.colaborador_nome}
            detalhe={solicitacao.colaborador_cargo}
          />
          <InfoItem icone={<UsersRound />} rotulo="Setor" valor={solicitacao.setor || "—"} />
          <InfoItem
            icone={<CalendarDays />}
            rotulo="Data da HE"
            valor={`${formatarData(solicitacao.data_he)} (${diaSemana(solicitacao.data_he)})`}
          />
          <InfoItem
            icone={<Clock3 />}
            rotulo="Horário de ponto do dia"
            valor={[
              solicitacao.ponto_entrada,
              solicitacao.ponto_saida_intervalo,
              solicitacao.ponto_retorno_intervalo,
              solicitacao.ponto_saida,
            ]
              .map((x) => x.slice(0, 5))
              .join(" | ")}
          />
          <InfoItem
            icone={<Timer />}
            rotulo="Quantidade de HE"
            valor={formatarDuracao(solicitacao.total_real_min ?? solicitacao.total_previsto_min, true)}
            detalhe={
              solicitacao.jornada_minutos
                ? "Trabalhado " +
                  formatarDuracao(solicitacao.trabalhado_real_min ?? solicitacao.trabalhado_previsto_min ?? 0, true) +
                  " · jornada de " +
                  formatarDuracao(solicitacao.jornada_minutos, true)
                : undefined
            }
          />
          <InfoItem
            icone={<FileText />}
            rotulo={conclusao ? "Resumo" : "Motivo"}
            valor={(conclusao ? solicitacao.resumo_conclusao : solicitacao.justificativa) || "—"}
          />
        </div>
        <hr />
        <div>
          <h3 className="flex items-center gap-2 font-bold text-[#07194b]">
            <UsersRound className="h-5 w-5" />
            Chamados que serão resolvidos
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Lista de chamados vinculados a esta solicitação, com a expectativa de conclusão de cada um.
          </p>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="p-3"></th>
                  <th className="p-3">ID do Chamado</th>
                  <th className="p-3">Título</th>
                  <th className="p-3">{conclusao ? "Previsto / Concluído" : "Expectativa de conclusão na HE"}</th>
                </tr>
              </thead>
              <tbody>
                {solicitacao.chamados?.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-3 text-blue-600">
                      <Link2 className="h-4 w-4" />
                    </td>
                    <td className="p-3 font-semibold">{c.chamado_numero}</td>
                    <td className="p-3">{c.chamado_assunto}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <Progress
                          value={Number(conclusao ? c.percentual_concluido : c.percentual_previsto) || 0}
                          className="h-2"
                        />
                        <strong>
                          {conclusao
                            ? `${c.percentual_previsto ?? "—"}% / ${c.percentual_concluido ?? 0}%`
                            : `${c.percentual_previsto}%`}
                        </strong>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {conclusao && solicitacao.resumo_conclusao && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <strong>Resumo da conclusão:</strong> {solicitacao.resumo_conclusao}
          </div>
        )}
        <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
          <Info className="h-4 w-4 shrink-0" />
          <span>
            {conclusao
              ? "Compare os percentuais previstos aos resultados informados antes de validar."
              : "As porcentagens representam a expectativa de conclusão de cada chamado " +
                "durante o período da hora extra solicitada."}
          </span>
        </div>
        {rejeitando && (
          <div>
            <label className="text-sm font-semibold">
              {conclusao ? "Motivo da devolução" : "Motivo da rejeição"} *
            </label>
            <Textarea autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1" />
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <div className="flex gap-2">
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => decidir(true)}>
              <Check className="mr-2 h-4 w-4" />
              {conclusao ? "Aprovar Conclusão" : "Aprovar Solicitação"}
            </Button>
            <Button variant="destructive" onClick={() => (rejeitando ? decidir(false) : setRejeitando(true))}>
              <X className="mr-2 h-4 w-4" />
              {conclusao ? "Devolver para Ajuste" : "Rejeitar Solicitação"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function InfoItem({
  icone,
  rotulo,
  valor,
  detalhe,
}: {
  icone: ReactNode;
  rotulo: string;
  valor: string;
  detalhe?: string | null;
}) {
  return (
    <div className="flex gap-3">
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50",
          "text-blue-700 [&_svg]:h-4 [&_svg]:w-4",
        )}
      >
        {icone}
      </span>
      <div>
        <div className="text-xs text-slate-500">{rotulo}</div>
        <div className="font-semibold text-[#07194b]">{valor}</div>
        {detalhe && <div className="text-xs text-slate-500">{detalhe}</div>}
      </div>
    </div>
  );
}
