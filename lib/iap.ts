// IAP via RevenueCat. Native (iOS) only. On web/Android these are no-ops so
// the rest of the app keeps working.

import { Platform } from 'react-native';
import { supabase } from './supabase';

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

export async function purchase(pkg: any) {
  if (Platform.OS !== 'ios') throw new Error('Purchases are only available on iOS');
  const Purchases = (await import('react-native-purchases')).default;
  const { customerInfo, productIdentifier } = await Purchases.purchasePackage(pkg);
  const grant = PRODUCT_GRANTS[productIdentifier];
  if (grant) {
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
  const Purchases = (await import('react-native-purchases')).default;
  const info = await Purchases.getCustomerInfo();
  return info.entitlements.active['pro'] !== undefined;
}
