import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Trash2, Paperclip, Info } from "lucide-react";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { useSetoresEmpresa } from "@/hooks/useSetoresEmpresa";
import { useBloqueiosAgendaPorUsuarios } from "./useBloqueioAgenda";
import {
  useCriarReuniao, useCriarReunioesRecorrentes, useObservadoresAutomaticos, useUsuariosAtivos,
  bloqueioSobrepoe, verificarBloqueioAgenda, verificarConflitoSala, verificarConflitoParticipante,
} from "./useReunioes";
import {
  COMITES, ETAPA_COR, ETAPA_LABEL, FINALIDADE_LABEL, MOTIVO_BLOQUEIO_LABEL, NOTIFICAR_POR_LABEL, RESULTADO_ESPERADO_LABEL, SALAS_PRESENCIAIS,
  TIPO_REUNIAO_DURACAO_PADRAO, TIPO_REUNIAO_LABEL, TIPO_REUNIAO_OPCOES_CRIACAO, membrosComite, nomeUsuario,
  type Finalidade, type NotificarPor, type ResultadoEsperado, type TipoLocalReuniao, type TipoReuniao,
} from "./types";

const MAX_OCORRENCIAS_RECORRENCIA = 60;
const TITULO_MAX = 150;
const OBJETIVO_MAX = 250;
const JUSTIFICATIVA_MAX = 200;
const ANEXO_MAX_BYTES = 25 * 1024 * 1024;

