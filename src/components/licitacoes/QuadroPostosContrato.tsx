// QUADRO DE POSTOS DO CONTRATO — a seção do formulário "Novo Contrato" onde
// se declara quantas pessoas o contrato exige, por posto e por função.
//
// A cascata é a MESMA do Catálogo de Materiais, de propósito: contrato →
// posto → função. É a cascata que o encarregado já conhece, e é dela que sai
// o enxoval de uniforme/EPI da admissão.
//
//   BENTO GONÇALVES LIMPEZA 048/2026
//     ├── BLOCO CIRURGICO  → SERVENTE DE LIMPEZA ....  4 pessoas
//     ├── LAVANDERIA       → SERVENTE DE LIMPEZA ....  2 pessoas
//     └── UPA 24 H         → SERVENTE DE LIMPEZA .... 10 pessoas
//
// A QUANTIDADE PENDURA NA FUNÇÃO, não no posto: um posto pode ter mais de
// uma função, e "quantas pessoas" só faz sentido perguntado da função. Cada
// pessoa vira uma solicitação de vaga no Recrutamento (uma por pessoa — ver
// o comentário da migration 20260930000238 sobre por que não é uma vaga com
// quantidade 10), já com salário, benefícios, escala e local preenchidos, e
// levando `posto_id` e `funcao_id` para a admissão saber o enxoval.
//
// POSTO e FUNÇÃO vêm do catálogo do contrato quando já existem, e podem ser
// digitados quando não existem — contrato recém-ganho normalmente ainda não
// teve a Planilha de Custo importada, e é justamente aí que as vagas precisam
// abrir. Quem grava é a RPC `contrato_quadro_salvar`: a tela nunca escreve em
// sup_posto direto (a policy de escrita não existe desde a migration
// 20260930000081), e função nova nasce aguardando aprovação, entrando no
// mesmo lote do Catálogo — não aprovada por fora.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Users, ChevronDown, ChevronUp, Sparkles, TriangleAlert, Link2, CopyPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePostos, useFuncoesDoContrato } from "@/hooks/useSupCatalogo";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import { MOTIVOS_VAGA, dataMinimaVaga, fmtBr } from "@/lib/recrutamento/vagaRegras";
import { buscarCustoDoPosto, beneficiosDoCusto, insalubridadeDoCusto } from "@/lib/recrutamento/custoPosto";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  type LinhaQuadroForm, LINHA_VAZIA, faltamNaLinha, erroDaLinha, rotuloDaLinha,
  totalDeColaboradores, totalDePostos, totalDeFuncoes, totalDeVagas, totalSalarialMensal,
  brl, paraInteiro, paraNumero, chavePosto, linhaEmUso,
  paresDoCatalogo, mesclarComCatalogo,
} from "@/lib/licitacoes/quadroPostos";
import type { LinhaQuadro } from "@/hooks/useContratoQuadro";

const db = supabase as any;

/** A linha do banco, do jeito que o formulário edita (tudo string). */
export function paraFormulario(l: LinhaQuadro): LinhaQuadroForm {
  return {
    id: l.id,
    posto_nome: l.posto_nome ?? "",
    sup_posto_id: l.sup_posto_id ?? "",
    funcao_nome: l.funcao_nome ?? "",
    sup_funcao_id: l.sup_funcao_id ?? "",
    cargo: l.cargo ?? "",
    quantidade: String(l.quantidade ?? 1),
    escala: l.escala ?? "",
    horario: l.horario ?? "",
    // Números vêm do banco em ponto decimal; o formulário mostra em pt-BR,
    // que é como as pessoas digitam e como `paraNumero` sabe reler.
    salario: l.salario ? String(l.salario).replace(".", ",") : "",
    insalubridade_pct: l.insalubridade_pct ? String(l.insalubridade_pct).replace(".", ",") : "",
    periculosidade_pct: l.periculosidade_pct ? String(l.periculosidade_pct).replace(".", ",") : "",
    beneficios: l.beneficios ?? "",
    estado: l.estado ?? "",
    cidade: l.cidade ?? "",
    local_exato: l.local_exato ?? "",
    data_inicio_prevista: l.data_inicio_prevista ?? "",
    motivo_vaga: l.motivo_vaga ?? "Admissão",
    req_obrigatorios: l.req_obrigatorios ?? "",
    req_desejaveis: l.req_desejaveis ?? "",
    exp_minima: l.exp_minima ?? "Não",
    exp_minima_qual: l.exp_minima_qual ?? "",
    observacao: l.observacao ?? "",
    gerar_vagas: l.gerar_vagas ?? true,
  };
}

