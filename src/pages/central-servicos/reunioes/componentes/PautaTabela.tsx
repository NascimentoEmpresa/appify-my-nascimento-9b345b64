import { useMemo, useState } from "react";
import {
  DndContext, type DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { GripVertical, Paperclip, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { nomeUsuario, PAUTA_STATUS_COR, PAUTA_STATUS_LABEL, type PautaStatus, type ReuniaoPauta, type ReuniaoPautaAnexo, type ReuniaoResposta, type Usuario } from "../types";

const MAX_ANEXOS_POR_PAUTA = 5;
const MAX_TAMANHO_ANEXO_MB = 10;

interface Props {
  pauta: ReuniaoPauta[];
  respostas: ReuniaoResposta[];
  pautaAnexos: ReuniaoPautaAnexo[];
  usuarios: Usuario[];
  podeGerenciarGeral: boolean;
  userId: string | undefined;
  reuniaoEncerrada: boolean;
  /** reuniao_resposta só aceita insert/update com a reunião "em_andamento" (ver RLS) — resposta/observações ficam travadas fora disso, mesmo com a pauta editável. */
  emAndamento: boolean;
  onAdicionarTopico: (item: { titulo_topico: string; descricao: string; responsavel_user_id?: string | null; prazo?: string | null }) => Promise<boolean>;
  onAtualizarTopico: (id: string, patch: Partial<Pick<ReuniaoPauta, "titulo_topico" | "descricao" | "responsavel_user_id" | "prazo" | "status">>) => Promise<boolean>;
  onReordenar: (idsOrdenados: string[]) => Promise<boolean>;
  onRemoverTopico: (id: string) => Promise<boolean>;
  onSalvarResposta: (pautaId: string, texto: string, encaminhamento: string) => Promise<boolean>;
  onUploadPautaAnexo: (pautaId: string, file: File) => Promise<boolean>;
  onDownloadAnexo: (path: string) => void;
  onRemoverPautaAnexo: (id: string) => Promise<boolean>;
}

export function AnexoPautaCelula({
  pautaId, anexos, podeEditar, onUpload, onDownload, onRemover,
}: {
  pautaId: string;
  anexos: ReuniaoPautaAnexo[];
  podeEditar: boolean;
  onUpload: (pautaId: string, file: File) => Promise<boolean>;
  onDownload: (path: string) => void;
  onRemover: (id: string) => Promise<boolean>;
}) {
  const [enviando, setEnviando] = useState(false);
  const { toast } = useToast();

  const selecionarArquivos = async (fileList: FileList | null) => {
    const arquivos = Array.from(fileList ?? []);
    if (arquivos.length === 0) return;

    const vagas = MAX_ANEXOS_POR_PAUTA - anexos.length;
    if (vagas <= 0) {
      toast({ title: "Limite de anexos atingido", description: `Cada tópico aceita no máximo ${MAX_ANEXOS_POR_PAUTA} arquivos.`, variant: "destructive" });
      return;
    }

    const aceitos = arquivos.slice(0, vagas);
    if (arquivos.length > vagas) {
      toast({ title: "Alguns arquivos não foram enviados", description: `Cada tópico aceita no máximo ${MAX_ANEXOS_POR_PAUTA} arquivos. Só os ${vagas} primeiros foram enviados.`, variant: "destructive" });
    }

    const grandes = aceitos.filter((f) => f.size > MAX_TAMANHO_ANEXO_MB * 1024 * 1024);
    if (grandes.length > 0) {
      toast({ title: "Arquivo muito grande", description: `${grandes.map((f) => f.name).join(", ")} — limite de ${MAX_TAMANHO_ANEXO_MB}MB por arquivo.`, variant: "destructive" });
    }

    const validos = aceitos.filter((f) => f.size <= MAX_TAMANHO_ANEXO_MB * 1024 * 1024);
    setEnviando(true);
    for (const file of validos) await onUpload(pautaId, file);
    setEnviando(false);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
          <Paperclip className="h-3.5 w-3.5" /> {anexos.length > 0 ? anexos.length : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        <div className="space-y-1">
          {anexos.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-1 rounded border border-border px-2 py-1 text-xs">
              <button type="button" onClick={() => onDownload(a.storage_path)} className="min-w-0 truncate text-left text-primary hover:underline">
                {a.nome_arquivo}
              </button>
              {podeEditar && (
                <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0" onClick={() => onRemover(a.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
          {anexos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum anexo.</p>}
        </div>
        {podeEditar && anexos.length < MAX_ANEXOS_POR_PAUTA && (
          <>
            <Input
              type="file"
              multiple
              className="h-8 cursor-pointer text-xs"
              disabled={enviando}
              onChange={async (e) => {
                await selecionarArquivos(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="text-[10px] text-muted-foreground">Até {MAX_ANEXOS_POR_PAUTA} arquivos, {MAX_TAMANHO_ANEXO_MB}MB cada.</p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EditarTopicoPopover({ item, onSalvar }: { item: ReuniaoPauta; onSalvar: (titulo: string, descricao: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState(item.titulo_topico);
  const [descricao, setDescricao] = useState(item.descricao ?? "");

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setTitulo(item.titulo_topico); setDescricao(item.descricao ?? ""); } }}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7"><Pencil className="h-3.5 w-3.5" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2">
        <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título do tópico" className="text-sm" />
        <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição (opcional)" className="min-h-16 text-sm" />
        <Button size="sm" className="w-full" disabled={!titulo.trim()} onClick={async () => { if (await onSalvar(titulo.trim(), descricao.trim())) setOpen(false); }}>
          Salvar
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function PautaRow({
  item, indice, resposta, anexos, usuarios, podeEditarLinha, podeResponderLinha, podeGerenciarGeral, opcoesUsuarios,
  onAtualizarTopico, onRemoverTopico, onSalvarResposta, onUploadPautaAnexo, onDownloadAnexo, onRemoverPautaAnexo,
}: {
  item: ReuniaoPauta;
  indice: number;
  resposta: ReuniaoResposta | undefined;
  anexos: ReuniaoPautaAnexo[];
  usuarios: Usuario[];
  podeEditarLinha: boolean;
  podeResponderLinha: boolean;
  podeGerenciarGeral: boolean;
  opcoesUsuarios: { value: string; label: string }[];
  onAtualizarTopico: Props["onAtualizarTopico"];
  onRemoverTopico: Props["onRemoverTopico"];
  onSalvarResposta: Props["onSalvarResposta"];
  onUploadPautaAnexo: Props["onUploadPautaAnexo"];
  onDownloadAnexo: Props["onDownloadAnexo"];
  onRemoverPautaAnexo: Props["onRemoverPautaAnexo"];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [texto, setTexto] = useState(resposta?.texto_resposta ?? "");
  const [obs, setObs] = useState(resposta?.encaminhamento ?? "");

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <tr ref={setNodeRef} style={style} className="border-b border-border align-top last:border-b-0">
      <td className="w-8 py-2 pl-2">
        {podeGerenciarGeral && (
          <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted-foreground active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </td>
      <td className="w-8 py-2 text-sm text-muted-foreground">{indice + 1}</td>
      <td className="min-w-[180px] py-2 pr-2">
        <div className="flex items-start gap-1">
          <div className="min-w-0">
            <p className="text-sm font-medium">{item.titulo_topico}</p>
            {item.descricao && <p className="text-xs text-muted-foreground">{item.descricao}</p>}
          </div>
          {podeGerenciarGeral && (
            <EditarTopicoPopover item={item} onSalvar={(titulo, descricao) => onAtualizarTopico(item.id, { titulo_topico: titulo, descricao: descricao || null })} />
          )}
        </div>
      </td>
      <td className="min-w-[160px] py-2 pr-2">
        {podeGerenciarGeral ? (
          <SearchableSelect
            value={item.responsavel_user_id}
            onChange={(v) => onAtualizarTopico(item.id, { responsavel_user_id: v || null })}
            options={opcoesUsuarios}
            placeholder="Atribuir"
            allowClear
            clearValue=""
          />
        ) : (
          <span className="text-sm">{nomeUsuario(usuarios, item.responsavel_user_id) ?? "—"}</span>
        )}
      </td>
      <td className="w-36 py-2 pr-2">
        {podeGerenciarGeral ? (
          <Input
            type="date"
            className="h-8 text-xs"
            value={item.prazo ?? ""}
            onChange={(e) => onAtualizarTopico(item.id, { prazo: e.target.value || null })}
          />
        ) : (
          <span className="text-sm">{item.prazo ? new Date(item.prazo).toLocaleDateString("pt-BR") : "—"}</span>
        )}
      </td>
      <td className="w-40 py-2 pr-2">
        {podeEditarLinha ? (
          <Select value={item.status} onValueChange={(v) => onAtualizarTopico(item.id, { status: v as PautaStatus })}>
            <SelectTrigger className={`h-8 text-xs ${PAUTA_STATUS_COR[item.status]}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PAUTA_STATUS_LABEL) as PautaStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{PAUTA_STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${PAUTA_STATUS_COR[item.status]}`}>{PAUTA_STATUS_LABEL[item.status]}</span>
        )}
      </td>
      <td className="min-w-[180px] py-2 pr-2">
        {podeResponderLinha ? (
          <Input
            defaultValue={texto}
            placeholder="Resposta / decisão"
            className="h-8 text-xs"
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => onSalvarResposta(item.id, texto, obs)}
          />
        ) : podeEditarLinha ? (
          <span className="text-xs text-muted-foreground">{resposta?.texto_resposta || "Disponível durante a reunião"}</span>
        ) : (
          <span className="text-sm">{resposta?.texto_resposta || "—"}</span>
        )}
      </td>
      <td className="min-w-[160px] py-2 pr-2">
        {podeResponderLinha ? (
          <Input
            defaultValue={obs}
            placeholder="Observações"
            className="h-8 text-xs"
            onChange={(e) => setObs(e.target.value)}
            onBlur={() => onSalvarResposta(item.id, texto, obs)}
          />
        ) : podeEditarLinha ? (
          <span className="text-xs text-muted-foreground">{resposta?.encaminhamento || "Disponível durante a reunião"}</span>
        ) : (
          <span className="text-sm">{resposta?.encaminhamento || "—"}</span>
        )}
      </td>
      <td className="w-20 py-2 pr-2">
        <AnexoPautaCelula
          pautaId={item.id}
          anexos={anexos}
          podeEditar={podeEditarLinha}
          onUpload={onUploadPautaAnexo}
          onDownload={onDownloadAnexo}
          onRemover={onRemoverPautaAnexo}
        />
      </td>
      <td className="w-10 py-2 pr-2">
        {podeGerenciarGeral && (
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onRemoverTopico(item.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    </tr>
  );
}

export function PautaTabela({
  pauta, respostas, pautaAnexos, usuarios, podeGerenciarGeral, userId, reuniaoEncerrada, emAndamento,
  onAdicionarTopico, onAtualizarTopico, onReordenar, onRemoverTopico, onSalvarResposta,
  onUploadPautaAnexo, onDownloadAnexo, onRemoverPautaAnexo,
}: Props) {
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todas" | PautaStatus>("todas");
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");
  const [novoResponsavel, setNovoResponsavel] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const opcoesUsuarios = usuarios.map((u) => ({ value: u.id, label: u.display_name }));

  const filtrada = useMemo(() => {
    const buscaLc = busca.trim().toLowerCase();
    return pauta.filter((p) => {
      if (filtroStatus !== "todas" && p.status !== filtroStatus) return false;
      if (buscaLc && !p.titulo_topico.toLowerCase().includes(buscaLc)) return false;
      return true;
    });
  }, [pauta, busca, filtroStatus]);

  const podeEditarPodeCriar = podeGerenciarGeral && !reuniaoEncerrada;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = pauta.findIndex((p) => p.id === active.id);
    const newIndex = pauta.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReordenar(arrayMove(pauta, oldIndex, newIndex).map((p) => p.id));
  };

  const adicionar = async () => {
    if (!novoTitulo.trim()) return;
    const ok = await onAdicionarTopico({
      titulo_topico: novoTitulo.trim(),
      descricao: novaDescricao.trim(),
      responsavel_user_id: novoResponsavel || null,
    });
    if (ok) {
      setNovoTitulo(""); setNovaDescricao(""); setNovoResponsavel(""); setNovoOpen(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {podeEditarPodeCriar && (
          <Button size="sm" className="gap-1.5" onClick={() => setNovoOpen((o) => !o)}>
            <Plus className="h-3.5 w-3.5" /> Nova Pauta
          </Button>
        )}
        <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as "todas" | PautaStatus)}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Todas as pautas" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as pautas</SelectItem>
            {(Object.keys(PAUTA_STATUS_LABEL) as PautaStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{PAUTA_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative ml-auto w-56">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pauta..." className="h-8 pl-7 text-xs" />
        </div>
      </div>

      {novoOpen && podeEditarPodeCriar && (
        <div className="grid gap-2 rounded-md border border-dashed border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="Título do tópico" value={novoTitulo} onChange={(e) => setNovoTitulo(e.target.value)} className="text-sm" />
          <SearchableSelect value={novoResponsavel} onChange={setNovoResponsavel} options={opcoesUsuarios} placeholder="Responsável (opcional)" />
          <Button size="sm" disabled={!novoTitulo.trim()} onClick={adicionar}>Adicionar</Button>
          <Textarea
            placeholder="Descrição (opcional)"
            value={novaDescricao}
            onChange={(e) => setNovaDescricao(e.target.value)}
            className="min-h-12 text-sm sm:col-span-3"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="w-8"></th>
              <th className="w-8 py-2">#</th>
              <th className="py-2">Pauta</th>
              <th className="py-2">Responsável</th>
              <th className="py-2">Prazo</th>
              <th className="py-2">Status</th>
              <th className="py-2">Resposta / Decisão</th>
              <th className="py-2">Observações</th>
              <th className="py-2">Anexo</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={filtrada.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {filtrada.map((item, i) => (
                  <PautaRow
                    key={item.id}
                    item={item}
                    indice={i}
                    resposta={respostas.find((r) => r.pauta_id === item.id)}
                    anexos={pautaAnexos.filter((a) => a.pauta_id === item.id)}
                    usuarios={usuarios}
                    podeEditarLinha={!reuniaoEncerrada && (podeGerenciarGeral || item.responsavel_user_id === userId)}
                    podeResponderLinha={emAndamento && (podeGerenciarGeral || item.responsavel_user_id === userId)}
                    podeGerenciarGeral={podeEditarPodeCriar}
                    opcoesUsuarios={opcoesUsuarios}
                    onAtualizarTopico={onAtualizarTopico}
                    onRemoverTopico={onRemoverTopico}
                    onSalvarResposta={onSalvarResposta}
                    onUploadPautaAnexo={onUploadPautaAnexo}
                    onDownloadAnexo={onDownloadAnexo}
                    onRemoverPautaAnexo={onRemoverPautaAnexo}
                  />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
        </table>
        {filtrada.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma pauta encontrada.</p>}
      </div>
      <p className="text-xs text-muted-foreground">Mostrando 1 a {filtrada.length} de {pauta.length} pautas</p>
    </div>
  );
}
