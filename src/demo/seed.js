/**
 * Demo Data Seeder
 *
 * Seeds the FTS5 index with realistic sample data representing each
 * source type: Twake Chat messages, Twake Mail emails, and Twake Drive files.
 *
 * Used by `node src/server.js --demo` to start a working server without
 * needing real Twake service credentials.
 */

// Base timestamp: Monday 10 March 2025, 09:00 UTC
const BASE_TS = new Date('2025-03-10T09:00:00Z').getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 5 chat messages from a Twake Chat room about a project meeting.
 */
const chatMessages = [
  {
    source: 'chat',
    sourceId: 'evt-2025-03-10-001',
    title: 'Project kickoff sync',
    body: 'Hey team, just a reminder that our project kickoff meeting is tomorrow at 10am in the main conference room. Please review the proposal doc beforehand.',
    author: 'Marie Dupont',
    timestamp: BASE_TS,
    url: 'https://chat.twake.app/room/!proj-alpha:twake.app/evt-2025-03-10-001',
    metadata: { room: '!proj-alpha:twake.app', roomName: 'Project Alpha' },
  },
  {
    source: 'chat',
    sourceId: 'evt-2025-03-10-002',
    title: 'RE: Project kickoff sync',
    body: 'Thanks Marie! I have uploaded the updated budget spreadsheet to Drive. The numbers look good for Q2. Should we also invite the design team?',
    author: 'Lucas Martin',
    timestamp: BASE_TS + 15 * MINUTE,
    url: 'https://chat.twake.app/room/!proj-alpha:twake.app/evt-2025-03-10-002',
    metadata: { room: '!proj-alpha:twake.app', roomName: 'Project Alpha' },
  },
  {
    source: 'chat',
    sourceId: 'evt-2025-03-10-003',
    title: 'RE: Project kickoff sync',
    body: 'Good idea Lucas. I will send the invite to the design team now. Also, can someone prepare the presentation slides for the client demo next week?',
    author: 'Marie Dupont',
    timestamp: BASE_TS + 22 * MINUTE,
    url: 'https://chat.twake.app/room/!proj-alpha:twake.app/evt-2025-03-10-003',
    metadata: { room: '!proj-alpha:twake.app', roomName: 'Project Alpha' },
  },
  {
    source: 'chat',
    sourceId: 'evt-2025-03-10-004',
    title: 'RE: Project kickoff sync',
    body: 'I can handle the presentation. I already have a draft from last quarter that I can update with the new architecture diagrams and timeline.',
    author: 'Sophie Bernard',
    timestamp: BASE_TS + 30 * MINUTE,
    url: 'https://chat.twake.app/room/!proj-alpha:twake.app/evt-2025-03-10-004',
    metadata: { room: '!proj-alpha:twake.app', roomName: 'Project Alpha' },
  },
  {
    source: 'chat',
    sourceId: 'evt-2025-03-10-005',
    title: 'RE: Project kickoff sync',
    body: 'Perfect, thanks Sophie! One more thing — the deployment pipeline needs review before we go live. Can we add that to the meeting agenda?',
    author: 'Lucas Martin',
    timestamp: BASE_TS + 45 * MINUTE,
    url: 'https://chat.twake.app/room/!proj-alpha:twake.app/evt-2025-03-10-005',
    metadata: { room: '!proj-alpha:twake.app', roomName: 'Project Alpha' },
  },
];

/**
 * 3 emails: welcome email, meeting invite, project update.
 */
