import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CloudDownload, Info } from "lucide-react";

// Tabelas novas, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Notas que a Receita entregou sozinha, sem ninguém importar nada.
 *
 * Antes disto, uma nota emitida contra a empresa só aparecia no ERP se o
 * fornecedor lembrasse de mandar o XML por e-mail e alguém importasse à mão —
 * e o que ele não mandasse, simplesmente não existia aqui.
 *
 * O worker consulta a SEFAZ e grava o que vem. Esta tela é onde isso fica
 * visível; sem ela o recurso funcionaria e ninguém saberia.
 *
 * DUAS FASES, e a distinção importa para quem olha:
 * a nota chega primeiro como RESUMO (emitente, valor, chave) e só vira XML
 * completo, com os itens, depois da Manifestação do Destinatário. Marcar isso
 * na tela evita a pergunta "por que essa nota não tem produtos?".
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
  criado_em: string;
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

const fmtData = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleDateString("pt-BR");

const fmtDataHora = (iso: string | null) =>
  !iso ? "—" : new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** CNPJ cru -> 00.000.000/0000-00. */
function fmtCnpj(v: string | null) {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 14) return v || "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function PainelNotasSefaz() {
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

  const lista = documentos.data ?? [];
  const semItens = lista.filter((d) => d.tipo === "resumo").length;
  const e = estado.data;

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
            <p className="font-medium">{lista.length} nota(s)</p>
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
            {semItens} nota(s) chegaram como <strong>resumo</strong>: trazem emitente, valor e
            chave, mas ainda não os produtos. A Receita só libera o XML completo depois da
            Manifestação do Destinatário.
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
                <TableHead>Chave</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.emitente_nome || "—"}</TableCell>
                  <TableCell className="text-xs">{fmtCnpj(d.emitente_cnpj)}</TableCell>
                  <TableCell>{fmtData(d.emitida_em)}</TableCell>
                  <TableCell className="text-right">{fmtBRL(d.valor)}</TableCell>
                  <TableCell>
                    {d.tipo === "completo" ? (
                      <Badge>Nota completa</Badge>
                    ) : d.tipo === "evento" ? (
                      <Badge variant="outline">Evento</Badge>
                    ) : (
                      <Badge variant="secondary">Resumo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {d.chave || "—"}
                  </TableCell>
                </TableRow>
              ))}

              {!documentos.isLoading && lista.length === 0 && (
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
    </div>
  );
}
