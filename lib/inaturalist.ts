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

  type INatTaxon = { id: number; name: string; preferred_common_name?: string; rank: string; iconic_taxon_name?: string };
  type INatRawResult = { taxon?: INatTaxon | null; combined_score: number };
  // iNat occasionally returns taxon: null for unranked results. The old
  // any-typed mapper crashed on r.taxon.id; we filter then map (audit M15).
  return (json.results ?? [])
    .filter((x: INatRawResult): x is INatRawResult & { taxon: INatTaxon } => x.taxon != null)
    .slice(0, 5)
    .map((x: INatRawResult & { taxon: INatTaxon }) => ({
      taxonId: x.taxon.id,
      commonName: x.taxon.preferred_common_name ?? x.taxon.name,
      scientificName: x.taxon.name,
      rank: x.taxon.rank,
      // iNat returns combined_score on a 0-100 scale; downstream code expects 0-1.
      score: x.combined_score / 100,
      iconicTaxon: x.taxon.iconic_taxon_name ?? null,
    }));
}
