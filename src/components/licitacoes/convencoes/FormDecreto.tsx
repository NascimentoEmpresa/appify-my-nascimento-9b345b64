import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Landmark, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import { supabase } from "@/integrations/supabase/client";
import {
  BUCKET_CONVENCOES, enviarAnexoConvencao, useSalvarConvencao,
  type Convencao, type ConvencaoInput,
} from "@/hooks/useConvencoes";
import { DEF_POR_CHAVE, pendenciasDecreto, type Periodo, type ValorBeneficio } from "@/lib/licitacoes/convencoes";
import { ANEXO_VAZIO, Campo, CampoAnexo, PERIODO_LABEL, Secao, type Anexo } from "./FormConvencao";
import { IconeBeneficio } from "./IconeBeneficio";

// Novo Decreto Municipal (03/11/2026, mig 20261103002100): cadastro próprio,
// separado da convenção coletiva. 1. Informações do Decreto · 2. Benefício do
// Decreto (Vale-Transporte) · 3. Observações. O decreto é do município, não
// do contrato — quem liga o VT dele a um posto é o vínculo da Planilha de
// Custo (campo "Decreto municipal (Vale-Transporte)", grava regras.vt).

const UF_PADRAO = "RS";
const VT = DEF_POR_CHAVE.vt;

