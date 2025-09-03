<script>
    import { saveRecord } from "./db.js";
  
    let count = 1; // default number of records
  
    // --- Random helpers ---
    const randomString = (len = 8) =>
      Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map((x) => (x % 36).toString(36))
        .join("");
  
    const randomNumber = (min, max) =>
      Math.random() * (max - min) + min;
  
    // --- Hash function ---
    async function sha256(message) {
      const msgBuffer = new TextEncoder().encode(message);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  
    async function generateRecords() {
      for (let i = 0; i < count; i++) {
        const record = {
          uuid: crypto.randomUUID(), // used as IndexedDB key
          id: randomString(12),
          created_at: Date.now(),
          bucket: randomString(6),
          author: {
            npub: "npub_" + randomString(16)
          },
          content: {
            text: "Random content " + randomString(6),
            link: "https://example.com/" + randomString(4)
          },
          geo: {
            latitude: randomNumber(-90, 90),
            longitude: randomNumber(-180, 180)
          },
          integrity: {
            hash: "",
            signature: "sig_" + randomString(32)
          }
        };
  
        // build hash from all data except integrity
        const hashInput = JSON.stringify({
          id: record.id,
          created_at: record.created_at,
          bucket: record.bucket,
          author: record.author,
          content: record.content,
          geo: record.geo
        });
  
        record.integrity.hash = await sha256(hashInput);
  
        await saveRecord(record);
      }
      alert(`${count} records generated and saved!`);
    }
  </script>
  
  <div class="p-4 border rounded shadow">
    <label for="count">Number of records:</label>
    <input
      id="count"
      type="number"
      bind:value={count}
      min="1"
      class="border p-1 ml-2"
    />
    <button
      on:click={generateRecords}
      class="ml-2 px-3 py-1 bg-blue-500 text-white rounded"
    >
      Generate
    </button>
  </div>
  