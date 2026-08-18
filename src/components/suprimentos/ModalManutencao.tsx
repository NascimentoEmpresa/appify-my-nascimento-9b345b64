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
  type Bem, type ArquivoBem, type MotivoIndisponivel,
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

  // Um seletor só para quatro estados: disponível / manutenção / em contrato
  // / outro. "" = disponível; o resto é o motivo da indisponibilidade.
  const [motivo, setMotivo] = useState<"" | MotivoIndisponivel>("");
  const [detalhe, setDetalhe] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const emManutencao = motivo !== "";
  const [idAtual, setIdAtual] = useState<string | null>(null);
  const [novoArquivo, setNovoArquivo] = useState<File | null>(null);
  const [novoComentario, setNovoComentario] = useState("");
  const [novoValor, setNovoValor] = useState("");

  // Semeia ao trocar de bem, sem useEffect.
  if (bem && bem.id !== idAtual) {
    setIdAtual(bem.id);
    // Registro antigo pode estar indisponível sem motivo gravado: cai em
    // manutenção, que era o único motivo que existia antes.
    setMotivo(bem.em_manutencao ? (bem.motivo_indisponivel ?? "manutencao") : "");
    setDetalhe(bem.motivo_detalhe ?? "");
    setInicio(bem.data_inicio_manutencao?.slice(0, 10) ?? "");
    setFim(bem.data_previsao_fim?.slice(0, 10) ?? "");
    setNovoArquivo(null); setNovoComentario(""); setNovoValor("");
  }

  const totalGasto = arquivos.reduce((s, a) => s + Number(a.valor ?? 0), 0);

  const salvar = async () => {
    if (!bem) return;
    // O banco recusa 'outro' sem texto (sup_patrimonio_motivo_coerente). Barrar
    // aqui evita que o usuário leve um erro de constraint na cara — e a opção
    // existe justamente para dizer o porquê.
    if (motivo === "outro" && !detalhe.trim()) {
      toast.error("Escreva qual é o motivo da indisponibilidade.");
      return;
    }
    await atualizar.mutateAsync({
      id: bem.id, em_manutencao: emManutencao,
      motivo_indisponivel: emManutencao ? (motivo as MotivoIndisponivel) : null,
      motivo_detalhe: motivo === "outro" ? detalhe : null,
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
              Disponibilidade
            </Label>
            <div className="mt-2">
              <Label className="text-sm">O bem está disponível?</Label>
              <Select
                value={motivo === "" ? "nao" : motivo}
                onValueChange={(v) => {
                  const novo = v === "nao" ? "" : (v as MotivoIndisponivel);
                  setMotivo(novo);
                  // Voltar a disponível limpa as datas (§9.2).
                  if (!novo) { setInicio(""); setFim(""); }
                  // Sair de "outro" descarta o texto: motivo escrito para um
                  // estado que não vale mais é dado órfão, e o banco recusa.
                  if (novo !== "outro") setDetalhe("");
                }}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nao">Sim — disponível</SelectItem>
                  <SelectItem value="manutencao">Não — parado em manutenção</SelectItem>
                  <SelectItem value="contrato">Não — em contrato</SelectItem>
                  <SelectItem value="outro">Não — outro motivo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {motivo === "outro" && (
              <div className="mt-3">
                <Label className="text-sm" htmlFor="motivo-outro">
                  Qual o motivo? <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="motivo-outro"
                  rows={2}
                  value={detalhe}
                  onChange={(e) => setDetalhe(e.target.value)}
                  maxLength={200}
                  placeholder="Ex.: sinistro aguardando perícia, documentação vencida, emprestado a outra unidade…"
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Este texto aparece para quem tentar agendar o veículo. {detalhe.trim().length}/200
                </p>
              </div>
            )}

            {emManutencao && (<>
              {/* Só veículo é agendável; dizer isso num equipamento seria ruído. */}
              {bem?.categoria === "veiculo" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {motivo === "contrato"
                    ? "Alocado a um contrato: o escritório não poderá agendá-lo no Agendamento de Veículos."
                    : motivo === "outro"
                      ? "Indisponível: não poderá ser agendado no Agendamento de Veículos."
                      : "Parado em manutenção: não poderá ser agendado no Agendamento de Veículos."}
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Data de início</Label>
                  <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                </div>
                <div>
                  {/* Sem data de fim, a indisponibilidade é por tempo
                      indeterminado — é o que a tela de agendamento vai dizer. */}
                  <Label className="text-xs">
                    {motivo === "contrato" ? "Previsão de devolução"
                      : motivo === "outro" ? "Previsão de liberação"
                      : "Previsão de fim"}
                  </Label>
                  <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
                </div>
              </div>
            </>)}
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
