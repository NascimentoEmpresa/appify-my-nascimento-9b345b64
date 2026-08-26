import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerNfeXml } from "@/lib/suprimentos/nfeXml";
import { CloudDownload, Info, Eye, Copy } from "lucide-react";
import { toast } from "sonner";

// Tabelas novas, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Notas que a Receita entrega sozinha, sem ninguém importar nada.
 *
 * Antes disto, uma nota emitida contra a empresa só aparecia no ERP se o
 * fornecedor lembrasse de mandar o XML por e-mail e alguém importasse à mão —
 * e o que ele não mandasse simplesmente não existia aqui.
 *
 * DUAS FASES, UMA NOTA
 * A mesma nota chega DUAS VEZES da Receita, em posições diferentes da fila:
 * primeiro o RESUMO (emitente, valor, chave) e depois, se houve Manifestação
 * do Destinatário, o XML COMPLETO com os produtos. São dois documentos com o
 * mesmo `chNFe`.
 *
 * A tabela guarda os dois de propósito — cada um é um documento fiscal com seu
 * NSU, e descartar um seria perder registro. Mas a TELA agrupa por chave e
 * mostra a versão mais completa: ver a mesma nota duas vezes na lista, uma
 * "Resumo" e outra "Nota completa", parece erro do sistema.
 */

interface DocumentoSefaz {
  id: string;
  nsu: string;
  tipo: "resumo" | "completo" | "evento";
  chave: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  valor: number | null;
  emitida_em: string | null;
  ciencia_em: string | null;
  xml: string | null;
}

interface EstadoFila {
  ult_nsu: string;
  max_nsu: string | null;
  consultado_em: string | null;
  bloqueado_ate: string | null;
  ultimo_erro: string | null;
}

const fmtBRL = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string | null) => (!iso ? "—" : new Date(iso).toLocaleDateString("pt-BR"));

