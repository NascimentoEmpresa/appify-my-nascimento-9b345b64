import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Printer } from "lucide-react";
import { toast } from "sonner";

interface PedidoEtiqueta {
  pedido_id: string;
  nome_colaborador: string;
  contrato_nome: string;
  posto_nome: string;
  funcao_nome: string;
  sup_pedido_item: Array<{
    nome_item: string;
    tamanho: string | null;
    quantidade: number;
    litros: string | null;
  }>;
}

type TamanhoEtiqueta = "PADRAO" | "COMPACTO";

function textoPedido(pedido: PedidoEtiqueta) {
  const itens = [...(pedido.sup_pedido_item ?? [])]
    .map((item) => `• ${item.nome_item}${item.tamanho ? ` — Tam. ${item.tamanho}` : ""}${item.litros ? ` — ${item.litros} L` : ""} — Qtd. ${item.quantidade}`)
    .join("\n");
  return [
    `PEDIDO: ${pedido.pedido_id}`,
    `COLABORADOR: ${pedido.nome_colaborador || "—"}`,
    `CONTRATO: ${pedido.contrato_nome}`,
    `POSTO: ${pedido.posto_nome}`,
    `FUNÇÃO: ${pedido.funcao_nome}`,
    "",
    "ITENS:",
    itens || "—",
  ].join("\n");
}

function escapar(valor: string) {
  return valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function ModalEtiquetaTermica({
  pedido,
  onFechar,
}: {
  pedido: PedidoEtiqueta | null;
  onFechar: () => void;
}) {
  const [tamanho, setTamanho] = useState<TamanhoEtiqueta>("PADRAO");
  const [copias, setCopias] = useState(1);
  const [conteudo, setConteudo] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!pedido) return;
    setTamanho("PADRAO");
    setCopias(1);
    setConteudo(textoPedido(pedido));
    setPreview(null);
  }, [pedido]);

  const config = useMemo(() => tamanho === "PADRAO"
    ? { largura: 98, altura: 150, fonte: 10, margem: 4 }
    : { largura: 40, altura: 50, fonte: 5, margem: 2 }, [tamanho]);

  const imprimir = () => {
    if (!preview) return;
    const janela = window.open("", "_blank", "width=650,height=750");
    if (!janela) {
      toast.error("Libere os pop-ups para abrir a impressão da etiqueta");
      return;
    }
    const paginas = Array.from({ length: Math.max(1, copias) }, (_, indice) => `
      <section class="etiqueta${indice === Math.max(1, copias) - 1 ? " ultima" : ""}">${escapar(preview)}</section>
    `).join("");
    janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiqueta ${escapar(pedido?.pedido_id ?? "")}</title><style>
      @page { size: ${config.largura}mm ${config.altura}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      .etiqueta { width: ${config.largura}mm; height: ${config.altura}mm; padding: ${config.margem}mm; white-space: pre-wrap; overflow-wrap: anywhere; font-family: Arial, sans-serif; font-size: ${config.fonte}pt; line-height: 1.12; page-break-after: always; overflow: hidden; }
      .ultima { page-break-after: auto; }
    </style></head><body>${paginas}<script>setTimeout(() => window.print(), 250);</script></body></html>`);
    janela.document.close();
  };

  return (
    <Dialog open={!!pedido} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Emissão de Etiquetas — Setor de Compras · Impressora Térmica</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Tamanho</Label>
                <Select value={tamanho} onValueChange={(valor) => { setTamanho(valor as TamanhoEtiqueta); setPreview(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PADRAO">Padrão Logística (9,8 x 15 cm)</SelectItem>
                    <SelectItem value="COMPACTO">Modelo Compacto (4 x 5 cm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="etiqueta-copias">Cópias</Label>
                <Input id="etiqueta-copias" type="number" min={1} value={copias} onChange={(e) => setCopias(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            </div>
            <div>
              <Label htmlFor="etiqueta-conteudo">Cole abaixo os dados copiados do ERP</Label>
              <Textarea id="etiqueta-conteudo" rows={14} value={conteudo} onChange={(e) => { setConteudo(e.target.value); setPreview(null); }} className="font-mono text-sm" />
            </div>
            <Button type="button" variant="secondary" onClick={() => setPreview(conteudo)} disabled={!conteudo.trim()}>
              <Eye className="mr-2 h-4 w-4" /> Gerar preview da etiqueta
            </Button>
          </div>

          <div className="flex min-h-[360px] items-center justify-center rounded-lg border bg-muted/30 p-4">
            {preview === null ? (
              <p className="text-center text-sm text-muted-foreground">Aguardando geração da prévia…</p>
            ) : (
              <div
                className="overflow-hidden border-2 border-foreground bg-background p-3 font-mono shadow-sm"
                style={{
                  aspectRatio: `${config.largura} / ${config.altura}`,
                  height: tamanho === "PADRAO" ? 330 : 300,
                  maxWidth: "100%",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontSize: tamanho === "PADRAO" ? 10 : 6,
                  lineHeight: 1.2,
                }}
              >
                {preview}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
          <Button onClick={imprimir} disabled={!preview}>
            <Printer className="mr-2 h-4 w-4" /> Imprimir etiqueta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
