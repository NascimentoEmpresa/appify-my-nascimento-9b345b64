// QUADRO DE POSTOS DO CONTRATO — a seção do formulário "Novo Contrato" onde
// se declara quantas pessoas o contrato exige, por posto.
//
// Ganhamos a licitação, o contrato exige 30 pessoas: posto 1 com 10
// jardineiros, posto 2 com 10 vigilantes, posto 3 com 10 auxiliares
// administrativos. Cada linha daqui vira N solicitações de vaga no
// Recrutamento (uma por pessoa — ver o comentário da migration
// 20260930000238 sobre por que não é uma vaga com quantidade 10), já com
// salário, benefícios, escala, insalubridade e local preenchidos.
//
// O POSTO vem do catálogo do contrato quando ele já existe, e pode ser
// digitado quando não existe — contrato recém-ganho normalmente ainda não
// teve a Planilha de Custo importada, e é justamente aí que as vagas
// precisam abrir. Quem grava o posto novo é a RPC `contrato_quadro_salvar`,
// que cuida do espelho em sup_posto; a tela nunca escreve em sup_posto
// direto (a policy de escrita não existe desde a migration 20260930000081).

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Users, ChevronDown, ChevronUp, Sparkles, TriangleAlert, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePostos } from "@/hooks/useSupCatalogo";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import { MOTIVOS_VAGA, dataMinimaVaga, fmtBr } from "@/lib/recrutamento/vagaRegras";
import { buscarCustoDoPosto, beneficiosDoCusto, insalubridadeDoCusto } from "@/lib/recrutamento/custoPosto";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  type LinhaQuadroForm, LINHA_VAZIA, faltamNaLinha, erroDaLinha,
  totalDeColaboradores, totalDeVagas, totalSalarialMensal, brl, paraInteiro, paraNumero,
} from "@/lib/licitacoes/quadroPostos";
import type { LinhaQuadro } from "@/hooks/useContratoQuadro";

const db = supabase as any;

