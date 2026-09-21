import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { baixar, carregarDadosExportacao, gerarExcel, gerarHtml, nomeArquivo, type Linha } from "./exportar";

// Modal do "Exportar dados" (21/09/2026). Duas perguntas — formato e alcance
// — e um botão. A montagem dos arquivos mora em ./exportar.ts.

interface PatrimonioOpcao { id: number; codigo?: string; descricao: string; cidade?: string }

interface Props {
  db: SupabaseClient;
  patrimonios: PatrimonioOpcao[];
  /** Abrir já com "apenas um" marcado nesse patrimônio (botão do drawer). */
  inicialId?: number | null;
  seloDaConta: (o: Linha) => string;
  autor: string;
  onFechar: () => void;
  onAviso: (msg: string, tipo: "ok" | "err") => void;
}

type Formato = "html" | "excel";
type Alcance = "todos" | "um";

export function ExportarPatrimonios({ db, patrimonios, inicialId, seloDaConta, autor, onFechar, onAviso }: Props) {
  const [formato, setFormato] = useState<Formato>("excel");
  const [alcance, setAlcance] = useState<Alcance>(inicialId ? "um" : "todos");
  const [patId, setPatId] = useState<number | null>(inicialId ?? null);
  const [busca, setBusca] = useState("");
  const [gerando, setGerando] = useState(false);

  const ordenados = useMemo(() => [...patrimonios].sort((a, b) =>
    (parseInt(String(a.codigo ?? "").replace(/\D/g, ""), 10) || 1e9) - (parseInt(String(b.codigo ?? "").replace(/\D/g, ""), 10) || 1e9)), [patrimonios]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? ordenados.filter(p => `${p.codigo ?? ""} ${p.descricao} ${p.cidade ?? ""}`.toLowerCase().includes(q)) : ordenados;
  }, [ordenados, busca]);

  const exportar = async () => {
    if (alcance === "um" && !patId) { onAviso("Escolha o patrimônio que vai ser exportado.", "err"); return; }
    setGerando(true);
    try {
      const dados = await carregarDadosExportacao(db, alcance === "um" ? patId : null);
      if (!dados.patrimonios.length) { onAviso("Nenhum patrimônio para exportar.", "err"); return; }
      const opcoes = { seloDaConta, autor };
      const nome = nomeArquivo(dados, alcance === "um");
      if (formato === "excel") baixar(gerarExcel(dados, opcoes), `${nome}.xlsx`);
      else baixar(gerarHtml(dados, opcoes), `${nome}.html`);
      onAviso("Exportação gerada — confira os downloads.", "ok");
      onFechar();
    } catch (e) {
      onAviso("Não deu para exportar: " + (e instanceof Error ? e.message : String(e)), "err");
    } finally {
      setGerando(false);
    }
  };

  const opcao = (ativo: boolean) => ({
    flex: 1, textAlign: "left" as const, cursor: "pointer", borderRadius: 12, padding: "12px 14px",
    border: `2px solid ${ativo ? "#0f3171" : "#e2e8f0"}`, background: ativo ? "#eef4ff" : "#fff",
  });
  const titulo = { fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase" as const, letterSpacing: ".4px", marginBottom: 8 };

  return (
    <div className="jp-ov" onClick={e => { if (e.target === e.currentTarget && !gerando) onFechar(); }}>
      <div className="jp-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Exportar dados</div>
        <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 16 }}>
          Sai a ficha do patrimônio e tudo o que está nas abas: contas, parcelas, acessos, contatos, documentos, histórico e comentários.
        </div>

        <div style={titulo}>1. Em que formato?</div>
        <div className="jp-row" style={{ marginBottom: 16 }}>
          <button type="button" style={opcao(formato === "excel")} onClick={() => setFormato("excel")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>📊 Excel</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>Planilha com uma aba por assunto, valores prontos pra somar e filtrar.</div>
          </button>
          <button type="button" style={opcao(formato === "html")} onClick={() => setFormato("html")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>📄 HTML</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>Relatório pra ler no navegador ou imprimir / salvar em PDF.</div>
          </button>
        </div>

        <div style={titulo}>2. Quais patrimônios?</div>
        <div className="jp-row" style={{ marginBottom: 12 }}>
          <button type="button" style={opcao(alcance === "todos")} onClick={() => setAlcance("todos")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Todos ({patrimonios.length})</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>Informações completas de todos os patrimônios.</div>
          </button>
          <button type="button" style={opcao(alcance === "um")} onClick={() => setAlcance("um")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Apenas um</div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>Informações completas de um patrimônio escolhido.</div>
          </button>
        </div>

        {alcance === "um" && (
          <div style={{ marginBottom: 12 }}>
            <input className="jp-fi" placeholder="Buscar por código, descrição ou cidade" value={busca} onChange={e => setBusca(e.target.value)} style={{ marginBottom: 6 }} />
            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              {visiveis.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: "#94a3b8" }}>Nenhum patrimônio encontrado.</div>}
              {visiveis.map(p => (
                <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f1f5f9", background: patId === p.id ? "#eef4ff" : undefined }}>
                  <input type="radio" name="exp-pat" checked={patId === p.id} onChange={() => setPatId(p.id)} />
                  <span style={{ color: "#64748b", fontWeight: 700, minWidth: 34 }}>{p.codigo || "—"}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{p.descricao}</span>
                  {p.cidade && <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{p.cidade}</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button className="jp-btn" onClick={onFechar} disabled={gerando} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
          <button className="jp-btn" onClick={exportar} disabled={gerando} style={{ background: "#0f3171", color: "#fff", opacity: gerando ? 0.7 : 1 }}>
            {gerando ? "Gerando…" : `Exportar ${formato === "excel" ? "Excel" : "HTML"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
