import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, FileText, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useSolicitacoesDocumento } from "@/hooks/useDocumentosSolicitados";
import { DetalheDocumento } from "@/components/documentos/DetalheDocumento";
import {
  STATUS_DOCUMENTO, atrasada, nomeLegivel, ordenarSolicitacoes, textoPrazo, type StatusDocumento,
} from "@/lib/rh/documentosSolicitados";

// =====================================================================
// ENCARREGADOS › DOCUMENTOS (mig 20261019000040, 19/10/2026)
//
// O outro lado do RH › Documentos: o encarregado (responsável do contrato
// na Hierarquia de Postos) — ou o usuário que o RH escolheu — recebe a
// solicitação, baixa o documento, colhe a assinatura, anexa e envia com
// observação. Enquanto não anexa e envia, fica pendente aqui e no RH.
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
  const solicitacaoAberta = todas.find((s) => s.id === aberta) ?? null;
  const fechar = () => { setAberta(null); if (params.get("s")) { params.delete("s"); setParams(params, { replace: true }); } };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documentos"
        subtitle="Documentos que o RH pediu para você: baixe, colha as assinaturas, anexe e envie."
        module="Encarregados"
      />

      {pendentes.length > 0 && (
        <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
          atrasadas ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800")}>
          {atrasadas ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          <span>
            Você tem <b>{pendentes.length}</b> documento{pendentes.length === 1 ? "" : "s"} para devolver ao RH
            {atrasadas ? <>, <b>{atrasadas}</b> com prazo vencido</> : null}.
          </span>
        </div>
      )}

      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
        <TabsList>
          <TabsTrigger value="pendente">Pendentes ({pendentes.length})</TabsTrigger>
          <TabsTrigger value="concluida">Enviados ({todas.filter((s) => s.status === "concluida").length})</TabsTrigger>
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
                  <Badge variant="outline" className={cn("shrink-0 font-semibold", STATUS_DOCUMENTO[s.status as StatusDocumento].cor)}>
                    {s.status === "concluida" ? "Enviado" : STATUS_DOCUMENTO[s.status as StatusDocumento].rotulo}
                  </Badge>
                </div>
                {s.descricao && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{s.descricao}</p>}
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Pedido por {nomeLegivel(s.solicitante_nome) || "RH"} em {new Date(s.created_at).toLocaleDateString("pt-BR")}</span>
                  {prazo && <span className={cn("font-semibold", atras ? "text-red-600" : "text-amber-700")}>· {prazo}</span>}
                  <ChevronRight className="ml-auto h-4 w-4 opacity-0 transition group-hover:opacity-100" />
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
