import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CORES_CIDADE, coordDaCidade } from "./carteira";

/**
 * Mapa da carteira — um pino por CIDADE, não por imóvel.
 *
 * A pergunta que o mapa responde é "onde está o patrimônio da empresa", e a
 * resposta útil é a cidade: os endereços não têm coordenada no cadastro, e
 * geocodificar 1.248 linhas a cada abertura seria uma chamada externa por
 * imóvel para um dado que ninguém usa no zoom de rua.
 *
 * Leaflet direto (não react-leaflet) porque é como as outras telas do sistema
 * fazem — ver AsoCandidatos e PainelExecutivo.
 */
export function MapaPatrimonios({ patrimonios }: { patrimonios: { cidade?: string | null }[] }) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);

  // Quantos imóveis por cidade, na ordem do maior para o menor.
  const porCidade = new Map<string, number>();
  patrimonios.forEach((p) => {
    const c = String(p.cidade ?? "").trim();
    if (c) porCidade.set(c, (porCidade.get(c) ?? 0) + 1);
  });
  const cidades = [...porCidade.entries()]
    .filter(([c]) => coordDaCidade(c))
    .sort((a, b) => b[1] - a[1]);
  const assinatura = cidades.map(([c, n]) => `${c}:${n}`).join("|");

  useEffect(() => {
    if (!caixaRef.current) return;
    if (!mapaRef.current) {
      // Zoom pelo scroll ligado: com o mouse sobre o mapa, a roda aproxima e
      // afasta. O preço é o scroll da página parar enquanto o ponteiro está
      // sobre ele — foi o pedido, e o mapa tem altura fixa, então dá para
      // passar por fora.
      const mapa = L.map(caixaRef.current, { scrollWheelZoom: true }).setView([-29.9, -51.0], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap", maxZoom: 18,
      }).addTo(mapa);
      mapaRef.current = mapa;
      camadaRef.current = L.layerGroup().addTo(mapa);
    }
    const mapa = mapaRef.current!;
    const camada = camadaRef.current!;
    camada.clearLayers();

    const pontos: [number, number][] = [];
    cidades.forEach(([cidade, n], i) => {
      const co = coordDaCidade(cidade)!;
      const cor = CORES_CIDADE[i % CORES_CIDADE.length];
      pontos.push(co);
      L.marker(co, {
        icon: L.divIcon({
          className: "jp-pin",
          html: `<span style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:3px 9px;box-shadow:0 6px 18px rgba(15,23,42,.18);font-size:11px;font-weight:800;color:#0f172a;white-space:nowrap">
                   <span style="width:9px;height:9px;border-radius:50%;background:${cor}"></span>${cidade} · ${n}
                 </span>`,
          iconSize: [0, 0], iconAnchor: [0, 0],
        }),
      }).addTo(camada);
    });

    // Enquadra o que existe; com uma cidade só, fitBounds daria zoom máximo.
    if (pontos.length > 1) mapa.fitBounds(L.latLngBounds(pontos).pad(0.35));
    else if (pontos.length === 1) mapa.setView(pontos[0], 11);
    setTimeout(() => mapa.invalidateSize(), 60);   // o card só ganha altura depois de montar
  }, [assinatura]);

  useEffect(() => () => { mapaRef.current?.remove(); mapaRef.current = null; }, []);

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
      <div ref={caixaRef} style={{ flex: 1, minWidth: 280, height: 260, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0" }} />
      <div style={{ width: 200, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Cidades</div>
        {cidades.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Nenhuma cidade mapeada no recorte.</div>
        ) : cidades.map(([cidade, n], i) => (
          <div key={cidade} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#334155", padding: "3px 0" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: CORES_CIDADE[i % CORES_CIDADE.length], flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cidade}</span>
            <b style={{ color: "#0f172a" }}>{n}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
