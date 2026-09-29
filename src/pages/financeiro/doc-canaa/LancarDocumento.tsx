import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Paperclip, Upload } from "lucide-react";
import { formatarBRL, parseValorBRL, useCriarProtocoloDocCanaa, usePlanosDocCanaa } from "@/hooks/useDocCanaa";

export interface ValoresProtocolo {
  arquivo: File | null;
  favorecido: string;
  despesa: string;
  planoId: string;
  documento: string;
  valor: string;
  dataCompetencia: string;
}

export const VALORES_VAZIOS: ValoresProtocolo = {
  arquivo: null, favorecido: "", despesa: "", planoId: "", documento: "", valor: "", dataCompetencia: "",
};

export function validarProtocolo(v: ValoresProtocolo, arquivoObrigatorio: boolean): string | null {
  if (arquivoObrigatorio && !v.arquivo) return "Selecione o arquivo do documento.";
  if (!v.favorecido.trim()) return "Informe o favorecido.";
  if (!v.despesa.trim()) return "Informe o tipo de despesa.";
  if (!v.planoId) return "Selecione o plano de aplicação.";
  if (!v.documento.trim()) return "Informe o nº do documento (NF/Recibo).";
  if (parseValorBRL(v.valor) === null) return "Valor inválido.";
  if (!v.dataCompetencia) return "Informe a data do serviço.";
  return null;
}

// Campos compartilhados entre "Lançar Documento" e "Editar Protocolo".
export function CamposProtocolo({
  valores, onChange, arquivoObrigatorio,
}: {
  valores: ValoresProtocolo;
  onChange: (v: ValoresProtocolo) => void;
  arquivoObrigatorio: boolean;
}) {
  const { data: planos = [] } = usePlanosDocCanaa();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ValoresProtocolo>(k: K, val: ValoresProtocolo[K]) => onChange({ ...valores, [k]: val });

  const ativos = planos.filter((p) => p.ativo || p.id === valores.planoId);
  const gerais = ativos.filter((p) => p.limite_mensal === null);
  const fixas = ativos.filter((p) => p.limite_mensal !== null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Label className="min-w-32">1. Arquivo{arquivoObrigatorio ? "" : " (opcional)"}</Label>
        <input
          ref={inputArquivo} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
          onChange={(e) => set("arquivo", e.target.files?.[0] ?? null)}
        />
        <Button type="button" variant="outline" className="gap-1.5" onClick={() => inputArquivo.current?.click()}>
          <Paperclip className="h-4 w-4" /> Procurar arquivo
        </Button>
        <span className={valores.arquivo ? "text-sm font-medium text-emerald-600" : "text-sm italic text-muted-foreground"}>
          {valores.arquivo ? valores.arquivo.name : "Nenhum arquivo selecionado…"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label>2. Favorecido</Label>
          <Input value={valores.favorecido} onChange={(e) => set("favorecido", e.target.value)} placeholder="Quem recebe?" />
        </div>
        <div className="space-y-1.5">
          <Label>3. Tipo de Despesa</Label>
          <Input value={valores.despesa} onChange={(e) => set("despesa", e.target.value)} placeholder="Ex: PINTURA, SALÁRIO…" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label>4. Plano de Aplicação</Label>
          <Select value={valores.planoId} onValueChange={(v) => set("planoId", v)}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Categorias Gerais</SelectLabel>
                {gerais.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Despesas Fixas (Trava Mensal)</SelectLabel>
                {fixas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nome} · {formatarBRL(p.limite_mensal)}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>5. Nº Doc (NF/Recibo)</Label>
          <Input value={valores.documento} onChange={(e) => set("documento", e.target.value)} placeholder="Ex: NF-25" />
        </div>
        <div className="space-y-1.5">
          <Label>6. Valor (R$)</Label>
          <Input value={valores.valor} onChange={(e) => set("valor", e.target.value)} placeholder="Ex: 1.500,00" inputMode="decimal" />
        </div>
        <div className="space-y-1.5">
          <Label>7. Data do Serviço</Label>
          <Input type="date" value={valores.dataCompetencia} onChange={(e) => set("dataCompetencia", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

export function LancarDocumento() {
  const criar = useCriarProtocoloDocCanaa();
  const [valores, setValores] = useState<ValoresProtocolo>(VALORES_VAZIOS);
  const [chave, setChave] = useState(0); // remonta os campos pra limpar o <input type=file>

  const salvar = async () => {
    const erro = validarProtocolo(valores, true);
    if (erro) { toast.error(erro); return; }
    try {
      const res = await criar.mutateAsync({
        arquivo: valores.arquivo!,
        favorecido: valores.favorecido,
        despesa: valores.despesa,
        planoId: valores.planoId,
        documento: valores.documento,
        valor: parseValorBRL(valores.valor)!,
        dataCompetencia: valores.dataCompetencia,
      });
      if (res.acima_orcamento) {
        toast.warning(`Protocolo #${res.numero} salvo, mas ESTOUROU o orçamento do plano (saldo era ${formatarBRL(res.saldo_orcamento)}). Enviado para o Operacional.`, { duration: 8000 });
      } else {
        toast.success(`Protocolo #${res.numero} salvo! Enviado para a fila do Operacional.`);
      }
      setValores({ ...VALORES_VAZIOS, planoId: valores.planoId });
      setChave((k) => k + 1);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Erro ao salvar protocolo.");
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <CamposProtocolo key={chave} valores={valores} onChange={setValores} arquivoObrigatorio />
        <div className="flex justify-center">
          <Button size="lg" className="gap-2 px-10" onClick={salvar} disabled={criar.isPending}>
            {criar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Salvar Protocolo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