const fmtDataHora = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function fmtCnpj(v: string | null) {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 14) return v || "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const fmtQtd = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export function PainelNotasSefaz() {
  const [aberta, setAberta] = useState<DocumentoSefaz | null>(null);

  const documentos = useQuery({
    queryKey: ["nfe_dist_documento"],
    queryFn: async (): Promise<DocumentoSefaz[]> => {
      const { data, error } = await sb
        .from("nfe_dist_documento")
        .select("*")
        .order("nsu", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const estado = useQuery({
    queryKey: ["nfe_dist_estado"],
    queryFn: async (): Promise<EstadoFila | null> => {
      const { data, error } = await sb.from("nfe_dist_estado").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  /** Uma linha por nota: a versão completa vence o resumo da mesma chave. */
  const notas = useMemo(() => {
    const porChave = new Map<string, DocumentoSefaz>();
    for (const d of documentos.data ?? []) {
      const k = d.chave ?? d.id;
      const atual = porChave.get(k);
      if (!atual || (atual.tipo !== "completo" && d.tipo === "completo")) {
        porChave.set(k, d);
      }
    }
    return [...porChave.values()].sort((a, b) => Number(b.nsu) - Number(a.nsu));
  }, [documentos.data]);

  const semItens = notas.filter((d) => d.tipo === "resumo").length;
  const e = estado.data;
  const nota = aberta ? lerNfeXml(aberta.xml) : null;

  const copiarChave = (chave: string) => {
    navigator.clipboard.writeText(chave).then(
      () => toast.success("Chave copiada."),
      () => toast.error("Não foi possível copiar."),
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 font-medium">
              <CloudDownload className="h-4 w-4" />
              Notas recebidas da Receita
            </h3>
            <p className="text-sm text-muted-foreground">
              Notas emitidas contra a empresa, buscadas automaticamente. Ninguém precisa pedir o
              XML ao fornecedor.
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{notas.length} nota(s)</p>
            <p className="text-muted-foreground">
              Última busca: {fmtDataHora(e?.consultado_em ?? null)}
            </p>
          </div>
        </CardContent>
      </Card>

      {e?.bloqueado_ate && new Date(e.bloqueado_ate) > new Date() && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            A Receita pediu para aguardar até {fmtDataHora(e.bloqueado_ate)} antes da próxima
            consulta. É o ritmo normal do serviço — nada a fazer.
          </span>
        </div>
      )}

      {semItens > 0 && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {semItens} nota(s) ainda como <strong>resumo</strong>: trazem emitente, valor e chave,
            mas não os produtos. A Receita libera o XML completo depois da Manifestação do
            Destinatário, e leva um tempo dela.
          </span>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Emitente</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Conteúdo</TableHead>
                <TableHead className="w-24 text-right">Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notas.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.emitente_nome || "—"}</TableCell>
                  <TableCell className="text-xs">{fmtCnpj(d.emitente_cnpj)}</TableCell>
                  <TableCell>{fmtData(d.emitida_em)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRL(d.valor)}</TableCell>
                  <TableCell>
                    {d.tipo === "completo" ? (
                      <Badge>Nota completa</Badge>
                    ) : d.tipo === "evento" ? (
                      <Badge variant="outline">Evento</Badge>
                    ) : (
                      <Badge variant="secondary">Resumo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {d.tipo === "completo" ? (
                      <Button variant="ghost" size="sm" onClick={() => setAberta(d)}>
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        Abrir
                      </Button>
                    ) : (
                      // Sem botão no resumo de propósito: não há o que abrir, e
                      // um botão que abre uma tela vazia parece defeito.
                      <span className="text-xs text-muted-foreground">aguardando</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}

              {!documentos.isLoading && notas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma nota recebida ainda. A busca automática roda pelo worker — confira se
                    ele está ligado.
                  </TableCell>
                </TableRow>
              )}

              {documentos.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {e?.ultimo_erro && (
        <p className="text-xs text-muted-foreground">Último problema na busca: {e.ultimo_erro}</p>
      )}

      <Dialog open={!!aberta} onOpenChange={(v) => !v && setAberta(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {nota ? `NF-e ${nota.numero}/${nota.serie} — ${nota.emitente}` : "Nota fiscal"}
            </DialogTitle>
          </DialogHeader>

          {nota && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Info2 rotulo="Emitente" valor={nota.emitente} />
                <Info2 rotulo="CNPJ" valor={fmtCnpj(nota.emitenteCnpj)} />
                <Info2 rotulo="Emissão" valor={fmtData(nota.emitidaEm)} />
                <Info2 rotulo="Valor total" valor={fmtBRL(nota.valorTotal)} />
              </div>

              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                <span className="font-mono text-[11px] text-muted-foreground">{nota.chave}</span>
                <Button variant="ghost" size="sm" onClick={() => copiarChave(nota.chave)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">{nota.itens.length} produto(s)</h4>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Código</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-24">NCM</TableHead>
                        <TableHead className="w-16">Un.</TableHead>
                        <TableHead className="w-24 text-right">Qtd</TableHead>
                        <TableHead className="w-28 text-right">Valor un.</TableHead>
                        <TableHead className="w-28 text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {nota.itens.map((i, idx) => (
                        <TableRow key={`${i.codigo}-${idx}`}>
                          <TableCell className="font-mono text-xs">{i.codigo}</TableCell>
                          <TableCell className="text-sm">{i.descricao}</TableCell>
                          <TableCell className="font-mono text-xs">{i.ncm}</TableCell>
                          <TableCell className="text-xs">{i.unidade}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtQtd(i.quantidade)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(i.valorUnitario)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtBRL(i.valorTotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {aberta && !nota && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Esta nota ainda não tem o XML completo — só o resumo. Os produtos aparecem depois que
              a Receita libera o documento.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info2({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-sm font-medium">{valor}</p>
    </div>
  );
}
