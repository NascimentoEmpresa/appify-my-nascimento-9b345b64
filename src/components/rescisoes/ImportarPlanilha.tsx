import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SolicitacaoDemissao } from "@/lib/demissao/solicitacao";
import {
  TABELA_RESCISAO, casarComSolicitacoes, completarVazios, lerPlanilhaRescisao,
  type LinhaPlanilhaRescisao, type RescisaoRH, type VinculoEmpregado,
} from "@/lib/demissao/rescisao";
import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

const sb = supabase as unknown as SupabaseClient;

/**
 * Importar a PLANILHA DE RESCISÃO do RH — veio da tabela de Solicitações de
 * Demissão (19/10/2026) para o módulo Rescisões (21/10/2026). Repetível:
 * cada linha tem a sua `planilha_chave`; reimportar só traz as novas e
 * completa campos vazios — o que o RH lançou no sistema não é sobrescrito.
 * Desde 21/10 lê todas as abas de rescisão (RESCISÕES e HOMOLOGAÇÃO) e
 * guarda a linha original do Excel (planilha_original).
 */

interface PlanoImportacao {
  novasAvulsas: LinhaPlanilhaRescisao[];
  novasNoErp: { linha: LinhaPlanilhaRescisao; solicitacaoId: number }[];
  completar: { id: number; patch: Partial<RescisaoRH> }[];
  semMudanca: number;
}

// status_desde nulo: a planilha não diz há quanto tempo a linha está naquele
// status — melhor o card não dizer "há 0 dias" do que mentir.
const camposDaLinha = (l: LinhaPlanilhaRescisao) => {
  const { chave, ...resto } = l;
  return { ...resto, planilha_chave: chave, status_desde: null };
};

function planejarImportacao(
  linhas: LinhaPlanilhaRescisao[], solicitacoes: SolicitacaoDemissao[], rescisoes: RescisaoRH[], empregados: Map<number, VinculoEmpregado>,
): PlanoImportacao {
  const porChave = new Map(rescisoes.filter((r) => r.planilha_chave).map((r) => [r.planilha_chave!, r]));
  const porSolicitacao = new Map(rescisoes.filter((r) => r.solicitacao_id != null).map((r) => [r.solicitacao_id!, r]));
  const jaVinculadas = new Set(rescisoes.filter((r) => r.solicitacao_id != null && r.planilha_chave).map((r) => r.solicitacao_id!));
  const novas = linhas.filter((l) => !porChave.has(l.chave));
  const casadas = casarComSolicitacoes(novas, solicitacoes, empregados, jaVinculadas);

  const plano: PlanoImportacao = { novasAvulsas: [], novasNoErp: [], completar: [], semMudanca: 0 };
  for (const l of linhas) {
    const existente = porChave.get(l.chave);
    if (existente) {
      const patch = completarVazios(existente, l);
      if (patch) plano.completar.push({ id: existente.id, patch });
      else plano.semMudanca++;
      continue;
    }
    const sid = casadas.get(l.chave);
    if (sid == null) { plano.novasAvulsas.push(l); continue; }
    const daSolicitacao = porSolicitacao.get(sid);
    if (daSolicitacao) {
      // O RH já tinha começado a ficha no ERP: a planilha só completa o vazio.
      plano.completar.push({ id: daSolicitacao.id, patch: { ...(completarVazios(daSolicitacao, l) ?? {}), planilha_chave: l.chave } });
    } else {
      plano.novasNoErp.push({ linha: l, solicitacaoId: sid });
    }
  }
  return plano;
}

