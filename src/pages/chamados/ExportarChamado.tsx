import { useState } from "react";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FileDown, FolderDown, Loader2 } from "lucide-react";
import { PdfDocumento, fmtDataHoraPdf } from "@/lib/pdf/PdfDocumento";
import { bytesLegivel, nomeNoZip, pastaDe } from "./exportarUtils";
import {
  BUCKET_CHAMADOS, CATEGORIAS, TIPOS, IMPACTOS, URGENCIAS, AMBIENTES,
  PRIORIDADES, STATUS_CHAMADO, CRITERIOS_AVALIACAO, labelDe, moduloLabel,
  mediaAvaliacao, fmtDataHora,
  type Anexo, type AvaliacaoChamado, type Chamado, type Evento,
} from "./types";

// =====================================================================
// EXPORTAÇÃO DO CHAMADO — anexos em ZIP e relatório em PDF
//
// As duas ações servem ao mesmo momento: alguém precisa levar o chamado
// para fora do ERP (auditoria, anexo de processo, prestação de contas).
//
// DECISÕES QUE VALEM COMENTÁRIO
//   · O ZIP é montado NO NAVEGADOR. O arquivo já está no storage e o
//     usuário já tem permissão de ler cada um; mandar isso para uma Edge
//     Function só acrescentaria uma cópia do binário subindo e descendo.
//   · Um anexo que falha NÃO derruba o pacote. O zip sai com o resto e um
//     `_FALHAS.txt` dentro dizendo o que não veio — melhor entregar 9 de 10
//     e avisar do que não entregar nada.
//   · O PDF sai do mesmo `PdfDocumento` do resto do ERP, então cabeçalho,
//     numeração de página e identificador do documento são os de sempre.
// =====================================================================

// `integrations/supabase/types.ts` é gerado e não conhece as tabelas de
// chamados. O resto do módulo resolve isso com `(supabase as any)` em cada
// chamada; aqui a exceção fica num lugar só e o arquivo segue sem `any`.
const db = supabase as unknown as SupabaseClient;

interface Dados {
  chamado: Chamado;
  anexos: Anexo[];
  eventos: Evento[];
  avaliacao: AvaliacaoChamado | null;
  /** id do autor → nome, para o relatório não mostrar uuid. */
  nomes: Record<string, string>;
}

/** Lê tudo o que o relatório precisa. A RLS do chamado continua valendo. */
async function carregar(chamadoId: string): Promise<Dados> {
  const [c, a, e, av] = await Promise.all([
    db.from("CHAMADO_SISTEMA").select("*").eq("id", chamadoId).single(),
    db.from("CHAMADO_SISTEMA_ANEXO").select("*").eq("chamado_id", chamadoId).order("created_at"),
    db.from("CHAMADO_SISTEMA_EVENTO").select("*").eq("chamado_id", chamadoId).order("created_at"),
    db.from("CHAMADO_SISTEMA_AVALIACAO").select("*").eq("chamado_id", chamadoId).maybeSingle(),
  ]);

  const chamado = c.data as Chamado;
  const anexos = (a.data ?? []) as Anexo[];
  const eventos = (e.data ?? []) as Evento[];

  // Nomes dos autores: sem isto o relatório encheria de uuid.
  const ids = [...new Set([
    chamado?.solicitante_id, chamado?.responsavel_id,
    ...eventos.map((x) => x.autor_id), ...anexos.map((x) => x.autor_id),
  ].filter(Boolean) as string[])];

  const nomes: Record<string, string> = {};
  if (ids.length) {
    const { data } = await supabase.from("profiles").select("id, display_name, email").in("id", ids);
    (data ?? []).forEach((p) => { nomes[p.id] = p.display_name || p.email || p.id; });
  }

  return { chamado, anexos, eventos, avaliacao: av.data ?? null, nomes };
}

// ------------------------------------------------------------------ ZIP
async function baixarAnexosZip(chamadoId: string, numero: string): Promise<{ ok: number; falhas: string[] }> {
  const { data } = await db
    .from("CHAMADO_SISTEMA_ANEXO").select("*").eq("chamado_id", chamadoId).order("created_at");
  const anexos = (data ?? []) as unknown as Anexo[];
  if (!anexos.length) return { ok: 0, falhas: [] };

  const zip = new JSZip();
  const falhas: string[] = [];
  const usados = new Set<string>();
  let ok = 0;

  for (const [i, ax] of anexos.entries()) {
    try {
      const { data: blob, error } = await supabase.storage.from(BUCKET_CHAMADOS).download(ax.storage_path);
      if (error || !blob) throw error ?? new Error("arquivo não encontrado");

      // Dois anexos com o mesmo nome dentro da mesma pasta: o segundo
      // sobrescreveria o primeiro silenciosamente no zip.
      zip.file(nomeNoZip(ax, i, usados), blob);
      ok++;
    } catch {
      falhas.push(ax.nome_arquivo || ax.storage_path);
    }
  }

  if (falhas.length) {
    zip.file("_FALHAS.txt",
      "Os arquivos abaixo não puderam ser baixados e não estão neste pacote:\n\n"
      + falhas.map((f) => `- ${f}`).join("\n")
      + "\n\nTente novamente ou baixe-os individualmente pela tela do chamado.\n");
  }

  const pacote = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(pacote);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chamado-${numero}-anexos.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois do clique: revogar na mesma volta cancela o download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);

  return { ok, falhas };
}

