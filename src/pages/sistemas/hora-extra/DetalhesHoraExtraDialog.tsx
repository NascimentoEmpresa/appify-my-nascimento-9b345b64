import { Clock3, FileText, Link2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDetalheHoraExtra } from "@/hooks/useHoraExtra";
import { formatarData, formatarDuracao, somenteHora } from "./horaExtraUtils";
import { BadgeExecucao, BadgeStatus, ListaAnexos } from "./HoraExtraUI";
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
  // A linha que veio da lista pode ter sido carregada antes de o upload do
  // anexo terminar. Reler o detalhe ao abrir é o que garante os arquivos aqui.
  const { data: atual } = useDetalheHoraExtra(aberto ? solicitacao?.id : null);
  if (!solicitacao) return null;
  const dados = atual ?? solicitacao;
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
              `${formatarDuracao(dados.jornada_minutos ?? 0, true)} / ` +
              formatarDuracao(dados.trabalhado_real_min ?? dados.trabalhado_previsto_min ?? 0, true)
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
              {dados.total_real_min == null ? "—" : formatarDuracao(dados.total_real_min)}
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
              ["Entrada", dados.ponto_entrada_real || dados.ponto_entrada],
              ["Saída", dados.ponto_saida_intervalo_real || dados.ponto_saida_intervalo],
              ["Retorno", dados.ponto_retorno_intervalo_real || dados.ponto_retorno_intervalo],
              ["Saída", dados.ponto_saida_real || dados.ponto_saida],
              ["Início da HE", dados.he_inicio_real || dados.he_inicio_previsto],
              ["Término da HE", dados.he_fim_real || dados.he_fim_previsto],
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
