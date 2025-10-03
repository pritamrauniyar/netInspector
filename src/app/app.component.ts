
import { Component, OnInit } from '@angular/core';
import { DeviceDetectorService } from './services/device-detector.service';
import { SpeedTestService } from './services/speed-test.service';
import { Subscription, interval } from 'rxjs';
import { NetworkInfoService, ConnectionInfo } from './services/network-info.service';
import { SystemInfoService, BatteryInfo, GeolocationInfo } from './services/system-info.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'speed-and-device-details';
  
  deviceInfo: any;
  orientation: string = '';
  downloadSpeed: string | null = null;
  uploadSpeed: string | null = null;
  isOnline$ = this.speedTestService.isOnline();
  downloadPulse = false;
  uploadPulse = false;
  downloadHistory: number[] = [];
  uploadHistory: number[] = [];
  private subs: Subscription[] = [];
  // real server tests removed; using simulated tests only
  connection: ConnectionInfo | null = null;
  battery: BatteryInfo | null = null;
  geolocation: GeolocationInfo | null = null;
  timezone: string | null = null;
  batteryUpdated = false;
  geolocationUpdated = false;
  // Diagnostics / performance
  perfScore: number | null = null;
  lastReportJson: string | null = null;

  constructor(
    private deviceService: DeviceDetectorService,
    private speedTestService: SpeedTestService,
    private networkInfo: NetworkInfoService,
    private systemInfo: SystemInfoService
  ) {}

  ngOnInit() {
    // Get device details
    this.deviceInfo = this.deviceService.getDeviceInfo();
    console.log(this.deviceInfo);
    this.orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';

    // Subscribe to speed observables and history
    this.subs.push(this.speedTestService.download.subscribe((v) => {
      if (v !== null) {
        this.downloadSpeed = v.toFixed(2);
        this.downloadPulse = true;
        setTimeout(()=> this.downloadPulse = false, 600);
      }
    }));
    this.subs.push(this.speedTestService.upload.subscribe((v) => {
      if (v !== null) {
        this.uploadSpeed = v.toFixed(2);
        this.uploadPulse = true;
        setTimeout(()=> this.uploadPulse = false, 600);
      }
    }));
    this.subs.push(this.speedTestService.downloadHistory.subscribe(h=> this.downloadHistory = h));
    this.subs.push(this.speedTestService.uploadHistory.subscribe(h=> this.uploadHistory = h));

  // Recompute performance score when histories update
  this.subs.push(this.speedTestService.downloadHistory.subscribe(()=> this.updatePerfScore()));
  this.subs.push(this.speedTestService.uploadHistory.subscribe(()=> this.updatePerfScore()));

  // network info subscription
  this.subs.push(this.networkInfo.connection.subscribe(c=> this.connection = c));

  // timezone
  this.timezone = this.systemInfo.getTimeZone();

  // Start periodic simulated tests every 3s
    const poll = interval(3000);
    this.subs.push(poll.subscribe(()=> this.speedTestService.startSimulatedTest()));

    this.speedTestService.isOnline().subscribe(
      (isOnline) => {
        if (isOnline === false) {
          console.log('Network unavailable.');
        }
      }
    );
  }

  private getAverage(values: number[]){
    if(!values || values.length===0) return 0;
    return values.reduce((a,b)=>a+b,0)/values.length;
  }

  updatePerfScore(){
    // Enhanced score out of 100 using concurrency, deviceMemory (MB), GPU, model heuristics, and recent speeds
    const concurrency = (this.deviceInfo?.hardwareConcurrency ?? 2);
    const deviceMemoryGB = (this.deviceInfo?.deviceMemory ?? 1);
    const deviceMemoryMB = deviceMemoryGB * 1024;
    const avgDL = this.getAverage(this.downloadHistory || []);
    const avgUL = this.getAverage(this.uploadHistory || []);

    // GPU heuristic: inspect vendor/renderer strings for known high/low performers
    const gpu = this.deviceInfo?.gpu || {};
    const renderer = (gpu.renderer || '').toLowerCase();
    const vendor = (gpu.vendor || '').toLowerCase();
    let gpuScore = 0.5; // default
    if(/nvidia|geforce|rtx|gtx/i.test(renderer) || /nvidia/i.test(vendor)) gpuScore = 1;
    else if(/intel/i.test(vendor) || /intel/i.test(renderer)) gpuScore = 0.7;
    else if(/mali|adreno|powervr|apple/i.test(renderer) || /arm|qualcomm|apple/i.test(vendor)) gpuScore = 0.65;

    // device model heuristics (best-effort boost for high-end reported models)
    const model = (this.deviceInfo?.deviceModel || '').toLowerCase();
    let modelBoost = 1;
    if(/iphone (1[1-9]|12|13|14|15)|sm-g9|sm-g99|pixel 6|pixel 7|pixel 8|mi 11|mi 12|oneplus 9|oneplus 10|moto g|huawei p/i.test(model)){
      modelBoost = 1.05; // small boost
    }

    // weights (redistribute to include gpu and model)
    const wConcurrency = 0.18;
    const wMemory = 0.17;
    const wSpeed = 0.55;
    const wGPU = 0.06;
    const wModel = 0.04;
    const wConnection = 0.0; // implicit via speed & effectiveType

    // normalize inputs
    const normConcurrency = Math.min(concurrency / 12, 1); // treat 12 threads as excellent
    const normMemory = Math.min(deviceMemoryMB / (8 * 1024), 1); // 8GB as ideal
    const normSpeed = Math.min((avgDL + avgUL) / 200, 1); // 200 Mbps -> ideal
    const normGPU = Math.min(Math.max(gpuScore, 0), 1);

    let raw = (normConcurrency * wConcurrency + normMemory * wMemory + normSpeed * wSpeed + normGPU * wGPU + modelBoost * wModel);
    const denom = (wConcurrency + wMemory + wSpeed + wGPU + wModel);
    raw = raw / denom;
    // clamp and scale
    this.perfScore = Math.round(Math.max(0, Math.min(1, raw)) * 100);
  }

  perfColor(score: number | null){
    if(score === null) return '#6b7280'; // gray
    if(score >= 80) return '#10b981'; // green
    if(score >= 50) return '#f59e0b'; // amber
    return '#ef4444'; // red
  }

  // --- Troubleshooter / QoE estimator ---
  qoe: { video720: string; video1080: string; voice: string } | null = null;
  recommendations: string[] = [];
  quickCheckRunning = false;

  // --- WebRTC loopback test ---
  private pcA: RTCPeerConnection | null = null;
  private pcB: RTCPeerConnection | null = null;
  private dcA: RTCDataChannel | null = null;
  private dcB: RTCDataChannel | null = null;
  webrtcRunning = false;
  webrtcStats: { rttSamples:number[]; jitterSamples:number[]; lossSamples:number[] } = { rttSamples:[], jitterSamples:[], lossSamples:[] };
  private statsIntervalHandle: any = null;

  async startWebRTCLoopback(){
    if(this.webrtcRunning) return;
    this.webrtcRunning = true;
    this.webrtcStats = { rttSamples:[], jitterSamples:[], lossSamples:[] };

    const cfg = {iceServers: []};
    this.pcA = new RTCPeerConnection(cfg);
    this.pcB = new RTCPeerConnection(cfg);

    // datachannel from A -> B
    this.dcA = this.pcA.createDataChannel('loop');
    this.dcA.binaryType = 'arraybuffer';

    this.pcB.ondatachannel = (ev) => {
      this.dcB = ev.channel;
      this.dcB.onmessage = (m) => {
        try{
          const obj = JSON.parse(m.data as string);
          if(obj.type === 'ping'){
            // respond with pong and original ts
            this.dcB?.send(JSON.stringify({type:'pong', ts: obj.ts}));
          }
        }catch(e){}
      };
    };

    // ICE candidate wiring
    this.pcA.onicecandidate = (e) => { if(e.candidate) this.pcB?.addIceCandidate(e.candidate); };
    this.pcB.onicecandidate = (e) => { if(e.candidate) this.pcA?.addIceCandidate(e.candidate); };

    const offer = await this.pcA.createOffer();
    await this.pcA.setLocalDescription(offer);
    await this.pcB.setRemoteDescription(offer);
    const answer = await this.pcB.createAnswer();
    await this.pcB.setLocalDescription(answer);
    await this.pcA.setRemoteDescription(answer);

    // when dcA open, start sending pings
    this.dcA.onopen = () => {
      const sendPing = () => {
        if(!this.dcA || this.dcA.readyState !== 'open' || !this.webrtcRunning) return;
        const ts = Date.now();
        try{ this.dcA.send(JSON.stringify({type:'ping', ts})); }catch(e){}
        // schedule next ping ~200ms
        setTimeout(sendPing, 200);
      };
      sendPing();
    };

    // handle pongs on A
    this.dcA.onmessage = (ev) => {
      try{
        const obj = JSON.parse(ev.data as string);
        if(obj.type === 'pong' && obj.ts){
          const now = Date.now();
          const rtt = now - obj.ts;
          this.webrtcStats.rttSamples.push(rtt);
          if(this.webrtcStats.rttSamples.length > 100) this.webrtcStats.rttSamples.shift();
        }
      }catch(e){}
    };

    // start periodic getStats polling
    this.statsIntervalHandle = setInterval(async ()=>{
      if(!this.pcA) return;
      try{
        const stats = await this.pcA.getStats();
        let rttEst = 0;
        let jitterEst = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        stats.forEach((report:any)=>{
          if(report.type === 'candidate-pair' && report.state === 'succeeded'){
            if(typeof report.currentRoundTripTime === 'number') rttEst = report.currentRoundTripTime * 1000; // seconds -> ms
          }
          if(report.type === 'inbound-rtp'){
            if(typeof report.jitter === 'number') jitterEst = Math.min(500, report.jitter * 1000);
            if(typeof report.packetsLost === 'number') packetsLost += report.packetsLost;
            if(typeof report.packetsReceived === 'number') packetsReceived += report.packetsReceived;
          }
        });
        if(rttEst) this.webrtcStats.rttSamples.push(Math.round(rttEst));
        if(jitterEst) this.webrtcStats.jitterSamples.push(Math.round(jitterEst));
        const lossPct = packetsReceived > 0 ? Math.round((packetsLost / (packetsLost + packetsReceived)) * 100) : 0;
        this.webrtcStats.lossSamples.push(lossPct);
        // keep arrays bounded
        ['rttSamples','jitterSamples','lossSamples'].forEach((k:any)=>{ const a:any=(this.webrtcStats as any)[k]; while(a.length>100) a.shift(); });
      }catch(e){/* ignore */}
    }, 1000);
  }

  stopWebRTCLoopback(){
    this.webrtcRunning = false;
    if(this.statsIntervalHandle) clearInterval(this.statsIntervalHandle);
    try{ this.dcA?.close(); this.dcB?.close(); }catch(e){}
    try{ this.pcA?.close(); this.pcB?.close(); }catch(e){}
    this.pcA = this.pcB = null;
    this.dcA = this.dcB = null;
  }

  evaluateQoE(){
    // Use perfScore, connection RTT, and avg speeds to make a best-effort QoE estimate
    const score = this.perfScore ?? 0;
    const rtt = this.connection?.rtt ?? 1000;
    const avgDL = this.getAverage(this.downloadHistory || []);
    const avgUL = this.getAverage(this.uploadHistory || []);

    // simple thresholds (best-effort)
    const video720 = (avgDL >= 3 && rtt < 200 && score >= 40) ? 'Good' : (avgDL >= 1.5 && score >= 30 ? 'Fair' : 'Poor');
    const video1080 = (avgDL >= 8 && rtt < 150 && score >= 65) ? 'Good' : (avgDL >= 4 && score >= 50 ? 'Fair' : 'Poor');
    const voice = (avgUL >= 0.5 && rtt < 150 && score >= 30) ? 'Good' : (avgUL >= 0.2 && score >= 20 ? 'Fair' : 'Poor');

    this.qoe = { video720, video1080, voice };
    this.recommendations = this.generateRecommendations(this.qoe, {avgDL, avgUL, rtt, score});
  }

  generateRecommendations(qoe: {video720:string;video1080:string;voice:string} | null, metrics: any){
    const rec: string[] = [];
    if(!qoe) return rec;
    // General
    if(metrics.score < 50) rec.push('Close background apps and browser tabs to increase available CPU and memory.');
    if(this.connection && this.connection.type === 'cellular') rec.push('If possible, switch to Wi-Fi (prefer 5GHz) for more stable throughput.');
    if(metrics.rtt > 250) rec.push('High latency detected — try moving closer to your router or rebooting it.');

    // Video-specific
    if(qoe.video1080 === 'Poor') rec.push('For 1080p video, your download speed is likely insufficient — lower resolution to 720p or 480p.');
    else if(qoe.video1080 === 'Fair') rec.push('1080p may work but expect occasional buffering; prefer 720p for consistent playback.');

    if(qoe.video720 === 'Poor') rec.push('720p video will likely buffer — consider switching to audio-only or reducing stream quality.');

    // Voice
    if(qoe.voice === 'Poor') rec.push('Voice quality may be poor — close background uploads/downloads and try again.');

    // Device-specific
    const model = (this.deviceInfo?.deviceModel || '').toLowerCase();
    if(/iphone|pixel|sm-|oneplus|mi |huawei/i.test(model) && metrics.score < 60) rec.push('Your device appears to be a mobile device; try disabling battery saver and update the OS for better performance.');

    // Quick network tips
    if(metrics.avgDL < 3) rec.push('Check for other devices using the network (streaming or large downloads).');

    if(rec.length === 0) rec.push('No actionable issues detected — network and device look healthy.');
    return rec;
  }

  async runQuickChecks(){
    this.quickCheckRunning = true;
    // do a lightweight re-evaluation: refresh battery & compute QoE
    try{
      await this.fetchBattery();
    }catch(e){}
    this.updatePerfScore();
    this.evaluateQoE();
    setTimeout(()=> this.quickCheckRunning = false, 500);
  }

  generateDiagnostics(){
    const report = {
      generatedAt: new Date().toISOString(),
      deviceInfo: this.deviceInfo,
      connection: this.connection,
      battery: this.battery,
      geolocation: this.geolocation,
      timezone: this.timezone,
      perfScore: this.perfScore,
      downloadHistory: this.downloadHistory,
      uploadHistory: this.uploadHistory
    };
    this.lastReportJson = JSON.stringify(report, null, 2);
    return report;
  }

  downloadReport(format: 'json' | 'csv' = 'json'){
    const report = this.generateDiagnostics();
    if(format === 'json'){
      const blob = new Blob([this.lastReportJson || JSON.stringify(report)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagnostics-${new Date().toISOString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // CSV export of speed history
      const rows: string[] = [];
      rows.push('index,approxTimestamp,download,upload');
      const now = Date.now();
      const len = Math.max(this.downloadHistory.length, this.uploadHistory.length);
      for(let i=0;i<len;i++){
        const ts = new Date(now - (len - i - 1) * 3000).toISOString();
        const dl = this.downloadHistory[i] ?? '';
        const ul = this.uploadHistory[i] ?? '';
        rows.push(`${i},"${ts}",${dl},${ul}`);
      }
      const csv = rows.join('\n');
      const blob = new Blob([csv], {type: 'text/csv'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `speed-history-${new Date().toISOString()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  async copyReport(){
    this.generateDiagnostics();
    const text = this.lastReportJson || '';
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
      } else {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      // provide a small visual confirmation (console + optional UI)
      console.log('Diagnostics copied to clipboard');
    }catch(e){
      console.warn('Copy failed', e);
    }
  }

  ngOnDestroy(){
    this.subs.forEach(s=>s.unsubscribe());
  }

  async fetchBattery(){
    this.battery = await this.systemInfo.getBattery();
    this.batteryUpdated = true;
    setTimeout(()=> this.batteryUpdated = false, 900);
  }

  async fetchGeolocation(){
    this.geolocation = await this.systemInfo.getGeolocation();
    this.geolocationUpdated = true;
    setTimeout(()=> this.geolocationUpdated = false, 900);
  }

  renderSparkline(values: number[], width = 120, height = 40){
    if(!values || values.length===0) return '';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const len = values.length;
    return values.map((v,i)=>{
      const x = (i/(Math.max(len-1,1))) * width;
      const y = height - ((v - min)/(max - min || 1)) * height;
      return `${x},${y}`;
    }).join(' ');
  }


  isDesktop(): boolean {
    return this.deviceService.isDesktop();
  }

  isMobile(): boolean {
    return this.deviceService.isMobile();
  }

  isTablet(): boolean {
    return this.deviceService.isTablet();
  }

  isModalOpen = false;

  openModal() {
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
  }

  submitModal() {
    console.log('Modal submitted!');
    this.isModalOpen = false;
  }

  // Full device info (high-entropy hints)
  showFullDeviceInfo = false;
  fullDeviceInfo: any = null;

  async fetchFullDeviceInfo(){
    try{
      this.fullDeviceInfo = await this.deviceService.getFullDeviceInfo();
    }catch(e){
      this.fullDeviceInfo = this.deviceInfo;
    }
  }

  getFullInfoGroups(){
    const info = this.fullDeviceInfo || this.deviceInfo || {};
    const groups = [
      { title: 'Platform', icon: '🖥️', items: [
        {k:'os', label:'OS', v: info.os},
        {k:'osVersion', label:'OS version', v: info.osVersion},
        {k:'platform', label:'Platform', v: info.platform || info.uaPlatformHint},
        {k:'bitness', label:'Bitness', v: info.bitness}
      ]},
      { title: 'Browser', icon: '🌐', items: [
        {k:'browser', label:'Browser', v: info.browser},
        {k:'browserVersion', label:'Browser version', v: info.browserVersion || info.uaFullVersion},
        {k:'userAgent', label:'User Agent', v: info.userAgent}
      ]},
      { title: 'Hardware', icon: '⚙️', items: [
        {k:'deviceType', label:'Device Type', v: info.deviceType},
        {k:'deviceModel', label:'Device Model', v: info.deviceModel || info.model},
        {k:'hardwareConcurrency', label:'CPU threads', v: info.hardwareConcurrency},
        {k:'deviceMemoryMB', label:'RAM (MB)', v: info.deviceMemoryMB},
        {k:'width', label:'Screen W', v: info.width},
        {k:'height', label:'Screen H', v: info.height}
      ]},
      { title: 'Graphics', icon: '🎮', items: [
        {k:'gpu.vendor', label:'GPU vendor', v: info.gpu?.vendor},
        {k:'gpu.renderer', label:'GPU renderer', v: info.gpu?.renderer},
        {k:'screenDPI', label:'Screen DPI', v: info.screenDPI}
      ]},
      { title: 'Environment', icon: '🔎', items: [
        {k:'colorDepth', label:'Color depth', v: info.colorDepth},
        {k:'pixelDepth', label:'Pixel depth', v: info.pixelDepth},
        {k:'maxTouchPoints', label:'Touch points', v: info.maxTouchPoints},
        {k:'languages', label:'Languages', v: (info.languages || []).join?.(', ')}
      ]}
    ];
    return groups;
  }

  countMissingFullInfo(){
    const groups = this.getFullInfoGroups();
    let missing = 0;
    groups.forEach(g=> g.items.forEach((it:any)=>{ if(it.v === null || it.v === undefined || it.v === '') missing++; }));
    return missing;
  }

  // Per-field help messages
  // Internationalized help messages (expandable)
  locale = (typeof navigator !== 'undefined' && (navigator as any).language) ? ((navigator as any).language.split('-')[0]) : 'en';
  translations: Record<string,Record<string,string>> = {
    en: {
      help_os: 'OS version may be missing when the browser limits information; open system settings to view the exact version.',
      help_device_model: 'Device model is best-effort from the User Agent string; some browsers omit it for privacy.',
      help_gpu: 'WebGL renderer information requires a browser extension (WEBGL_debug_renderer_info) and may be disabled for privacy.',
      help_ram: 'navigator.deviceMemory reports an approximate amount in GB; exact MB values may not be exposed by the browser.',
      help_bitness: 'Bitness and architecture require User-Agent Client Hints support; some browsers or privacy settings block it.',
      help_languages: 'Languages reflect browser preferences; the full list may be reduced by privacy settings.',
      open_settings: 'Open system settings',
      learn_more: 'Learn more'
    }
    // other locales can be added here
  };

  // Per-field help entries with optional OS-specific deep links
  helpEntries: Record<string, any> = {
    'OS': { key: 'help_os', deepLinks: {
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:about'},
      'macOS': {labelKey: 'learn_more', url: 'https://support.apple.com/en-us/guide/mac-help/mchlp2271/mac'},
      'Linux': {labelKey: 'learn_more', url: 'https://www.howtogeek.com/125823/how-to-find-out-which-linux-distribution-and-version-you-re-running/'}
    }},
    'Device Model': { key: 'help_device_model', deepLinks: {
      'Android': {labelKey: 'learn_more', url: 'https://support.google.com/android/answer/7664698?hl=en'},
      'iOS': {labelKey: 'learn_more', url: 'https://support.apple.com/guide/iphone/identify-your-iphone-model-iph3b0d4e0b/ios'}
    }},
    'GPU renderer': { key: 'help_gpu', deepLinks: {
      'Windows': {labelKey: 'learn_more', url: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Using_WebGL'},
      'macOS': {labelKey: 'learn_more', url: 'https://developer.apple.com/graphics/'}
    }},
    'RAM (MB)': { key: 'help_ram', deepLinks: {
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:about'},
      'macOS': {labelKey: 'learn_more', url: 'https://support.apple.com/en-us/HT201538'}
    } },
    'Bitness': { key: 'help_bitness', deepLinks: {
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:about'},
      'macOS': {labelKey: 'learn_more', url: 'https://support.apple.com/en-us/HT201260'}
    } },
    'Languages': { key: 'help_languages', deepLinks: {} },
    'CPU threads': { key: 'help_cpu', deepLinks: {
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:about'},
      'macOS': {labelKey: 'learn_more', url: 'https://support.apple.com/en-us/guide/system-information/welcome/mac'}
    } },
    'Screen W': { key: 'help_display', deepLinks: {
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:display'},
      'macOS': {labelKey: 'learn_more', url: 'https://support.apple.com/en-us/guide/mac-help/change-display-settings-mh26786/mac'}
    } },
    'Screen H': { key: 'help_display', deepLinks: {
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:display'},
      'macOS': {labelKey: 'learn_more', url: 'https://support.apple.com/en-us/guide/mac-help/change-display-settings-mh26786/mac'}
    } },
    'Screen DPI': { key: 'help_display', deepLinks: {
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:display'},
      'macOS': {labelKey: 'learn_more', url: 'https://support.apple.com/en-us/guide/mac-help/change-display-settings-mh26786/mac'}
    } },
    'Color depth': { key: 'help_display', deepLinks: {} },
    'Pixel depth': { key: 'help_display', deepLinks: {} },
    'Touch points': { key: 'help_touch', deepLinks: {
      'Windows': {labelKey: 'learn_more', url: 'https://support.microsoft.com/en-us/windows/use-touch-gestures-on-a-touch-screen-6674a6c2-7b6b-3a8e-9f78-9c7a2f1f7f4b'}
    } },
    'Device Type': { key: 'help_device_type', deepLinks: {
      'Android': {labelKey: 'learn_more', url: 'https://support.google.com/android/answer/7664698?hl=en'},
      'iOS': {labelKey: 'learn_more', url: 'https://support.apple.com/'},
      'Windows': {labelKey: 'open_settings', url: 'ms-settings:about'}
    } }
  };

  // Toggle state for help popovers
  helpOpen: Record<string, boolean> = {};
  toggleHelp(key: string){ this.helpOpen[key] = !this.helpOpen[key]; }

  getHelpMessage(label: string){
    const entry = this.helpEntries[label];
    const key = entry?.key;
    const t = (this.translations[this.locale] && this.translations[this.locale][key]) || (this.translations['en'] && this.translations['en'][key]);
    return t || 'No extra information available for this field.';
  }

  getDeepLink(label: string){
    const entry = this.helpEntries[label];
    if(!entry) return null;
    const os = this.deviceInfo?.os || (this.fullDeviceInfo?.os) || '';
    const dl = entry.deepLinks?.[os];
    if(dl) {
      const text = (this.translations[this.locale] && this.translations[this.locale][dl.labelKey]) || this.translations['en'][dl.labelKey] || dl.labelKey;
      return { url: dl.url, label: text };
    }
    return null;
  }
}

