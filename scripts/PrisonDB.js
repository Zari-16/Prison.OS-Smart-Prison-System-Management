// Prison IndexedDB - stores live sensor data and syncs to SQLite
const DB_NAME = 'prisonDB';
const DB_VERSION = 1;
let db = null;

function openPrisonDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const dbx = e.target.result;

      if (!dbx.objectStoreNames.contains('sensorData')) {
        const store = dbx.createObjectStore('sensorData', { keyPath: 'id', autoIncrement: true });
        store.createIndex('measurement', 'measurement', { unique: false });
        store.createIndex('field', 'field', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      console.log('[IndexedDB] prisonDB opened');
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

function addSensorData(measurement, field, value) {
  if (!db) return Promise.reject('DB not open');
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sensorData', 'readwrite');
    const store = tx.objectStore('sensorData');
    const data = {
      measurement,
      field,
      value,
      timestamp: new Date().toISOString()
    };
    const req = store.add(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllSensorData() {
  if (!db) return Promise.reject('DB not open');
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sensorData', 'readonly');
    const store = tx.objectStore('sensorData');
    const req = store.getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function clearSensorData() {
  if (!db) return Promise.reject('DB not open');
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sensorData', 'readwrite');
    const store = tx.objectStore('sensorData');
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function syncToSQLite() {
  const data = await getAllSensorData();
  if (data.length === 0) return;

  const res = await fetch('/api/sync-sensor-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data })
  });

  if (res.ok) {
    await clearSensorData();
    console.log(`[Sync] ${data.length} records synced to SQLite`);
  }
}

// Auto-sync every 5 minutes
setInterval(syncToSQLite, 5 * 60 * 1000);

window.prisonDB = { openPrisonDB, addSensorData, getAllSensorData, syncToSQLite };