const mailMessages = [
  {
    source: 'mail',
    sourceId: 'mail-2025-03-08-001',
    title: 'Welcome to Twake Workplace — Getting Started',
    body: `Welcome to Twake Workplace! Your account is now active and you can start collaborating with your team.

Here are some quick tips to get started:
- Twake Chat: Send messages and create channels for your projects
- Twake Mail: Your professional email is ready at your-name@twake.app
- Twake Drive: Store and share documents with your team securely

If you have any questions, reach out to support@twake.app or visit our documentation at docs.twake.app.

Best regards,
The Twake Team`,
    author: 'noreply@twake.app',
    timestamp: BASE_TS - 2 * DAY,
    url: 'https://mail.twake.app/inbox/mail-2025-03-08-001',
    metadata: { folder: 'inbox', threadId: 'thread-welcome-001' },
  },
  {
    source: 'mail',
    sourceId: 'mail-2025-03-10-002',
    title: 'Meeting Invite: Project Alpha Kickoff — Tue 11 Mar 10:00',
    body: `You are invited to: Project Alpha Kickoff
Date: Tuesday, 11 March 2025
Time: 10:00 - 11:00 CET
Location: Main Conference Room / Twake Meet link below

Agenda:
1. Project scope and objectives overview
2. Team roles and responsibilities
3. Timeline and milestones for Q2
4. Budget review and resource allocation
5. Deployment pipeline review

Join online: https://meet.twake.app/project-alpha-kickoff

Please confirm your attendance. See you there!

Marie Dupont
Project Lead`,
    author: 'marie.dupont@twake.app',
    timestamp: BASE_TS + 2 * HOUR,
    url: 'https://mail.twake.app/inbox/mail-2025-03-10-002',
    metadata: { folder: 'inbox', threadId: 'thread-kickoff-002' },
  },
  {
    source: 'mail',
    sourceId: 'mail-2025-03-12-003',
    title: 'Project Alpha — Weekly Update #1',
    body: `Hi team,

Here is the first weekly update for Project Alpha:

Completed this week:
- Finalized project scope document
- Set up development environment and CI/CD pipeline
- Completed initial architecture review with the infrastructure team

In progress:
- API design for the search microservice
- Database schema design for FTS5 integration
- Frontend mockups for the unified search interface

Blockers:
- Waiting for staging server access (ticket INFRA-2847)

Next week:
- Begin implementation of the search engine core
- Schedule design review with the UX team
- Prepare client demo presentation

Regards,
Marie Dupont`,
    author: 'marie.dupont@twake.app',
    timestamp: BASE_TS + 2 * DAY + 4 * HOUR,
    url: 'https://mail.twake.app/inbox/mail-2025-03-12-003',
    metadata: { folder: 'inbox', threadId: 'thread-update-003' },
  },
];

/**
 * 4 drive files: proposal, meeting notes, budget spreadsheet, presentation.
 */
