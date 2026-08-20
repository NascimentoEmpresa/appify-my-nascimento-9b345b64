import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CORES_CIDADE, coordDaCidade } from "./carteira";
import {
  buscarCoordenada, consultaGeo, assinaturaEndereco, precisaLocalizar,
  temCoordenada, esperar, INTERVALO_MS, type PatrimonioGeo,
} from "./geo";

/**
 * Mapa da carteira — UM PINO POR IMÓVEL, no endereço dele.
 *
 * Antes era um pino por cidade: dez imóveis em Triunfo viravam um pino só no
 * centro da cidade. Agora cada patrimônio com coordenada gravada aparece no
 * lugar certo; quem ainda não tem cai num pino de cidade, que continua
 * existindo justamente para nada sumir do mapa.
 *
 * A coordenada NÃO é resolvida a cada abertura: fica gravada em
 * JUR_PATRIMONIOS (ver geo.ts e a migration 20260912000002). O botão
 * "Localizar endereços" é que vai ao OpenStreetMap, uma consulta por segundo,
 * e grava o resultado.
 *
 * Leaflet direto (não react-leaflet) porque é como as outras telas do sistema
 * fazem — ver AsoCandidatos e PainelExecutivo.
 */

export interface PatrimonioMapa extends PatrimonioGeo {
  descricao?: string | null;
  classificacao?: string | null;
}

