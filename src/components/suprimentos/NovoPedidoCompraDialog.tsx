import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useFornecedores } from "@/hooks/useSupEstoque";
import {
  useCatalogoPedidoCompra,
  useCriarPedidoCompraDireto,
  type ItemCatalogoCompra,
} from "@/hooks/useCompraPedido";
import { converterQuantidadeDigitada } from "@/lib/suprimentos/compra";
import {
  localizarItemPreparado,
  type PreparacaoPedidoCompra,
} from "@/lib/suprimentos/pedidoCompraDireto";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface LinhaPedido {
  chave: string;
  supItemId: string;
  nome: string;
  tamanho: string | null;
  quantidade: string;
  unidade: string;
  valorUnitario: string;
  observacao: string;
}

const UNIDADES = [
  ["UN", "Unitário"], ["CX", "Caixa"], ["DZ", "Dezena"],
  ["PCT", "Pacote"], ["KG", "Quilograma"], ["L", "Litro"], ["M", "Metro"],
] as const;

const agoraLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const numeroTexto = (valor: number | null | undefined) =>
  valor == null ? "" : String(valor).replace(".", ",");

function linhaDoCatalogo(item: ItemCatalogoCompra, quantidade = 1, valorUnitario: number | null = null): LinhaPedido {
  return {
    chave: `${item.id}-${crypto.randomUUID()}`,
    supItemId: item.id,
    nome: item.nome,
    tamanho: item.tamanho,
    quantidade: numeroTexto(quantidade),
    unidade: "UN",
    valorUnitario: numeroTexto(valorUnitario),
    observacao: "",
  };
}

