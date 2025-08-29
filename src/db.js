// records.js
import { openDB } from 'idb';
import { recordStore, uuidStore } from './tempstores.js';
import { getBucketForDate } from './bucketUtils.js';

// --- IndexedDB helpers ---
export const initDB = async () => {
  const db = await openDB('missions-db', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', { keyPath: 'uuid' });
      }
    },
  });
  return db;
};

export const saveRecord = async (record) => {
  const db = await initDB();
  await db.put('records', record);
};

export const saveRecords = async (records) => {
  const db = await initDB();
  const tx = db.transaction('records', 'readwrite');
  for (let uuid in records) {
    await tx.store.put(records[uuid]);
  }
  await tx.done;
};

export const getAllRecords = async () => {
  const db = await initDB();
  return db.getAll('records');
};

export const deleteRecord = async (uuid) => {
  const db = await initDB();
  return db.delete('records', uuid);
};

// --- Add a new record ---
export async function addRecord(uuid, data) {
  const bucketId = getBucketForDate();
  const record = { uuid, data, bucketId, createdAt: new Date().toISOString() };

  // Update in-memory stores (immutable)
  recordStore.update(records => ({ ...records, [uuid]: record }));
  uuidStore.update(buckets => {
    const list = buckets[bucketId] ? [...buckets[bucketId]] : [];
    list.push(uuid);
    return { ...buckets, [bucketId]: list };
  });

  // Persist to IndexedDB
  await saveRecord(record);
}