// ------------------------------------------------------------------ PDF
function gerarRelatorio(d: Dados) {
  const { chamado: c, anexos, eventos, avaliacao, nomes } = d;
  const quem = (id?: string | null) => (id && nomes[id]) || "—";
  const pdf = new PdfDocumento(`Chamado ${c.numero}`, c.id);

  pdf.tituloSecao(c.assunto || "Sem assunto", 16);

  const linha = (r: string, v?: string | null) =>
    pdf.paragrafo(`${r}: ${v && String(v).trim() ? v : "—"}`, { espacoDepois: 1 });

  pdf.tituloSecao("Identificação", 12);
  linha("Número", c.numero);
  linha("Status", STATUS_CHAMADO[c.status]?.label ?? c.status);
  linha("Prioridade", PRIORIDADES[c.prioridade]?.label ?? c.prioridade);
  linha("Aberto em", fmtDataHora(c.created_at));
  linha("Última atualização", fmtDataHora(c.updated_at));
  linha("Concluído em", c.concluido_em ? fmtDataHora(c.concluido_em) : null);
  linha("Prazo previsto", c.prazo_previsto ? fmtDataHora(c.prazo_previsto) : null);

  pdf.tituloSecao("Solicitante e responsável", 12);
  linha("Solicitante", c.solicitante_nome || quem(c.solicitante_id));
  linha("Setor", c.setor);
  linha("Responsável", c.responsavel_id ? quem(c.responsavel_id) : "Sem responsável definido");
  linha("Posição na fila do responsável", c.posicao_dev != null ? String(c.posicao_dev) : null);

  pdf.tituloSecao("Classificação", 12);
  linha("Categorias", (c.categorias ?? []).map((x) => labelDe(CATEGORIAS, x)).join(", "));
  linha("Tipo de solicitação", labelDe(TIPOS, c.tipo_solicitacao));
  linha("Módulo do sistema", moduloLabel(c));
  linha("Ambiente", labelDe(AMBIENTES, c.ambiente));
  linha("Impacto no trabalho", labelDe(IMPACTOS, c.impacto_trabalho));
  linha("Urgência", labelDe(URGENCIAS, c.urgencia));
  linha("Usuários afetados", c.afeta_usuarios != null ? String(c.afeta_usuarios) : null);

  pdf.tituloSecao("Descrição", 12);
  pdf.paragrafo(c.descricao?.trim() || "Sem descrição.", { espacoDepois: 4 });
  if (c.observacoes_solicitante?.trim()) {
    pdf.tituloSecao("Observações do solicitante", 12);
    pdf.paragrafo(c.observacoes_solicitante, { espacoDepois: 4 });
  }

  if (c.observacao_gerente?.trim() || c.comentario_gerente?.trim() || c.motivo_reprovacao?.trim()) {
    pdf.tituloSecao("Coordenação", 12);
    if (c.observacao_gerente?.trim()) pdf.paragrafo(`Observação: ${c.observacao_gerente}`, { espacoDepois: 2 });
    if (c.comentario_gerente?.trim()) pdf.paragrafo(`Comentário: ${c.comentario_gerente}`, { espacoDepois: 2 });
    if (c.motivo_reprovacao?.trim()) pdf.paragrafo(`Motivo da reprovação: ${c.motivo_reprovacao}`, { espacoDepois: 2 });
  }

  // Histórico e conversa no mesmo fio, em ordem cronológica: é assim que o
  // caso é lido depois. Separar "eventos" de "mensagens" obrigaria quem lê a
  // remontar a linha do tempo na cabeça.
  pdf.tituloSecao(`Histórico e conversa (${eventos.length})`, 12);
  if (!eventos.length) {
    pdf.paragrafo("Nenhum registro.", { espacoDepois: 3 });
  } else {
    eventos.forEach((ev) => {
      pdf.paragrafo(`${fmtDataHora(ev.created_at)} · ${quem(ev.autor_id)}${ev.tipo && ev.tipo !== "mensagem" ? ` · ${ev.tipo}` : ""}`,
        { negrito: true, tamanho: 8.5, cor: [90, 90, 90], espacoDepois: 0.5 });
      pdf.paragrafo(ev.texto?.trim() || "—", { espacoDepois: 3 });
    });
  }

  pdf.tituloSecao(`Anexos (${anexos.length})`, 12);
  if (!anexos.length) {
    pdf.paragrafo("Nenhum anexo.", { espacoDepois: 3 });
  } else {
    anexos.forEach((ax, i) => {
      pdf.paragrafo(
        `${i + 1}. ${ax.nome_arquivo} — ${bytesLegivel(ax.tamanho_bytes)} · ${pastaDe(ax.campo).replace(/^\d-/, "")} · enviado por ${quem(ax.autor_id)}`,
        { tamanho: 9, espacoDepois: 1.5 });
    });
    pdf.paragrafo("Os arquivos em si saem no pacote ZIP, pelo botão “Baixar anexos” da mesma tela.",
      { tamanho: 8.5, cor: [110, 110, 110], espacoDepois: 3 });
  }

  if (avaliacao) {
    pdf.tituloSecao("Avaliação do solicitante", 12);
    pdf.paragrafo(`Nota final: ${mediaAvaliacao(avaliacao).toFixed(2)} de 5,00`, { negrito: true, espacoDepois: 2 });
    CRITERIOS_AVALIACAO.forEach((cr) => {
      pdf.paragrafo(`${cr.titulo} (peso ${cr.peso.toFixed(2)}): ${avaliacao[cr.key]} de 5`,
        { tamanho: 9, espacoDepois: 1 });
    });
    if (avaliacao.comentario?.trim()) pdf.paragrafo(`Comentário: ${avaliacao.comentario}`, { espacoDepois: 3 });
  }

  pdf.paragrafo(`Relatório gerado em ${fmtDataHoraPdf(new Date().toISOString())}.`,
    { tamanho: 8, cor: [130, 130, 130] });

  pdf.salvar(`chamado-${c.numero}-relatorio.pdf`);
}