const escapar = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export function MapaPatrimonios({
  patrimonios, onLocalizar,
}: {
  patrimonios: PatrimonioMapa[];
  /** Grava a coordenada achada. Sem isto o botão de localizar não aparece. */
  onLocalizar?: (id: number, dados: { latitude: number | null; longitude: number | null; geo_endereco: string; geo_status: string }) => Promise<void>;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);
  const [buscando, setBuscando] = useState<{ feitos: number; total: number } | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  // Quem já tem coordenada vira pino próprio; o resto continua no pino da
  // cidade, para não sumir do mapa enquanto ninguém localizou.
  const comCoord = useMemo(() => patrimonios.filter(temCoordenada), [patrimonios]);
  const semCoord = useMemo(() => patrimonios.filter(p => !temCoordenada(p)), [patrimonios]);

  const porCidade = useMemo(() => {
    const m = new Map<string, number>();
    semCoord.forEach(p => {
      const c = String(p.cidade ?? "").trim();
      if (c && coordDaCidade(c)) m.set(c, (m.get(c) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [semCoord]);

  const aLocalizar = useMemo(() => patrimonios.filter(precisaLocalizar), [patrimonios]);

  // Redesenha quando muda o que está no mapa (coordenada, cidade ou nome).
  const assinatura = useMemo(() =>
    comCoord.map(p => `${p.id}:${p.latitude},${p.longitude}`).join("|")
    + "#" + porCidade.map(([c, n]) => `${c}:${n}`).join("|"),
    [comCoord, porCidade]);

  useEffect(() => {
    if (!caixaRef.current) return;
    if (!mapaRef.current) {
      // Zoom pelo scroll ligado: com o mouse sobre o mapa, a roda aproxima e
      // afasta. O mapa tem altura fixa, então dá para rolar a página por fora.
      const mapa = L.map(caixaRef.current, { scrollWheelZoom: true }).setView([-29.9, -51.0], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap", maxZoom: 19,
      }).addTo(mapa);
      mapaRef.current = mapa;
      camadaRef.current = L.layerGroup().addTo(mapa);
    }
    const mapa = mapaRef.current!;
    const camada = camadaRef.current!;
    camada.clearLayers();

    const pontos: [number, number][] = [];
    const corDe = (cidade?: string | null) => {
      const nomes = [...new Set(patrimonios.map(x => String(x.cidade ?? "").trim()).filter(Boolean))].sort();
      const i = nomes.indexOf(String(cidade ?? "").trim());
      return CORES_CIDADE[(i < 0 ? 0 : i) % CORES_CIDADE.length];
    };

    // 1) Um pino por imóvel localizado.
    comCoord.forEach(p => {
      const co: [number, number] = [Number(p.latitude), Number(p.longitude)];
      pontos.push(co);
      const cor = corDe(p.cidade);
      L.circleMarker(co, {
        radius: 7, color: "#fff", weight: 2, fillColor: cor, fillOpacity: 1,
      })
        .bindTooltip(
          `<b>${escapar(p.classificacao || p.descricao || "Patrimônio")}</b>`
          + `<br>${escapar(p.localizacao || "sem endereço")}`
          + `<br><span style="color:#64748b">${escapar(p.cidade || "")}</span>`
          + (p.geo_status === "manual" ? '<br><span style="color:#a16207">coordenada manual</span>' : ""),
          { direction: "top", opacity: 1 },
        )
        .addTo(camada);
    });

    // 2) Quem ainda não tem endereço localizado continua no pino da cidade.
    porCidade.forEach(([cidade, n]) => {
      const co = coordDaCidade(cidade)!;
      pontos.push(co);
      L.marker(co, {
        icon: L.divIcon({
          className: "jp-pin",
          html: `<span style="display:inline-flex;align-items:center;gap:5px;background:#fff;border:1px dashed #cbd5e1;border-radius:20px;padding:3px 9px;box-shadow:0 6px 18px rgba(15,23,42,.14);font-size:11px;font-weight:800;color:#64748b;white-space:nowrap">
                   <span style="width:9px;height:9px;border-radius:50%;background:${corDe(cidade)}"></span>${escapar(cidade)} · ${n} sem endereço
                 </span>`,
          iconSize: [0, 0], iconAnchor: [0, 0],
        }),
      }).addTo(camada);
    });

    if (pontos.length > 1) mapa.fitBounds(L.latLngBounds(pontos).pad(0.25));
    else if (pontos.length === 1) mapa.setView(pontos[0], 15);
    setTimeout(() => mapa.invalidateSize(), 60);   // o card só ganha altura depois de montar
  }, [assinatura]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { mapaRef.current?.remove(); mapaRef.current = null; }, []);

  /**
   * Localiza os endereços que faltam, um por segundo (é o que o Nominatim
   * pede). Grava cada resultado assim que chega, então fechar a tela no meio
   * não perde o que já foi achado.
   */
  const localizar = async () => {
    if (!onLocalizar || !aLocalizar.length) return;
    setRecado(null);
    setBuscando({ feitos: 0, total: aLocalizar.length });
    let achados = 0, falhas = 0;
    for (let i = 0; i < aLocalizar.length; i++) {
      const p = aLocalizar[i];
      try {
        const achado = await buscarCoordenada(consultaGeo(p));
        await onLocalizar(p.id, achado
          ? { latitude: achado.lat, longitude: achado.lng, geo_endereco: assinaturaEndereco(p), geo_status: "ok" }
          : { latitude: null, longitude: null, geo_endereco: assinaturaEndereco(p), geo_status: "nao_encontrado" });
        achado ? achados++ : falhas++;
      } catch (e: any) {
        setRecado(`Parou em ${i} de ${aLocalizar.length}: ${e?.message ?? "erro no serviço de mapas"}`);
        break;
      }
      setBuscando({ feitos: i + 1, total: aLocalizar.length });
      if (i < aLocalizar.length - 1) await esperar(INTERVALO_MS);
    }
    setBuscando(null);
    setRecado(r => r ?? (falhas
      ? `${achados} localizados. ${falhas} sem endereço reconhecível — abra o patrimônio e informe a coordenada à mão.`
      : `${achados} endereços localizados.`));
  };

  const cidadesLegenda = [...new Set(patrimonios.map(p => String(p.cidade ?? "").trim()).filter(Boolean))].sort();

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
      <div ref={caixaRef} style={{ flex: 1, minWidth: 280, height: 260, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0" }} />
      <div style={{ width: 210, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>Cidades</div>
        {cidadesLegenda.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Nenhuma cidade no recorte.</div>
        ) : cidadesLegenda.map((cidade, i) => {
          const total = patrimonios.filter(p => String(p.cidade ?? "").trim() === cidade).length;
          return (
            <div key={cidade} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#334155", padding: "3px 0" }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: CORES_CIDADE[i % CORES_CIDADE.length], flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cidade}>{cidade}</span>
              <b style={{ color: "#0f172a" }}>{total}</b>
            </div>
          );
        })}

        <div style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 11.5, color: "#64748b", marginBottom: 7 }}>
            <b style={{ color: "#0f172a" }}>{comCoord.length}</b> no endereço
            {semCoord.length > 0 && <> · <b style={{ color: "#0f172a" }}>{semCoord.length}</b> só na cidade</>}
          </div>
          {onLocalizar && (
            <button
              type="button" onClick={localizar} disabled={!!buscando || !aLocalizar.length}
              title={aLocalizar.length ? `Consulta o OpenStreetMap para ${aLocalizar.length} endereço(s)` : "Nada a localizar"}
              style={{
                width: "100%", padding: "7px 10px", borderRadius: 9, fontSize: 11.5, fontWeight: 800,
                cursor: buscando || !aLocalizar.length ? "not-allowed" : "pointer",
                border: "1px solid #0f3171",
                background: buscando || !aLocalizar.length ? "#f1f5f9" : "#fff",
                color: buscando || !aLocalizar.length ? "#94a3b8" : "#0f3171",
              }}>
              {buscando
                ? `Localizando ${buscando.feitos}/${buscando.total}…`
                : aLocalizar.length ? `Localizar ${aLocalizar.length} endereço(s)` : "Endereços localizados"}
            </button>
          )}
          {recado && <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>{recado}</div>}
        </div>
      </div>
    </div>
  );
}
