import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTrajetoCorreio, type ParadaNoMapa } from "@/hooks/useTrajetoCorreio";
import { dataCurta, rotuloCidade } from "@/lib/suprimentos/trajetoCorreio";
import { AlertTriangle, ExternalLink, Loader2, MapPin } from "lucide-react";

/**
 * O caminho que o objeto fez, no mapa.
 *
 * IMPORTANTE, e a tela diz isso ao usuário: NÃO é posição por satélite. Os
 * Correios registram o objeto quando ele é bipado numa unidade, então o que
 * existe é "passou por esta cidade nesta hora". A linha entre dois pinos é
 * reta, ligando as cidades — não é a estrada que o veículo pegou, e tratá-la
 * como rota daria a impressão de um acompanhamento que não temos.
 *
 * Leaflet direto (não react-leaflet), como MapaPatrimonios e PainelExecutivo.
 * Os ladrilhos vêm do OpenStreetMap: sem chave, sem cadastro e sem custo.
 */

const escapar = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Verde no fim, azul no percurso, cinza no que ainda não aconteceu. */
function corDaParada(p: ParadaNoMapa, i: number, total: number, entregue: boolean) {
  if (p.previsto) return "#94a3b8";
  if (entregue && i === total - 1) return "#16a34a";
  if (i === 0) return "#f59e0b";
  return "#2563eb";
}

function Mapa({ paradas, entregue }: { paradas: ParadaNoMapa[]; entregue: boolean }) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);

  const assinatura = paradas.map((p) => `${p.chave}:${p.latitude},${p.longitude}`).join("|");

  useEffect(() => {
    if (!caixaRef.current) return;
    if (!mapaRef.current) {
      const mapa = L.map(caixaRef.current, { scrollWheelZoom: true }).setView([-22, -50], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap", maxZoom: 19,
      }).addTo(mapa);
      mapaRef.current = mapa;
      camadaRef.current = L.layerGroup().addTo(mapa);
    }
    const mapa = mapaRef.current!;
    const camada = camadaRef.current!;
    camada.clearLayers();

    const comCoord = paradas.filter((p) => p.latitude != null && p.longitude != null);
    const pontos = comCoord.map((p) => [p.latitude!, p.longitude!] as [number, number]);

    // A linha do percurso. O último trecho sai tracejado quando a parada final
    // é PREVISTA: o objeto ainda não chegou lá, e uma linha cheia afirmaria
    // que chegou.
    const ultimaPrevista = comCoord[comCoord.length - 1]?.previsto;
    const firmes = ultimaPrevista ? pontos.slice(0, -1) : pontos;
    if (firmes.length > 1) {
      L.polyline(firmes, { color: "#2563eb", weight: 3, opacity: 0.75 }).addTo(camada);
    }
    if (ultimaPrevista && pontos.length > 1) {
      L.polyline(pontos.slice(-2), {
        color: "#94a3b8", weight: 3, opacity: 0.9, dashArray: "6 8",
      }).addTo(camada);
    }

    comCoord.forEach((p, i) => {
      const cor = corDaParada(p, i, comCoord.length, entregue);
      const ultimo = p.eventos[p.eventos.length - 1];
      L.marker([p.latitude!, p.longitude!], {
        icon: L.divIcon({
          className: "correio-pino",
          html: `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:${cor};color:#fff;border:2px solid #fff;box-shadow:0 4px 12px rgba(15,23,42,.28);font-size:11px;font-weight:800;font-family:system-ui,sans-serif">${i + 1}</span>`,
          iconSize: [24, 24], iconAnchor: [12, 12],
        }),
      })
        .bindTooltip(
          `<b>${escapar(rotuloCidade(p))}</b>`
          + (p.previsto
            ? '<br><span style="color:#64748b">próxima parada — ainda não chegou</span>'
            : `<br>${escapar(ultimo?.descricao ?? "")}<br><span style="color:#64748b">${escapar(dataCurta(ultimo?.data))}</span>`),
          { direction: "top", opacity: 1 },
        )
        .addTo(camada);
    });

    if (pontos.length > 1) mapa.fitBounds(L.latLngBounds(pontos).pad(0.25));
    else if (pontos.length === 1) mapa.setView(pontos[0], 11);

    // Dentro do Dialog o container só ganha tamanho depois que a animação de
    // abertura termina. Sem isto o mapa desenha num retângulo de altura zero e
    // fica cinza até alguém arrastar.
    const t = setTimeout(() => mapa.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [assinatura, entregue]);   // eslint-disable-line react-hooks/exhaustive-deps

  // O Leaflet precisa ser destruído à mão: o Dialog desmonta o nó e, sem isto,
  // reabrir o mapa estoura com "Map container is already initialized".
  useEffect(() => () => {
    mapaRef.current?.remove();
    mapaRef.current = null;
    camadaRef.current = null;
  }, []);

  return <div ref={caixaRef} className="h-[420px] w-full rounded-lg border" />;
}

export function ModalTrajetoCorreio({
  codigo, protocolo, onFechar,
}: {
  codigo: string | null;
  protocolo?: string | null;
  onFechar: () => void;
}) {
  const { data, isLoading, error } = useTrajetoCorreio(codigo, !!codigo);

  return (
    <Dialog open={!!codigo} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            Trajeto do objeto
            <span className="font-mono text-sm text-muted-foreground">{codigo}</span>
            {protocolo && <Badge variant="outline" className="font-mono">{protocolo}</Badge>}
            {data?.entregue && (
              <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                Entregue
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando os Correios e localizando as cidades…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
            Não foi possível carregar o trajeto: {(error as Error).message}
          </div>
        )}

        {data && !isLoading && (
          data.mensagem ? (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
              {data.mensagem}
              <p className="mt-2 text-xs">
                O rastreio só devolve objetos postados no contrato da empresa. Código de
                terceiro, ou objeto ainda não postado, não tem trajeto para mostrar.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="space-y-2">
                <Mapa paradas={data.paradas} entregue={data.entregue} />
                <p className="text-xs text-muted-foreground">
                  Os Correios registram o objeto ao bipá-lo em cada unidade — o mapa mostra
                  <strong> por quais cidades ele passou</strong>, não a posição do veículo. A
                  linha entre dois pontos liga as cidades em reta, não é a estrada percorrida.
                </p>
                {data.semCoordenada.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Sem localização no mapa: {data.semCoordenada.join(", ")}. Os eventos
                    continuam na lista ao lado.
                  </p>
                )}
              </div>

              <ol className="space-y-3 lg:max-h-[460px] lg:overflow-y-auto lg:pr-1">
                {data.paradas.map((p, i) => (
                  <li key={`${p.chave}-${i}`} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: corDaParada(p, i, data.paradas.length, data.entregue) }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{rotuloCidade(p)}</p>
                      {p.previsto ? (
                        <p className="text-xs text-muted-foreground">Próxima parada — ainda não chegou</p>
                      ) : (
                        p.eventos.map((e, j) => (
                          <p key={j} className="text-xs text-muted-foreground">
                            {e.descricao}
                            {e.data && <span className="ml-1 opacity-70">· {dataCurta(e.data)}</span>}
                          </p>
                        ))
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" asChild>
            <a
              href={`https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(codigo ?? "")}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" /> Abrir no site dos Correios
            </a>
          </Button>
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
