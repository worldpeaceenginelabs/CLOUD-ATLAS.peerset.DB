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

// Save multiple records in batch for better performance
export const saveRecordsBatch = async (records) => {
  const db = await initDB();
  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  
  // Queue all put operations
  const promises = [];
  for (const [uuid, record] of Object.entries(records)) {
    promises.push(store.put(record));
  }
  
  // Wait for all operations and transaction to complete
  await Promise.all([...promises, tx.done]);
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