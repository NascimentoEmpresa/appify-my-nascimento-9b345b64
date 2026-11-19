import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Download, FilePlus2, Loader2, Search } from "lucide-react";
import {
  DECLARACAO_EPI, ROTULO_SITUACAO_EPI, dataEpi, dataHoraEpi, imprimirComprovanteEpi,
  type EntregaEpi,
} from "@/lib/suprimentos/entregaEpi";

// As RPCs da migration SIS-2026-0821 ainda nao constam no types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface PedidoParaEntrega {
  id: string;
  pedido_id: string;
  nome_colaborador: string;
  matricula_colaborador: string | null;
  colaborador_empregado_id: number | null;
  contrato_nome: string;
  posto_nome: string;
  status: string;
  data_solicitacao: string;
}

function baixarComprovante(entrega: EntregaEpi) {
  const comprovante = {
    documento: "Comprovante de entrega de EPI", versao: 1,
    protocolo: entrega.protocolo, entrega_id: entrega.id,
    colaborador: entrega.colaborador_nome, matricula: entrega.matricula,
    empresa: entrega.empresa_nome, contrato: entrega.contrato_nome,
    posto: entrega.posto_nome, funcao: entrega.funcao_nome,
    solicitado_em: entrega.solicitado_em, separado_em: entrega.separado_em,
    enviado_em: entrega.enviado_em, registrado_em: entrega.registrado_em,
    responsavel_pela_entrega: entrega.entregador_nome,
    itens: entrega.itens, declaracao: DECLARACAO_EPI,
    confirmado_em: entrega.confirmado_em, hash_sha256: entrega.confirmacao_hash,
    situacao: ROTULO_SITUACAO_EPI[entrega.situacao],
    documentos: entrega.documentos.map(({ id, legivel, anexado_em }) => ({ id, legivel, anexado_em })),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(comprovante, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `comprovante-epi-${entrega.protocolo}-${entrega.id}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface EntregasEpiProps {
  menuCodigo?: "sup_epi_entregas" | "ope_epi_entregas";
  modulo?: "Suprimentos" | "Operacional";
}

export default function EntregasEpi({ menuCodigo = "sup_epi_entregas", modulo = "Suprimentos" }: EntregasEpiProps = {}) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [situacao, setSituacao] = useState("todas");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [pagina, setPagina] = useState(0);
  const [selecionada, setSelecionada] = useState<EntregaEpi | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [buscaPedido, setBuscaPedido] = useState("");
  const [termoPedido, setTermoPedido] = useState("");
  const [pedido, setPedido] = useState<PedidoParaEntrega | null>(null);
  const [entregador, setEntregador] = useState("");
  const [modo, setModo] = useState<"eletronico" | "fisico">("eletronico");
  const [salvando, setSalvando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [legivel, setLegivel] = useState(false);
  const [observacao, setObservacao] = useState("");

  const lista = useQuery({
    queryKey: ["sup_epi_entregas", termo, situacao, inicio, fim, pagina],
    queryFn: async (): Promise<EntregaEpi[]> => {
      const { data, error } = await sb.rpc("sup_epi_entregas_buscar", {
        p_termo: termo || null, p_status: situacao === "todas" ? null : situacao,
        p_inicio: inicio || null, p_fim: fim || null, p_pagina: pagina,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const pedidos = useQuery({
    queryKey: ["sup_epi_pedidos_para_entrega", termoPedido],
    enabled: abrindo,
    queryFn: async (): Promise<PedidoParaEntrega[]> => {
      const { data, error } = await sb.rpc("sup_epi_pedidos_para_entrega", { p_termo: termoPedido || null });
      if (error) throw error;
      return data ?? [];
    },
  });

  const atualizar = async () => {
    await qc.invalidateQueries({ queryKey: ["sup_epi_entregas"] });
    await qc.invalidateQueries({ queryKey: ["sup_epi_pedidos_para_entrega"] });
  };

  const registrar = async () => {
    if (!pedido || entregador.trim().length < 3) { toast.error("Selecione o pedido e informe o responsável pela entrega."); return; }
    setSalvando(true);
    try {
      const { error } = await sb.rpc("sup_epi_entrega_abrir", {
        p_pedido: pedido.id, p_entregador: entregador.trim(), p_modo: modo,
      });
      if (error) throw error;
      toast.success("Entrega registrada. Aguarde a confirmação do colaborador ou a ficha física.");
      setAbrindo(false); setPedido(null); setEntregador("");
      await atualizar();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível registrar."); }
    finally { setSalvando(false); }
  };

  const anexar = async () => {
    if (!selecionada || !arquivo) return;
    if (!(["application/pdf", "image/png", "image/jpeg"].includes(arquivo.type)) || arquivo.size > 10 * 1024 * 1024) {
      toast.error("Use PDF, PNG ou JPG de até 10 MB."); return;
    }
    setSalvando(true);
    try {
      const extensao = arquivo.type === "application/pdf" ? "pdf" : arquivo.type === "image/png" ? "png" : "jpg";
      const path = `${selecionada.id}/${crypto.randomUUID()}.${extensao}`;
      const upload = await sb.storage.from("epi-entregas").upload(path, arquivo, { contentType: arquivo.type, upsert: false });
      if (upload.error) throw upload.error;
      const { error } = await sb.rpc("sup_epi_entrega_documento", {
        p_entrega: selecionada.id, p_path: path, p_legivel: legivel, p_obs: observacao || null,
      });
      if (error) throw error;
      toast.success(legivel ? "Ficha legível registrada." : "Ficha sinalizada como ilegível.");
      setArquivo(null); setLegivel(false); setObservacao("");
      await atualizar();
      setSelecionada(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível anexar."); }
    finally { setSalvando(false); }
  };

  const verDocumento = async (path: string) => {
    const { data, error } = await sb.storage.from("epi-entregas").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { toast.error(error?.message ?? "Não foi possível abrir a ficha."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Entrega de EPIs" module={modulo} breadcrumb={["Entrega de EPIs"]}
        subtitle="Da separação ao comprovante de recebimento, com histórico para SST e Jurídico."
        actions={<AcessoGate menu={menuCodigo} acao="alterar"><Button onClick={() => setAbrindo(true)}><FilePlus2 className="mr-2 h-4 w-4" /> Registrar entrega</Button></AcessoGate>} />

      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <form className="flex gap-2 sm:col-span-2" onSubmit={(e) => { e.preventDefault(); setPagina(0); setTermo(busca.trim()); }}>
          <Input aria-label="Buscar colaborador, CPF, contrato ou EPI" placeholder="Nome, CPF, contrato ou EPI" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Button type="submit" variant="outline" aria-label="Pesquisar"><Search className="h-4 w-4" /></Button>
        </form>
        <Select value={situacao} onValueChange={(v) => { setSituacao(v); setPagina(0); }}>
          <SelectTrigger><SelectValue placeholder="Situação" /></SelectTrigger>
          <SelectContent><SelectItem value="todas">Todas as situações</SelectItem>
            {Object.entries(ROTULO_SITUACAO_EPI).map(([valor, rotulo]) => <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" aria-label="Data inicial" value={inicio} onChange={(e) => { setInicio(e.target.value); setPagina(0); }} />
        <Input type="date" aria-label="Data final" value={fim} onChange={(e) => { setFim(e.target.value); setPagina(0); }} />
      </div>
      {lista.isLoading && <p className="text-sm text-muted-foreground">Carregando entregas…</p>}
      {lista.isError && <p className="text-sm text-destructive">{(lista.error as Error).message}</p>}
      {lista.data?.length === 0 && <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">Nenhuma entrega encontrada. Pedidos antigos não são presumidos como entregues.</p>}
      <div className="space-y-2">
        {lista.data?.map((e) => <button key={e.id} type="button" onClick={() => setSelecionada(e)}
          className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 text-left hover:border-primary">
          <span><strong className="block">{e.colaborador_nome}</strong><span className="text-xs text-muted-foreground">{e.protocolo} · {e.contrato_nome} · {dataHoraEpi(e.registrado_em)}</span></span>
          <Badge variant={e.situacao === "confirmado" || e.situacao === "ficha_recebida" ? "default" : "secondary"}>{ROTULO_SITUACAO_EPI[e.situacao]}</Badge>
        </button>)}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
        <span className="self-center text-sm">Página {pagina + 1}</span>
        <Button variant="outline" disabled={(lista.data?.length ?? 0) < 50} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
      </div>

      <Dialog open={abrindo} onOpenChange={setAbrindo}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Registrar entrega de EPI</DialogTitle><DialogDescription>Registre no momento da entrega ao colaborador. Selecione um pedido já retirado ou despachado; o sistema congela os itens de EPI efetivamente baixados no estoque.</DialogDescription></DialogHeader>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTermoPedido(buscaPedido.trim()); }}>
            <Input placeholder="Protocolo ou colaborador" value={buscaPedido} onChange={(e) => setBuscaPedido(e.target.value)} />
            <Button type="submit" variant="outline">Buscar</Button>
          </form>
          {pedidos.isLoading && <p className="text-sm">Buscando pedidos…</p>}
          {pedidos.isError && <p className="text-sm text-destructive">{(pedidos.error as Error).message}</p>}
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {pedidos.data?.map((p) => <button key={p.id} type="button" onClick={() => setPedido(p)}
              className={`w-full rounded border p-2 text-left text-sm ${pedido?.id === p.id ? "border-primary bg-primary/5" : ""}`}>
              <strong>{p.pedido_id}</strong> · {p.nome_colaborador} · {p.contrato_nome}
              {!p.colaborador_empregado_id && <span className="block text-xs text-amber-700">Sem vínculo com RH: vincule o colaborador no pedido antes de registrar.</span>}
            </button>)}
          </div>
          <div><Label>Responsável que entregou ao colaborador</Label><Input value={entregador} onChange={(e) => setEntregador(e.target.value)} /></div>
          <div><Label>Forma de comprovação</Label>
            <Select value={modo} onValueChange={(v) => setModo(v as "eletronico" | "fisico")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="eletronico">Confirmação pessoal no Portal do Colaborador</SelectItem>
              <SelectItem value="fisico">Ficha física assinada e anexada</SelectItem>
            </SelectContent></Select>
          </div>
          <Button disabled={!pedido || salvando} onClick={registrar}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Registrar entrega</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selecionada} onOpenChange={(v) => !v && setSelecionada(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {selecionada && <>
            <DialogHeader><DialogTitle>{selecionada.colaborador_nome} · {selecionada.protocolo}</DialogTitle>
              <DialogDescription>{ROTULO_SITUACAO_EPI[selecionada.situacao]} · {selecionada.empresa_nome ?? "Empresa não informada"}</DialogDescription></DialogHeader>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p><b>Contrato:</b> {selecionada.contrato_nome}</p><p><b>Posto:</b> {selecionada.posto_nome}</p>
              <p><b>Função:</b> {selecionada.funcao_nome}</p><p><b>Matrícula:</b> {selecionada.matricula ?? "—"}</p>
              <p><b>CPF:</b> {selecionada.cpf}</p>
              <p><b>Solicitado:</b> {dataEpi(selecionada.solicitado_em)}</p><p><b>Separado:</b> {dataHoraEpi(selecionada.separado_em)}</p>
              <p><b>Enviado ao Operacional:</b> {dataHoraEpi(selecionada.enviado_em)}</p><p><b>Entrega informada:</b> {dataHoraEpi(selecionada.registrado_em)}</p>
              <p><b>Responsável:</b> {selecionada.entregador_nome}</p><p><b>Confirmado:</b> {dataHoraEpi(selecionada.confirmado_em)}</p>
            </div>
            <div className="space-y-1 rounded border p-3 text-sm"><h3 className="font-semibold">EPIs registrados</h3>
              {selecionada.itens.map((i) => <p key={`${i.pedido_item_id}-${i.codigo}`}>{i.quantidade} × {i.descricao}{i.tamanho ? ` · ${i.tamanho}` : ""} · Lote {i.codigo} · CA {i.ca ?? "não informado"}{i.ca_validade ? ` · validade ${dataEpi(i.ca_validade)}` : ""}</p>)}
            </div>
            <p className="rounded border bg-muted/30 p-3 text-sm">{DECLARACAO_EPI}</p>
            {selecionada.confirmacao_hash && <p className="break-all text-xs"><b>SHA-256 do comprovante:</b> {selecionada.confirmacao_hash}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={selecionada.situacao !== "confirmado"} onClick={() => { try { imprimirComprovanteEpi({
                protocolo: selecionada.protocolo, colaborador: selecionada.colaborador_nome,
                matricula: selecionada.matricula, empresa: selecionada.empresa_nome,
                contrato: selecionada.contrato_nome, posto: selecionada.posto_nome,
                responsavel: selecionada.entregador_nome, itens: selecionada.itens,
                confirmadoEm: selecionada.confirmado_em, hash: selecionada.confirmacao_hash,
              }); } catch (e) { toast.error((e as Error).message); } }}>Imprimir / salvar PDF</Button>
              <Button variant="outline" onClick={() => baixarComprovante(selecionada)}><Download className="mr-2 h-4 w-4" /> Baixar dados JSON</Button>
            </div>
            {selecionada.modo === "fisico" && <>
              <h3 className="font-semibold">Fichas anexadas</h3>
              {selecionada.documentos.length === 0 && <p className="text-sm text-muted-foreground">Ficha ainda não devolvida.</p>}
              {selecionada.documentos.map((d) => <button key={d.id} className="block text-left text-sm text-primary underline" onClick={() => verDocumento(d.path)}>
                {dataHoraEpi(d.anexado_em)} · {d.legivel ? "Legível" : "Ilegível"}{d.observacao ? ` · ${d.observacao}` : ""}
              </button>)}
              <AcessoGate menu={menuCodigo} acao="alterar"><div className="space-y-3 rounded border p-3">
                <div><Label>Foto ou PDF da ficha</Label><Input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /></div>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={legivel} onCheckedChange={(v) => setLegivel(v === true)} /> Documento legível</label>
                <Textarea placeholder="Observação sobre a ficha" maxLength={500} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
                <Button disabled={!arquivo || salvando} onClick={anexar}>Anexar sem apagar as versões anteriores</Button>
              </div></AcessoGate>
            </>}
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
