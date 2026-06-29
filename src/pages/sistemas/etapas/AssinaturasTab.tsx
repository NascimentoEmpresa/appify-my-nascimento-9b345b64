import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, FileDown } from "lucide-react";
import { ETAPAS, nomeUsuario, type Assinatura, type Usuario } from "./types";

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = MESES_ABREV[d.getMonth()];
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${dia} ${mes} ${d.getFullYear()} às ${hora}`;
}

const FONTE_ASSINATURA = "'Dancing Script', cursive";

// Renderiza o nome digitado num canvas em letra cursiva/emendada (uma vez,
// não é desenho à mão) e devolve o PNG em base64.
async function gerarPngAssinatura(nome: string): Promise<string> {
  await document.fonts.load(`700 64px ${FONTE_ASSINATURA}`);
  await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = 700;
  canvas.height = 220;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1e293b";
  ctx.font = `700 72px ${FONTE_ASSINATURA}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(nome, canvas.width / 2, canvas.height / 2);
  return canvas.toDataURL("image/png");
}

function AssinarForm({ nomePadrao, onSalvar }: { nomePadrao: string; onSalvar: (png: string) => Promise<void> }) {
  const [nome, setNome] = useState(nomePadrao);
  const [salvando, setSalvando] = useState(false);

  const assinar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);
    const png = await gerarPngAssinatura(nome.trim());
    await onSalvar(png);
    setSalvando(false);
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-4">
      <h3 className="text-lg font-bold">Assinar</h3>
      <p className="text-sm text-muted-foreground">digite seu nome — a assinatura é gerada em letra emendada</p>
      <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Digite seu nome" className="text-sm" />
      <div className="flex h-32 items-center justify-center rounded border border-border bg-white px-4">
        <p style={{ fontFamily: FONTE_ASSINATURA, fontWeight: 700 }} className="max-w-full truncate text-4xl text-slate-800">
          {nome || "Sua assinatura"}
        </p>
      </div>
      <div className="flex gap-2">
        <Button disabled={!nome.trim() || salvando} onClick={assinar}>{salvando ? "Salvando…" : "Salvar"}</Button>
        <Button variant="outline" onClick={() => setNome("")}>Limpar</Button>
      </div>
    </div>
  );
}

