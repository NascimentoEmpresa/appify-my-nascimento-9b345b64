import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2 } from "lucide-react";
import {
  useCriarBloqueioAgenda, useCriarBloqueiosRecorrentes, useEditarSerieBloqueio,
  useExcluirSerieBloqueio, useMeusBloqueiosAgenda, useRemoverBloqueioAgenda,
} from "../useBloqueioAgenda";
import { MOTIVO_BLOQUEIO_LABEL, type BloqueioAgenda, type MotivoBloqueioAgenda, type TipoBloqueioAgenda } from "../types";
import { DIAS_SEMANA, EditarSerieBloqueioDialog, type ValoresSerieBloqueio } from "./EditarSerieBloqueioDialog";

type TipoFormulario = TipoBloqueioAgenda | "recorrente";

const VAZIO = {
  tipo: "data_especifica" as TipoFormulario,
  data: "",
  dataInicio: "",
  dataFim: "",
  diaInteiro: true,
  horaInicio: "",
  horaFim: "",
  diaSemanaRecorrente: "1",
  repetirAte: "",
  motivo: "" as MotivoBloqueioAgenda | "",
  motivoOutro: "",
};

function descreverBloqueio(b: { tipo: TipoBloqueioAgenda; data_inicio: string; data_fim: string; dia_inteiro: boolean; hora_inicio: string | null; hora_fim: string | null; motivo: MotivoBloqueioAgenda }): string {
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR");
  const periodo = b.tipo === "periodo" ? `${fmt(b.data_inicio)} a ${fmt(b.data_fim)}` : fmt(b.data_inicio);
  const horario = b.dia_inteiro ? "dia inteiro" : `${b.hora_inicio?.slice(0, 5)}–${b.hora_fim?.slice(0, 5)}`;
  return `${periodo} · ${horario} · ${MOTIVO_BLOQUEIO_LABEL[b.motivo]}`;
}

function descreverSerie(itens: BloqueioAgenda[]): string {
  const primeiro = itens[0];
  const diaSemana = new Date(`${primeiro.data_inicio}T00:00:00`).getDay();
  const nomeDia = DIAS_SEMANA.find((d) => Number(d.value) === diaSemana)?.label ?? "";
  const horario = primeiro.dia_inteiro ? "dia inteiro" : `${primeiro.hora_inicio?.slice(0, 5)}–${primeiro.hora_fim?.slice(0, 5)}`;
  const ultimaData = itens[itens.length - 1].data_inicio;
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR");
  return `Toda ${nomeDia} · ${horario} · ${MOTIVO_BLOQUEIO_LABEL[primeiro.motivo]} · ${itens.length} ocorrência${itens.length > 1 ? "s" : ""}, até ${fmt(ultimaData)}`;
}

