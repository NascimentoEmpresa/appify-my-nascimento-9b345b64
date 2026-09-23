import { useState } from "react";
import { db } from "./db";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ArrowRightLeft, Loader2, UserX } from "lucide-react";
import {
  SITUACAO, SITUACOES_CONCLUIDAS, SITUACOES_PRESIDENCIA,
  LABEL_CAUSA, LABEL_GRAVIDADE, LABEL_MEDIDA, LABEL_RECOMENDACAO, LABEL_RESULTADO,
  LABEL_SITUACAO, LABEL_TIPO, COR_GRAVIDADE, rotulo,
} from "./vocabulario";
import { type Denuncia, tipoEfetivo } from "./metricas";
import { BlocoAnexos, BlocoPresidencia, BlocoProvidencias } from "./BlocosApuracao";
import { HistoricoDenuncia } from "./HistoricoDenuncia";
import { fmtData, fmtDataHora } from "./dossie";

// =====================================================================
// FICHA DA PRESIDÊNCIA — o que a diretoria precisa para decidir, e só isso
//
// Não é a FichaDenuncia com campos desligados: a Presidência não apura, lê
// o que o Comitê concluiu, registra a decisão e dá seguimento ao caso. Por
// isso aqui só há duas escritas — a decisão (BlocoPresidencia, a mesma da
// ficha do Comitê) e a mudança de situação. O banco confere as duas: a
// decisão exige `comite_etica_presidencia` (canal_denuncia_guard) e quem
// entra só pelo painel não altera outro campo
// (canal_denuncia_presidencia_guard, 20260930000217).
// =====================================================================

/** Situações para onde a Presidência devolve o caso ao Comitê. */
const SITUACOES_DEVOLUCAO = SITUACAO.filter((s) => !SITUACOES_PRESIDENCIA.includes(s.value));
const SITUACOES_PAINEL = SITUACAO.filter((s) => SITUACOES_PRESIDENCIA.includes(s.value));

