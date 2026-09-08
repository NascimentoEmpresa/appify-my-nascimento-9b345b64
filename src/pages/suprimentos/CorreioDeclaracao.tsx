import { useEffect, useState, type KeyboardEvent } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buscarPedidoParaDeclaracao,
  novaDeclaracao,
  useDeclaracoesCorreio,
  useSalvarDeclaracaoCorreio,
  type DeclaracaoCorreio,
} from "@/hooks/useCorreioDeclaracao";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { imprimirDeclaracao } from "@/lib/suprimentos/declaracaoPrint";
import { ExternalLink, FilePlus2, Loader2, Plus, Printer, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

type CampoTexto = Exclude<{
  [K in keyof DeclaracaoCorreio]: DeclaracaoCorreio[K] extends string ? K : never
}[keyof DeclaracaoCorreio], undefined>;

function Campo({
  label,
  campo,
  form,
  setForm,
  className,
}: {
  label: string;
  campo: CampoTexto;
  form: DeclaracaoCorreio;
  setForm: React.Dispatch<React.SetStateAction<DeclaracaoCorreio>>;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={`declaracao-${campo}`}>{label}</Label>
      <Input
        id={`declaracao-${campo}`}
        value={String(form[campo] ?? "")}
        onChange={(e) => setForm((atual) => ({ ...atual, [campo]: e.target.value }))}
      />
    </div>
  );
}

export default function CorreioDeclaracao() {
  const { data: empresaId } = useEmpresaId();
  const [form, setForm] = useState<DeclaracaoCorreio>(() => novaDeclaracao());
  const [protocoloBusca, setProtocoloBusca] = useState("");
  const [erroProtocolo, setErroProtocolo] = useState("");
  const [protocoloCarregado, setProtocoloCarregado] = useState("");
  const [buscando, setBuscando] = useState(false);
  const { data: declaracoes = [], isLoading } = useDeclaracoesCorreio(empresaId);
  const salvar = useSalvarDeclaracaoCorreio();

  useEffect(() => {
    if (!empresaId) return;
    setForm((atual) => atual.empresa_id ? atual : { ...atual, empresa_id: empresaId });
  }, [empresaId]);

  const buscarPedido = async () => {
    const protocolo = protocoloBusca.trim();
    if (!protocolo) return;
    if (protocolo.toUpperCase() === protocoloCarregado) return;
    setBuscando(true);
    setErroProtocolo("");
    try {
      const preenchida = await buscarPedidoParaDeclaracao(protocolo);
      // O retorno substitui apenas após sucesso. Protocolo inválido preserva
      // integralmente o que a pessoa já digitou na declaração atual.
      setForm(preenchida);
      setProtocoloBusca(preenchida.pedido_protocolo);
      setProtocoloCarregado(preenchida.pedido_protocolo.toUpperCase());
      toast.success("Dados do pedido preenchidos. Revise os endereços antes de salvar.");
    } catch (erro: unknown) {
      setErroProtocolo(erro instanceof Error ? erro.message : "ID interno não encontrado.");
    } finally {
      setBuscando(false);
    }
  };

  const aoEnterProtocolo = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === "Enter") {
      evento.preventDefault();
      void buscarPedido();
    }
  };

  const salvarForm = async () => {
    if (!form.empresa_id) {
      toast.error("Seu usuário não tem empresa definida.");
      return;
    }
    if (!form.sup_correio_declaracao_item.some((item) => item.conteudo.trim())) {
      toast.error("Informe pelo menos um item na declaração.");
      return;
    }
    try {
      const salvo = await salvar.mutateAsync(form);
      setForm(salvo);
      setProtocoloBusca(salvo.pedido_protocolo);
      toast.success(`${salvo.numero} salva com sucesso.`);
    } catch (erro: unknown) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar a declaração.");
    }
  };

  const imprimir = () => {
    try {
      imprimirDeclaracao(form);
    } catch (erro: unknown) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível abrir a impressão.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Declaração de Conteúdo"
        subtitle="Preencha, salve e imprima a declaração e os blocos de endereçamento dos Correios."
        module="Suprimentos"
        breadcrumb={["Declaração de Conteúdo"]}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild><a href="https://rastreamento.correios.com.br/app/index.php" target="_blank" rel="noopener noreferrer">Rastrear Pedido <ExternalLink className="ml-2 h-4 w-4" /></a></Button>
            <Button variant="outline" asChild><a href="https://empresas.correios.com.br/#/login" target="_blank" rel="noopener noreferrer">Dashboards Correio <ExternalLink className="ml-2 h-4 w-4" /></a></Button>
          </div>
        )}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-lg">{form.numero ?? "Nova declaração"}</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => { setForm(novaDeclaracao(empresaId ?? "")); setProtocoloBusca(""); setErroProtocolo(""); setProtocoloCarregado(""); }}>
            <FilePlus2 className="mr-2 h-4 w-4" /> Nova
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-xl">
            <Label htmlFor="declaracao-protocolo">ID interno</Label>
            <div className="flex gap-2">
              <Input
                id="declaracao-protocolo"
                value={protocoloBusca}
                onChange={(e) => {
                  setProtocoloBusca(e.target.value);
                  // Texto ainda não validado nunca pode conservar o vínculo
                  // com o pedido anteriormente carregado.
                  setForm((atual) => ({ ...atual, pedido_id: null, pedido_protocolo: "" }));
                  setErroProtocolo("");
                  setProtocoloCarregado("");
                }}
                onBlur={() => void buscarPedido()}
                onKeyDown={aoEnterProtocolo}
                placeholder="PED-MT095BHT-5UGFQIT"
                className="font-mono"
                aria-invalid={!!erroProtocolo}
              />
              <Button type="button" variant="secondary" onMouseDown={(e) => e.preventDefault()} onClick={() => void buscarPedido()} disabled={buscando || !protocoloBusca.trim()}>
                {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="sr-only">Buscar pedido</span>
              </Button>
            </div>
            {erroProtocolo && <p className="mt-1 text-xs text-destructive">{erroProtocolo}</p>}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <BlocoEndereco titulo="Remetente">
              <Campo label="Nome" campo="rem_nome" form={form} setForm={setForm} />
              <Campo label="CNPJ" campo="rem_cnpj" form={form} setForm={setForm} />
              <Campo label="Endereço" campo="rem_endereco" form={form} setForm={setForm} className="sm:col-span-2" />
              <Campo label="Complemento" campo="rem_complemento" form={form} setForm={setForm} />
              <Campo label="Bairro" campo="rem_bairro" form={form} setForm={setForm} />
              <Campo label="Cidade" campo="rem_cidade" form={form} setForm={setForm} />
              <Campo label="UF" campo="rem_uf" form={form} setForm={setForm} />
              <Campo label="CEP" campo="rem_cep" form={form} setForm={setForm} />
              <Campo label="Caixa Postal" campo="rem_caixa_postal" form={form} setForm={setForm} />
            </BlocoEndereco>
            <BlocoEndereco titulo="Destinatário">
              <Campo label="Nome" campo="dest_nome" form={form} setForm={setForm} />
              <Campo label="CNPJ" campo="dest_cnpj" form={form} setForm={setForm} />
              <Campo label="Endereço" campo="dest_endereco" form={form} setForm={setForm} className="sm:col-span-2" />
              <Campo label="Complemento" campo="dest_complemento" form={form} setForm={setForm} />
              <Campo label="Bairro" campo="dest_bairro" form={form} setForm={setForm} />
              <Campo label="Cidade" campo="dest_cidade" form={form} setForm={setForm} />
              <Campo label="UF" campo="dest_uf" form={form} setForm={setForm} />
              <Campo label="CEP" campo="dest_cep" form={form} setForm={setForm} />
            </BlocoEndereco>
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Identificação dos bens</h3>
              <Button type="button" size="sm" variant="outline" onClick={() => setForm((atual) => ({ ...atual, sup_correio_declaracao_item: [...atual.sup_correio_declaracao_item, { conteudo: "", quantidade: 1, valor: null, ordem: atual.sup_correio_declaracao_item.length }] }))}>
                <Plus className="mr-2 h-4 w-4" /> Item
              </Button>
            </div>
            <div className="space-y-2">
              {form.sup_correio_declaracao_item.map((item, indice) => (
                <div key={indice} className="grid items-end gap-2 rounded-md border p-3 md:grid-cols-[3rem_1fr_7rem_9rem_auto]">
                  <span className="pb-2 text-center text-sm font-medium">{indice + 1}</span>
                  <div><Label>Conteúdo</Label><Input value={item.conteudo} onChange={(e) => setForm((atual) => ({ ...atual, sup_correio_declaracao_item: atual.sup_correio_declaracao_item.map((linha, i) => i === indice ? { ...linha, conteudo: e.target.value } : linha) }))} /></div>
                  <div><Label>Quantidade</Label><Input type="number" min={1} value={item.quantidade} onChange={(e) => setForm((atual) => ({ ...atual, sup_correio_declaracao_item: atual.sup_correio_declaracao_item.map((linha, i) => i === indice ? { ...linha, quantidade: Math.max(1, Number(e.target.value) || 1) } : linha) }))} /></div>
                  <div><Label>Valor unitário</Label><Input type="number" min={0} step="0.01" value={item.valor ?? ""} onChange={(e) => setForm((atual) => ({ ...atual, sup_correio_declaracao_item: atual.sup_correio_declaracao_item.map((linha, i) => i === indice ? { ...linha, valor: e.target.value === "" ? null : Number(e.target.value) } : linha) }))} /></div>
                  <Button type="button" size="icon" variant="ghost" disabled={form.sup_correio_declaracao_item.length === 1} onClick={() => setForm((atual) => ({ ...atual, sup_correio_declaracao_item: atual.sup_correio_declaracao_item.filter((_, i) => i !== indice) }))} aria-label={`Remover item ${indice + 1}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-3">
            <div><Label htmlFor="declaracao-peso">Peso total (kg)</Label><Input id="declaracao-peso" type="number" min={0} step="0.001" value={form.peso_total_kg ?? ""} onChange={(e) => setForm((atual) => ({ ...atual, peso_total_kg: e.target.value === "" ? null : Number(e.target.value) }))} /></div>
            <Campo label="Cidade da assinatura" campo="assinatura_cidade" form={form} setForm={setForm} />
            <div><Label htmlFor="declaracao-data">Data da assinatura</Label><Input id="declaracao-data" type="date" value={form.assinatura_data} onChange={(e) => setForm((atual) => ({ ...atual, assinatura_data: e.target.value }))} /></div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={imprimir} disabled={!form.id}><Printer className="mr-2 h-4 w-4" /> Imprimir declaração</Button>
            <AcessoGate menu="sup_correio_declaracao" acao={form.id ? "alterar" : "incluir"}>
              <Button onClick={() => void salvarForm()} disabled={salvar.isPending || !form.empresa_id}>
                {salvar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar
              </Button>
            </AcessoGate>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Declarações já geradas</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
            : declaracoes.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma declaração salva.</p>
              : <div className="divide-y rounded-md border">{declaracoes.map((declaracao) => (
                <button key={declaracao.id} type="button" onClick={() => { setForm({ ...declaracao, sup_correio_declaracao_item: [...declaracao.sup_correio_declaracao_item].sort((a, b) => a.ordem - b.ordem) }); setProtocoloBusca(declaracao.pedido_protocolo); setErroProtocolo(""); setProtocoloCarregado(declaracao.pedido_protocolo.toUpperCase()); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="grid w-full gap-1 p-3 text-left hover:bg-muted/50 sm:grid-cols-[10rem_1fr_1fr_10rem] sm:items-center">
                  <span className="font-mono text-sm font-semibold">{declaracao.numero}</span>
                  <span className="text-sm">{declaracao.pedido_protocolo || "Sem pedido"}</span>
                  <span className="truncate text-sm">{declaracao.dest_nome || "Sem destinatário"}</span>
                  <span className="text-xs text-muted-foreground">{declaracao.criado_por_nome || "—"}<br />{declaracao.created_at ? new Date(declaracao.created_at).toLocaleString("pt-BR") : "—"}</span>
                </button>
              ))}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function BlocoEndereco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <section className="rounded-lg border p-4"><h3 className="mb-3 font-semibold">{titulo}</h3><div className="grid gap-3 sm:grid-cols-2">{children}</div></section>;
}
