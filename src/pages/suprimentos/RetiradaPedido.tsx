import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ESTILO_STATUS } from "@/hooks/useSupPedidos";
import { AlertTriangle, CheckCircle2, Loader2, PackageSearch, Search, ShieldAlert, Truck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  montarPedidosRetiradaRomaneio,
  respostasRomaneioCompletas,
  type RespostaDocumentosRomaneio,
} from "@/lib/suprimentos/romaneio";

/**
 * Retirada do pedido para entrega — a tela que o QR code da etiqueta abre.
 *
 * O estoque físico fecha fora do horário comercial, e os pedidos separados
 * ficam do lado de fora. O Supervisor Operacional (frota própria) lê o QR com
 * a câmera do celular, confere o volume e confirma: o pedido vai para
 * RETIRADO PARA ENTREGA, com o nome dele e o horário no histórico.
 *
 * A tela é pensada para celular, em pé, na rua: um card, letras grandes, um
 * botão só. O login é o normal do ERP — feito uma vez, a sessão fica guardada
 * no navegador do celular e as próximas leituras já caem direto aqui
 * (ProtectedRoute devolve para esta rota depois do login, via `?next=`).
 *
 * Quem pode confirmar é decidido no banco (sup_retirada_consultar /
 * sup_retirada_confirmar): login real + tela "Retirada para Entrega" liberada
 * em Acesso por Usuário. Quem apenas achar a etiqueta e escanear cai na tela
 * de login e não passa dali.
 *
 * Ver supabase/migrations/20260930000094_sup_retirada_entrega_qrcode.sql.
 */

const sb = supabase as any;

interface PedidoRetirada {
  id: string;
  pedido_id: string;
  status: string;
  nome_colaborador: string;
  contrato_nome: string;
  posto_nome: string;
  funcao_nome: string;
  itens: { nome_item: string; tamanho: string | null; quantidade: number; litros: string | null }[];
  retirado_em: string | null;
  retirado_por_nome: string | null;
  usuario_nome: string | null;
  pode_retirar: boolean;
  pode_confirmar: boolean;
}

interface ResultadoRetirada {
  ja_retirado: boolean;
  pedido_id: string;
  retirado_em: string;
  retirado_por_nome: string;
}

type PedidoRetiradaRomaneio = PedidoRetirada;

interface RomaneioRetirada {
  id: string;
  codigo: string;
  contrato_nome: string;
  status: "ABERTO" | "RETIRADO" | "CANCELADO";
  volumes: number | null;
  observacao: string | null;
  pedidos: PedidoRetiradaRomaneio[];
  retirado_em: string | null;
  retirado_por_nome: string | null;
  usuario_nome: string | null;
  pode_confirmar: boolean;
}

interface ResultadoRetiradaRomaneio {
  ja_retirado: boolean;
  codigo: string;
  retirado_em: string;
  retirado_por_nome: string;
  retirados: Array<{ pedido_id: string }>;
  removidos: Array<{ pedido_id: string; motivo: string }>;
  pulados: Array<{ pedido_id: string; motivo: string }>;
}

function fmtDataHora(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function RetiradaPedido() {
  const { ref } = useParams();
  // `key` na referência: ler outro QR na mesma aba remonta a tela do zero,
  // sem carregar o "retirada confirmada" do pedido anterior.
  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="flex items-center gap-2">
        <Truck className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Retirada para entrega</h1>
      </div>
      {ref ? <RetiradaPorTipo key={ref} referencia={ref} /> : <BuscaManual />}
    </div>
  );
}

function RetiradaPorTipo({ referencia }: { referencia: string }) {
  const { data: tipo, isLoading, error } = useQuery({
    queryKey: ["sup_retirada_tipo", referencia],
    queryFn: async (): Promise<"ROMANEIO" | "PEDIDO" | null> => {
      const { data, error } = await sb.rpc("sup_retirada_tipo", { p_ref: referencia });
      if (error) throw error;
      return data ?? null;
    },
  });

  if (isLoading) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Identificando o QR code…
      </p>
    );
  }
  if (error) {
    return (
      <Aviso tom="erro" icone={ShieldAlert} titulo="Não foi possível abrir a retirada">
        {(error as Error).message}
      </Aviso>
    );
  }
  return tipo === "ROMANEIO"
    ? <ConfirmarRomaneio referencia={referencia} />
    : <ConfirmarRetirada referencia={referencia} />;
}

