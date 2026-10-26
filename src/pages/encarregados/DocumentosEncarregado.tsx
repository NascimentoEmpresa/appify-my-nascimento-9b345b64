import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, FileText, Loader2, PenLine } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useSolicitacoesDocumento, useUrlsImagens } from "@/hooks/useDocumentosSolicitados";
import { DetalheDocumento } from "@/components/documentos/DetalheDocumento";
import { GradeImagens } from "@/components/documentos/ImagensDocumento";
import {
  STATUS_DOCUMENTO, TIPO_DOCUMENTO, atrasada, ehImagem, nomeLegivel, ordenarSolicitacoes, pedeAssinatura, rotuloSituacao, textoPrazo,
  type StatusDocumento,
} from "@/lib/rh/documentosSolicitados";

const MINIATURAS_POR_CARD = 4;

// =====================================================================
// ENCARREGADOS › DOCUMENTOS (mig 20261019000040, 19/10/2026)
//
// O outro lado do RH › Documentos: o encarregado (responsável do contrato
// na Hierarquia de Postos) — ou o usuário que o RH escolheu — recebe a
// solicitação, baixa o documento, colhe a assinatura, anexa e envia com
// observação. Enquanto não anexa e envia, fica pendente aqui e no RH.
//
// Tipo (mig 20261022000500): assinatura e termo de ciência se concluem
// ASSINANDO no detalhe; registro só fica guardado aqui. As imagens
// anexadas aparecem em miniatura no card (URLs pedidas de uma vez só).
// =====================================================================

type Filtro = "pendente" | "concluida" | "todas";
const hojeIso = () => new Date().toLocaleDateString("sv-SE");

export default function DocumentosEncarregado() {
  const [params, setParams] = useSearchParams();
  const lista = useSolicitacoesDocumento({ minhas: true });
  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const [aberta, setAberta] = useState<number | null>(null);
  const hoje = hojeIso();

  useEffect(() => {
    const s = Number(params.get("s"));
    if (s) setAberta(s);
  }, [params]);

  const todas = useMemo(() => lista.data ?? [], [lista.data]);
  const pendentes = todas.filter((s) => s.status === "pendente");
  const visiveis = useMemo(
    () => ordenarSolicitacoes(todas.filter((s) => filtro === "todas" || s.status === filtro), hoje),
    [todas, filtro, hoje],
  );
  const atrasadas = pendentes.filter((s) => atrasada(s, hoje)).length;
  const caminhosImagens = useMemo(
    () => visiveis.flatMap((s) => (s.anexos ?? []).filter(ehImagem).slice(0, MINIATURAS_POR_CARD).map((a) => a.storage_path)),
    [visiveis],
  );
  const urls = useUrlsImagens(caminhosImagens);
  const solicitacaoAberta = todas.find((s) => s.id === aberta) ?? null;
  const fechar = () => { setAberta(null); if (params.get("s")) { params.delete("s"); setParams(params, { replace: true }); } };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documentos"
        subtitle="Documentos que o RH enviou para você: assine, dê ciência ou, nos antigos, anexe o assinado e envie."
        module="Encarregados"
      />

      {pendentes.length > 0 && (
        <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
          atrasadas ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
          {atrasadas ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          <span>
            Você tem <b>{pendentes.length}</b> documento{pendentes.length === 1 ? "" : "s"} pendente{pendentes.length === 1 ? "" : "s"} com o RH
            {atrasadas ? <>, <b>{atrasadas}</b> com prazo vencido</> : null}.
          </span>
        </div>
      )}

      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
        <TabsList>
          <TabsTrigger value="pendente">Pendentes ({pendentes.length})</TabsTrigger>
          <TabsTrigger value="concluida">Concluídos ({todas.filter((s) => s.status === "concluida").length})</TabsTrigger>
          <TabsTrigger value="todas">Todos ({todas.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {lista.isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : lista.error ? (
        <div className="p-6 text-sm text-red-600">{(lista.error as Error).message}</div>
      ) : visiveis.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {filtro === "pendente"
            ? <><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" /> Nenhum documento pendente.</>
            : <><FileText className="mx-auto mb-2 h-8 w-8 opacity-40" /> Nada por aqui.</>}
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visiveis.map((s) => {
            const atras = atrasada(s, hoje);
            const prazo = textoPrazo(s, hoje);
            return (
              <button key={s.id} onClick={() => setAberta(s.id)}
                className={cn("group rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow",
                  atras && "border-red-200")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">#{s.id}{s.contrato_nome ? ` · ${s.contrato_nome}` : ""}</div>
                    <div className="font-semibold">{s.titulo}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className={cn("font-semibold", STATUS_DOCUMENTO[s.status as StatusDocumento].cor)}>
                      {s.status === "concluida" ? (s.tipo === "anexo" ? "Enviado" : rotuloSituacao(s)) : pedeAssinatura(s) ? "Assinar" : STATUS_DOCUMENTO[s.status as StatusDocumento].rotulo}
                    </Badge>
                    <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-semibold", TIPO_DOCUMENTO[s.tipo]?.cor)}>
                      {TIPO_DOCUMENTO[s.tipo]?.rotulo ?? s.tipo}
                    </Badge>
                  </div>
                </div>
                {s.descricao && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{s.descricao}</p>}
                {(s.anexos ?? []).filter(ehImagem).length > 0 && (
                  <div className="mt-2">
                    <GradeImagens imagens={(s.anexos ?? []).filter(ehImagem)} urls={urls.data} tamanho="pequeno" max={MINIATURAS_POR_CARD} semLink />
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{s.tipo === "registro" ? "Registrado" : "Pedido"} por {nomeLegivel(s.solicitante_nome) || "RH"} em {new Date(s.created_at).toLocaleDateString("pt-BR")}</span>
                  {prazo && <span className={cn("font-semibold", atras ? "text-red-600" : "text-amber-700")}>· {prazo}</span>}
                  {s.status === "pendente" && pedeAssinatura(s)
                    ? <span className="ml-auto flex items-center gap-1 font-semibold text-primary"><PenLine className="h-3.5 w-3.5" /> Abrir e assinar</span>
                    : <ChevronRight className="ml-auto h-4 w-4 opacity-0 transition group-hover:opacity-100" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DetalheDocumento solicitacao={solicitacaoAberta} lado="destinatario" onFechar={fechar} />
    </div>
  );
}
