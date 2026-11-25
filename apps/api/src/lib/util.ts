import crypto from 'node:crypto';

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `item-${crypto.randomBytes(3).toString('hex')}`;
}

export function formatMoney(cents: number, currency = 'EGP'): string {
  return `${(cents / 100).toLocaleString('en-US')} ${currency}`;
}
