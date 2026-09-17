import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, Clock3, FileText, Info, Send, Trash2, UserRound, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import {
  useColaboradoresHoraExtra,
  useEnviarAnexosHoraExtra,
  useEscalasHoraExtra,
  useSalvarHoraExtra,
} from "@/hooks/useHoraExtra";
import { cn } from "@/lib/utils";
import {
  calcularHoraExtra,
  dataLocalISO,
  diaSemana,
  formatarData,
  formatarDuracao,
  JORNADA_PADRAO_MIN,
  limitarPercentual,
  mediaConclusao,
  mensagemErro,
  validarSolicitacao,
} from "./horaExtraUtils";
import { Campo, DropzoneAnexos, SecaoForm, TotalHoras } from "./HoraExtraUI";
import SeletorChamadoDialog from "./SeletorChamadoDialog";
import type { ChamadoDisponivel, PrioridadeHoraExtra, SolicitacaoHoraExtra, TipoHoraExtra } from "./types";
import { CLASSE_PRIORIDADE, LABEL_PRIORIDADE } from "./types";

interface LinhaChamado extends ChamadoDisponivel {
  percentual_previsto: number;
  prioridade_he: PrioridadeHoraExtra;
}
const estadoInicial = {
  colaborador_id: "",
  setor: "",
  data_he: dataLocalISO(),
  tipo: "normal" as TipoHoraExtra,
  escala_id: "",
  ponto_entrada: "07:30",
  ponto_saida_intervalo: "12:00",
  ponto_retorno_intervalo: "13:00",
  ponto_saida: "17:18",
  justificativa: "",
};