export function BloquearAgendaModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState(VAZIO);
  const [serieEditando, setSerieEditando] = useState<string | null>(null);
  const { data: bloqueios = [] } = useMeusBloqueiosAgenda();
  const criar = useCriarBloqueioAgenda();
  const criarRecorrente = useCriarBloqueiosRecorrentes();
  const editarSerie = useEditarSerieBloqueio();
  const excluirSerie = useExcluirSerieBloqueio();
  const remover = useRemoverBloqueioAgenda();

  const { series, avulsos } = useMemo(() => {
    const porSerie = new Map<string, BloqueioAgenda[]>();
    const avulsos: BloqueioAgenda[] = [];
    for (const b of bloqueios) {
      if (b.serie_bloqueio_id) {
        const lista = porSerie.get(b.serie_bloqueio_id) ?? [];
        lista.push(b);
        porSerie.set(b.serie_bloqueio_id, lista);
      } else {
        avulsos.push(b);
      }
    }
    return { series: [...porSerie.entries()].map(([serieId, itens]) => ({ serieId, itens })), avulsos };
  }, [bloqueios]);

  const serieEmEdicao = series.find((s) => s.serieId === serieEditando);

  const valido =
    (form.tipo === "data_especifica" ? !!form.data
      : form.tipo === "periodo" ? !!(form.dataInicio && form.dataFim && form.dataFim >= form.dataInicio)
      : !!form.repetirAte) &&
    (form.tipo === "periodo" || form.diaInteiro || !!(form.horaInicio && form.horaFim && form.horaFim > form.horaInicio)) &&
    !!form.motivo &&
    (form.motivo !== "outro" || !!form.motivoOutro.trim());

  const salvando = criar.isPending || criarRecorrente.isPending;

  const salvar = async () => {
    if (!valido || !form.motivo) return;
    if (form.tipo === "recorrente") {
      await criarRecorrente.mutateAsync({
        diaSemana: Number(form.diaSemanaRecorrente),
        repetirAte: form.repetirAte,
        dia_inteiro: form.diaInteiro,
        hora_inicio: form.diaInteiro ? null : form.horaInicio,
        hora_fim: form.diaInteiro ? null : form.horaFim,
        motivo: form.motivo,
        motivo_outro: form.motivo === "outro" ? form.motivoOutro.trim() : null,
      });
      setForm(VAZIO);
      return;
    }
    const payload = form.tipo === "data_especifica"
      ? {
          tipo: "data_especifica" as const,
          data_inicio: form.data,
          data_fim: form.data,
          dia_inteiro: form.diaInteiro,
          hora_inicio: form.diaInteiro ? null : form.horaInicio,
          hora_fim: form.diaInteiro ? null : form.horaFim,
          motivo: form.motivo,
          motivo_outro: form.motivo === "outro" ? form.motivoOutro.trim() : null,
        }
      : {
          tipo: "periodo" as const,
          data_inicio: form.dataInicio,
          data_fim: form.dataFim,
          dia_inteiro: true,
          hora_inicio: null,
          hora_fim: null,
          motivo: form.motivo,
          motivo_outro: form.motivo === "outro" ? form.motivoOutro.trim() : null,
        };
    await criar.mutateAsync(payload);
    setForm(VAZIO);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bloquear Agenda</DialogTitle>
          <DialogDescription>Bloqueie períodos da sua agenda para indicar indisponibilidade.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo de bloqueio</Label>
            <RadioGroup
              value={form.tipo}
              onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as TipoFormulario, diaInteiro: true }))}
              className="grid grid-cols-3 gap-2"
            >
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-sm has-[[data-state=checked]]:border-primary">
                <RadioGroupItem value="data_especifica" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Data específica</span>
                  <span className="block text-xs text-muted-foreground">Um dia e horário específicos.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-sm has-[[data-state=checked]]:border-primary">
                <RadioGroupItem value="periodo" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Período</span>
                  <span className="block text-xs text-muted-foreground">Um intervalo de datas (dia inteiro).</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 text-sm has-[[data-state=checked]]:border-primary">
                <RadioGroupItem value="recorrente" className="mt-0.5" />
                <span>
                  <span className="block font-medium">Recorrente (semanal)</span>
                  <span className="block text-xs text-muted-foreground">Mesmo dia da semana, toda semana, até uma data.</span>
                </span>
              </label>
            </RadioGroup>
          </div>

          {form.tipo === "data_especifica" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Input type="date" value={form.data} onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.diaInteiro} onCheckedChange={(v) => setForm((f) => ({ ...f, diaInteiro: !!v }))} />
                Marcar o dia todo
              </label>
              {!form.diaInteiro && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Horário início *</Label>
                    <Input type="time" value={form.horaInicio} onChange={(e) => setForm((f) => ({ ...f, horaInicio: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Horário fim *</Label>
                    <Input type="time" value={form.horaFim} onChange={(e) => setForm((f) => ({ ...f, horaFim: e.target.value }))} />
                  </div>
                </div>
              )}
            </div>
          )}

          {form.tipo === "periodo" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Data início *</Label>
                <Input type="date" value={form.dataInicio} onChange={(e) => setForm((f) => ({ ...f, dataInicio: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Data fim *</Label>
                <Input type="date" min={form.dataInicio || undefined} value={form.dataFim} onChange={(e) => setForm((f) => ({ ...f, dataFim: e.target.value }))} />
              </div>
            </div>
          )}

          {form.tipo === "recorrente" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Dia da semana *</Label>
                <Select value={form.diaSemanaRecorrente} onValueChange={(v) => setForm((f) => ({ ...f, diaSemanaRecorrente: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIAS_SEMANA.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.diaInteiro} onCheckedChange={(v) => setForm((f) => ({ ...f, diaInteiro: !!v }))} />
                Marcar o dia todo
              </label>
              {!form.diaInteiro && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Horário início *</Label>
                    <Input type="time" value={form.horaInicio} onChange={(e) => setForm((f) => ({ ...f, horaInicio: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Horário fim *</Label>
                    <Input type="time" value={form.horaFim} onChange={(e) => setForm((f) => ({ ...f, horaFim: e.target.value }))} />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Repetir até *</Label>
                <Input type="date" value={form.repetirAte} onChange={(e) => setForm((f) => ({ ...f, repetirAte: e.target.value }))} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Motivo do bloqueio *</Label>
            <RadioGroup value={form.motivo} onValueChange={(v) => setForm((f) => ({ ...f, motivo: v as MotivoBloqueioAgenda }))} className="space-y-1.5">
              {(Object.keys(MOTIVO_BLOQUEIO_LABEL) as MotivoBloqueioAgenda[]).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={m} />
                  {MOTIVO_BLOQUEIO_LABEL[m]}
                </label>
              ))}
            </RadioGroup>
          </div>

          {form.motivo === "outro" && (
            <div className="space-y-1.5">
              <Label>Outro motivo *</Label>
              <Textarea
                value={form.motivoOutro}
                maxLength={250}
                onChange={(e) => setForm((f) => ({ ...f, motivoOutro: e.target.value }))}
                placeholder="Descreva o motivo do bloqueio..."
                className="min-h-16"
              />
              <p className="text-right text-xs text-muted-foreground">{form.motivoOutro.length}/250</p>
            </div>
          )}

          {(series.length > 0 || avulsos.length > 0) && (
            <div className="space-y-1.5">
              <Label>Meus bloqueios</Label>
              <div className="space-y-1">
                {series.map(({ serieId, itens }) => (
                  <div key={serieId} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5 text-xs">
                    <span>{descreverSerie(itens)}</span>
                    <span className="flex shrink-0 gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSerieEditando(serieId)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => excluirSerie.mutate(serieId)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </div>
                ))}
                {avulsos.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5 text-xs">
                    <span>{descreverBloqueio(b)}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remover.mutate(b.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={!valido || salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {serieEmEdicao && (
        <EditarSerieBloqueioDialog
          key={serieEmEdicao.serieId}
          open={!!serieEditando}
          onOpenChange={(o) => !o && setSerieEditando(null)}
          valoresAtuais={{
            diaSemana: new Date(`${serieEmEdicao.itens[0].data_inicio}T00:00:00`).getDay(),
            dia_inteiro: serieEmEdicao.itens[0].dia_inteiro,
            hora_inicio: serieEmEdicao.itens[0].hora_inicio,
            hora_fim: serieEmEdicao.itens[0].hora_fim,
            motivo: serieEmEdicao.itens[0].motivo,
            motivo_outro: serieEmEdicao.itens[0].motivo_outro,
          }}
          salvando={editarSerie.isPending}
          onSalvar={async (dados: ValoresSerieBloqueio) => {
            await editarSerie.mutateAsync({
              serieId: serieEmEdicao.serieId,
              novoDiaSemana: dados.diaSemana,
              dia_inteiro: dados.dia_inteiro,
              hora_inicio: dados.hora_inicio,
              hora_fim: dados.hora_fim,
              motivo: dados.motivo,
              motivo_outro: dados.motivo_outro,
            });
            setSerieEditando(null);
          }}
        />
      )}
    </>
  );
}
