import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SolicitacaoDemissao } from "@/lib/demissao/solicitacao";
import {
  TABELA_RESCISAO, atualizarPelaPlanilha, casarComExistentes, casarComSolicitacoes, lerPlanilhaRescisao,
  type LinhaPlanilhaRescisao, type MudancaCampo, type RescisaoRH, type VinculoEmpregado,
} from "@/lib/demissao/rescisao";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

const sb = supabase as unknown as SupabaseClient;

/**
 * Importar a PLANILHA DE RESCISÃO do RH — veio da tabela de Solicitações de
 * Demissão (19/10/2026) para o módulo Rescisões (21/10/2026). Repetível:
 * cada linha tem a sua `planilha_chave`; reimportar nunca duplica.
 * Desde 21/10 lê todas as abas de rescisão (RESCISÕES e HOMOLOGAÇÃO) e
 * guarda a linha original do Excel (planilha_original).
 *
 * Desde 28/10/2026 reimportar ATUALIZA: o que a planilha preenche vence o
 * sistema (status, datas, tipo…) — antes só completava o vazio e o status
 * velho ficava (ver atualizarPelaPlanilha). E a linha cuja data mudou no Excel
 * casa pela pessoa em vez de entrar de novo (casarComExistentes). Antes de
 * gravar a tela mostra o que muda, e "Baixar o que muda" guarda o valor
 * anterior de cada campo — é o backup da importação.
 */

interface Atualizacao {
  id: number; nome: string; empresa: string | null; matricula: string | null;
  patch: Partial<RescisaoRH>; mudancas: MudancaCampo[];
}

interface PlanoImportacao {
  novasAvulsas: LinhaPlanilhaRescisao[];
  novasNoErp: { linha: LinhaPlanilhaRescisao; solicitacaoId: number }[];
  atualizar: Atualizacao[];
  ambiguas: LinhaPlanilhaRescisao[];
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
  const porId = new Map(rescisoes.map((r) => [r.id, r]));
  const porSolicitacao = new Map(rescisoes.filter((r) => r.solicitacao_id != null).map((r) => [r.solicitacao_id!, r]));
  const jaVinculadas = new Set(rescisoes.filter((r) => r.solicitacao_id != null && r.planilha_chave).map((r) => r.solicitacao_id!));
  const { casadas: existentes, ambiguas } = casarComExistentes(linhas, rescisoes);
  const deFora = new Set(ambiguas.map((l) => l.chave));
  const novas = linhas.filter((l) => !existentes.has(l.chave) && !deFora.has(l.chave));
  const casadas = casarComSolicitacoes(novas, solicitacoes, empregados, jaVinculadas);

  const plano: PlanoImportacao = { novasAvulsas: [], novasNoErp: [], atualizar: [], ambiguas, semMudanca: 0 };
  const atualizar = (r: RescisaoRH, l: LinhaPlanilhaRescisao) => {
    const a = atualizarPelaPlanilha(r, l);
    if (!a) { plano.semMudanca++; return; }
    plano.atualizar.push({ id: r.id, nome: r.colaborador_nome ?? l.colaborador_nome, empresa: r.empresa ?? l.empresa, matricula: r.matricula ?? l.matricula, ...a });
  };
  for (const l of linhas) {
    if (deFora.has(l.chave)) continue;
    const id = existentes.get(l.chave);
    if (id != null) { atualizar(porId.get(id)!, l); continue; }
    const sid = casadas.get(l.chave);
    if (sid == null) { plano.novasAvulsas.push(l); continue; }
    const daSolicitacao = porSolicitacao.get(sid);
    // O RH já tinha a ficha da solicitação no ERP: a planilha atualiza e a liga (planilha_chave).
    if (daSolicitacao) atualizar(daSolicitacao, l);
    else plano.novasNoErp.push({ linha: l, solicitacaoId: sid });
  }
  return plano;
}

const ROTULO_CAMPO: Record<string, string> = {
  status_rescisao: "Status", homologacao: "Homologação", data_aviso: "Aviso", data_ultimo_dia: "Último dia",
  data_demissao: "Demissão", data_pagamento: "Pagamento", tipo_desligamento: "Tipo de desligamento",
  rescisao_programada: "Rescisão programada", vales_programados: "Vales programados", malote_data: "Malote (data)",
  malote_obs: "Malote", envio_meio: "Envio (meio)", envio_data: "Envio (data)", envio_obs: "Envio",
  retorno_meio: "Retorno (meio)", retorno_data: "Retorno (data)", retorno_obs: "Retorno",
  observacao: "Observação", pontos_ajustados: "Pontos ajustados", data_admissao: "Admissão",
};
const rotulo = (c: string) => ROTULO_CAMPO[c] ?? c;
const valor = (v: unknown) => (v == null || v === "" ? "(vazio)" : v === true ? "OK" : v === false ? "não" : String(v));

