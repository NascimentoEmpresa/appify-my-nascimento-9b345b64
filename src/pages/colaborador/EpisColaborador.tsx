import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chamarPortal } from "@/hooks/useColaboradorPortal";
import { DECLARACAO_EPI, dataHoraEpi, imprimirComprovanteEpi, type ItemEntregaEpi } from "@/lib/suprimentos/entregaEpi";
import { useSessaoColaborador } from "./ColaboradorShell";
import { Carregando, Erro, Secao, Vazio } from "./ui";

interface EntregaPortal {
  id: string;
  protocolo: string;
  empresa: string | null;
  contrato: string;
  posto: string;
  entregador: string;
  modo: "eletronico" | "fisico";
  itens: ItemEntregaEpi[];
  registrado_em: string;
  confirmado_em: string | null;
  confirmacao_hash: string | null;
  documentos: { id: string; legivel: boolean; anexado_em: string }[];
}

function baixarCopia(entrega: EntregaPortal, nome: string) {
  const conteudo = {
    documento: "Comprovante pessoal de recebimento de EPI", versao: 1,
    colaborador: nome, entrega_id: entrega.id, protocolo: entrega.protocolo,
    empresa: entrega.empresa, contrato: entrega.contrato, posto: entrega.posto,
    responsavel_pela_entrega: entrega.entregador, itens: entrega.itens,
    declaracao: DECLARACAO_EPI, registrado_em: entrega.registrado_em,
    confirmado_em: entrega.confirmado_em, hash_sha256: entrega.confirmacao_hash,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(conteudo, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url;
  a.download = `meu-comprovante-epi-${entrega.protocolo}.json`; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function EpisColaborador() {
  const { perfil } = useSessaoColaborador();
  const qc = useQueryClient();
  const [pagina, setPagina] = useState(0);
  const q = useQuery({
    queryKey: ["colaborador", "epi_entregas", pagina],
    queryFn: () => chamarPortal<EntregaPortal[]>("epi_entregas", { pagina }),
    retry: false,
  });
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [ciente, setCiente] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const confirmar = async (id: string) => {
    if (!ciente || !senha) return;
    setSalvando(true);
    try {
      const resultado = await chamarPortal<{ ok: boolean; error?: string }>("epi_confirmar", { entrega_id: id, senha });
      if (!resultado.ok) throw new Error(resultado.error ?? "Não foi possível confirmar.");
      setSenha(""); setCiente(false); setConfirmando(null);
      await qc.invalidateQueries({ queryKey: ["colaborador", "epi_entregas"] });
      toast.success("Recebimento confirmado. Seu comprovante está disponível para download.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível confirmar."); }
    finally { setSalvando(false); }
  };

  const abrirFicha = async (id: string) => {
    try {
      const { url } = await chamarPortal<{ url: string }>("epi_documento", { documento_id: id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível abrir a ficha."); }
  };

  if (q.isLoading) return <Carregando texto="Buscando suas entregas de EPI…" />;
  if (q.isError || !q.data) return <Erro erro={q.error} acao={<button className="text-sm underline" onClick={() => q.refetch()}>Tentar de novo</button>} />;
  return <div className="space-y-4">
    <h1 className="font-display text-xl font-bold">Meus EPIs</h1>
    <p className="text-sm text-muted-foreground">Confira cada equipamento antes de confirmar. Seu histórico e os comprovantes ficam aqui para consulta.</p>
    {q.data.length === 0 && <Vazio>Nenhuma entrega de EPI registrada para você.</Vazio>}
    {q.data.map((e) => <Secao key={e.id} titulo={`${e.protocolo} · ${e.contrato}`}
      descricao={`Registrado em ${dataHoraEpi(e.registrado_em)} · ${e.posto}`}>
      <div className="space-y-3 text-sm">
        <p><b>Responsável pela entrega:</b> {e.entregador}</p>
        <ul className="list-inside list-disc space-y-1">
          {e.itens.map((i) => <li key={`${i.pedido_item_id}-${i.codigo}`}>
            {i.quantidade} × {i.descricao}{i.tamanho ? ` · ${i.tamanho}` : ""} · CA {i.ca ?? "não informado"} · lote {i.codigo}
          </li>)}
        </ul>
        {e.confirmado_em ? <>
          <p className="font-semibold text-green-700">Recebido e confirmado em {dataHoraEpi(e.confirmado_em)}</p>
          <p className="break-all text-xs text-muted-foreground">Identificador SHA-256: {e.confirmacao_hash}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { try { imprimirComprovanteEpi({
              protocolo: e.protocolo, colaborador: perfil.nome, matricula: perfil.matricula,
              empresa: e.empresa, contrato: e.contrato, posto: e.posto, responsavel: e.entregador,
              itens: e.itens, confirmadoEm: e.confirmado_em, hash: e.confirmacao_hash,
            }); } catch (erro) { toast.error((erro as Error).message); } }}>Imprimir / salvar PDF</Button>
            <Button variant="outline" onClick={() => baixarCopia(e, perfil.nome)}>Baixar dados JSON</Button>
          </div>
        </> : e.modo === "fisico" ? (
          <div className="space-y-1">
            {e.documentos.length === 0 && <p className="text-amber-700">Ficha física aguardando conferência pela empresa.</p>}
            {e.documentos.map((d) => <button key={d.id} className="block text-left text-primary underline" onClick={() => abrirFicha(d.id)}>
              Baixar ficha de {dataHoraEpi(d.anexado_em)} ({d.legivel ? "legível" : "ilegível"})
            </button>)}
          </div>
        ) : !perfil.senha_propria ? (
          <p className="text-amber-700">Para confirmar, <Link className="underline" to="/colaborador/perfil">defina uma senha pessoal no seu perfil</Link>.</p>
        ) : confirmando === e.id ? <div className="space-y-3 rounded-lg border p-3">
          <p>{DECLARACAO_EPI}</p>
          <label className="flex items-start gap-2"><Checkbox checked={ciente} onCheckedChange={(v) => setCiente(v === true)} />
            <span>Conferi os EPIs e confirmo a declaração acima.</span></label>
          <div><Label htmlFor={`senha-epi-${e.id}`}>Digite sua senha pessoal para confirmar</Label>
            <Input id={`senha-epi-${e.id}`} type="password" autoComplete="current-password" value={senha} onChange={(v) => setSenha(v.target.value)} /></div>
          <div className="flex gap-2"><Button disabled={!ciente || !senha || salvando} onClick={() => confirmar(e.id)}>Confirmar recebimento</Button>
            <Button variant="outline" onClick={() => { setConfirmando(null); setSenha(""); setCiente(false); }}>Cancelar</Button></div>
        </div> : <Button onClick={() => setConfirmando(e.id)}>Conferir e confirmar recebimento</Button>}
      </div>
    </Secao>)}
    <div className="flex justify-end gap-2">
      <Button variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
      <span className="self-center text-sm">Página {pagina + 1}</span>
      <Button variant="outline" disabled={q.data.length < 50} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
    </div>
  </div>;
}