interface Props {
  /** Contrato do catálogo (contratos.id). Null no contrato ainda não salvo. */
  contratoId: string | null;
  /** Nome do contrato — só para a busca na Planilha de Custo. */
  contratoNome: string;
  linhas: LinhaQuadroForm[];
  onChange: (linhas: LinhaQuadroForm[]) => void;
  /** Quantas vagas cada linha já gerou, por id — vem de `contrato_quadro_listar`. */
  geradasPorId?: Record<string, { geradas: number; vivas: number }>;
  /** Some com os botões de escrita para quem só pode olhar. */
  somenteLeitura?: boolean;
}

export function QuadroPostosContrato({
  contratoId, contratoNome, linhas, onChange, geradasPorId = {}, somenteLeitura = false,
}: Props) {
  const [aberta, setAberta] = useState<number | null>(null);
  const [soEmUso, setSoEmUso] = useState(false);
  const { data: postosCatalogo = [] } = usePostos(contratoId);
  // Uma query só para as funções de TODOS os postos do contrato — 27 postos
  // seriam 27 chamadas se cada linha buscasse a sua.
  const { data: funcoesCatalogo = [] } = useFuncoesDoContrato(contratoId);

  // O que a tela mostra: o quadro salvo mais a cascata inteira do contrato.
  // Ver `mesclarComCatalogo` — o salvo sempre manda, o catálogo só acrescenta
  // o que falta, com quantidade 0 (fora do quadro até alguém preencher).
  const pares = useMemo(
    () => paresDoCatalogo(postosCatalogo, funcoesCatalogo),
    [postosCatalogo, funcoesCatalogo],
  );
  const exibidas = useMemo(() => mesclarComCatalogo(linhas, pares), [linhas, pares]);
  const visiveis = soEmUso ? exibidas.filter(linhaEmUso) : exibidas;

  const total = totalDeColaboradores(exibidas);
  const postos = totalDePostos(exibidas);
  const funcoesEmUso = totalDeFuncoes(exibidas);
  const vagas = totalDeVagas(exibidas);
  const salarial = totalSalarialMensal(exibidas);
  const doCatalogo = exibidas.length - linhas.length;

  // Toda edição promove a lista MESCLADA a estado do formulário. É o que
  // permite editar uma linha que veio do catálogo sem tratá-la diferente; o
  // que não tem quantidade é descartado por `paraPayload` na hora de gravar.
  function mexer(i: number, patch: Partial<LinhaQuadroForm>) {
    onChange(exibidas.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }

  function adicionar(base?: Partial<LinhaQuadroForm>) {
    onChange([...exibidas, { ...LINHA_VAZIA, quantidade: "1", ...base }]);
    setAberta(exibidas.length);
  }

  function remover(i: number) {
    const l = exibidas[i];
    const ja = l.id ? geradasPorId[l.id]?.geradas ?? 0 : 0;
    // Tirar do quadro uma linha que já abriu vaga NÃO apaga a vaga (a RPC só
    // desativa a linha). Dizer isso aqui evita a descoberta pelo caminho
    // caro: remover achando que cancela, e as vagas continuarem no
    // Recrutamento com gente em entrevista.
    if (ja > 0 && !confirm(
      `${rotuloDaLinha(l, i)} já abriu ${ja} vaga(s) no Recrutamento.\n\n` +
      `Tirar do quadro NÃO cancela essas vagas — elas continuam em andamento. ` +
      `Para cancelá-las, use a tela do Recrutamento.\n\nTirar do quadro assim mesmo?`,
    )) return;
    onChange(exibidas.filter((_, k) => k !== i));
    setAberta(null);
  }

  return (
    <div className="space-y-3">
      {/* Resumo: é o número que o usuário confere contra o contrato. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          {total} colaborador{total === 1 ? "" : "es"} em {postos} posto{postos === 1 ? "" : "s"}
          {funcoesEmUso !== postos && ` · ${funcoesEmUso} funç${funcoesEmUso === 1 ? "ão" : "ões"}`}
        </div>
        <span className="text-xs text-muted-foreground">
          {vagas} vaga{vagas === 1 ? "" : "s"} a abrir no Recrutamento
          {vagas !== total && ` (${total - vagas} sem abrir vaga agora)`}
        </span>
        {salarial > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            Salários: <b className="text-foreground">{brl(salarial)}</b>/mês
          </span>
        )}
      </div>

      {/* A cascata do contrato já vem listada — é o catálogo, não digitação.
          Com 27 postos a lista é longa, então dá para esconder o que está
          zerado assim que os primeiros são preenchidos. */}
      {doCatalogo > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {exibidas.length} posto/função do catálogo deste contrato.
            Informe <b className="text-foreground">quantas pessoas</b> em cada um que o contrato exige —
            os zerados ficam de fora do quadro.
          </span>
          {funcoesEmUso > 0 && (
            <button
              type="button"
              onClick={() => setSoEmUso(v => !v)}
              className="ml-auto rounded border px-2 py-1 font-medium hover:bg-muted"
            >
              {soEmUso ? `Mostrar todos (${exibidas.length})` : `Mostrar só os preenchidos (${funcoesEmUso})`}
            </button>
          )}
        </div>
      )}

      {exibidas.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          Este contrato ainda não tem posto no catálogo. Adicione uma linha por{" "}
          <b>posto + função</b> — ex.: <b>BLOCO CIRURGICO › Servente de Limpeza: 4</b>.
        </p>
      )}

      {exibidas.map((l, i) => (
        visiveis.includes(l) ? (
          <LinhaDoQuadro
            key={l.id || `${l.posto_nome}|${l.funcao_nome}|${i}`}
            linha={l}
            indice={i}
            aberta={aberta === i}
            onAbrir={() => setAberta(aberta === i ? null : i)}
            onMexer={patch => mexer(i, patch)}
            onRemover={() => remover(i)}
            onOutraFuncao={() => adicionar({
              posto_nome: l.posto_nome, sup_posto_id: l.sup_posto_id,
              estado: l.estado, cidade: l.cidade, local_exato: l.local_exato,
              data_inicio_prevista: l.data_inicio_prevista,
            })}
            postosCatalogo={postosCatalogo}
            funcoesDoPosto={funcoesCatalogo.filter(f => chavePosto(f.posto_nome) === chavePosto(l.posto_nome))}
            contratoNome={contratoNome}
            geradas={l.id ? geradasPorId[l.id] : undefined}
            somenteLeitura={somenteLeitura}
          />
        ) : null
      ))}

      {!somenteLeitura && (
        <Button type="button" variant="outline" size="sm" onClick={() => adicionar()}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Adicionar posto / função
        </Button>
      )}
    </div>
  );
}

