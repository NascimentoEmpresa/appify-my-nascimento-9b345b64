import { useMemo } from "react";
import { ClipboardCopy, Download, FilePlus2, FileText, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNomeUsuario } from "@/hooks/useMaloteDespesa";
import { abrirAnexoExcecao, useExcecaoEventos } from "@/hooks/useMaloteExcecao";
import {
  restanteDaSenha, STATUS_EXCECAO_BADGE, STATUS_EXCECAO_LABEL, statusExibidoExcecao, TIPO_EVENTO_EXCECAO_LABEL, TIPO_EXCECAO_LABEL,
  type ExcecaoSolicitacao,
} from "./regras";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.split("T")[0].split("-").reverse().join("/");
const diaHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function NomeUsuario({ id }: { id: string | null | undefined }) {
  const { data } = useNomeUsuario(id);
  return <>{id ? data ?? "—" : "Sistema"}</>;
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

interface Props {
  solicitacao: ExcecaoSolicitacao | null;
  onClose: () => void;
  nomes: { classificacao: Map<string, string>; empresa: Map<string, string>; contrato: Map<string, string> };
  /** Mostra Aprovar/Reprovar no rodapé (só quando o usuário decide aquela classificação e ela está em análise). */
  podeDecidir?: boolean;
  onDecidir?: (aprovar: boolean) => void;
  /** Botão "Criar despesa" (só para o solicitante, com a exceção aprovada e a senha dentro do prazo). */
  onCriarDespesa?: () => void;
}

// SIS-2026-0668 (fase 2): painel "Detalhes da Solicitação" (Informações / Histórico).
export function ExcecaoDetalhe({ solicitacao: s, onClose, nomes, podeDecidir, onDecidir, onCriarDespesa }: Props) {
  const { data: eventos = [] } = useExcecaoEventos(s?.id);
  const st = useMemo(() => (s ? statusExibidoExcecao(s) : null), [s]);

  async function abrir(path: string) {
    if (!(await abrirAnexoExcecao(path))) toast.error("Não foi possível abrir o anexo.");
  }
  async function copiar(txt: string) {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Senha copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <Sheet open={!!s} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {s && st && (
          <>
            <SheetHeader>
              <SheetTitle>Detalhes da Solicitação</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-lg font-bold">{s.numero}</span>
                <Badge className={STATUS_EXCECAO_BADGE[st]} variant="secondary">{STATUS_EXCECAO_LABEL[st]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">Solicitado em {diaHora(s.created_at)} · por <NomeUsuario id={s.solicitante_id} /></p>
            </div>

            <Tabs defaultValue="info" className="mt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="info">Informações</TabsTrigger>
                <TabsTrigger value="historico">Histórico</TabsTrigger>
              </TabsList>

              <TabsContent value="info" className="space-y-4">
                <div className="divide-y">
                  <Linha rotulo="Tipo da despesa">{TIPO_EXCECAO_LABEL[s.tipo] ?? s.tipo}</Linha>
                  <Linha rotulo="Classificação">{nomes.classificacao.get(s.classificacao_id) ?? "—"}</Linha>
                  <Linha rotulo="Empresa">{nomes.empresa.get(s.empresa_id) ?? "—"}</Linha>
                  <Linha rotulo="Contrato">{s.contrato_id ? nomes.contrato.get(s.contrato_id) ?? "—" : "—"}</Linha>
                  <Linha rotulo="Valor da despesa">{brl(s.valor)}</Linha>
                  <Linha rotulo="Data prevista do pagamento">{dia(s.data_pagamento)}</Linha>
                </div>

                <div>
                  <p className="text-sm font-semibold">Descrição</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.descricao}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold">Justificativa da exceção</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.justificativa}</p>
                </div>

                {s.status === "aprovada" && s.senha && st !== "expirada" && (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-emerald-50 p-3 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-emerald-700" />
                      <div>
                        <p className="font-mono text-sm font-bold tracking-wide">{s.senha}</p>
                        <p className="text-[11px] text-muted-foreground">vale por mais {restanteDaSenha(s.senha_expira_em)}</p>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void copiar(s.senha!)} title="Copiar senha">
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {s.status === "reprovada" && s.motivo_decisao && (
                  <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">Motivo da reprovação: {s.motivo_decisao}</p>
                )}

                <div>
                  <p className="mb-1 text-sm font-semibold">Anexos ({s.arquivos?.length ?? 0})</p>
                  {(s.arquivos ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nenhum anexo.</p>}
                  <ul className="space-y-1">
                    {(s.arquivos ?? []).map((path) => (
                      <li key={path} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
                        <span className="flex items-center gap-1.5 truncate"><FileText className="h-3.5 w-3.5 shrink-0" />{path.split("/").pop()}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => void abrir(path)} title="Abrir">
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </TabsContent>

              <TabsContent value="historico">
                <ol className="space-y-3 border-l pl-4">
                  {eventos.length === 0 && <li className="text-sm text-muted-foreground">Sem eventos.</li>}
                  {eventos.map((e) => (
                    <li key={e.id} className="relative text-sm">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                      <p className="font-medium">{TIPO_EVENTO_EXCECAO_LABEL[e.tipo_evento] ?? e.tipo_evento}</p>
                      {e.descricao && <p className="whitespace-pre-line text-xs text-muted-foreground">{e.descricao}</p>}
                      <p className="text-xs text-muted-foreground">{diaHora(e.created_at)} · <NomeUsuario id={e.ator_user_id} /></p>
                    </li>
                  ))}
                </ol>
              </TabsContent>
            </Tabs>

            {onCriarDespesa && (
              <Button className="mt-6 w-full gap-2" onClick={onCriarDespesa}><FilePlus2 className="h-4 w-4" />Criar despesa com esta exceção</Button>
            )}

            {podeDecidir && s.status === "em_analise" && onDecidir && (
              <div className="mt-6 grid grid-cols-2 gap-2">
                <Button variant="destructive" onClick={() => onDecidir(false)}>Reprovar</Button>
                <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onDecidir(true)}>Aprovar</Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
