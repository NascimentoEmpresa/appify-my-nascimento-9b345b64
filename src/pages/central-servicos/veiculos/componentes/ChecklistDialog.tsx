import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, Gauge, ImagePlus, Loader2, Lock, Save, Video, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Agendamento } from "@/hooks/useAgendamentoVeiculos";
import {
  VIDEO_MAX_MB, abrirFotoChecklist, linkFotoChecklist, usePrestacoesPendentes, useSalvarChecklist, useUltimoKm,
} from "@/hooks/useChecklistVeiculo";
import { faltandoPrestacao } from "@/lib/veiculos/rotaDoDia";
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
//
// 10/11/2026 (mig 20261110220000, pedido do Senilton):
//   · SAÍDA = início da viagem. Só sai com a viagem anterior do responsável
//     com a prestação completa (o banco barra; aqui a tela mostra o que falta
//     e não deixa salvar). O KM passa a ser obrigatório, e a tela mostra o
//     último KM informado do carro — se não bate, fica registrado como KM
//     rodado sem agendamento/checklist.
//   · CHEGADA ganha a prestação: vídeo completo do veículo, água e óleo
//     verificados, avaria (sim/não + descrição) e "não abasteci" (quando não
//     há nota de combustível).
//
// 12/11/2026 (mig 20261112173000, Senilton): SAÍDA ganha a marcação
// obrigatória "Revisão de água e óleo OK" (o banco recusa sem ela); na
// CHEGADA o vídeo virou opcional e água/óleo saíram de lá. O abastecimento
// passou a ser a pergunta "Houve abastecimento?" no modal da viagem — o
// "não abasteci" daqui continua valendo como Não.
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
  // Prestação (chegada)
  const [videoNovo, setVideoNovo] = useState<File | null>(null);
  const [agua, setAgua] = useState(false);
  const [oleo, setOleo] = useState(false);
  const [avaria, setAvaria] = useState<boolean | null>(null);
  const [avariaDesc, setAvariaDesc] = useState("");
  const [semAbastecimento, setSemAbastecimento] = useState(false);

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
    setVideoNovo(null);
    setAgua(!!checklist?.agua_verificada);
    setOleo(!!checklist?.oleo_verificado);
    setAvaria(checklist?.avaria ?? null);
    setAvariaDesc(checklist?.avaria_descricao ?? "");
    setSemAbastecimento(!!agendamento?.sem_abastecimento);
  }, [aberto, checklist, agendamento]);

  const ehSaidaAqui = tipo === "saida";
  const exige = agendamento?.prestacao_exigida !== false;
  // Início da viagem: a anterior do responsável tem que estar completa.
  const iniciando = ehSaidaAqui && !checklist && agendamento?.km_inicial == null && exige;
  const pend = usePrestacoesPendentes(agendamento?.solicitante_id, agendamento?.id, aberto && iniciando);
  const bloqueado = iniciando && (pend.data?.length ?? 0) > 0;
  const ultimoKm = useUltimoKm(aberto && ehSaidaAqui ? agendamento?.patrimonio_id : null, agendamento?.id);
  // Nota de combustível da viagem (a prestação aceita nota OU "não abasteci").
  const notas = useQuery({
    queryKey: ["cs_veiculo_abastecimento_qtd", agendamento?.id],
    enabled: aberto && !ehSaidaAqui && !!agendamento,
    staleTime: 30_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase as any).from("cs_veiculo_abastecimento").select("id", { count: "exact", head: true }).eq("agendamento_id", agendamento!.id);
      return count ?? 0;
    },
  });

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
  const kmNum = km ? Number(km) : null;
  const kmDif = ehSaidaAqui && kmNum != null && ultimoKm.data ? kmNum - ultimoKm.data.km : null;
  const faltaPrestacao = !ehSaidaAqui && agendamento && exige
    ? faltandoPrestacao(
        {
          km_inicial: agendamento.km_inicial ?? null, km_final: agendamento.km_final ?? (kmNum ?? null), sem_abastecimento: semAbastecimento,
          // Desmarcar "não abasteci" depois de responder Não volta a "sem resposta" (trigger do banco).
          houve_abastecimento: semAbastecimento ? false : agendamento.houve_abastecimento === false ? null : agendamento.houve_abastecimento ?? null,
        },
        { avaria, avaria_descricao: avariaDesc },
        (notas.data ?? 0) > 0)
    : [];
  // Revisão de água e óleo OK: obrigatória no checklist de SAÍDA desde
  // 12/11/2026 (o banco recusa — trg_cs_veic_checklist_agua_oleo). Checklist
  // de saída antigo (agua_oleo_exigido = false) não é cobrado.
  const aguaOleoObrigatorio = ehSaidaAqui && exige && (checklist ? checklist.agua_oleo_exigido !== false : true);
  const aguaOleoFaltando = aguaOleoObrigatorio && !(agua && oleo);

  const mudou =
    Object.keys(novasUnicas).length > 0 || interiorNovas.length > 0 || defeitoNovas.length > 0 ||
    interiorMantidas.length !== (checklist?.fotos_interior?.length ?? 0) ||
    defeitoMantidas.length !== (checklist?.fotos_defeito?.length ?? 0) ||
    km !== (checklist?.km != null ? String(checklist.km) : "") ||
    observacao !== (checklist?.observacao ?? "") ||
    // Só a data não cria checklist novo (viraria um "incompleto" vazio).
    (!!checklist && realizadoEm !== isoParaLocal(checklist.realizado_em)) ||
    !!videoNovo || agua !== !!checklist?.agua_verificada || oleo !== !!checklist?.oleo_verificado ||
    avaria !== (checklist?.avaria ?? null) || avariaDesc !== (checklist?.avaria_descricao ?? "") ||
    semAbastecimento !== !!agendamento?.sem_abastecimento;
  const kmObrigatorioFaltando = iniciando && !km;

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
      videoNovo,
      // Água e óleo moraram na chegada até 12/11/2026; agora a marcação é da saída.
      extra: ehSaidaAqui ? { agua_verificada: agua, oleo_verificado: oleo } : {
        ...(avaria !== null ? { avaria, avaria_descricao: avariaDesc } : {}),
        sem_abastecimento: semAbastecimento,
      },
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

        {agendamento && bloqueado && (
          <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-bold text-destructive"><Lock className="h-4 w-4" /> Não dá para iniciar esta viagem ainda</p>
            <p className="text-muted-foreground">
              {agendamento.solicitante_nome ?? "O responsável"} tem viagem anterior sem a prestação completa. Complete em Meus Agendamentos
              (checklist de chegada e Viagem) — ou marque "Não usei o carro no dia", se não usou.
            </p>
            <ul className="space-y-1">
              {pend.data!.map((p) => (
                <li key={p.agendamento_id} className="rounded-lg bg-background/80 px-2.5 py-1.5">
                  <b>nº {p.numero}</b> · {p.veiculo}{p.placa ? ` ${p.placa}` : ""} · {p.data_inicio.split("-").reverse().join("/")}
                  {!p.iniciada && <span className="text-amber-700 dark:text-amber-300"> · não iniciada</span>}
                  <span className="block text-xs text-destructive">Falta: {p.faltando.join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {agendamento && (
          <div className={cn("space-y-5", bloqueado && "pointer-events-none opacity-50")}>
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
              <h4 className="text-sm font-bold">{ehSaida ? "KM inicial" : "KM final"} (painel){iniciando && <span className="text-destructive"> *</span>}</h4>
              {ehSaida && (
                <p className="flex items-start gap-2 rounded-lg bg-background/70 px-2.5 py-2 text-xs">
                  <Gauge className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  {ultimoKm.isLoading ? "Buscando o último KM do carro…" : ultimoKm.data ? (
                    <span>
                      Último KM informado deste carro: <b>{ultimoKm.data.km.toLocaleString("pt-BR")} km</b>
                      {" "}({ultimoKm.data.momento === "retorno" ? "retorno" : "saída"} da viagem nº {ultimoKm.data.numero}
                      {ultimoKm.data.condutor ? `, ${ultimoKm.data.condutor}` : ""}, {new Date(ultimoKm.data.em).toLocaleDateString("pt-BR")}).
                      {" "}Digite o KM que está no painel agora.
                    </span>
                  ) : <span>Sem KM anterior registrado para este carro.</span>}
                </p>
              )}
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
                  {kmDif != null && kmDif > 0 && (
                    <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      {kmDif.toLocaleString("pt-BR")} km a mais que o último registro: fica anotado como KM rodado sem agendamento/checklist.
                    </p>
                  )}
                  {kmDif != null && kmDif < 0 && (
                    <p className="text-[11px] font-semibold text-destructive">Menor que o último KM registrado — confira o número.</p>
                  )}
                </div>
              </div>
            </section>

            {ehSaida && (
              <label className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium",
                aguaOleoFaltando ? "border-amber-300 bg-amber-50/60 dark:bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/5")}>
                <Checkbox checked={agua && oleo} disabled={!podeEditar} aria-label="Revisão de água e óleo OK"
                          onCheckedChange={(x) => { setAgua(x === true); setOleo(x === true); }} />
                Revisão de água e óleo OK{aguaOleoObrigatorio && <span className="text-destructive"> *</span>}
              </label>
            )}

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

            {!ehSaida && (
              <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <h4 className="text-sm font-bold">Prestação da viagem {exige && <span className="font-normal text-muted-foreground">(obrigatória para o próximo agendamento sair)</span>}</h4>
                {/* Vídeo opcional desde 12/11/2026; água e óleo foram para a saída. */}
                <SlotVideo id={`ck-${tipo}-video`} salvo={checklist?.video_veiculo ?? null} novo={videoNovo} podeEditar={podeEditar}
                  onEscolher={(f) => setVideoNovo(f)} />
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">O veículo tem alguma possível avaria?</p>
                  <div className="flex gap-2" role="radiogroup" aria-label="Possível avaria">
                    {([[false, "Não"], [true, "Sim"]] as const).map(([v, r]) => (
                      <button key={r} type="button" role="radio" aria-checked={avaria === v} disabled={!podeEditar} onClick={() => setAvaria(v)}
                        className={cn("h-9 rounded-lg border px-4 text-sm font-semibold", avaria === v ? (v ? "border-destructive bg-destructive/10 text-destructive" : "border-emerald-600 bg-emerald-600/10 text-emerald-700") : "border-border bg-background")}>
                        {r}
                      </button>
                    ))}
                  </div>
                  {avaria && (
                    <Textarea rows={2} value={avariaDesc} disabled={!podeEditar} placeholder="Descreva a avaria (o que, onde). Fotos em 'Defeito não listado'."
                      onChange={(e) => setAvariaDesc(e.target.value)} aria-label="Descrição da avaria" />
                  )}
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={semAbastecimento} disabled={!podeEditar} onCheckedChange={(v) => setSemAbastecimento(v === true)} className="mt-0.5" aria-label="Não abasteci nesta viagem" />
                  <span>Não abasteci nesta viagem <span className="block text-xs text-muted-foreground">
                    {(notas.data ?? 0) > 0 ? `${notas.data} nota(s) de combustível anexada(s).` : "Se abasteceu, responda Sim em Viagem › Houve abastecimento? e anexe a foto da nota."}</span></span>
                </label>
                {exige && (faltaPrestacao.length > 0 ? (
                  <p className="text-xs text-amber-800 dark:text-amber-300"><b>Falta na prestação:</b> {faltaPrestacao.join(", ")}.</p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Prestação completa.</p>
                ))}
              </section>
            )}

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
            {kmObrigatorioFaltando && !bloqueado && <span className="mr-auto self-center text-xs text-destructive">Informe o KM do painel para iniciar.</span>}
            {!kmObrigatorioFaltando && aguaOleoFaltando && !bloqueado && <span className="mr-auto self-center text-xs text-destructive">Marque a revisão de água e óleo OK.</span>}
            <Button className="gap-1.5" disabled={!mudou || salvar.isPending || bloqueado || kmObrigatorioFaltando || aguaOleoFaltando} onClick={enviar}>
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

function SlotVideo({ id, salvo, novo, podeEditar, onEscolher }: {
  id: string; salvo: string | null; novo: File | null; podeEditar: boolean; onEscolher: (f: File) => void;
}) {
  const ok = !!(salvo || novo);
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-2.5", ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-dashed border-border bg-background")}>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-muted">
        {ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Video className="h-5 w-5 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Vídeo completo do veículo <span className="font-normal text-muted-foreground">(opcional)</span></p>
        <p className="truncate text-xs text-muted-foreground">
          {novo ? `${novo.name} (${(novo.size / 1048576).toFixed(0)} MB, a enviar)` : salvo ? (
            <button type="button" className="font-semibold text-primary underline" onClick={() => abrirFotoChecklist(salvo)}>Enviado — assistir</button>
          ) : `Dê a volta no carro filmando (até ${VIDEO_MAX_MB} MB).`}
        </p>
      </div>
      {podeEditar && (
        <>
          <label htmlFor={id} className="cursor-pointer rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted/50">
            {ok ? "Trocar" : "Gravar vídeo"}
          </label>
          <input id={id} type="file" accept="video/*" capture="environment" className="hidden"
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
