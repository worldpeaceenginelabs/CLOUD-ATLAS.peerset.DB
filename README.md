<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/a46333c1-dfe7-4f17-8118-f75175d2f819" />

# Peerset

**Short Description:**  
A decentralized peer-to-peer record synchronization system, where every record is signed, hashed, moderated, locally stored and synchronized across connected peers. Users can log in with Bech32 keys (Nostr npub/nsec), create records, and participate in a fully self moderated swarm with automatic deduplication, missing-range detection, and session enforcement.

## Get Your Keys
Only you have the Nostr keys in possession but this service offers their recovery via your email address for free: [NSTART.ME](https://nstart.me/)

## Features

- Decentralized peer-to-peer network using Trystero: A UUID (hash of the room name) is announced on the public BitTorrent tracker network. Everyone interested in that UUID gets connected into a shared WebRTC buffer (our "group-chat" room). Everyone can broadcast, and everyone reads everything.
- Record creation with UUID, timestamp, creator key, geolocation, text, link, hash, and signature
- Automatic SHA-256 hashing and secp256k1 signing of records
- Bucket-based missing-range detection with granularity setting (day/quarterday/...) for efficient syncing of large record sets 
- Full record deduplication and IndexedDB persistence
- Broadcast and request missing records automatically among peers

## Coming soon...
- User login via Bech32 npub/nsec keys (secp256k1) (ready, implementation soon)
- Handshake + Nonce Challenge authentication for secure peer connections (ready, implementation soon)
- Session enforcement: handshake timeout, challenge timeout, max peer & client session times and many more (ready, implementation soon)
- Strict state machine for peer handshake and session management (ready, implementation soon)
- Moderation & strike system: bad-word detection, content/link verification, max 5 records per user, duplicate detection, garbage collection (ready, implementation soon)
- Network UI (maybe web UI): Client Status, Swarm Status, Record Status, settings like timeouts, constants, and types. (coming)