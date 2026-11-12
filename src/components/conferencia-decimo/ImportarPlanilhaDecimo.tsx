import { useEffect, useMemo, useRef, useState } from "react";
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
  acharCabecalho, fmtBRL, linhasDaPlanilha, rotuloParcela,
  type CabecalhoPlanilha, type Parcela,
} from "@/lib/conferenciaDecimo/conferencia";

const sb = supabase as unknown as SupabaseClient;

interface PreviaContrato {
  contrato_id: string; nome: string; valor: number; qtd: number | null;
  status: string; status_contrato: string; travado: boolean;
}
interface Previa {
  por_contrato: PreviaContrato[];
  sem_contrato: { empresa: number | null; filial: number; cadastro: string | null; valor: number }[];
}

/**
 * Importar o 13º da planilha da Senior (12/11/2026). Pedido do Pablo: "RH
 * pode digitar o valor, mas também pode importar planilha da Senior".
 *
 * O layout do relatório da Senior varia, então a leitura é tolerante: acha o
 * cabeçalho (filial + alguma coluna de valor; empresa e matrícula quando
 * houver) e deixa o RH escolher qual coluna é o valor.
 *
 * 13/11/2026 (mig 20261113001000): a lista passou a ser dos contratos da
 * LICITAÇÃO, e o elo filial/matrícula da Senior → contrato da Licitação só
 * existe no banco (o mesmo do RH › Ativos/Contratos). Então a tela manda as
 * linhas cruas e mostra a PRÉVIA que o banco devolve com `p_simular` —
 * contrato por contrato, o que fica de fora e o que está travado (já saiu do
 * RH, ou contrato não ativo). Gravar é a mesma chamada sem simular.
 */
export function ImportarPlanilhaDecimo({ ano, parcela, onFechar, onImportou }: {
  ano: number;
  parcela: Parcela;
  onFechar: () => void;
  onImportou: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<unknown[][]>([]);
  const [cab, setCab] = useState<CabecalhoPlanilha | null>(null);
  const [colValor, setColValor] = useState<number | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [calculando, setCalculando] = useState(false);
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

  const lidas = useMemo(
    () => (cab && colValor != null ? linhasDaPlanilha(linhas, cab, colValor) : null),
    [linhas, cab, colValor],
  );

  // A prévia sai do banco a cada troca de arquivo ou de coluna.
  useEffect(() => {
    setPrevia(null);
    if (!lidas?.linhas.length) return;
    let vivo = true;
    setCalculando(true);
    sb.rpc("decimo_importar_valores", {
      p_ano: ano, p_parcela: parcela, p_linhas: lidas.linhas, p_arquivo: arquivo, p_simular: true,
    }).then(({ data, error }) => {
      if (!vivo) return;
      setCalculando(false);
      if (error) { toast.error(error.message); return; }
      setPrevia(data as Previa);
    });
    return () => { vivo = false; };
  }, [lidas, ano, parcela, arquivo]);

  const entram = previa?.por_contrato.filter(c => !c.travado) ?? [];
  const travados = previa?.por_contrato.filter(c => c.travado) ?? [];
  const totalEntra = entram.reduce((t, c) => t + Number(c.valor), 0);

  const gravar = async () => {
    if (!lidas?.linhas.length || !entram.length) return;
    setGravando(true);
    const { data, error } = await sb.rpc("decimo_importar_valores", {
      p_ano: ano, p_parcela: parcela, p_linhas: lidas.linhas, p_arquivo: arquivo,
    });
    setGravando(false);
    if (error) { toast.error(error.message); return; }
    const trav = (data?.travados ?? []) as { contrato: string | null; status: string }[];
    toast.success(`${data?.gravados ?? 0} contrato(s) com valor atualizado.`);
    if (trav.length) {
      toast.warning(`${trav.length} contrato(s) não mudaram: ` +
        trav.slice(0, 5).map(t => `${t.contrato ?? "—"} (${t.status})`).join(", ") +
        (trav.length > 5 ? "…" : ""), { duration: 12000 });
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
          Planilha da Senior (.xlsx, .xls ou .csv) com uma coluna de <b>Filial</b> e uma de valor — e, se tiver,
          <b> Empresa</b> e <b>Matrícula/Cadastro</b> (com matrícula o contrato sai da própria pessoa). O valor é somado
          por contrato da Licitação. Só grava nos contratos que ainda estão com o RH.
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
              {cab.colEmpresa != null ? ` · Empresa: “${cab.colunas[cab.colEmpresa]}”` : " · sem coluna de empresa"}
              {cab.colCadastro != null ? ` · Matrícula: “${cab.colunas[cab.colCadastro]}”` : " · sem matrícula (casa pela filial)"}
              {cab.colQtd != null ? ` · Quantidade: “${cab.colunas[cab.colQtd]}”` : ""}
              {lidas ? ` · ${lidas.linhas.length} linha(s) lida(s), ${lidas.ignoradas} ignorada(s)` : ""}
            </p>
          </div>
        )}

        {calculando && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Casando com os contratos da Licitação…
          </p>
        )}

        {previa && (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Contratos que recebem valor</p><p className="font-semibold">{entram.length}</p></div>
              <div><p className="text-xs text-muted-foreground">Total que entra</p><p className="font-semibold">{fmtBRL(totalEntra)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total da planilha</p><p className="font-semibold">{fmtBRL(lidas?.total ?? 0)}</p></div>
            </div>

            {(previa.sem_contrato.length > 0 || travados.length > 0) && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                <p className="font-semibold">Fica de fora</p>
                {travados.map(t => (
                  <p key={t.contrato_id}>
                    {t.nome}: {t.status_contrato !== "ativo" ? `contrato ${t.status_contrato} na Licitação` : `já está em "${t.status}"`} · {fmtBRL(t.valor)}
                  </p>
                ))}
                {previa.sem_contrato.map((s, i) => (
                  <p key={i}>
                    Filial {s.filial}{s.empresa != null ? ` (empresa ${s.empresa})` : ""}{s.cadastro ? ` · matrícula ${s.cadastro}` : ""}:
                    {" "}sem contrato da Licitação ligado · {fmtBRL(s.valor)}
                  </p>
                ))}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase text-muted-foreground">
                  <tr><th className="p-2 text-left">Contrato</th><th className="p-2 text-right">Colab.</th><th className="p-2 text-right">Valor</th></tr>
                </thead>
                <tbody>
                  {entram.map(c => (
                    <tr key={c.contrato_id} className="border-t">
                      <td className="p-2">{c.nome}</td>
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
          <Button disabled={gravando || calculando || !entram.length} onClick={gravar}>
            {gravando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Gravar {entram.length} contrato(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
