import { useEffect, useMemo, useState } from "react";
import { db } from "./db";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { UserX, Search, Loader2, X, AlertTriangle, Clock, History } from "lucide-react";
import {
  ORIGEM, TIPO, GRAVIDADE, SIGILO, SITUACAO, RESULTADO, MEDIDA, RECURSO_RESULTADO, CAUSA_RAIZ,
  RECOMENDACAO,
  LABEL_SITUACAO, LABEL_TIPO, LABEL_RELACAO, LABEL_SIM_NAO, LABEL_GRAVIDADE,
  LABEL_FREQUENCIA, LABEL_CONTRATO_SIT,
  COR_GRAVIDADE, SITUACOES_CONCLUIDAS, rotulo, type Opcao,
} from "./vocabulario";
import {
  type Denuncia, type RegraSla, antecedentesDe, concluida, diasDeTratamento,
  diasRestantes, regraDe,
} from "./metricas";
import Conversa from "./Conversa";
import { usePermissoes } from "@/context/PermissoesContext";
import { BlocoAnexos, BlocoPresidencia, BlocoProvidencias } from "./BlocosApuracao";
import { ExportarDenuncia } from "./ExportarDenuncia";
import { HistoricoDenuncia } from "./HistoricoDenuncia";

// =====================================================================
// FICHA DE APURAÇÃO — o formulário que o Comitê de Ética preenche
//
// O bloco de cima é o relato, só leitura: o banco impede que ele mude
// (trigger canal_denuncia_guard), porque é a prova do que foi dito.
// Tudo daqui para baixo é a apuração, e é o que alimenta os indicadores.
//
// Os campos existem para responder pergunta de gestão, não para encher
// cadastro: sem `contrato`/`setor`/`lider_empregado_id` não há "qual
// contrato concentra risco"; sem `causa_raiz` não dá para separar falha de
// processo de desvio individual; sem `medidas` + `resultado` não se mede
// eficácia. Por isso a ficha avisa o que falta em vez de aceitar em branco
// calado — mas nunca bloqueia: apuração em andamento tem campo vazio mesmo.
// =====================================================================

/** Recorte de EMPREGADOS usado na busca de pessoas. */
interface EmpregadoBusca {
  ID: number; Nome: string; Setor_ERP: string | null; LIDER: string | null;
  "Descrição do Local": string | null; "Nome Filial": string | null; "Situação": string | null;
}

const COLS_EMP = '"ID","Nome","Setor_ERP","LIDER","Descrição do Local","Nome Filial","Situação"';

const fmt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/** timestamptz → 'YYYY-MM-DD' para <input type="date">. */
const soData = (s?: string | null) => (s ? String(s).slice(0, 10) : "");

/** Estado editável da ficha — espelha as colunas da tratativa. */
interface Ficha {
  titulo: string;
  origem: string; tipo_classificado: string; gravidade: string; sigilo: string;
  denunciado_nome: string; denunciado_empregado_id: number | null;
  lider_nome: string; lider_empregado_id: number | null;
  diretoria: string; contrato: string; setor: string; unidade: string; cidade: string;
  apuracao_responsavel: string; apuracao_responsavel_id: string;
  apuracao_inicio: string; apuracao_fim: string;
  primeira_providencia_em: string;
  resumo: string; pendencia_atual: string; evidencias_analise: string;
  medida_principal: string; recomendacao: string;
  /** Por que a situação mudou. O banco recusa a troca sem isto. */
  justificativa_mudanca: string;
  status: string; resultado: string; medidas: string[];
  houve_recurso: boolean; recurso_resultado: string; recurso_data: string;
  causa_raiz: string; causa_raiz_detalhe: string;
  acoes_preventivas: string; acoes_corretivas: string;
  sla_dias_override: string;
  parecer_interno: string; retorno_denunciante: string;
}

