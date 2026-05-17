// iNaturalist Computer Vision identification.
// Docs: https://www.inaturalist.org/pages/api+reference
// The /v1/computervision/score_image endpoint accepts an image and returns
// ranked species suggestions. For production you need an API token.

export type IdSuggestion = {
  taxonId: number;
  commonName: string;
  scientificName: string;
  rank: string;
  score: number;
  iconicTaxon: string | null;
};

const API = 'https://api.inaturalist.org/v1';

export async function identifyAnimal(imageUri: string, token?: string): Promise<IdSuggestion[]> {
  const form = new FormData();
  // @ts-expect-error RN FormData accepts {uri,name,type}
  form.append('image', { uri: imageUri, name: 'capture.jpg', type: 'image/jpeg' });

  const res = await fetch(`${API}/computervision/score_image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  const json = await res.json();

  return (json.results ?? []).slice(0, 5).map((r: any) => ({
    taxonId: r.taxon.id,
    commonName: r.taxon.preferred_common_name ?? r.taxon.name,
    scientificName: r.taxon.name,
    rank: r.taxon.rank,
    score: r.combined_score,
    iconicTaxon: r.taxon.iconic_taxon_name ?? null,
  }));
}
