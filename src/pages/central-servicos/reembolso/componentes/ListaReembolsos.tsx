import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useEventosReembolso, useItensReembolso, urlDoComprovante, type Reembolso,
} from "@/hooks/useReembolso";
import {
  ROTULO_STATUS, dataParaBR, fmtBRL, type StatusReembolso,
} from "@/lib/reembolso/regras";
import { useTiposReembolso } from "@/hooks/useReembolso";

/**
 * A lista de solicitações, usada pelas duas telas — "Minhas" e a fila de
 * aprovação. O que muda entre elas é só o botão do rodapé, que entra por
 * `acoes`; o corpo é o mesmo porque a informação que decide é a mesma, e ter
 * duas versões faria uma delas envelhecer.
 */

const COR_STATUS: Record<StatusReembolso, string> = {
  pendente: "bg-amber-100 text-amber-800 border-amber-200",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  reprovado: "bg-rose-100 text-rose-800 border-rose-200",
  cancelado: "bg-slate-100 text-slate-700 border-slate-200",
};

export function ListaReembolsos({ lista, carregando, vazio, acoes, mostrarSolicitante = false }: {
  lista: Reembolso[];
  carregando: boolean;
  vazio: string;
  acoes?: (r: Reembolso) => ReactNode;
  mostrarSolicitante?: boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);

  if (carregando) {
    return (
      <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </Card>
    );
  }
  if (!lista.length) {
    return <Card className="p-6 text-sm text-muted-foreground">{vazio}</Card>;
  }

  return (
    <div className="space-y-3">
      {lista.map((r) => (
        <Card key={r.id} className="overflow-hidden">
          <button
            type="button"
            className="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-muted/40"
            onClick={() => setAberta((a) => (a === r.id ? null : r.id))}
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {r.numero ?? "—"}
                <Badge variant="outline" className={COR_STATUS[r.status]}>
                  {ROTULO_STATUS[r.status]}
                </Badge>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {mostrarSolicitante && r.solicitante_nome ? `${r.solicitante_nome} · ` : ""}
                {r.setor ? `${r.setor} · ` : ""}
                Viagem em {dataParaBR(r.data_viagem)}, das {String(r.saida).slice(0, 5)} às{" "}
                {String(r.chegada).slice(0, 5)}
              </p>
            </div>
            <p className="text-sm font-semibold">{fmtBRL(r.total_centavos)}</p>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                aberta === r.id ? "rotate-180" : ""
              }`}
            />
          </button>

          {aberta === r.id && (
            <div className="border-t bg-muted/20 p-4">
              <Detalhe reembolso={r} />
              {acoes && <div className="mt-4 flex flex-wrap gap-2">{acoes(r)}</div>}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Detalhe({ reembolso }: { reembolso: Reembolso }) {
  const { data: itens = [], isLoading } = useItensReembolso(reembolso.id);
  const { data: eventos = [] } = useEventosReembolso(reembolso.id);
  const { data: tipos = [] } = useTiposReembolso();

  const nomeDoTipo = (codigo: string) =>
    tipos.find((t) => t.codigo === codigo)?.nome ?? codigo;

  /**
   * O bucket é privado, então o link é assinado na hora do clique e não na
   * renderização: gerar uma URL de 1h para cada comprovante de cada linha da
   * lista seria uma ida ao storage por item, à toa.
   */
  const abrir = async (caminho: string) => {
    const url = await urlDoComprovante(caminho);
    if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="PIX" valor={reembolso.pix} />
        <Campo rotulo="Distância" valor={`${reembolso.distancia_km} km`} />
        <Campo rotulo="Competência" valor={reembolso.competencia} />
        {reembolso.observacoes && (
          <Campo rotulo="Observações" valor={reembolso.observacoes} className="sm:col-span-2" />
        )}
        {reembolso.motivo_reprovacao && (
          <Campo rotulo="Motivo da reprovação" valor={reembolso.motivo_reprovacao}
                 className="sm:col-span-2 lg:col-span-3" />
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Despesas</p>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : (
          <ul className="space-y-1">
            {itens.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-32">{nomeDoTipo(i.tipo_codigo)}</span>
                <span className="font-medium">{fmtBRL(i.valor_centavos)}</span>
                <Button variant="link" size="sm" className="h-auto p-0"
                        onClick={() => abrir(i.storage_path)}>
                  <Paperclip className="mr-1 h-3 w-3" />
                  {i.nome_arquivo ?? "comprovante"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {eventos.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Histórico</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {eventos.map((e) => (
              <li key={e.id}>
                {new Date(e.created_at).toLocaleString("pt-BR")} — <strong>{e.tipo}</strong>
                {e.autor_nome ? ` por ${e.autor_nome}` : ""}
                {e.descricao ? `: ${e.descricao}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, valor, className = "" }: { rotulo: string; valor: string; className?: string }) {
  return (
    <p className={className}>
      <span className="text-xs text-muted-foreground">{rotulo}: </span>
      {valor}
    </p>
  );
}
