import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ConnectionInfo {
  type?: string | null;
  effectiveType?: string | null;
  downlink?: number | null;
  rtt?: number | null;
}

@Injectable({ providedIn: 'root' })
export class NetworkInfoService {
  private connection$ = new BehaviorSubject<ConnectionInfo | null>(null);

  constructor(){
    this.refresh();
    // listen to changes if supported
    try{
      const nav = navigator as any;
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
      if(conn && typeof conn.addEventListener === 'function'){
        conn.addEventListener('change', ()=> this.refresh());
      }
    }catch(e){/* ignore */}
  }

  get connection(){
    return this.connection$.asObservable();
  }

  refresh(){
    try{
      const nav = navigator as any;
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
      if(!conn){
        this.connection$.next(null);
        return;
      }
      const info: ConnectionInfo = {
        type: conn.type ?? null,
        effectiveType: conn.effectiveType ?? null,
        downlink: conn.downlink ?? null,
        rtt: conn.rtt ?? null
      };
      this.connection$.next(info);
    }catch(e){
      this.connection$.next(null);
    }
  }
}