/** Gera as datas ISO da recorrência semanal: mesma hora da primeira reunião, a cada 7 dias, até repetirAte (inclusive). */
function gerarDatasRecorrencia(dataHoraInicialIso: string, repetirAte: string): string[] {
  const datas: string[] = [];
  const fim = new Date(`${repetirAte}T23:59:59`);
  let atual = new Date(dataHoraInicialIso);
  while (atual <= fim && datas.length < MAX_OCORRENCIAS_RECORRENCIA + 1) {
    datas.push(atual.toISOString());
    atual = new Date(atual.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return datas;
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface PautaRascunho {
  titulo_topico: string;
  descricao: string;
  responsavel_user_id: string | null;
  tempo_previsto_minutos: number | null;
}

function alternarNoArray<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
}

const VAZIO = {
  titulo: "",
  objetivo: "",
  data: "",
  hora: "",
  tipo_reuniao: "" as TipoReuniao | "",
  duracao_minutos: 60,
  finalidade: [] as Finalidade[],
  resultado_esperado: [] as ResultadoEsperado[],
  notificar_por: ["erp"] as NotificarPor[],
  tipo_local: "presencial" as TipoLocalReuniao,
  sala: "",
  local_outro: "",
  local_ou_link: "",
  link_hibrido: "",
  organizador: "",
  responsavel: "",
  setorResponsavel: "",
  convidados: [] as string[],
  observadores: [] as string[],
  repetir: false,
  repetirAte: "",
  alterarDuracao: false,
  justificativaDuracao: "",
};

export function ReuniaoFormCriar({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState(VAZIO);
  const [pauta, setPauta] = useState<PautaRascunho[]>([]);
  const [novoTopico, setNovoTopico] = useState("");
  const [novoTopicoResponsavel, setNovoTopicoResponsavel] = useState("");
  const [novoTopicoTempo, setNovoTopicoTempo] = useState("");
  const [anexos, setAnexos] = useState<File[]>([]);
  const [erroConflito, setErroConflito] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [dataCriacao] = useState(() => new Date());
  const { data: usuarios = [] } = useUsuariosAtivos();
  const { empregado } = useVinculoEmpregado();
  const criar = useCriarReuniao();
  const criarRecorrentes = useCriarReunioesRecorrentes();
  const { data: setoresDisponiveis = [] } = useSetoresEmpresa();

  const opcoesUsuarios = usuarios.map((u) => ({ value: u.id, label: u.display_name ?? "—" }));

  // Aviso ao vivo de agenda bloqueada — junta todo mundo envolvido até agora
  // (organizador, responsável, convidados, observadores) e busca o bloqueio
  // deles de uma vez, recalculando sempre que pessoa ou data/horário mudam.
  const idsRelevantes = useMemo(
    () => [...new Set([form.organizador, form.responsavel, ...form.convidados, ...form.observadores].filter(Boolean))],
    [form.organizador, form.responsavel, form.convidados, form.observadores],
  );
  const { data: bloqueiosRelevantes = [] } = useBloqueiosAgendaPorUsuarios(idsRelevantes);
  const avisosBloqueio = useMemo(() => {
    if (!form.data || !form.hora || form.duracao_minutos <= 0) return [];
    const dataHoraIso = new Date(`${form.data}T${form.hora}:00`).toISOString();
    const avisos: string[] = [];
    for (const id of idsRelevantes) {
      const bloqueio = bloqueiosRelevantes.find((b) => b.user_id === id && bloqueioSobrepoe(b, dataHoraIso, form.duracao_minutos));
      if (bloqueio) {
        const nome = opcoesUsuarios.find((o) => o.value === id)?.label ?? "Alguém";
        avisos.push(`${nome} está com a agenda bloqueada nesse período (${MOTIVO_BLOQUEIO_LABEL[bloqueio.motivo]}).`);
      }
    }
    return avisos;
  }, [idsRelevantes, bloqueiosRelevantes, form.data, form.hora, form.duracao_minutos, opcoesUsuarios]);

  // Aviso de observador automático — não aparece pra escolher em lugar nenhum
  // do formulário (a regra roda no banco, depois de salvar), então avisa aqui
  // pra não confundir quem tá criando. Não conta quem já é organizador/responsável
  // (a regra do banco também não adiciona esses).
  const { data: observadoresAutomaticos = [] } = useObservadoresAutomaticos();
  const TIPOS_COM_OBSERVADOR_AUTOMATICO: TipoReuniao[] = ["comite", "gerencial", "diretoria"];
  const avisoObservadorAutomatico = useMemo(() => {
    if (!form.tipo_reuniao || !TIPOS_COM_OBSERVADOR_AUTOMATICO.includes(form.tipo_reuniao)) return [];
    return observadoresAutomaticos
      .filter((o) => o.user_id !== form.organizador && o.user_id !== form.responsavel)
      .map((o) => o.display_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.tipo_reuniao, form.organizador, form.responsavel, observadoresAutomaticos]);

  // Pré-seleciona o setor do usuário logado quando carrega, mas continua editável.
  useEffect(() => {
    if (empregado?.setor && !form.setorResponsavel) {
      setForm((f) => (f.setorResponsavel ? f : { ...f, setorResponsavel: empregado.setor }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empregado?.setor]);

  const opcoesSetores = [...new Set([...(empregado?.setor ? [empregado.setor] : []), ...setoresDisponiveis])];

  const adicionarTopico = () => {
    if (!novoTopico.trim()) return;
    setPauta((p) => [...p, {
      titulo_topico: novoTopico.trim(),
      descricao: "",
      responsavel_user_id: novoTopicoResponsavel || null,
      tempo_previsto_minutos: novoTopicoTempo ? Number(novoTopicoTempo) : null,
    }]);
    setNovoTopico("");
    setNovoTopicoResponsavel("");
    setNovoTopicoTempo("");
  };

  const adicionarAnexos = (files: FileList | null) => {
    if (!files) return;
    const novos = Array.from(files).filter((f) => {
      if (f.size > ANEXO_MAX_BYTES) {
        setErroConflito(`"${f.name}" excede o tamanho máximo de 25 MB por arquivo.`);
        return false;
      }
      return true;
    });
    if (novos.length > 0) setAnexos((a) => [...a, ...novos]);
  };

  const usaSala = form.tipo_local === "presencial" || form.tipo_local === "hibrido";
  const usaLink = form.tipo_local === "online" || form.tipo_local === "hibrido";

  const localFinal = usaSala ? (form.sala === "Outro" ? form.local_outro.trim() : form.sala) : "";
  const linkFinal = form.tipo_local === "online" ? form.local_ou_link.trim() : form.tipo_local === "hibrido" ? form.link_hibrido.trim() : "";

  const terminoPrevisto = form.data && form.hora && form.duracao_minutos > 0
    ? new Date(new Date(`${form.data}T${form.hora}:00`).getTime() + form.duracao_minutos * 60_000)
    : null;

  const valido =
    form.titulo.trim() &&
    form.objetivo.trim() &&
    form.data &&
    form.hora &&
    form.duracao_minutos > 0 &&
    form.tipo_reuniao &&
    (!usaSala || localFinal) &&
    (!usaLink || linkFinal) &&
    form.organizador &&
    form.responsavel &&
    form.convidados.length > 0 &&
    pauta.length > 0 &&
    (!form.alterarDuracao || form.justificativaDuracao.trim()) &&
    (!form.repetir || (form.repetirAte && form.repetirAte >= form.data));

  const qtdOcorrencias = form.repetir && form.data && form.hora && form.repetirAte && form.repetirAte >= form.data
    ? gerarDatasRecorrencia(new Date(`${form.data}T${form.hora}:00`).toISOString(), form.repetirAte).length
    : null;

  const limpar = () => {
    setForm(VAZIO);
    setPauta([]);
    setAnexos([]);
  };

  const salvar = async () => {
    if (!valido) return;
    setErroConflito("");
    const dataHora = new Date(`${form.data}T${form.hora}:00`).toISOString();
    // Presencial usa "local" como o nome da sala; híbrido também (ocupa sala física); online usa o link.
    const localOuLink = usaSala ? localFinal : linkFinal;

    const base = {
      titulo: form.titulo.trim(),
      objetivo: form.objetivo.trim(),
      duracao_minutos: form.duracao_minutos,
      justificativa_alteracao_duracao: form.alterarDuracao ? form.justificativaDuracao.trim() : null,
      tipo_local: form.tipo_local,
      local_ou_link: localOuLink,
      link_online: form.tipo_local === "hibrido" ? linkFinal : null,
      organizador_user_id: form.organizador,
      responsavel_preenchimento_user_id: form.responsavel,
      tipo_reuniao: form.tipo_reuniao || null,
      finalidade: form.finalidade,
      resultado_esperado: form.resultado_esperado,
      notificar_por: form.notificar_por,
      setor_responsavel: form.setorResponsavel || null,
      pauta,
      convidados: form.convidados,
      observadores: form.observadores,
      anexos,
    };

    if (form.repetir) {
      const datas = gerarDatasRecorrencia(dataHora, form.repetirAte);
      if (datas.length > MAX_OCORRENCIAS_RECORRENCIA) {
        setErroConflito(`Essa recorrência geraria ${datas.length} reuniões — o limite é ${MAX_OCORRENCIAS_RECORRENCIA}. Escolha uma data final mais próxima.`);
        return;
      }
      await criarRecorrentes.mutateAsync({ base, datas });
      limpar();
      onOpenChange(false);
      return;
    }

    setVerificando(true);
    try {
      if (usaSala) {
        const conflito = await verificarConflitoSala({
          local: localFinal,
          dataHoraIso: dataHora,
          duracaoMinutos: form.duracao_minutos,
        });
        if (conflito) {
          setErroConflito(`"${localFinal}" já está reservada nesse horário (reunião "${conflito.titulo}").`);
          return;
        }
      }

      const pessoasAChecar = [
        { userId: form.organizador, rotulo: "O organizador" },
        { userId: form.responsavel, rotulo: "O responsável" },
        ...form.convidados.map((id) => ({ userId: id, rotulo: opcoesUsuarios.find((o) => o.value === id)?.label ?? "Um convidado" })),
        ...form.observadores.map((id) => ({ userId: id, rotulo: opcoesUsuarios.find((o) => o.value === id)?.label ?? "Um observador" })),
      ];
      for (const pessoa of pessoasAChecar) {
        const bloqueio = await verificarBloqueioAgenda({
          userId: pessoa.userId,
          dataHoraIso: dataHora,
          duracaoMinutos: form.duracao_minutos,
        });
        if (bloqueio) {
          setErroConflito(`${pessoa.rotulo} está com a agenda bloqueada nesse horário (${MOTIVO_BLOQUEIO_LABEL[bloqueio.motivo]}).`);
          return;
        }

        const conflito = await verificarConflitoParticipante({
          userId: pessoa.userId,
          dataHoraIso: dataHora,
          duracaoMinutos: form.duracao_minutos,
        });
        if (conflito) {
          setErroConflito(`${pessoa.rotulo} já está em outra reunião nesse horário (reunião "${conflito.titulo}").`);
          return;
        }
      }
    } finally {
      setVerificando(false);
    }

    await criar.mutateAsync({ ...base, data_hora: dataHora });
    limpar();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agendar Reunião</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 1. Identificação */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1. Identificação</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Nº da reunião (automático)</Label>
                <Input value="Gerado automaticamente ao salvar" disabled className="bg-muted text-muted-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label>Data de criação (automático)</Label>
                <Input value={dataCriacao.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} disabled className="bg-muted text-muted-foreground" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Líder responsável *</Label>
                <SearchableSelect
                  value={form.organizador}
                  onChange={(v) => setForm((f) => ({ ...f, organizador: v }))}
                  options={opcoesUsuarios}
                  placeholder="Selecione"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Setor responsável</Label>
                <Select value={form.setorResponsavel} onValueChange={(v) => setForm((f) => ({ ...f, setorResponsavel: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                  <SelectContent>
                    {opcoesSetores.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de reunião *</Label>
              <Select
                value={form.tipo_reuniao}
                onValueChange={(v) => {
                  const tipo = v as TipoReuniao;
                  const duracaoPadrao = TIPO_REUNIAO_DURACAO_PADRAO[tipo];
                  setForm((f) => ({ ...f, tipo_reuniao: tipo, duracao_minutos: duracaoPadrao ?? f.duracao_minutos, alterarDuracao: false, justificativaDuracao: "" }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {TIPO_REUNIAO_OPCOES_CRIACAO.map((t) => (
                    <SelectItem key={t} value={t}>{TIPO_REUNIAO_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Finalidade *</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border p-2.5">
                {(Object.keys(FINALIDADE_LABEL) as Finalidade[]).map((f) => (
                  <label key={f} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={form.finalidade.includes(f)}
                      onCheckedChange={() => setForm((s) => ({ ...s, finalidade: alternarNoArray(s.finalidade, f) }))}
                    />
                    {FINALIDADE_LABEL[f]}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 2. Informações */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2. Informações</p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Título da reunião *</Label>
                <span className="text-xs text-muted-foreground">{form.titulo.length}/{TITULO_MAX}</span>
              </div>
              <Input
                value={form.titulo}
                maxLength={TITULO_MAX}
                onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                placeholder="Ex: Reunião de alinhamento — Diretoria"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Objetivo da reunião *</Label>
                <span className="text-xs text-muted-foreground">{form.objetivo.length}/{OBJETIVO_MAX}</span>
              </div>
              <Textarea
                value={form.objetivo}
                maxLength={OBJETIVO_MAX}
                onChange={(e) => setForm((f) => ({ ...f, objetivo: e.target.value }))}
                className="min-h-16"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Resultado esperado *</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border p-2.5">
                {(Object.keys(RESULTADO_ESPERADO_LABEL) as ResultadoEsperado[]).map((r) => (
                  <label key={r} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={form.resultado_esperado.includes(r)}
                      onCheckedChange={() => setForm((s) => ({ ...s, resultado_esperado: alternarNoArray(s.resultado_esperado, r) }))}
                    />
                    {RESULTADO_ESPERADO_LABEL[r]}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Agendamento */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">3. Agendamento</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Input type="date" value={form.data} onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Horário início *</Label>
                <Input type="time" value={form.hora} onChange={(e) => setForm((f) => ({ ...f, hora: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <Label>Duração prevista *</Label>
                  <Info className="h-3 w-3 text-muted-foreground" aria-label="Preenchido automaticamente de acordo com o tipo de reunião." />
                </div>
                <Input
                  type="number"
                  min={5}
                  step={5}
                  disabled={!form.alterarDuracao}
                  value={form.duracao_minutos}
                  onChange={(e) => setForm((f) => ({ ...f, duracao_minutos: Number(e.target.value) || 0 }))}
                  className={!form.alterarDuracao ? "bg-muted" : undefined}
                />
                {!form.alterarDuracao && (
                  <p className="text-xs text-muted-foreground">Preenchido automaticamente de acordo com o tipo de reunião.</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label htmlFor="alterar-duracao">Alterar duração</Label>
              <Switch
                id="alterar-duracao"
                checked={form.alterarDuracao}
                onCheckedChange={(v) => setForm((f) => ({ ...f, alterarDuracao: v, justificativaDuracao: v ? f.justificativaDuracao : "" }))}
              />
            </div>

            {form.alterarDuracao && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Justificativa da alteração *</Label>
                  <span className="text-xs text-muted-foreground">{form.justificativaDuracao.length}/{JUSTIFICATIVA_MAX}</span>
                </div>
                <Textarea
                  value={form.justificativaDuracao}
                  maxLength={JUSTIFICATIVA_MAX}
                  onChange={(e) => setForm((f) => ({ ...f, justificativaDuracao: e.target.value }))}
                  className="min-h-12"
                  placeholder="Ex: Reunião estendida devido à inclusão de pauta adicional."
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Término previsto</Label>
              <Input
                disabled
                className="bg-muted text-muted-foreground"
                value={terminoPrevisto ? terminoPrevisto.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
              />
            </div>

            <div className="grid grid-cols-[160px_1fr] gap-4">
              <div className="space-y-1.5">
                <Label>Local / Modalidade *</Label>
                <Select
                  value={form.tipo_local}
                  onValueChange={(v) => setForm((f) => ({ ...f, tipo_local: v as TipoLocalReuniao, sala: "", local_outro: "", local_ou_link: "", link_hibrido: "" }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="presencial">Presencial</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="hibrido">Híbrido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                {usaSala && (
                  <>
                    <Label>Sala *</Label>
                    <Select value={form.sala} onValueChange={(v) => setForm((f) => ({ ...f, sala: v }))}>
                      <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                      <SelectContent>
                        {SALAS_PRESENCIAIS.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.sala === "Outro" && (
                      <Input
                        className="mt-1.5"
                        value={form.local_outro}
                        onChange={(e) => setForm((f) => ({ ...f, local_outro: e.target.value }))}
                        placeholder="Descreva"
                      />
                    )}
                  </>
                )}
                {usaLink && (
                  <>
                    <Label>Link da reunião *</Label>
                    <Input
                      className={usaSala ? "mt-1.5" : undefined}
                      value={form.tipo_local === "hibrido" ? form.link_hibrido : form.local_ou_link}
                      onChange={(e) => setForm((f) => (
                        f.tipo_local === "hibrido" ? { ...f, link_hibrido: e.target.value } : { ...f, local_ou_link: e.target.value }
                      ))}
                      placeholder="Ex: https://meet.google.com/..."
                    />
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="repetir-semanal">Repetição semanal</Label>
                <Switch
                  id="repetir-semanal"
                  checked={form.repetir}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, repetir: v }))}
                />
              </div>
              {form.repetir && (
                <div className="space-y-1.5 pt-1.5">
                  <Label>Repetir até *</Label>
                  <Input type="date" value={form.repetirAte} min={form.data || undefined} onChange={(e) => setForm((f) => ({ ...f, repetirAte: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">
                    Cria uma reunião toda semana, no mesmo dia e horário, até essa data.
                  </p>
                </div>
              )}
            </div>
          </div>

          {erroConflito && (
            <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{erroConflito}</p>
          )}

          {/* 4. Participantes */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">4. Participantes</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Responsável pela ata *</Label>
                <SearchableSelect
                  value={form.responsavel}
                  onChange={(v) => setForm((f) => ({ ...f, responsavel: v }))}
                  options={opcoesUsuarios}
                  placeholder="Quem vai preencher as respostas após a reunião"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Organizador *</Label>
                <SearchableSelect
                  value={form.organizador}
                  onChange={(v) => setForm((f) => ({ ...f, organizador: v }))}
                  options={opcoesUsuarios}
                  placeholder="Quem lidera a reunião"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Convidados *</Label>
                  <div className="flex items-center gap-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="text-xs text-primary hover:underline">Selecionar Comitês</button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {COMITES.map((comite) => {
                          const membros = membrosComite(usuarios, comite.membros).filter((id) => !form.observadores.includes(id));
                          const todosDentro = membros.length > 0 && membros.every((id) => form.convidados.includes(id));
                          return (
                            <DropdownMenuCheckboxItem
                              key={comite.id}
                              checked={todosDentro}
                              onCheckedChange={() => setForm((f) => ({
                                ...f,
                                convidados: todosDentro
                                  ? f.convidados.filter((id) => !membros.includes(id))
                                  : [...new Set([...f.convidados, ...membros])],
                              }))}
                            >
                              {comite.label} ({membros.length})
                            </DropdownMenuCheckboxItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setForm((f) => {
                        const todos = opcoesUsuarios.filter((o) => !f.observadores.includes(o.value)).map((o) => o.value);
                        const jaTemTodos = todos.length > 0 && todos.every((v) => f.convidados.includes(v));
                        return { ...f, convidados: jaTemTodos ? [] : todos };
                      })}
                    >
                      {opcoesUsuarios.filter((o) => !form.observadores.includes(o.value)).every((o) => form.convidados.includes(o.value)) && form.convidados.length > 0
                        ? "Limpar seleção"
                        : "Selecionar todos"}
                    </button>
                  </div>
                </div>
                <SearchableMultiSelect
                  value={form.convidados}
                  onChange={(v) => setForm((f) => ({ ...f, convidados: v }))}
                  options={opcoesUsuarios.filter((o) => !form.observadores.includes(o.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Observadores (opcional)</Label>
                <SearchableMultiSelect
                  value={form.observadores}
                  onChange={(v) => setForm((f) => ({ ...f, observadores: v }))}
                  options={opcoesUsuarios.filter((o) => !form.convidados.includes(o.value))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notificar por *</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border p-2.5">
                {(Object.keys(NOTIFICAR_POR_LABEL) as NotificarPor[]).map((n) => (
                  <label key={n} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={form.notificar_por.includes(n)}
                      onCheckedChange={() => setForm((s) => ({ ...s, notificar_por: alternarNoArray(s.notificar_por, n) }))}
                    />
                    {NOTIFICAR_POR_LABEL[n]}
                  </label>
                ))}
              </div>
            </div>

            {avisosBloqueio.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                {avisosBloqueio.map((aviso, i) => <p key={i}>⚠️ {aviso}</p>)}
              </div>
            )}

            {avisoObservadorAutomatico.length > 0 && (
              <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-2.5 text-xs text-blue-800 dark:text-blue-300">
                <p>
                  ℹ️ {avisoObservadorAutomatico.join(", ")} {avisoObservadorAutomatico.length > 1 ? "serão adicionados(as)" : "será adicionado(a)"} automaticamente
                  {" "}como observador(a) — regra pra reuniões desse tipo. Não precisa selecionar manualmente.
                </p>
              </div>
            )}
          </div>

          {/* 5. Pauta */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">5. Pauta *</p>
            <div className="space-y-2">
              {pauta.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="p-2">Ordem</th>
                        <th className="p-2">Item de pauta</th>
                        <th className="p-2">Responsável</th>
                        <th className="p-2">Tempo previsto</th>
                        <th className="w-8 p-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {pauta.map((p, i) => (
                        <tr key={i} className="border-b border-border last:border-b-0">
                          <td className="p-2">{i + 1}</td>
                          <td className="p-2">{p.titulo_topico}</td>
                          <td className="p-2">{nomeUsuario(usuarios, p.responsavel_user_id) ?? "—"}</td>
                          <td className="p-2">{p.tempo_previsto_minutos ? `${p.tempo_previsto_minutos} min` : "—"}</td>
                          <td className="p-2">
                            <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setPauta((arr) => arr.filter((_, idx) => idx !== i))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                <Input
                  placeholder="Novo item de pauta"
                  value={novoTopico}
                  onChange={(e) => setNovoTopico(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarTopico())}
                />
                <div className="grid grid-cols-2 gap-2">
                  <SearchableSelect
                    value={novoTopicoResponsavel}
                    onChange={setNovoTopicoResponsavel}
                    options={opcoesUsuarios}
                    placeholder="Responsável (opcional)"
                  />
                  <Input
                    type="number"
                    min={5}
                    step={5}
                    placeholder="Tempo previsto (min)"
                    value={novoTopicoTempo}
                    onChange={(e) => setNovoTopicoTempo(e.target.value)}
                  />
                </div>
                <Button type="button" variant="outline" className="w-full gap-1" onClick={adicionarTopico}>
                  <Plus className="h-4 w-4" /> Adicionar item de pauta
                </Button>
              </div>
            </div>
          </div>

          {/* 6. Anexos */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">6. Anexos</p>
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-border p-4 text-center hover:bg-accent/40">
              <Paperclip className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm">Clique para selecionar arquivos</span>
              <span className="text-xs text-muted-foreground">Tamanho máximo: 25 MB por arquivo</span>
              <input type="file" multiple className="hidden" onChange={(e) => { adicionarAnexos(e.target.files); e.target.value = ""; }} />
            </label>
            {anexos.length > 0 && (
              <div className="space-y-1">
                {anexos.map((f, i) => (
                  <div key={i} className="flex items-center justify-between rounded border border-border px-3 py-1.5 text-sm">
                    <span className="truncate">{f.name} <span className="text-xs text-muted-foreground">({formatarBytes(f.size)})</span></span>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAnexos((a) => a.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 7. Status */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">7. Status</p>
            <Badge variant="outline" className={ETAPA_COR.agendada}>{ETAPA_LABEL.agendada}</Badge>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={!valido || criar.isPending || criarRecorrentes.isPending || verificando}>
            {verificando
              ? "Verificando conflitos…"
              : criar.isPending || criarRecorrentes.isPending
              ? "Agendando…"
              : qtdOcorrencias !== null
              ? `Agendar ${qtdOcorrencias} reuniões`
              : "Agendar reunião"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
