/**
 * Auditoria sensível (Configurações do ERP › Auditoria sensível) — tradução
 * dos eventos para português.
 *
 * Pedido do Pablo (18/11/2026), em cima do print da aba antiga (JSON cru de
 * public.audit_log): "mostre exatamente o usuário que fez a alteração,
 * horário, data, permissão que adicionou e pra quem adicionou, se fez algum
 * login novo também e coisas assim".
 *
 * O banco (RPC auditoria_sensivel_eventos, mig 20261118234500) já devolve o
 * evento classificado — quem fez, para quem, tela/módulo/ação, campos
 * antes → depois — com um `evento` de código estável. Aqui fica só a parte de
 * texto: a frase, os rótulos de campo e ação, a data em Brasília e o CSV.
 * Lógica pura, testada em src/test/auditoria-sensivel.test.ts.
 */

export type TipoAuditoria = "permissao" | "login" | "cadastro" | "outros";

export interface ItemPermissao {
  menu: string;
  acao: string;
  /** true = liberado · false = bloqueado explícito · null = sem regra própria */
  antes: boolean | null;
  depois: boolean | null;
  menu_nome?: string | null;
  modulo_nome?: string | null;
  empresa_id?: string | null;
}

export interface CampoAlterado {
  antes: unknown;
  depois: unknown;
}

/** O que o banco põe em `detalhes`, conforme o evento (mig 20261118234500). */
export interface DetalhesAuditoria {
  itens?: ItemPermissao[];
  campos?: Record<string, CampoAlterado> | null;
  perfil_id?: string | null;
  perfil_nome?: string | null;
  papel?: string | null;
  papel_anterior?: string | null;
  menu?: string;
  menu_nome?: string | null;
  modulo_nome?: string | null;
  adicionados?: number;
  removidos?: number;
  pessoas_com_acesso?: number;
  setores?: string[];
  cargos?: string[];
  dadas?: number;
  removidas?: number;
  email?: string | null;
  email_novo?: string | null;
  nome?: string | null;
  empregado_id?: string | null;
  empregado_nome?: string | null;
  login_anterior?: string | null;
  login_anterior_nome?: string | null;
  ip?: string | null;
  metodo?: string | null;
  navegador?: string | null;
  tabela?: string;
  registro?: string | null;
}

export interface EventoAuditoria {
  id: string;
  ts: string;
  tipo: TipoAuditoria;
  evento: string;
  ator_id: string | null;
  ator_nome: string | null;
  alvo_id: string | null;
  alvo_nome: string | null;
  detalhes: DetalhesAuditoria | null;
  bruto: unknown;
}

export interface ResumoAuditoria {
  total: number;
  por_tipo: Partial<Record<TipoAuditoria, number>>;
  permissoes_dadas: number;
  permissoes_removidas: number;
  perfis_concedidos: number;
  perfis_removidos: number;
  modulos_liberados: number;
  usuarios_criados: number;
  contas_desativadas: number;
  contas_ativadas: number;
  logins_vinculados: number;
  logins_desvinculados: number;
  entradas: number;
  entradas_fonte: "gotrue" | "sessoes";
  pessoas_que_entraram: number;
  top_atores: { id: string | null; nome: string; eventos: number }[];
}

export const TIPOS_AUDITORIA: { id: TipoAuditoria; rotulo: string }[] = [
  { id: "permissao", rotulo: "Permissões" },
  { id: "login", rotulo: "Logins e entradas" },
  { id: "cadastro", rotulo: "Cadastro de usuários" },
  { id: "outros", rotulo: "Outros registros" },
];

export const SISTEMA = "Sistema";

const ROTULO_ACAO: Record<string, string> = {
  visualizar: "ver",
  criar: "criar",
  alterar: "alterar",
  excluir: "excluir",
  aprovar: "aprovar",
  exportar: "exportar",
  ajuste_administrativo: "ajuste administrativo",
  editar_concluida: "editar concluída",
  enviar_malote: "enviar malote",
  fundamentar: "fundamentar",
  responder: "responder",
  visao_completa: "visão completa",
};

export function rotuloAcao(acao: string | null | undefined): string {
  if (!acao) return "—";
  return ROTULO_ACAO[acao] ?? acao.replace(/_/g, " ");
}

