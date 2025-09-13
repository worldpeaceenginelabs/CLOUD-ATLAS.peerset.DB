# 🚧 Under Construction but 99% working

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/a46333c1-dfe7-4f17-8118-f75175d2f819" />
<br><br><br>

# 🚀 peerset.DB — The Database From the Future
## 👉 **"peerset.DB doesn’t care—drop anything you want:<br>raw, JSON, blob, audio, video, stream. Works out of the box.<br><br>No need to rethink your DB concept or spend an all-nighter configuring—literally plug the component and play.<br><br>Moderation? Your call: from ‘let it fly’ to ‘Fort Knox’.<br><br>The simplest way to plug a global, self-synchronizing swarm into your app."**
<br><br><br>

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/a4134a3a-166e-4cdf-a623-28888a516f69" />
<br><br><br>

### **This is basically science fiction.**  

- Signaling happens **via public BitTorrent trackers**
- Peers connect **directly via WebRTC**, no servers, no middlemen.   
- A **peer-to-peer record synchronization system** where every record is:
  - ✅ Signed  
  - ✅ SHA-256 hashed  
  - ✅ Moderated  
  - ✅ Locally stored  
  - ✅ Auto-synced across peers
 <br>
 
### This isn’t theory. This is **peerset.DB**.  

A fully self-moderated swarm with:  
- 🔄 Automatic deduplication  
- 📦 Merkle Tree  
- ⏳ Session enforcement  
- 🔐 End-to-end encryption and serialization 
<br>

No servers. No central control. No infrastructure except the **public tracker network** — which is, by design, **unbannable**.  
Anyone on Earth with a browser can join the swarm and instantly share data with everyone else.  
<br>

### 🌍 **It’s science fiction, but you can use it today.**  

