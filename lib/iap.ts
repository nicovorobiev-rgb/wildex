// In-App Purchase via RevenueCat. RevenueCat handles Apple receipt validation
// and webhooks; we then grant items server-side from a webhook (preferred) or
// the client (for local dev / TestFlight before webhooks are wired).
//
// Production setup:
// 1. RevenueCat dashboard → add iOS app with bundle id com.wildex.app
// 2. Create products in App Store Connect: wildex.growth_treat_5, wildex.age_tonic_1, wildex.pro_monthly
// 3. Create entitlements in RevenueCat: "pro" → wildex.pro_monthly
// 4. Create offerings → "default" with the 3 products
// 5. Set webhook URL to a Supabase Edge Function (`/grant-purchase`) that
//    calls `grant_purchase` RPC. Until then, the app calls the RPC directly.

import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Map App Store product ids to inventory items + quantities granted.
const PRODUCT_GRANTS: Record<string, { item: string; qty: number }> = {
  'wildex.growth_treat_5': { item: 'growth_treat', qty: 5 },
  'wildex.age_tonic_1': { item: 'age_tonic', qty: 1 },
};

export async function initIAP(rcApiKey: string, appUserId?: string) {
  if (Platform.OS !== 'ios') return; // Wildex is iOS-only at launch.
  Purchases.setLogLevel(LOG_LEVEL.WARN);
  await Purchases.configure({ apiKey: rcApiKey, appUserID: appUserId });
}

export async function getOfferings(): Promise<PurchasesPackage[]> {
  const o = await Purchases.getOfferings();
  return o.current?.availablePackages ?? [];
}

export async function purchase(pkg: PurchasesPackage) {
  const { customerInfo, productIdentifier } = await Purchases.purchasePackage(pkg);
  const grant = PRODUCT_GRANTS[productIdentifier];
  if (grant) {
    // Until the webhook is live, client grants the item. Server-side webhook
    // is the eventual source of truth and will reconcile.
    await supabase.rpc('grant_purchase', {
      p_item: grant.item,
      p_qty: grant.qty,
      p_receipt: productIdentifier,
    });
  }
  return customerInfo;
}

export async function isPro(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const info = await Purchases.getCustomerInfo();
  return info.entitlements.active['pro'] !== undefined;
}
