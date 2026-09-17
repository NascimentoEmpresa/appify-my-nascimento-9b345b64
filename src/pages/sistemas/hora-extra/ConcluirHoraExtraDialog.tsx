import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileCheck2, FileText, Info, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useConcluirHoraExtra, useEnviarAnexosHoraExtra } from "@/hooks/useHoraExtra";
import {
  calcularHoraExtra,
  diaSemana,
  formatarData,
  formatarDuracao,
  formatarQuantidadeChamados,
  JORNADA_PADRAO_MIN,
  limitarPercentual,
  mediaConclusao,
  mensagemErro,
  statusExecucaoPorPercentual,
  validarConclusao,
} from "./horaExtraUtils";
import { Campo, DropzoneAnexos, SecaoForm, TotalHoras } from "./HoraExtraUI";
import SeletorChamadoDialog from "./SeletorChamadoDialog";
import type { ChamadoDisponivel, ChamadoHoraExtra, SolicitacaoHoraExtra, StatusExecucao } from "./types";
import { STATUS_EXECUCAO } from "./types";

interface LinhaConclusao {
  id: string;
  chamado_id: string;
  numero: string;
  assunto: string;
  setor?: string | null;
  previsto: number | null;
  concluido: number;
  status: StatusExecucao;
  observacao: string;
  adicional: boolean;
}