**LIVE DEMO:** Try it yourself — open duplicated windows on your laptop, phone, tablet, or across multiple devices.  
👉 [cloud-atlas-peerset.pages.dev](https://cloud-atlas-peerset.pages.dev/)  
It stupidly syncs everything you throw at it.
<br><br><br>

---
<br><br><br>

# ✅ Features Implemented

- [x] Network Web UI
<img width="1919" height="1017" alt="image" src="https://github.com/user-attachments/assets/1d76574e-89d7-445c-b90a-2e70ea67ea04" />
<br><br><br>

- [x] Decentralized peer-to-peer network using **[Trystero](https://github.com/dmotz/trystero)**: A hash of the room name is announced on the public **[BitTorrent](https://www.bittorrent.com/)** tracker network. Everyone interested in that UUID gets connected into a shared WebRTC buffer (our Trystero room)   
- [x] **Incremental Merkle Tree:** allowing O(log n) updates and subtree comparisons. **Lazy Updates:** Hashes are computed asynchronously to avoid blocking operations.  
- [x] Full record **deduplication** and **IndexedDB** persistence  
- [x] **Broadcast and request** missing records **automatically** among peers
- [x] Basic **Moderation & strike system**: **bad-word detection** and **regex** on text field (no link in text policy), regex check on link field
- [x] **Garbage Collection**: records are pruned if older than 90 days, subscriptions are closed, memory purged (needs improvement)
<br><br><br>

## Coming soon...
- [ ] User "login" via **Bech32 npub/nsec keys** (secp256k1) (ready code, implementation soon)
- [ ] Automatic **SHA-256 hashing** and **secp256k1 signing** of records and related checks (ready snippet, implementation soon)
- [ ] **Handshake + Nonce Challenge** authentication for secure peer connections (ready code, implementation soon)
- [ ] **Session enforcement**: handshake timeout, challenge timeout, max peer & client session times and many more (ready code, implementation soon)
- [ ] **Strict state machine** for peer handshake and session management (ready code, implementation soon)
- [ ] **more Moderation filters**: max 5 records in indexeddb per author.npub, duplicate detection, (ready snippets, implementation soon)
- [ ] **Phase Rotating Announcements** (🖖)
<br><br><br>

# ❓ WHAT IS IT

peerset.DB is a new primitive for the decentralized web — think **BitTorrent for live data**, **IPFS without infrastructure**, or **GUN/OrbitDB without servers**.

It’s not just storage. It’s not just messaging. It’s a **fully peer-to-peer database layer** that anyone can drop into their app.  

- **Like BitTorrent**, it uses public trackers for signaling — the unbannable backbone of peer discovery.  
- **Like IPFS**, it creates a content-addressable network — every record is hashed and signed.  
- **Like GunDB/OrbitDB**, it’s a distributed database — but without external nodes, bootstrap servers, or infrastructure.  
- **Unlike all of them**, it’s just a Svelte component / JS bundle — you can throw it on a CDN, drop it in a browser, and the swarm takes care of the rest.  
<br>

### In short:  
peerset.DB is a **zero-infrastructure, end-to-end encrypted, self-moderating P2P record synchronization engine**.  
<br><br><br>

---
<br><br><br>

## Get Your Keys
Only you have the Nostr keys in possession but this service offers their recovery via your email address for free: [NSTART.ME](https://nstart.me/)
<br><br><br>


Here’s a GitHub-ready version of your **peerset.DB workflow** for the README with proper Markdown formatting:

---

# 🔄 peerset.DB Workflow

A brief overview of how **peerset.DB** synchronizes records across peers using incremental Merkle trees.

---

## 1️⃣ Initialization

* Load persisted records from **IndexedDB** into `recordStore`.
* Build an **incremental AVL-based Merkle tree** from these records.
* Compute the initial **root hash** asynchronously.

---

## 2️⃣ Peer Join

* When a new peer joins, send them the current **root hash**.
* Track traffic statistics per peer.

---

## 3️⃣ Root Hash Exchange

On receiving a peer's root hash:

* **Fresh peer (`freshNode`)** → send all local records.
* **Hashes differ** → send **subtree hashes** for Merkle comparison.
* **Hashes match** → no sync needed.

---

## 4️⃣ Subtree Exchange

On receiving peer **subtree hashes**:

* Compare with local tree to find **differing paths**.
* Extract records corresponding to differing paths and send them to the peer.

---

## 5️⃣ Record Reception

* Received records are **buffered incrementally**.
* Each record is **moderated** before saving.
* After processing:

  * Rebuild the Merkle tree.
  * Update the **root hash**.
  * Send updated root hash to the originating peer and optionally broadcast to all peers.

---

## 6️⃣ Idle Broadcast

* If a peer is idle for a defined timeout, broadcast the latest **root hash** to ensure synchronization.

---

## 7️⃣ Maintenance

* Periodically **prune old records** from IndexedDB and the Merkle tree (e.g., records older than 90 days).
* Rebuild the Merkle tree as needed after pruning.

---

## ⚡ Key Concepts

* **Incremental Merkle Tree:** AVL-balanced, allowing O(log n) updates and subtree comparisons.
* **Lazy Updates:** Hashes are computed asynchronously to avoid blocking operations.
* **Batching:** Records are sent in **batches** for efficient network usage.
* **Moderation:** Incoming records are verified before integration.
* **Peer-to-Peer Sync:** Only differences are exchanged using **root** and **subtree hashes**, minimizing data transfer.
<br><br><br>


# 🚀 Usage for developers


1. **Rename the file**  
   Rename `App.svelte` to `PeersetDB.svelte`.

2. **Move all components into the a folder in your existing plain svelte project**  
   Copy `PeersetDB.svelte` into: /src/peerset/

3. **import it in your main `app.svelte`**  
Example:

```svelte
<script>
  import PeersetDB from './peerset/PeersetDB.svelte';
</script>

<main>
  <h1>My App</h1>
  <PeersetDB />
</main>
````

4. **(Optional) Remove `ui.svelte` and start the element hidden**
   If you don’t need the UI, you can render the component in hidden state:

   ```svelte
   <script>
     import PeersetDB from './peerset/peerset.svelte';
   </script>

   <main>
     <PeersetDB style="display:none;" />
   </main>
   ```

---

### 🔧 Alternative for all other projects (not plain Svelte)

1. Build the project:

   ```bash
   npm run build
   ```

2. Get the compiled files from the `dist/` folder.

3. Use them in **any other framework project** (React, Vue, Angular, plain HTML, etc.).<br>
   **That's the beauty of plain Svelte because we're exporting vanilla JS** 😍

   Example folder after build:

   <img width="1697" height="357" alt="image" src="https://github.com/user-attachments/assets/c2801e46-9082-4389-9adf-fc5a461082e5" />
<br><br><br>

# Switch Trystero Signaling Strategy

In peerset.DB, by default, the Bittorrent (works out of the box) strategy is used.

```
<script type="module">
  import {joinRoom} from 'trystero/torrent'
</script>
```

To use a different strategy, just use a deep import like this ():

```
import {joinRoom} from 'trystero' // Nostr (works out of the box)
// or
import {joinRoom} from 'trystero/ipfs' IPFS (works out of the box)
// or
import {joinRoom} from 'trystero/mqtt' // MQTT (relay urls needed)
// or
import {joinRoom} from 'trystero/supabase' // Supabases (needs config)
// or
import {joinRoom} from 'trystero/firebase' // Firebase (needs config)
```
Consider https://github.com/dmotz/trystero for more information.
