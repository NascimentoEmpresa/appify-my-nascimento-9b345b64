import { BarChart3 } from "lucide-react";
import { WidgetGrafico } from "@/components/bi/WidgetGrafico";
import type { ResultadoSql, TipoWidget, WidgetConfig } from "@/lib/bi/estudio";
import { FaixaGerencial, useTamanho } from "./paginasGerencialPainel";

// =====================================================================
// B.I nas TVs (14/10/2026, mig 20261014000012) — item "bi:<id>" da playlist
//
// Pedido do Pablo: "também tem que ser possível eu colocar B.I nas TVs".
// Um painel do Estúdio de BI inteiro numa tela: a mesma grade de 12 colunas
// do Estúdio (largura/altura de cada gráfico) e o mesmo desenho
// (WidgetGrafico), com os filtros do painel no valor padrão. A TV não tem
// login: os dados vêm de tv_relatorio › tv_bi_dados (bi_rodar no banco).
// O link de BI externo (Power BI…) entra como "Página web".
// =====================================================================

export interface WidgetBiTv {
  id: number; titulo: string; subtitulo: string | null; tipo: TipoWidget; config: WidgetConfig;
  largura: number; altura: number; dados: (ResultadoSql & { erro?: string }) | null;
}
export interface PainelBiTv { painel: { id: number; nome: string; descricao: string | null; tema?: string | null }; widgets: WidgetBiTv[] }

/** Linhas da grade (12 colunas): empacota na ordem, cada linha tem a altura do maior. */
export function linhasDaGrade(ws: Pick<WidgetBiTv, "largura" | "altura">[]): number {
  let total = 0, usado = 0, alturaLinha = 0;
  for (const w of ws) {
    const l = Math.min(12, Math.max(1, w.largura || 6));
    if (usado + l > 12) { total += alturaLinha; usado = 0; alturaLinha = 0; }
    usado += l; alturaLinha = Math.max(alturaLinha, Math.max(1, w.altura || 2));
  }
  return Math.max(1, total + alturaLinha);
}

export function TelaBiTv({ d, cor, atualizado }: { d: PainelBiTv; cor: string; atualizado: string | null }) {
  const escuro = d.painel.tema === "escuro";
  const fundoCartao = escuro ? "#1b1b19" : "#ffffff";
  const linhas = linhasDaGrade(d.widgets);
  return (
    <div className="flex h-full w-full flex-col" style={{ color: escuro ? "#fff" : "#18181b" }}>
      <FaixaGerencial cor={cor} sobre="B.I · Estúdio de BI do ERP" titulo={d.painel.nome} pergunta={d.painel.descricao} placarTv={null} altura={140} />
      <div className="min-h-0 flex-1" style={{ padding: "18px 30px 12px" }}>
        {d.widgets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl" style={{ background: fundoCartao, color: "#71717a" }}>
            <BarChart3 style={{ width: 56, height: 56, opacity: 0.5 }} />
            <p className="font-bold" style={{ fontSize: 28 }}>Este painel de BI ainda não tem gráficos</p>
            <p style={{ fontSize: 18 }}>Monte os gráficos em B.I › Estúdio — a TV mostra sozinha.</p>
          </div>
        ) : (
          <div className="grid h-full" style={{ gap: 14, gridTemplateColumns: "repeat(12, minmax(0,1fr))", gridTemplateRows: `repeat(${linhas}, minmax(0,1fr))` }}>
            {d.widgets.map((w) => (
              <div key={w.id} className="flex min-h-0 min-w-0 flex-col overflow-hidden"
                style={{ gridColumn: `span ${Math.min(12, Math.max(1, w.largura || 6))}`, gridRow: `span ${Math.max(1, w.altura || 2)}`,
                         background: fundoCartao, borderRadius: 20, padding: "14px 18px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.08)" }}>
                <p className="shrink-0 truncate font-extrabold" style={{ fontSize: 20 }}>{w.titulo}</p>
                {w.subtitulo && <p className="shrink-0 truncate font-semibold" style={{ fontSize: 14, color: "#71717a" }}>{w.subtitulo}</p>}
                <CorpoWidget w={w} escuro={escuro} />
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="shrink-0 px-8 pb-2 text-right font-semibold" style={{ fontSize: 15, color: "#71717a" }}>{atualizado ? `Atualizado às ${atualizado}` : ""}</p>
    </div>
  );
}

function CorpoWidget({ w, escuro }: { w: WidgetBiTv; escuro: boolean }) {
  const { ref, h } = useTamanho<HTMLDivElement>();
  return (
    <div ref={ref} className="relative mt-2 min-h-0 flex-1">
      {w.dados?.erro ? (
        <p className="flex h-full items-center justify-center text-center font-semibold" style={{ fontSize: 16, color: "#b91c1c" }}>Não foi possível calcular: {w.dados.erro}</p>
      ) : h > 0 ? (
        <WidgetGrafico tipo={w.tipo} config={w.config ?? {}} dados={w.dados} escuro={escuro} altura={h} />
      ) : null}
    </div>
  );
}