/** A linha do banco, do jeito que o formulário edita (tudo string). */
export function paraFormulario(l: LinhaQuadro): LinhaQuadroForm {
  return {
    id: l.id,
    posto_nome: l.posto_nome ?? "",
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
  const [aberta, setAberta] = useState<number | null>(linhas.length ? 0 : null);
  const { data: postosCatalogo = [] } = usePostos(contratoId);

  const total = totalDeColaboradores(linhas);
  const vagas = totalDeVagas(linhas);
  const salarial = totalSalarialMensal(linhas);
  const dataMinima = dataMinimaVaga();

  function mexer(i: number, patch: Partial<LinhaQuadroForm>) {
    onChange(linhas.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  }

  function adicionar() {
    onChange([...linhas, { ...LINHA_VAZIA }]);
    setAberta(linhas.length);
  }

  function remover(i: number) {
    const l = linhas[i];
    const ja = l.id ? geradasPorId[l.id]?.geradas ?? 0 : 0;
    // Tirar do quadro um posto que já abriu vaga NÃO apaga a vaga (a RPC só
    // desativa a linha). Dizer isso aqui evita a descoberta pelo caminho
    // caro: remover achando que cancela, e as vagas continuarem no
    // Recrutamento com gente em entrevista.
    if (ja > 0 && !confirm(
      `O posto "${l.posto_nome || `nº ${i + 1}`}" já abriu ${ja} vaga(s) no Recrutamento.\n\n` +
      `Tirar do quadro NÃO cancela essas vagas — elas continuam em andamento. ` +
      `Para cancelá-las, use a tela do Recrutamento.\n\nTirar do quadro assim mesmo?`,
    )) return;
    onChange(linhas.filter((_, k) => k !== i));
    setAberta(null);
  }

  /**
   * Puxa salário, insalubridade e benefícios da Planilha de Custo pelo posto.
   *
   * É a MESMA RPC que a solicitação de vaga usa (`rec_custo_do_posto`, via
   * buscarCustoDoPosto) — não uma segunda consulta parecida. Se a vaga e o
   * contrato mostrassem benefícios diferentes para o mesmo posto, a
   * divergência voltaria pela porta que este módulo veio fechar.
   */
  async function puxarDaPlanilha(i: number) {
    const l = linhas[i];
    if (!l.posto_nome.trim()) {
      toast({ title: "Escolha o posto primeiro.", description: "O salário e os benefícios saem do posto na Planilha de Custo.", variant: "destructive" });
      return;
    }
    const custo = await buscarCustoDoPosto(db, {
      contrato: contratoNome, posto: l.posto_nome, cargo: l.cargo,
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
    mexer(i, {
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
    <div className="space-y-3">
      {/* Resumo: é o número que o usuário confere contra o contrato. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
          {total} colaborador{total === 1 ? "" : "es"} em {linhas.length} posto{linhas.length === 1 ? "" : "s"}
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

      {linhas.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          Nenhum posto no quadro ainda. Adicione um posto por função do contrato
          — ex.: <b>10 jardineiros</b>, <b>10 vigilantes</b>, <b>10 auxiliares administrativos</b>.
        </p>
      )}

      {linhas.map((l, i) => {
        const faltam = faltamNaLinha(l);
        const erro = erroDaLinha(l);
        const geradas = l.id ? geradasPorId[l.id] : undefined;
        const qtd = paraInteiro(l.quantidade);
        const cidades = municipiosDe(l.estado);
        // Posto digitado que não está no catálogo: é o caso normal do
        // contrato novo, mas merece aviso — pode ser erro de digitação num
        // contrato que JÁ tem catálogo.
        const foraDoCatalogo = !!l.posto_nome.trim() && postosCatalogo.length > 0
          && !postosCatalogo.some(p => p.nome.trim().toUpperCase() === l.posto_nome.trim().toUpperCase());

        return (
          <div key={l.id || `novo-${i}`} className={cn(
            "rounded-lg border",
            (faltam.length || erro) ? "border-amber-300" : "border-border",
          )}>
            {/* Cabeçalho da linha: o resumo que se lê sem abrir. */}
            <button
              type="button"
              onClick={() => setAberta(aberta === i ? null : i)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {l.posto_nome.trim() || "Posto sem nome"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {qtd} × {l.cargo.trim() || "cargo não informado"}
                  {paraNumero(l.salario) > 0 && ` · ${brl(paraNumero(l.salario))}`}
                  {l.escala.trim() && ` · ${l.escala.trim()}`}
                </span>
              </span>
              {!l.gerar_vagas && (
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
              {aberta === i
                ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
            </button>

            {aberta === i && (
              <div className="space-y-3 border-t px-3 py-3">
                {erro && (
                  <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">
                    {erro}
                  </p>
                )}

                {/* Posto + quantidade + cargo */}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="col-span-2 flex flex-col gap-1">
                    <Label className="text-xs">Posto <span className="text-destructive">*</span></Label>
                    <Input
                      list={`postos-${i}`}
                      className="h-9"
                      placeholder="Ex: JARDINAGEM CAMPUS CENTRO"
                      value={l.posto_nome}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { posto_nome: e.target.value })}
                    />
                    {/* Datalist e não <select>: escolher do catálogo e digitar
                        um posto novo é a MESMA caixa, que é o que o usuário
                        pediu ("opção de criar um posto novo nessa mesma
                        opção"). Um select com item "＋ criar novo" abriria um
                        segundo campo para a mesma informação. */}
                    <datalist id={`postos-${i}`}>
                      {postosCatalogo.map(p => <option key={p.id} value={p.nome} />)}
                    </datalist>
                    {foraDoCatalogo && (
                      <span className="text-[11px] text-sky-700">
                        Posto novo — será criado no catálogo deste contrato ao salvar.
                      </span>
                    )}
                    {!foraDoCatalogo && l.posto_nome.trim() && postosCatalogo.length > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Link2 className="h-3 w-3" aria-hidden /> Posto do catálogo do contrato.
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Qtd. colaboradores <span className="text-destructive">*</span></Label>
                    <Input
                      type="number" min={1} max={999} className="h-9"
                      value={l.quantidade}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { quantidade: e.target.value })}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {qtd} solicitaç{qtd === 1 ? "ão" : "ões"} de vaga
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Cargo <span className="text-destructive">*</span></Label>
                    <Input
                      className="h-9" placeholder="Ex: Jardineiro"
                      value={l.cargo}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { cargo: e.target.value })}
                    />
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
                      onChange={e => mexer(i, { salario: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Insalubridade (%)</Label>
                    <Input
                      className="h-9" placeholder="Ex: 40"
                      value={l.insalubridade_pct}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { insalubridade_pct: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Periculosidade (%)</Label>
                    <Input
                      className="h-9" placeholder="Ex: 30"
                      value={l.periculosidade_pct}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { periculosidade_pct: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col justify-end gap-1">
                    {!somenteLeitura && (
                      <Button type="button" variant="outline" size="sm" className="h-9"
                        onClick={() => puxarDaPlanilha(i)}>
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
                    onChange={e => mexer(i, { beneficios: e.target.value })}
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
                      className="h-9" placeholder="Ex: 5X2 SEG A SEX"
                      value={l.escala}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { escala: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Horário</Label>
                    <Input
                      className="h-9" placeholder="Ex: 08:00 às 17:00"
                      value={l.horario}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { horario: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Data prevista de início <span className="text-destructive">*</span></Label>
                    <Input
                      type="date" className="h-9"
                      min={dataMinima}
                      value={l.data_inicio_prevista}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { data_inicio_prevista: e.target.value })}
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
                      onChange={e => mexer(i, { estado: e.target.value, cidade: "" })}
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
                      onChange={e => mexer(i, { cidade: e.target.value })}
                    />
                    <datalist id={`cidades-${i}`}>
                      {cidades.map(c => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <div className="col-span-2 flex flex-col gap-1">
                    <Label className="text-xs">Local exato de trabalho <span className="text-destructive">*</span></Label>
                    <Input
                      className="h-9" placeholder="Ex: Campus Centro — Av. Paulo Gama, 110, prédio 12"
                      value={l.local_exato}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { local_exato: e.target.value })}
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
                      onChange={e => mexer(i, { motivo_vaga: e.target.value })}
                    >
                      {/* Substituição fica de fora: ela repõe UMA pessoa
                          específica (substituido_id) e o quadro não repõe
                          ninguém — declara o que o contrato exige. */}
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
                      onChange={e => mexer(i, { exp_minima: e.target.value })}
                    >
                      <option value="Não">Não</option>
                      <option value="Sim">Sim</option>
                    </select>
                  </div>
                  {l.exp_minima === "Sim" && (
                    <div className="col-span-2 flex flex-col gap-1">
                      <Label className="text-xs">Qual experiência <span className="text-destructive">*</span></Label>
                      <Input
                        className="h-9" placeholder="Ex: 6 meses em jardinagem com roçadeira"
                        value={l.exp_minima_qual}
                        disabled={somenteLeitura}
                        onChange={e => mexer(i, { exp_minima_qual: e.target.value })}
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
                      onChange={e => mexer(i, { req_obrigatorios: e.target.value })}
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
                      onChange={e => mexer(i, { req_desejaveis: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Observação para o Recrutamento</Label>
                  <Textarea
                    rows={2}
                    value={l.observacao}
                    disabled={somenteLeitura}
                    onChange={e => mexer(i, { observacao: e.target.value })}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={l.gerar_vagas}
                      disabled={somenteLeitura}
                      onChange={e => mexer(i, { gerar_vagas: e.target.checked })}
                    />
                    Abrir as {qtd} vaga{qtd === 1 ? "" : "s"} deste posto no Recrutamento
                  </label>
                  {!somenteLeitura && (
                    <Button type="button" variant="ghost" size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remover(i)}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Tirar do quadro
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!somenteLeitura && (
        <Button type="button" variant="outline" size="sm" onClick={adicionar}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Adicionar posto
        </Button>
      )}
    </div>
  );
}
