import { useState } from "react";
import { CalendarClock, Check, Pencil, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useEscalasHoraExtra,
  useExcluirEscalaHoraExtra,
  useSalvarEscalaHoraExtra,
} from "@/hooks/useHoraExtra";
import { cn } from "@/lib/utils";
import { formatarDuracao, mensagemErro, minutosTrabalhados, somenteHora } from "./horaExtraUtils";
import { Campo } from "./HoraExtraUI";
import type { EscalaHoraExtra } from "./types";

const FORMULARIO_VAZIO = {
  id: "",
  nome: "",
  entrada: "07:30",
  saida_intervalo: "12:00",
  retorno_intervalo: "13:00",
  saida: "17:18",
  padrao: false,
  nao_aplicavel_fins_semana: false,
};

/**
 * Cadastro das escalas de trabalho. A jornada da escala é o parâmetro da
 * hora extra: só vira HE o tempo trabalhado que passar dela. A escala
 * marcada como padrão é a que já vem escolhida numa solicitação nova.
 */
export default function EscalasHoraExtraDialog({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { data: escalas = [], isLoading } = useEscalasHoraExtra();
  const salvar = useSalvarEscalaHoraExtra();
  const excluir = useExcluirEscalaHoraExtra();
  const [form, setForm] = useState(FORMULARIO_VAZIO);
  const jornada = minutosTrabalhados(form);
  const alterar = (campo: keyof typeof form, valor: string | boolean) =>
    setForm((atual) => ({ ...atual, [campo]: valor }));
  const editar = (escala: EscalaHoraExtra) =>
    setForm({
      id: escala.id,
      nome: escala.nome,
      entrada: somenteHora(escala.entrada),
      saida_intervalo: somenteHora(escala.saida_intervalo),
      retorno_intervalo: somenteHora(escala.retorno_intervalo),
      saida: somenteHora(escala.saida),
      padrao: escala.padrao,
      nao_aplicavel_fins_semana: escala.nao_aplicavel_fins_semana,
    });
  const gravar = async () => {
    if (!form.nome.trim()) {
      toast.error("Informe o nome da escala.");
      return;
    }
    if (jornada <= 0) {
      toast.error("Os horários da escala não formam uma jornada válida.");
      return;
    }
    try {
      await salvar.mutateAsync({ p: { ...form, id: form.id || null } });
      toast.success(form.id ? "Escala atualizada." : "Escala cadastrada.");
      setForm(FORMULARIO_VAZIO);
    } catch (erro: unknown) {
      toast.error(mensagemErro(erro, "Não foi possível salvar a escala."));
    }
  };
  const apagar = async (escala: EscalaHoraExtra) => {
    if (!window.confirm(`Excluir a escala "${escala.nome}"?`)) return;
    try {
      await excluir.mutateAsync({ p_id: escala.id });
      toast.success("Escala excluída.");
      if (form.id === escala.id) setForm(FORMULARIO_VAZIO);
    } catch (erro: unknown) {
      toast.error(mensagemErro(erro, "Não foi possível excluir a escala."));
    }
  };
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-orange-100 text-orange-500">
              <CalendarClock className="h-6 w-6" />
            </span>
            <div>
              <DialogTitle className="text-xl text-[#07194b]">Escalas de trabalho</DialogTitle>
              <DialogDescription>
                A hora extra começa a contar depois da jornada da escala do colaborador.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="p-3">Escala</th>
                <th className="p-3">Horários</th>
                <th className="p-3">Jornada</th>
                <th className="p-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {escalas.map((escala) => (
                <tr key={escala.id} className="border-t">
                  <td className="p-3 font-semibold text-[#07194b]">
                    <div className="flex items-center gap-2">
                      {escala.nome}
                       {escala.padrao && (
                        <span className="inline-flex items-center gap-1 rounded bg-orange-100 px-2 py-0.5 text-[11px] text-orange-700">
                          <Star className="h-3 w-3" />
                          Padrão
                        </span>
                       )}
                       {escala.nao_aplicavel_fins_semana && (
                         <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] text-blue-700">
                           Fim de semana
                         </span>
                       )}
                    </div>
                  </td>
                  <td className="p-3 text-slate-600">
                    {[escala.entrada, escala.saida_intervalo, escala.retorno_intervalo, escala.saida]
                      .map(somenteHora)
                      .join(" | ")}
                  </td>
                  <td className="p-3 font-semibold">{formatarDuracao(escala.minutos_jornada, true)}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <Button size="icon" variant="outline" onClick={() => editar(escala)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        disabled={escala.padrao || excluir.isPending}
                        onClick={() => apagar(escala)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!escalas.length && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-slate-500">
                    {isLoading ? "Carregando..." : "Nenhuma escala cadastrada."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-3 font-bold text-[#07194b]">{form.id ? "Editar escala" : "Nova escala"}</h3>
          <div className="grid gap-3 md:grid-cols-5">
            <Campo rotulo="Nome da escala" obrigatorio className="md:col-span-3">
              <Input
                value={form.nome}
                placeholder="Ex.: Administrativo 07:30 às 17:18"
                onChange={(e) => alterar("nome", e.target.value)}
              />
            </Campo>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={form.nao_aplicavel_fins_semana}
                onChange={(e) => alterar("nao_aplicavel_fins_semana", e.target.checked)}
              />
              Não aplicável aos finais de semana
            </label>
            <Campo rotulo="Entrada">
              <Input type="time" value={form.entrada} onChange={(e) => alterar("entrada", e.target.value)} />
            </Campo>
            <Campo rotulo="Saída (intervalo)">
              <Input
                type="time"
                value={form.saida_intervalo}
                onChange={(e) => alterar("saida_intervalo", e.target.value)}
              />
            </Campo>
            <Campo rotulo="Retorno (intervalo)">
              <Input
                type="time"
                value={form.retorno_intervalo}
                onChange={(e) => alterar("retorno_intervalo", e.target.value)}
              />
            </Campo>
            <Campo rotulo="Saída">
              <Input type="time" value={form.saida} onChange={(e) => alterar("saida", e.target.value)} />
            </Campo>
            <div className="flex flex-col justify-center rounded-lg bg-emerald-50 px-4 py-2">
              <span className="text-xs font-semibold text-emerald-700">Jornada</span>
              <strong className={cn("text-xl", jornada > 0 ? "text-emerald-800" : "text-red-600")}>
                {formatarDuracao(jornada)}
              </strong>
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.padrao} onChange={(e) => alterar("padrao", e.target.checked)} />
            Usar como escala padrão das novas solicitações
          </label>
          <div className="mt-4 flex justify-end gap-2">
            {form.id && (
              <Button variant="outline" onClick={() => setForm(FORMULARIO_VAZIO)}>
                Cancelar edição
              </Button>
            )}
            <Button disabled={salvar.isPending} className="bg-orange-500 hover:bg-orange-600" onClick={gravar}>
              <Check className="mr-2 h-4 w-4" />
              {form.id ? "Salvar escala" : "Cadastrar escala"}
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
