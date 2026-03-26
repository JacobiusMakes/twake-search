/**
 * Mail Connector — indexes Twake Mail messages via JMAP protocol (RFC 8621)
 *
 * Uses the same JMAP session + API URL pattern as twake-cli's mail commands.
 * Indexes email subjects, body text, sender/recipient info.
 */

const USER_AGENT = 'twake-search/0.1.0';

export class MailConnector {
  constructor(engine, config) {
    this.engine = engine;
    this.sessionUrl = config.sessionUrl;
    this.bearerToken = config.bearerToken;
    this._session = null;
    this._accountId = null;
  }

  get name() { return 'mail'; }

  async _getSession() {
    if (this._session) return this._session;

    const res = await fetch(this.sessionUrl, {
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Accept': 'application/json;jmapVersion=rfc-8621',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) throw new Error(`JMAP session error: ${res.status}`);

    this._session = await res.json();
    this._accountId = Object.keys(this._session.accounts)[0];
    return this._session;
  }

  async _jmapRequest(methodCalls) {
    const session = await this._getSession();

    const calls = methodCalls.map(([method, args, callId]) => [
      method,
      { accountId: this._accountId, ...args },
      callId,
    ]);

    const res = await fetch(session.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json;jmapVersion=rfc-8621',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        methodCalls: calls,
      }),
    });

    if (!res.ok) throw new Error(`JMAP API error: ${res.status}`);
    const data = await res.json();
    return data.methodResponses;
  }

  /**
   * Full sync — index all emails across all mailboxes.
   */
  async fullSync() {
    console.log('[mail] Starting full sync...');
    this.engine.setSyncState('mail', { status: 'syncing' });

    let totalIndexed = 0;
    let position = 0;
    const batchSize = 50;

    while (true) {
      const responses = await this._jmapRequest([
        ['Email/query', {
          sort: [{ property: 'receivedAt', isAscending: false }],
          limit: batchSize,
          position,
        }, 'query'],
        ['Email/get', {
          '#ids': { resultOf: 'query', name: 'Email/query', path: '/ids' },
          properties: ['id', 'from', 'to', 'subject', 'receivedAt', 'preview', 'textBody', 'bodyValues', 'mailboxIds'],
          fetchTextBodyValues: true,
        }, 'emails'],
      ]);

      const queryResp = responses.find(r => r[2] === 'query');
      const emailResp = responses.find(r => r[2] === 'emails');
      const emails = emailResp?.[1]?.list || [];

      if (!emails.length) break;

      const docs = emails.map(email => {
        // Extract body text from bodyValues
        let bodyText = email.preview || '';
        const textPart = email.textBody?.[0];
        if (textPart && email.bodyValues?.[textPart.partId]) {
          bodyText = email.bodyValues[textPart.partId].value || bodyText;
        }

        return {
          source: 'mail',
          sourceId: email.id,
          title: email.subject || '(no subject)',
          body: bodyText,
          author: email.from?.[0]?.email || 'unknown',
          timestamp: new Date(email.receivedAt).getTime(),
          metadata: {
            to: email.to?.map(a => a.email),
            mailboxIds: Object.keys(email.mailboxIds || {}),
          },
        };
      });

      this.engine.indexBatch(docs);
      totalIndexed += docs.length;
      position += batchSize;

      console.log(`[mail] Indexed ${totalIndexed} emails...`);

      // Check if we've reached the end
      const totalEmails = queryResp?.[1]?.total;
      if (totalEmails && position >= totalEmails) break;
    }

    // Store JMAP state for incremental sync
    const stateResp = await this._jmapRequest([
      ['Email/get', { ids: [], properties: [] }, 'state'],
    ]);
    const state = stateResp.find(r => r[2] === 'state')?.[1]?.state;

    this.engine.setSyncState('mail', { syncToken: state, status: 'idle' });
    console.log(`[mail] Full sync complete — ${totalIndexed} emails indexed`);
    return totalIndexed;
  }

  /**
   * Incremental sync — use JMAP state to fetch only new/changed emails.
   */
  async incrementalSync() {
    const syncState = this.engine.getSyncState('mail');
    if (!syncState?.sync_token) {
      return this.fullSync();
    }

    console.log('[mail] Starting incremental sync...');
    this.engine.setSyncState('mail', { syncToken: syncState.sync_token, status: 'syncing' });

    try {
      const responses = await this._jmapRequest([
        ['Email/changes', { sinceState: syncState.sync_token }, 'changes'],
      ]);

      const changes = responses.find(r => r[2] === 'changes')?.[1];
      if (!changes) {
        this.engine.setSyncState('mail', { syncToken: syncState.sync_token, status: 'idle' });
        return 0;
      }

      const { created, updated, destroyed, newState } = changes;
      const toFetch = [...(created || []), ...(updated || [])];

      let indexed = 0;

      if (toFetch.length) {
        const emailResp = await this._jmapRequest([
          ['Email/get', {
            ids: toFetch,
            properties: ['id', 'from', 'to', 'subject', 'receivedAt', 'preview', 'textBody', 'bodyValues'],
            fetchTextBodyValues: true,
          }, 'emails'],
        ]);

        const emails = emailResp.find(r => r[2] === 'emails')?.[1]?.list || [];
        const docs = emails.map(email => {
          let bodyText = email.preview || '';
          const textPart = email.textBody?.[0];
          if (textPart && email.bodyValues?.[textPart.partId]) {
            bodyText = email.bodyValues[textPart.partId].value || bodyText;
          }

          return {
            source: 'mail',
            sourceId: email.id,
            title: email.subject || '(no subject)',
            body: bodyText,
            author: email.from?.[0]?.email || 'unknown',
            timestamp: new Date(email.receivedAt).getTime(),
            metadata: { to: email.to?.map(a => a.email) },
          };
        });

        this.engine.indexBatch(docs);
        indexed = docs.length;
      }

      // Remove destroyed emails from index
      for (const id of (destroyed || [])) {
        this.engine.remove(`mail:${id}`);
      }

      this.engine.setSyncState('mail', { syncToken: newState, status: 'idle' });
      console.log(`[mail] Incremental sync: +${indexed} indexed, -${(destroyed || []).length} removed`);
      return indexed;
    } catch (err) {
      // If state is too old, fall back to full sync
      if (err.message.includes('cannotCalculateChanges')) {
        console.log('[mail] State expired, falling back to full sync');
        return this.fullSync();
      }
      throw err;
    }
  }
}
