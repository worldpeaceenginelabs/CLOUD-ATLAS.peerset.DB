<script lang="ts">
  import { v4 as uuidv4 } from 'uuid';
  import { recordStore, uuidStore } from './tempstores.js';
  import { saveRecords } from './db.js';

  export let statReceivedRecords = 0;
  export let statBucketsExchanged = 0;
  export let statUUIDsExchanged = 0;
  export let statRecordsExchanged = 0;

  const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  let lastGenMs = 0;
  let lastGenKB = 0;

  async function generateRecords(count = 10000) {
    const t0 = performance.now();

    const records: Record<string, any> = {};
    let totalBytes = 0;

    for (let i = 0; i < count; i++) {
      const uuid = uuidv4();
      const dayNum = randomInt(241, 251);
      const bucketId = `day${dayNum}`;
      const rec = {
        uuid,
        bucketId,
        createdAt: new Date().toISOString(),
        data: {
          text: `Random note ${i}`,
          value: Math.random(),
          index: i
        }
      };
      records[uuid] = rec;
      totalBytes += JSON.stringify(rec).length;
    }

    // Persist to IndexedDB in bulk
    await saveRecords(records);

    // Update in-memory stores immutably
    recordStore.update(local => ({ ...local, ...records }));
    uuidStore.update(local => {
      const updated: Record<string, string[]> = { ...local } as any;
      for (const uuid in records) {
        const b = records[uuid].bucketId;
        const list = updated[b] ? [...updated[b]] : [];
        list.push(uuid);
        updated[b] = list;
      }
      return updated as any;
    });

    const t1 = performance.now();
    lastGenMs = Math.round(t1 - t0);
    lastGenKB = Math.round(totalBytes / 1024);
    console.log(`Generated ${count} records in ${lastGenMs} ms, ~${lastGenKB} KB`);
  }
</script>

<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 12px; line-height: 1.4;">
  <h3 style="margin: 0 0 8px;">Sync stats</h3>
  <div style="display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 8px; max-width: 600px;">
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Local records: <strong>{Object.keys($recordStore || {}).length}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Received records: <strong>{statReceivedRecords}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Buckets exchanged: <strong>{statBucketsExchanged}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">UUIDs exchanged: <strong>{statUUIDsExchanged}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px;">Records exchanged: <strong>{statRecordsExchanged}</strong></div>
    <div style="padding:8px;border:1px solid #ddd;border-radius:6px; grid-column: 1 / -1; display:flex; gap:8px; align-items:center;">
      <button on:click={() => generateRecords(10000)} style="padding:8px 12px; border:1px solid #999; border-radius:6px; background:#f7f7f7; cursor:pointer;">Generate 10,000 local records</button>
      <span>Last gen: <strong>{lastGenMs}</strong> ms, <strong>{lastGenKB}</strong> KB</span>
    </div>
  </div>
</div>


