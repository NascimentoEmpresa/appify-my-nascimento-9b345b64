import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ESTILO_STATUS } from "@/hooks/useSupPedidos";
import {
  MEDIDAS, cssEtiqueta, htmlEtiqueta, imprimirEtiqueta, textoItens,
  type DadosEtiqueta, type TamanhoEtiqueta,
} from "@/lib/suprimentos/etiquetaTermica";
import { Eye, Printer } from "lucide-react";
import { toast } from "sonner";

/**
 * Emissão de etiqueta térmica do pedido.
 *
 * O desenho reproduz a etiqueta do sistema antigo (ver etiquetaTermica.ts).
 * A caixa de texto continua existindo, mas mudou de papel: ela não é mais a
 * etiqueta inteira em texto corrido — é a área livre no rodapé, que já vem
 * com os itens e aceita qualquer acréscimo.
 *
 * O cabeçalho da etiqueta (protocolo, status, colaborador, contrato…) NÃO passa
 * pela caixa de texto de propósito: vem sempre dos campos do pedido, para não
 * existir etiqueta cujo protocolo não bate com o pedido de onde ela saiu.
 */

export interface PedidoEtiqueta {
  pedido_id: string;
  status: string;
  nome_colaborador: string;
  matricula_colaborador: string | null;
  solicitante_nome: string | null;
  solicitante_login: string;
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

function paraDados(p: PedidoEtiqueta): DadosEtiqueta {
  return {
    pedido_id: p.pedido_id,
    status: p.status,
    statusRotulo: ESTILO_STATUS[p.status]?.rotulo ?? p.status,
    nome_colaborador: p.nome_colaborador,
    matricula_colaborador: p.matricula_colaborador,
    // A etiqueta antiga separava SOLICITANTE de COLABORADOR, e faz falta: são
    // pessoas diferentes na maioria dos pedidos.
    solicitante: p.solicitante_nome ?? p.solicitante_login,
    funcao_nome: p.funcao_nome,
    contrato_nome: p.contrato_nome,
    posto_nome: p.posto_nome,
    itens: p.sup_pedido_item ?? [],
  };
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

  const dados = useMemo(() => (pedido ? paraDados(pedido) : null), [pedido]);

  useEffect(() => {
    if (!pedido) return;
    setTamanho("PADRAO");
    setCopias(1);
    setConteudo(textoItens(paraDados(pedido)));
    setPreview(null);
  }, [pedido]);

  const medidas = MEDIDAS[tamanho];

  const imprimir = () => {
    if (!dados) return;
    if (!imprimirEtiqueta(dados, tamanho, conteudo, copias)) {
      toast.error("Libere os pop-ups para abrir a impressão da etiqueta");
    }
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
              <Label htmlFor="etiqueta-conteudo">Texto livre da etiqueta</Label>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Já vem com os itens do pedido. Protocolo, colaborador, contrato e posto
                são impressos a partir do pedido e não dependem deste campo.
              </p>
              <Textarea
                id="etiqueta-conteudo" rows={10}
                value={conteudo}
                onChange={(e) => { setConteudo(e.target.value); setPreview(null); }}
                className="font-mono text-sm"
              />
              {tamanho === "COMPACTO" && (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                  No modelo compacto o texto livre, o cabeçalho e o status não são
                  impressos — em 4x5 cm eles tomariam o lugar do protocolo e do nome.
                </p>
              )}
            </div>

            <Button type="button" variant="secondary" onClick={() => setPreview(conteudo)}>
              <Eye className="mr-2 h-4 w-4" /> Gerar preview da etiqueta
            </Button>
          </div>

          <div className="flex min-h-[360px] items-center justify-center rounded-lg border bg-muted/30 p-4">
            {preview === null || !dados ? (
              <p className="text-center text-sm text-muted-foreground">Aguardando geração da prévia…</p>
            ) : (
              /* A prévia é a etiqueta de verdade, com o mesmo HTML e CSS da
                 impressão — escalada para caber na tela. Uma prévia "parecida"
                 esconderia justamente o que se quer conferir antes de gastar
                 papel: se o nome cabe na linha. */
              <div
                style={{
                  width: `${medidas.largura}mm`,
                  transform: `scale(${tamanho === "PADRAO" ? 0.85 : 1.7})`,
                  transformOrigin: "center",
                }}
              >
                <style>{cssEtiqueta(tamanho)}</style>
                <div dangerouslySetInnerHTML={{ __html: htmlEtiqueta(dados, tamanho, preview) }} />
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