/** Para quando o QR não lê — etiqueta molhada, rasgada, câmera ruim. */
function BuscaManual() {
  const navigate = useNavigate();
  const [protocolo, setProtocolo] = useState("");

  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    const v = protocolo.trim().toUpperCase();
    if (v) navigate(`/app/suprimentos/retirada/${encodeURIComponent(v)}`);
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="text-sm text-muted-foreground">
          Leia o QR code da etiqueta com a câmera do celular. Se não der, digite o
          código do pedido ou do romaneio impresso logo abaixo do cabeçalho.
        </p>
        <form onSubmit={buscar} className="space-y-3">
          <div>
            <Label htmlFor="retirada-protocolo">Protocolo do pedido ou romaneio</Label>
            <Input
              id="retirada-protocolo"
              value={protocolo}
              onChange={(e) => setProtocolo(e.target.value)}
              placeholder="PED-20260902-0012 ou ROM-20260930-0012"
              className="font-mono uppercase"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>
          <Button type="submit" className="w-full" disabled={!protocolo.trim()}>
            <Search className="mr-2 h-4 w-4" /> Buscar pedido
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ConfirmarRomaneio({ referencia }: { referencia: string }) {
  const qc = useQueryClient();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [fichaEpi, setFichaEpi] = useState<RespostaDocumentosRomaneio>("");
  const [cracha, setCracha] = useState<RespostaDocumentosRomaneio>("");
  const [fichaAlguns, setFichaAlguns] = useState<Set<string>>(new Set());
  const [crachaAlguns, setCrachaAlguns] = useState<Set<string>>(new Set());
  const [resultado, setResultado] = useState<ResultadoRetiradaRomaneio | null>(null);

  const { data: romaneio, isLoading, error } = useQuery({
    queryKey: ["sup_retirada_romaneio", referencia],
    queryFn: async (): Promise<RomaneioRetirada | null> => {
      const { data, error } = await sb.rpc("sup_retirada_romaneio_consultar", { p_ref: referencia });
      if (error) throw error;
      return data ?? null;
    },
  });

  // Marca tudo UMA vez, na primeira carga. Sem a trava, qualquer refetch
  // (o supervisor troca para a câmera ou o WhatsApp e volta depois de 30 s,
  // staleTime do App) remarcava em silêncio o pedido que ele tinha acabado
  // de desmarcar por não estar no volume — e a confirmação o daria como
  // retirado. Só entra marcado o que ainda pode ser retirado; o resto o
  // banco pularia de qualquer forma.
  const selecaoInicial = useRef(false);
  useEffect(() => {
    if (selecaoInicial.current || !romaneio || romaneio.status !== "ABERTO") return;
    selecaoInicial.current = true;
    setSelecionados(new Set(
      romaneio.pedidos.filter((pedido) => pedido.status === "AGUARDANDO ENVIO").map((pedido) => pedido.id),
    ));
  }, [romaneio]);

  const confirmar = useMutation({
    mutationFn: async (): Promise<ResultadoRetiradaRomaneio> => {
      if (!romaneio || !respostasRomaneioCompletas(fichaEpi, cracha)) {
        throw new Error("Responda as duas perguntas sobre documentos físicos.");
      }
      const { data, error } = await sb.rpc("sup_retirada_romaneio_confirmar", {
        p_ref: referencia,
        p_pedidos: montarPedidosRetiradaRomaneio(
          romaneio.pedidos,
          selecionados,
          fichaEpi as Exclude<RespostaDocumentosRomaneio, "">,
          fichaAlguns,
          cracha as Exclude<RespostaDocumentosRomaneio, "">,
          crachaAlguns,
        ),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (valor) => {
      setResultado(valor);
      qc.invalidateQueries({ queryKey: ["sup_retirada_romaneio", referencia] });
      qc.invalidateQueries({ queryKey: ["sup_pedido"] });
      toast.success(valor.ja_retirado
        ? `${valor.codigo} já estava retirado.`
        : `Retirada de ${valor.retirados.length} pedido(s) confirmada.`);
    },
    onError: (erro: unknown) => toast.error(erro instanceof Error ? erro.message : "Não foi possível confirmar o romaneio."),
  });

  const alternar = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  };

  if (isLoading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">Carregando romaneio…</p>;
  }
  if (error) {
    return <Aviso tom="erro" icone={ShieldAlert} titulo="Não foi possível abrir o romaneio">{(error as Error).message}</Aviso>;
  }
  if (!romaneio) {
    return <Aviso tom="erro" icone={PackageSearch} titulo="Romaneio não encontrado">Confira o código impresso e tente novamente.</Aviso>;
  }

  const finalizado = resultado ?? (romaneio.status === "RETIRADO" ? {
    ja_retirado: true,
    codigo: romaneio.codigo,
    retirado_em: romaneio.retirado_em ?? "",
    retirado_por_nome: romaneio.retirado_por_nome ?? "—",
    retirados: [], removidos: [], pulados: [],
  } : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2 pb-3 text-center">
          <p className="font-mono text-xl font-bold">{romaneio.codigo}</p>
          <Badge variant="outline">Romaneio · {romaneio.status}</Badge>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p><strong>Contrato:</strong> {romaneio.contrato_nome}</p>
          <p><strong>Volumes:</strong> {romaneio.volumes ?? "Não informado"}</p>
          {romaneio.observacao && <p><strong>Observação:</strong> {romaneio.observacao}</p>}
        </CardContent>
      </Card>

      {finalizado ? (
        <div className="space-y-3">
          <Aviso tom="ok" icone={CheckCircle2} titulo={finalizado.ja_retirado ? "Este romaneio já foi retirado" : "Retirada confirmada"}>
            {finalizado.retirado_por_nome} confirmou em {fmtDataHora(finalizado.retirado_em)}.
          </Aviso>
          {!finalizado.ja_retirado && (
            <Card><CardContent className="space-y-2 pt-5 text-sm">
              <p><strong>Retirados:</strong> {finalizado.retirados.length}</p>
              <p><strong>Desmarcados:</strong> {finalizado.removidos.length}</p>
              {finalizado.pulados.length > 0 && (
                <div>
                  <p className="font-medium text-amber-700">Pulados durante a conferência:</p>
                  <ul className="list-disc pl-5 text-muted-foreground">
                    {finalizado.pulados.map((pedido) => <li key={pedido.pedido_id}>{pedido.pedido_id}: {pedido.motivo}</li>)}
                  </ul>
                </div>
              )}
            </CardContent></Card>
          )}
        </div>
      ) : romaneio.status === "CANCELADO" ? (
        <Aviso tom="alerta" icone={AlertTriangle} titulo="Romaneio cancelado">Não retire os pedidos desta folha.</Aviso>
      ) : !romaneio.pode_confirmar ? (
        <Aviso tom="alerta" icone={ShieldAlert} titulo="Seu usuário não pode confirmar retirada">
          Peça a liberação de "Retirada para Entrega" em Acesso por Usuário.
        </Aviso>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm font-medium">Confira os pedidos que estão nos volumes</p>
              {romaneio.pedidos.map((pedido) => (
                <label key={pedido.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    className="mt-1"
                    checked={selecionados.has(pedido.id)}
                    onCheckedChange={() => alternar(setSelecionados, pedido.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm font-medium">{pedido.pedido_id}</span>
                    <span className="block text-xs text-muted-foreground">{pedido.nome_colaborador || "Sem colaborador"} · {pedido.posto_nome}</span>
                    <span className="mt-1 block text-xs">{pedido.itens.map((item) => `${item.nome_item} (${item.quantidade})`).join(" · ")}</span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>

          <PerguntaDocumentos
            id="romaneio-ficha"
            titulo="Os pedidos têm Ficha de EPI física?"
            resposta={fichaEpi}
            onResposta={setFichaEpi}
            pedidos={romaneio.pedidos.filter((pedido) => selecionados.has(pedido.id))}
            alguns={fichaAlguns}
            onAlternar={(id) => alternar(setFichaAlguns, id)}
          />
          <PerguntaDocumentos
            id="romaneio-cracha"
            titulo="Os pedidos têm Crachá físico?"
            resposta={cracha}
            onResposta={setCracha}
            pedidos={romaneio.pedidos.filter((pedido) => selecionados.has(pedido.id))}
            alguns={crachaAlguns}
            onAlternar={(id) => alternar(setCrachaAlguns, id)}
          />

          <Button
            size="lg"
            className="h-14 w-full text-base"
            disabled={confirmar.isPending || selecionados.size === 0 || !respostasRomaneioCompletas(fichaEpi, cracha)}
            onClick={() => confirmar.mutate()}
          >
            {confirmar.isPending
              ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Confirmando…</>
              : <><Truck className="mr-2 h-5 w-5" /> Confirmar retirada de {selecionados.size} pedidos</>}
          </Button>
          {romaneio.usuario_nome && (
            <p className="text-center text-xs text-muted-foreground">
              A retirada fica registrada no nome de <strong>{romaneio.usuario_nome}</strong>.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PerguntaDocumentos({
  id, titulo, resposta, onResposta, pedidos, alguns, onAlternar,
}: {
  id: string;
  titulo: string;
  resposta: RespostaDocumentosRomaneio;
  onResposta: (resposta: RespostaDocumentosRomaneio) => void;
  pedidos: PedidoRetiradaRomaneio[];
  alguns: Set<string>;
  onAlternar: (id: string) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <Label htmlFor={id}>{titulo}</Label>
        <Select value={resposta} onValueChange={(valor: Exclude<RespostaDocumentosRomaneio, "">) => onResposta(valor)}>
          <SelectTrigger id={id}><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Todos</SelectItem>
            <SelectItem value="NENHUM">Nenhum</SelectItem>
            <SelectItem value="ALGUNS">Alguns</SelectItem>
          </SelectContent>
        </Select>
        {resposta === "ALGUNS" && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            {pedidos.map((pedido) => (
              <label key={pedido.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={alguns.has(pedido.id)} onCheckedChange={() => onAlternar(pedido.id)} />
                <span className="font-mono">{pedido.pedido_id}</span>
                <span className="truncate text-muted-foreground">{pedido.nome_colaborador}</span>
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmarRetirada({ referencia }: { referencia: string }) {
  const qc = useQueryClient();
  const [resultado, setResultado] = useState<ResultadoRetirada | null>(null);
  // A resposta precisa ser deliberada: assumir "N\u00e3o" quando a pessoa s\u00f3
  // leu o QR code apagaria justamente a evid\u00eancia que esta etapa existe para
  // guardar. As duas respostas seguem junto na mesma transa\u00e7\u00e3o da retirada.
  const [fichaEpiFisica, setFichaEpiFisica] = useState<"SIM" | "NAO" | "">("");
  const [crachaFisico, setCrachaFisico] = useState<"SIM" | "NAO" | "">("");

  const { data: pedido, isLoading, error } = useQuery({
    queryKey: ["sup_retirada", referencia],
    queryFn: async (): Promise<PedidoRetirada | null> => {
      const { data, error } = await sb.rpc("sup_retirada_consultar", { p_ref: referencia });
      if (error) throw error;
      return data ?? null;
    },
  });

  const confirmar = useMutation({
    mutationFn: async (): Promise<ResultadoRetirada> => {
      const { data, error } = await sb.rpc("sup_retirada_confirmar_com_documentos", {
        p_ref: referencia,
        p_possui_ficha_epi_fisica: fichaEpiFisica === "SIM",
        p_possui_cracha_fisico: crachaFisico === "SIM",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (r) => {
      setResultado(r);
      qc.invalidateQueries({ queryKey: ["sup_retirada", referencia] });
      qc.invalidateQueries({ queryKey: ["sup_pedido"] });
      if (r.ja_retirado) toast.info(`${r.pedido_id} já estava retirado.`);
      else toast.success(`Retirada de ${r.pedido_id} confirmada.`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível confirmar a retirada."),
  });

  if (isLoading) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Buscando o pedido…
      </p>
    );
  }

  // Falha de permissão chega aqui como erro da RPC — e precisa aparecer como
  // tal. Tela vazia faria o supervisor achar que o QR está com defeito.
  if (error) {
    return (
      <Aviso tom="erro" icone={ShieldAlert} titulo="Não foi possível abrir o pedido">
        {(error as Error).message}
      </Aviso>
    );
  }

  if (!pedido) {
    return (
      <div className="space-y-3">
        <Aviso tom="erro" icone={PackageSearch} titulo="Pedido não encontrado">
          O código lido não corresponde a nenhum pedido. Confira o protocolo impresso
          na etiqueta e busque à mão.
        </Aviso>
        <Button asChild variant="outline" className="w-full">
          <Link to="/app/suprimentos/retirada">Digitar o protocolo</Link>
        </Button>
      </div>
    );
  }

  const estilo = ESTILO_STATUS[pedido.status];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2 pb-3 text-center">
          <p className="font-mono text-xl font-bold tracking-tight">{pedido.pedido_id}</p>
          <div>
            <Badge variant="outline" className={cn(estilo?.classe)}>{estilo?.rotulo ?? pedido.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
            {pedido.nome_colaborador && (<><dt className="text-muted-foreground">Colaborador</dt><dd className="font-medium">{pedido.nome_colaborador}</dd></>)}
            <dt className="text-muted-foreground">Contrato</dt><dd>{pedido.contrato_nome}</dd>
            <dt className="text-muted-foreground">Posto</dt><dd>{pedido.posto_nome}</dd>
            <dt className="text-muted-foreground">Função</dt><dd>{pedido.funcao_nome}</dd>
          </dl>
          {pedido.itens.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Itens ({pedido.itens.length})
              </p>
              <ul className="space-y-0.5">
                {pedido.itens.map((i, n) => (
                  <li key={n} className="flex justify-between gap-2 text-xs">
                    <span>{i.nome_item}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {[i.tamanho && `Tam. ${i.tamanho}`, i.litros && `${i.litros} L`, `Qtd. ${i.quantidade}`]
                        .filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {resultado && !resultado.ja_retirado ? (
        <Aviso tom="ok" icone={CheckCircle2} titulo="Retirada confirmada">
          {resultado.retirado_por_nome} retirou {resultado.pedido_id} em {fmtDataHora(resultado.retirado_em)}.
          Pode fechar esta aba e ler o próximo QR code.
        </Aviso>
      ) : pedido.status === "RETIRADO PARA ENTREGA" ? (
        <Aviso tom="ok" icone={CheckCircle2} titulo="Este pedido já foi retirado">
          Retirado por <strong>{pedido.retirado_por_nome ?? "—"}</strong> em {fmtDataHora(pedido.retirado_em)}.
        </Aviso>
      ) : !pedido.pode_retirar ? (
        <Aviso tom="alerta" icone={AlertTriangle} titulo="Pedido não liberado para retirada">
          Situação atual: <strong>{estilo?.rotulo ?? pedido.status}</strong>. Só pedido
          "Aguardando envio" pode ser retirado. Não leve este volume sem falar com o Suprimentos.
        </Aviso>
      ) : !pedido.pode_confirmar ? (
        <Aviso tom="alerta" icone={ShieldAlert} titulo="Seu usuário não pode confirmar retirada">
          Peça a liberação de "Retirada para Entrega" em Acesso por Usuário.
        </Aviso>
      ) : (
        <div className="space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm font-medium">Documentos físicos que acompanham o pedido</p>
              <div className="space-y-1.5">
                <Label htmlFor="retirada-ficha-epi">O pedido possui Ficha de EPI física?</Label>
                <Select value={fichaEpiFisica} onValueChange={(valor: "SIM" | "NAO") => setFichaEpiFisica(valor)}>
                  <SelectTrigger id="retirada-ficha-epi"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SIM">Sim</SelectItem>
                    <SelectItem value="NAO">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retirada-cracha">O pedido possui Crachá físico?</Label>
                <Select value={crachaFisico} onValueChange={(valor: "SIM" | "NAO") => setCrachaFisico(valor)}>
                  <SelectTrigger id="retirada-cracha"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SIM">Sim</SelectItem>
                    <SelectItem value="NAO">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
          <Button
            size="lg"
            className="h-14 w-full text-base"
            disabled={confirmar.isPending || !fichaEpiFisica || !crachaFisico}
            onClick={() => confirmar.mutate()}
          >
            {confirmar.isPending
              ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Confirmando…</>
              : <><Truck className="mr-2 h-5 w-5" /> Confirmar que retirei este pedido</>}
          </Button>
          {pedido.usuario_nome && (
            <p className="text-center text-xs text-muted-foreground">
              A retirada fica registrada no nome de <strong>{pedido.usuario_nome}</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Aviso({
  tom, icone: Icone, titulo, children,
}: {
  tom: "ok" | "alerta" | "erro";
  icone: typeof CheckCircle2;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      "flex items-start gap-3 rounded-lg border p-4 text-sm",
      tom === "ok" && "border-emerald-400/50 bg-emerald-50 dark:bg-emerald-950/30",
      tom === "alerta" && "border-amber-400/50 bg-amber-50 dark:bg-amber-950/30",
      tom === "erro" && "border-destructive/30 bg-destructive/5",
    )}>
      <Icone className={cn(
        "mt-0.5 h-5 w-5 shrink-0",
        tom === "ok" && "text-emerald-600",
        tom === "alerta" && "text-amber-600",
        tom === "erro" && "text-destructive",
      )} />
      <div className="space-y-1">
        <p className="font-medium">{titulo}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
