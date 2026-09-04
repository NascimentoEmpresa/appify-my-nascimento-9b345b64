import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useCartoesCredito, useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useConfirmarImportacaoFatura, useFaturaExistente, useUploadArquivoFatura } from "@/hooks/useCartaoFatura";
import { adaptadorPorNomeBanco, extensaoAceita, BANCOS_COM_ADAPTADOR } from "@/lib/cartaoFatura/adaptadores";
import { reconciliar, type ItemRevisao } from "@/lib/cartaoFatura/reconciliar";
import { novoUuid } from "@/lib/utils";

const STATUS_LABEL: Record<ItemRevisao["statusRevisao"], string> = {
  novo: "Nova",
  confirmado_sem_mudanca: "Já existia",
  valor_mudou: "Valor mudou",
  nao_encontrada: "Não encontrada nesta fatura",
};
const STATUS_CLASSE: Record<ItemRevisao["statusRevisao"], string> = {
  novo: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  confirmado_sem_mudanca: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  valor_mudou: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  nao_encontrada: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

const fmtBRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

interface LinhaTabela extends ItemRevisao {
  removida: boolean;
}

export function ImportarFaturaModal({ open, onClose, cartaoInicialId }: { open: boolean; onClose: () => void; cartaoInicialId?: string | null }) {
  const { data: cartoes = [] } = useCartoesCredito();
  const { data: bancos = [] } = useCartaoBancos();

  const [cartaoId, setCartaoId] = useState("");
  const [competencia, setCompetencia] = useState(""); // yyyy-mm (input type=month)
  const [linhas, setLinhas] = useState<LinhaTabela[]>([]);
  const [analisando, setAnalisando] = useState(false);
  const [arquivoNome, setArquivoNome] = useState<string | null>(null);
  const [arquivoParaEnviar, setArquivoParaEnviar] = useState<File | null>(null);

  const competenciaISO = competencia ? `${competencia}-01` : null;
  const { data: existente } = useFaturaExistente(cartaoId || null, competenciaISO);
  const upload = useUploadArquivoFatura();
  const confirmar = useConfirmarImportacaoFatura();

  useEffect(() => {
    if (!open) return;
    setCartaoId(cartaoInicialId ?? "");
    setCompetencia("");
    setLinhas([]);
    setArquivoNome(null);
    setArquivoParaEnviar(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cartaoInicialId]);

  const cartaoSelecionado = cartoes.find((c) => c.id === cartaoId);
  const bancoNome = bancos.find((b) => b.id === cartaoSelecionado?.banco_id)?.nome;
  const adaptador = adaptadorPorNomeBanco(bancoNome);

  const jaImportada = existente?.fatura?.status === "importada";

  async function handleArquivoSelecionado(file: File) {
    if (!adaptador) {
      toast.error("Este banco ainda não tem suporte a import de fatura.");
      return;
    }
    if (!extensaoAceita(adaptador, file.name)) {
      toast.error(`Formato não aceito pra ${adaptador.nomeBanco}. Use: ${adaptador.formatos.join(", ")}.`);
      return;
    }
    const [ano, mes] = competencia.split("-").map(Number);
    setAnalisando(true);
    try {
      const linhasBrutas = await adaptador.parse({ arquivo: file, competenciaAno: ano, competenciaMes: mes });
      if (linhasBrutas.length === 0) {
        toast.error(
          `Não encontrei nenhum lançamento nesse arquivo pro layout do ${adaptador.nomeBanco}. ` +
            "Confere se o Cartão selecionado bate com o banco de verdade dessa fatura (o layout varia por banco).",
        );
        return;
      }
      const revisao = reconciliar(linhasBrutas, existente?.itens ?? []);
      setLinhas(revisao.map((r) => ({ ...r, removida: false })));
      setArquivoNome(file.name);
      setArquivoParaEnviar(file);
      toast.success(`${linhasBrutas.length} lançamento(s) encontrado(s) — confira antes de confirmar.`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao ler o arquivo.");
    } finally {
      setAnalisando(false);
    }
  }

  function atualizarLinha(compraId: string, campos: Partial<LinhaTabela>) {
    setLinhas((prev) => prev.map((l) => (l.compraId === compraId ? { ...l, ...campos } : l)));
  }

  function adicionarLinhaManual() {
    setLinhas((prev) => [
      ...prev,
      {
        id: null,
        compraId: novoUuid(),
        descricao: "",
        dataCompra: competenciaISO,
        valor: 0,
        parcelaAtual: null,
        parcelaTotal: null,
        origem: "manual",
        statusRevisao: "novo",
        removida: false,
      },
    ]);
  }

  const totalConfirmado = useMemo(
    () => linhas.filter((l) => !l.removida && l.statusRevisao !== "nao_encontrada").reduce((s, l) => s + Number(l.valor || 0), 0),
    [linhas],
  );

  async function handleConfirmar() {
    if (!cartaoId || !competenciaISO) {
      toast.error("Selecione o cartão e a competência.");
      return;
    }
    try {
      let arquivoPath: string | null = existente?.fatura?.arquivo_original_path ?? null;
      if (arquivoParaEnviar) {
        arquivoPath = await upload.mutateAsync({ cartaoId, competenciaISO, arquivo: arquivoParaEnviar });
      }

      const itensExcluirIds = linhas.filter((l) => l.removida && l.id).map((l) => l.id!) as string[];
      const itens = linhas
        .filter((l) => !l.removida && l.statusRevisao !== "nao_encontrada")
        .map((l) => ({
          id: l.id,
          compra_id: l.compraId,
          descricao: l.descricao.trim(),
          data_compra: l.dataCompra,
          valor: Number(l.valor),
          parcela_atual: l.parcelaAtual,
          parcela_total: l.parcelaTotal,
          origem: l.origem,
        }));

      if (itens.length === 0) {
        toast.error("Nenhum lançamento pra confirmar.");
        return;
      }

      await confirmar.mutateAsync({ cartaoId, competenciaISO, arquivoPath, itens, itensExcluirIds });
      toast.success("Fatura importada — lançamentos enviados pro Fluxo de Caixa.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao confirmar importação.");
    }
  }

  const salvando = upload.isPending || confirmar.isPending;
  const mostrandoRevisao = linhas.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Fatura</DialogTitle>
          <DialogDescription>
            Anexe a fatura do mês, confira os lançamentos identificados e confirme — o que for confirmado vai pro Fluxo de Caixa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {BANCOS_COM_ADAPTADOR.map((a) => (
            <span key={a.nomeBanco}>
              <span className="font-medium text-foreground">{a.nomeBanco}</span>: {a.formatos.join("/")}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Cartão *</Label>
            <Select value={cartaoId} onValueChange={(v) => { setCartaoId(v); setLinhas([]); }} disabled={mostrandoRevisao}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {cartoes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome_cartao}{c.final_cartao ? ` •••• ${c.final_cartao}` : ""}{!c.ativo ? " (inativo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Competência *</Label>
            <Input type="month" value={competencia} onChange={(e) => { setCompetencia(e.target.value); setLinhas([]); }} disabled={mostrandoRevisao} />
          </div>
        </div>

        {cartaoId && adaptador && (
          <p className="text-xs text-muted-foreground -mt-1">
            Banco identificado: <span className="font-medium text-foreground">{adaptador.nomeBanco}</span>
            {cartaoSelecionado?.final_cartao && <> — cartão final <span className="font-medium text-foreground">{cartaoSelecionado.final_cartao}</span></>}
            . Confere se o número bate com a fatura que você vai anexar.
          </p>
        )}

        {cartaoId && competencia && !adaptador && (
          <div className="flex items-start gap-2 rounded-md border bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {bancoNome ? `O banco "${bancoNome}"` : "Este cartão"} ainda não tem suporte a import automático de fatura — veja os
              bancos disponíveis acima.
            </span>
          </div>
        )}

        {jaImportada && !mostrandoRevisao && (
          <div className="flex items-start gap-2 rounded-md border bg-amber-50 dark:bg-amber-950/20 p-2.5 text-xs text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              Esta competência já foi importada{existente?.fatura?.importado_em ? ` em ${new Date(existente.fatura.importado_em).toLocaleDateString("pt-BR")}` : ""}.
              Reimportar vai comparar com o que já existe e atualizar, mantendo os lançamentos que já foram confirmados.
            </span>
          </div>
        )}

        {!mostrandoRevisao && cartaoId && competencia && adaptador && (
          <div className="rounded-md border border-dashed p-6 text-center">
            <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-2" />
            <Label htmlFor="arquivo-fatura" className="cursor-pointer text-sm font-medium text-primary">
              {analisando ? "Analisando arquivo..." : `Escolher arquivo (${adaptador.formatos.join(", ")})`}
            </Label>
            <input
              id="arquivo-fatura"
              type="file"
              className="hidden"
              accept={adaptador.formatos.map((f) => `.${f}`).join(",")}
              disabled={analisando}
              onChange={(e) => e.target.files?.[0] && handleArquivoSelecionado(e.target.files[0])}
            />
          </div>
        )}

        {mostrandoRevisao && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Conferência — {arquivoNome}</p>
              <Button variant="outline" size="sm" onClick={adicionarLinhaManual}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar lançamento
              </Button>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-32">Data</TableHead>
                    <TableHead className="w-24">Parcela</TableHead>
                    <TableHead className="w-32 text-right">Valor</TableHead>
                    <TableHead className="w-40">Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linhas.map((l) => (
                    <TableRow key={l.compraId} className={l.removida ? "opacity-40" : ""}>
                      <TableCell className="p-1">
                        <Input
                          className="h-8 text-xs"
                          value={l.descricao}
                          disabled={l.removida}
                          onChange={(e) => atualizarLinha(l.compraId, { descricao: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          type="date"
                          className="h-8 text-xs"
                          value={l.dataCompra ?? ""}
                          disabled={l.removida}
                          onChange={(e) => atualizarLinha(l.compraId, { dataCompra: e.target.value || null })}
                        />
                      </TableCell>
                      <TableCell className="p-1 text-center text-xs">
                        {l.parcelaAtual && l.parcelaTotal ? `${l.parcelaAtual}/${l.parcelaTotal}` : "—"}
                      </TableCell>
                      <TableCell className="p-1">
                        <Input
                          type="number"
                          step="0.01"
                          className="h-8 text-xs text-right"
                          value={l.valor}
                          disabled={l.removida}
                          onChange={(e) => atualizarLinha(l.compraId, { valor: Number(e.target.value) })}
                        />
                        {l.statusRevisao === "valor_mudou" && l.valorAnterior != null && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">antes: {fmtBRL(l.valorAnterior)}</p>
                        )}
                      </TableCell>
                      <TableCell className="p-1">
                        <Badge className={STATUS_CLASSE[l.statusRevisao]}>{STATUS_LABEL[l.statusRevisao]}</Badge>
                      </TableCell>
                      <TableCell className="p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title={l.removida ? "Desfazer remoção" : "Remover"}
                          onClick={() => atualizarLinha(l.compraId, { removida: !l.removida })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground text-right">
              Total a confirmar: <span className="font-semibold text-foreground">{fmtBRL(totalConfirmado)}</span>
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          {mostrandoRevisao && (
            <Button onClick={handleConfirmar} disabled={salvando}>
              {salvando ? "Confirmando..." : "Confirmar Importação"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