export function ImportarPlanilha({ aberto, onFechar, solicitacoes, rescisoes, empregados, quemSou, onImportado }: {
  aberto: boolean;
  onFechar: () => void;
  solicitacoes: SolicitacaoDemissao[];
  rescisoes: RescisaoRH[];
  empregados: Map<number, VinculoEmpregado>;
  quemSou: string;
  onImportado: () => void;
}) {
  const arquivo = useRef<HTMLInputElement>(null);
  const [lido, setLido] = useState<{ nome: string; linhas: LinhaPlanilhaRescisao[]; avisos: string[]; abas: { aba: string; linhas: number }[] } | null>(null);
  const [gravando, setGravando] = useState(false);
  const [progresso, setProgresso] = useState("");
  useEffect(() => { if (!aberto) { setLido(null); setProgresso(""); } }, [aberto]);

  const plano = useMemo(
    () => (lido ? planejarImportacao(lido.linhas, solicitacoes, rescisoes, empregados) : null),
    [lido, solicitacoes, rescisoes, empregados],
  );

  const ler = async (f: File) => {
    try {
      const r = lerPlanilhaRescisao(await f.arrayBuffer());
      setLido({ nome: f.name, linhas: r.linhas, avisos: r.avisos, abas: r.abas });
    } catch (e) {
      toast.error("Não consegui ler a planilha: " + (e as Error).message);
    }
  };

  const importar = async () => {
    if (!plano) return;
    setGravando(true);
    try {
      const inserir = [
        ...plano.novasAvulsas.map((l) => ({ ...camposDaLinha(l), origem: "planilha", atualizado_por: quemSou || null })),
        ...plano.novasNoErp.map(({ linha, solicitacaoId }) => ({ ...camposDaLinha(linha), solicitacao_id: solicitacaoId, origem: "erp", atualizado_por: quemSou || null })),
      ];
      // Lotes no corpo do POST (não na URL): 200 por vez.
      for (let i = 0; i < inserir.length; i += 200) {
        setProgresso(`Gravando ${Math.min(i + 200, inserir.length)} de ${inserir.length}…`);
        const { error } = await sb.from(TABELA_RESCISAO).insert(inserir.slice(i, i + 200));
        if (error) throw error;
      }
      for (let i = 0; i < plano.completar.length; i++) {
        setProgresso(`Completando ${i + 1} de ${plano.completar.length}…`);
        const { id, patch } = plano.completar[i];
        const { error } = await sb.from(TABELA_RESCISAO).update({ ...patch, atualizado_por: quemSou || null }).eq("id", id);
        if (error) throw error;
      }
      toast.success(`Importação concluída: ${inserir.length} nova(s), ${plano.completar.length} completada(s).`);
      onImportado();
    } catch (e) {
      toast.error("Erro na importação (o que já foi gravado fica; importar de novo continua de onde parou): " + (e as Error).message);
    }
    setGravando(false);
    setProgresso("");
  };

  if (!aberto) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !gravando) onFechar(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Importar a planilha de rescisão</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Lê as abas de rescisão do Excel do RH (RESCISÕES e HOMOLOGAÇÃO) e guarda cada linha como está na
          planilha. Cada linha entra uma vez só — importar de novo não duplica, só traz as linhas novas e
          completa campos vazios (o que já foi lançado aqui não é sobrescrito). Quando a linha é de uma
          solicitação do ERP (mesma matrícula ou mesmo nome), ela vira a ficha daquela solicitação.
        </p>
        <input ref={arquivo} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) ler(f); ev.target.value = ""; }} />
        <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={gravando}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> {lido ? `Trocar arquivo (${lido.nome})` : "Escolher o arquivo .xlsx"}
        </Button>
        {lido && plano && (
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <p>
              <b>{lido.linhas.length}</b> linha(s) lidas
              {lido.abas.length > 0 && <> — {lido.abas.map((a) => `${a.aba}: ${a.linhas}`).join(" · ")}</>}.
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li><b>{plano.novasNoErp.length}</b> ligadas a solicitações do ERP</li>
              <li><b>{plano.novasAvulsas.length}</b> novas, só da planilha</li>
              <li><b>{plano.completar.length}</b> já no sistema com campos a completar</li>
              <li><b>{plano.semMudanca}</b> já importadas, sem mudança</li>
            </ul>
            {lido.avisos.map((a) => <p key={a} className="text-amber-700">{a}</p>)}
          </div>
        )}
        {progresso && <p className="text-sm text-muted-foreground">{progresso}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={gravando}>Fechar</Button>
          <Button onClick={importar}
            disabled={gravando || !plano || plano.novasAvulsas.length + plano.novasNoErp.length + plano.completar.length === 0}>
            {gravando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
