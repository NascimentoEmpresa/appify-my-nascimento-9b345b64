import { useEffect, useState } from "react";
import { Clock3, FileText, Link2, PencilLine, Save, X } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDetalheHoraExtra, useEditarHorariosConcluida } from "@/hooks/useHoraExtra";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  calcularHoraExtra,
  formatarData,
  formatarDuracao,
  JORNADA_PADRAO_MIN,
  jornadaParaCalculoHoraExtra,
  mensagemErro,
  podeEditarHorariosDaConcluida,
  somenteHora,
} from "./horaExtraUtils";
import { BadgeExecucao, BadgeStatus, ListaAnexos } from "./HoraExtraUI";
import type { SolicitacaoHoraExtra } from "./types";

const CAMPOS_PONTO = [
  ["Entrada", "entrada"],
  ["Saída", "saida_intervalo"],
  ["Retorno", "retorno_intervalo"],
  ["Saída", "saida"],
] as const;

type CampoPonto = (typeof CAMPOS_PONTO)[number][1];
type Horarios = Record<CampoPonto, string>;

/** `somenteHora` devolve "—" no vazio, e <input type="time"> recusa esse valor. */
function valorCampoHora(valor?: string | null): string {
  return valor ? valor.slice(0, 5) : "";
}

export default function DetalhesHoraExtraDialog({
  aberto,
  aoFechar,
  solicitacao,
}: {
  aberto: boolean;
  aoFechar: () => void;
  solicitacao: SolicitacaoHoraExtra | null;
}) {
  // A linha que veio da lista pode ter sido carregada antes de o upload do
  // anexo terminar. Reler o detalhe ao abrir é o que garante os arquivos aqui.
  const { data: atual } = useDetalheHoraExtra(aberto ? solicitacao?.id : null);
  const { data: podeEditarConcluida = false } = useScreenAccess("sistemas_hora_extra", "editar_concluida");
  const corrigir = useEditarHorariosConcluida();
  const [editando, setEditando] = useState(false);
  const [horarios, setHorarios] = useState<Horarios>({
    entrada: "",
    saida_intervalo: "",
    retorno_intervalo: "",
    saida: "",
  });
  const dados = atual ?? solicitacao;
  const solicitacaoId = dados?.id;
  // Fechar o modal — ou abrir outra HE — sempre volta ao modo leitura. Sem
  // isto a solicitação seguinte herdava o formulário aberto da anterior, com
  // os horários da anterior já digitados dentro.
  useEffect(() => {
    setEditando(false);
  }, [aberto, solicitacaoId]);
  if (!solicitacao || !dados) return null;
  const podeCorrigir = podeEditarHorariosDaConcluida({ status: dados.status, podeEditarConcluida });
  const semIntervalo = Boolean(dados.sem_intervalo);
  const jornadaCalculo = jornadaParaCalculoHoraExtra(
    dados.jornada_minutos ?? JORNADA_PADRAO_MIN,
    dados.seguir_escala ?? true,
  );
  // Mesma fórmula da RPC: o que o modal mostra enquanto se digita é o que o
  // banco vai gravar, não uma prévia aproximada.
  const calculo = calcularHoraExtra(horarios, jornadaCalculo);
  const pontoGravado: Horarios = {
    entrada: valorCampoHora(dados.ponto_entrada_real || dados.ponto_entrada),
    saida_intervalo: valorCampoHora(dados.ponto_saida_intervalo_real || dados.ponto_saida_intervalo),
    retorno_intervalo: valorCampoHora(dados.ponto_retorno_intervalo_real || dados.ponto_retorno_intervalo),
    saida: valorCampoHora(dados.ponto_saida_real || dados.ponto_saida),
  };
  const abrirEdicao = () => {
    setHorarios(pontoGravado);
    setEditando(true);
  };
  const mudarHorario = (campo: CampoPonto, valor: string) =>
    setHorarios((anterior) =>
      // Dia sem pausa: os dois registros do meio repetem a entrada, o mesmo
      // contrato de quatro horários que o banco guarda.
      semIntervalo && campo === "entrada"
        ? { ...anterior, entrada: valor, saida_intervalo: valor, retorno_intervalo: valor }
        : { ...anterior, [campo]: valor },
    );
  const salvarCorrecao = async () => {
    if (CAMPOS_PONTO.some(([, campo]) => !horarios[campo])) {
      toast.error("Preencha os quatro horários do ponto.");
      return;
    }
    if (calculo.excedente <= 0) {
      toast.error(
        `Os horários informados somam ${formatarDuracao(calculo.trabalhado, true)} e não geram hora extra.`,
      );
      return;
    }
    try {
      await corrigir.mutateAsync({ p_id: dados.id, p_horarios: horarios });
      toast.success("Horários da HE corrigidos.");
      setEditando(false);
    } catch (erro: unknown) {
      toast.error(mensagemErro(erro, "Não foi possível corrigir os horários."));
    }
  };
  const totalRealExibido = editando ? calculo.excedente : dados.total_real_min;
  const trabalhadoExibido = editando
    ? calculo.trabalhado
    : (dados.trabalhado_real_min ?? dados.trabalhado_previsto_min ?? 0);
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="text-xl text-[#07194b]">Detalhes da Solicitação de HE</DialogTitle>
            <BadgeStatus solicitacao={dados} />
          </div>
          <DialogDescription>Informações registradas na solicitação e na conclusão.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <Info rotulo="ID" valor={`#${dados.numero}`} />
          <Info rotulo="Colaborador" valor={dados.colaborador_nome} />
          <Info rotulo="Data da HE" valor={formatarData(dados.data_he)} />
          <Info rotulo="Tipo" valor={dados.tipo === "normal" ? "Normal" : "Emergencial"} />
          <Info rotulo="Escala de trabalho" valor={dados.escala_nome || "—"} />
          <Info
            rotulo="Jornada / trabalhado no dia"
            valor={
              `${dados.seguir_escala === false ? "Todo o período é HE" : formatarDuracao(dados.jornada_minutos ?? 0, true)} / ` +
              formatarDuracao(trabalhadoExibido, true)
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-blue-50 p-4 text-blue-700">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FileText className="h-4 w-4" />
              Total previsto
            </div>
            <div className="mt-2 text-xl font-extrabold">{formatarDuracao(dados.total_previsto_min)}</div>
          </div>
          <div className="rounded-lg bg-emerald-50 p-4 text-emerald-700">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <FileText className="h-4 w-4" />
              Total real
            </div>
            <div className="mt-2 text-xl font-extrabold">
              {totalRealExibido == null ? "—" : formatarDuracao(totalRealExibido)}
            </div>
          </div>
        </div>
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-bold text-[#07194b]">
              <Clock3 className="h-4 w-4" />
              Horário de ponto
            </h3>
            {podeCorrigir &&
              (editando ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={corrigir.isPending} onClick={() => setEditando(false)}>
                    <X className="mr-1 h-3.5 w-3.5" />
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    disabled={corrigir.isPending}
                    onClick={salvarCorrecao}
                  >
                    <Save className="mr-1 h-3.5 w-3.5" />
                    Salvar correção
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={abrirEdicao}>
                  <PencilLine className="mr-1 h-3.5 w-3.5" />
                  Editar horários
                </Button>
              ))}
          </div>
          <div className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs">
            {CAMPOS_PONTO.map(([rotulo, campo]) => {
              const nome = semIntervalo && campo !== "entrada" && campo !== "saida" ? "Sem intervalo" : rotulo;
              return (
                <div key={campo}>
                  <div className="text-slate-500">{nome}</div>
                  {editando ? (
                    <Input
                      type="time"
                      className="mt-1 h-auto bg-white px-2 py-2 text-center text-xs font-semibold"
                      disabled={semIntervalo && campo !== "entrada" && campo !== "saida"}
                      value={horarios[campo]}
                      onChange={(evento) => mudarHorario(campo, evento.target.value)}
                    />
                  ) : (
                    <div className="mt-1 rounded border bg-white px-2 py-2 font-semibold">
                      {somenteHora(pontoGravado[campo])}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Início e término da HE são derivados do ponto — nunca digitados,
                nem na leitura nem na correção. */}
            {[
              ["Início da HE", editando ? calculo.inicio : dados.he_inicio_real || dados.he_inicio_previsto],
              ["Término da HE", editando ? calculo.fim : dados.he_fim_real || dados.he_fim_previsto],
            ].map(([rotulo, valor]) => (
              <div key={rotulo}>
                <div className="text-slate-500">{rotulo}</div>
                <div className="mt-1 rounded border bg-white px-2 py-2 font-semibold text-slate-500">
                  {somenteHora(valor)}
                </div>
              </div>
            ))}
          </div>
          {editando && (
            <p className="mt-2 text-xs text-slate-500">
              A HE continua concluída: a correção só reescreve o ponto efetivo e o total real, e fica registrada no
              histórico da solicitação.
            </p>
          )}
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
                {dados.chamados?.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="p-2 font-semibold text-blue-700">
                      <Link className="underline underline-offset-2 hover:text-blue-900" to={`/app/sistemas/chamados/${c.chamado_id}`}>
                        #{c.chamado_numero}
                      </Link>
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
          <div className="whitespace-pre-wrap break-words rounded-lg border bg-slate-50 p-3 text-sm text-slate-600">
            {dados.resumo_conclusao || dados.justificativa || "Nenhuma observação informada."}
          </div>
        </section>
        <ListaAnexos anexos={dados.anexos} />
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