export default function NovaSolicitacaoDialog({
  aberto,
  aoFechar,
  podeAprovar,
  solicitacao,
}: {
  aberto: boolean;
  aoFechar: () => void;
  podeAprovar: boolean;
  solicitacao?: SolicitacaoHoraExtra | null;
}) {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const { data: colaboradoresRpc = [] } = useColaboradoresHoraExtra();
  const { data: escalas = [] } = useEscalasHoraExtra();
  const salvar = useSalvarHoraExtra();
  const colaboradores = useMemo(() => {
    if (!user || colaboradoresRpc.some((c) => c.id === user.id)) return colaboradoresRpc;
    return [
      {
        id: user.id,
        nome:
          empregado?.nome ||
          String(user.user_metadata?.display_name || user.user_metadata?.full_name || user.email || "Meu usuário"),
        cargo: empregado?.cargo || null,
        setor: empregado?.setor || null,
        empresa: empregado?.empresa || null,
      },
      ...colaboradoresRpc,
    ];
  }, [colaboradoresRpc, empregado, user]);
  const [form, setForm] = useState(estadoInicial);
  const [chamados, setChamados] = useState<LinhaChamado[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const enviarAnexos = useEnviarAnexosHoraExtra();
  const [seletor, setSeletor] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    if (solicitacao) {
      setForm({
        colaborador_id: solicitacao.colaborador_id,
        setor: solicitacao.setor ?? "",
        data_he: solicitacao.data_he,
        tipo: solicitacao.tipo,
        escala_id: solicitacao.escala_id ?? "",
        ponto_entrada: solicitacao.ponto_entrada.slice(0, 5),
        ponto_saida_intervalo: solicitacao.ponto_saida_intervalo.slice(0, 5),
        ponto_retorno_intervalo: solicitacao.ponto_retorno_intervalo.slice(0, 5),
        ponto_saida: solicitacao.ponto_saida.slice(0, 5),
        justificativa: solicitacao.justificativa,
      });
      setChamados(
        (solicitacao.chamados ?? [])
          .filter((c) => !c.adicional)
          .map((c) => ({
            id: c.chamado_id,
            numero: c.chamado_numero,
            assunto: c.chamado_assunto,
            setor: c.chamado_setor,
            prioridade: c.prioridade,
            responsavel_id: solicitacao.colaborador_id,
            responsavel_nome: solicitacao.colaborador_nome,
            percentual_previsto: Number(c.percentual_previsto),
            prioridade_he: c.prioridade,
          })),
      );
    } else {
      setForm({ ...estadoInicial, colaborador_id: user?.id ?? "", data_he: dataLocalISO() });
      setChamados([]);
    }
    setArquivos([]);
  }, [aberto, solicitacao, user?.id]);
  useEffect(() => {
    if (!aberto || solicitacao || !form.colaborador_id) return;
    const c = colaboradores.find((x) => x.id === form.colaborador_id);
    if (c) setForm((atual) => ({ ...atual, setor: c.setor ?? "" }));
  }, [aberto, colaboradores, form.colaborador_id, solicitacao]);
  // Escala nova (ou primeira carga): os horários do dia começam iguais aos
  // dela, e o usuário só mexe na saída para dizer até que hora ficou.
  const trocarEscala = (id: string) => {
    const nova = escalas.find((e) => e.id === id);
    setForm((atual) => ({
      ...atual,
      escala_id: id,
      ...(nova && !solicitacao
        ? {
            ponto_entrada: nova.entrada.slice(0, 5),
            ponto_saida_intervalo: nova.saida_intervalo.slice(0, 5),
            ponto_retorno_intervalo: nova.retorno_intervalo.slice(0, 5),
            ponto_saida: nova.saida.slice(0, 5),
          }
        : {}),
    }));
  };
  useEffect(() => {
    if (!aberto || form.escala_id || !escalas.length) return;
    const padrao = escalas.find((e) => e.padrao) ?? escalas[0];
    trocarEscala(padrao.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, escalas, form.escala_id]);
  const colaborador = colaboradores.find((c) => c.id === form.colaborador_id);
  const setores = useMemo(
    () => Array.from(new Set(colaboradores.map((item) => item.setor).filter(Boolean) as string[])).sort(),
    [colaboradores],
  );
  const escala = escalas.find((e) => e.id === form.escala_id);
  const jornada = escala?.minutos_jornada ?? solicitacao?.jornada_minutos ?? JORNADA_PADRAO_MIN;
  const calculo = calcularHoraExtra(
    {
      entrada: form.ponto_entrada,
      saida_intervalo: form.ponto_saida_intervalo,
      retorno_intervalo: form.ponto_retorno_intervalo,
      saida: form.ponto_saida,
    },
    jornada,
  );
  const minutos = calculo.excedente;
  const media = mediaConclusao(chamados.map((c) => c.percentual_previsto));
  const gerencial = podeAprovar && !!user && form.colaborador_id !== user.id && !solicitacao;
  // HE reprovada sendo corrigida: o banco devolve a solicitação para a fila
  // de liberação ao salvar, então a tela fala de reenvio, não de edição.
  const reenvio = solicitacao?.status === "reprovada";
  const alterar = (campo: keyof typeof form, valor: string) => setForm((atual) => ({ ...atual, [campo]: valor }));
  const adicionar = (item: ChamadoDisponivel) =>
    setChamados((atual) => [...atual, { ...item, percentual_previsto: 100, prioridade_he: item.prioridade }]);
  const enviar = async () => {
    const erros = validarSolicitacao({
      chamados,
      jornadaMinutos: jornada,
      ponto: {
        entrada: form.ponto_entrada,
        saida_intervalo: form.ponto_saida_intervalo,
        retorno_intervalo: form.ponto_retorno_intervalo,
        saida: form.ponto_saida,
      },
    });
    if (!form.setor.trim()) erros.push("Informe o setor.");
    if (!form.justificativa.trim()) erros.push("Informe a justificativa.");
    if (erros.length) {
      erros.forEach((e) => toast.error(e));
      return;
    }
    try {
      const id = (await salvar.mutateAsync({
        p: {
          ...form,
          id: solicitacao?.id,
          he_inicio_previsto: calculo.inicio,
          he_fim_previsto: calculo.fim,
          chamados: chamados.map((c) => ({
            chamado_id: c.id,
            prioridade: c.prioridade_he,
            percentual_previsto: c.percentual_previsto,
          })),
        },
      })) as string;
      const falhas = await enviarAnexos(id, "solicitacao", arquivos);
      if (falhas.length) toast.warning(`Não foi possível anexar: ${falhas.join(", ")}`);
      toast.success(
        gerencial
          ? "HE criada e aprovada."
          : reenvio
            ? "Solicitação corrigida e reenviada para aprovação."
            : solicitacao
              ? "Solicitação atualizada."
              : "Solicitação enviada para aprovação.",
      );
      aoFechar();
    } catch (erro: unknown) {
      toast.error(mensagemErro(erro, "Não foi possível salvar a solicitação."));
    }
  };
  const campoHora = (rotulo: string, campo: keyof typeof form) => (
    <Campo rotulo={rotulo}>
      <Input type="time" value={form[campo]} onChange={(e) => alterar(campo, e.target.value)} />
    </Campo>
  );
  return (
    <>
      <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
        <DialogContent className="max-h-[96vh] max-w-[1216px] overflow-y-auto p-0">
          <DialogHeader className="border-b px-7 py-5">
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  "grid h-14 w-14 place-items-center rounded-full bg-orange-100",
                  "text-orange-500 ring-8 ring-orange-50",
                )}
              >
                <Clock3 className="h-8 w-8" />
              </span>
              <div>
                <DialogTitle className="text-2xl text-[#07194b]">
                  {reenvio
                    ? "Corrigir e Reenviar Hora Extra"
                    : solicitacao
                      ? "Editar Solicitação de Hora Extra"
                      : "Nova Solicitação de Hora Extra"}
                </DialogTitle>
                <DialogDescription>
                  {reenvio
                    ? "Ajuste o que o gestor apontou e reenvie a solicitação para aprovação."
                    : "Preencha as informações abaixo para solicitar a liberação da hora extra."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_270px]">
            <div className="space-y-3">
              {reenvio && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                  <strong>Motivo da rejeição:</strong>{" "}
                  {solicitacao?.motivo_reprovacao || "O gestor não informou o motivo."}
                </div>
              )}
              <SecaoForm titulo="1. Colaborador e data" icone={<UserRound className="h-5 w-5" />}>
                <div className="grid gap-3 md:grid-cols-4">
                  <Campo rotulo="Colaborador" obrigatorio>
                    <select
                      className="h-10 w-full rounded-md border bg-white px-3 text-sm disabled:bg-slate-100"
                      disabled={!podeAprovar || !!solicitacao}
                      value={form.colaborador_id}
                      onChange={(e) => alterar("colaborador_id", e.target.value)}
                    >
                      {!colaboradores.length && user && <option value={user.id}>Meu usuário</option>}
                      {colaboradores.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo rotulo="Setor" obrigatorio>
                    <div className="relative">
                      <Input
                        list="hora-extra-setores"
                        value={form.setor}
                        onChange={(e) => alterar("setor", e.target.value)}
                        className="bg-white pr-9"
                      />
                      <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-500" />
                      <datalist id="hora-extra-setores">
                        {setores.map((item) => (
                          <option key={item} value={item} />
                        ))}
                      </datalist>
                    </div>
                  </Campo>
                  <Campo rotulo="Data da HE" obrigatorio>
                    <Input type="date" value={form.data_he} onChange={(e) => alterar("data_he", e.target.value)} />
                  </Campo>
                  <Campo rotulo="Tipo de HE">
                    <select
                      className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                      value={form.tipo}
                      onChange={(e) => alterar("tipo", e.target.value)}
                    >
                      <option value="normal">Normal</option>
                      <option value="emergencial">Emergencial</option>
                    </select>
                  </Campo>
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="2. Horário de ponto do dia"
                subtitulo={
                  "A hora extra é calculada sozinha: conta só o tempo que passar " +
                  "da jornada da escala de trabalho."
                }
                icone={<Clock3 className="h-5 w-5" />}
              >
                <div className="mb-3 flex flex-wrap items-end gap-3">
                  <Campo rotulo="Escala de trabalho" className="min-w-[260px] flex-1">
                    <select
                      className="h-10 w-full rounded-md border bg-white px-3 text-sm"
                      value={form.escala_id}
                      onChange={(e) => trocarEscala(e.target.value)}
                    >
                      {!escalas.length && <option value="">Padrão (07:30 às 17:18)</option>}
                      {escalas.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.nome}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <div className="pb-2 text-xs text-slate-500">
                    Jornada: <strong className="text-[#07194b]">{formatarDuracao(jornada, true)}</strong> por dia
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-[1.45fr_.85fr_.55fr]">
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-4">
                    {campoHora("Entrada", "ponto_entrada")}
                    {campoHora("Saída (intervalo)", "ponto_saida_intervalo")}
                    {campoHora("Retorno (intervalo)", "ponto_retorno_intervalo")}
                    {campoHora("Saída", "ponto_saida")}
                  </div>
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-blue-50 p-3">
                    <div className="col-span-2 flex items-center gap-1 text-xs font-semibold text-blue-700">
                      <Clock3 className="h-4 w-4" />
                      Horário da HE (calculado)
                    </div>
                    <Campo rotulo="Início da HE">
                      <Input readOnly value={calculo.excedente ? calculo.inicio : "—"} className="bg-white" />
                    </Campo>
                    <Campo rotulo="Término da HE">
                      <Input readOnly value={calculo.excedente ? calculo.fim : "—"} className="bg-white" />
                    </Campo>
                  </div>
                  <TotalHoras minutos={minutos} trabalhado={calculo.trabalhado} />
                </div>
              </SecaoForm>
              <SecaoForm
                titulo="3. Chamados que serão resolvidos na HE"
                subtitulo={
                  "Selecione os chamados que serão trabalhados durante a hora extra " +
                  "e informe a expectativa de conclusão."
                }
                icone={<UsersRound className="h-5 w-5" />}
              >
                <div className="-mt-10 mb-3 flex justify-end">
                  <Button variant="outline" onClick={() => setSeletor(true)}>
                    + &nbsp; Adicionar chamado
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-600">
                      <tr>
                        <th className="p-3">ID</th>
                        <th className="p-3">Título do chamado</th>
                        <th className="p-3">Prioridade</th>
                        <th className="p-3">Expectativa de conclusão</th>
                        <th className="p-3">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chamados.map((c, i) => (
                        <tr key={c.id} className="border-t">
                          <td className="p-3 font-semibold">#{c.numero}</td>
                          <td className="p-3">
                            <div>{c.assunto}</div>
                            <div className="text-xs text-slate-500">{c.setor}</div>
                          </td>
                          <td className="p-3">
                            <select
                              value={c.prioridade_he}
                              onChange={(e) =>
                                setChamados((xs) =>
                                  xs.map((x, j) =>
                                    j === i ? { ...x, prioridade_he: e.target.value as PrioridadeHoraExtra } : x,
                                  ),
                                )
                              }
                              className={cn(
                                "rounded-full border px-2 py-1 text-xs font-semibold",
                                CLASSE_PRIORIDADE[c.prioridade_he],
                              )}
                            >
                              {Object.entries(LABEL_PRIORIDADE).map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3">
                            <div className="relative w-28">
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                value={c.percentual_previsto}
                                onChange={(e) =>
                                  setChamados((xs) =>
                                    xs.map((x, j) =>
                                      j === i
                                        ? { ...x, percentual_previsto: limitarPercentual(e.target.value) }
                                        : x,
                                    ),
                                  )
                                }
                                className="pr-7"
                              />
                              <span className="absolute right-3 top-2.5 text-slate-500">%</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => setChamados((xs) => xs.filter((_, j) => j !== i))}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {!chamados.length && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-500">
                            Nenhum chamado adicionado.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-blue-50 font-bold text-[#07194b]">
                        <td colSpan={3} className="p-3">
                          Total (média dos chamados)
                        </td>
                        <td className="p-3">{media} %</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </SecaoForm>
              <SecaoForm titulo="4. Justificativa da solicitação" icone={<FileText className="h-5 w-5" />}>
                <Textarea
                  maxLength={500}
                  rows={3}
                  value={form.justificativa}
                  onChange={(e) => alterar("justificativa", e.target.value)}
                  placeholder="Descreva a necessidade da hora extra..."
                />
                <div className="mt-1 text-right text-xs text-slate-500">{form.justificativa.length}/500</div>
              </SecaoForm>
              <SecaoForm titulo="5. Anexos (opcional)" icone={<FileText className="h-5 w-5" />}>
                <DropzoneAnexos arquivos={arquivos} setArquivos={setArquivos} />
              </SecaoForm>
            </div>
            <aside className="space-y-4">
              <div className="rounded-lg bg-blue-50 p-5">
                <h3 className="mb-5 flex items-center gap-2 font-bold text-[#07194b]">
                  <CalendarDays className="h-5 w-5 text-blue-600" />
                  Resumo da Solicitação
                </h3>
                <dl className="space-y-4 text-sm">
                  <Resumo rotulo="Colaborador" valor={colaborador?.nome || "—"} />
                  <Resumo rotulo="Setor" valor={form.setor || "—"} />
                  <Resumo
                    rotulo="Data"
                    valor={form.data_he ? `${formatarData(form.data_he)} (${diaSemana(form.data_he)})` : "—"}
                  />
                  <Resumo rotulo="Escala de trabalho" valor={escala?.nome || "Padrão (07:30 às 17:18)"} />
                  <Resumo
                    rotulo="Horário da HE"
                    valor={calculo.excedente ? `${calculo.inicio} - ${calculo.fim}` : "—"}
                  />
                  <Resumo rotulo="Total trabalhado" valor={formatarDuracao(calculo.trabalhado)} />
                  <Resumo rotulo="Total de hora extra" valor={formatarDuracao(minutos)} />
                  <Resumo
                    rotulo="Chamados"
                    valor={`${chamados.length} ${chamados.length === 1 ? "chamado" : "chamados"}`}
                  />
                  <Resumo rotulo="Expectativa média" valor={`${media}%`} />
                </dl>
              </div>
              <div className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-sm text-[#07194b]">
                <h3 className="mb-3 flex items-center gap-2 font-bold">
                  <Info className="h-5 w-5 text-orange-500" />
                  Importante
                </h3>
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    A HE será realizada somente após <strong>aprovação</strong> do gestor.
                  </li>
                  <li>Informe apenas chamados que serão tratados no período da HE.</li>
                  <li>
                    A expectativa de cada chamado vai de <strong>0 a 100%</strong>; o total é a média entre eles.
                  </li>
                  <li>
                    Só conta como hora extra o tempo que passar da <strong>jornada da escala</strong>.
                  </li>
                  <li>Em caso de alteração nos horários, comunique o gestor.</li>
                </ul>
              </div>
            </aside>
          </div>
          <div className="sticky bottom-0 flex justify-between border-t bg-white px-5 py-3">
            <Button variant="secondary" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button disabled={salvar.isPending} onClick={enviar} className="bg-orange-500 px-7 hover:bg-orange-600">
              <Send className="mr-2 h-4 w-4" />
              {salvar.isPending
                ? "Salvando..."
                : gerencial
                  ? "Criar HE Aprovada"
                  : reenvio
                    ? "Reenviar para Aprovação"
                    : "Enviar para Aprovação"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <SeletorChamadoDialog
        aberto={seletor}
        aoFechar={() => setSeletor(false)}
        colaboradorId={form.colaborador_id}
        podeAprovar={podeAprovar}
        ignorar={chamados.map((c) => c.id)}
        aoSelecionar={adicionar}
      />
    </>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-slate-500">{rotulo}</dt>
      <dd className="font-semibold text-[#07194b]">{valor}</dd>
    </div>
  );
}
