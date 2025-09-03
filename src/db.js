// records.js
import { openDB } from 'idb';

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
