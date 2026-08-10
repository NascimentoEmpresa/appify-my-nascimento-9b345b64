import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useArquivosDoBem, useAtualizarManutencao, useAnexarArquivo, useAtualizarArquivo,
  useRemoverArquivo, urlDoArquivo, mascaraBRL, brlParaNumero,
  type Bem, type ArquivoBem,
} from "@/hooks/useSupPatrimonio";
import { FotoDoBem } from "@/components/suprimentos/FotoDoBem";
import { Upload, Trash2, FileText, Wrench, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

/**
 * Status de manutenção do bem, com as notas e o custo.
 *
 * Espelha o modal do legado (REPLICAR-MODULO-COMPRAS.md §9.3): marcar "em
 * manutenção" revela as duas datas, e cada arquivo carrega um comentário e um
 * VALOR — é assim que o custo fica documentado junto da nota que o comprova.
 *
 * Desmarcar limpa as duas datas. Não é só gentileza da tela: a constraint
 * sup_patrimonio_datas_coerentes recusa data órfã de um estado que não existe.
 */
export function ModalManutencao({ bem, onFechar }: { bem: Bem | null; onFechar: () => void }) {
  const { data: arquivos = [], isLoading } = useArquivosDoBem(bem?.id ?? null);
  const atualizar = useAtualizarManutencao();
  const anexar = useAnexarArquivo();

  const [emManutencao, setEmManutencao] = useState(false);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [idAtual, setIdAtual] = useState<string | null>(null);
  const [novoArquivo, setNovoArquivo] = useState<File | null>(null);
  const [novoComentario, setNovoComentario] = useState("");
  const [novoValor, setNovoValor] = useState("");

  // Semeia ao trocar de bem, sem useEffect.
  if (bem && bem.id !== idAtual) {
    setIdAtual(bem.id);
    setEmManutencao(bem.em_manutencao);
    setInicio(bem.data_inicio_manutencao?.slice(0, 10) ?? "");
    setFim(bem.data_previsao_fim?.slice(0, 10) ?? "");
    setNovoArquivo(null); setNovoComentario(""); setNovoValor("");
  }

  const totalGasto = arquivos.reduce((s, a) => s + Number(a.valor ?? 0), 0);

  const salvar = async () => {
    if (!bem) return;
    await atualizar.mutateAsync({
      id: bem.id, em_manutencao: emManutencao,
      data_inicio_manutencao: inicio || null, data_previsao_fim: fim || null,
    });
    if (novoArquivo) {
      await anexar.mutateAsync({
        patrimonio_id: bem.id, arquivo: novoArquivo,
        comentario: novoComentario || null, valor: brlParaNumero(novoValor),
      });
      setNovoArquivo(null); setNovoComentario(""); setNovoValor("");
    }
    setIdAtual(null);
    onFechar();
  };

  const ocupado = atualizar.isPending || anexar.isPending;

  return (
    <Dialog open={!!bem} onOpenChange={(o) => { if (!o) { setIdAtual(null); onFechar(); } }}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-2xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            {bem?.nome}
            {bem?.identificador && (
              <span className="font-mono text-xs font-normal text-muted-foreground">{bem.identificador}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-5 py-1">
          {/* Foto — mesma lógica de foto de perfil: uma só, trocável no lugar.
              Fica no topo porque é o que identifica o bem de relance, ainda
              mais nos que entraram sem placa/nº de série. */}
          {bem && <FotoDoBem bem={bem} />}

          {/* Onde está */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground">Local: </span>
            {bem?.contrato
              ? <>{bem.contrato.nome}{bem.posto ? ` · ${bem.posto.nome}` : ""}</>
              : <>Administrativo / Sede{bem?.lotacao ? ` · ${bem.lotacao}` : ""}</>}
          </div>

          {/* Status */}
          <div className="rounded-lg border p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Status de manutenção
            </Label>
            <div className="mt-2">
              <Label className="text-sm">Está em manutenção?</Label>
              <Select
                value={emManutencao ? "sim" : "nao"}
                onValueChange={(v) => {
                  const novo = v === "sim";
                  setEmManutencao(novo);
                  // Desmarcar limpa as datas (§9.2).
                  if (!novo) { setInicio(""); setFim(""); }
                }}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nao">Não — disponível</SelectItem>
                  <SelectItem value="sim">Sim — parado em manutenção</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {emManutencao && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Data de início</Label>
                  <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Previsão de fim</Label>
                  <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Anexos */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">Notas e documentos</p>
              <Badge variant="secondary" className="text-[11px]">{arquivos.length}</Badge>
              {totalGasto > 0 && (
                <Badge variant="outline" className="ml-auto border-emerald-400/50 text-emerald-700 dark:text-emerald-300">
                  Total: {totalGasto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </Badge>
              )}
            </div>

            {isLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : arquivos.length === 0 ? (
              <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                Nenhuma nota anexada.
              </p>
            ) : (
              <div className="space-y-2">
                {arquivos.map((a) => <LinhaArquivo key={a.id} arquivo={a} />)}
              </div>
            )}

            {/* Novo anexo */}
            <div className="mt-3 rounded-md border border-dashed p-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Anexar nota
              </Label>
              <label className="mt-2 flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
                <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">
                  {novoArquivo ? novoArquivo.name : "Escolher arquivo (até 10 MB)"}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 10 * 1024 * 1024) {
                      toast.error("Arquivo maior que 10 MB.");
                      return;
                    }
                    setNovoArquivo(f);
                  }}
                />
              </label>
              {novoArquivo && (
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem]">
                  <Textarea
                    rows={2} value={novoComentario}
                    onChange={(e) => setNovoComentario(e.target.value)}
                    placeholder="Comentário sobre este documento…"
                  />
                  <Input
                    value={novoValor}
                    onChange={(e) => setNovoValor(mascaraBRL(e.target.value))}
                    placeholder="R$ 0,00"
                    inputMode="numeric"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setIdAtual(null); onFechar(); }}>Cancelar</Button>
          <Button disabled={ocupado} onClick={salvar}>
            {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Um anexo: link, comentário e valor, editáveis no lugar. */
function LinhaArquivo({ arquivo }: { arquivo: ArquivoBem }) {
  const atualizar = useAtualizarArquivo();
  const remover = useRemoverArquivo();
  const [comentario, setComentario] = useState(arquivo.comentario ?? "");
  const [valor, setValor] = useState(
    arquivo.valor != null
      ? Number(arquivo.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "",
  );

  const mudou = comentario !== (arquivo.comentario ?? "") ||
    brlParaNumero(valor) !== (arquivo.valor != null ? Number(arquivo.valor) : null);

  const abrir = async () => {
    const url = await urlDoArquivo(arquivo.caminho);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Não foi possível gerar o link do arquivo.");
  };

  return (
    <div className="rounded-md border p-2">
      <div className="flex min-w-0 items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <button type="button" onClick={abrir}
                className="min-w-0 flex-1 truncate text-left text-sm text-primary hover:underline">
          {arquivo.nome_arquivo}
        </button>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {new Date(arquivo.created_at).toLocaleDateString("pt-BR")}
        </span>
        <Button
          size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive"
          onClick={() => { if (confirm(`Remover "${arquivo.nome_arquivo}"?`)) remover.mutate(arquivo); }}
          aria-label="Remover anexo"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
        <Input
          value={comentario} onChange={(e) => setComentario(e.target.value)}
          placeholder="Comentário sobre este documento…" className="h-8 text-xs"
        />
        <Input
          value={valor} onChange={(e) => setValor(mascaraBRL(e.target.value))}
          placeholder="R$ 0,00" inputMode="numeric" className="h-8 text-xs"
        />
        {mudou && (
          <Button size="sm" className="h-8"
                  onClick={() => atualizar.mutate({ id: arquivo.id, comentario, valor: brlParaNumero(valor) })}>
            Salvar
          </Button>
        )}
      </div>
    </div>
  );
}
