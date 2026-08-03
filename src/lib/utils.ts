import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