// ------------------------------------------------------------- componente
export function ExportarChamado({ chamadoId, numero, totalAnexos }: {
  chamadoId: string;
  numero: string;
  /** Só para rotular o botão; o download relê a lista do banco. */
  totalAnexos?: number;
}) {
  const { toast } = useToast();
  const [zipando, setZipando] = useState(false);
  const [relatando, setRelatando] = useState(false);

  const onZip = async () => {
    if (zipando) return;
    setZipando(true);
    try {
      const { ok, falhas } = await baixarAnexosZip(chamadoId, numero);
      if (ok === 0 && !falhas.length) {
        toast({ title: "Nenhum anexo", description: "Este chamado não tem arquivos para baixar." });
      } else if (falhas.length) {
        toast({
          title: `${ok} de ${ok + falhas.length} anexos baixados`,
          description: "O pacote traz um _FALHAS.txt com o que não veio.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Anexos baixados", description: `${ok} arquivo(s) no pacote.` });
      }
    } catch (e) {
      toast({
        title: "Não consegui montar o pacote",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setZipando(false);
    }
  };

  const onRelatorio = async () => {
    if (relatando) return;
    setRelatando(true);
    try {
      const dados = await carregar(chamadoId);
      if (!dados.chamado) throw new Error("Chamado não encontrado.");
      gerarRelatorio(dados);
      toast({ title: "Relatório gerado", description: `chamado-${numero}-relatorio.pdf` });
    } catch (e) {
      toast({
        title: "Não consegui gerar o relatório",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setRelatando(false);
    }
  };

  // Card próprio na coluna lateral, no mesmo formato de "Ações rápidas":
  // botões de largura cheia, alinhados à esquerda.
  return (
    <Card className="space-y-2 p-4">
      <p className="text-sm font-bold">Exportar</p>
      <Button
        variant="outline"
        className="w-full justify-start gap-2 transition-transform active:scale-95 disabled:opacity-60"
        onClick={onZip} disabled={zipando || totalAnexos === 0}
      >
        {zipando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderDown className="h-4 w-4" />}
        {zipando
          ? "Montando pacote…"
          : totalAnexos === 0
            ? "Sem anexos para baixar"
            : `Baixar anexos em ZIP${totalAnexos ? ` (${totalAnexos})` : ""}`}
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start gap-2 transition-transform active:scale-95 disabled:opacity-60"
        onClick={onRelatorio} disabled={relatando}
      >
        {relatando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        {relatando ? "Gerando relatório…" : "Relatório do chamado (PDF)"}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        O relatório traz a ficha completa, o histórico e a conversa. Os arquivos em si saem no ZIP.
      </p>
    </Card>
  );
}
