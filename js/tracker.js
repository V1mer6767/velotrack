// tracker.js — GPS recording logic

export class RideTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.watchId = null;
    this.points = [];
    this.startTime = null;
    this.lastPoint = null;
    this.totalDistance = 0;
    this.maxSpeed = 0;
    this.speedSamples = [];
    this.active = false;
    this.pausedAt = null;
    this.totalPausedMs = 0;
  }

  start() {
    if (!navigator.geolocation) throw new Error('GPS недоступний');
    this.points = [];
    this.startTime = Date.now();
    this.totalDistance = 0;
    this.maxSpeed = 0;
    this.speedSamples = [];
    this.active = true;
    this.totalPausedMs = 0;

    this.watchId = navigator.geolocation.watchPosition(
      pos => this._onPosition(pos),
      err => console.warn('GPS error:', err.message),
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 10000
      }
    );
  }

  _onPosition(pos) {
    if (!this.active) return;
    const { latitude: lat, longitude: lng, speed, accuracy } = pos.coords;
    if (accuracy > 40) return; // skip noisy points

    const point = { lat, lng, t: Date.now(), speed: speed || 0, accuracy };
    this.points.push(point);

    if (this.lastPoint) {
      const dist = this._haversine(this.lastPoint, point);
      if (dist < 200) { // ignore GPS jumps > 200m
        this.totalDistance += dist;
      }
    }

    const speedKmh = (speed || 0) * 3.6;
    this.speedSamples.push(speedKmh);
    if (speedKmh > this.maxSpeed) this.maxSpeed = speedKmh;
    this.lastPoint = point;

    this.onUpdate(this.getStats());
  }

  getStats() {
    const elapsed = this.active
      ? (Date.now() - this.startTime - this.totalPausedMs) / 1000
      : 0;
    const avgSpeed = elapsed > 0 ? (this.totalDistance / 1000) / (elapsed / 3600) : 0;
    const currentSpeed = this.speedSamples.length > 0
      ? this.speedSamples[this.speedSamples.length - 1]
      : 0;

    return {
      distance: this.totalDistance / 1000,
      duration: elapsed,
      avgSpeed,
      currentSpeed,
      maxSpeed: this.maxSpeed,
      points: this.points,
      pointCount: this.points.length
    };
  }

  stop() {
    this.active = false;
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    return this.getStats();
  }

  _haversine(a, b) {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  getRoute() {
    return this.points.map(p => [p.lat, p.lng]);
  }
}

export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}г ${String(m).padStart(2, '0')}м`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDate(ts) {
  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }).format(new Date(ts));
}
