import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  acharCabecalho, fmtBRL, lerPlanilhaDecimo, rotuloParcela,
  type CabecalhoPlanilha, type ContratoChave, type Parcela,
} from "@/lib/conferenciaDecimo/conferencia";

const sb = supabase as unknown as SupabaseClient;

/**
 * Importar o 13º da planilha da Senior (12/11/2026). Pedido do Pablo: "RH
 * pode digitar o valor, mas também pode importar planilha da Senior".
 *
 * O layout do relatório da Senior varia, então a leitura é tolerante: acha o
 * cabeçalho (coluna de filial + alguma de valor), deixa o RH escolher qual
 * coluna é o valor, e SOMA por contrato — serve tanto para a planilha por
 * colaborador quanto para a já resumida. Antes de gravar mostra o que entra,
 * o que não casou com o cadastro e o total. Quem grava é
 * `decimo_importar_valores`, que só mexe em contrato ainda com o RH.
 */
export function ImportarPlanilhaDecimo({ ano, parcela, contratos, onFechar, onImportou }: {
  ano: number;
  parcela: Parcela;
  contratos: ContratoChave[];
  onFechar: () => void;
  onImportou: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<unknown[][]>([]);
  const [cab, setCab] = useState<CabecalhoPlanilha | null>(null);
  const [colValor, setColValor] = useState<number | null>(null);
  const [gravando, setGravando] = useState(false);

  const abrir = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      // A primeira aba que tem um cabeçalho reconhecível.
      for (const nome of wb.SheetNames) {
        const l = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, raw: true, defval: null });
        const c = acharCabecalho(l);
        if (c) {
          setArquivo(f.name); setLinhas(l); setCab(c); setColValor(c.candidatasValor[0]);
          return;
        }
      }
      toast.error("Não achei a tabela: a planilha precisa de uma coluna de Filial e uma de valor.");
    } catch (e: unknown) {
      toast.error("Não deu para ler o arquivo: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const resultado = useMemo(
    () => (cab && colValor != null ? lerPlanilhaDecimo(linhas, cab, colValor, contratos) : null),
    [linhas, cab, colValor, contratos],
  );

  const gravar = async () => {
    if (!resultado?.porContrato.length) return;
    setGravando(true);
    const { data, error } = await sb.rpc("decimo_importar_valores", {
      p_ano: ano, p_parcela: parcela, p_arquivo: arquivo,
      p_linhas: resultado.porContrato.map(c => ({ empresa: c.empresa, filial: c.filial, valor: c.valor, qtd: c.qtd })),
    });
    setGravando(false);
    if (error) { toast.error(error.message); return; }
    const travados = (data?.travados ?? []) as { contrato: string | null; status: string }[];
    toast.success(`${data?.gravados ?? 0} contrato(s) com valor atualizado.`);
    if (travados.length) {
      toast.warning(`${travados.length} contrato(s) já saíram do RH e não mudaram: ` +
        travados.slice(0, 5).map(t => `${t.contrato ?? "—"} (${t.status})`).join(", ") +
        (travados.length > 5 ? "…" : ""), { duration: 12000 });
    }
    onImportou();
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Importar 13º · {ano} · {rotuloParcela(parcela)}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Planilha da Senior (.xlsx, .xls ou .csv) com uma coluna de <b>Filial</b> (e, se tiver, de <b>Empresa</b>)
          e uma de valor. Pode ser por colaborador: o valor é somado por contrato. Só grava nos contratos que
          ainda estão com o RH — o que já foi liberado ao Financeiro não muda.
        </p>

        <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden"
               onChange={e => { const f = e.target.files?.[0]; if (f) abrir(f); e.target.value = ""; }} />
        <Button variant="outline" onClick={() => input.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> {arquivo ? `Trocar arquivo (${arquivo})` : "Escolher arquivo"}
        </Button>

        {cab && (
          <div className="space-y-1.5">
            <Label>Coluna do valor</Label>
            <Select value={String(colValor)} onValueChange={v => setColValor(Number(v))}>
              <SelectTrigger className="sm:w-80"><SelectValue /></SelectTrigger>
              <SelectContent>
                {cab.candidatasValor.map(j => (
                  <SelectItem key={j} value={String(j)}>{cab.colunas[j] || `Coluna ${j + 1}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Filial: “{cab.colunas[cab.colFilial]}”
              {cab.colEmpresa != null ? ` · Empresa: “${cab.colunas[cab.colEmpresa]}”` : " · sem coluna de empresa (casa só pela filial)"}
              {cab.colQtd != null ? ` · Quantidade: “${cab.colunas[cab.colQtd]}”` : ""}
            </p>
          </div>
        )}

        {resultado && (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Contratos</p><p className="font-semibold">{resultado.porContrato.length}</p></div>
              <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold">{fmtBRL(resultado.total)}</p></div>
              <div><p className="text-xs text-muted-foreground">Linhas lidas / ignoradas</p>
                <p className="font-semibold">{resultado.linhasLidas} / {resultado.linhasIgnoradas}</p></div>
            </div>

            {(resultado.semContrato.length > 0 || resultado.ambiguas.length > 0) && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                <p className="font-semibold">Fica de fora</p>
                {resultado.semContrato.map(s => (
                  <p key={`${s.empresa}-${s.filial}`}>Filial {s.filial}{s.empresa != null ? ` (empresa ${s.empresa})` : ""}: sem contrato ativo · {fmtBRL(s.valor)}</p>
                ))}
                {resultado.ambiguas.map(a => (
                  <p key={a.filial}>Filial {a.filial}: existe em mais de uma empresa — a planilha precisa da coluna Empresa · {fmtBRL(a.valor)}</p>
                ))}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                  <tr><th className="p-2 text-left">Contrato</th><th className="p-2 text-right">Colab.</th><th className="p-2 text-right">Valor</th></tr>
                </thead>
                <tbody>
                  {resultado.porContrato.map(c => (
                    <tr key={`${c.empresa}-${c.filial}`} className="border-t">
                      <td className="p-2">{c.nome ?? "—"} <span className="text-xs text-muted-foreground">· filial {c.filial}</span></td>
                      <td className="p-2 text-right tabular-nums">{c.qtd ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{fmtBRL(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button disabled={gravando || !resultado?.porContrato.length} onClick={gravar}>
            {gravando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Gravar {resultado?.porContrato.length ?? 0} contrato(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
