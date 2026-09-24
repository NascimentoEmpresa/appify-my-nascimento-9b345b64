import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROTULO_STATUS_ALUNO, type StatusAluno } from "./tipos";

// =====================================================================
// Peças visuais compartilhadas pelas telas da plataforma de Treinamentos.
// A linguagem é a das centrais recentes (Recrutamento, Jurídico): hero
// azul com o recorte em pílulas, KPIs com ícone, cartões brancos. CSS
// inline num <style> único (`TrnEstilo`) para as 15 telas não repetirem.
// =====================================================================

export function TrnEstilo() {
  return (
    <style>{`
      .trn{--azul:#0f3171;--azul2:#1d4ed8;--laranja:#f26522}
      .trn-hero{position:relative;overflow:hidden;border-radius:22px;padding:24px 28px 22px;background:linear-gradient(135deg,#0f3171 0%,#1d4ed8 60%,#2563eb 100%);color:#fff;box-shadow:0 20px 50px rgba(15,49,113,.25);margin-bottom:18px}
      .trn-hero::before{content:"";position:absolute;right:-60px;top:-80px;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,.07)}
      .trn-hero-in{position:relative;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      .trn-hero .eyebrow{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
      .trn-hero h1{margin:4px 0 6px;font-size:26px;font-weight:900;letter-spacing:-.4px;line-height:1.1}
      .trn-hero p{margin:0;font-size:13.5px;opacity:.9;max-width:720px;line-height:1.5}
      .trn-hero .acoes{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .trn-hero .acoes a,.trn-hero .acoes button{background:#fff;color:var(--azul);border:none;border-radius:10px;padding:9px 14px;font-weight:800;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
      .trn-hero .acoes .sec{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.35)}
      .trn-pilulas{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
      .trn-pilula{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:4px 11px;font-size:12px;font-weight:700}
      .trn-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:18px}
      .trn-kpi{background:#fff;border:1px solid #e5e9f2;border-radius:16px;padding:16px 18px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
      .trn-kpi .rot{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748b}
      .trn-kpi .val{font-size:28px;font-weight:900;color:#0f172a;line-height:1.1;margin-top:6px}
      .trn-kpi .sub{font-size:12px;color:#64748b;margin-top:4px}
      .trn-kpi .ico{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:#fff2ec;color:var(--laranja)}
      .trn-card{background:#fff;border:1px solid #e5e9f2;border-radius:16px;padding:18px}
      .trn-card h3{margin:0 0 2px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748b}
      .trn-card .sub{font-size:12px;color:#94a3b8;margin-bottom:12px}
      .trn-tab{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
      .trn-tab th{text-align:left;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;padding:10px 12px;border-bottom:1px solid #e5e9f2;background:#f8fafc;white-space:nowrap}
      .trn-tab td{padding:11px 12px;border-bottom:1px solid #eef2f7;vertical-align:middle}
      .trn-tab tr:hover td{background:#f8fafc}
      .trn-tab a.nome{font-weight:800;color:var(--azul);text-decoration:none}
      .trn-tab a.nome:hover{text-decoration:underline}
      .trn-tagchip{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:2px 8px;font-size:10.5px;font-weight:800;margin:1px 3px 1px 0;white-space:nowrap}
      .trn-form{display:grid;gap:14px}
      .trn-form .campo label{display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:5px}
      .trn-form .campo .ajuda{font-size:11.5px;color:#94a3b8;margin-top:4px;line-height:1.4}
      .trn-form .grupo{border:1px solid #e5e9f2;border-radius:14px;padding:16px;background:#fff}
      .trn-form .grupo h4{margin:0 0 10px;font-size:13.5px;font-weight:800;color:#0f172a}
      .trn-opcao{border:1px solid #e5e9f2;border-radius:12px;padding:12px 14px;cursor:pointer;display:flex;gap:10px;align-items:flex-start;background:#fff}
      .trn-opcao.on{border-color:var(--laranja);background:#fff7f3}
      .trn-opcao b{display:block;font-size:13px;color:#0f172a}
      .trn-opcao span{font-size:12px;color:#64748b}
      .trn-lateral{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start}
      @media (max-width:1000px){.trn-lateral{grid-template-columns:1fr}}
      .trn-ajuda{background:#fff;border:1px solid #e5e9f2;border-radius:16px;padding:18px;font-size:13px;color:#475569;line-height:1.55}
      .trn-ajuda h4{margin:0 0 6px;font-size:14px;font-weight:800;color:#0f172a}
      .trn-ajuda h5{margin:14px 0 4px;font-size:12px;font-weight:800;color:#0f172a}
      .trn-vazio{padding:38px 20px;text-align:center;color:#64748b;font-size:14px}
      .trn-vazio b{display:block;font-size:18px;color:#0f172a;margin-bottom:6px}
      .trn-curso-card{background:#fff;border:1px solid #e5e9f2;border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
      .trn-curso-card .capa{aspect-ratio:10/7;background:linear-gradient(135deg,#0f3171,#2563eb);display:grid;place-items:center;color:#fff;font-weight:900;font-size:22px;text-align:center;padding:12px}
      .trn-curso-card .capa img{width:100%;height:100%;object-fit:cover}
      .trn-curso-card .corpo{padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px;flex:1}
      .trn-curso-card .corpo h3{margin:0;font-size:15px;font-weight:800;color:#0f172a}
      .trn-curso-card .corpo p{margin:0;font-size:12.5px;color:#64748b;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .trn-badge{display:inline-flex;align-items:center;border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:800}
      .trn-badge.ok{background:#dcfce7;color:#166534}.trn-badge.off{background:#f1f5f9;color:#475569}.trn-badge.warn{background:#fef3c7;color:#92400e}.trn-badge.err{background:#fee2e2;color:#991b1b}.trn-badge.info{background:#e0e7ff;color:#3730a3}
    `}</style>
  );
}

