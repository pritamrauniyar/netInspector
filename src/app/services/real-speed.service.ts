import { Injectable } from '@angular/core';

/**
 * RealSpeedService - single clean implementation
 */
@Injectable({ providedIn: 'root' })
export class RealSpeedService {
  constructor() {}

  async downloadTest(serverUrl: string, sizeMB = 5): Promise<number> {
    const start = performance.now();
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/download?sizeMB=${sizeMB}`);
    if(!res.body) {
      const blob = await res.blob();
      const bytes = blob.size;
      const duration = (performance.now() - start) / 1000;
      return (bytes * 8) / (duration * 1000 * 1000);
    }
    const reader = res.body.getReader();
    let received = 0;
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      received += value ? (value.length ?? value.byteLength ?? 0) : 0;
    }
    const duration = (performance.now() - start) / 1000;
    return (received * 8) / (duration * 1000 * 1000);
  }

  async uploadTest(serverUrl: string, sizeMB = 2): Promise<number> {
    const bytes = Math.max(1, Math.floor(sizeMB * 1024 * 1024));
    const payload = new Uint8Array(bytes);
    const start = performance.now();
    const res = await fetch(`${serverUrl.replace(/\/$/, '')}/upload`, { method: 'POST', body: payload });
    const json = await res.json().catch(()=>null);
    const duration = (performance.now() - start) / 1000;
    const uploaded = json && json.received ? json.received : bytes;
    return (uploaded * 8) / (duration * 1000 * 1000);
  }
}
