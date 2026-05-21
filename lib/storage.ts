import { Platform } from 'react-native';
import { supabase } from './supabase';

// Capture photos are private. Closes audit H-code-9 (getPublicUrl on private
// bucket returns a 403 URL) and H-sec-3/4 (mass photo leak + cross-user
// overwrite). The bucket must be set to **private** in the Supabase dashboard
// and the Storage RLS policies in schema.sql must be applied — without those
// the path namespacing alone doesn't prevent reads.

const BUCKET = 'captures';

export async function uploadCaptureImage(localUri: string, captureId: string): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  // Namespace by user.id so Storage RLS can gate by folder
  // (`(storage.foldername(name))[1] = auth.uid()::text` in schema.sql).
  const path = `${user.id}/${captureId}.jpg`;
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

  // upsert: false — Storage RLS already restricts INSERT to the user's own
  // folder, but failing fast on accidental re-upload of the same captureId
  // is good defense-in-depth (audit H4).
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw upErr;

  // Return the storage path (NOT a public URL). The dex/battle screens must
  // call signCaptureUrl() to render — signed URLs expire, so we never persist
  // them in captures.image_url. This is the documented private-bucket pattern.
  return path;
}

// Mint a short-lived signed URL for displaying a capture image. Default 1h.
// Use this from any screen that renders a capture photo; do not pass the raw
// path to <Image src=>.
export async function signCaptureUrl(path: string, expiresSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresSec);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not sign URL');
  return data.signedUrl;
}
