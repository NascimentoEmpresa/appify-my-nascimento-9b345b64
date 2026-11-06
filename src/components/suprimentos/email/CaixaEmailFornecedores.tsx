import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePermissoes } from "@/context/PermissoesContext";
import { CaixaEmail } from "@/components/email/CaixaEmail";
import type { MensagemInicial } from "@/components/email/EscreverEmail";
import { CAIXA_FORNECEDORES, type MensagemEmail } from "@/hooks/useCaixaEmail";
import {
  donosDosEnderecos, enderecosDosFornecedores, type FornecedorComEmails,
} from "@/lib/suprimentos/fornecedorEmail";

/**
 * Caixa de e-mail de Fornecedores (Suprimentos) — o "Gmail" da tela.
 *
 * O desenho (pastas, lista, leitura, escrever) é o comum às caixas do ERP,
 * em components/email/CaixaEmail.tsx — o mesmo do módulo E-mail. Aqui fica
 * o que é desta caixa: ela é COMPARTILHADA (quem tem
 * `fornecedores_email · visualizar` vê tudo o que saiu, de qualquer pessoa —
 * o histórico com o fornecedor é da empresa), sugere os e-mails dos
 * fornecedores e liga cada mensagem aos fornecedores dos endereços
 * (fornecedor_ids). Rascunho é só do autor (RLS).
 *
 * Gate: menu fantasma `fornecedores_email` (mig 20261106009500):
 *   visualizar = abrir a caixa · incluir = escrever/enviar · excluir = apagar enviada.
 */

export interface AberturaCaixa {
  /** Filtra a caixa por este fornecedor. */
  fornecedor?: FornecedorComEmails | null;
  /** Abre já com "Nova mensagem" para ele. */
  escrever?: boolean;
}

export function CaixaEmailFornecedores({
  aberta, onOpenChange, fornecedores, abertura,
}: {
  aberta: boolean;
  onOpenChange: (v: boolean) => void;
  fornecedores: FornecedorComEmails[];
  abertura: AberturaCaixa | null;
}) {
  const { can } = usePermissoes();
  const podeVer = can("visualizar", "suprimentos", "fornecedores_email");
  const podeEscrever = can("incluir", "suprimentos", "fornecedores_email");
  const podeExcluir = can("excluir", "suprimentos", "fornecedores_email");

  const [foco, setFoco] = useState<FornecedorComEmails | null>(null);
  const [escrevendo, setEscrevendo] = useState(false);
  const [escreverAoAbrir, setEscreverAoAbrir] = useState<{ chave: number; inicial: MensagemInicial } | null>(null);

  const sugestoes = useMemo(() => enderecosDosFornecedores(fornecedores), [fornecedores]);
  const nomeFornecedor = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fornecedores) m.set(f.id, f.nome_fantasia || f.razao_social);
    return m;
  }, [fornecedores]);

  const novaPara = useCallback((f: FornecedorComEmails | null | undefined): MensagemInicial => {
    if (!f) return {};
    const enderecos = sugestoes.filter((s) => s.donoId === f.id);
    const principal = enderecos.find((s) => s.rotulo === "Principal") ?? enderecos[0];
    return { para: principal ? [principal.email] : [], donoIds: [f.id] };
  }, [sugestoes]);

  // Cada abertura da caixa começa do jeito pedido pela linha clicada.
  useEffect(() => {
    if (!aberta) return;
    setFoco(abertura?.fornecedor ?? null);
    if (abertura?.escrever && podeEscrever) {
      const ini = novaPara(abertura.fornecedor);
      if (abertura.fornecedor && !ini.para?.length) {
        toast.message("Este fornecedor não tem e-mail cadastrado — digite o endereço em Para.");
      }
      setEscreverAoAbrir({ chave: Date.now(), inicial: ini });
    } else {
      setEscreverAoAbrir(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, abertura]);

  const nomesDaMensagem = useCallback(
    (m: MensagemEmail) => (m.fornecedor_ids ?? []).map((id) => nomeFornecedor.get(id)).filter(Boolean) as string[],
    [nomeFornecedor],
  );

  const extras = useCallback((enderecos: string[], donoIds: string[]) => ({
    fornecedor_ids: Array.from(new Set([...donoIds, ...donosDosEnderecos(sugestoes, enderecos)])),
  }), [sugestoes]);

  return (
    <Dialog
      open={aberta}
      onOpenChange={(v) => {
        if (!v && escrevendo) { toast.message("Feche (ou envie) a mensagem aberta antes de sair."); return; }
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="flex h-[94vh] w-[calc(100vw-1rem)] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-3rem)]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="sr-only"><DialogTitle>E-mails de fornecedores</DialogTitle></DialogHeader>
        {aberta && (
          <CaixaEmail
            caixa={CAIXA_FORNECEDORES}
            titulo="E-mails"
            subtitulo="Fornecedores"
            sugestoes={sugestoes}
            podeVer={podeVer}
            podeEscrever={podeEscrever}
            podeExcluir={podeExcluir}
            foco={foco ? { id: foco.id, nome: foco.nome_fantasia || foco.razao_social } : null}
            onLimparFoco={() => setFoco(null)}
            escreverAoAbrir={escreverAoAbrir}
            nomesDaMensagem={nomesDaMensagem}
            extras={extras}
            novaMensagem={() => novaPara(foco)}
            onEscrevendoChange={setEscrevendo}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
