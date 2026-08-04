import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Mensagem de verdade de uma edge function que falhou.
 *
 * `supabase.functions.invoke` devolve só "Edge Function returned a non-2xx
 * status code" e joga fora o corpo — que é justamente onde a função explica o
 * que houve. O corpo fica em `error.context`, um Response ainda não lido.
 */
export async function erroDaFunction(error: any): Promise<string> {
  const generico = String(error?.message ?? error ?? "Falha desconhecida");
  try {
    const resp = error?.context;
    if (resp && typeof resp.json === "function") {
      const corpo = await resp.clone().json();
      const detalhe = corpo?.detalhe?.error?.message ?? corpo?.detalhe?.message ?? null;
      if (corpo?.error) return detalhe ? `${corpo.error} — ${detalhe}` : String(corpo.error);
    }
  } catch {
    // corpo não era JSON: fica o genérico mesmo
  }
  return generico;
}

/**
 * UUID que funciona fora de contexto seguro.
 *
 * `crypto.randomUUID` só existe em HTTPS ou localhost, e a produção é acessada
 * por IP em HTTP (http://192.168.100.17:8080) — lá a função nem sequer está
 * definida, e a chamada quebra a tela com "crypto.randomUUID is not a function".
 * O fallback usa getRandomValues, que existe em qualquer contexto, e só cai no
 * Math.random se nem isso houver.
 */
export function novoUuid(): string {
  const c: any = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();

  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);

  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante
  const h = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
