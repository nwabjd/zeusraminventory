import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'AED'): string {
  return `${currency} ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-GB'); // DD/MM/YYYY
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateSKU(generation: string, category: string, capacity: string, speed: string, count: number = 1): string {
  const gen = generation.toUpperCase().replace('DDR', 'D');
  const cat = category.toUpperCase().substring(0, 3);
  const cap = capacity.replace(/\s+/g, '').replace('GB', '');
  const spd = speed.replace(/[^\d]/g, '');
  const num = String(count).padStart(3, '0');
  return `Z-${gen}-${cat}-${cap}-${spd}-${num}`;
}

export function generatePurchaseNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const timestamp = Date.now().toString().slice(-4);
  return `PUR-${year}${month}${day}-${timestamp}`;
}

export function generateSaleNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const timestamp = Date.now().toString().slice(-4);
  return `SAL-${year}${month}${day}-${timestamp}`;
}

export function generatePaymentId(): string {
  const timestamp = Date.now().toString().slice(-6);
  return `PAY-${timestamp}`;
}
