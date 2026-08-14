
        const { createServer } = require('node:http');
        const { randomUUID } = require('node:crypto');

        // Local dev storage gate — the worker server.js import requires this
        // BEFORE any dynamic import below runs.
        process.env.VANTAGE_DEV_MEMORY_STORE = 'true';

        // Minimal worker with WP11 API routes — mock mode
        async function main() {
          const { createMemoryArtifactStore } = await import('../../services/worker/src/storage/memory-artifact-store.js');
          const { createGovernedArtifactStore } = await import('../../services/worker/src/storage/governed-artifact-store.js');
          const { createMemoryLifecycleRepository } = await import('../../services/worker/src/lifecycle/memory-repository.js');
          const { createLifecycleService } = await import('../../services/worker/src/lifecycle/lifecycle-service.js');
          const { createAuditOrchestrator } = await import('../../services/worker/src/orchestration/audit-orchestrator.js');
          const { createAuditApplicationService } = await import('../../services/worker/src/application/audit-service.js');
          const { createLocalReportStore } = await import('../../services/worker/src/storage/report-store.js');
          const { createRequestHandler } = await import('../../services/worker/src/server.js');
          const { mkdirSync, rmSync } = await require('node:fs');
          const { resolve } = await require('node:path');

          const baseDir = resolve('artifacts', 'wp11-playwright-' + Date.now());
          mkdirSync(baseDir, { recursive: true });

          const mem = createMemoryArtifactStore();
          const artifacts = createGovernedArtifactStore({ store: mem });
          const lcRepo = createMemoryLifecycleRepository();
          const lc = createLifecycleService(lcRepo);
          const reportStore = createLocalReportStore({ baseDir });

          // DE-04-compliant mock evidence: AVAILABLE site evidence carries the
          // structural fields the governed decision-evidence contract requires.
          const siteEvidence = {
            sourceStatus:'AVAILABLE', domain:'flow-test-business.com',
            targetUrl:'https://flow-test-business.com', pageCount:1,
            pages:[{ url:'https://flow-test-business.com', title:'Flow Test', headings:{h1:['Flow Test'],h2:[],h3:[]}, description:'D', content:{text:'x',wordCount:300}, images:[], links:{internal:[],external:[]}, statusCode:200 }],
            services:['Consulting'], topicKeywords:[], ctas:[], forms:[], externalCtas:[], socialLinks:[],
            trust:{ credentials:true }, platform:'WordPress', schemaTypes:['ProfessionalService'],
            statusCounts:{'200':1}, totalWords:300, averageWords:300,
            missingTitles:0, missingDescriptions:0, missingCanonicals:0,
            h1Missing:0, h1Multiple:0, imageCount:0, imagesMissingAlt:0,
            internalLinkCount:0, brokenInternalLinks:[], securityHeaders:{},
            _contentEvidenceAvailable:true, _responseHeadersAvailable:false,
            collectedAt:new Date().toISOString(),
          };
          const perfEvidence = {
            sourceStatus:'AVAILABLE', fallbackUsed:false, testedUrls:['https://flow-test-business.com'],
            mobile:{ status:'AVAILABLE', scores:{performance:73,accessibility:92,bestPractices:85,seo:90}, metrics:{fcpMs:1200,lcpMs:1800,cls:0.05,tbtMs:200} },
            desktop:{ status:'AVAILABLE', scores:{performance:88,accessibility:94,bestPractices:88,seo:92}, metrics:{fcpMs:600,lcpMs:900,cls:0.02,tbtMs:80} },
            collectedAt:new Date().toISOString(),
          };
          const evidenceBySource = {
            'dataforseo-onpage': siteEvidence,
            'pagespeed': perfEvidence,
            'dataforseo-serp': { competitors:[], suppliedCompetitors:[], audienceScope:'local', providerLocation:'Canada', keywordCount:1, resultCount:0 },
            'backlinks': { sourceStatus:'AVAILABLE', goodCount:5 },
            'ga4': { sourceStatus:'NOT_CONNECTED' },
            'gsc': { sourceStatus:'NOT_CONNECTED' },
          };
          const mockAdapters = {};
          Object.keys(evidenceBySource).forEach(n => {
            mockAdapters[n] = { adapterVersion: '1.0.0', execute: async () => ({
              rawBytes: Buffer.from('{}'), contentType: 'application/json',
              sourceResult: { contractVersion:'1.0.0',schemaVersion:'1.0.0',source:n,provider:'mock',adapterVersion:'1.0.0',status:evidenceBySource[n].sourceStatus === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : 'AVAILABLE',startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),retryCount:0,coverage:{requested:1,completed:1,failed:0},limitations:[],evidence:evidenceBySource[n] }
            })};
          });

          const orch = createAuditOrchestrator({
            lifecycleService:lc, artifactStore:artifacts, adapters:mockAdapters,
            validateContract: () => ({ valid:true, errors:[] }),
            clock: { now:() => new Date().toISOString(), sleep:async()=>{}, setTimeout:(f,m) => setTimeout(f,Math.min(m,100)) },
            retryPolicyResolver: () => ({ timeoutMs:30000, maxAttempts:1, retryable:()=>false, delayMs:()=>0 }),
          });

          // Production-faithful execution: drive the audit through the
          // governed boundaries to DRAFT_RENDERED (mirrors
          // production-runtime.runAuditToReviewableDraft) so the web app's
          // Draft Review flow has a real draft to review.
          async function driveToDraft(auditRequest) {
            let result = await orch.execute(auditRequest, { executionId: randomUUID() });
            let previous = null;
            for (let step = 0; step < 8; step++) {
              if (result.finalState === 'draft_rendered' || result.finalState === previous) break;
              previous = result.finalState;
              result = await orch.execute(auditRequest, { executionId: randomUUID() });
            }
            return result;
          }

          const baseAuditService = createAuditApplicationService({
            orchestrator:orch, lifecycleRepo:lcRepo, lifecycleService:lc,
            artifactStore:artifacts, reportStore,
            config: { artifactDir: baseDir },
            validateContract: () => ({ valid:true, errors:[] }),
          });

          // Wrap createAudit to drive to DRAFT_RENDERED from the persisted
          // AuditRequest (C9 boundary) and enrich getAuditStatus with the
          // slug/clientId the report proxy needs — mirrors production-runtime.
          const { loadAuditRequest } = await import('../../services/worker/src/orchestration/audit-request-persistence.js');
          const slugify = (s) => String(s || 'audit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
          const auditService = {
            ...baseAuditService,
            createAudit: async (input, tenantId) => {
              const created = await baseAuditService.createAudit(input, tenantId);
              const cs = await lc.currentState(created.auditId, tenantId);
              const req = await loadAuditRequest({
                store: artifacts,
                scope: { tenantId, clientId: cs?.clientId || created.clientId, auditId: created.auditId },
                validateContract: () => ({ valid:true, errors:[] }),
              });
              if (req) await driveToDraft(req);
              const after = await lc.currentState(created.auditId, tenantId);
              return { ...created, finalState: after?.state || created.finalState };
            },
            getAuditStatus: async (auditId, tenantId) => {
              const status = await baseAuditService.getAuditStatus(auditId, tenantId);
              if (!status) return null;
              const cs = await lc.currentState(auditId, tenantId);
              const req = await loadAuditRequest({
                store: artifacts,
                scope: { tenantId, clientId: cs?.clientId || '', auditId },
                validateContract: () => ({ valid:true, errors:[] }),
              }).catch(() => null);
              return {
                ...status,
                clientId: cs?.clientId || '',
                businessName: req?.businessName || '',
                targetUrl: req?.targetUrl || '',
                slug: slugify(req?.businessName || ''),
              };
            },
          };

          // MT-IDENTITY: seed the mock identity repository so the REAL
          // authorization resolution executes in the browser harness.
          const { createMemoryIdentityRepository } = await import('../../services/worker/src/identity/memory-identity-repository.js');
          const identityRepo = createMemoryIdentityRepository();
          await identityRepo.createTenant({ id: 'playwright-tenant', name: 'Playwright Tenant', slug: 'playwright-tenant' });
          // Mock-mode sub derivation matches lib/identity/identity-provider.ts:
          // sub = 'mock-' + hex(lower(trim(email))).
          const mockSub = (email) => 'mock-' + Buffer.from(email.toLowerCase().trim(), 'utf8').toString('hex');
          for (const email of ['flow@test.example.com', 'draft-review@test.example.com', 'anon-draft@test.example.com']) {
            await identityRepo.createUser({
              id: randomUUID(), cognitoSub: mockSub(email), email, displayName: email.split('@')[0],
            });
            await identityRepo.createMembership({
              id: randomUUID(), tenantId: 'playwright-tenant',
              userId: (await identityRepo.findUserByCognitoSub(mockSub(email))).id,
              role: 'reviewer',
            });
          }
          // ACCT-PROVISION: seed the platform admin identity + platform
          // operations tenant so the REAL admin boundary executes in the
          // browser harness.
          await identityRepo.createTenant({ id: 'platform-ops', name: 'Platform Operations', slug: 'platform-ops' });
          await identityRepo.createUser({
            id: randomUUID(), cognitoSub: mockSub('admin@test.example.com'), email: 'admin@test.example.com', displayName: 'admin',
          });
          await identityRepo.createMembership({
            id: randomUUID(), tenantId: 'platform-ops',
            userId: (await identityRepo.findUserByCognitoSub(mockSub('admin@test.example.com'))).id,
            role: 'platform_admin',
          });

          const handler = createRequestHandler({
            config: { artifactDir:baseDir, webhookSecret:'test-secret', vantageTenantId:'playwright-tenant' },
            localStore:reportStore, store:reportStore,
            oauthService: { getAuthUrl:()=>'', validateState:()=>'ga4', exchangeCode:async()=>({}), getStatus:async()=>({}), disconnect:async()=>({}) },
            auditService,
            lifecycleRepo: lcRepo,
            identityRepo,
          });

          const server = createServer(handler);
          const workerPort = parseInt(process.env.WORKER_PORT || '19350', 10);
          server.listen(workerPort, '127.0.0.1', () => {
            console.log('Worker mock server listening on ' + workerPort);
          });
        }
        main().catch(e => { console.error(e); process.exit(1); });

