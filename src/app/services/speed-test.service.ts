import { Injectable } from '@angular/core';
import { Observable, of, timer, BehaviorSubject } from 'rxjs';
import { mapTo } from 'rxjs/operators';

/**
 * Minimal speed test service to avoid external dependency.
 * - getMbps(): Observable<number>
 * - getUploadMbps$(): Observable<number>
 * - isOnline(): Observable<boolean>
 *
 * The implementation is a lightweight simulation suitable for UI/demo.
 */
@Injectable({ providedIn: 'root' })
export class SpeedTestService {
  private download$ = new BehaviorSubject<number | null>(null);
  private upload$ = new BehaviorSubject<number | null>(null);
  private downloadHistory$ = new BehaviorSubject<number[]>([]);
  private uploadHistory$ = new BehaviorSubject<number[]>([]);

  // Observables exposed for components
  get download(): Observable<number | null> { return this.download$.asObservable(); }
  get upload(): Observable<number | null> { return this.upload$.asObservable(); }
  get downloadHistory(): Observable<number[]> { return this.downloadHistory$.asObservable(); }
  get uploadHistory(): Observable<number[]> { return this.uploadHistory$.asObservable(); }

  // Simulate a single download measurement (returns observable like before)
  getMbps(): Observable<number> {
    return timer(500).pipe(mapTo(this.randomSpeed(5, 200)));
  }

  // Simulate an upload measurement
  getUploadMbps$(): Observable<number> {
    return timer(700).pipe(mapTo(this.randomSpeed(1, 50)));
  }

  isOnline(): Observable<boolean> {
    return of(navigator.onLine ?? true);
  }

  // Start a simulated test run: push values into streams and history
  startSimulatedTest() {
    const dl = this.randomSpeed(5, 200);
    const ul = this.randomSpeed(1, 50);
    // push current values
    this.download$.next(dl);
    this.upload$.next(ul);
    // update histories (keep last 60 entries)
    const dHist = [...this.downloadHistory$.getValue(), dl].slice(-60);
    const uHist = [...this.uploadHistory$.getValue(), ul].slice(-60);
    this.downloadHistory$.next(dHist);
    this.uploadHistory$.next(uHist);
    // persist to localStorage (best-effort)
    try { localStorage.setItem('downloadHistory', JSON.stringify(dHist)); localStorage.setItem('uploadHistory', JSON.stringify(uHist)); } catch(e){/*ignore*/}
  }

  // Load persisted history on service init
  constructor(){
    try{
      const d = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
      const u = JSON.parse(localStorage.getItem('uploadHistory') || '[]');
      if(Array.isArray(d)) this.downloadHistory$.next(d.slice(-60));
      if(Array.isArray(u)) this.uploadHistory$.next(u.slice(-60));
    }catch(e){}
  }

  private randomSpeed(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }
}