// ── Uma linha do quadro ───────────────────────────────────────────────────
//
// As funções do posto chegam por PROP, não por hook próprio: o pai busca as
// funções do contrato inteiro de uma vez (useFuncoesDoContrato) e reparte.
// Um `useFuncoes` por linha viraria 27 requisições numa tela só.

interface LinhaProps {
  linha: LinhaQuadroForm;
  indice: number;
  aberta: boolean;
  onAbrir: () => void;
  onMexer: (patch: Partial<LinhaQuadroForm>) => void;
  onRemover: () => void;
  /** Nova linha no MESMO posto — o caminho de "este posto tem duas funções". */
  onOutraFuncao: () => void;
  postosCatalogo: { id: string; nome: string }[];
  /** Funções que o catálogo tem para ESTE posto. */
  funcoesDoPosto: { id: string; nome: string }[];
  contratoNome: string;
  geradas?: { geradas: number; vivas: number };
  somenteLeitura: boolean;
}

function LinhaDoQuadro({
  linha: l, indice: i, aberta, onAbrir, onMexer, onRemover, onOutraFuncao,
  postosCatalogo, funcoesDoPosto: funcoes, contratoNome, geradas, somenteLeitura,
}: LinhaProps) {
  // O posto do catálogo é achado pelo NOME a cada render, em vez de guardado
  // no estado do formulário. Guardar exigiria manter nome e id em dia a cada
  // tecla, e um id desencontrado do nome é pior que id nenhum: as funções
  // mostradas seriam as de outro posto, sem nada na tela denunciando.
  const postoCat = useMemo(
    () => postosCatalogo.find(p => chavePosto(p.nome) === chavePosto(l.posto_nome)) ?? null,
    [postosCatalogo, l.posto_nome],
  );

  const emUso = linhaEmUso(l);
  // Linha zerada é o catálogo mostrando que o posto existe — não é cobrada.
  const faltam = emUso ? faltamNaLinha(l) : [];
  const erro = emUso ? erroDaLinha(l) : null;
  const qtd = paraInteiro(l.quantidade);
  const cidades = municipiosDe(l.estado);
  const dataMinima = dataMinimaVaga();

  // Posto digitado que não está no catálogo: é o caso normal do contrato
  // novo, mas merece aviso — pode ser erro de digitação num contrato que JÁ
  // tem catálogo.
  const postoNovo = !!l.posto_nome.trim() && !postoCat;
  const funcaoCat = funcoes.find(f => chavePosto(f.nome) === chavePosto(l.funcao_nome)) ?? null;
  const funcaoNova = !!l.funcao_nome.trim() && !!postoCat && !funcaoCat;

  /**
   * Puxa salário, insalubridade e benefícios da Planilha de Custo pelo posto.
   *
   * É a MESMA RPC que a solicitação de vaga usa (`rec_custo_do_posto`, via
   * buscarCustoDoPosto) — não uma segunda consulta parecida. Se a vaga e o
   * contrato mostrassem benefícios diferentes para o mesmo posto, a
   * divergência voltaria pela porta que este módulo veio fechar.
   */
  async function puxarDaPlanilha() {
    if (!l.posto_nome.trim()) {
      toast({ title: "Escolha o posto primeiro.", description: "O salário e os benefícios saem do posto na Planilha de Custo.", variant: "destructive" });
      return;
    }
    const custo = await buscarCustoDoPosto(db, {
      contrato: contratoNome, posto: l.posto_nome, cargo: l.cargo || l.funcao_nome,
      salario: l.salario, cidade: l.cidade, escala: l.escala,
    });
    if (!custo) {
      toast({
        title: "Posto não encontrado na Planilha de Custo",
        description: `O contrato ainda não tem planilha vigente com o posto "${l.posto_nome}". Preencha salário e benefícios à mão.`,
        variant: "destructive",
      });
      return;
    }
    const insal = insalubridadeDoCusto(custo, undefined, custo.salario);
    onMexer({
      salario: custo.salario ? String(custo.salario).replace(".", ",") : l.salario,
      beneficios: beneficiosDoCusto(custo) || l.beneficios,
      insalubridade_pct: insal.recebe === "Sim" && custo.salario && custo.insalubridade
        ? String(Math.round((Number(custo.insalubridade) / Number(custo.salario)) * 100))
        : l.insalubridade_pct,
    });
    toast({
      title: `Da Planilha de Custo — posto "${custo.posto}"`,
      description: custo.por_posto === false
        ? "O nome não casou exato; foi usado o posto de mesma cidade e jornada. Confira os valores."
        : "Salário, insalubridade e benefícios preenchidos.",
    });
  }

  return (
    <div className={cn(
      "rounded-lg border",
      (faltam.length || erro) ? "border-amber-300" : emUso ? "border-border" : "border-dashed",
    )}>
      {/* Cabeçalho: posto › função e a QUANTIDADE, sem precisar abrir. Com 27
          linhas na tela, esconder o campo de quantidade dentro do painel
          obrigaria a abrir e fechar 27 painéis para dizer "quero 4 aqui". */}
      <div className={cn("flex items-center gap-2 px-3 py-2", !emUso && "opacity-70")}>
        <button type="button" onClick={onAbrir} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            emUso ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}>
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {l.posto_nome.trim() || "Posto sem nome"}
              <span className="mx-1.5 text-muted-foreground">›</span>
              <span className={cn(!l.funcao_nome.trim() && "font-normal text-muted-foreground")}>
                {l.funcao_nome.trim() || "função não escolhida"}
              </span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {emUso
                ? <>
                    {paraNumero(l.salario) > 0 ? brl(paraNumero(l.salario)) : "salário a preencher"}
                    {l.escala.trim() && ` · ${l.escala.trim()}`}
                    {l.local_exato.trim() && ` · ${l.local_exato.trim()}`}
                  </>
                : "do catálogo — sem vaga nesta leva"}
            </span>
          </span>
        </button>

        {!l.gerar_vagas && emUso && (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            sem abrir vaga
          </span>
        )}
        {geradas && geradas.geradas > 0 && (
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            {geradas.geradas} de {qtd} gerada{geradas.geradas === 1 ? "" : "s"}
          </span>
        )}
        {(faltam.length > 0 || erro) && (
          <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          <label className="text-[11px] text-muted-foreground" htmlFor={`qtd-${i}`}>pessoas</label>
          <Input
            id={`qtd-${i}`}
            type="number" min={0} max={999}
            className={cn("h-8 w-16 text-center", emUso && "font-semibold")}
            value={l.quantidade}
            disabled={somenteLeitura}
            onChange={e => onMexer({ quantidade: e.target.value })}
          />
        </div>

        <button type="button" onClick={onAbrir} className="shrink-0" aria-label="Detalhes da linha">
          {aberta
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />}
        </button>
      </div>

      {aberta && (
        <div className="space-y-3 border-t px-3 py-3">
          {erro && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">
              {erro}
            </p>
          )}

          {/* A cascata: posto → função (a quantidade fica no cabeçalho) */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Posto <span className="text-destructive">*</span></Label>
              {/* Datalist e não <select>: escolher do catálogo e digitar um
                  posto novo é a MESMA caixa. Um select com item "＋ criar
                  novo" abriria um segundo campo para a mesma informação. */}
              <Input
                list={`postos-${i}`}
                className="h-9"
                placeholder="Ex: BLOCO CIRURGICO"
                value={l.posto_nome}
                disabled={somenteLeitura}
                // Trocar de posto zera a função: a função pertence ao posto, e
                // manter "SERVENTE DE LIMPEZA" ao pular para outro posto
                // gravaria uma função que não é daquela cascata.
                onChange={e => onMexer({
                  posto_nome: e.target.value,
                  ...(chavePosto(e.target.value) !== chavePosto(l.posto_nome)
                    ? { funcao_nome: "", sup_funcao_id: "" } : {}),
                })}
              />
              <datalist id={`postos-${i}`}>
                {postosCatalogo.map(p => <option key={p.id} value={p.nome} />)}
              </datalist>
              {postoNovo ? (
                <span className="text-[11px] text-sky-700">
                  Posto novo — será criado no catálogo deste contrato ao salvar.
                </span>
              ) : postoCat ? (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Link2 className="h-3 w-3" aria-hidden /> Do catálogo · {funcoes.length} função(ões)
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Função <span className="text-destructive">*</span></Label>
              <Input
                list={`funcoes-${i}`}
                className="h-9"
                placeholder="Ex: SERVENTE DE LIMPEZA"
                value={l.funcao_nome}
                disabled={somenteLeitura}
                onChange={e => onMexer({
                  funcao_nome: e.target.value,
                  // O cargo da vaga começa igual à função — é o que o
                  // ModalNovaVaga já faz no modo manual (onFuncaoNome). Só
                  // preenche enquanto o cargo está vazio ou ainda espelha a
                  // função: quem editou o cargo à mão não é sobrescrito.
                  ...(!l.cargo.trim() || chavePosto(l.cargo) === chavePosto(l.funcao_nome)
                    ? { cargo: e.target.value } : {}),
                })}
              />
              <datalist id={`funcoes-${i}`}>
                {funcoes.map(f => <option key={f.id} value={f.nome} />)}
              </datalist>
              {funcaoNova && (
                <span className="text-[11px] text-sky-700">
                  Função nova — entra no lote de aprovação do Catálogo.
                </span>
              )}
              {!postoCat && !!l.posto_nome.trim() && (
                <span className="text-[11px] text-muted-foreground">
                  Posto fora do catálogo: digite a função.
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs">Cargo na vaga <span className="text-destructive">*</span></Label>
              <Input
                className="h-9" placeholder="Ex: Servente de Limpeza"
                value={l.cargo}
                disabled={somenteLeitura}
                onChange={e => onMexer({ cargo: e.target.value })}
              />
              <span className="text-[11px] text-muted-foreground">
                Vem da função; edite se o anúncio pede outro nome.
              </span>
            </div>
          </div>

          {/* Remuneração */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Salário <span className="text-destructive">*</span></Label>
              <Input
                className="h-9" placeholder="Ex: 1.412,00"
                value={l.salario}
                disabled={somenteLeitura}
                onChange={e => onMexer({ salario: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Insalubridade (%)</Label>
              <Input
                className="h-9" placeholder="Ex: 40"
                value={l.insalubridade_pct}
                disabled={somenteLeitura}
                onChange={e => onMexer({ insalubridade_pct: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Periculosidade (%)</Label>
              <Input
                className="h-9" placeholder="Ex: 30"
                value={l.periculosidade_pct}
                disabled={somenteLeitura}
                onChange={e => onMexer({ periculosidade_pct: e.target.value })}
              />
            </div>
            <div className="flex flex-col justify-end gap-1">
              {!somenteLeitura && (
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={puxarDaPlanilha}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Puxar da Planilha
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs">Benefícios</Label>
            <Input
              className="h-9" placeholder="Ex: VT R$ 126,28/mês · VA R$ 461,82/mês"
              value={l.beneficios}
              disabled={somenteLeitura}
              onChange={e => onMexer({ beneficios: e.target.value })}
            />
            <span className="text-[11px] text-muted-foreground">
              Vai para a vaga exatamente como está escrito aqui. "Puxar da Planilha" preenche no formato do Recrutamento.
            </span>
          </div>

          {/* Jornada */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Escala <span className="text-destructive">*</span></Label>
              <Input
                className="h-9" placeholder="Ex: 12X36 DIURNO"
                value={l.escala}
                disabled={somenteLeitura}
                onChange={e => onMexer({ escala: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Horário</Label>
              <Input
                className="h-9" placeholder="Ex: 07:00 às 19:00"
                value={l.horario}
                disabled={somenteLeitura}
                onChange={e => onMexer({ horario: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Data prevista de início <span className="text-destructive">*</span></Label>
              <Input
                type="date" className="h-9"
                min={dataMinima}
                value={l.data_inicio_prevista}
                disabled={somenteLeitura}
                onChange={e => onMexer({ data_inicio_prevista: e.target.value })}
              />
              <span className="text-[11px] text-muted-foreground">
                A partir de {fmtBr(dataMinima)} — a vaga exige 7 dias úteis de antecedência.
              </span>
            </div>
          </div>

          {/* Localização */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Estado <span className="text-destructive">*</span></Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={l.estado}
                disabled={somenteLeitura}
                onChange={e => onMexer({ estado: e.target.value, cidade: "" })}
              >
                <option value="">Selecione...</option>
                {ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Cidade <span className="text-destructive">*</span></Label>
              <Input
                list={`cidades-${i}`} className="h-9"
                value={l.cidade}
                disabled={somenteLeitura || !l.estado}
                onChange={e => onMexer({ cidade: e.target.value })}
              />
              <datalist id={`cidades-${i}`}>
                {cidades.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label className="text-xs">Local exato de trabalho <span className="text-destructive">*</span></Label>
              <Input
                className="h-9" placeholder="Ex: Hospital Tacchini — Bloco Cirúrgico, 2º andar"
                value={l.local_exato}
                disabled={somenteLeitura}
                onChange={e => onMexer({ local_exato: e.target.value })}
              />
            </div>
          </div>

          {/* Requisitos */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Motivo da vaga</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={l.motivo_vaga}
                disabled={somenteLeitura}
                onChange={e => onMexer({ motivo_vaga: e.target.value })}
              >
                {/* Substituição fica de fora: ela repõe UMA pessoa específica
                    (substituido_id) e o quadro não repõe ninguém — declara o
                    que o contrato exige. */}
                {MOTIVOS_VAGA.filter(m => m !== "Substituição").map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Exige experiência?</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={l.exp_minima}
                disabled={somenteLeitura}
                onChange={e => onMexer({ exp_minima: e.target.value })}
              >
                <option value="Não">Não</option>
                <option value="Sim">Sim</option>
              </select>
            </div>
            {l.exp_minima === "Sim" && (
              <div className="col-span-2 flex flex-col gap-1">
                <Label className="text-xs">Qual experiência <span className="text-destructive">*</span></Label>
                <Input
                  className="h-9" placeholder="Ex: 6 meses em limpeza hospitalar"
                  value={l.exp_minima_qual}
                  disabled={somenteLeitura}
                  onChange={e => onMexer({ exp_minima_qual: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Requisitos obrigatórios</Label>
              <Textarea
                rows={2} placeholder="Um por linha"
                value={l.req_obrigatorios}
                disabled={somenteLeitura}
                onChange={e => onMexer({ req_obrigatorios: e.target.value })}
              />
              {/* A CNH entra sozinha por cargo — o guard do banco
                  (rec_cargo_exige_cnh) acrescenta a linha na vaga. Não
                  repetir aqui evita o requisito duplicado. */}
              <span className="text-[11px] text-muted-foreground">
                Cargo que dirige (motorista, tratorista…) ganha "CNH obrigatória" sozinho na vaga.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Requisitos desejáveis</Label>
              <Textarea
                rows={2}
                value={l.req_desejaveis}
                disabled={somenteLeitura}
                onChange={e => onMexer({ req_desejaveis: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-xs">Observação para o Recrutamento</Label>
            <Textarea
              rows={2}
              value={l.observacao}
              disabled={somenteLeitura}
              onChange={e => onMexer({ observacao: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={l.gerar_vagas}
                disabled={somenteLeitura}
                onChange={e => onMexer({ gerar_vagas: e.target.checked })}
              />
              Abrir {qtd} vaga{qtd === 1 ? "" : "s"} desta função no Recrutamento
            </label>
            {!somenteLeitura && (
              <div className="flex items-center gap-1">
                {/* Um posto com duas funções são duas linhas. Copiar posto,
                    local e data poupa redigitar o que não muda entre elas. */}
                <Button type="button" variant="ghost" size="sm" onClick={onOutraFuncao}>
                  <CopyPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Outra função neste posto
                </Button>
                <Button type="button" variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={onRemover}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Tirar do quadro
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
