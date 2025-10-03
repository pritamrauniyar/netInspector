import { Injectable } from '@angular/core';

/**
 * Minimal device detector service to avoid external dependency.
 * Provides the small surface the app expects: getDeviceInfo, isDesktop, isMobile, isTablet.
 */
@Injectable({ providedIn: 'root' })
export class DeviceDetectorService {
  getDeviceInfo() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const width = typeof window !== 'undefined' ? window.innerWidth : 0;
    const height = typeof window !== 'undefined' ? window.innerHeight : 0;

    const os = this.getOS(ua);
    const browser = this.getBrowser(ua);
    const osVersion = this.getOSVersion(ua, os);
    const browserVersion = this.getBrowserVersion(ua, browser);
    const deviceType = this.getDeviceType(ua, width);
    const deviceModel = this.getDeviceModel(ua);

    // system details
    const hardwareConcurrency = (navigator as any).hardwareConcurrency || null;
    const deviceMemory = (navigator as any).deviceMemory || null;
    const screenDPI = this.getScreenDPI();
    const gpu = this.getWebGLInfo();

    // Basic client hints available synchronously
    const uaData = (navigator as any).userAgentData || null;
    const brands = uaData?.brands || uaData?.brands || null;
    const platformHint = uaData?.platform || null;

    // Additional accessible properties
    const platform = navigator.platform || null;
    const colorDepth = (typeof window !== 'undefined' && window.screen) ? (window.screen.colorDepth || null) : null;
    const pixelDepth = (typeof window !== 'undefined' && window.screen) ? (window.screen.pixelDepth || null) : null;
    const maxTouchPoints = (navigator as any).maxTouchPoints || 0;
    const languages = (navigator as any).languages || [navigator.language];

    // Note: temperature and deep hardware telemetry are not available in a browser sandbox.
    // For those, a small native helper (Electron/Node agent or platform-specific service) is required.
    const temperature = null;

    return {
      userAgent: ua,
      uaBrands: brands,
      uaPlatformHint: platformHint,
      platform,
      os,
      osVersion,
      browser,
      browserVersion,
      deviceType,
      deviceModel,
      hardwareConcurrency,
      deviceMemory,
      deviceMemoryMB: deviceMemory ? deviceMemory * 1024 : null,
      screenDPI,
      colorDepth,
      pixelDepth,
      maxTouchPoints,
      languages,
      gpu,
      width,
      height,
      temperature,
    };
  }

  /**
   * Returns a richer device info object by querying high-entropy client hints
   * where supported. This returns a Promise because getHighEntropyValues is async.
   * It complements getDeviceInfo() and will include fields like architecture, model,
   * platformVersion when available.
   */
  async getFullDeviceInfo(){
    const base = this.getDeviceInfo();
    try{
      const uaData = (navigator as any).userAgentData;
      if(uaData && typeof uaData.getHighEntropyValues === 'function'){
        const hints = await uaData.getHighEntropyValues(['architecture','model','platformVersion','uaFullVersion','bitness']);
        return Object.assign({}, base, hints);
      }
    }catch(e){/* ignore */}
    return base;
  }

  private getScreenDPI() {
    try{
      if (typeof window === 'undefined') return null;
      const dpi = window.devicePixelRatio || 1;
      const inch = 96; // assume 96 CSS px per inch baseline
      return dpi * inch;
    }catch(e){return null}
  }

  private getWebGLInfo(){
    try{
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if(!gl) return { vendor: '', renderer: '' };
      const dbg = ((gl as any).getExtension && ((gl as any).getExtension('WEBGL_debug_renderer_info') as any));
      if (dbg && typeof (gl as any).getParameter === 'function'){
        const vendor = (gl as any).getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        const renderer = (gl as any).getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        return { vendor, renderer };
      }
      return { vendor: '', renderer: '' };
    }catch(e){return {vendor:'',renderer:''}}
  }

  isMobile(): boolean {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (typeof window !== 'undefined' && window.innerWidth <= 767);
  }

  isTablet(): boolean {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return /Tablet|iPad/i.test(ua) || (typeof window !== 'undefined' && window.innerWidth > 767 && window.innerWidth <= 1024);
  }

  isDesktop(): boolean {
    return !this.isMobile() && !this.isTablet();
  }

  private getOS(ua: string) {
    if (/Windows NT/i.test(ua)) return 'Windows';
    if (/Mac OS X/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    return 'Unknown';
  }

  private getOSVersion(ua: string, os: string) {
    try {
      if (os === 'Windows') {
        const m = ua.match(/Windows NT ([0-9._]+)/i);
        return m ? m[1] : '';
      }
      if (os === 'macOS') {
        const m = ua.match(/Mac OS X ([0-9_\.]+)/i);
        return m ? m[1].replace(/_/g, '.') : '';
      }
      if (os === 'Android') {
        const m = ua.match(/Android ([0-9.]+)/i);
        return m ? m[1] : '';
      }
      if (os === 'iOS') {
        const m = ua.match(/OS ([0-9_]+) like Mac OS X/i);
        return m ? m[1].replace(/_/g, '.') : '';
      }
    } catch (e) {
      // ignore
    }
    return '';
  }

  private getBrowser(ua: string) {
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua) || /Opera\//i.test(ua)) return 'Opera';
    if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua) && !/OPR\//i.test(ua)) return 'Chrome';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
    return 'Unknown';
  }

  private getBrowserVersion(ua: string, browser: string) {
    try {
      let m: RegExpMatchArray | null = null;
      switch (browser) {
        case 'Chrome':
          m = ua.match(/Chrome\/([0-9.]+)/i);
          break;
        case 'Firefox':
          m = ua.match(/Firefox\/([0-9.]+)/i);
          break;
        case 'Safari':
          m = ua.match(/Version\/([0-9.]+)/i) || ua.match(/Safari\/([0-9.]+)/i);
          break;
        case 'Edge':
          m = ua.match(/Edg\/([0-9.]+)/i);
          break;
        case 'Opera':
          m = ua.match(/OPR\/([0-9.]+)/i) || ua.match(/Opera\/([0-9.]+)/i);
          break;
      }
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  private getDeviceType(ua: string, width: number) {
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'Mobile';
    if (/iPad|Tablet/i.test(ua)) return 'Tablet';
    if (width && width <= 767) return 'Mobile';
    if (width && width > 767 && width <= 1024) return 'Tablet';
    return 'Desktop';
  }

  private getDeviceModel(ua: string) {
    // Try to extract common device model tokens from UA (best-effort)
    const m = ua.match(/\(([^)]+)\)/);
    if (!m) return '';
    const inside = m[1];
    // On mobile UAs, model sometimes appears after semicolon
    const parts = inside.split(';').map(p => p.trim());
    // Return a plausible token (e.g., "SM-G991B" or "iPhone")
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (/\b(iphone|ipad|ipod|SM-|Pixel|Nexus|HUAWEI|HONOR|Mi |M\d|Moto|LG|HTC)\b/i.test(p)) {
        return p;
      }
    }
    return '';
  }
}
