import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useContratosERP } from "@/hooks/useContratosERP";
import { criarLimitadorDeConcorrencia } from "@/lib/limitarConcorrencia";
import {
  casarContratos, erroEhJaNoContrato, lerLinhasPlanilha, ROTULO_MOTIVO,
  type LinhaFluxoParaImportar, type Pendencia, type ResultadoCasamento,
} from "./importarContratos";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  // linhas do Fluxo como vieram das views (uma por cota/parcela), para casar com a planilha
  linhasFluxo: LinhaFluxoParaImportar[];
}

interface Aplicacao {
  feitas: number;
  jaEstavam: number;
  falhas: Pendencia[];
}

// SIS-2026-0752: importa de volta a planilha exportada do Fluxo (filtro "Sem contrato (—)") com a coluna Contrato preenchida. Mostra a prévia do que
// será alterado e do que ficou de fora; só aplica depois do clique. Cada alteração passa pela função fluxo_caixa_trocar_contrato (mesma regra do editar).
export function ImportarContratosDialog({ aberto, onFechar, linhasFluxo }: Props) {
  const qc = useQueryClient();
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [linhasLidas, setLinhasLidas] = useState(0);
  const [resultado, setResultado] = useState<ResultadoCasamento | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [aplicacao, setAplicacao] = useState<Aplicacao | null>(null);

  const contratosImportacao = useMemo(() => contratos.map((c: any) => ({ id: c.id as string, nome: c.nome as string, empresa_id: (c.empresa_id ?? null) as string | null })), [contratos]);

  function fechar() {
    if (aplicando) return;
    setArquivo(null); setLinhasLidas(0); setResultado(null); setAplicacao(null); setProgresso(0);
    onFechar();
  }

  async function lerArquivo(f: File) {
    setLendo(true);
    setAplicacao(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      // a aba certa é a que tem as colunas Nº e Contrato (o usuário pode ter renomeado a aba)
      let objetos: Record<string, unknown>[] = [];
      for (const nome of wb.SheetNames) {
        const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nome], { defval: "" });
        const cab = Object.keys(linhas[0] ?? {}).map((k) => k.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase());
        if (cab.includes("CONTRATO") && cab.some((k) => k.startsWith("N"))) { objetos = linhas; break; }
      }
      if (objetos.length === 0) {
        toast.error("Não achei a aba com as colunas Nº e Contrato. Use a planilha exportada do Fluxo de Caixa.");
        setResultado(null);
        return;
      }
      const lidas = lerLinhasPlanilha(objetos);
      setArquivo(f.name);
      setLinhasLidas(lidas.length);
      setResultado(casarContratos(lidas, linhasFluxo, contratosImportacao));
    } catch (e: any) {
      toast.error(e?.message ?? "Não consegui ler a planilha.");
    } finally {
      setLendo(false);
    }
  }

  async function aplicar() {
    if (!resultado || resultado.atualizar.length === 0) return;
    setAplicando(true);
    setProgresso(0);
    const executar = criarLimitadorDeConcorrencia(6);
    const falhas: Pendencia[] = [];
    let feitas = 0;
    let jaEstavam = 0;
    let concluidas = 0;
    await Promise.all(
      resultado.atualizar.map((item) =>
        executar(async () => {
          const { error } = await (supabase as any).rpc("fluxo_caixa_trocar_contrato", { _origem: item.origem, _despesa_id: item.despesaId, _contrato_id: item.contratoId });
          if (!error) feitas += 1;
          else if (erroEhJaNoContrato(error.message)) jaEstavam += 1;
          else falhas.push({ motivo: "dados_invalidos", linha: item.linhasPlanilha[0], numero: item.numero, detalhe: `${item.contratoNome}: ${error.message}` });
          concluidas += 1;
          setProgresso(concluidas);
        }),
      ),
    );
    setAplicando(false);
    setAplicacao({ feitas, jaEstavam, falhas });
    for (const k of ["fluxo_caixa_combinado", "fluxo_caixa_malote", "utilizado_orcamento", "malote_despesa"]) qc.invalidateQueries({ queryKey: [k] });
    if (falhas.length === 0) toast.success(`${feitas} lançamento(s) atualizados.`);
    else toast.warning(`${feitas} atualizados e ${falhas.length} com erro. Veja a lista.`);
  }

  async function baixarPendencias() {
    const linhas: Record<string, unknown>[] = [
      ...(resultado?.pendencias ?? []).map((p) => ({ "Linha da planilha": p.linha, "Nº": p.numero, Motivo: ROTULO_MOTIVO[p.motivo], Detalhe: p.detalhe })),
      ...(aplicacao?.falhas ?? []).map((p) => ({ "Linha da planilha": p.linha, "Nº": p.numero, Motivo: "Erro ao aplicar", Detalhe: p.detalhe })),
    ];
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Pendências");
    XLSX.writeFile(wb, `Importacao_contratos_pendencias_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const porMotivo = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of resultado?.pendencias ?? []) m.set(p.motivo, (m.get(p.motivo) ?? 0) + 1);
    return [...m.entries()];
  }, [resultado]);
  const totalPendencias = (resultado?.pendencias.length ?? 0) + (aplicacao?.falhas.length ?? 0);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar contratos do Fluxo de Caixa</DialogTitle>
          <DialogDescription>
            Exporte as linhas "Sem contrato (—)" pelo Exportar Excel, preencha a coluna <strong>Contrato</strong> e importe a planilha aqui. Cada linha é encontrada pelo
            Nº, data, tipo, empresa e valor. Nada é aplicado antes de você conferir a prévia, e contrato que já está preenchido no Fluxo nunca é sobrescrito.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); e.target.value = ""; }}
          />
          <Button variant="outline" size="sm" className="gap-1.5" disabled={lendo || aplicando} onClick={() => inputRef.current?.click()}>
            {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
            {arquivo ? "Trocar planilha" : "Escolher planilha (.xlsx)"}
          </Button>
          {arquivo && <span className="ml-2 text-xs text-muted-foreground">{arquivo} · {linhasLidas.toLocaleString("pt-BR")} linha(s)</span>}

          {resultado && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border bg-emerald-50 p-2 dark:bg-emerald-950/20">
                  <p className="text-xl font-bold text-emerald-700">{resultado.atualizar.length.toLocaleString("pt-BR")}</p>
                  <p className="text-[11px] text-muted-foreground">lançamento(s) serão atualizados</p>
                </div>
                <div className="rounded-md border p-2">
                  <p className="text-xl font-bold">{resultado.jaNoContrato.toLocaleString("pt-BR")}</p>
                  <p className="text-[11px] text-muted-foreground">já estão no contrato</p>
                </div>
                <div className="rounded-md border bg-amber-50 p-2 dark:bg-amber-950/20">
                  <p className="text-xl font-bold text-amber-700">{resultado.pendencias.length.toLocaleString("pt-BR")}</p>
                  <p className="text-[11px] text-muted-foreground">linha(s) ficam de fora</p>
                </div>
              </div>

              {porMotivo.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {porMotivo.map(([m, n]) => <li key={m}>{n.toLocaleString("pt-BR")} · {ROTULO_MOTIVO[m as keyof typeof ROTULO_MOTIVO]}</li>)}
                </ul>
              )}

              {resultado.contratosNaoEncontrados.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="mb-1 font-semibold">Contratos da planilha que não existem no sistema (escreva exatamente como no cadastro e importe de novo):</p>
                  <ul className="list-disc pl-5">
                    {resultado.contratosNaoEncontrados.slice(0, 12).map((c) => <li key={c.nome}>{c.nome} ({c.linhas} linha(s))</li>)}
                  </ul>
                </div>
              )}

              {resultado.pendencias.length > 0 && (
                <details className="rounded-md border text-xs">
                  <summary className="cursor-pointer px-2 py-1.5 font-medium">Ver as {resultado.pendencias.length.toLocaleString("pt-BR")} linha(s) que ficam de fora</summary>
                  <div className="max-h-56 overflow-auto border-t">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted">
                        <tr><th className="px-2 py-1 text-left">Linha</th><th className="px-2 py-1 text-left">Nº</th><th className="px-2 py-1 text-left">Motivo</th></tr>
                      </thead>
                      <tbody>
                        {resultado.pendencias.slice(0, 200).map((p, i) => (
                          <tr key={i} className="border-t align-top">
                            <td className="px-2 py-1">{p.linha}</td>
                            <td className="px-2 py-1 font-mono">{p.numero || "—"}</td>
                            <td className="px-2 py-1">{ROTULO_MOTIVO[p.motivo]}{p.detalhe ? <span className="block text-muted-foreground">{p.detalhe}</span> : null}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {resultado.pendencias.length > 200 && <p className="p-2 text-muted-foreground">Mostrando as 200 primeiras; a lista completa está em “Baixar pendências”.</p>}
                  </div>
                </details>
              )}

              <p className="text-[11px] text-muted-foreground">
                Lançamentos futuros (previstos) só são encontrados com a aba Projetado ou Consolidado aberta. Aplicação financeira e cartão de crédito não têm contrato pelo Fluxo e ficam de fora.
              </p>
            </div>
          )}

          {aplicando && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aplicando {progresso.toLocaleString("pt-BR")} de {resultado?.atualizar.length.toLocaleString("pt-BR")}…
            </p>
          )}

          {aplicacao && (
            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Resultado</p>
              <p>{aplicacao.feitas.toLocaleString("pt-BR")} atualizados · {aplicacao.jaEstavam.toLocaleString("pt-BR")} já estavam no contrato · {aplicacao.falhas.length.toLocaleString("pt-BR")} com erro</p>
              {aplicacao.falhas.slice(0, 8).map((f, i) => <p key={i} className="text-red-600">{f.numero}: {f.detalhe}</p>)}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {totalPendencias > 0 && <Button variant="outline" onClick={() => void baixarPendencias()} disabled={aplicando}>Baixar pendências (.xlsx)</Button>}
          <Button variant="outline" onClick={fechar} disabled={aplicando}>Fechar</Button>
          <Button onClick={() => void aplicar()} disabled={aplicando || !resultado || resultado.atualizar.length === 0 || !!aplicacao}>
            {aplicando ? "Aplicando…" : `Aplicar ${resultado?.atualizar.length ? resultado.atualizar.length.toLocaleString("pt-BR") : ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
