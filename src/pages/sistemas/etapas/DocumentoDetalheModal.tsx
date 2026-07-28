import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FileDown } from "lucide-react";
import { exportarPdfCaptura } from "./exportarPdfCaptura";
import {
  CAMPOS_ABERTURA, ETAPAS, GRAU_URGENCIA_LABEL, PESQUISA_ENCERRAMENTO,
  PESQUISA_PODE_ENCERRAR_OPCOES, PESQUISA_PODE_ENCERRAR_PERGUNTA, TIPO_SOLICITACAO_LABEL, nomeUsuario,
  type Anexo, type Assinatura, type Comentario, type Convidado, type Solicitacao, type Usuario,
} from "./types";
import { RESUMOS, AnexoIFSDCompleto, AnexoIIDFDCompleto, AnexoIIIPTVCompleto, temDadoResumo } from "./Resumos";
import { Historico } from "./Historico";
import { PdfDocumento, fmtDataHoraPdf } from "@/lib/pdf/PdfDocumento";
import type { DocumentoOficial } from "./documentos";

const ETAPA_LABEL: Record<string, string> = Object.fromEntries(ETAPAS.map((e) => [e.key, e.label]));

function BlocoAssinaturasColuna({ etapaLabel, assinaturas, usuarios }: { etapaLabel: string; assinaturas: Assinatura[]; usuarios: Usuario[] }) {
  return (
    <div className="space-y-2 rounded-lg border-2 border-border p-3">
      <h4 className="text-sm font-bold">
        Assinaturas <span className="text-muted-foreground">- Coluna: {etapaLabel}</span>
      </h4>
      {assinaturas.map((a) => (
        <div key={a.id} className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div>
            <p className="text-sm font-bold">{nomeUsuario(usuarios, a.user_id) ?? "Usuário"}</p>
            <p className="text-xs text-muted-foreground">Assinou em {fmtDataHoraPdf(a.created_at)}</p>
          </div>
        </div>
      ))}
      {assinaturas.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhuma assinatura ainda.</p>}
    </div>
  );
}

function CamposAberturaFixo({ card }: { card: Solicitacao }) {
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detalhes da Abertura</p>
      {CAMPOS_ABERTURA.map((c) => (
        <div key={c.key}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{(card[c.key] as string | null) || "—"}</p>
        </div>
      ))}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Grau de urgência</p>
        <p className="text-sm">{card.grau_urgencia ? GRAU_URGENCIA_LABEL[card.grau_urgencia] ?? card.grau_urgencia : "—"}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo da solicitação</p>
        <p className="text-sm">{card.tipo_solicitacao ? TIPO_SOLICITACAO_LABEL[card.tipo_solicitacao] ?? card.tipo_solicitacao : "—"}</p>
      </div>
    </div>
  );
}

