import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Check, ChevronDown, Clock3, FileText, Info, Link2, Timer, UserRound, UsersRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useDetalheHoraExtra, useLiberarHoraExtra, useLiberarHoraExtraComHorarios, useValidarHoraExtra, useValidarHoraExtraComHorarios } from "@/hooks/useHoraExtra";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { cn } from "@/lib/utils";
import {
  calcularHoraExtra,
  diaSemana,
  formatarData,
  formatarDuracao,
  JORNADA_PADRAO_MIN,
  jornadaParaCalculoHoraExtra,
  mensagemErro,
  podeAlterarHorariosNaLiberacao,
  somenteHora,
} from "./horaExtraUtils";
import { BadgeStatus, ListaAnexos } from "./HoraExtraUI";
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
  const liberarComHorarios = useLiberarHoraExtraComHorarios();
  const validar = useValidarHoraExtra();
  const validarComHorarios = useValidarHoraExtraComHorarios();
  const { data: podeAlterar = false } = useScreenAccess("sistemas_hora_extra", "alterar");
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [motivoExpandido, setMotivoExpandido] = useState(false);
  const [horarios, setHorarios] = useState({ entrada: "", saida_intervalo: "", retorno_intervalo: "", saida: "" });
  // Mesma releitura do modal de detalhes: sem ela o anexo enviado logo antes
  // não aparece para quem vai aprovar.
  const { data: atual } = useDetalheHoraExtra(aberto ? solicitacao?.id : null);
  const dados = atual ?? solicitacao;
  const solicitacaoId = dados?.id;
  const conclusao = dados?.status === "aguardando_validacao";
  const pontoEntradaOriginal = somenteHora(conclusao ? dados?.ponto_entrada_real || dados?.ponto_entrada : dados?.ponto_entrada);
  const pontoSaidaIntervaloOriginal = somenteHora(conclusao ? dados?.ponto_saida_intervalo_real || dados?.ponto_saida_intervalo : dados?.ponto_saida_intervalo);
  const pontoRetornoIntervaloOriginal = somenteHora(conclusao ? dados?.ponto_retorno_intervalo_real || dados?.ponto_retorno_intervalo : dados?.ponto_retorno_intervalo);
  const pontoSaidaOriginal = somenteHora(conclusao ? dados?.ponto_saida_real || dados?.ponto_saida : dados?.ponto_saida);
  useEffect(() => {
    if (!aberto || !solicitacaoId) return;
    setHorarios({ entrada: pontoEntradaOriginal, saida_intervalo: pontoSaidaIntervaloOriginal, retorno_intervalo: pontoRetornoIntervaloOriginal, saida: pontoSaidaOriginal });
    setMotivoExpandido(false);
  }, [aberto, pontoEntradaOriginal, pontoRetornoIntervaloOriginal, pontoSaidaIntervaloOriginal, pontoSaidaOriginal, solicitacaoId]);
  if (!dados) return null;
  const podeEditarHorarios = podeAlterarHorariosNaLiberacao({ status: dados.status, podeAlterar });
  const semIntervalo = Boolean(dados.sem_intervalo);
  const jornadaCalculo = jornadaParaCalculoHoraExtra(
    dados.jornada_minutos ?? JORNADA_PADRAO_MIN,
    dados.seguir_escala ?? true,
  );
  const calculo = calcularHoraExtra(horarios, jornadaCalculo);
  const horariosAlterados = horarios.entrada !== pontoEntradaOriginal || horarios.saida_intervalo !== pontoSaidaIntervaloOriginal || horarios.retorno_intervalo !== pontoRetornoIntervaloOriginal || horarios.saida !== pontoSaidaOriginal;
  const processando = liberar.isPending || liberarComHorarios.isPending || validar.isPending || validarComHorarios.isPending;
  const decidir = async (aprovar: boolean) => {
    if (!aprovar && !motivo.trim()) {
      setRejeitando(true);
      toast.error(conclusao ? "Informe o motivo da devolução." : "Informe o motivo da rejeição.");
      return;
    }
    if (aprovar && podeEditarHorarios && horariosAlterados && calculo.excedente <= 0) {
      toast.error(`Os horários ${conclusao ? "efetivos" : "ajustados"} não geram hora extra para a jornada da escala.`);
      return;
    }
    try {
      if (conclusao && aprovar && podeEditarHorarios && horariosAlterados) await validarComHorarios.mutateAsync({ p_id: dados.id, p_horarios: horarios });
      else if (conclusao) await validar.mutateAsync({ p_id: dados.id, p_aprovar: aprovar, p_motivo: motivo || null });
      else if (aprovar && podeEditarHorarios && horariosAlterados) await liberarComHorarios.mutateAsync({ p_id: dados.id, p_horarios: horarios });
      else await liberar.mutateAsync({ p_id: dados.id, p_aprovar: aprovar, p_motivo: motivo || null });
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
  const mudarHorario = (campo: keyof typeof horarios, valor: string) =>
    setHorarios((atual) =>
      semIntervalo && campo === "entrada"
        ? { ...atual, entrada: valor, saida_intervalo: valor, retorno_intervalo: valor }
        : { ...atual, [campo]: valor },
    );
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] max-w-4xl overflow-x-hidden overflow-y-auto">
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
              {dados.numero}
              <BadgeStatus solicitacao={dados} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-5 py-1">
          <InfoItem
            icone={<UserRound />}
            rotulo="Colaborador"
            valor={dados.colaborador_nome}
            detalhe={dados.colaborador_cargo}
          />
          <InfoItem icone={<UsersRound />} rotulo="Setor" valor={dados.setor || "—"} />
          <InfoItem
            icone={<CalendarDays />}
            rotulo="Data da HE"
            valor={`${formatarData(dados.data_he)} (${diaSemana(dados.data_he)})`}
          />
          {podeEditarHorarios ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#07194b]"><Clock3 className="h-4 w-4 text-blue-700" />{conclusao ? "Horário de ponto efetivo" : "Horário de ponto do dia"}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[["Entrada", "entrada"], ["Saída (intervalo)", "saida_intervalo"], ["Retorno (intervalo)", "retorno_intervalo"], ["Saída", "saida"]].map(([rotulo, campo]) => (
                  <label key={campo} className="min-w-0 text-xs text-slate-600">{rotulo}<Input type="time" disabled={semIntervalo && ["saida_intervalo", "retorno_intervalo"].includes(campo)} value={horarios[campo as keyof typeof horarios]} onChange={(event) => mudarHorario(campo as keyof typeof horarios, event.target.value)} className="mt-1 bg-white font-semibold text-[#07194b]" /></label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-800"><span>{jornadaCalculo ? "HE calculada automaticamente" : "Todo o período é HE"}: <strong>{formatarDuracao(calculo.excedente, true)}</strong></span><span>Trabalhado no dia: {formatarDuracao(calculo.trabalhado, true)}</span>{semIntervalo && <span>Sem intervalo</span>}</div>
            </div>
          ) : (
            <InfoItem icone={<Clock3 />} rotulo={conclusao ? "Horário de ponto efetivo" : "Horário de ponto do dia"} valor={conclusao ? [dados.ponto_entrada_real || dados.ponto_entrada, dados.ponto_saida_intervalo_real || dados.ponto_saida_intervalo, dados.ponto_retorno_intervalo_real || dados.ponto_retorno_intervalo, dados.ponto_saida_real || dados.ponto_saida].map((x) => x.slice(0, 5)).join(" | ") : [dados.ponto_entrada, dados.ponto_saida_intervalo, dados.ponto_retorno_intervalo, dados.ponto_saida].map((x) => x.slice(0, 5)).join(" | ")} />
          )}
          <InfoItem
            icone={<Timer />}
            rotulo="Quantidade de HE"
            valor={formatarDuracao(podeEditarHorarios ? calculo.excedente : (dados.total_real_min ?? dados.total_previsto_min), true)}
            detalhe={
              dados.seguir_escala !== false && dados.jornada_minutos
                ? "Trabalhado " +
                  formatarDuracao(podeEditarHorarios ? calculo.trabalhado : (dados.trabalhado_real_min ?? dados.trabalhado_previsto_min ?? 0), true) +
                  " · jornada de " +
                  formatarDuracao(dados.jornada_minutos, true)
                : undefined
            }
          />
        </div>
        <Collapsible open={motivoExpandido} onOpenChange={setMotivoExpandido}>
          <CollapsibleTrigger asChild><button type="button" className="flex w-full items-center justify-between gap-3 rounded-lg border bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-[#07194b] hover:bg-slate-100"><span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-blue-700" />{conclusao ? "Resumo da conclusão" : "Motivo da solicitação"}</span><span className="flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700">{motivoExpandido ? "Ocultar" : "Exibir texto"}<ChevronDown className={cn("h-4 w-4 transition-transform", motivoExpandido && "rotate-180")} /></span></button></CollapsibleTrigger>
          <CollapsibleContent className="mt-2 rounded-lg border bg-slate-50 p-3 text-sm text-slate-700"><p className="whitespace-pre-wrap break-words">{(conclusao ? dados.resumo_conclusao : dados.justificativa) || "—"}</p></CollapsibleContent>
        </Collapsible>
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
            <table className="w-full table-fixed text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="p-3"></th>
                  <th className="p-3">ID do Chamado</th>
                  <th className="p-3">Título</th>
                  <th className="p-3">{conclusao ? "Previsto / Concluído" : "Expectativa de conclusão na HE"}</th>
                </tr>
              </thead>
              <tbody>
                {dados.chamados?.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-3 text-blue-600">
                      <Link2 className="h-4 w-4" />
                    </td>
                    <td className="p-3 font-semibold"><Link className="text-blue-700 underline underline-offset-2 hover:text-blue-900" to={`/app/sistemas/chamados/${c.chamado_id}`}>{c.chamado_numero}</Link></td>
                    <td className="break-words p-3">{c.chamado_assunto}</td>
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
        {conclusao && dados.resumo_conclusao && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <strong>Resumo da conclusão:</strong> {dados.resumo_conclusao}
          </div>
        )}
        <ListaAnexos anexos={dados.anexos} />
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
            <Button disabled={processando} className="bg-emerald-600 hover:bg-emerald-700" onClick={() => decidir(true)}>
              <Check className="mr-2 h-4 w-4" />
              {conclusao ? "Aprovar Conclusão" : "Aprovar Solicitação"}
            </Button>
            <Button disabled={processando} variant="destructive" onClick={() => (rejeitando ? decidir(false) : setRejeitando(true))}>
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
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{rotulo}</div>
        <div className="break-words font-semibold text-[#07194b]">{valor}</div>
        {detalhe && <div className="text-xs text-slate-500">{detalhe}</div>}
      </div>
    </div>
  );
}