const driveFiles = [
  {
    source: 'drive',
    sourceId: 'drive-doc-001',
    title: 'Project Alpha — Proposal v2.1.docx',
    body: `Project Alpha Proposal

Executive Summary:
Project Alpha aims to build a unified search service for Twake Workplace, enabling users to search across Chat, Mail, and Drive from a single interface. The current client-side-only search has significant limitations in terms of performance and completeness.

Technical Approach:
We propose using SQLite FTS5 for the initial implementation, with a clear migration path to MeiliSearch for production scale. The service will expose a REST API consumed by Twake's frontend, indexing content via connectors for each Twake product.

Timeline: 8 weeks from kickoff to production deployment.
Budget: See accompanying spreadsheet for detailed breakdown.
Team: 3 backend engineers, 1 frontend engineer, 1 DevOps engineer.`,
    author: 'Marie Dupont',
    timestamp: BASE_TS - DAY,
    url: 'https://drive.twake.app/files/drive-doc-001',
    metadata: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 48200 },
  },
  {
    source: 'drive',
    sourceId: 'drive-doc-002',
    title: 'Meeting Notes — Project Alpha Kickoff 2025-03-11.md',
    body: `# Project Alpha Kickoff — Meeting Notes

Date: 11 March 2025, 10:00-11:00 CET
Attendees: Marie Dupont, Lucas Martin, Sophie Bernard, Julien Leroy

## Key Decisions
- FTS5 chosen for MVP; MeiliSearch migration planned for v2
- REST API will follow OpenAPI 3.1 spec
- Weekly syncs every Tuesday at 10:00
- Sprint cadence: 2-week sprints starting 17 March

## Action Items
- [ ] Lucas: Set up CI pipeline with GitHub Actions by Friday
- [ ] Sophie: Finalize presentation slides for client demo
- [ ] Julien: Draft API specification and share for review
- [ ] Marie: Request staging server access from infrastructure team

## Notes
- Client demo scheduled for 21 March
- Design team will join next week's sync
- Budget approved as proposed, no changes needed`,
    author: 'Sophie Bernard',
    timestamp: BASE_TS + DAY + HOUR,
    url: 'https://drive.twake.app/files/drive-doc-002',
    metadata: { mimeType: 'text/markdown', sizeBytes: 1240 },
  },
  {
    source: 'drive',
    sourceId: 'drive-doc-003',
    title: 'Project Alpha — Budget Q2 2025.xlsx',
    body: `Project Alpha Budget Breakdown Q2 2025

Personnel Costs:
- Backend Engineers (3): 45,000 EUR/month
- Frontend Engineer (1): 15,000 EUR/month
- DevOps Engineer (1): 16,000 EUR/month
- Project Management: 8,000 EUR/month
Total Personnel: 84,000 EUR/month

Infrastructure:
- Staging servers: 450 EUR/month
- Production servers (estimated): 1,200 EUR/month
- CI/CD pipeline: 180 EUR/month
Total Infrastructure: 1,830 EUR/month

Total Monthly: 85,830 EUR
Total Project (8 weeks): 171,660 EUR

Status: Approved by finance on 10 March 2025`,
    author: 'Lucas Martin',
    timestamp: BASE_TS + 3 * HOUR,
    url: 'https://drive.twake.app/files/drive-doc-003',
    metadata: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 32100 },
  },
  {
    source: 'drive',
    sourceId: 'drive-doc-004',
    title: 'Project Alpha — Client Demo Presentation.pptx',
    body: `Project Alpha — Client Demo
Unified Search for Twake Workplace

Slide 1: The Problem
Current search is client-side only, limited to local cache. Users cannot search across Chat, Mail, and Drive in one place.

Slide 2: Our Solution
Server-side search service powered by SQLite FTS5 with BM25 ranking. Single API endpoint returns results across all Twake products, ranked by relevance.

Slide 3: Architecture
Fastify REST API with connectors for Matrix (Chat), JMAP (Mail), and Cozy (Drive). Pluggable engine layer supports future migration to MeiliSearch.

Slide 4: Live Demo
Search for "deployment pipeline" — results from Chat messages, Mail threads, and Drive documents all in one view.

Slide 5: Timeline
MVP ready by end of April. Production rollout in May. MeiliSearch migration planned for Q3.`,
    author: 'Sophie Bernard',
    timestamp: BASE_TS + DAY + 6 * HOUR,
    url: 'https://drive.twake.app/files/drive-doc-004',
    metadata: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sizeBytes: 2_150_000 },
  },
];

/**
 * Seed the search engine with demo data.
 *
 * @param {import('../engine/search-engine.js').SearchEngine} engine
 * @returns {{ chat: number, mail: number, drive: number }} counts per source
 */
export function seedDemoData(engine) {
  const allDocs = [...chatMessages, ...mailMessages, ...driveFiles];
  const ids = engine.indexBatch(allDocs);

  const counts = {
    chat: chatMessages.length,
    mail: mailMessages.length,
    drive: driveFiles.length,
  };

  console.log(`[demo] Seeded ${ids.length} documents:`);
  console.log(`[demo]   Chat messages: ${counts.chat}`);
  console.log(`[demo]   Emails:        ${counts.mail}`);
  console.log(`[demo]   Drive files:   ${counts.drive}`);

  return counts;
}