export default function ConcluirHoraExtraDialog({
  aberto,
  aoFechar,
  solicitacao,
}: {
  aberto: boolean;
  aoFechar: () => void;
  solicitacao: SolicitacaoHoraExtra | null;
}) {
  const concluir = useConcluirHoraExtra();
  const [linhas, setLinhas] = useState<LinhaConclusao[]>([]);
  const [adicionais, setAdicionais] = useState<LinhaConclusao[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const enviarAnexos = useEnviarAnexosHoraExtra();
  const [seletor, setSeletor] = useState(false);
  const [resumo, setResumo] = useState("");
  const [horarios, setHorarios] = useState({
    ponto_entrada_real: "07:30",
    ponto_saida_intervalo_real: "12:00",
    ponto_retorno_intervalo_real: "13:00",
    ponto_saida_real: "17:18",
  });
  useEffect(() => {
    if (!aberto || !solicitacao) return;
    setHorarios({
      ponto_entrada_real: (solicitacao.ponto_entrada_real || solicitacao.ponto_entrada).slice(0, 5),
      ponto_saida_intervalo_real: (solicitacao.ponto_saida_intervalo_real || solicitacao.ponto_saida_intervalo).slice(
        0,
        5,
      ),
      ponto_retorno_intervalo_real: (
        solicitacao.ponto_retorno_intervalo_real || solicitacao.ponto_retorno_intervalo
      ).slice(0, 5),
      ponto_saida_real: (solicitacao.ponto_saida_real || solicitacao.ponto_saida).slice(0, 5),
    });
    setResumo(solicitacao.resumo_conclusao || "");
    const converter = (c: ChamadoHoraExtra): LinhaConclusao => ({
      id: c.id,
      chamado_id: c.chamado_id,
      numero: c.chamado_numero,
      assunto: c.chamado_assunto,
      setor: c.chamado_setor,
      previsto: c.percentual_previsto,
      concluido: Number(c.percentual_concluido || 0),
      status: c.status_execucao || statusExecucaoPorPercentual(Number(c.percentual_concluido || 0)),
      observacao: c.observacao || "",
      adicional: c.adicional,
    });
    setLinhas((solicitacao.chamados || []).filter((c) => !c.adicional).map(converter));
    setAdicionais((solicitacao.chamados || []).filter((c) => c.adicional).map(converter));
    setArquivos([]);
  }, [aberto, solicitacao]);
  const jornada = solicitacao?.jornada_minutos ?? JORNADA_PADRAO_MIN;
  const calculo = calcularHoraExtra(
    {
      entrada: horarios.ponto_entrada_real,
      saida_intervalo: horarios.ponto_saida_intervalo_real,
      retorno_intervalo: horarios.ponto_retorno_intervalo_real,
      saida: horarios.ponto_saida_real,
    },
    jornada,
  );
  const minutos = calculo.excedente;
  const media = mediaConclusao([...linhas, ...adicionais].map((l) => l.concluido));
  if (!solicitacao) return null;
  const mudarHorario = (campo: keyof typeof horarios, valor: string) => setHorarios((a) => ({ ...a, [campo]: valor }));
  const mudarLinha = (
    grupo: "originais" | "adicionais",
    indice: number,
    campo: keyof LinhaConclusao,
    valor: string | number,
  ) => {
    const setter = grupo === "originais" ? setLinhas : setAdicionais;
    setter((xs) =>
      xs.map((x, i) => {
        if (i !== indice) return x;
        const novo = { ...x, [campo]: valor };
        if (campo === "concluido") novo.status = statusExecucaoPorPercentual(Number(valor));
        return novo;
      }),
    );
  };
  const adicionar = (c: ChamadoDisponivel) =>
    setAdicionais((xs) => [
      ...xs,
      {
        id: "",
        chamado_id: c.id,
        numero: c.numero,
        assunto: c.assunto,
        setor: c.setor,
        previsto: null,
        concluido: 0,
        status: "nao_iniciado",
        observacao: "",
        adicional: true,
      },
    ]);
  const enviar = async () => {
    const erros = validarConclusao(
      {
        entrada: horarios.ponto_entrada_real,
        saida_intervalo: horarios.ponto_saida_intervalo_real,
        retorno_intervalo: horarios.ponto_retorno_intervalo_real,
        saida: horarios.ponto_saida_real,
      },
      jornada,
    );
    if (erros.length) {
      erros.forEach((erro) => toast.error(erro));
      return;
    }
    if (!resumo.trim()) {
      toast.error("Preencha o resumo e observações.");
      return;
    }
    try {
      await concluir.mutateAsync({
        p: {
          id: solicitacao.id,
          ...horarios,
          he_inicio_real: calculo.inicio,
          he_fim_real: calculo.fim,
          resumo_conclusao: resumo,
          chamados: linhas.map((l) => ({
            id: l.id,
            percentual_concluido: l.concluido,
            status_execucao: l.status,
            observacao: l.observacao,
          })),
          adicionais: adicionais.map((l) => ({
            chamado_id: l.chamado_id,
            percentual_concluido: l.concluido,
            status_execucao: l.status,
            observacao: l.observacao,
          })),
        },
      });
      const falhas = await enviarAnexos(solicitacao.id, "conclusao", arquivos);
      if (falhas.length) toast.warning(`Não foi possível anexar: ${falhas.join(", ")}`);
      toast.success("Conclusão enviada para aprovação.");
      aoFechar();
    } catch (e: unknown) {
      toast.error(mensagemErro(e, "Não foi possível concluir a HE."));
    }
  };
  const inputHora = (rotulo: string, campo: keyof typeof horarios) => (
    <Campo rotulo={rotulo}>
      <Input type="time" value={horarios[campo]} onChange={(e) => mudarHorario(campo, e.target.value)} />
    </Campo>
  );
  return (
    <>
      <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
        <DialogContent className="max-h-[96vh] max-w-[1180px] overflow-y-auto p-0">
          <DialogHeader className="border-b px-7 py-4">
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  "grid h-14 w-14 place-items-center rounded-full bg-orange-100",
                  "text-orange-500 ring-8 ring-orange-50",
                )}
              >
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <div>
                <DialogTitle className="text-2xl text-[#07194b]">Conclusão da Hora Extra</DialogTitle>
                <DialogDescription>
                  Informe abaixo os horários efetivos e o resultado de cada tarefa realizada na hora extra.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_255px]">
            <div className="space-y-3">
              {solicitacao.motivo_devolucao && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  <strong>Devolvida para ajuste:</strong> {solicitacao.motivo_devolucao}
                </div>
              )}
              <SecaoForm titulo="1. Dados da solicitação" icone={<FileCheck2 className="h-5 w-5" />}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  {[
                    ["ID da solicitação", `#${solicitacao.numero}`],
                    ["Colaborador", solicitacao.colaborador_nome],
                    ["Setor", solicitacao.setor || "—"],
                    ["Data da HE", formatarData(solicitacao.data_he)],
                    ["Tipo da HE", solicitacao.tipo === "normal" ? "Normal" : "Emergencial"],
                  ].map(([r, v]) => (
                    <Campo key={r} rotulo={r}>
                      <Input value={v} readOnly className="bg-slate-100" />
                    </Campo>
                  ))}
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="2. Horário de ponto efetivo"
                subtitulo={
                  "Informe os horários que foram efetivamente registrados no seu ponto " +
                  "no dia da realização da hora extra."
                }
                icone={<Clock3 className="h-5 w-5" />}
              >
                <div className="grid gap-3 lg:grid-cols-[1.4fr_.9fr_.55fr]">
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
                    {inputHora("Entrada", "ponto_entrada_real")}
                    {inputHora("Saída (intervalo)", "ponto_saida_intervalo_real")}
                    {inputHora("Retorno (intervalo)", "ponto_retorno_intervalo_real")}
                    {inputHora("Saída", "ponto_saida_real")}
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-blue-50 p-3">
                    <div className="col-span-2 text-xs font-semibold text-blue-700">
                      Horário da HE (calculado pela escala de {formatarDuracao(jornada, true)})
                    </div>
                    <Campo rotulo="Início real">
                      <Input readOnly value={calculo.excedente ? calculo.inicio : "—"} className="bg-white" />
                    </Campo>
                    <Campo rotulo="Término real">
                      <Input readOnly value={calculo.excedente ? calculo.fim : "—"} className="bg-white" />
                    </Campo>
                  </div>
                  <TotalHoras minutos={minutos} trabalhado={calculo.trabalhado} />
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="3. Chamados da solicitação"
                subtitulo={
                  "Atualize o percentual concluído de cada chamado. " + "Os valores previstos não podem ser alterados."
                }
                icone={<UsersRound className="h-5 w-5" />}
              >
                <TabelaConclusao
                  linhas={linhas}
                  adicionais={false}
                  aoMudar={(i, c, v) => mudarLinha("originais", i, c, v)}
                />
                <div
                  className={cn(
                    "mt-3 flex items-center justify-between rounded-lg border border-blue-200",
                    "bg-blue-50 p-3 text-xs text-blue-700",
                  )}
                >
                  <div>
                    <strong>Não é possível alterar o percentual previsto na solicitação.</strong>
                    <br />
                    Caso tenha trabalhado em outros chamados além dos previstos, adicione-os abaixo.
                  </div>
                  <Button variant="outline" className="bg-white" onClick={() => setSeletor(true)}>
                    + &nbsp; Adicionar chamado
                  </Button>
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="4. Chamados adicionais (realizados durante a HE)"
                subtitulo="Inclua os chamados extras que também foram trabalhados durante a hora extra."
                icone={<UsersRound className="h-5 w-5" />}
              >
                <TabelaConclusao
                  linhas={adicionais}
                  adicionais
                  aoMudar={(i, c, v) => mudarLinha("adicionais", i, c, v)}
                  aoExcluir={(i) => setAdicionais((xs) => xs.filter((_, j) => j !== i))}
                />
                <div className="mt-3 text-right">
                  <Button variant="outline" onClick={() => setSeletor(true)}>
                    + &nbsp; Adicionar chamado adicional
                  </Button>
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="5. Resumo e observações"
                subtitulo={
                  "Descreva aqui um resumo do que foi realizado durante a hora extra " + "e se houve algum impedimento."
                }
                icone={<FileText className="h-5 w-5" />}
              >
                <Textarea maxLength={1000} rows={3} value={resumo} onChange={(e) => setResumo(e.target.value)} />
                <div className="mt-1 text-right text-xs text-slate-500">{resumo.length}/1000</div>
              </SecaoForm>
              <SecaoForm titulo="6. Anexos (opcional)" icone={<FileText className="h-5 w-5" />}>
                <DropzoneAnexos
                  arquivos={arquivos}
                  setArquivos={setArquivos}
                  descricao="comprovantes ou outros documentos que validem a execução da hora extra."
                />
              </SecaoForm>
            </div>
            <aside className="space-y-4">
              <div className="rounded-lg bg-blue-50 p-5 text-sm">
                <h3 className="mb-5 font-bold text-[#07194b]">Resumo da Solicitação</h3>
                <Resumo rotulo="ID da solicitação" valor={`#${solicitacao.numero}`} />
                <Resumo rotulo="Colaborador" valor={solicitacao.colaborador_nome} />
                <Resumo rotulo="Setor" valor={solicitacao.setor || "—"} />
                <Resumo
                  rotulo="Data"
                  valor={`${formatarData(solicitacao.data_he)} (${diaSemana(solicitacao.data_he)})`}
                />
                <Resumo rotulo="Tipo de HE" valor={solicitacao.tipo === "normal" ? "Normal" : "Emergencial"} />
                <hr className="my-4 border-blue-200" />
                <h3 className="mb-4 font-bold text-[#07194b]">Resumo da Conclusão</h3>
                <Resumo
                  rotulo="Horário da HE"
                  valor={calculo.excedente ? `${calculo.inicio} - ${calculo.fim}` : "—"}
                />
                <Resumo rotulo="Total trabalhado" valor={formatarDuracao(calculo.trabalhado)} />
                <Resumo rotulo="Total de hora extra" valor={formatarDuracao(minutos)} />
                <Resumo rotulo="Chamados originais" valor={formatarQuantidadeChamados(linhas.length)} />
                <Resumo
                  rotulo="Chamados adicionais"
                  valor={`${adicionais.length} ${adicionais.length === 1 ? "chamado" : "chamados"}`}
                />
                <Resumo rotulo="Média de conclusão" valor={`${media}%`} />
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-sm text-[#07194b]">
                <h3 className="mb-3 flex gap-2 font-bold">
                  <Info className="h-5 w-5 text-orange-500" />
                  Importante
                </h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>Informe os horários exatamente como registrados no seu ponto.</li>
                  <li>
                    A hora extra é <strong>calculada</strong>: conta só o tempo que passar da jornada da escala.
                  </li>
                  <li>Preencha o percentual concluído de cada chamado.</li>
                  <li>
                    Os percentuais previstos na solicitação <strong>não podem</strong> ser alterados.
                  </li>
                  <li>É possível incluir novos chamados caso tenha realizado outras atividades.</li>
                  <li>Após concluir, a solicitação será enviada para aprovação do seu gestor.</li>
                </ul>
              </div>
            </aside>
          </div>
          <div className="sticky bottom-0 flex justify-between border-t bg-white px-5 py-3">
            <Button variant="secondary" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button disabled={concluir.isPending} onClick={enviar} className="bg-orange-500 px-6 hover:bg-orange-600">
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Concluir e Enviar para Aprovação
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <SeletorChamadoDialog
        aberto={seletor}
        aoFechar={() => setSeletor(false)}
        colaboradorId={solicitacao.colaborador_id}
        podeAprovar={false}
        concluidosDesde={solicitacao.data_he}
        ignorar={[...linhas, ...adicionais].map((l) => l.chamado_id)}
        aoSelecionar={adicionar}
      />
    </>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="mb-3">
      <div className="text-slate-500">{rotulo}</div>
      <div className="font-semibold text-[#07194b]">{valor}</div>
    </div>
  );
}
function TabelaConclusao({
  linhas,
  adicionais,
  aoMudar,
  aoExcluir,
}: {
  linhas: LinhaConclusao[];
  adicionais: boolean;
  aoMudar: (i: number, c: keyof LinhaConclusao, v: string | number) => void;
  aoExcluir?: (i: number) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[760px] text-xs">
        <thead className="bg-slate-50 text-left text-slate-600">
          <tr>
            <th className="p-2">ID</th>
            <th className="p-2">Título do chamado</th>
            {!adicionais && <th className="p-2">Previsto na solicitação ⓘ</th>}
            <th className="p-2">Concluído agora</th>
            <th className="p-2">Status</th>
            <th className="p-2">Observação (opcional)</th>
            {adicionais && <th className="p-2">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={l.chamado_id} className="border-t">
              <td className="p-2 font-semibold">#{l.numero}</td>
              <td className="p-2">
                <div>{l.assunto}</div>
                <div className="text-slate-500">{l.setor}</div>
              </td>
              {!adicionais && (
                <td className="p-2">
                  <div className="rounded bg-slate-100 px-3 py-2 text-center">{l.previsto} %</div>
                </td>
              )}
              <td className="p-2">
                <Input
                  className="w-24"
                  type="number"
                  min="0"
                  max="100"
                  value={l.concluido}
                  onChange={(e) => aoMudar(i, "concluido", limitarPercentual(e.target.value))}
                />
              </td>
              <td className="p-2">
                <select
                  value={l.status}
                  onChange={(e) => aoMudar(i, "status", e.target.value)}
                  className={cn("rounded-md px-2 py-2 font-semibold", STATUS_EXECUCAO[l.status].classe)}
                >
                  {Object.entries(STATUS_EXECUCAO).map(([v, x]) => (
                    <option key={v} value={v}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="p-2">
                <Input value={l.observacao} onChange={(e) => aoMudar(i, "observacao", e.target.value)} />
              </td>
              {adicionais && (
                <td className="p-2">
                  <Button size="icon" variant="outline" onClick={() => aoExcluir?.(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              )}
            </tr>
          ))}
          {!linhas.length && (
            <tr>
              <td colSpan={7} className="p-5 text-center text-slate-500">
                Nenhum chamado adicional.
              </td>
            </tr>
          )}
        </tbody>
        {!adicionais && (
          <tfoot>
            <tr className="bg-blue-50 font-bold">
              <td colSpan={2} className="p-2">
                Média
              </td>
              <td className="p-2 text-center">{mediaConclusao(linhas.map((l) => l.previsto))} %</td>
              <td className="p-2">{mediaConclusao(linhas.map((l) => l.concluido))} %</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
