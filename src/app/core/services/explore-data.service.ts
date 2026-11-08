import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, shareReplay } from 'rxjs';
import { ExploreIndex, LoadedProtein, ProteinDoc } from '../models/explore.model';

const BASE = 'explore-data';
const KEEP = 12;   // proteins kept in memory (going back and forth between a few proteins is the common case)

/** gzip bytes -> text. A server may already have decoded the file (Content-Encoding: gzip): then it is plain text. */
export async function gunzipText(bytes: ArrayBuffer): Promise<string> {
  const data = new Uint8Array(bytes);
  if (data[0] === 0x1f && data[1] === 0x8b) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(data);
}

/** Reads the static data of the Explore page (public/explore-data). No backend involved. */
@Injectable({ providedIn: 'root' })
export class ExploreDataService {
  private http = inject(HttpClient);
  private index$?: Observable<ExploreIndex>;
  private proteins = new Map<string, Promise<LoadedProtein>>();

  index(): Observable<ExploreIndex> {
    this.index$ ??= this.http.get<ExploreIndex>(`${BASE}/index.json`).pipe(shareReplay(1));
    return this.index$;
  }

  protein(id: string): Promise<LoadedProtein> {
    const known = this.proteins.get(id);
    if (known) {
      this.proteins.delete(id);      // most recently used goes last
      this.proteins.set(id, known);
      return known;
    }
    const loading = this.fetchProtein(id);
    loading.catch(() => this.proteins.delete(id));
    this.proteins.set(id, loading);
    if (this.proteins.size > KEEP) {
      this.proteins.delete(this.proteins.keys().next().value as string);
    }
    return loading;
  }

  private async fetchProtein(id: string): Promise<LoadedProtein> {
    const [doc, gz] = await Promise.all([
      firstValueFrom(this.http.get<ProteinDoc>(`${BASE}/proteins/${id}.json`)),
      firstValueFrom(this.http.get(`${BASE}/structures/${id}.pdb.gz`, { responseType: 'arraybuffer' })),
    ]);
    return { doc, pdb: await gunzipText(gz) };
  }
}