const ROTULO_CAMPO: Record<string, string> = {
  display_name: "Nome",
  nome: "Nome",
  email: "E-mail",
  ativo: "Conta ativa",
  cargo: "Cargo",
  telefone: "Telefone",
  bio: "Apresentação",
  avatar_url: "Foto",
  must_change_password: "Trocar senha no próximo acesso",
  empresa_id: "Empresa",
  acessa_todas_empresas: "Acessa todas as empresas",
  concede_tudo: "Concede acesso a tudo",
  descricao: "Descrição",
  allow: "Liberado",
};

export function rotuloCampo(campo: string): string {
  if (ROTULO_CAMPO[campo]) return ROTULO_CAMPO[campo];
  const t = campo.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const ISO_DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function formatarValor(v: unknown, campo?: string): string {
  if (v === null || v === undefined || v === "") return "(vazio)";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (campo === "avatar_url") return "foto definida";
  if (typeof v === "string") {
    if (ISO_DATA.test(v)) return formatarDataHora(v);
    return v.length > 120 ? `${v.slice(0, 117)}…` : v;
  }
  if (typeof v === "number") return String(v);
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/** Campos que mudaram, em ordem de rótulo, já com texto pronto. */
export function listarCamposAlterados(campos: Record<string, CampoAlterado> | null | undefined) {
  if (!campos) return [];
  return Object.entries(campos)
    .map(([campo, c]) => ({
      campo,
      rotulo: rotuloCampo(campo),
      antes: formatarValor(c?.antes, campo),
      depois: formatarValor(c?.depois, campo),
    }))
    .filter((c) => c.antes !== c.depois)
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

const TZ = "America/Sao_Paulo";

/** "18/11/2026 09:01:25" no horário de Brasília. */
export function formatarDataHora(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  if (Number.isNaN(d.getTime())) return String(ts);
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

export type MudancaPermissao = "deu" | "tirou" | "bloqueou" | "ajustou";

export function mudancaPermissao(i: Pick<ItemPermissao, "antes" | "depois">): MudancaPermissao {
  if (i.depois === true) return "deu";
  if (i.antes === true) return "tirou";
  if (i.depois === false) return "bloqueou";
  return "ajustou"; // bloqueio explícito retirado (volta a valer o perfil)
}

export function nomeTela(i: Pick<ItemPermissao, "menu" | "menu_nome" | "modulo_nome">): string {
  const nome = i.menu_nome || i.menu;
  return i.modulo_nome ? `${nome} (${i.modulo_nome})` : nome;
}

/** "Deu Férias (Recursos Humanos) · criar" */
export function descreverItemPermissao(i: ItemPermissao): string {
  const verbo = { deu: "Deu", tirou: "Tirou", bloqueou: "Bloqueou", ajustou: "Retirou o bloqueio de" }[mudancaPermissao(i)];
  return `${verbo} ${nomeTela(i)} · ${rotuloAcao(i.acao)}`;
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

function contarPermissoes(itens: ItemPermissao[]) {
  const c = { deu: 0, tirou: 0, bloqueou: 0, ajustou: 0 };
  for (const i of itens) c[mudancaPermissao(i)]++;
  return c;
}

function resumoPermissoes(itens: ItemPermissao[]): string {
  const c = contarPermissoes(itens);
  const partes: string[] = [];
  if (c.deu) partes.push(`deu ${plural(c.deu, "permissão", "permissões")}`);
  if (c.tirou) partes.push(`tirou ${plural(c.tirou, "permissão", "permissões")}`);
  if (c.bloqueou) partes.push(`bloqueou ${plural(c.bloqueou, "permissão", "permissões")}`);
  if (c.ajustou) partes.push(`retirou ${plural(c.ajustou, "bloqueio", "bloqueios")}`);
  if (partes.length === 0) return "alterou permissões";
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
}

/** Frase única do evento, com quem fez e para quem. */
export function fraseEvento(e: EventoAuditoria): string {
  const ator = e.ator_nome || (e.ator_id ? "Usuário removido" : SISTEMA);
  const alvo = e.alvo_nome || (e.alvo_id ? "usuário removido" : "—");
  const d = e.detalhes ?? {};
  const proprio = !!e.ator_id && e.ator_id === e.alvo_id;
  const tela = d.menu ? `"${nomeTela({ menu: d.menu, menu_nome: d.menu_nome, modulo_nome: d.modulo_nome })}"` : "";
  const perfil = d.perfil_nome ? `"${d.perfil_nome}"` : "(perfil removido)";

  switch (e.evento) {
    case "permissoes_usuario": {
      const itens = d.itens ?? [];
      if (itens.length === 1) {
        const i = itens[0];
        const acao = `"${rotuloAcao(i.acao)}" em ${nomeTela(i)}`;
        switch (mudancaPermissao(i)) {
          case "deu": return `${ator} deu a permissão ${acao} para ${alvo}`;
          case "tirou": return `${ator} tirou a permissão ${acao} de ${alvo}`;
          case "bloqueou": return `${ator} bloqueou a permissão ${acao} para ${alvo}`;
          default: return `${ator} retirou o bloqueio de ${acao} para ${alvo}`;
        }
      }
      const c = contarPermissoes(itens);
      return `${ator} ${resumoPermissoes(itens)} ${c.deu > 0 && c.tirou === 0 ? "para" : "de"} ${alvo}`;
    }
    case "permissoes_perfil":
      return `${ator} alterou o perfil de acesso ${perfil}: ${resumoPermissoes(d.itens ?? [])}`;
    case "perfil_concedido":
      return `${ator} deu o perfil de acesso ${perfil} para ${alvo}`;
    case "perfil_removido":
      return `${ator} tirou o perfil de acesso ${perfil} de ${alvo}`;
    case "perfil_alterado":
      return `${ator} alterou o perfil de acesso de ${alvo}`;
    case "papel_concedido":
      return `${ator} deu o papel "${d.papel}" para ${alvo}`;
    case "papel_removido":
      return `${ator} tirou o papel "${d.papel}" de ${alvo}`;
    case "papel_alterado":
      return `${ator} trocou o papel de ${alvo} de "${d.papel_anterior}" para "${d.papel}"`;
    case "perfil_criado":
      return `${ator} criou o perfil de acesso ${perfil}`;
    case "perfil_editado":
      return `${ator} editou o perfil de acesso ${perfil}`;
    case "perfil_excluido":
      return `${ator} excluiu o perfil de acesso ${perfil}`;
    case "modulo_liberado":
      return `${ator} liberou a tela nova ${tela} para ${plural(Number(d.adicionados ?? 0), "pessoa", "pessoas")}`;
    case "modulo_acessos_alterados":
      return `${ator} alterou quem acessa a tela nova ${tela}: +${d.adicionados ?? 0} / −${d.removidos ?? 0}`;
    case "modulo_bloqueado":
      return `${ator} bloqueou de novo a tela nova ${tela}`;
    case "usuario_criado":
      return `${ator} criou o login de ${alvo}${d.email ? ` (${d.email})` : ""}`;
    case "usuario_excluido":
      return `${ator} excluiu o login de ${d.nome || alvo}${d.email ? ` (${d.email})` : ""}`;
    case "conta_desativada":
      return `${ator} desativou a conta de ${alvo}`;
    case "conta_ativada":
      return `${ator} reativou a conta de ${alvo}`;
    case "cadastro_alterado":
      return proprio ? `${ator} alterou o próprio cadastro` : `${ator} alterou o cadastro de ${alvo}`;
    case "login_vinculado":
      return `${ator} vinculou o login de ${alvo} ao empregado ${d.empregado_nome ?? `#${d.empregado_id}`}` +
        (d.login_anterior ? ` (antes era de ${d.login_anterior_nome ?? "outro login"})` : "");
    case "login_desvinculado":
      return `${ator} desvinculou o login de ${alvo} do empregado ${d.empregado_nome ?? `#${d.empregado_id}`}`;
    case "redefinir_senha":
      return `${ator} redefiniu a senha de ${alvo}`;
    case "alterar_email":
      return `${ator} trocou o e-mail de login de ${alvo}${d.email_novo ? ` para ${d.email_novo}` : ""}`;
    case "encerrar_sessao":
      return `${ator} encerrou as sessões abertas de ${alvo}`;
    case "entrou":
      return `${alvo} entrou no sistema`;
    case "saiu":
      return `${alvo} saiu do sistema`;
    case "abriu_erp":
      return `${alvo} abriu o ERP`;
    case "recuperacao_senha":
      return `${alvo} pediu recuperação de senha`;
    case "senha_trocada":
      return `${alvo} trocou a própria senha`;
    case "registro_criado":
      return `${ator} criou um registro em ${d.tabela}`;
    case "registro_alterado":
      return `${ator} alterou um registro em ${d.tabela}`;
    case "registro_excluido":
      return `${ator} excluiu um registro em ${d.tabela}`;
    default:
      return `${ator}: ${e.evento.replace(/_/g, " ")}`;
  }
}

/** Rótulo curto do selo à esquerda da linha. */
export function seloEvento(e: Pick<EventoAuditoria, "evento" | "tipo">): { texto: string; tom: "sucesso" | "perigo" | "aviso" | "neutro" } {
  const ev = e.evento;
  if (["perfil_concedido", "papel_concedido", "modulo_liberado", "usuario_criado", "conta_ativada", "login_vinculado"].includes(ev))
    return { texto: "Concedeu", tom: "sucesso" };
  if (["perfil_removido", "papel_removido", "usuario_excluido", "conta_desativada", "login_desvinculado", "modulo_bloqueado", "perfil_excluido", "registro_excluido"].includes(ev))
    return { texto: "Retirou", tom: "perigo" };
  if (ev === "permissoes_usuario" || ev === "permissoes_perfil" || ev === "modulo_acessos_alterados") return { texto: "Permissão", tom: "aviso" };
  if (ev === "entrou" || ev === "abriu_erp") return { texto: "Entrada", tom: "neutro" };
  if (ev === "saiu") return { texto: "Saída", tom: "neutro" };
  if (["redefinir_senha", "alterar_email", "encerrar_sessao", "recuperacao_senha", "senha_trocada"].includes(ev))
    return { texto: "Segurança", tom: "aviso" };
  return { texto: "Alteração", tom: "neutro" };
}

/** Linhas de detalhe (o que aparece ao expandir), sem o JSON cru. */
export function linhasDetalhe(e: EventoAuditoria): string[] {
  const d = e.detalhes ?? {};
  const out: string[] = [];
  if (Array.isArray(d.itens)) {
    for (const i of d.itens) out.push(descreverItemPermissao(i));
  }
  if (d.campos) {
    for (const c of listarCamposAlterados(d.campos)) out.push(`${c.rotulo}: ${c.antes} → ${c.depois}`);
  }
  if (e.evento.startsWith("modulo_")) {
    if (Array.isArray(d.setores) && d.setores.length) out.push(`Setores escolhidos: ${d.setores.join(", ")}`);
    if (Array.isArray(d.cargos) && d.cargos.length) out.push(`Cargos escolhidos: ${d.cargos.join(", ")}`);
    if (d.pessoas_com_acesso != null) out.push(`Pessoas com acesso depois: ${d.pessoas_com_acesso}`);
  }
  if (d.ip) out.push(`IP: ${d.ip}`);
  if (d.metodo) out.push(`Método: ${d.metodo === "email" ? "e-mail e senha" : d.metodo}`);
  if (d.navegador) out.push(`Navegador: ${String(d.navegador).slice(0, 140)}`);
  if (d.tabela && d.registro) out.push(`Registro: ${d.tabela} #${d.registro}`);
  return out;
}

export type PresetPeriodo = "hoje" | "7d" | "30d" | "90d" | "personalizado";

/** Período em instantes UTC; dias contados no calendário de Brasília. */
export function periodoDoPreset(p: Exclude<PresetPeriodo, "personalizado">, agora = new Date()): { de: Date; ate: Date } {
  const dias = { hoje: 1, "7d": 7, "30d": 30, "90d": 90 }[p];
  const hojeBr = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  // Brasília não tem horário de verão desde 2019: meia-noite = 03:00 UTC
  const inicioHoje = new Date(`${hojeBr}T00:00:00-03:00`);
  const de = new Date(inicioHoje.getTime() - (dias - 1) * 86_400_000);
  const ate = new Date(inicioHoje.getTime() + 86_400_000);
  return { de, ate };
}

/** "2026-11-01" (data do input) → início do dia em Brasília. */
export function inicioDoDiaBrasilia(data: string): Date {
  return new Date(`${data}T00:00:00-03:00`);
}

function escCsv(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV (separador ;, com BOM para o Excel) do que está filtrado. */
export function eventosParaCsv(eventos: EventoAuditoria[]): string {
  const tipo = Object.fromEntries(TIPOS_AUDITORIA.map((t) => [t.id, t.rotulo]));
  const cab = ["Data e hora (Brasília)", "Tipo", "Quem fez", "Pessoa afetada", "O que aconteceu", "Detalhes"];
  const linhas = eventos.map((e) => [
    formatarDataHora(e.ts),
    tipo[e.tipo] ?? e.tipo,
    e.ator_nome || (e.ator_id ? "Usuário removido" : SISTEMA),
    e.alvo_nome ?? "",
    fraseEvento(e),
    linhasDetalhe(e).join(" | "),
  ]);
  return "﻿" + [cab, ...linhas].map((l) => l.map(escCsv).join(";")).join("\r\n");
}