export function NovoPedidoCompraDialog({
  aberto,
  fechar,
  preparacao,
  aoCriar,
}: {
  aberto: boolean;
  fechar: () => void;
  preparacao?: PreparacaoPedidoCompra | null;
  aoCriar: (pedidoId: string) => void;
}) {
  const { empresas } = useEmpresaAtiva();
  const [empresaId, setEmpresaId] = useState(preparacao?.empresaId ?? empresas[0]?.id ?? "");
  const [fornecedorId, setFornecedorId] = useState("");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<LinhaPedido[]>([]);
  const [preparacaoAplicada, setPreparacaoAplicada] = useState(false);
  const [dados, setDados] = useState({
    dataLimiteEntrega: "", localEntrega: "", formaPagamento: "",
    condicoesNegociadas: "", freteIncluso: false, observacoes: "", cotacaoEm: agoraLocal(),
  });
  const { data: fornecedores = [] } = useFornecedores(empresaId || null);
  const { data: catalogo = [], isLoading: carregandoCatalogo } = useCatalogoPedidoCompra(empresaId || null);
  const criar = useCriarPedidoCompraDireto();

  useEffect(() => {
    if (!aberto) {
      setPreparacaoAplicada(false);
      setFornecedorId("");
      setBusca("");
      setLinhas([]);
      setDados({
        dataLimiteEntrega: "", localEntrega: "", formaPagamento: "",
        condicoesNegociadas: "", freteIncluso: false, observacoes: "", cotacaoEm: agoraLocal(),
      });
      return;
    }
    setEmpresaId(preparacao?.empresaId ?? empresas[0]?.id ?? "");
  }, [aberto, empresas, preparacao?.empresaId]);

  useEffect(() => {
    if (!aberto || preparacaoAplicada || !preparacao?.itens.length || !catalogo.length) return;
    const resolvidas = preparacao.itens.flatMap((item) => {
      const catalogado = localizarItemPreparado(catalogo, item);
      return catalogado ? [linhaDoCatalogo(catalogado, item.quantidade, item.valorUnitario)] : [];
    });
    setLinhas(resolvidas);
    setPreparacaoAplicada(true);
    if (resolvidas.length < preparacao.itens.length) {
      toast.warning("Alguns itens sugeridos não estão ativos no catálogo e não foram incluídos.");
    }
  }, [aberto, catalogo, preparacao, preparacaoAplicada]);

  const candidatos = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (termo.length < 2) return [];
    const jaUsados = new Set(linhas.map((linha) => linha.supItemId));
    return catalogo.filter((item) => !jaUsados.has(item.id) &&
      `${item.nome} ${item.tamanho ?? ""}`.toLocaleLowerCase("pt-BR").includes(termo)
    ).slice(0, 12);
  }, [busca, catalogo, linhas]);

  const total = linhas.reduce((soma, linha) => {
    const quantidade = converterQuantidadeDigitada(linha.quantidade);
    const valor = converterQuantidadeDigitada(linha.valorUnitario);
    return soma + (Number.isFinite(quantidade) ? quantidade : 0) * (Number.isFinite(valor) ? valor : 0);
  }, 0);

  const alterarLinha = (chave: string, campo: keyof LinhaPedido, valor: string) =>
    setLinhas((atuais) => atuais.map((linha) => linha.chave === chave ? { ...linha, [campo]: valor } : linha));

  const salvar = async () => {
    if (!empresaId) return toast.error("Escolha a empresa compradora.");
    if (!fornecedorId) return toast.error("Escolha o fornecedor.");
    if (!linhas.length) return toast.error("Inclua ao menos um item.");
    const itens = linhas.map((linha, ordem) => ({
      sup_item_id: linha.supItemId,
      quantidade: converterQuantidadeDigitada(linha.quantidade),
      unidade: linha.unidade,
      valor_unitario: converterQuantidadeDigitada(linha.valorUnitario),
      observacao: linha.observacao.trim() || null,
      ordem,
    }));
    if (itens.some((item) => !Number.isFinite(item.quantidade) || item.quantidade <= 0)) {
      return toast.error("Confira as quantidades: todas devem ser maiores que zero.");
    }
    if (itens.some((item) => !Number.isFinite(item.valor_unitario) || item.valor_unitario < 0)) {
      return toast.error("Informe o preço negociado de todos os itens.");
    }
    const pedido = await criar.mutateAsync({
      empresaId,
      fornecedorId,
      origem: preparacao?.origem ?? "manual",
      itens,
      dados: {
        data_limite_entrega: dados.dataLimiteEntrega || null,
        local_entrega: dados.localEntrega,
        forma_pagamento: dados.formaPagamento,
        condicoes_negociadas: dados.condicoesNegociadas,
        frete_incluso: dados.freteIncluso,
        observacoes: dados.observacoes,
        cotacao_em: dados.cotacaoEm ? new Date(dados.cotacaoEm).toISOString() : new Date().toISOString(),
      },
    });
    aoCriar(pedido.id);
  };

  return (
    <Dialog open={aberto} onOpenChange={(valor) => !valor && fechar()}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo pedido de compra</DialogTitle>
          <DialogDescription>
            Monte o documento formal com os dados do cadastro. Ele será salvo como rascunho para conferência antes do envio.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <div><Label>Empresa compradora *</Label>
            <Select value={empresaId} onValueChange={(valor) => { setEmpresaId(valor); setLinhas([]); setFornecedorId(""); }}>
              <SelectTrigger><SelectValue placeholder="Escolha SN, HAGG..." /></SelectTrigger>
              <SelectContent>{empresas.map((empresa) => <SelectItem key={empresa.id} value={empresa.id}>{empresa.sigla} · {empresa.razao}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Fornecedor *</Label>
            <Select value={fornecedorId} onValueChange={setFornecedorId}>
              <SelectTrigger><SelectValue placeholder="Escolha o fornecedor" /></SelectTrigger>
              <SelectContent>{fornecedores.map((fornecedor) => <SelectItem key={fornecedor.id} value={fornecedor.id}>{fornecedor.nome_fantasia || fornecedor.razao_social}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Data e hora da cotação *</Label><Input type="datetime-local" value={dados.cotacaoEm} onChange={(e) => setDados({ ...dados, cotacaoEm: e.target.value })} /></div>
          <div><Label>Previsão de entrega</Label><Input type="date" value={dados.dataLimiteEntrega} onChange={(e) => setDados({ ...dados, dataLimiteEntrega: e.target.value })} /></div>
          <div><Label>Forma de pagamento</Label><Input value={dados.formaPagamento} placeholder="Ex.: boleto 30 dias" onChange={(e) => setDados({ ...dados, formaPagamento: e.target.value })} /></div>
          <div><Label>Local de entrega</Label><Input value={dados.localEntrega} onChange={(e) => setDados({ ...dados, localEntrega: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Condições negociadas</Label><Textarea value={dados.condicoesNegociadas} onChange={(e) => setDados({ ...dados, condicoesNegociadas: e.target.value })} /></div>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <Label>Adicionar item do cadastro</Label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9" placeholder="Digite ao menos 2 letras do item ou tamanho" />
          </div>
          {carregandoCatalogo && <p className="text-xs text-muted-foreground">Carregando catálogo…</p>}
          {!!candidatos.length && <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {candidatos.map((item) => (
              <Button key={item.id} type="button" variant="outline" size="sm" className="h-auto justify-start py-2 text-left"
                onClick={() => { setLinhas((atuais) => [...atuais, linhaDoCatalogo(item)]); setBusca(""); }}>
                <Plus className="mr-2 h-4 w-4 shrink-0" /><span className="truncate">{item.nome}{item.tamanho ? ` · ${item.tamanho}` : ""}</span>
              </Button>
            ))}
          </div>}
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead className="min-w-56">Descrição</TableHead><TableHead className="w-28">Quantidade</TableHead><TableHead className="w-36">Unidade</TableHead><TableHead className="w-36">Preço unitário</TableHead><TableHead className="min-w-44">Observação</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
            <TableBody>
              {!linhas.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum item incluído.</TableCell></TableRow>}
              {linhas.map((linha) => <TableRow key={linha.chave}>
                <TableCell><span className="font-medium">{linha.nome}</span>{linha.tamanho && <span className="ml-1 text-muted-foreground">· {linha.tamanho}</span>}</TableCell>
                <TableCell><Input inputMode="decimal" value={linha.quantidade} onChange={(e) => alterarLinha(linha.chave, "quantidade", e.target.value.replace(/[^\d.,]/g, ""))} /></TableCell>
                <TableCell><Select value={linha.unidade} onValueChange={(valor) => alterarLinha(linha.chave, "unidade", valor)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UNIDADES.map(([codigo, nome]) => <SelectItem key={codigo} value={codigo}>{codigo} · {nome}</SelectItem>)}</SelectContent></Select></TableCell>
                <TableCell><Input inputMode="decimal" placeholder="0,00" value={linha.valorUnitario} onChange={(e) => alterarLinha(linha.chave, "valorUnitario", e.target.value.replace(/[^\d.,]/g, ""))} /></TableCell>
                <TableCell><Input value={linha.observacao} onChange={(e) => alterarLinha(linha.chave, "observacao", e.target.value)} /></TableCell>
                <TableCell><Button type="button" size="icon" variant="ghost" aria-label={`Remover ${linha.nome}`} onClick={() => setLinhas((atuais) => atuais.filter((item) => item.chave !== linha.chave))}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
          <div className="flex justify-end border-t bg-muted/30 px-4 py-3 text-lg font-bold">
            Total: {total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <input type="checkbox" checked={dados.freteIncluso} onChange={(e) => setDados({ ...dados, freteIncluso: e.target.checked })} />
            Frete incluso no valor negociado
          </label>
          <div><Label>Observações do pedido</Label><Textarea value={dados.observacoes} onChange={(e) => setDados({ ...dados, observacoes: e.target.value })} /></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={criar.isPending}>
            {criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Criar rascunho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
