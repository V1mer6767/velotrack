// db.js — IndexedDB wrapper for VeloTrack

const DB_NAME = 'velotrack';
const DB_VERSION = 1;

let db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('rides')) {
        const store = d.createObjectStore('rides', { keyPath: 'id', autoIncrement: true });
        store.createIndex('date', 'date', { unique: false });
      }
    };

    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

export async function saveRide(ride) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('rides', 'readwrite');
    const req = tx.objectStore('rides').add(ride);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllRides() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('rides', 'readonly');
    const req = tx.objectStore('rides').getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRide(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('rides', 'readwrite');
    const req = tx.objectStore('rides').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getRide(id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('rides', 'readonly');
    const req = tx.objectStore('rides').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
