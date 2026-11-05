import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, ImagePlus, Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Agendamento } from "@/hooks/useAgendamentoVeiculos";
import { abrirFotoChecklist, linkFotoChecklist, useSalvarChecklist } from "@/hooks/useChecklistVeiculo";
import {
  FOTOS_INTERIOR_EXIGIDAS, FOTOS_UNICAS, LABEL_TIPO_CHECKLIST, camposFaltando,
  type ChecklistVeiculo, type TipoChecklist,
} from "@/lib/checklistVeiculo";

// =====================================================================
// Checklist de SAÍDA / CHEGADA (04/11/2026) — o formulário antigo
// "Checklist Veículos Retorno" dentro do agendamento.
//
// Não pergunta o que o sistema sabe: condutor = quem agendou, veículo = o
// do agendamento. Data e horário nascem com agora (editável). Dá para salvar
// pela metade — cada foto já enviada fica —, e o card mostra "incompleto"
// até chegar a última. O KM daqui alimenta o KM da viagem (inicial na saída,
// final na chegada) quando ele ainda estiver vazio.
// =====================================================================

const agoraLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const isoParaLocal = (iso: string | null | undefined) => {
  if (!iso) return agoraLocal();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return agoraLocal();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

interface Props {
  agendamento: Agendamento | null;
  tipo: TipoChecklist;
  checklist: ChecklistVeiculo | null;
  aberto: boolean;
  onFechar: () => void;
  /** Quem agendou ou quem gerencia a frota. Os demais só veem. */
  podeEditar: boolean;
}

export function ChecklistDialog({ agendamento, tipo, checklist, aberto, onFechar, podeEditar }: Props) {
  const salvar = useSalvarChecklist();
  const [realizadoEm, setRealizadoEm] = useState(agoraLocal());
  const [km, setKm] = useState("");
  const [observacao, setObservacao] = useState("");
  const [novasUnicas, setNovasUnicas] = useState<Record<string, File>>({});
  const [interiorMantidas, setInteriorMantidas] = useState<string[]>([]);
  const [interiorNovas, setInteriorNovas] = useState<File[]>([]);
  const [defeitoMantidas, setDefeitoMantidas] = useState<string[]>([]);
  const [defeitoNovas, setDefeitoNovas] = useState<File[]>([]);

  // Ao abrir, parte do que já foi salvo.
  useEffect(() => {
    if (!aberto) return;
    setRealizadoEm(isoParaLocal(checklist?.realizado_em));
    setKm(checklist?.km != null ? String(checklist.km) : "");
    setObservacao(checklist?.observacao ?? "");
    setNovasUnicas({});
    setInteriorMantidas(checklist?.fotos_interior ?? []);
    setInteriorNovas([]);
    setDefeitoMantidas(checklist?.fotos_defeito ?? []);
    setDefeitoNovas([]);
  }, [aberto, checklist]);

  // O que vai ficar depois de salvar — é sobre isso que "o que falta" fala.
  const previsto: ChecklistVeiculo | null = useMemo(() => {
    if (!agendamento) return null;
    const unica = (campo: keyof ChecklistVeiculo) =>
      novasUnicas[campo as string] ? "novo" : ((checklist?.[campo] as string | null | undefined) ?? null);
    return {
      agendamento_id: agendamento.id,
      tipo,
      foto_lateral_direita: unica("foto_lateral_direita"),
      foto_lateral_esquerda: unica("foto_lateral_esquerda"),
      foto_dianteira: unica("foto_dianteira"),
      foto_traseira: unica("foto_traseira"),
      foto_km: unica("foto_km"),
      fotos_interior: [...interiorMantidas, ...interiorNovas.map((f) => f.name)],
    };
  }, [agendamento, tipo, checklist, novasUnicas, interiorMantidas, interiorNovas]);
  const falta = camposFaltando(previsto);

  const mudou =
    Object.keys(novasUnicas).length > 0 || interiorNovas.length > 0 || defeitoNovas.length > 0 ||
    interiorMantidas.length !== (checklist?.fotos_interior?.length ?? 0) ||
    defeitoMantidas.length !== (checklist?.fotos_defeito?.length ?? 0) ||
    km !== (checklist?.km != null ? String(checklist.km) : "") ||
    observacao !== (checklist?.observacao ?? "") ||
    // Só a data não cria checklist novo (viraria um "incompleto" vazio).
    (!!checklist && realizadoEm !== isoParaLocal(checklist.realizado_em));

  const enviar = async () => {
    if (!agendamento) return;
    await salvar.mutateAsync({
      agendamentoId: agendamento.id,
      tipo,
      realizadoEm,
      km: km ? Number(km) : null,
      observacao,
      novasUnicas,
      interiorMantidas,
      interiorNovas,
      defeitoMantidas,
      defeitoNovas,
    });
    onFechar();
  };

  const totalInterior = interiorMantidas.length + interiorNovas.length;
  const ehSaida = tipo === "saida";

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            {LABEL_TIPO_CHECKLIST[tipo]}
            {agendamento && <span className="font-normal text-muted-foreground">· nº {agendamento.numero}</span>}
          </DialogTitle>
          <DialogDescription>
            {ehSaida
              ? "Antes de sair com o carro: fotos de fora, de dentro e do painel."
              : "Ao devolver o carro: fotos de fora, de dentro e do KM final."}
          </DialogDescription>
        </DialogHeader>

        {agendamento && (
          <div className="space-y-5">
            {/* Condutor e veículo vêm do agendamento — não são perguntas. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Info rotulo="Condutor" valor={checklist?.condutor_nome ?? agendamento.solicitante_nome ?? "—"} />
              <Info
                rotulo="Veículo"
                valor={`${agendamento.veiculo_nome}${agendamento.veiculo_identificador ? ` · ${agendamento.veiculo_identificador}` : ""}`}
              />
              <div className="space-y-1">
                <Label htmlFor="ck-quando" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Data e horário
                </Label>
                <Input id="ck-quando" type="datetime-local" value={realizadoEm} disabled={!podeEditar}
                       onChange={(e) => setRealizadoEm(e.target.value)} className="h-9" />
              </div>
            </div>

            <section className="space-y-2">
              <h4 className="text-sm font-bold">Fotos externas</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {FOTOS_UNICAS.map((f) => (
                  <SlotFoto
                    key={f.campo}
                    id={`ck-${tipo}-${f.campo}`}
                    rotulo={f.rotulo}
                    salvo={checklist?.[f.campo] ?? null}
                    novo={novasUnicas[f.campo] ?? null}
                    podeEditar={podeEditar}
                    onEscolher={(file) => setNovasUnicas((m) => ({ ...m, [f.campo]: file }))}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold">
                  Fotos do interior <span className="font-normal text-muted-foreground">({Math.min(totalInterior, FOTOS_INTERIOR_EXIGIDAS)} de {FOTOS_INTERIOR_EXIGIDAS})</span>
                </h4>
                {podeEditar && (
                  <BotaoArquivos id={`ck-${tipo}-interior`} rotulo="Adicionar fotos" onEscolher={(fs) => setInteriorNovas((l) => [...l, ...fs])} />
                )}
              </div>
              <ListaFotos
                salvas={interiorMantidas}
                novas={interiorNovas}
                podeEditar={podeEditar}
                onTirarSalva={(p) => setInteriorMantidas((l) => l.filter((x) => x !== p))}
                onTirarNova={(i) => setInteriorNovas((l) => l.filter((_, j) => j !== i))}
                vazio="Nenhuma foto do interior ainda."
              />
            </section>

            <section className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-500/10">
              <h4 className="text-sm font-bold">{ehSaida ? "KM inicial" : "KM final"} (painel)</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <SlotFoto
                  id={`ck-${tipo}-foto_km`}
                  rotulo="Foto do KM"
                  salvo={checklist?.foto_km ?? null}
                  novo={novasUnicas.foto_km ?? null}
                  podeEditar={podeEditar}
                  onEscolher={(file) => setNovasUnicas((m) => ({ ...m, foto_km: file }))}
                />
                <div className="space-y-1.5">
                  <Label htmlFor={`ck-${tipo}-km`}>KM do painel (número)</Label>
                  <Input id={`ck-${tipo}-km`} inputMode="numeric" value={km} disabled={!podeEditar}
                         placeholder="Ex.: 84512" onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))} />
                  <p className="text-[11px] text-muted-foreground">
                    Vai também para o {ehSaida ? "KM inicial" : "KM final"} da viagem, se ainda não estiver lá.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold">
                  Defeito não listado no histórico <span className="font-normal text-muted-foreground">(opcional)</span>
                </h4>
                {podeEditar && (
                  <BotaoArquivos id={`ck-${tipo}-defeito`} rotulo="Adicionar foto" onEscolher={(fs) => setDefeitoNovas((l) => [...l, ...fs])} />
                )}
              </div>
              <ListaFotos
                salvas={defeitoMantidas}
                novas={defeitoNovas}
                podeEditar={podeEditar}
                onTirarSalva={(p) => setDefeitoMantidas((l) => l.filter((x) => x !== p))}
                onTirarNova={(i) => setDefeitoNovas((l) => l.filter((_, j) => j !== i))}
                vazio="Nenhum defeito registrado."
              />
              <Textarea rows={2} value={observacao} disabled={!podeEditar}
                        placeholder="Descreva o defeito ou algo que a frota precise saber."
                        onChange={(e) => setObservacao(e.target.value)} />
            </section>

            {falta.length > 0 ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Para o checklist ficar <b>preenchido</b>, falta: {falta.join(", ")}. Dá para salvar assim e completar depois.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" /> Tudo certo — o checklist fica preenchido ao salvar.
                {!ehSaida && " A viagem também é finalizada."}
              </div>
            )}

            {checklist?.preenchido_por_nome && (
              <p className="text-[11px] text-muted-foreground">
                Última atualização por {checklist.preenchido_por_nome}
                {checklist.realizado_em && ` · data/hora do checklist: ${new Date(checklist.realizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`}
              </p>
            )}
          </div>
        )}

        {podeEditar && (
          <DialogFooter>
            <Button variant="outline" onClick={onFechar}>Fechar</Button>
            <Button className="gap-1.5" disabled={!mudou || salvar.isPending} onClick={enviar}>
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {salvar.isPending ? "Enviando fotos…" : "Salvar checklist"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="truncate text-sm font-semibold text-foreground">{valor}</p>
    </div>
  );
}

function Miniatura({ path }: { path: string }) {
  const q = useQuery({
    queryKey: ["cs_veiculo_checklist_foto", path],
    queryFn: () => linkFotoChecklist(path),
    staleTime: 50 * 60_000,
    retry: false,
  });
  return (
    <button type="button" onClick={() => abrirFotoChecklist(path)}
            className="block h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted"
            title="Abrir foto">
      {q.data ? <img src={q.data} alt="" className="h-full w-full object-cover" /> : <Camera className="m-auto h-5 w-5 text-muted-foreground" />}
    </button>
  );
}

function SlotFoto({ id, rotulo, salvo, novo, podeEditar, onEscolher }: {
  id: string; rotulo: string; salvo: string | null; novo: File | null; podeEditar: boolean; onEscolher: (f: File) => void;
}) {
  const ok = !!(salvo || novo);
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-2.5", ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-dashed border-border")}>
      {salvo && !novo ? <Miniatura path={salvo} /> : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-muted">
          {novo ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Camera className="h-5 w-5 text-muted-foreground" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{rotulo}</p>
        <p className="truncate text-xs text-muted-foreground">
          {novo ? `${novo.name} (a enviar)` : salvo ? "Enviada" : "Pendente"}
        </p>
      </div>
      {podeEditar && (
        <>
          <label htmlFor={id} className="cursor-pointer rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted/50">
            {ok ? "Trocar" : "Tirar foto"}
          </label>
          <input id={id} type="file" accept="image/*" capture="environment" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onEscolher(f); e.target.value = ""; }} />
        </>
      )}
    </div>
  );
}

function BotaoArquivos({ id, rotulo, onEscolher }: { id: string; rotulo: string; onEscolher: (fs: File[]) => void }) {
  return (
    <>
      <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted/50">
        <ImagePlus className="h-3.5 w-3.5" /> {rotulo}
      </label>
      <input id={id} type="file" accept="image/*" multiple className="hidden"
             onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onEscolher(fs); e.target.value = ""; }} />
    </>
  );
}

function ListaFotos({ salvas, novas, podeEditar, onTirarSalva, onTirarNova, vazio }: {
  salvas: string[]; novas: File[]; podeEditar: boolean;
  onTirarSalva: (p: string) => void; onTirarNova: (i: number) => void; vazio: string;
}) {
  if (!salvas.length && !novas.length) return <p className="text-xs text-muted-foreground">{vazio}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {salvas.map((p) => (
        <div key={p} className="relative">
          <Miniatura path={p} />
          {podeEditar && (
            <button type="button" onClick={() => onTirarSalva(p)} title="Tirar"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {novas.map((f, i) => (
        <div key={`${f.name}-${i}`} className="relative flex h-14 w-24 items-center justify-center rounded-md border border-emerald-500/40 bg-emerald-500/5 px-1 text-center text-[10px] text-muted-foreground">
          <span className="line-clamp-3 break-all">{f.name}</span>
          <button type="button" onClick={() => onTirarNova(i)} title="Tirar"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