export function AssinaturasTab({
  solicitacaoId, etapaAtual, usuarios, userId, titulo,
}: {
  solicitacaoId: string;
  etapaAtual: string;
  usuarios: Usuario[];
  userId: string | null;
  titulo: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: assinaturas = [] } = useQuery({
    queryKey: ["sistema_solicitacao_assinatura", solicitacaoId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistema_solicitacao_assinatura")
        .select("id, user_id, etapa, assinatura_png, created_at")
        .eq("solicitacao_id", solicitacaoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Assinatura[];
    },
  });

  const salvarAssinatura = async (png: string) => {
    if (!userId) return;
    const { error } = await (supabase as any).from("sistema_solicitacao_assinatura").insert({
      solicitacao_id: solicitacaoId,
      user_id: userId,
      etapa: etapaAtual,
      assinatura_png: png,
    });
    if (error) {
      toast({ title: "Erro ao assinar", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["sistema_solicitacao_assinatura", solicitacaoId] });
    toast({ title: "Assinatura salva" });
  };

  // Agrupa por etapa, na ordem do quadro — só as que de fato têm assinatura.
  const porEtapa = new Map<string, Assinatura[]>();
  assinaturas.forEach((a) => {
    if (!porEtapa.has(a.etapa)) porEtapa.set(a.etapa, []);
    porEtapa.get(a.etapa)!.push(a);
  });
  const etapasComAssinatura = ETAPAS.filter((e) => porEtapa.has(e.key));

  const exportarPdf = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const margemX = 15;
    const margemDireita = 195;
    const docId = solicitacaoId.slice(0, 8);
    const geradoEm = fmtDataHora(new Date().toISOString());

    const NAVY: [number, number, number] = [21, 49, 105];
    const NAVY_SUAVE: [number, number, number] = [110, 130, 165];
    const VERDE: [number, number, number] = [27, 145, 84];

    const cabecalho = () => {
      doc.setFontSize(8);
      doc.setTextColor(...NAVY_SUAVE);
      doc.text("Datas e horários em GMT -03:00 Brasília", margemDireita, 14, { align: "right" });
      doc.text(`PDF gerado em ${geradoEm}`, margemDireita, 18.5, { align: "right" });

      doc.setFontSize(13);
      doc.setTextColor(20);
      doc.setFont("helvetica", "bold");
      doc.text(titulo, margemX, 16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...NAVY_SUAVE);
      doc.text(`Documento número #${docId}`, margemX, 21);

      doc.setDrawColor(...NAVY);
      doc.setLineWidth(0.7);
      doc.line(margemX - 4, 25.5, margemDireita, 25.5);
    };

    const desenharBox = (boxStartY: number, fimY: number) => {
      doc.setDrawColor(214, 221, 232);
      doc.setLineWidth(0.4);
      doc.roundedRect(margemX - 4, boxStartY, 172, fimY - boxStartY, 2, 2);

      doc.setFillColor(...NAVY);
      doc.roundedRect(margemX - 4, boxStartY, 1.6, fimY - boxStartY, 0.8, 0.8, "F");
    };

    // Círculo preenchido com check branco — igual ao ícone da tela
    // (CheckCircle2), não o glifo unicode ✓ (não existe nas fontes do jsPDF).
    const desenharCheckCirculo = (cx: number, cy: number) => {
      doc.setFillColor(...VERDE);
      doc.circle(cx, cy, 1.8, "F");
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(0.45);
      doc.line(cx - 0.9, cy, cx - 0.2, cy + 0.7);
      doc.line(cx - 0.2, cy + 0.7, cx + 1, cy - 0.9);
    };

    let y = 38;
    const novaPagina = () => { doc.addPage(); cabecalho(); y = 38; };

    cabecalho();

    // "Assinaturas - Coluna: {etapa}" numa linha só, dentro da caixa — igual
    // ao cabeçalho de cada card na tela. Devolve onde a caixa começa.
    const abrirSecaoEtapa = (etapaLabel: string) => {
      const boxStartY = y - 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      doc.text("Assinaturas", margemX, y);
      const largura = doc.getTextWidth("Assinaturas");
      doc.setTextColor(...NAVY_SUAVE);
      doc.text(` - Coluna: ${etapaLabel}`, margemX + largura, y);
      y += 9;
      return boxStartY;
    };

    if (etapasComAssinatura.length === 0) {
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text("Nenhuma assinatura registrada.", margemX, y);
    } else {
      // Seções uma depois da outra, sem forçar página por etapa — só quebra
      // página quando o conteúdo de fato não cabe mais.
      etapasComAssinatura.forEach((etapa, i) => {
        const lista = porEtapa.get(etapa.key)!;

        if (i > 0) y += 4;
        if (y > 250) novaPagina();

        let boxStartY = abrirSecaoEtapa(etapa.label);

        lista.forEach((a) => {
          if (y > 250) {
            desenharBox(boxStartY, y + 4);
            novaPagina();
            boxStartY = abrirSecaoEtapa(etapa.label);
          }
          const nome = nomeUsuario(usuarios, a.user_id) ?? "Usuário";

          desenharCheckCirculo(margemX + 1.8, y - 1.6);

          doc.setFont("helvetica", "bold");
          doc.setFontSize(10.5);
          doc.setTextColor(20);
          doc.text(nome, margemX + 6, y);
          y += 5;

          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(120);
          doc.text(`Assinou em ${fmtDataHora(a.created_at)}`, margemX + 6, y);
          y += 8;
        });

        y += 2;
        desenharBox(boxStartY, y + 3);
        y += 11;
      });
    }

    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setDrawColor(...NAVY_SUAVE);
      doc.setLineWidth(0.2);
      doc.line(margemX - 4, 283, margemDireita, 283);
      doc.setFontSize(7.5);
      doc.setTextColor(...NAVY_SUAVE);
      doc.text(`#${docId}`, margemX, 287);
      doc.text(`Página ${p} de ${total}`, margemDireita, 287, { align: "right" });
    }

    doc.save(`assinaturas-${titulo.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`);
  };

  return (
    <div className="max-h-[480px] space-y-3 overflow-y-auto py-2">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={exportarPdf}>
          <FileDown className="h-3.5 w-3.5" /> Exportar PDF
        </Button>
      </div>

      <div className="space-y-3">
        {etapasComAssinatura.map((etapa) => (
          <div key={etapa.key} className="space-y-2 rounded-lg border-2 border-border p-3">
            <h4 className="text-sm font-bold">
              Assinaturas <span className="text-muted-foreground">- Coluna: {etapa.label}</span>
            </h4>
            {porEtapa.get(etapa.key)!.map((a) => (
              <div key={a.id} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div>
                  <p className="text-sm font-bold">{nomeUsuario(usuarios, a.user_id) ?? "Usuário"}</p>
                  <p className="text-xs text-muted-foreground">Assinou em {fmtDataHora(a.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        ))}
        {etapasComAssinatura.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhuma assinatura ainda.</p>}
      </div>

      <AssinarForm nomePadrao={nomeUsuario(usuarios, userId) ?? ""} onSalvar={salvarAssinatura} />
    </div>
  );
}
