import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { usePainelLicitacao, aberturaUrgencia, PainelFilters } from "@/hooks/usePainelLicitacao";
import { usePlanilhaCustos } from "@/hooks/usePlanilhaCusto";
import { usePlanilhaPostoLocalizacaoAll, usePostoLocalizacaoCoords } from "@/hooks/usePlanilhaPostoLocalizacao";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import {
  AlertTriangle, FileText, Trophy, Tv, TrendingUp,
  Target, ChevronRight, BookOpen, Award,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LabelList, PieChart, Pie, Cell,
} from "recharts";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix leaflet default marker icons (bundler strips the default urls)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Coordenadas de municípios do RS e principais capitais
const CITY_COORDS: Record<string, [number, number]> = {
  "Porto Alegre": [-30.0346, -51.2177],
  "Canoas": [-29.9186, -51.1837],
  "Caxias do Sul": [-29.1678, -51.1794],
  "Pelotas": [-31.7654, -52.3376],
  "Santa Maria": [-29.6842, -53.8069],
  "Gravataí": [-29.9432, -50.9917],
  "Viamão": [-30.0814, -51.0233],
  "Novo Hamburgo": [-29.6783, -51.1306],
  "São Leopoldo": [-29.7598, -51.1493],
  "Rio Grande": [-32.0350, -52.0986],
  "Alvorada": [-30.0122, -51.0831],
  "Passo Fundo": [-28.2620, -52.4064],
  "Sapucaia do Sul": [-29.8297, -51.1508],
  "Uruguaiana": [-29.7542, -57.0882],
  "Santa Cruz do Sul": [-29.7175, -52.4257],
  "Cachoeirinha": [-29.9465, -51.0943],
  "Bagé": [-31.3289, -54.1069],
  "Bento Gonçalves": [-29.1717, -51.5197],
  "Erechim": [-27.6338, -52.2744],
  "Guaíba": [-30.1122, -51.3253],
  "Cachoeira do Sul": [-30.0306, -52.8936],
  "Santana do Livramento": [-30.8906, -55.5322],
  "Charqueadas": [-29.9597, -51.6253],
  "Lajeado": [-29.4667, -51.9614],
  "Sapiranga": [-29.6400, -51.0017],
  "Triunfo": [-29.9392, -51.7186],
  "Eldorado do Sul": [-30.0878, -51.3828],
  "Brasília": [-15.7939, -47.8828],
  "São Paulo": [-23.5505, -46.6333],
  "Rio de Janeiro": [-22.9068, -43.1729],
  "Curitiba": [-25.4284, -49.2733],
  "Florianópolis": [-27.5954, -48.5480],
  "Merendeira": [-29.9, -51.3],
  "Portaria": [-30.0, -51.2],
};