/** O relatório do que a importação muda — com o valor anterior, para desfazer à mão se precisar. */
function baixarMudancas(plano: PlanoImportacao) {
  const linhas = plano.atualizar.flatMap((a) => a.mudancas.map((m) => ({
    ID: a.id, EMPRESA: a.empresa ?? "", MAT: a.matricula ?? "", FUNCIONARIO: a.nome,
    CAMPO: rotulo(m.campo), ANTES: valor(m.de), PLANILHA: valor(m.para),
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.length ? linhas : [{ ID: "nada muda" }]), "O QUE MUDA");
  if (plano.ambiguas.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plano.ambiguas.map((l) => ({
      EMPRESA: l.empresa ?? "", MAT: l.matricula ?? "", FUNCIONARIO: l.colaborador_nome,
      DEMISSAO: l.data_demissao ?? "", PAGAMENTO: l.data_pagamento ?? "",
    }))), "AMBIGUAS");
  }
  XLSX.writeFile(wb, `rescisoes-importacao-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Resumo para a tela: trocas de status ("Rescisão feita → Rescisão OK: 12") e quantas linhas mudam por campo. */
function resumirMudancas(atualizar: Atualizacao[]) {
  const status = new Map<string, number>();
  const campos = new Map<string, number>();
  for (const a of atualizar) {
    for (const m of a.mudancas) {
      campos.set(m.campo, (campos.get(m.campo) ?? 0) + 1);
      if (m.campo === "status_rescisao") {
        const k = `${valor(m.de)} → ${valor(m.para)}`;
        status.set(k, (status.get(k) ?? 0) + 1);
      }
    }
  }
  const ordenar = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
  return { status: ordenar(status), campos: ordenar(campos), soLigacao: atualizar.filter((a) => !a.mudancas.length).length };
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
  const resumo = useMemo(() => (plano ? resumirMudancas(plano.atualizar) : null), [plano]);

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
      // Um UPDATE por linha (cada uma tem o seu patch), 10 em paralelo — mil
      // linhas em série levavam minutos com a tela parada.
      for (let i = 0; i < plano.atualizar.length; i += 10) {
        setProgresso(`Atualizando ${Math.min(i + 10, plano.atualizar.length)} de ${plano.atualizar.length}…`);
        const lote = await Promise.all(plano.atualizar.slice(i, i + 10).map(({ id, patch }) =>
          sb.from(TABELA_RESCISAO).update({ ...patch, atualizado_por: quemSou || null }).eq("id", id)));
        const erro = lote.find((r) => r.error)?.error;
        if (erro) throw erro;
      }
      toast.success(`Importação concluída: ${inserir.length} nova(s), ${plano.atualizar.length} atualizada(s).`);
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
          Lê as abas de rescisão do Excel do RH (RESCISÕES e HOMOLOGAÇÃO). Cada linha entra uma vez só: a que já
          está no sistema é ATUALIZADA com o que a planilha preenche (status, datas, tipo, envio/retorno…) — o que a
          planilha deixa vazio não apaga nada daqui, e a observação do sistema fica. A linha cuja data mudou no
          Excel é reconhecida pela pessoa (empresa, matrícula e nome), sem duplicar. Quando a linha é de uma
          solicitação do ERP (mesma matrícula ou mesmo nome), ela vira a ficha daquela solicitação.
        </p>
        <input ref={arquivo} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(ev) => { const f = ev.target.files?.[0]; if (f) ler(f); ev.target.value = ""; }} />
        <Button variant="outline" onClick={() => arquivo.current?.click()} disabled={gravando}>
          <FileSpreadsheet className="mr-2 h-4 w-4" /> {lido ? `Trocar arquivo (${lido.nome})` : "Escolher o arquivo .xlsx"}
        </Button>
        {lido && plano && resumo && (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border p-3 text-sm">
            <p>
              <b>{lido.linhas.length}</b> linha(s) lidas
              {lido.abas.length > 0 && <> — {lido.abas.map((a) => `${a.aba}: ${a.linhas}`).join(" · ")}</>}.
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li><b>{plano.atualizar.length}</b> já no sistema, com o que mudar</li>
              <li><b>{plano.semMudanca}</b> já no sistema, iguais à planilha</li>
              <li><b>{plano.novasNoErp.length}</b> novas, ligadas a solicitações do ERP</li>
              <li><b>{plano.novasAvulsas.length}</b> novas, só da planilha</li>
              {plano.ambiguas.length > 0 && (
                <li className="text-amber-700">
                  <b>{plano.ambiguas.length}</b> ambígua(s) — a mesma pessoa tem mais de uma rescisão e a data não
                  desempata; ficam de fora (estão no relatório)
                </li>
              )}
            </ul>
            {resumo.status.length > 0 && (
              <div>
                <p className="font-medium">Status que mudam</p>
                <ul className="pl-5 text-muted-foreground">
                  {resumo.status.map(([k, n]) => <li key={k}>{k}: <b className="text-foreground">{n}</b></li>)}
                </ul>
              </div>
            )}
            {resumo.campos.length > 0 && (
              <p className="text-muted-foreground">
                Campos: {resumo.campos.map(([c, n]) => `${rotulo(c)} ${n}`).join(" · ")}
                {resumo.soLigacao > 0 && <> · {resumo.soLigacao} só ganham a linha original do Excel</>}
              </p>
            )}
            {(plano.atualizar.length > 0 || plano.ambiguas.length > 0) && (
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => baixarMudancas(plano)}>
                <Download className="mr-1 h-3.5 w-3.5" /> Baixar o que muda (com o valor de antes)
              </Button>
            )}
            {lido.avisos.map((a) => <p key={a} className="text-amber-700">{a}</p>)}
          </div>
        )}
        {progresso && <p className="text-sm text-muted-foreground">{progresso}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={gravando}>Fechar</Button>
          <Button onClick={importar}
            disabled={gravando || !plano || plano.novasAvulsas.length + plano.novasNoErp.length + plano.atualizar.length === 0}>
            {gravando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