const daDenuncia = (d: Denuncia): Ficha => ({
  titulo: d.titulo ?? "",
  origem: d.origem ?? "canal_web",
  tipo_classificado: d.tipo_classificado ?? "",
  gravidade: d.gravidade ?? "", sigilo: d.sigilo ?? (d.identificado ? "identificada" : "sigilosa"),
  denunciado_nome: d.denunciado_nome ?? "", denunciado_empregado_id: d.denunciado_empregado_id ?? null,
  lider_nome: d.lider_nome ?? "", lider_empregado_id: d.lider_empregado_id ?? null,
  diretoria: d.diretoria ?? "", contrato: d.contrato ?? "", setor: d.setor ?? "",
  unidade: d.unidade ?? "", cidade: d.cidade ?? "",
  apuracao_responsavel: d.apuracao_responsavel ?? "",
  apuracao_responsavel_id: d.apuracao_responsavel_id ?? "",
  apuracao_inicio: soData(d.apuracao_inicio), apuracao_fim: soData(d.apuracao_fim),
  primeira_providencia_em: soData(d.primeira_providencia_em),
  resumo: d.resumo ?? "", pendencia_atual: d.pendencia_atual ?? "",
  evidencias_analise: d.evidencias_analise ?? "",
  medida_principal: d.medida_principal ?? "", recomendacao: d.recomendacao ?? "",
  // Nunca reaproveita a justificativa da mudança anterior: ela é sobre a
  // troca de agora, e herdar o texto velho seria assinar um motivo que não é.
  justificativa_mudanca: "",
  status: d.status ?? "nova", resultado: d.resultado ?? "", medidas: d.medidas ?? [],
  houve_recurso: !!d.houve_recurso, recurso_resultado: d.recurso_resultado ?? "",
  recurso_data: soData(d.recurso_data),
  causa_raiz: d.causa_raiz ?? "", causa_raiz_detalhe: d.causa_raiz_detalhe ?? "",
  acoes_preventivas: d.acoes_preventivas ?? "", acoes_corretivas: d.acoes_corretivas ?? "",
  sla_dias_override: d.sla_dias_override != null ? String(d.sla_dias_override) : "",
  parecer_interno: d.parecer_interno ?? "", retorno_denunciante: d.retorno_denunciante ?? "",
});

