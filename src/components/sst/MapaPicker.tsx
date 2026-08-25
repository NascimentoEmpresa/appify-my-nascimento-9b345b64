import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

// =====================================================================
// SST — seletor de local no mapa, compartilhado pelos dois ASOs.
//
// Nasceu dentro da tela de ASO/Admissão (pages/sst/AsoCandidatos.tsx) e saiu
// para cá quando o ASO DEMISSIONAL passou a marcar data e local com os
// MESMOS campos: duas cópias divergiriam no primeiro ajuste feito em uma
// delas, e quem trabalha no SST teria que aprender dois jeitos de fazer a
// mesma coisa.
// =====================================================================

// ── Seletor de local no mapa (Leaflet + OpenStreetMap, sem chave de API) ──
// Arraste o mapa e CLIQUE no ponto exato: o 📍 cai ali, o endereço completo
// vem do geocoding reverso (Nominatim/OSM) e o link exato (lat,lng) é gerado.
// O campo "busca" (texto do local) só centraliza o mapa — a escolha é o clique.
export function MapaPicker({ busca, onPick }: { busca: string; onPick: (r: { nome: string; url: string }) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null); // { L, map }
  const pinRef = useRef<any>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<any[]>([]);

  const colocarPin = (lat: number, lng: number) => {
    const m = mapRef.current; if (!m) return;
    if (pinRef.current) pinRef.current.setLatLng([lat, lng]);
    else {
      pinRef.current = m.L.marker([lat, lng], {
        draggable: true,
        icon: m.L.divIcon({ html: "📍", className: "aso-pin", iconSize: [26, 26], iconAnchor: [13, 24] }),
      }).addTo(m.map);
      pinRef.current.on("dragend", () => { const p = pinRef.current.getLatLng(); escolher(p.lat, p.lng); });
    }
  };

  const escolher = async (lat: number, lng: number) => {
    if (!mapRef.current) return;
    colocarPin(lat, lng);
    setStatus("Buscando endereço do ponto…");
    let nome = "";
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=pt-BR`);
      const j = await r.json();
      nome = j?.display_name || "";
    } catch { /* sem rede/limite do serviço: segue só com as coordenadas */ }
    setStatus(nome ? `📍 ${nome}` : "📍 Ponto selecionado (endereço não encontrado — link exato mesmo assim)");
    onPick({ nome, url: `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}` });
  };

  // Busca de lugares (Nominatim/OSM): lista resultados; clicar num deles
  // centraliza, crava o 📍 e preenche nome + link (sem precisar de reverse).
  const buscarLugares = async () => {
    const t = q.trim(); if (!t || buscando) return;
    setBuscando(true); setResultados([]);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(t)}&limit=6&countrycodes=br&accept-language=pt-BR`);
      const j = await r.json();
      const lista = Array.isArray(j) ? j : [];
      setResultados(lista);
      if (!lista.length) setStatus("Nenhum lugar encontrado — tente incluir a cidade (ex.: \"clínica são lucas triunfo\").");
    } catch { setStatus("Falha na busca de lugares — tente de novo."); }
    setBuscando(false);
  };

  const escolherResultado = (res: any) => {
    const lat = +res.lat, lng = +res.lon;
    const m = mapRef.current; if (!m || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    m.map.setView([lat, lng], 17);
    colocarPin(lat, lng);
    const nome = res.display_name || "";
    setStatus(nome ? `📍 ${nome}` : "📍 Ponto selecionado");
    onPick({ nome, url: `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}` });
    setResultados([]);
  };

  const centrar = async (q: string) => {
    const m = mapRef.current; if (!m || !q.trim()) return;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=1&countrycodes=br&accept-language=pt-BR`);
      const j = await r.json();
      if (j?.[0]) m.map.setView([+j[0].lat, +j[0].lon], 15);
    } catch { /* noop */ }
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      const mod: any = await import("leaflet");
      const L: any = mod.default ?? mod;
      if (!vivo || !boxRef.current || mapRef.current) return;
      const map = L.map(boxRef.current).setView([-14.235, -51.925], 4); // Brasil
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      map.on("click", (e: any) => escolher(e.latlng.lat, e.latlng.lng));
      mapRef.current = { L, map };
      if (busca.trim()) centrar(busca);
    })();
    return () => { vivo = false; if (mapRef.current) { mapRef.current.map.remove(); mapRef.current = null; pinRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Texto do "Local do exame" mudou (blur): re-centraliza o mapa nele.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { centrar(busca); }, [busca]);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") buscarLugares(); }}
          placeholder="🔎 Procurar lugar no mapa (clínica, endereço, cidade…)"
          style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", fontSize: 12.5, outline: "none" }} />
        <button onClick={buscarLugares} disabled={buscando}
          style={{ flexShrink: 0, padding: "0 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: buscando ? "default" : "pointer", opacity: buscando ? .6 : 1 }}>
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {resultados.length > 0 && (
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 6, maxHeight: 160, overflowY: "auto", background: "#fff" }}>
          {resultados.map((r: any) => (
            <button key={r.place_id} onClick={() => escolherResultado(r)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: "none", borderBottom: "1px solid #f1f5f9", background: "transparent", cursor: "pointer", fontSize: 12, color: "#334155" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f8fbff")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              📍 {r.display_name}
            </button>
          ))}
        </div>
      )}
      <div ref={boxRef} className="aso-map" style={{ position: "relative", zIndex: 0, width: "100%", height: 230, borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }} />
      <style>{`
        .aso-pin{font-size:22px;line-height:1;text-align:center;filter:drop-shadow(0 1px 2px rgba(15,23,42,.45))}
        .aso-map,.aso-map *{user-select:none;-webkit-user-select:none}
        .aso-map .leaflet-control-zoom a{text-decoration:none}
      `}</style>
      <div style={{ fontSize: 10.5, color: status.startsWith("📍") ? "#15803d" : "#94a3b8", marginTop: 4 }}>
        {status || "Arraste o mapa e clique no ponto exato — o endereço completo e o link são preenchidos sozinhos. Depois dá pra arrastar o 📍 pra ajustar."}
      </div>
    </div>
  );
}
