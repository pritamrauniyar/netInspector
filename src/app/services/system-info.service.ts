import { Injectable } from '@angular/core';

export interface BatteryInfo {
  level?: number | null;
  charging?: boolean | null;
}

export interface GeolocationInfo {
  latitude?: number | null;
  longitude?: number | null;
}

@Injectable({ providedIn: 'root' })
export class SystemInfoService {
  async getBattery(): Promise<BatteryInfo | null>{
    try{
      const nav = navigator as any;
      if(typeof nav.getBattery === 'function'){
        const b = await nav.getBattery();
        return { level: Math.round((b.level ?? 0) * 100), charging: !!b.charging };
      }
    }catch(e){}
    return null;
  }

  async getGeolocation(): Promise<GeolocationInfo | null>{
    if(!('geolocation' in navigator)) return null;
    return new Promise((resolve)=>{
      navigator.geolocation.getCurrentPosition((pos)=>{
        resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      }, ()=> resolve(null), { enableHighAccuracy:false, timeout:5000 });
    });
  }

  getTimeZone(): string | null {
    try{
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    }catch(e){return null}
  }
}