function fmtBRLKPI(v: number): string {
  if (v >= 1_000_000_000) return `R$ ${(Math.floor(v / 100_000_000) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1 })} bi`;
  if (v >= 1_000_000) return `R$ ${(Math.floor(v / 100_000) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `R$ ${Math.floor(v / 1_000).toLocaleString("pt-BR")} mil`;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtCompact(v: number) {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return `${v}`;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, sub2, sub3, icon, color }: {
  label: string; value: string; sub?: string; sub2?: string; sub3?: string;
  icon: React.ReactNode; color: string;
}) {
  // extrai a cor base do color (ex: "bg-blue-100" → usamos a variante 200 no ícone BG)
  return (
    <div className="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 flex flex-col min-h-[110px]">
      {/* Ícone gigante de fundo com fade da direita para o centro */}
      <div
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 text-slate-400 opacity-100"
        style={{
          fontSize: 0,
          WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
        }}
      >
        <span className="[&>svg]:h-32 [&>svg]:w-32">{icon}</span>
      </div>

      {/* Conteúdo */}
      <p className="relative z-10 text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">{label}</p>
      <p className="relative z-10 text-3xl font-bold text-slate-900 leading-none">{value}</p>
      <div className="relative z-10 mt-auto pt-3">
        {sub && <p className="text-[11px] text-slate-500 leading-snug">{sub}</p>}
        {sub2 && <p className="text-[11px] text-slate-400">{sub2}</p>}
        {sub3 && <p className="text-[11px] text-slate-400">{sub3}</p>}
      </div>
    </div>
  );
}

// ─── Generic Card ─────────────────────────────────────────────────────────────
function Card({ title, subtitle, children, className = "", headerExtra }: {
  title: string; subtitle?: string; children: React.ReactNode; className?: string; headerExtra?: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
        </div>
        {headerExtra}
      </div>
      <div className="flex flex-1 flex-col mt-2">{children}</div>
    </div>
  );
}

// ─── Mapa Leaflet ─────────────────────────────────────────────────────────────
async function geocodeAddress(loc: { logradouro: string | null; numero: string | null; bairro: string | null; municipio: string | null; uf: string | null }): Promise<{ lat: number; lng: number } | null> {
  const parts = [loc.logradouro, loc.numero, loc.bairro, loc.municipio, loc.uf, "Brasil"].filter(Boolean);
  if (parts.length < 2) return null;
  const q = encodeURIComponent(parts.join(", "));
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
      headers: { "Accept-Language": "pt-BR", "User-Agent": "nascimento-erp/1.0" },
    });
    const data = await res.json();
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

function MapaContratos({ empresaId }: { empresaId: string }) {
  const { data: localizacoes = [] } = usePlanilhaPostoLocalizacaoAll(empresaId);
  const { mutate: saveCoords } = usePostoLocalizacaoCoords();
  const geocodingRef = useRef(false);

  // Geocodifica locs sem coordenadas (uma de cada vez para respeitar rate limit Nominatim)
  useEffect(() => {
    if (geocodingRef.current) return;
    const semCoords = localizacoes.filter((l) => l.lat == null && (l.logradouro || l.municipio));
    if (semCoords.length === 0) return;
    geocodingRef.current = true;
    (async () => {
      for (const loc of semCoords) {
        const coords = await geocodeAddress(loc);
        if (coords) saveCoords({ id: loc.id, lat: coords.lat, lng: coords.lng });
        await new Promise((r) => setTimeout(r, 1100)); // respeita 1 req/s do Nominatim
      }
      geocodingRef.current = false;
    })();
  }, [localizacoes, saveCoords]);

  const markers = localizacoes.filter((l) => l.lat != null && l.lng != null);

  return (
    <MapContainer
      center={[-29.7, -51.5]}
      zoom={7}
      style={{ height: 280, width: "100%", borderRadius: 8, zIndex: 0 }}
      scrollWheelZoom={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {markers.map((m) => (
        <Marker key={m.id} position={[m.lat!, m.lng!]}>
          <Popup>
            <strong>{m.nome || "Posto"}</strong><br />
            {[m.logradouro, m.numero].filter(Boolean).join(", ")}<br />
            {[m.bairro, m.municipio, m.uf].filter(Boolean).join(" · ")}
          </Popup>
        </Marker>
      ))}
      {markers.length === 0 && (
        <></>
      )}
    </MapContainer>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function PainelExecutivo() {
  const navigate = useNavigate();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [responsavelFiltro, setResponsavelFiltro] = useState("");
  const [incluiSR, setIncluiSR] = useState(false);

  const filters: PainelFilters = {
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    responsavel: responsavelFiltro || null,
  };

  const { empresa } = useEmpresaAtiva();
  const { stats, isLoading } = usePainelLicitacao(filters);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground text-sm">
        Carregando painel…
      </div>
    );
  }

  const agora = new Date();
  const dataFmt =
    agora.toLocaleDateString("pt-BR") +
    " " +
    agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="-m-4 min-h-screen bg-slate-100 p-4 md:-m-6 md:p-5 lg:-m-8 lg:p-6">
      <div className="space-y-4 text-slate-900">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">PAINEL GERENCIAL — LICITAÇÕES</h1>
            <p className="text-[11px] text-slate-500">Visão geral do desempenho da equipe e das licitações</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-transparent text-slate-700 outline-none w-32"
              />
              <span className="text-slate-300">–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-transparent text-slate-700 outline-none w-32"
              />
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="ml-1 text-slate-400 hover:text-red-500">✕</button>
              )}
            </div>
            <select
              value={responsavelFiltro}
              onChange={(e) => setResponsavelFiltro(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm outline-none"
            >
              <option value="">Todos os responsáveis</option>
              {stats.responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-400 shadow-sm whitespace-nowrap">
              Última atualização: <strong className="text-slate-600">{dataFmt}</strong>
            </div>
            <button
              onClick={() => navigate("/app/painel-executivo/tv")}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white shadow hover:bg-slate-700"
            >
              <Tv className="h-3.5 w-3.5" /> Modo TV
            </button>
          </div>
        </div>

        {/* ── KPIs (6) ─────────────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
          <KpiCard
            label="Valor total participado"
            value={fmtBRLKPI(stats.valorPipeline)}
            sub="Editais em andamento"
            icon={<TrendingUp className="text-blue-300" />}
            color="bg-blue-100"
          />
          <KpiCard
            label="Taxa de vitória (período)"
            value={`${stats.taxaVitoria.toFixed(0)}%`}
            sub={`${stats.ganhas} ganhos · ${stats.perdidas} perdidos`}
            icon={<Trophy className="text-emerald-300" />}
            color="bg-emerald-100"
          />
          <KpiCard
            label="Contratos ganhos"
            value={fmtBRLKPI(stats.valorGlobal)}
            sub="Valor Global"
            sub2={`Mês: ${fmtBRLKPI(stats.valorMes)}`}
            icon={<Award className="text-green-300" />}
            color="bg-green-100"
          />
          <KpiCard
            label="Pessoas nos contratos ganhos"
            value={stats.qtdPessoasGanhos.toLocaleString("pt-BR")}
            sub="Qtd. pessoas (editais finalizados ganhos)"
            icon={<Target className="text-teal-300" />}
            color="bg-teal-100"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 xl:items-stretch">
          <KpiCard
            label="Alertas de abertura (próx. 7 dias)"
            value={String(stats.alertas.length)}
            sub="Editais com abertura próxima"
            icon={<AlertTriangle className="text-orange-300" />}
            color="bg-orange-100"
          />
          <KpiCard
            label="Editais lidos"
            value={String(stats.editaisLidos)}
            sub="No período selecionado"
            icon={<BookOpen className="text-purple-300" />}
            color="bg-purple-100"
          />
          <KpiCard
            label="Editais participados"
            value={String(stats.editaisParticipados)}
            sub="Excluindo: Não Participado, Suspenso e Revogado"
            icon={<FileText className="text-cyan-300" />}
            color="bg-cyan-100"
          />
        </div>

        {/* ── Linha 2: Valor por responsável + Taxa sucesso (tabela) + Donut ── */}
        <div className="grid gap-4 xl:grid-cols-5">
          <Card
            title="Distribuição de Valor Participado por Responsável"
            subtitle="Valor total dos editais que a pessoa participou (R$)"
            className="xl:col-span-2"
            headerExtra={
              <button
                onClick={() => setIncluiSR((v) => !v)}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${incluiSR ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}
              >
                {incluiSR ? "Com S/R" : "Sem S/R"}
              </button>
            }
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={incluiSR ? stats.porResponsavel : stats.porResponsavel.filter((r) => r.responsavel !== "Sem responsável")} layout="vertical" margin={{ left: 8, right: 64, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" fontSize={10} tickFormatter={fmtCompact} />
                <YAxis type="category" dataKey="responsavel" stroke="#64748b" fontSize={10} width={110} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number) => fmtBRL(v)}
                />
                <Bar dataKey="valor" name="Valor" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="valor" position="right" formatter={fmtCompact} fill="#475569" fontSize={10} fontWeight={600} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card
            title="Taxa de Sucesso por Responsável"
            subtitle="% de vitórias sobre editais finalizados — Não Participado, Suspenso e Revogado não contabilizados"
            className="xl:col-span-2"
            headerExtra={
              <button
                onClick={() => setIncluiSR((v) => !v)}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${incluiSR ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}
              >
                {incluiSR ? "Com S/R" : "Sem S/R"}
              </button>
            }
          >
            <table className="w-full text-xs mt-1">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 text-left">Responsável</th>
                  <th className="px-2 py-1.5 text-center">Ganhos</th>
                  <th className="px-2 py-1.5 text-center">Perdidos</th>
                  <th className="py-1.5 text-right">Taxa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(incluiSR ? stats.porResponsavel : stats.porResponsavel.filter((r) => r.responsavel !== "Sem responsável")).map((r) => (
                  <tr key={r.responsavel} className="hover:bg-slate-50">
                    <td className="py-1.5 text-slate-700 font-medium truncate max-w-[120px]">{r.responsavel}</td>
                    <td className="px-2 py-1.5 text-center text-emerald-600 font-semibold">{r.vitorias}</td>
                    <td className="px-2 py-1.5 text-center text-red-400">{r.perdidas}</td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="h-1.5 w-14 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(r.taxa, 100)}%` }} />
                        </div>
                        <span className="font-semibold text-slate-700 w-8 text-right">{r.taxa.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-semibold text-slate-700">
                  <td className="py-1.5">Total</td>
                  <td className="px-2 py-1.5 text-center text-emerald-600">{stats.ganhas}</td>
                  <td className="px-2 py-1.5 text-center text-red-400">{stats.perdidas}</td>
                  <td className="py-1.5 text-right">{stats.taxaVitoria.toFixed(0)}%</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="Editais por Status (Participados)" className="xl:col-span-1">
            {(() => {
              const total = stats.porFase.reduce((s, f) => s + f.value, 0);
              return (
                <>
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie data={stats.porFase} cx="50%" cy="50%" innerRadius={48} outerRadius={78} dataKey="value" nameKey="name">
                        {stats.porFase.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1 mt-1">
                    {stats.porFase.slice(0, 5).map((f) => (
                      <div key={f.name} className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: f.color }} />
                          <span className="text-slate-600 truncate">{f.name}</span>
                        </div>
                        <span className="ml-2 shrink-0 font-semibold text-slate-700">
                          {f.value} <span className="font-normal text-slate-400">({((f.value / Math.max(total, 1)) * 100).toFixed(1)}%)</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </Card>
        </div>

        {/* ── Linha 3: Próximas + Editais/responsável + Desempenho + Faixas ── */}
        <div className="grid gap-4 xl:grid-cols-5 xl:items-stretch">
          <Card title="Próximas Licitações" subtitle="Ordenadas por data de abertura" className="xl:col-span-2">
            <table className="w-full text-xs mt-1">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 text-left">Edital</th>
                  <th className="px-2 py-1.5 text-left">Objeto</th>
                  <th className="px-2 py-1.5 text-left">Abertura</th>
                  <th className="py-1.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {stats.alertas.map((item) => {
                  const urg = aberturaUrgencia(item.data);
                  const cls = urg === "critica" ? "bg-red-100 text-red-700"
                    : urg === "proxima" ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600";
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-1.5 font-mono text-[10px] text-slate-400">{item.edital || "—"}</td>
                      <td className="max-w-[140px] px-2 py-1.5">
                        <p className="line-clamp-1 text-slate-700">{item.objeto || "—"}</p>
                        <p className="text-[10px] text-slate-400">{item.responsavel || "—"}</p>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{fmtDate(item.data)}</td>
                      <td className="py-1.5 text-right">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
                          {item.fase}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {stats.alertas.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-slate-400">Nenhuma licitação próxima.</td></tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card
            title="Editais Lidos por Responsável"
            subtitle="Quantidade de editais lidos no período"
            className="xl:col-span-1"
            headerExtra={
              <button
                onClick={() => setIncluiSR((v) => !v)}
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${incluiSR ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}
              >
                {incluiSR ? "Com S/R" : "Sem S/R"}
              </button>
            }
          >
            <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={incluiSR ? stats.porResponsavel : stats.porResponsavel.filter((r) => r.responsavel !== "Sem responsável")} layout="vertical" margin={{ left: 6, right: 38, top: 4, bottom: 0 }}>
                <XAxis type="number" stroke="#94a3b8" fontSize={10} />
                <YAxis type="category" dataKey="responsavel" stroke="#64748b" fontSize={10} width={80} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="qtd" name="Editais" fill="#8b5cf6" radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="qtd" position="right" fill="#475569" fontSize={10} fontWeight={600} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Desempenho da Equipe" subtitle="Período" className="xl:col-span-1">
            <div className="flex flex-col justify-between gap-2.5 flex-1">
              {[
                { label: "Editais Participados", value: String(stats.editaisParticipados), icon: <FileText className="h-4 w-4 text-blue-500" />, bg: "bg-blue-50" },
                { label: "Ganhos", value: `${stats.ganhas} (${stats.taxaVitoria.toFixed(0)}%)`, icon: <Trophy className="h-4 w-4 text-emerald-500" />, bg: "bg-emerald-50" },
                { label: "Perdidos", value: `${stats.perdidas} (${stats.totalCapa > 0 ? ((stats.perdidas / stats.totalCapa) * 100).toFixed(0) : 0}%)`, icon: <AlertTriangle className="h-4 w-4 text-red-400" />, bg: "bg-red-50" },
                { label: "Taxa de Sucesso", value: `${stats.taxaVitoria.toFixed(0)}%`, icon: <Target className="h-4 w-4 text-amber-500" />, bg: "bg-amber-50" },
              ].map((item) => (
                <div key={item.label} className={`flex flex-1 items-center gap-3 rounded-lg ${item.bg} px-3 py-3`}>
                  <span className="shrink-0">{item.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-500">{item.label}</p>
                    <p className="text-sm font-bold text-slate-800">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Valor Participado por Faixa" className="xl:col-span-1">
            <table className="w-full text-xs mt-1 h-full">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 text-left">Faixa</th>
                  <th className="px-1 py-1.5 text-center">Nº</th>
                  <th className="py-1.5 text-right">Valor Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {stats.porFaixaValor.map((f) => (
                  <tr key={f.label} className="hover:bg-slate-50">
                    <td className="py-1.5 text-slate-600">{f.label}</td>
                    <td className="px-1 py-1.5 text-center font-semibold text-slate-700">{f.qtd}</td>
                    <td className="py-1.5 text-right text-slate-700">{fmtBRLKPI(f.valor)}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-semibold text-slate-700">
                  <td className="py-1.5">Total</td>
                  <td className="px-1 py-1.5 text-center">{stats.porFaixaValor.reduce((s, f) => s + f.qtd, 0)}</td>
                  <td className="py-1.5 text-right">{fmtBRLKPI(stats.porFaixaValor.reduce((s, f) => s + f.valor, 0))}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>

        {/* ── Linha 4: Mapa + Últimos finalizados ──────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-2 xl:items-stretch">
          <Card title="Mapa de Contratos (Cidades)" subtitle="Postos EXECUTADO vigentes por município">
            {empresa?.id && <MapaContratos empresaId={empresa.id} />}
          </Card>

          <Card title="Últimos Editais Finalizados" className="justify-between">
            <table className="w-full text-xs mt-1 flex-1">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 text-left">Edital</th>
                  <th className="px-2 py-1.5 text-left">Órgão / Objeto</th>
                  <th className="px-2 py-1.5 text-left">Responsável</th>
                  <th className="px-2 py-1.5 text-center">Resultado</th>
                  <th className="py-1.5 text-right">Valor Est.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {stats.ultimosFinalizados.map((item) => {
                  const ganhou = item.posicao === 1;
                  const valor = item.valor_global
                    ? parseFloat(item.valor_global.replace(/[R$\s.]/g, "").replace(",", "."))
                    : 0;
                  return (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="py-1.5 font-mono text-[10px] text-slate-400">{item.edital || "—"}</td>
                      <td className="max-w-[150px] px-2 py-1.5 text-slate-700 truncate">{item.objeto || "—"}</td>
                      <td className="px-2 py-1.5 text-slate-500">{item.responsavel || "—"}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${ganhou ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                          {ganhou ? "Ganho" : "Perdido"}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-slate-700">{valor ? fmtBRLKPI(valor) : "—"}</td>
                    </tr>
                  );
                })}
                {stats.ultimosFinalizados.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-slate-400">Nenhum edital finalizado.</td></tr>
                )}
              </tbody>
            </table>
            <button
              onClick={() => navigate("/app/licitacoes/grade")}
              className="mt-3 flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              Ver todos os editais finalizados <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </Card>
        </div>

      </div>
    </div>
  );
}
