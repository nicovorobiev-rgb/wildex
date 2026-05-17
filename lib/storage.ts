import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

export async function uploadCaptureImage(localUri: string, captureId: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const path = `${captureId}.jpg`;
  const { error } = await supabase.storage
    .from('captures')
    .upload(path, decode(b64), { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('captures').getPublicUrl(path);
  return data.publicUrl;
}
