import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

// "Exportar dados" — o modal comum (21/09/2026). Faz as duas perguntas
// (formato e alcance) e devolve a escolha para a tela, que sabe buscar e
// montar os próprios dados (ver src/lib/exportarRelatorio.ts).
//
// Vai por portal para o <body>: a rota animada (`.sh-entra`, com transform)
// vira containing block do `position: fixed` e prenderia o modal na área de
// conteúdo — o mesmo motivo do portal no detalhe de Processos.

export type FormatoExportacao = "excel" | "html";

export interface OpcaoRegistro { id: string; titulo: string; detalhe?: string; busca?: string }

interface Props {
  /** "patrimônio" / "patrimônios" — entra nos textos. */
  nome: { um: string; varios: string };
  /** O que vai dentro do arquivo, numa frase. */
  conteudo: string;
  registros: OpcaoRegistro[];
  /** Abre já com "apenas um" marcado nesse registro. */
  inicialId?: string | null;
  /**
   * Gera e baixa. `progresso` atualiza a linha de status do modal enquanto
   * roda (ex.: "Comprovantes 120/407").
   */
  onExportar: (formato: FormatoExportacao, id: string | null, progresso: (msg: string) => void) => Promise<void>;
  onFechar: () => void;
  onErro: (msg: string) => void;
}

export function ModalExportarDados({ nome, conteudo, registros, inicialId, onExportar, onFechar, onErro }: Props) {
  const [formato, setFormato] = useState<FormatoExportacao>("excel");
  const [alcance, setAlcance] = useState<"todos" | "um">(inicialId ? "um" : "todos");
  const [id, setId] = useState<string | null>(inicialId ?? null);
  const [busca, setBusca] = useState("");
  const [gerando, setGerando] = useState(false);
  const [progresso, setProgresso] = useState("");

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q ? registros.filter(r => `${r.titulo} ${r.detalhe ?? ""} ${r.busca ?? ""}`.toLowerCase().includes(q)) : registros;
    return base.slice(0, 300); // a lista é pra escolher, não pra rolar mil linhas
  }, [registros, busca]);
  const escolhido = registros.find(r => r.id === id);

  const exportar = async () => {
    if (alcance === "um" && !id) { onErro(`Escolha o ${nome.um} que vai ser exportado.`); return; }
    setGerando(true); setProgresso("Buscando os dados…");
    try {
      await onExportar(formato, alcance === "um" ? id : null, setProgresso);
      onFechar();
    } catch (e) {
      onErro("Não deu para exportar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGerando(false); setProgresso("");
    }
  };

  const cartao = (ativo: boolean): React.CSSProperties => ({
    flex: 1, minWidth: 200, textAlign: "left", cursor: "pointer", borderRadius: 12, padding: "12px 14px",
    border: `2px solid ${ativo ? "#0f3171" : "#e2e8f0"}`, background: ativo ? "#eef4ff" : "#fff", color: "#0f172a",
  });
  const passo: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 };
  const sub: React.CSSProperties = { fontSize: 11.5, color: "#64748b", marginTop: 2, fontWeight: 500 };
  const botao: React.CSSProperties = { border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 12.5, padding: "9px 16px" };

  return createPortal(
    <div onClick={e => { if (e.target === e.currentTarget && !gerando) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="dialog" aria-label="Exportar dados"
        style={{ background: "#fff", borderRadius: 16, padding: 22, width: "100%", maxWidth: 580, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 16px 40px rgba(15,23,42,.18)" }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>Exportar dados</div>
        <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 16 }}>{conteudo}</div>

        <div style={passo}>1. Em que formato?</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <button type="button" style={cartao(formato === "excel")} onClick={() => setFormato("excel")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>📊 Excel</div>
            <div style={sub}>Planilha com uma aba por assunto, valores prontos pra somar e filtrar.</div>
          </button>
          <button type="button" style={cartao(formato === "html")} onClick={() => setFormato("html")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>📄 HTML</div>
            <div style={sub}>Relatório pra ler no navegador ou imprimir / salvar em PDF.</div>
          </button>
        </div>

        <div style={passo}>2. Quais {nome.varios}?</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <button type="button" style={cartao(alcance === "todos")} onClick={() => setAlcance("todos")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Todos ({registros.length})</div>
            <div style={sub}>Informações completas de todos os {nome.varios}.</div>
          </button>
          <button type="button" style={cartao(alcance === "um")} onClick={() => setAlcance("um")}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Apenas um</div>
            <div style={sub}>{escolhido ? escolhido.titulo : `Informações completas de um ${nome.um} escolhido.`}</div>
          </button>
        </div>

        {alcance === "um" && (
          <div style={{ marginBottom: 12 }}>
            <input placeholder={`Buscar ${nome.um}…`} value={busca} onChange={e => setBusca(e.target.value)} autoFocus
              style={{ width: "100%", height: 40, border: "1px solid #cbd5e1", borderRadius: 9, padding: "0 11px", fontSize: 13, marginBottom: 6, boxSizing: "border-box" }} />
            <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              {visiveis.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: "#94a3b8" }}>Nada encontrado.</div>}
              {visiveis.map(r => (
                <label key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f1f5f9", background: id === r.id ? "#eef4ff" : undefined }}>
                  <input type="radio" name="exp-registro" checked={id === r.id} onChange={() => setId(r.id)} />
                  <span style={{ flex: 1, fontWeight: 600, color: "#0f172a" }}>{r.titulo}</span>
                  {r.detalhe && <span style={{ fontSize: 11.5, color: "#94a3b8", textAlign: "right" }}>{r.detalhe}</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>{progresso}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onFechar} disabled={gerando} style={{ ...botao, background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
            <button type="button" onClick={exportar} disabled={gerando} style={{ ...botao, background: "#0f3171", color: "#fff", opacity: gerando ? 0.7 : 1 }}>
              {gerando ? "Gerando…" : `Exportar ${formato === "excel" ? "Excel" : "HTML"}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
