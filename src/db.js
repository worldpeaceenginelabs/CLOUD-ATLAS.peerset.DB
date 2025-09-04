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

// Save a single record - takes uuid and record separately
export const saveRecord = async (uuid, record) => {
  const db = await initDB();
  // Ensure the record has the uuid field that IndexedDB expects
  const recordWithUuid = { ...record, uuid };
  await db.put('records', recordWithUuid);
};

// Save multiple records - takes a records object with uuid keys
export const saveRecords = async (records) => {
  const db = await initDB();
  const tx = db.transaction('records', 'readwrite');
  for (let uuid in records) {
    // Ensure each record has the uuid field
    const recordWithUuid = { ...records[uuid], uuid };
    await tx.store.put(recordWithUuid);
  }
  await tx.done;
};

// Get all records and return as object with uuid keys (matching your app's expected format)
export const getAllRecords = async () => {
  const db = await initDB();
  const allRecords = await db.getAll('records');
  // Convert array back to object format expected by your app
  const recordsObject = {};
  allRecords.forEach(record => {
    if (record.uuid) {
      recordsObject[record.uuid] = record;
    }
  });
  return recordsObject;
};

export const deleteRecord = async (uuid) => {
  const db = await initDB();
  return db.delete('records', uuid);
};