export function FormDecreto({ aberto, onFechar, decreto, somenteLeitura }: {
  aberto: boolean;
  onFechar: () => void;
  /** null = novo. */
  decreto: Convencao | null;
  somenteLeitura?: boolean;
}) {
  const salvar = useSalvarConvencao();
  const [numero, setNumero] = useState("");
  const [uf, setUf] = useState(UF_PADRAO);
  const [municipio, setMunicipio] = useState("");
  const [anexo, setAnexo] = useState<Anexo>(ANEXO_VAZIO);
  const [vt, setVt] = useState<ValorBeneficio>({});
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const d = decreto;
    setNumero(d?.decreto_numero ?? "");
    setUf(d?.uf ?? UF_PADRAO);
    setMunicipio(d?.municipio ?? "");
    setAnexo(d ? { path: d.decreto_arquivo_path, nome: d.decreto_arquivo_nome, tamanho: d.decreto_arquivo_tamanho } : ANEXO_VAZIO);
    setVt(d?.beneficios?.vt ?? {});
    setObs(d?.observacoes ?? "");
  }, [aberto, decreto]);

  // Município gravado fora da lista (digitado antes) continua aparecendo.
  const opcoesMunicipio = useMemo(() => {
    const lista = municipiosDe(uf);
    const todos = municipio && !lista.includes(municipio) ? [municipio, ...lista] : lista;
    return todos.map((m) => ({ value: m, label: m }));
  }, [uf, municipio]);

  const pendencias = pendenciasDecreto({
    decreto_numero: numero, municipio,
    decreto_arquivo_path: anexo.path || (anexo.novo ? "novo" : null),
    beneficios: { vt },
  });

  const confirmar = async () => {
    if (!numero.trim()) { toast.error("Informe o decreto municipal."); return; }
    if (!municipio) { toast.error("Selecione o município."); return; }
    setEnviando(true);
    try {
      const final: Anexo = anexo.novo
        ? { ...(await enviarAnexoConvencao(decreto?.contrato_id ?? null, "decreto", anexo.novo)), novo: null }
        : anexo;
      const input: ConvencaoInput & { id?: string } = {
        id: decreto?.id,
        tipo: "decreto",
        empresa_id: decreto?.empresa_id ?? null, contrato_id: decreto?.contrato_id ?? null,
        identificacao: null, categoria_profissional: null, sindicato: null,
        municipio, uf,
        vigencia_inicio: null, vigencia_fim: null,
        cct_arquivo_path: null, cct_arquivo_nome: null, cct_arquivo_tamanho: null,
        decreto_numero: numero.trim(),
        decreto_arquivo_path: final.path, decreto_arquivo_nome: final.nome, decreto_arquivo_tamanho: final.tamanho,
        beneficios: { vt }, observacoes: obs.trim() || null,
      };
      await salvar.mutateAsync(input);
      if (decreto?.decreto_arquivo_path && decreto.decreto_arquivo_path !== final.path) {
        await supabase.storage.from(BUCKET_CONVENCOES).remove([decreto.decreto_arquivo_path]).catch(() => undefined);
      }
      toast.success(pendencias.length ? "Salvo — o decreto segue Pendente até completar o que falta." : "Decreto salvo.");
      onFechar();
    } catch (e) {
      toast.error("Não foi possível salvar: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setEnviando(false);
    }
  };

  const off = somenteLeitura || !!vt.nao_contem;

  return (
    <Sheet open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4" />
            {somenteLeitura ? "Decreto Municipal" : decreto ? "Editar Decreto Municipal" : "Novo Decreto Municipal"}
            {decreto && <span className="text-xs font-normal text-muted-foreground">· versão {decreto.versao}</span>}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <Secao n={1} titulo="Informações do Decreto">
            <div className="space-y-3">
              <Campo label="Decreto Municipal" obrigatorio>
                <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: Decreto 12.345/2024" disabled={somenteLeitura} className="h-9" />
              </Campo>
              <Campo label="Município" obrigatorio>
                <div className="flex gap-2">
                  <Select value={uf} onValueChange={(v) => { setUf(v); setMunicipio(""); }} disabled={somenteLeitura}>
                    <SelectTrigger className="h-9 w-[84px] shrink-0" aria-label="UF"><SelectValue /></SelectTrigger>
                    <SelectContent>{ESTADOS_BR.map((e) => <SelectItem key={e.uf} value={e.uf}>{e.uf}</SelectItem>)}</SelectContent>
                  </Select>
                  <SearchableSelect value={municipio} onChange={setMunicipio} options={opcoesMunicipio} disabled={somenteLeitura}
                    placeholder="Selecione o município" searchPlaceholder="Buscar município…" className="min-w-0 flex-1" triggerClassName="h-9" />
                </div>
              </Campo>
              <Campo label="Anexo do Decreto" obrigatorio>
                <CampoAnexo anexo={anexo} rotulo="o decreto" somenteLeitura={somenteLeitura}
                  onEscolher={(f) => setAnexo((a) => ({ ...a, novo: f }))}
                  onRemover={() => setAnexo(ANEXO_VAZIO)} />
              </Campo>
            </div>
          </Secao>

          <Secao n={2} titulo="Benefício do Decreto">
            <div className={cn("space-y-2 rounded-md border p-3", vt.nao_contem && "opacity-70")}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><IconeBeneficio chave="vt" tamanho="sm" />{VT.nome}</span>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox checked={!!vt.nao_contem} disabled={somenteLeitura} aria-label={`${VT.nome}: não contém`}
                    onCheckedChange={(c) => setVt(c ? { nao_contem: true } : { nao_contem: false })} />
                  Não contém
                </label>
              </div>
              <div className="grid grid-cols-[1fr_minmax(120px,0.7fr)] gap-2">
                <CurrencyInput value={vt.valor ? String(vt.valor) : ""} onChange={(s) => setVt((v) => ({ ...v, valor: s ? Number(s) : null }))}
                  disabled={off} className="h-9" />
                <Select value={vt.periodo ?? ""} onValueChange={(p) => setVt((v) => ({ ...v, periodo: p as Periodo }))} disabled={off}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{(VT.periodos ?? []).map((p) => <SelectItem key={p} value={p}>{PERIODO_LABEL[p]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {pendencias.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Pendências ({pendencias.length}) — o decreto fica como Pendente</p>
                <ul className="list-disc space-y-0.5 pl-5">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}
          </Secao>

          <Secao n={3} titulo="Observações (opcional)">
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={4} placeholder="Digite observações, se necessário…" disabled={somenteLeitura} />
            <p className="text-[11px] text-muted-foreground">
              Para o posto usar o VT deste decreto: Planilha de Custo › CCT do posto › "Decreto municipal (Vale-Transporte)".
            </p>
          </Secao>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            {somenteLeitura ? <><X className="mr-1 h-4 w-4" />Fechar</> : "Cancelar"}
          </Button>
          {!somenteLeitura && (
            <Button onClick={confirmar} disabled={enviando} className="min-w-[120px] bg-[#0f3171] hover:bg-[#0c2860]">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar Decreto"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
