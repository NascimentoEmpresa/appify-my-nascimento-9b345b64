import type { SupabaseClient } from "@supabase/supabase-js";

// =====================================================================
// ENVIO ÚNICO: o mesmo INSERT repetido em poucos segundos sai uma vez só
// (26/10/2026)
//
// O caso: a encarregada registrou a advertência verbal do AILTON ALVANDIR
// RITZ COUTO e saíram 8 solicitações iguais (#56 a #63, todas 13/10/2026 às
// 11:15). O botão "Registrar" continua clicável enquanto o primeiro envio
// está indo; cada clique virou um INSERT. Pedido do Pablo: "deixa um
// ratelimit nos botões de solicitar, pra isso não acontecer em nenhum outro
// sistema e não duplicar".
//
// São centenas de botões de enviar no ERP, cada um com o seu jeito. Em vez de
// mexer em um por um (e esquecer algum), a trava fica no ponto por onde todos
// passam: a execução da chamada do supabase-js (PostgrestBuilder.then). Se
// sair o MESMO insert — mesma tabela, mesmos parâmetros, mesmo corpo — enquanto
// o anterior ainda está indo ou até JANELA_MS depois de ele dar certo, o
// segundo não vai ao banco: recebe a mesma resposta do primeiro (mesmo id).
// A tela segue igual (toast, fechar modal) e o banco fica com uma linha só.
//
//   · Só INSERT em tabela (POST fora de /rpc/, sem upsert). Upsert já é
//     idempotente; RPC pode ser leitura repetida de propósito.
//   · Envio que deu ERRO não fica guardado: tentar de novo funciona na hora.
//   · Corpo diferente (outro colaborador, outra descrição) passa normal.
//
// No banco, o gatilho solicitacao_bloqueia_envio_repetido (mig
// 20261026000030) é a segunda trava, para o que escapar daqui (duas abas,
// outro aparelho).
// =====================================================================

export const JANELA_MS = 4000;

type Resultado = { error?: unknown } & Record<string, unknown>;
type Then = (this: unknown, ok?: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise<unknown>;
type Builder = { method?: string; url?: URL | string; headers?: Headers | Record<string, string>; body?: unknown };

const MARCA = "__envioUnico";
const recentes = new Map<string, Promise<Resultado>>();

function cabecalho(h: Builder["headers"], nome: string): string {
  if (!h) return "";
  if (typeof (h as Headers).get === "function") return (h as Headers).get(nome) ?? "";
  return (h as Record<string, string>)[nome] ?? (h as Record<string, string>)[nome.toLowerCase()] ?? "";
}

/** Chave do envio, ou null quando não é um INSERT que deva ser travado. */
export function chaveDoEnvio(b: Builder): string | null {
  if (b.method !== "POST" || b.body == null || typeof b.body !== "object") return null;
  const url = String(b.url ?? "");
  if (url.includes("/rpc/")) return null;
  const prefer = cabecalho(b.headers, "Prefer");
  if (/resolution=/.test(prefer)) return null;   // upsert
  let corpo: string;
  try { corpo = JSON.stringify(b.body); } catch { return null; }
  return `${url}\n${prefer}\n${corpo}`;
}

/** Executa `rodar` uma vez por chave enquanto estiver em andamento ou recente. */
export function umaVez(chave: string, rodar: () => Promise<Resultado>, janelaMs = JANELA_MS): Promise<Resultado> {
  const ja = recentes.get(chave);
  if (ja) return ja;
  const p = rodar().then(
    (r) => {
      if (r && r.error) recentes.delete(chave);
      else setTimeout(() => { if (recentes.get(chave) === p) recentes.delete(chave); }, janelaMs);
      return r;
    },
    (e) => { recentes.delete(chave); throw e; },
  );
  recentes.set(chave, p);
  return p;
}

export function instalarEnvioUnico(cliente: SupabaseClient<any, any, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Sobe a cadeia de protótipos de um builder até a classe que define o
  // then (PostgrestBuilder) — pela instância, como em insertComDefault.ts.
  let proto = Object.getPrototypeOf(cliente.from("__").select()) as Record<string, unknown> | null;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, "then")) proto = Object.getPrototypeOf(proto);
  if (!proto || proto[MARCA]) return;
  const original = proto.then as Then;
  proto.then = function (this: Builder, ok?: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
    const chave = chaveDoEnvio(this);
    if (!chave) return original.call(this, ok, erro);
    return umaVez(chave, () => original.call(this) as Promise<Resultado>).then(ok, erro);
  };
  proto[MARCA] = true;
}
