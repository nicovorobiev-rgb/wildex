import { Platform } from 'react-native';
import { supabase } from './supabase';

export async function uploadCaptureImage(localUri: string, captureId: string): Promise<string> {
  const path = `${captureId}.jpg`;
  let body: Blob | ArrayBuffer;

  if (Platform.OS === 'web') {
    const res = await fetch(localUri);
    body = await res.blob();
  } else {
    const FileSystem = await import('expo-file-system');
    const { decode } = await import('base64-arraybuffer');
    const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    body = decode(b64);
  }

  const { error } = await supabase.storage
    .from('captures')
    .upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return supabase.storage.from('captures').getPublicUrl(path).data.publicUrl;
}