export default function FichaDenuncia({ denuncia, slas, todas, onFechar, onSalvo }: {
  denuncia: Denuncia | null; slas: RegraSla[];
  /** Base inteira — só para apurar os antecedentes deste caso. */
  todas: Denuncia[];
  onFechar: () => void; onSalvo: () => void;
}) {
  const { toast } = useToast();
  const { can } = usePermissoes();
  const [salvando, setSalvando] = useState(false);
  const [f, setF] = useState<Ficha>(() => (denuncia ? daDenuncia(denuncia) : ({} as Ficha)));

  // As duas capacidades novas do módulo. Isto aqui é heurística de tela —
  // quem recusa de verdade é a RLS e o gatilho no banco.
  const podeDecidir = can("visualizar", undefined, "comite_etica_presidencia");
  const podeVerSigiloso = can("visualizar", undefined, "comite_etica_sigilo");

  // Cadastro de quem pode conduzir uma apuração.
  const [responsaveis, setResponsaveis] = useState<{ user_id: string; nome: string }[]>([]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await db.from("COMITE_ETICA_RESPONSAVEL")
        .select("user_id, nome").eq("ativo", true).order("nome");
      if (vivo) setResponsaveis((data ?? []) as { user_id: string; nome: string }[]);
    })();
    return () => { vivo = false; };
  }, []);

  // Recarrega quando troca a denúncia aberta (o diálogo é reaproveitado).
  const chave = denuncia?.id ?? "";
  const [ultima, setUltima] = useState(chave);
  if (chave !== ultima) { setUltima(chave); setF(denuncia ? daDenuncia(denuncia) : ({} as Ficha)); }

  const set = <K extends keyof Ficha>(k: K, v: Ficha[K]) => setF((c) => ({ ...c, [k]: v }));

  const vaiConcluir = SITUACOES_CONCLUIDAS.includes(f.status);

  /** Campos sem os quais um indicador específico deixa de existir.
   *  Fica ANTES do `return null` de propósito: hook depois de saída
   *  antecipada muda a ordem dos hooks entre renders e quebra o React. */
  const lacunas = useMemo(() => {
    const l: string[] = [];
    if (!f.gravidade) l.push("Gravidade (define o prazo de SLA do caso)");
    if (!f.contrato) l.push("Contrato (indicador de risco por contrato)");
    if (!f.setor) l.push("Setor (ranking de setores)");
    if (!f.lider_nome) l.push("Líder imediato (concentração por liderança)");
    if (!f.primeira_providencia_em) l.push("Data da primeira providência (tempo de resposta)");
    if (vaiConcluir && !f.resultado) l.push("Resultado (procedente / improcedente)");
    if (vaiConcluir && !f.causa_raiz) l.push("Causa raiz (padrões de processo x comportamento)");
    if (vaiConcluir && !(f.medidas ?? []).length) l.push("Medidas (mesmo que 'Nenhuma medida')");
    return l;
  }, [f, vaiConcluir]);

  /** Reincidência vista de dentro do processo. Usa o que já está vinculado
   *  na ficha (estado `f`), não o que veio do banco — assim o histórico
   *  aparece assim que o comitê vincula o denunciado, sem salvar antes. */
  const antecedentes = useMemo(
    () => (denuncia
      ? antecedentesDe({
          ...denuncia,
          denunciado_empregado_id: f.denunciado_empregado_id,
          lider_empregado_id: f.lider_empregado_id,
          setor: f.setor, contrato: f.contrato,
        }, todas)
      : []),
    [denuncia, todas, f.denunciado_empregado_id, f.lider_empregado_id, f.setor, f.contrato]);

  if (!denuncia) return null;
  const d = denuncia;
  const mudouSituacao = f.status !== d.status;

  const salvar = async () => {
    if (salvando) return;
    // O banco recusa a troca de situação sem justificativa (canal_denuncia_guard).
    // Barrar aqui também é só cortesia: assim a pessoa vê o pedido no campo em
    // vez de um erro de Postgres depois de preencher a ficha inteira.
    if (mudouSituacao && !f.justificativa_mudanca.trim()) {
      toast({
        title: "Falta a justificativa",
        description: "Diga por que a situação mudou — é o que o histórico vai guardar.",
        variant: "destructive",
      });
      return;
    }
    setSalvando(true);
    const nulo = (s: string) => (s.trim() ? s.trim() : null);
    const { error } = await db.from("CANAL_DENUNCIA").update({
      resumo: nulo(f.resumo),
      pendencia_atual: nulo(f.pendencia_atual),
      evidencias_analise: nulo(f.evidencias_analise),
      medida_principal: nulo(f.medida_principal),
      recomendacao: nulo(f.recomendacao),
      justificativa_mudanca: mudouSituacao ? f.justificativa_mudanca.trim() : d.justificativa_mudanca,
      titulo: nulo(f.titulo),
      origem: nulo(f.origem),
      tipo_classificado: nulo(f.tipo_classificado),
      gravidade: nulo(f.gravidade),
      sigilo: nulo(f.sigilo),
      denunciado_nome: nulo(f.denunciado_nome),
      denunciado_empregado_id: f.denunciado_empregado_id,
      lider_nome: nulo(f.lider_nome),
      lider_empregado_id: f.lider_empregado_id,
      diretoria: nulo(f.diretoria), contrato: nulo(f.contrato), setor: nulo(f.setor),
      unidade: nulo(f.unidade), cidade: nulo(f.cidade),
      apuracao_responsavel: nulo(f.apuracao_responsavel),
      apuracao_responsavel_id: f.apuracao_responsavel_id || null,
      apuracao_inicio: nulo(f.apuracao_inicio), apuracao_fim: nulo(f.apuracao_fim),
      primeira_providencia_em: nulo(f.primeira_providencia_em),
      status: f.status,
      resultado: nulo(f.resultado),
      medidas: f.medidas ?? [],
      houve_recurso: f.houve_recurso,
      // Sem recurso, o que sobrou preenchido não pode ir para o banco: viraria
      // um "recurso reformado" fantasma no indicador.
      recurso_resultado: f.houve_recurso ? nulo(f.recurso_resultado) : null,
      recurso_data: f.houve_recurso ? nulo(f.recurso_data) : null,
      causa_raiz: nulo(f.causa_raiz), causa_raiz_detalhe: nulo(f.causa_raiz_detalhe),
      acoes_preventivas: nulo(f.acoes_preventivas), acoes_corretivas: nulo(f.acoes_corretivas),
      sla_dias_override: f.sla_dias_override.trim() ? Number(f.sla_dias_override) : null,
      parecer_interno: nulo(f.parecer_interno),
      retorno_denunciante: nulo(f.retorno_denunciante),
      // A data de conclusão é do PRIMEIRO encerramento: reabrir e fechar de
      // novo não pode reiniciar o cronômetro do SLA.
      concluido_em: vaiConcluir ? (d.concluido_em ?? new Date().toISOString()) : null,
    }).eq("id", d.id);
    setSalvando(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ficha salva", description: `Protocolo ${d.protocolo}` });
    onSalvo();
  };

  const regra = regraDe({ ...d, gravidade: f.gravidade || null, sla_dias_override: f.sla_dias_override ? Number(f.sla_dias_override) : null }, slas);
  const restam = diasRestantes({ ...d, status: f.status }, slas);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{d.protocolo}</span>
            <Badge variant="outline" className="text-[10px] font-semibold">
              {rotulo(LABEL_SITUACAO, f.status)}
            </Badge>
            {f.gravidade && (
              <Badge variant="outline" className="text-[10px] font-semibold"
                     style={{ color: COR_GRAVIDADE[f.gravidade], borderColor: COR_GRAVIDADE[f.gravidade] }}>
                {rotulo(LABEL_GRAVIDADE, f.gravidade)}
              </Badge>
            )}
            {!d.identificado && (
              <Badge variant="outline" className="gap-1 text-[10px]"><UserX className="h-3 w-3" /> Anônima</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ------------------------------------------ situação (no topo) */}
          {/* Mudar a situação é a ação mais frequente da ficha: fica antes de
              tudo, como régua clicável, em vez de um select no meio do
              formulário. A ordem das etapas é a mesma do acompanhamento que
              o denunciante enxerga. */}
          <Card className="p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Situação do processo
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SITUACAO.map((s) => {
                const on = f.status === s.value;
                return (
                  <button
                    key={s.value} type="button" onClick={() => set("status", s.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                      on ? "border-primary bg-primary text-primary-foreground"
                         : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            {/* O salvar continua sendo um só, no rodapé: trocar a situação sem
                gravar o resto da ficha deixaria os dois em desacordo. */}
            {mudouSituacao && (
              <div className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3">
                <p className="mb-2 text-[11px] font-semibold text-warning">
                  Alterando para “{rotulo(LABEL_SITUACAO, f.status)}” — salve a ficha para valer.
                </p>
                <Campo
                  label="Justificativa da mudança"
                  dica="Obrigatória. É o que o histórico guarda junto com a data, a hora e o seu nome — e é o que explica, meses depois, por que o caso parou aqui."
                >
                  <Textarea
                    rows={2}
                    value={f.justificativa_mudanca}
                    onChange={(e) => set("justificativa_mudanca", e.target.value)}
                    placeholder="Ex.: aguardando documentos solicitados ao RH do contrato."
                  />
                </Campo>
              </div>
            )}
          </Card>

          {/* ---------------------------------------------- prazo do caso */}
          <Card className={`flex flex-wrap items-center gap-3 p-3 ${
            restam !== null && restam < 0 ? "border-destructive/40 bg-destructive/5" : ""}`}>
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs">
              <b>{diasDeTratamento(d)} dias</b> desde o registro · prazo de <b>{regra.dias} dias</b>
              {f.gravidade ? ` (gravidade ${rotulo(LABEL_GRAVIDADE, f.gravidade).toLowerCase()})` : " (padrão — sem gravidade definida)"}
              {restam !== null && (restam < 0
                ? <span className="font-bold text-destructive"> · vencido há {Math.abs(restam)} dias</span>
                : <span className="text-muted-foreground"> · restam {restam} dias</span>)}
              {concluida(d) && <span className="text-muted-foreground"> · concluída em {fmt(d.concluido_em)}</span>}
            </p>
          </Card>

          {/* -------------------------------------------- reincidência */}
          {/* Aparece antes do relato de propósito: saber que o denunciado já
              respondeu a outros casos muda como a apuração é conduzida. */}
          {antecedentes.length > 0 && (
            <Card className="border-warning/40 bg-warning/5 p-3">
              <p className="flex items-center gap-2 text-xs font-bold text-warning">
                <History className="h-3.5 w-3.5" /> Há ocorrências anteriores ligadas a este caso
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {antecedentes.map((a) => (
                  <span key={a.rotulo} className="rounded-md border bg-background px-2.5 py-1 text-xs">
                    <b>{a.rotulo}:</b> {a.total} caso(s) antes deste
                    {a.procedentes > 0 && <span className="text-destructive"> · {a.procedentes} procedente(s)</span>}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* ------------------------------------------- relato (imutável) */}
          <Card className="space-y-3 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Relato recebido · somente leitura
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Leitura label="Recebida em">{fmt(d.created_at)}</Leitura>
              <Leitura label="Empresa">{d.empresa_nome}</Leitura>
              <Leitura label="Contrato informado">
                {d.contrato_informado
                  || (d.contrato_situacao ? rotulo(LABEL_CONTRATO_SIT, d.contrato_situacao) : null)}
              </Leitura>
              <Leitura label="Tipo informado pelo denunciante">{rotulo(LABEL_TIPO, d.tipo_denuncia)}</Leitura>
              <Leitura label="Relação com o grupo">{rotulo(LABEL_RELACAO, d.relacao)}</Leitura>
              <Leitura label="Quando aconteceu">
                {d.ocorrencia_data
                  ? `${fmt(d.ocorrencia_data)}${d.ocorrencia_hora ? ` às ${d.ocorrencia_hora}` : ""}`
                  : null}
              </Leitura>
              <Leitura label="Frequência">
                {d.ocorrencia_frequencia ? rotulo(LABEL_FREQUENCIA, d.ocorrencia_frequencia) : null}
              </Leitura>
              <Leitura label="Local do fato">{d.local_ocorrencia}</Leitura>
              <Leitura label="Como soube">{d.como_soube}</Leitura>
              <Leitura label="Pessoa denunciada (segundo o denunciante)">
                {d.denunciado_informado
                  ? `${d.denunciado_informado}${d.denunciado_funcao ? ` — ${d.denunciado_funcao}` : ""}`
                  : null}
              </Leitura>
              <Leitura label="Valor envolvido">{d.valor_financeiro}</Leitura>
            </div>
            {(d.risco_imediato || d.retaliacao) && (
              <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                {d.risco_imediato && (
                  <p className="text-sm">
                    <b className="text-destructive">Risco imediato informado.</b>{" "}
                    {d.risco_imediato_detalhe}
                  </p>
                )}
                {d.retaliacao && (
                  <p className="text-sm">
                    <b className="text-destructive">Ameaça ou retaliação informada.</b>{" "}
                    {d.retaliacao_detalhe}
                  </p>
                )}
              </div>
            )}
            {d.anonimo ? (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Relato anônimo. O canal não guarda identidade, IP nem qualquer dado que leve a quem
                denunciou — a pessoa acompanha o caso pelo protocolo e pela senha que escolheu.
              </p>
            ) : d.identidade_restrita ? (
              <p className="border-t pt-3 text-xs text-warning">
                A pessoa se identificou, mas o seu acesso não inclui ver a identificação. Isso exige a
                liberação de “Pode ver identidade e anexos sigilosos”.
              </p>
            ) : d.identificado ? (
              <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
                <Leitura label="Denunciante">{d.nome_completo}</Leitura>
                <Leitura label="CPF">{d.cpf}</Leitura>
                <Leitura label="E-mail">{d.email}</Leitura>
                <Leitura label="Telefone">{d.telefone_fixo}</Leitura>
                <Leitura label="Celular">{d.celular}</Leitura>
              </div>
            ) : (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                A pessoa optou por não dizer o nome, mas deixou e-mail para acompanhar o caso.
              </p>
            )}
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
              <Leitura label="Liderança ciente">
                {rotulo(LABEL_SIM_NAO, d.lideranca_ciente)}
                {d.lideranca_ciente_quem && <p className="mt-1 text-xs text-muted-foreground">{d.lideranca_ciente_quem}</p>}
              </Leitura>
              <Leitura label="Liderança envolvida">
                {rotulo(LABEL_SIM_NAO, d.lideranca_envolvida)}
                {d.lideranca_envolvida_quem && <p className="mt-1 text-xs text-muted-foreground">{d.lideranca_envolvida_quem}</p>}
              </Leitura>
              <Leitura label="Liderança tentou esconder">
                {rotulo(LABEL_SIM_NAO, d.lideranca_ocultou)}
                {d.lideranca_ocultou_quem && <p className="mt-1 text-xs text-muted-foreground">{d.lideranca_ocultou_quem}</p>}
              </Leitura>
            </div>
            <div className="space-y-3 border-t pt-3">
              <Leitura label="Relato"><p className="whitespace-pre-wrap">{d.descricao}</p></Leitura>
              <Leitura label="Testemunhas"><p className="whitespace-pre-wrap">{d.testemunhas}</p></Leitura>
              <Leitura label="Evidências"><p className="whitespace-pre-wrap">{d.evidencias}</p></Leitura>
              <Leitura label="Sugestão do denunciante"><p className="whitespace-pre-wrap">{d.sugestao}</p></Leitura>
            </div>
          </Card>

          {/* ------------------------------------------------ classificação */}
          <Bloco titulo="Classificação" desc="Como o comitê enquadra o caso — é esta leitura que vale no indicador.">
            <Campo label="Assunto do relato" dica="Título curto para identificar o caso na lista. O relato em si continua imutável.">
              <Input value={f.titulo} onChange={(e) => set("titulo", e.target.value)}
                     placeholder="Ex.: Assédio moral — contrato SMED" />
            </Campo>
            <Campo
              label="Resumo objetivo"
              dica="Diferente do assunto: é o parágrafo que vai no relatório e no resumo gerencial, contando o caso para quem não leu o relato."
            >
              <Textarea rows={3} value={f.resumo} onChange={(e) => set("resumo", e.target.value)}
                        placeholder="O que aconteceu, quem está envolvido e o que está em apuração." />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo label="Origem"><Sel v={f.origem} on={(v) => set("origem", v)} ops={ORIGEM} /></Campo>
              <Campo label="Tipo (comitê)" dica="Vazio = mantém o tipo escolhido pelo denunciante.">
                <Sel v={f.tipo_classificado} on={(v) => set("tipo_classificado", v)} ops={TIPO} vazio="Manter o informado" />
              </Campo>
              <Campo label="Gravidade" dica="Define o prazo de SLA.">
                <Sel v={f.gravidade} on={(v) => set("gravidade", v)} ops={GRAVIDADE} />
              </Campo>
              <Campo label="Sigilo"><Sel v={f.sigilo} on={(v) => set("sigilo", v)} ops={SIGILO} /></Campo>
            </div>
          </Bloco>

          {/* ------------------------------------------------------ pessoas */}
          <Bloco titulo="Pessoas e lotação" desc="Vincular ao cadastro do RH é o que permite medir reincidência e concentração por líder.">
            <div className="grid gap-3 sm:grid-cols-2">
              <BuscaEmpregado
                label="Denunciado" nome={f.denunciado_nome} id={f.denunciado_empregado_id}
                onNome={(v) => set("denunciado_nome", v)}
                onEscolher={(e) => {
                  set("denunciado_nome", e?.Nome ?? "");
                  set("denunciado_empregado_id", e?.ID ?? null);
                  // Puxa a lotação do próprio cadastro: digitar à mão é onde
                  // "Limpeza" e "LIMPEZA " viram dois setores no gráfico.
                  if (e) {
                    if (e.Setor_ERP) set("setor", e.Setor_ERP);
                    if (e["Descrição do Local"]) set("contrato", e["Descrição do Local"]!);
                    if (e["Nome Filial"]) set("unidade", e["Nome Filial"]!);
                  }
                }}
              />
              <BuscaEmpregado
                label="Líder imediato" nome={f.lider_nome} id={f.lider_empregado_id}
                onNome={(v) => set("lider_nome", v)}
                onEscolher={(e) => { set("lider_nome", e?.Nome ?? ""); set("lider_empregado_id", e?.ID ?? null); }}
              />
              <Campo label="Diretoria"><Input value={f.diretoria} onChange={(e) => set("diretoria", e.target.value)} /></Campo>
              <Campo label="Contrato"><Input value={f.contrato} onChange={(e) => set("contrato", e.target.value)} placeholder="Ex.: SMED" /></Campo>
              <Campo label="Setor"><Input value={f.setor} onChange={(e) => set("setor", e.target.value)} /></Campo>
              <Campo label="Unidade / Filial"><Input value={f.unidade} onChange={(e) => set("unidade", e.target.value)} /></Campo>
              <Campo label="Cidade"><Input value={f.cidade} onChange={(e) => set("cidade", e.target.value)} /></Campo>
            </div>
          </Bloco>

          {/* -------------------------------------------------- investigação */}
          <Bloco titulo="Investigação" desc="Responsável e datas da apuração.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo
                label="Responsável pela apuração"
                dica={responsaveis.length
                  ? "Sai do cadastro do Comitê — é o que faz o mesmo nome não virar dois responsáveis no relatório."
                  : "Nenhum responsável cadastrado ainda. Cadastre em Comitê de Ética › Configuração."}
              >
                <Sel
                  v={f.apuracao_responsavel_id}
                  on={(v) => {
                    // Grava o id E o nome: o id serve ao filtro e ao alerta; o
                    // nome é retrato do momento, porque quem sai do cadastro
                    // não pode sumir do procedimento que conduziu.
                    const r = responsaveis.find((x) => x.user_id === v);
                    set("apuracao_responsavel_id", v);
                    set("apuracao_responsavel", r?.nome ?? "");
                  }}
                  ops={responsaveis.map((r) => ({ value: r.user_id, label: r.nome }))}
                  vazio="Não designado"
                />
              </Campo>
              <Campo label="Primeira providência" dica="Quando o comitê agiu pela 1ª vez.">
                <Input type="date" value={f.primeira_providencia_em} onChange={(e) => set("primeira_providencia_em", e.target.value)} />
              </Campo>
              <Campo label="Início da apuração">
                <Input type="date" value={f.apuracao_inicio} onChange={(e) => set("apuracao_inicio", e.target.value)} />
              </Campo>
              <Campo label="Conclusão da apuração">
                <Input type="date" value={f.apuracao_fim} onChange={(e) => set("apuracao_fim", e.target.value)} />
              </Campo>
              {/* Situação não se repete aqui: mora na régua do topo. Dois
                  controles para o mesmo campo é convite para desencontro. */}
              <Campo label="Prazo específico (dias)" dica={`Vazio = ${regra.dias} dias pela gravidade.`}>
                <Input type="number" min={1} value={f.sla_dias_override}
                       onChange={(e) => set("sla_dias_override", e.target.value)} placeholder="—" />
              </Campo>
            </div>
            <Campo label="Pendência atual" dica="O que este procedimento está esperando agora. É o que o painel mostra quando alguém pergunta “por que isto não anda?”.">
              <Input value={f.pendencia_atual} onChange={(e) => set("pendencia_atual", e.target.value)}
                     placeholder="Ex.: aguardando a folha de ponto do contrato." />
            </Campo>
            <Campo label="Evidências recebidas e analisadas" dica="O que foi examinado e o que isso mostrou. Os arquivos ficam no bloco de anexos.">
              <Textarea rows={2} value={f.evidencias_analise}
                        onChange={(e) => set("evidencias_analise", e.target.value)} />
            </Campo>
          </Bloco>

          {/* ------------------------------------------------ providências */}
          <Bloco titulo="Providências" desc="Cada passo da apuração, com prazo e responsável. Grava na hora — não espera o “Salvar ficha”.">
            <BlocoProvidencias denunciaId={d.id} podeEditar />
          </Bloco>

          {/* ----------------------------------------------------- anexos */}
          <Bloco titulo="Evidências e documentos" desc="Os arquivos do procedimento. O que veio com o relato não pode ser excluído.">
            <BlocoAnexos denunciaId={d.id} podeEditar podeVerSigiloso={podeVerSigiloso} />
          </Bloco>

          {/* ------------------------------------------------------ desfecho */}
          <Bloco titulo="Resultado e medidas" desc="O que a apuração concluiu e o que foi feito a respeito.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Resultado"><Sel v={f.resultado} on={(v) => set("resultado", v)} ops={RESULTADO} /></Campo>
              <Campo label="Causa raiz" dica="Separa falha de processo de desvio individual.">
                <Sel v={f.causa_raiz} on={(v) => set("causa_raiz", v)} ops={CAUSA_RAIZ} />
              </Campo>
            </div>
            <Campo label="Detalhe da causa raiz">
              <Input value={f.causa_raiz_detalhe} onChange={(e) => set("causa_raiz_detalhe", e.target.value)} />
            </Campo>
            <Campo label="Medidas aplicadas" dica="Pode marcar mais de uma.">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {MEDIDA.map((m) => {
                  const on = (f.medidas ?? []).includes(m.value);
                  return (
                    <label key={m.value} className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(c) => {
                          const atuais = f.medidas ?? [];
                          if (c) {
                            // "Nenhuma medida" é excludente: marcá-la junto de
                            // uma advertência inflaria o indicador dos dois lados.
                            set("medidas", m.value === "nenhuma" ? ["nenhuma"] : [...atuais.filter((x) => x !== "nenhuma"), m.value]);
                          } else {
                            set("medidas", atuais.filter((x) => x !== m.value));
                          }
                        }}
                      />
                      {m.label}
                    </label>
                  );
                })}
              </div>
            </Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Medida principal" dica="Entre as marcadas acima, a que responde pelo caso. É ela que vai no relatório e no indicador de eficácia.">
                <Sel v={f.medida_principal} on={(v) => set("medida_principal", v)}
                     ops={MEDIDA.filter((m) => (f.medidas ?? []).includes(m.value))}
                     vazio={(f.medidas ?? []).length ? "Não definida" : "Marque as medidas primeiro"} />
              </Campo>
              <Campo label="Recomendação do Comitê" dica="O que o Comitê propõe à Presidência.">
                <Sel v={f.recomendacao} on={(v) => set("recomendacao", v)} ops={RECOMENDACAO} />
              </Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Ações corretivas" dica="O que foi feito sobre o que já aconteceu.">
                <Textarea rows={3} value={f.acoes_corretivas} onChange={(e) => set("acoes_corretivas", e.target.value)} />
              </Campo>
              <Campo label="Ações preventivas" dica="O que evita a repetição.">
                <Textarea rows={3} value={f.acoes_preventivas} onChange={(e) => set("acoes_preventivas", e.target.value)} />
              </Campo>
            </div>
          </Bloco>

          {/* ------------------------------------------------- presidência */}
          <Bloco
            titulo="Decisão da Presidência"
            desc={podeDecidir
              ? "Registra na hora. A data, o autor e o nome são carimbados pelo banco."
              : "Somente quem tem a capacidade da Presidência registra aqui."}
          >
            <BlocoPresidencia denuncia={d} podeDecidir={podeDecidir} onSalvo={onSalvo} />
          </Bloco>

          {/* ------------------------------------------------------- recurso */}
          <Bloco titulo="Recurso" desc="Se a decisão foi contestada.">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={f.houve_recurso} onCheckedChange={(c) => set("houve_recurso", !!c)} />
              Houve recurso da decisão
            </label>
            {f.houve_recurso && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Resultado do recurso">
                  <Sel v={f.recurso_resultado} on={(v) => set("recurso_resultado", v)} ops={RECURSO_RESULTADO} />
                </Campo>
                <Campo label="Data do recurso">
                  <Input type="date" value={f.recurso_data} onChange={(e) => set("recurso_data", e.target.value)} />
                </Campo>
              </div>
            )}
          </Bloco>

          {/* --------------------------------------------------- interação */}
          <Conversa denunciaId={d.id} protocolo={d.protocolo} />

          {/* --------------------------------------------- parecer e retorno */}
          <Bloco titulo="Parecer e retorno" desc="O parecer é interno; o retorno é o que o denunciante lê.">
            <Campo label="Parecer interno" dica="Só o comitê vê.">
              <Textarea rows={3} value={f.parecer_interno} onChange={(e) => set("parecer_interno", e.target.value)}
                        placeholder="Apuração, decisões, encaminhamentos…" />
            </Campo>
            <Campo label="Retorno ao denunciante" dica="Aparece na consulta por protocolo — é o único texto que sai daqui.">
              <Textarea rows={3} value={f.retorno_denunciante} onChange={(e) => set("retorno_denunciante", e.target.value)}
                        placeholder="O que a pessoa vê ao consultar o protocolo dela." />
            </Campo>
          </Bloco>

          {/* ------------------------------------------------- histórico */}
          <Bloco
            titulo="Histórico do procedimento"
            desc="Gravado pelo banco a cada alteração — não é digitado, e não há como editá-lo pela aplicação."
          >
            <HistoricoDenuncia denunciaId={d.id} />
          </Bloco>

          {/* ------------------------------------------------- exportação */}
          <Bloco
            titulo="Exportar o procedimento"
            desc="O PDF sai em ordem cronológica; o Excel é a base gerencial; o resumo vai para a planilha de controle."
          >
            <ExportarDenuncia denunciaId={d.id} />
          </Bloco>

          {/* Lacunas: avisa, nunca bloqueia — caso em andamento tem campo vazio. */}
          {lacunas.length > 0 && (
            <Card className="border-warning/40 bg-warning/5 p-3">
              <p className="flex items-center gap-2 text-xs font-bold text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                Sem estes campos, alguns indicadores ficam sem este caso:
              </p>
              <ul className="mt-1.5 list-inside list-disc text-xs text-muted-foreground">
                {lacunas.map((l) => <li key={l}>{l}</li>)}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Pode salvar assim mesmo — apuração em andamento tem campo em branco.
              </p>
            </Card>
          )}

          <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background py-3">
            <Button variant="outline" onClick={onFechar} disabled={salvando}>Fechar</Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Salvando…</> : "Salvar ficha"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {children}
      {dica && <p className="mt-1 text-[11px] text-muted-foreground">{dica}</p>}
    </div>
  );
}

/**
 * Select com opção de limpar. O Radix não aceita SelectItem de valor "",
 * então o vazio vai como sentinela `__`, traduzida nas duas pontas.
 */
function Sel({ v, on, ops, vazio = "Não informado", semVazio = false }: {
  v: string; on: (v: string) => void; ops: Opcao[]; vazio?: string; semVazio?: boolean;
}) {
  return (
    <Select value={v || "__"} onValueChange={(x) => on(x === "__" ? "" : x)}>
      <SelectTrigger><SelectValue placeholder={vazio} /></SelectTrigger>
      <SelectContent>
        {!semVazio && <SelectItem value="__">{vazio}</SelectItem>}
        {ops.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * Busca no cadastro do RH. Aceita nome livre (terceirizado, fornecedor e
 * ex-colaborador não estão em EMPREGADOS), mas quando dá para vincular, o
 * id é o que sustenta a contagem de reincidência.
 */
function BuscaEmpregado({ label, nome, id, onNome, onEscolher }: {
  label: string; nome: string; id: number | null;
  onNome: (v: string) => void;
  onEscolher: (e: EmpregadoBusca | null) => void;
}) {
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [itens, setItens] = useState<EmpregadoBusca[]>([]);

  useEffect(() => {
    const t = termo.trim();
    if (t.length < 3) { setItens([]); return; }
    // Debounce: sem isso cada tecla vira um SELECT no cadastro inteiro.
    let vivo = true;
    const tm = setTimeout(async () => {
      setCarregando(true);
      const { data } = await db
        .from("EMPREGADOS").select(COLS_EMP).ilike("Nome", `%${t}%`).limit(12);
      if (!vivo) return;
      setCarregando(false);
      setItens((data ?? []) as EmpregadoBusca[]);
    }, 300);
    return () => { vivo = false; clearTimeout(tm); };
  }, [termo]);

  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {id ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{nome}</span>
          <Badge variant="outline" className="shrink-0 text-[10px]">RH #{id}</Badge>
          <Button variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0"
                  onClick={() => { onEscolher(null); setTermo(""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8" value={nome}
              placeholder="Nome — digite 3 letras para buscar no RH"
              onChange={(e) => { onNome(e.target.value); setTermo(e.target.value); setAberto(true); }}
              onFocus={() => setAberto(true)}
              onBlur={() => setTimeout(() => setAberto(false), 150)}
            />
          </div>
          {aberto && termo.trim().length >= 3 && (
            <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
              {carregando && <p className="p-3 text-xs text-muted-foreground">Buscando…</p>}
              {!carregando && itens.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">
                  Ninguém com esse nome no RH. Pode deixar o texto livre.
                </p>
              )}
              {itens.map((e) => (
                <button
                  key={e.ID} type="button"
                  className="block w-full px-3 py-2 text-left hover:bg-accent"
                  onMouseDown={(ev) => { ev.preventDefault(); onEscolher(e); setTermo(""); setAberto(false); }}
                >
                  <span className="block truncate text-sm font-medium">{e.Nome}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[e.Setor_ERP, e["Descrição do Local"], e["Nome Filial"], e["Situação"]]
                      .filter(Boolean).join(" · ") || "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
