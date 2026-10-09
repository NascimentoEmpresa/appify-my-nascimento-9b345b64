// =====================================================================
// ENCARREGADOS › CONFERÊNCIA DE PONTO (mig 20261007000023, 07/10/2026)
//
// O encarregado abre a folha do mês: o ENVIO do contrato, com a situação de
// cada colaborador e as folhas/espelhos de ponto anexados. Enviado, a linha
// do contrato na Conferência de Ponto vira "Pendente Operacional"; o
// Operacional recebe ou devolve com motivo.
//
// O relógio (espelho."BiMarcacoes") entra como AJUDA, não como verdade: a
// tela mostra os dias com batida e os dias úteis sem batida de cada um e
// sugere a situação — o encarregado é quem confirma.
// =====================================================================

export type StatusEnvio = "rascunho" | "enviado" | "devolvido" | "recebido";
export type SituacaoItem = "ok" | "faltas" | "atestado" | "ferias" | "afastado" | "desligado" | "divergencia";

export const SITUACOES: { valor: SituacaoItem; rotulo: string; cor: string }[] = [
  { valor: "ok",          rotulo: "OK",            cor: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { valor: "faltas",      rotulo: "Faltas",        cor: "bg-red-100 text-red-800 border-red-200" },
  { valor: "atestado",    rotulo: "Atestado",      cor: "bg-sky-100 text-sky-800 border-sky-200" },
  { valor: "ferias",      rotulo: "Férias",        cor: "bg-violet-100 text-violet-800 border-violet-200" },
  { valor: "afastado",    rotulo: "Afastado",      cor: "bg-amber-100 text-amber-800 border-amber-200" },
  { valor: "desligado",   rotulo: "Desligado",     cor: "bg-zinc-200 text-zinc-700 border-zinc-300" },
  { valor: "divergencia", rotulo: "Divergência",   cor: "bg-orange-100 text-orange-800 border-orange-200" },
];
export const rotuloSituacao = (s: string) => SITUACOES.find((x) => x.valor === s)?.rotulo ?? s;
export const corSituacao = (s: string) => SITUACOES.find((x) => x.valor === s)?.cor ?? "";

export const STATUS_ENVIO: Record<StatusEnvio, { rotulo: string; cor: string; explica: string }> = {
  rascunho:  { rotulo: "Rascunho",  cor: "bg-slate-100 text-slate-700 border-slate-200", explica: "Ainda não enviado ao Operacional." },
  enviado:   { rotulo: "Enviado",   cor: "bg-sky-100 text-sky-800 border-sky-200", explica: "OK dado: com o Operacional, aguardando o recebimento." },
  devolvido: { rotulo: "Devolvido", cor: "bg-red-100 text-red-800 border-red-200", explica: "O Operacional devolveu — corrija e reenvie." },
  recebido:  { rotulo: "Recebido",  cor: "bg-emerald-100 text-emerald-800 border-emerald-200", explica: "Recebido pelo Operacional. Segue para a conferência." },
};
export const envioEditavel = (s: StatusEnvio | null | undefined) => !s || s === "rascunho" || s === "devolvido";

/** Linha que a RPC ponto_enc_colaboradores devolve. */
export interface ColaboradorRelogio {
  empregado_id: number; nome: string; cadastro: number | null; cargo: string | null; posto: string | null;
  situacao_senior: string | null; dias_marcados: number; dias_uteis_sem_marcacao: number | null;
}

export interface ItemEnvio {
  empregado_id: number | null; nome: string; cadastro: number | null; cargo: string | null; posto: string | null;
  situacao: SituacaoItem; faltas: number; atrasos: number; horas_extras: string; observacao: string;
  dias_marcados: number | null; dias_sem_marcacao: number | null;
}

/**
 * A sugestão de partida para cada colaborador. A situação da Senior manda
 * (férias, afastamento) — nesses casos o relógio vazio é esperado; senão,
 * dia útil sem batida vira "faltas" com a contagem já preenchida.
 * `relogioCobre` = o relógio já tem algum dia do mês (sem isso, "sem batida"
 * não quer dizer nada e fica OK).
 */
export function sugerirItem(c: ColaboradorRelogio, relogioCobre: boolean): ItemEnvio {
  const sen = (c.situacao_senior ?? "").toLowerCase();
  let situacao: SituacaoItem = "ok";
  let faltas = 0;
  if (sen.includes("férias") || sen.includes("ferias")) situacao = "ferias";
  else if (/aux[ií]lio|licen[çc]a|aposentad|c[áa]rcere|afast/.test(sen)) situacao = "afastado";
  else if (sen.includes("atestado")) situacao = "atestado";
  else if (relogioCobre && (c.dias_uteis_sem_marcacao ?? 0) > 0) { situacao = "faltas"; faltas = c.dias_uteis_sem_marcacao ?? 0; }
  return {
    empregado_id: c.empregado_id, nome: c.nome, cadastro: c.cadastro, cargo: c.cargo, posto: c.posto,
    situacao, faltas, atrasos: 0, horas_extras: "", observacao: "",
    dias_marcados: c.dias_marcados, dias_sem_marcacao: c.dias_uteis_sem_marcacao,
  };
}

/**
 * Junta o que já foi salvo com a lista atual do contrato: quem já tinha linha
 * mantém o que o encarregado escreveu (com o relógio atualizado); quem entrou
 * no contrato depois ganha a sugestão; quem saiu e já estava salvo continua
 * (pode ter trabalhado parte do mês).
 */
export function montarItens(colabs: ColaboradorRelogio[], salvos: Partial<ItemEnvio>[], relogioCobre: boolean): ItemEnvio[] {
  const porId = new Map(salvos.filter((s) => s.empregado_id != null).map((s) => [s.empregado_id!, s]));
  const out: ItemEnvio[] = colabs.map((c) => {
    const base = sugerirItem(c, relogioCobre);
    const s = porId.get(c.empregado_id);
    porId.delete(c.empregado_id);
    return s ? {
      ...base, situacao: (s.situacao as SituacaoItem) ?? base.situacao, faltas: s.faltas ?? 0, atrasos: s.atrasos ?? 0,
      horas_extras: s.horas_extras ?? "", observacao: s.observacao ?? "",
    } : base;
  });
  for (const s of porId.values()) {
    out.push({
      empregado_id: s.empregado_id ?? null, nome: s.nome ?? "—", cadastro: s.cadastro ?? null, cargo: s.cargo ?? null, posto: s.posto ?? null,
      situacao: (s.situacao as SituacaoItem) ?? "ok", faltas: s.faltas ?? 0, atrasos: s.atrasos ?? 0, horas_extras: s.horas_extras ?? "",
      observacao: s.observacao ?? "", dias_marcados: s.dias_marcados ?? null, dias_sem_marcacao: s.dias_sem_marcacao ?? null,
    });
  }
  return out.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** O que impede o envio, em frases para a tela (vazio = pode enviar). */
export function pendenciasEnvio(itens: ItemEnvio[], anexos: number): string[] {
  const p: string[] = [];
  if (!itens.length) p.push("Nenhum colaborador na lista.");
  if (anexos < 1) p.push("Anexe a folha/espelho de ponto do mês.");
  const faltasZeradas = itens.filter((i) => i.situacao === "faltas" && i.faltas <= 0);
  if (faltasZeradas.length) p.push(`${faltasZeradas.length} colaborador(es) em "Faltas" sem a quantidade de faltas.`);
  const semObs = itens.filter((i) => i.situacao === "divergencia" && !i.observacao.trim());
  if (semObs.length) p.push(`${semObs.length} divergência(s) sem observação explicando.`);
  return p;
}

export function resumoItens(itens: ItemEnvio[]) {
  const por = Object.fromEntries(SITUACOES.map((s) => [s.valor, 0])) as Record<SituacaoItem, number>;
  for (const i of itens) por[i.situacao]++;
  return {
    total: itens.length, por,
    faltas: itens.reduce((s, i) => s + (i.faltas || 0), 0),
    atrasos: itens.reduce((s, i) => s + (i.atrasos || 0), 0),
    semBatida: itens.filter((i) => (i.dias_marcados ?? 0) === 0).length,
  };
}

/** Diferente do que o relógio sugere? (a tela destaca para o encarregado olhar de novo) */
export const divergeDoRelogio = (i: ItemEnvio, relogioCobre: boolean) =>
  relogioCobre && i.situacao === "ok" && (i.dias_sem_marcacao ?? 0) > 0;

/** Caminho no bucket: <envio>/<timestamp>-<nome limpo>. O 1º segmento é o que a policy confere. */
export function caminhoAnexo(envioId: number, nomeArquivo: string, agora = Date.now()): string {
  const limpo = nomeArquivo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  return `${envioId}/${agora}-${limpo || "arquivo"}`;
}