function PesquisaVisual({ card }: { card: Solicitacao }) {
  return (
    <div className="space-y-4">
      {PESQUISA_ENCERRAMENTO.map((p, i) => (
        <div key={p.key} className="space-y-1.5 rounded-md border border-border p-3">
          <p className="text-sm font-medium">{i + 1}. {p.pergunta}</p>
          <div className="space-y-1">
            {p.opcoes.map((opcao, idx) => {
              const valor = idx + 1;
              const marcado = card[p.key] === valor;
              return (
                <div key={opcao} className="flex items-center gap-2 text-sm">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${marcado ? "border-primary" : "border-muted-foreground/40"}`}>
                    {marcado && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className={marcado ? "font-medium" : "text-muted-foreground"}>{valor} – {opcao}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="space-y-1.5 rounded-md border border-border p-3">
        <p className="text-sm font-medium">{PESQUISA_PODE_ENCERRAR_PERGUNTA}</p>
        {Object.entries(PESQUISA_PODE_ENCERRAR_OPCOES).map(([valor, label]) => {
          const marcado = card.pesquisa_pode_encerrar === (valor === "sim");
          return (
            <div key={valor} className="flex items-center gap-2 text-sm">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${marcado ? "border-primary" : "border-muted-foreground/40"}`}>
                {marcado && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span className={marcado ? "font-medium" : "text-muted-foreground"}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function exportarPesquisaPdf(card: Solicitacao, titulo: string, solicitacaoId: string) {
  const pdf = new PdfDocumento(titulo, solicitacaoId);
  pdf.tituloSecao("Pesquisa de Avaliação da Demanda", 18);

  PESQUISA_ENCERRAMENTO.forEach((p, i) => {
    pdf.paragrafo(`${i + 1}. ${p.pergunta}`, { negrito: true, tamanho: 10, espacoDepois: 2 });
    const valor = card[p.key];
    p.opcoes.forEach((opcao, idx) => {
      const marcado = valor === idx + 1;
      pdf.paragrafo(`${marcado ? "[X]" : "[ ]"} ${idx + 1} – ${opcao}`, { tamanho: 9, cor: marcado ? [21, 49, 105] : [120, 120, 120], espacoDepois: 1 });
    });
    pdf.y += 3;
  });

  pdf.paragrafo(PESQUISA_PODE_ENCERRAR_PERGUNTA, { negrito: true, tamanho: 10, espacoDepois: 2 });
  Object.entries(PESQUISA_PODE_ENCERRAR_OPCOES).forEach(([valor, label]) => {
    const marcado = card.pesquisa_pode_encerrar === (valor === "sim");
    pdf.paragrafo(`${marcado ? "[X]" : "[ ]"} ${label}`, { tamanho: 9, cor: marcado ? [21, 49, 105] : [120, 120, 120], espacoDepois: 1 });
  });

  pdf.salvar(`pesquisa-avaliacao-${titulo.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`);
}

function exportarEncerramentoPdf(
  card: Solicitacao, titulo: string, solicitacaoId: string,
  anexos: Anexo[], comentarios: Comentario[], usuarios: Usuario[], assinaturas: Assinatura[],
  logs: Array<{ id: string; user_id: string | null; acao: string; etapa_de: string | null; etapa_para: string | null; detalhe: string | null; created_at: string }>,
) {
  const pdf = new PdfDocumento(titulo, solicitacaoId);
  pdf.tituloSecao("Relatório de Encerramento da Demanda", 18);

  ETAPAS.forEach((etapa) => {
    pdf.garantirEspaco(20);
    pdf.paragrafo(etapa.label, { negrito: true, tamanho: 12, cor: [21, 49, 105], espacoDepois: 2 });
  });

  pdf.y += 4;
  pdf.tituloSecao("Histórico", 13);
  if (logs.length === 0) {
    pdf.paragrafo("Sem histórico.", { tamanho: 9, espacoDepois: 2 });
  } else {
    logs.forEach((l) => {
      const nome = nomeUsuario(usuarios, l.user_id) ?? "Usuário";
      pdf.paragrafo(`${nome} — ${l.acao} — ${fmtDataHoraPdf(l.created_at)}`, { tamanho: 8.5, espacoDepois: 1.5 });
    });
  }

  pdf.y += 4;
  const porEtapa = new Map<string, Assinatura[]>();
  assinaturas.forEach((a) => {
    if (!porEtapa.has(a.etapa)) porEtapa.set(a.etapa, []);
    porEtapa.get(a.etapa)!.push(a);
  });
  ETAPAS.filter((e) => porEtapa.has(e.key)).forEach((etapa) => {
    pdf.blocoAssinaturasColuna(
      `Coluna: ${etapa.label}`,
      porEtapa.get(etapa.key)!.map((a) => ({ nome: nomeUsuario(usuarios, a.user_id) ?? "Usuário", created_at: a.created_at })),
    );
  });

  pdf.salvar(`encerramento-${titulo.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`);
}

export function DocumentoDetalheModal({
  documento, onClose, card, anexos, comentarios, convidados, usuarios, onDownloadAnexo, titulo, solicitacaoId,
}: {
  documento: DocumentoOficial | null;
  onClose: () => void;
  card: Solicitacao;
  anexos: Anexo[];
  comentarios: Comentario[];
  convidados: Convidado[];
  usuarios: Usuario[];
  onDownloadAnexo: (path: string) => void;
  titulo: string;
  solicitacaoId: string;
}) {
  const { data: assinaturas = [] } = useQuery({
    queryKey: ["sistema_solicitacao_assinatura", solicitacaoId],
    enabled: !!documento,
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

  const { data: logs = [] } = useQuery({
    queryKey: ["sistema_solicitacao_log", solicitacaoId],
    enabled: !!documento && documento.tipo === "encerramento_completo",
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sistema_solicitacao_log")
        .select("id, user_id, acao, etapa_de, etapa_para, detalhe, created_at")
        .eq("solicitacao_id", solicitacaoId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!documento) return null;

  const assinaturasDaEtapa = (etapaKey: string) => assinaturas.filter((a) => a.etapa === etapaKey);
  const Resumo = RESUMOS[documento.etapaOrigem];

  const nomeArquivoPdf = `${documento.sigla}-${titulo.replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[90vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Anexo {documento.numero} – {documento.nome} ({documento.sigla})</DialogTitle>
        </DialogHeader>

        {/* Botões de exportar ficam FORA da área de captura para não aparecer no PDF */}
        {(documento.tipo === "anexo_etapa" || documento.tipo === "encerramento_completo") && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => exportarPdfCaptura("pdf-doc-capture-target", nomeArquivoPdf)}
            >
              <FileDown className="h-3.5 w-3.5" /> Exportar PDF
            </Button>
          </div>
        )}

        <div id="pdf-doc-capture-target" className="space-y-4">
          {documento.tipo === "anexos_gerais" && (
            <>
              <CamposAberturaFixo card={card} />
              {anexos.filter((a) => !a.campo).length > 0 && (
                <div className="space-y-1">
                  {anexos.filter((a) => !a.campo).map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded border border-border px-2 py-1 text-[11px]">
                      <span className="truncate">{a.nome_arquivo}</span>
                      <button type="button" onClick={() => onDownloadAnexo(a.storage_path)} className="text-primary hover:underline">abrir</button>
                    </div>
                  ))}
                </div>
              )}
              <BlocoAssinaturasColuna etapaLabel={ETAPA_LABEL[documento.etapaOrigem]} assinaturas={assinaturasDaEtapa(documento.etapaOrigem)} usuarios={usuarios} />
            </>
          )}

          {documento.tipo === "anexo_etapa" && (
            <>
              {/* Título visível no PDF */}
              <div className="border-b border-border pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</p>
                <h2 className="text-base font-bold text-[#153169]">{documento.nome} ({documento.sigla})</h2>
              </div>
              {documento.sigla === "FSD" ? (
                <>
                  <AnexoIFSDCompleto card={card} anexos={anexos} usuarios={usuarios} />
                  <BlocoAssinaturasColuna etapaLabel={ETAPA_LABEL["solicitacao_demanda"]} assinaturas={assinaturasDaEtapa("solicitacao_demanda")} usuarios={usuarios} />
                  <BlocoAssinaturasColuna etapaLabel={ETAPA_LABEL["triagem_inicial"]} assinaturas={assinaturasDaEtapa("triagem_inicial")} usuarios={usuarios} />
                </>
              ) : documento.sigla === "DFD" ? (
                <>
                  <AnexoIIDFDCompleto card={card} anexos={anexos} usuarios={usuarios} />
                  <BlocoAssinaturasColuna etapaLabel={ETAPA_LABEL["documentacao_funcional"]} assinaturas={assinaturasDaEtapa("documentacao_funcional")} usuarios={usuarios} />
                </>
              ) : documento.sigla === "PTV" ? (
                <>
                  <AnexoIIIPTVCompleto card={card} anexos={anexos} usuarios={usuarios} />
                  <BlocoAssinaturasColuna etapaLabel={ETAPA_LABEL["analise_tecnica"]} assinaturas={assinaturasDaEtapa("analise_tecnica")} usuarios={usuarios} />
                </>
              ) : (
                <>
                  {Resumo && <Resumo card={card} anexos={anexos} comentarios={comentarios} usuarios={usuarios} onDownloadAnexo={onDownloadAnexo} />}
                  <BlocoAssinaturasColuna etapaLabel={ETAPA_LABEL[documento.etapaOrigem]} assinaturas={assinaturasDaEtapa(documento.etapaOrigem)} usuarios={usuarios} />
                </>
              )}
            </>
          )}

          {documento.tipo === "pesquisa" && (
            <>
              <div className="flex justify-end">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportarPesquisaPdf(card, titulo, solicitacaoId)}>
                  <FileDown className="h-3.5 w-3.5" /> Exportar PDF
                </Button>
              </div>
              <PesquisaVisual card={card} />
            </>
          )}

          {documento.tipo === "encerramento_completo" && (
            <>
              {/* Título visível no PDF */}
              <div className="border-b border-border pb-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</p>
                <h2 className="text-base font-bold text-[#153169]">{documento.nome} ({documento.sigla})</h2>
              </div>

              <div className="space-y-3">
                {ETAPAS.map((etapa) => {
                  if (!temDadoResumo(etapa.key, card, anexos, comentarios, convidados)) return null;
                  const R = RESUMOS[etapa.key];
                  if (!R) return null;
                  return <R key={etapa.key} card={card} anexos={anexos} comentarios={comentarios} usuarios={usuarios} onDownloadAnexo={onDownloadAnexo} />;
                })}
              </div>

              {/* Pesquisa de Avaliação da Demanda (conteúdo do Anexo VIII) */}
              {(card.pesquisa_atendeu_necessidade != null || card.pesquisa_pode_encerrar != null) && (
                <div className="rounded-md border border-dashed border-border p-3 opacity-90">
                  <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Pesquisa de Avaliação da Demanda <span className="font-normal">— concluído</span>
                  </p>
                  <PesquisaVisual card={card} />
                </div>
              )}

              {/* Sem max-h para que html2canvas capture o histórico completo */}
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico</p>
                <Historico solicitacaoId={solicitacaoId} usuarios={usuarios} />
              </div>

              <div className="space-y-3">
                {ETAPAS.filter((e) => assinaturasDaEtapa(e.key).length > 0).map((etapa) => (
                  <BlocoAssinaturasColuna key={etapa.key} etapaLabel={etapa.label} assinaturas={assinaturasDaEtapa(etapa.key)} usuarios={usuarios} />
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