export default function FichaPresidencia({ denuncia: d, podeDecidir, podeVerSigiloso, onFechar, onSalvo }: {
  denuncia: Denuncia | null;
  podeDecidir: boolean;
  podeVerSigiloso: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  if (!d) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{d.protocolo}</span>
            <Badge variant="outline" className="text-[10px] font-semibold">
              {rotulo(LABEL_SITUACAO, d.status)}
            </Badge>
            {d.gravidade && (
              <Badge variant="outline" className="text-[10px] font-semibold"
                     style={{ color: COR_GRAVIDADE[d.gravidade], borderColor: COR_GRAVIDADE[d.gravidade] }}>
                {rotulo(LABEL_GRAVIDADE, d.gravidade)}
              </Badge>
            )}
            {!d.identificado && (
              <Badge variant="outline" className="gap-1 text-[10px]"><UserX className="h-3 w-3" /> Anônima</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ------------------------------------------------- o caso */}
          <Bloco titulo="O caso" desc="Resumo do que foi apurado. O relato completo está logo abaixo.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Leitura label="Recebida em">{fmtDataHora(d.created_at)}</Leitura>
              <Leitura label="Tipo">{rotulo(LABEL_TIPO, tipoEfetivo(d))}</Leitura>
              <Leitura label="Empresa">{d.empresa_nome}</Leitura>
              <Leitura label="Contrato">{d.contrato || d.contrato_informado}</Leitura>
              <Leitura label="Setor">{d.setor}</Leitura>
              <Leitura label="Pessoa denunciada">{d.denunciado_nome || d.denunciado_informado}</Leitura>
              <Leitura label="Responsável pela apuração">{d.apuracao_responsavel}</Leitura>
              <Leitura label="Apuração">
                {d.apuracao_inicio || d.apuracao_fim
                  ? `${fmtData(d.apuracao_inicio)} a ${fmtData(d.apuracao_fim)}`
                  : null}
              </Leitura>
            </div>
            {d.resumo && <Leitura label="Resumo"><p className="whitespace-pre-wrap">{d.resumo}</p></Leitura>}
            <details className="rounded-md border bg-muted/30 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                Relato do denunciante
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm">{d.descricao || "—"}</p>
            </details>
          </Bloco>

          {/* -------------------------------------- parecer do Comitê */}
          <Bloco titulo="Parecer do Comitê" desc="O que a apuração concluiu e o que o Comitê recomenda.">
            <div className="grid gap-3 sm:grid-cols-3">
              <Leitura label="Recomendação">{d.recomendacao ? rotulo(LABEL_RECOMENDACAO, d.recomendacao) : null}</Leitura>
              <Leitura label="Resultado">{d.resultado ? rotulo(LABEL_RESULTADO, d.resultado) : null}</Leitura>
              <Leitura label="Causa raiz">{d.causa_raiz ? rotulo(LABEL_CAUSA, d.causa_raiz) : null}</Leitura>
              <Leitura label="Medidas propostas">
                {(d.medidas ?? []).length ? (d.medidas ?? []).map((m) => rotulo(LABEL_MEDIDA, m)).join(", ") : null}
              </Leitura>
              <Leitura label="Medida principal">{d.medida_principal}</Leitura>
            </div>
            {d.evidencias_analise && (
              <Leitura label="Análise das evidências"><p className="whitespace-pre-wrap">{d.evidencias_analise}</p></Leitura>
            )}
            <Leitura label="Fundamentação do parecer">
              {d.parecer_interno && <p className="whitespace-pre-wrap">{d.parecer_interno}</p>}
            </Leitura>
          </Bloco>

          {/* ------------------------------------ decisão da Presidência */}
          {/* A key zera o formulário quando a decisão gravada muda — o bloco
              guarda o rascunho em estado próprio, iniciado uma vez só. */}
          <Card className="border-primary/40 p-4">
            <BlocoPresidencia key={`${d.id}-${d.decisao_em ?? ""}`}
                              denuncia={d} podeDecidir={podeDecidir} onSalvo={onSalvo} />
          </Card>

          {/* -------------------------------------------- seguimento */}
          <Seguimento key={`${d.id}-${d.status}`} denuncia={d} onSalvo={onSalvo} />

          {/* -------------------------------------- procedimento (leitura) */}
          <Bloco titulo="Providências" desc="Passos da apuração e do cumprimento das medidas. Somente leitura.">
            <BlocoProvidencias denunciaId={d.id} podeEditar={false} />
          </Bloco>
          <Bloco titulo="Evidências e documentos" desc="Somente leitura.">
            <BlocoAnexos denunciaId={d.id} podeEditar={false} podeVerSigiloso={podeVerSigiloso} />
          </Bloco>
          <Bloco titulo="Histórico do procedimento" desc="Gravado pelo banco a cada alteração.">
            <HistoricoDenuncia denunciaId={d.id} />
          </Bloco>

          <div className="sticky bottom-0 flex justify-end border-t bg-background py-3">
            <Button variant="outline" onClick={onFechar}>Fechar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------ seguimento

/**
 * Troca de situação com justificativa. Grava na hora e só a situação: a
 * mesma regra da ficha do Comitê para `concluido_em` (a data é do PRIMEIRO
 * encerramento), e a justificativa vai junto porque o banco recusa sem ela.
 */
function Seguimento({ denuncia: d, onSalvo }: { denuncia: Denuncia; onSalvo: () => void }) {
  const { toast } = useToast();
  const [novo, setNovo] = useState(d.status);
  const [justificativa, setJustificativa] = useState("");
  const [salvando, setSalvando] = useState(false);

  const mudou = novo !== d.status;
  // Encerrar ou mandar cumprir sem decisão registrada é quase sempre
  // esquecimento — avisa, mas não trava: a decisão pode ter sido registrada
  // fora do sistema e o caso precisa andar.
  const semDecisao = mudou && !d.decisao_final
    && ["aguardando_cumprimento", "concluida", "arquivada"].includes(novo);

  const salvar = async () => {
    if (!justificativa.trim()) {
      toast({ title: "Falta a justificativa", description: "Diga por que a situação está mudando.", variant: "destructive" });
      return;
    }
    setSalvando(true);
    const vaiConcluir = SITUACOES_CONCLUIDAS.includes(novo);
    const { error } = await db.from("CANAL_DENUNCIA").update({
      status: novo,
      justificativa_mudanca: justificativa.trim(),
      concluido_em: vaiConcluir ? (d.concluido_em ?? new Date().toISOString()) : null,
    }).eq("id", d.id);
    setSalvando(false);
    if (error) { toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }); return; }
    toast({
      title: "Situação atualizada",
      description: `${d.protocolo} → ${rotulo(LABEL_SITUACAO, novo)}`,
    });
    onSalvo();
  };

  const Chip = ({ value, label }: { value: string; label: string }) => {
    const on = novo === value;
    return (
      <button
        type="button" onClick={() => setNovo(value)}
        className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
          on ? "border-primary bg-primary text-primary-foreground"
             : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
      >
        {label}
      </button>
    );
  };

  return (
    <Bloco titulo="Dar seguimento" desc="Muda a situação da denúncia — é o que o Comitê enxerga no submódulo Denúncias.">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Fase da Presidência
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SITUACOES_PAINEL.map((s) => <Chip key={s.value} {...s} />)}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Devolver ao Comitê
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SITUACOES_DEVOLUCAO.map((s) => <Chip key={s.value} {...s} />)}
        </div>
      </div>

      {mudou && (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
            <ArrowRightLeft className="h-3.5 w-3.5" />
            {rotulo(LABEL_SITUACAO, d.status)} → {rotulo(LABEL_SITUACAO, novo)}
          </p>
          {!SITUACOES_PRESIDENCIA.includes(novo) && (
            <p className="text-[11px] text-muted-foreground">
              O caso volta para o Comitê e sai deste painel até retornar a uma fase da Presidência.
            </p>
          )}
          {semDecisao && (
            <p className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> Ainda não há decisão registrada neste caso.
            </p>
          )}
          <Textarea
            rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Obrigatória. Ex.: decisão comunicada ao RH para aplicação da advertência."
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={salvando}
                    onClick={() => { setNovo(d.status); setJustificativa(""); }}>
              Cancelar
            </Button>
            <Button size="sm" onClick={salvar} disabled={salvando} className="gap-1.5">
              {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
              Atualizar situação
            </Button>
          </div>
        </div>
      )}
    </Bloco>
  );
}

// ------------------------------------------------------------- auxiliares
function Leitura({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="break-words text-sm [overflow-wrap:anywhere]">{children || "—"}</div>
    </div>
  );
}

function Bloco({ titulo, desc, children }: { titulo: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card className="space-y-3 border-primary/20 p-4">
      <div>
        <p className="text-sm font-bold">{titulo}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </Card>
  );
}
