/**
 * Chat Connector — indexes Twake Chat messages via Matrix protocol
 *
 * Supports two modes:
 * - Full sync: fetches all message history from joined rooms
 * - Real-time sync: long-polls /sync to index new messages as they arrive
 *
 * Uses the same Matrix client-server API as twake-cli's chat commands.
 */

const USER_AGENT = 'twake-search/0.1.0';

export class ChatConnector {
  constructor(engine, config) {
    this.engine = engine;
    this.homeserver = config.homeserver;
    this.accessToken = config.accessToken;
    this.userId = config.userId;
    this._syncRunning = false;
  }

  get name() { return 'chat'; }

  async _matrixFetch(endpoint, options = {}) {
    const url = `${this.homeserver}/_matrix/client/v3${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Matrix API error ${res.status}: ${err.error || res.statusText}`);
    }
    return res.json();
  }

  /**
   * Full sync — index all message history from all joined rooms.
   */
  async fullSync() {
    console.log('[chat] Starting full sync...');
    this.engine.setSyncState('chat', { status: 'syncing' });

    const { joined_rooms } = await this._matrixFetch('/joined_rooms');
    console.log(`[chat] Found ${joined_rooms.length} joined rooms`);

    let totalIndexed = 0;

    for (const roomId of joined_rooms) {
      let roomName = roomId;
      try {
        const state = await this._matrixFetch(`/rooms/${encodeURIComponent(roomId)}/state/m.room.name`);
        roomName = state.name || roomId;
      } catch { /* unnamed room */ }

      // Paginate through message history
      let from = '';
      let roomMessages = 0;

      while (true) {
        const endpoint = `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100${from ? `&from=${from}` : ''}`;
        const data = await this._matrixFetch(endpoint);

        const messages = (data.chunk || []).filter(e => e.type === 'm.room.message' && e.content?.body);

        if (!messages.length) break;

        const docs = messages.map(msg => ({
          source: 'chat',
          sourceId: msg.event_id,
          title: roomName,
          body: msg.content.body,
          author: msg.sender?.split(':')[0]?.replace('@', '') || 'unknown',
          timestamp: msg.origin_server_ts,
          url: `https://chat.twake.app/#/room/${roomId}/${msg.event_id}`,
          metadata: { roomId, roomName, msgtype: msg.content.msgtype },
        }));

        this.engine.indexBatch(docs);
        roomMessages += docs.length;
        totalIndexed += docs.length;

        from = data.end;
        if (!data.end || data.end === data.start) break;
      }

      console.log(`[chat] Indexed ${roomMessages} messages from "${roomName}"`);
    }

    this.engine.setSyncState('chat', { status: 'idle' });
    console.log(`[chat] Full sync complete — ${totalIndexed} messages indexed`);
    return totalIndexed;
  }

  /**
   * Real-time sync — long-poll Matrix /sync to index new messages.
   * Runs indefinitely until stop() is called.
   */
  async startRealtimeSync() {
    if (this._syncRunning) return;
    this._syncRunning = true;

    console.log('[chat] Starting real-time sync...');

    // Get initial sync token
    let since = this.engine.getSyncState('chat')?.syncToken;
    if (!since) {
      const initial = await this._matrixFetch('/sync?timeout=0&filter={"room":{"timeline":{"limit":0}}}');
      since = initial.next_batch;
    }

    while (this._syncRunning) {
      try {
        const sync = await this._matrixFetch(
          `/sync?since=${since}&timeout=30000&filter={"room":{"timeline":{"limit":50}}}`
        );
        since = sync.next_batch;
        this.engine.setSyncState('chat', { syncToken: since, status: 'idle' });

        // Index new messages from all rooms
        const joinedRooms = sync.rooms?.join || {};
        for (const [roomId, roomData] of Object.entries(joinedRooms)) {
          const events = roomData.timeline?.events || [];
          const messages = events.filter(e => e.type === 'm.room.message' && e.content?.body);

          if (messages.length) {
            const docs = messages.map(msg => ({
              source: 'chat',
              sourceId: msg.event_id,
              title: roomId,
              body: msg.content.body,
              author: msg.sender?.split(':')[0]?.replace('@', '') || 'unknown',
              timestamp: msg.origin_server_ts,
              metadata: { roomId, msgtype: msg.content.msgtype },
            }));

            this.engine.indexBatch(docs);
            console.log(`[chat] Indexed ${docs.length} new messages from ${roomId}`);
          }
        }
      } catch (err) {
        console.error(`[chat] Sync error: ${err.message}. Retrying in 5s...`);
        this.engine.setSyncState('chat', { syncToken: since, status: 'error' });
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  stopRealtimeSync() {
    this._syncRunning = false;
    console.log('[chat] Real-time sync stopped');
  }
}
