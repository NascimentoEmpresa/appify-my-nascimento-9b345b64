import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Download, ExternalLink, FileText, Loader2, Paperclip, Plus, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useContratosAtivos } from "@/hooks/useMaloteDespesa";
import {
  RateioItemLinha,
  obterAnexoClassificacao,
  useComplementoItemFatura,
  useRateioItemFatura,
  useSalvarComplementoItem,
  useSalvarRateioItem,
} from "@/hooks/useCartaoFaturaRateio";
import {
  MAX_ANEXOS_POR_ITEM,
  MAX_OBSERVACAO,
  abreNaAba,
  complementoMudou,
  juntarArquivos,
  type AnexoClassificacao,
} from "@/lib/cartaoFatura/anexosClassificacao";
import { arquivosDaColagem, fmtTamanho, nomeDeColagem } from "@/lib/solicitacoes/anexos";

const fmtBRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

// SIS-2026-0879: um anexo já salvo — nome, tamanho, Abrir (PDF/imagem), Baixar e tirar da lista.
function AnexoSalvo({ anexo, onRemover, desabilitado }: { anexo: AnexoClassificacao; onRemover: () => void; desabilitado: boolean }) {
  const [ocupado, setOcupado] = useState(false);

  async function usar(modo: "abrir" | "baixar") {
    // A aba é reservada AINDA no clique: depois do await o bloqueador de pop-up barraria.
    const aba = modo === "abrir" ? window.open("", "_blank") : null;
    setOcupado(true);
    try {
      const blob = await obterAnexoClassificacao(anexo.path);
      const url = URL.createObjectURL(anexo.tipo && !blob.type ? new Blob([blob], { type: anexo.tipo }) : blob);
      if (aba) {
        aba.opener = null;
        aba.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = anexo.nome;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      aba?.close();
      toast.error(`Não foi possível ${modo === "abrir" ? "abrir" : "baixar"} "${anexo.nome}"`, { description: e instanceof Error ? e.message : undefined });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
      {ocupado ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate" title={anexo.nome}>{anexo.nome}</span>
      {anexo.tamanho ? <span className="shrink-0 text-muted-foreground">{fmtTamanho(anexo.tamanho)}</span> : null}
      {abreNaAba(anexo) && (
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Abrir" aria-label={`Abrir ${anexo.nome}`} disabled={ocupado} onClick={() => void usar("abrir")}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Baixar" aria-label={`Baixar ${anexo.nome}`} disabled={ocupado} onClick={() => void usar("baixar")}>
        <Download className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive" title="Remover anexo" aria-label={`Remover ${anexo.nome}`} disabled={desabilitado} onClick={onRemover}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

interface RateioItemFaturaDialogProps {
  open: boolean;
  onClose: () => void;
  itemId: string | null;
  descricaoItem: string;
  valorItem: number;
}

export function RateioItemFaturaDialog({ open, onClose, itemId, descricaoItem, valorItem }: RateioItemFaturaDialogProps) {
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: linhasExistentes } = useRateioItemFatura(itemId);
  const salvar = useSalvarRateioItem();
  // SIS-2026-0879: observação + anexos (NF, prints) do item.
  const { data: complemento } = useComplementoItemFatura(itemId);
  const salvarComplemento = useSalvarComplementoItem();
  const [observacao, setObservacao] = useState("");
  const [removidos, setRemovidos] = useState<string[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const seletor = useRef<HTMLInputElement>(null);

  const [ratearPor, setRatearPor] = useState<"percentual" | "valor">("valor");
  const [linhas, setLinhas] = useState<RateioItemLinha[]>([]);

  useEffect(() => {
    if (!open) return;
    setLinhas(
      linhasExistentes && linhasExistentes.length > 0
        ? linhasExistentes
        : [{ classificacao_id: "", contrato_id: null, percentual: null, valor: valorItem, ordem: 0 }],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, linhasExistentes]);

  useEffect(() => {
    if (!open) return;
    setObservacao(complemento?.observacao ?? "");
    setRemovidos([]);
    setArquivos([]);
  }, [open, complemento]);

  const anexosSalvos = complemento?.anexos ?? [];
  const anexosMantidos = anexosSalvos.filter((a) => !removidos.includes(a.path));
  const totalAnexos = anexosMantidos.length + arquivos.length;
  const salvando = salvar.isPending || salvarComplemento.isPending;

  function adicionarArquivos(lista: File[]) {
    if (!lista.length) return;
    const r = juntarArquivos(arquivos, lista, anexosMantidos.length);
    setArquivos(r.arquivos);
    r.avisos.forEach((a) => toast.warning(a));
  }

  // Print colado com Ctrl+V vira anexo (chega sem nome: ganha um com data e hora).
  function aoColar(e: ClipboardEvent) {
    const colados = arquivosDaColagem(e.clipboardData?.items);
    if (!colados.length) return;
    e.preventDefault();
    adicionarArquivos(colados.map((f) => new File([f], nomeDeColagem(f), { type: f.type })));
  }

  const totalRateado = useMemo(() => linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0), [linhas]);
  const diferenca = valorItem - totalRateado;
  const bate = Math.abs(diferenca) <= 0.01;
  const todasClassificadas = linhas.every((l) => !!l.classificacao_id);
  const podeSalvar = bate && todasClassificadas;

  function atualizarLinha(idx: number, patch: Partial<RateioItemLinha>) {
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function distribuirValorNaLinha(idx: number, valor: number) {
    const percentual = valorItem > 0 ? Number(((valor / valorItem) * 100).toFixed(3)) : 0;
    atualizarLinha(idx, { valor, percentual });
  }

  function distribuirPercentualNaLinha(idx: number, percentual: number) {
    const valor = Number(((valorItem * percentual) / 100).toFixed(2));
    atualizarLinha(idx, { valor, percentual });
  }

  function adicionarLinha() {
    setLinhas((prev) => [...prev, { classificacao_id: "", contrato_id: null, percentual: null, valor: 0, ordem: prev.length }]);
  }

  function removerLinha(idx: number) {
    setLinhas((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSalvar() {
    if (!podeSalvar) return;
    try {
      await salvar.mutateAsync({ itemId: itemId!, linhas });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar classificação.");
      return;
    }
    if (complementoMudou({ observacaoSalva: complemento?.observacao ?? "", observacao, removidos: removidos.length, novos: arquivos.length })) {
      try {
        await salvarComplemento.mutateAsync({
          itemId: itemId!,
          observacao,
          manter: anexosMantidos,
          removidos: anexosSalvos.filter((a) => removidos.includes(a.path)),
          arquivos,
        });
      } catch (e) {
        // O rateio já foi gravado: o diálogo fica aberto para tentar de novo só a observação/anexos.
        toast.error("Classificação salva, mas a observação/anexos não.", { description: e instanceof Error ? e.message : undefined });
        return;
      }
    }
    toast.success("Classificação salva.");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" onPaste={aoColar}>
        <DialogHeader>
          <DialogTitle>Classificar item</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-2">
          {descricaoItem} — {fmtBRL(valorItem)}
        </p>

        <div className="flex justify-end">
          <div>
            <Label className="text-xs">Ratear por</Label>
            <Select value={ratearPor} onValueChange={(v) => setRatearPor(v as "percentual" | "valor")}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentual">Percentual (%)</SelectItem>
                <SelectItem value="valor">Valor (R$)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Classificação *</TableHead>
                <TableHead>Contrato (opcional)</TableHead>
                <TableHead>{ratearPor === "percentual" ? "% Rateio *" : "Valor (R$) *"}</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha, idx) => (
                <TableRow key={idx}>
                  <TableCell>
                    <Select value={linha.classificacao_id} onValueChange={(v) => atualizarLinha(idx, { classificacao_id: v })}>
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {classificacoes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <SearchableSelect
                      value={linha.contrato_id ?? ""}
                      onChange={(v) => atualizarLinha(idx, { contrato_id: v || null })}
                      options={contratos.map((c) => ({ value: c.id, label: c.nome, muted: c.status === "encerrado" }))}
                      placeholder="Selecione..."
                      allowClear
                      className="w-48"
                      triggerClassName="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-8 w-24 text-xs"
                      value={ratearPor === "percentual" ? linha.percentual ?? "" : linha.valor ?? ""}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0;
                        if (ratearPor === "percentual") distribuirPercentualNaLinha(idx, v);
                        else distribuirValorNaLinha(idx, v);
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removerLinha(idx)}
                      disabled={linhas.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-4">
          <Button type="button" variant="outline" size="sm" onClick={adicionarLinha} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar linha
          </Button>
          {/* [SEM-CHAMADO] (pedido do usuário): total mais visual (ícone +
              cor + quanto falta/excedeu), e o botão de Salvar abaixo passa a
              ficar desabilitado em vez de só avisar depois do clique. */}
          <div
            className={
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm " +
              (bate
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                : "border-destructive/30 bg-destructive/10 text-destructive")
            }
          >
            {bate ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            <span>
              Total do rateio: <span className="font-semibold">{fmtBRL(totalRateado)}</span> / {fmtBRL(valorItem)}
              {!bate && (
                <span className="ml-1">
                  ({diferenca > 0 ? "faltam " : "excedeu "}
                  {fmtBRL(Math.abs(diferenca))})
                </span>
              )}
            </span>
          </div>
        </div>

        {/* SIS-2026-0879: observação e anexos (NF, prints) do item — opcionais, valem para o item inteiro (não por linha). */}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="obs-classificacao" className="text-xs">Observação (opcional)</Label>
            <Textarea
              id="obs-classificacao"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              maxLength={MAX_OBSERVACAO}
              rows={3}
              placeholder="Ex.: compra de material para o contrato X, NF em anexo."
              className="text-sm"
              disabled={salvando}
            />
            {observacao.length > MAX_OBSERVACAO * 0.9 && (
              <p className="text-right text-[11px] text-muted-foreground">{observacao.length}/{MAX_OBSERVACAO}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Anexos — NF e/ou prints (opcional)</Label>
              <input
                ref={seletor}
                type="file"
                multiple
                accept=".pdf,.xml,image/*"
                className="hidden"
                onChange={(e) => {
                  adicionarArquivos(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => seletor.current?.click()}
                disabled={salvando || totalAnexos >= MAX_ANEXOS_POR_ITEM}
                title={`Até ${MAX_ANEXOS_POR_ITEM} arquivos, 25 MB cada`}
              >
                <Paperclip className="h-3.5 w-3.5" /> Anexar arquivos
              </Button>
            </div>
            {totalAnexos === 0 ? (
              <p className="text-[11px] text-muted-foreground">PDF, XML ou imagem, até {MAX_ANEXOS_POR_ITEM} arquivos de 25 MB. Também dá para colar um print (Ctrl+V).</p>
            ) : (
              <div className="space-y-1">
                {anexosMantidos.map((a) => (
                  <AnexoSalvo key={a.path} anexo={a} desabilitado={salvando} onRemover={() => setRemovidos((r) => [...r, a.path])} />
                ))}
                {arquivos.map((f, idx) => (
                  <div key={`${f.name}-${f.size}-${idx}`} className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                    <span className="shrink-0 text-muted-foreground">{fmtTamanho(f.size)} · sobe ao salvar</span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Tirar" aria-label={`Tirar ${f.name}`} disabled={salvando} onClick={() => setArquivos((l) => l.filter((_, i) => i !== idx))}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={salvando || !podeSalvar} title={!podeSalvar ? "Selecione a classificação em todas as linhas e acerte o total do rateio" : undefined}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
