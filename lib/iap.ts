// IAP via RevenueCat. Native (iOS) only. On web/Android these are no-ops so
// the rest of the app keeps working.
//
// Audit M4 — the rcApiKey passed to initIAP MUST be the PUBLIC iOS SDK key
// from RevenueCat (starts with `appl_`), NOT the secret API key. The secret
// key would leak to every web visitor's JS bundle. The secret key stays in
// Supabase secrets and is used server-side by the RC webhook function
// (supabase/functions/revenuecat-webhook).

import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

const PRODUCT_GRANTS: Record<string, { item: string; qty: number }> = {
  'wildex.growth_treat_5': { item: 'growth_treat', qty: 5 },
  'wildex.age_tonic_1': { item: 'age_tonic', qty: 1 },
};

export async function initIAP(rcApiKey: string, appUserId?: string) {
  if (Platform.OS !== 'ios') return;
  const Purchases = (await import('react-native-purchases')).default;
  const { LOG_LEVEL } = await import('react-native-purchases');
  Purchases.setLogLevel(LOG_LEVEL.WARN);
  await Purchases.configure({ apiKey: rcApiKey, appUserID: appUserId });
}

export async function getOfferings() {
  if (Platform.OS !== 'ios') return [];
  const Purchases = (await import('react-native-purchases')).default;
  const o = await Purchases.getOfferings();
  return o.current?.availablePackages ?? [];
}

export async function purchase(pkg: PurchasesPackage) {  // audit M17
  if (Platform.OS !== 'ios') throw new Error('Purchases are only available on iOS');
  const Purchases = (await import('react-native-purchases')).default;
  const { customerInfo, productIdentifier } = await Purchases.purchasePackage(pkg);
  // Inventory is granted server-side by the RevenueCat webhook
  // (supabase/functions/revenuecat-webhook) — the client `grant_purchase`
  // RPC now rejects non-service-role callers (audit C-sec-5). We still
  // check the SKU here so an unmapped product surfaces loudly to the user
  // instead of silently no-op'ing (audit H-code-11).
  if (!PRODUCT_GRANTS[productIdentifier]) {
    console.error('[iap] Unknown product SKU:', productIdentifier);
    throw new Error(`Purchase recorded for "${productIdentifier}" but no inventory mapping exists. Restart the app — items are granted via webhook.`);
  }
  return customerInfo;
}

export async function isPro(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const Purchases = (await import('react-native-purchases')).default;
  const info = await Purchases.getCustomerInfo();
  return info.entitlements.active['pro'] !== undefined;
}