export function TrnHero({ eyebrow = "Treinamentos", titulo, texto, acoes, pilulas }: {
  eyebrow?: string; titulo: string; texto?: string; acoes?: ReactNode; pilulas?: string[];
}) {
  return (
    <div className="trn-hero">
      <div className="trn-hero-in">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{titulo}</h1>
          {texto && <p>{texto}</p>}
          {pilulas && pilulas.length > 0 && (
            <div className="trn-pilulas">{pilulas.map((p) => <span key={p} className="trn-pilula">{p}</span>)}</div>
          )}
        </div>
        {acoes && <div className="acoes">{acoes}</div>}
      </div>
    </div>
  );
}

export function TrnKpi({ rotulo, valor, sub, icone }: { rotulo: string; valor: ReactNode; sub?: ReactNode; icone: ReactNode }) {
  return (
    <div className="trn-kpi">
      <div>
        <div className="rot">{rotulo}</div>
        <div className="val">{valor}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="ico">{icone}</div>
    </div>
  );
}

export function TrnCarregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {texto}
    </Card>
  );
}

export function TrnVazio({ titulo, texto, acao }: { titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="trn-card">
      <div className="trn-vazio">
        <b>{titulo}</b>
        {texto}
        {acao && <div className="mt-4 flex justify-center">{acao}</div>}
      </div>
    </div>
  );
}

export function StatusAlunoBadge({ status }: { status: StatusAluno }) {
  const cls = status === "ativo" ? "ok" : status === "bloqueado" ? "err" : status === "inativo" ? "warn" : "off";
  return <span className={`trn-badge ${cls}`}>{ROTULO_STATUS_ALUNO[status] ?? status}</span>;
}

/**
 * Público de aviso, notificação e evento. Era "Todos os alunos" × "Alunos com
 * tags específicas"; as tags saíram em 22/09/2026 ("tira as tags, não vai
 * precisar" — Pablo), então sobra Todos. A assinatura ficou igual pras três
 * telas não mudarem; registro antigo marcado "tags" volta pra "todos".
 */
export function PublicoPicker({ publico, onPublico, verboTodos = "Exibir" }: {
  publico: "todos" | "tags"; tagIds?: string[];
  onPublico: (p: "todos" | "tags") => void; onTags?: (ids: string[]) => void;
  verboTodos?: string; verboTags?: string;
}) {
  useEffect(() => { if (publico !== "todos") onPublico("todos"); }, [publico, onPublico]);
  return (
    <div className="trn-opcao on">
      <input type="radio" checked readOnly className="mt-1" />
      <div><b>Todos os alunos</b><span>{verboTodos} para todos os alunos da plataforma.</span></div>
    </div>
  );
}

/** Paginação simples (20/50/100 por página, como a lista do membox). */
export function usePaginacao<T>(lista: T[], inicial = 20) {
  const [porPagina, setPorPagina] = useState(inicial);
  const [pagina, setPagina] = useState(1);
  useEffect(() => { setPagina(1); }, [lista.length, porPagina]);
  const total = Math.max(1, Math.ceil(lista.length / porPagina));
  const atual = Math.min(pagina, total);
  const itens = useMemo(() => lista.slice((atual - 1) * porPagina, atual * porPagina), [lista, atual, porPagina]);
  return { itens, pagina: atual, total, porPagina, setPorPagina, setPagina };
}

export function Paginacao({ pagina, total, porPagina, setPorPagina, setPagina, quantidade, rotulo = "itens" }: {
  pagina: number; total: number; porPagina: number; setPorPagina: (n: number) => void; setPagina: (n: number) => void;
  quantidade: number; rotulo?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <span>Total: <b>{quantidade}</b> {rotulo}</span>
      <div className="flex items-center gap-2">
        <span>Por página:</span>
        {[20, 50, 100].map((n) => (
          <button key={n} onClick={() => setPorPagina(n)}
                  className={`rounded px-2 py-1 ${porPagina === n ? "bg-primary text-white" : "hover:bg-muted"}`}>{n}</button>
        ))}
        <span className="mx-2">|</span>
        <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>‹</Button>
        <span>{pagina} / {total}</span>
        <Button variant="outline" size="sm" disabled={pagina >= total} onClick={() => setPagina(pagina + 1)}>›</Button>
      </div>
    </div>
  );
}

export const fmtData = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("pt-BR") : "—";
export const fmtDataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const hojeISO = () => new Date().toISOString().slice(0, 10);

export function LinkVoltar({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="text-xs font-semibold text-primary hover:underline">{children}</Link>;
}

export function BadgeSimNao({ v, sim = "Sim", nao = "Não" }: { v: boolean; sim?: string; nao?: string }) {
  return <Badge variant="outline" className={v ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600"}>{v ? sim : nao}</Badge>;
}
