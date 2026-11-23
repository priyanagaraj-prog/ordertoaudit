/**
 * FactoryFlow ERP (Order-to-Audit ERP) — Node.js Backend Server
 *
 * Responsibilities:
 * 1. Serves the React + Vite frontend on port 3000 (Vite middleware in dev, dist/ in prod).
 * 2. Issues & verifies HMAC-SHA256 Role Portal session tokens OR Firebase ID tokens.
 * 3. Enforces role-based authorization on manufacturing, costing, and AI routes.
 * 4. Executes deterministic integer-paisa financial, GST, BOM variance, and AI analytics routes.
 */
import 'dotenv/config';
import crypto from 'crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { GoogleGenAI, Type } from '@google/genai';
import {
  calculateOrderTotals,
  calculateProductionVariance,
  computeDeterministicAiInsights,
  type OrderItemCalcInput,
} from './src/utils/erpEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase projectId from firebase-applet-config.json (never hardcode keys)
const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
let firebaseProjectId = '';
if (fs.existsSync(configPath)) {
  try {
    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (rawConfig.projectId && rawConfig.projectId !== 'remixed-project-id') {
      firebaseProjectId = String(rawConfig.projectId);
    }
  } catch (err) {
    console.error('Failed to read firebase-applet-config.json:', err);
  }
}

if (firebaseProjectId) {
  const adminApp = getApps().length
    ? getApp()
    : initializeApp({ projectId: firebaseProjectId });
  void adminApp;
}

const DEMO_SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const VALID_ERP_ROLES = new Set([
  'owner',
  'admin',
  'production_supervisor',
  'salesman',
  'accountant',
]);

interface DemoTokenPayload {
  portal: 'workspace';
  role: string;
  exp: number;
}

function signDemoToken(payload: DemoTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', DEMO_SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyDemoToken(token: string): DemoTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', DEMO_SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as DemoTokenPayload;
    if (!parsed || parsed.portal !== 'workspace' || !VALID_ERP_ROLES.has(parsed.role)) {
      return null;
    }
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface AuthenticatedRequest extends Request {
  authUser?: {
    uid: string;
    email?: string;
    mode: 'firebase' | 'demo';
    role?: string;
  };
}

/**
 * Middleware: Verifies EITHER Firebase ID Token (Authorization: Bearer ...)
 * OR signed Demonstration Role Session Token (X-FactoryFlow-Session: ...).
 */
async function resolvePortalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (idToken && firebaseProjectId) {
      try {
        const decoded = await getAuth().verifyIdToken(idToken);
        if (!decoded.email_verified) {
          res.status(403).json({ error: 'Email verification is required.' });
          return;
        }
        req.authUser = {
          uid: decoded.uid,
          email: decoded.email,
          mode: 'firebase',
        };
        next();
        return;
      } catch (error) {
        console.error('Firebase token verification failed:', error);
        res.status(401).json({ error: 'Invalid or expired authentication token.' });
        return;
      }
    }
  }

  const demoHeader = req.headers['x-factoryflow-session'];
  if (typeof demoHeader === 'string' && demoHeader.trim()) {
    const demo = verifyDemoToken(demoHeader.trim());
    if (demo) {
      req.authUser = {
        uid: `demo_${demo.role}`,
        mode: 'demo',
        role: demo.role,
      };
      next();
      return;
    }
  }

  res.status(401).json({ error: 'Valid Firebase token or FactoryFlow role session required.' });
}

/**
 * Role Isolation Guard: Restricts demonstration sessions to permitted organizational roles.
 */
function requireDemoRoles(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.authUser.mode === 'demo' && (!req.authUser.role || !allowedRoles.includes(req.authUser.role))) {
      res.status(403).json({
        error: `Forbidden: Role "${req.authUser.role || 'unknown'}" is not authorized for this operation.`,
      });
      return;
    }
    next();
  };
}

function getConfiguredGeminiKey(): string | null {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return key;
}

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function assertPositiveInt(val: unknown, field: string): number {
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
    throw new Error(`Invalid integer-paisa value for ${field}`);
  }
  return val;
}

function assertPositiveNumber(val: unknown, field: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
    throw new Error(`Invalid positive quantity for ${field}`);
  }
  return val;
}

async function startServer() {
  const app = express();

  /**
   * Same-origin Firestore WebChannel & REST proxy.
   * Locked strictly to https://firestore.googleapis.com for the configured firebaseProjectId.
   * Mounted BEFORE express.json() and vite.middlewares so raw WebChannel/REST payloads stream untouched.
   */
  const firestoreProxyMiddleware = (req: Request, res: Response) => {
    if (!firebaseProjectId) {
      res.status(503).json({ error: 'Firebase project is not configured.' });
      return;
    }

    const originalUrl = req.originalUrl || req.url;
    const isWebChannel =
      originalUrl.startsWith('/google.firestore.v1.Firestore/Listen/') ||
      originalUrl.startsWith('/google.firestore.v1.Firestore/Write/');
    const isFirestoreRest = originalUrl.startsWith(`/v1/projects/${firebaseProjectId}/`);

    if (!isWebChannel && !isFirestoreRest) {
      res.status(403).json({ error: 'Forbidden Firestore proxy path.' });
      return;
    }

    if (isWebChannel && typeof req.query.database === 'string') {
      if (!req.query.database.startsWith(`projects/${firebaseProjectId}/`)) {
        res.status(403).json({ error: 'Forbidden Firestore database target.' });
        return;
      }
    }

    const allowedHeaders = [
      'authorization',
      'content-type',
      'content-length',
      'x-goog-api-key',
      'x-firebase-gmpid',
      'x-goog-api-client',
      'x-goog-request-params',
      'google-cloud-resource-prefix',
      'x-http-session-id',
      'x-firebase-appcheck',
    ] as const;

    const upstreamHeaders: Record<string, string> = {
      host: 'firestore.googleapis.com',
      'accept-encoding': 'identity',
    };
    for (const key of allowedHeaders) {
      const val = req.headers[key];
      if (typeof val === 'string' && val.length > 0) {
        upstreamHeaders[key] = val;
      }
    }

    const proxyReq = https.request(
      {
        hostname: 'firestore.googleapis.com',
        port: 443,
        path: originalUrl,
        method: req.method,
        headers: upstreamHeaders,
      },
      (proxyRes) => {
        const hopByHop = new Set([
          'connection',
          'keep-alive',
          'transfer-encoding',
          'upgrade',
          'proxy-authenticate',
          'proxy-authorization',
          'te',
          'trailer',
          'alt-svc',
          'set-cookie',
          'access-control-allow-origin',
          'access-control-allow-credentials',
          'access-control-expose-headers',
        ]);
        const outHeaders: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v !== undefined && !hopByHop.has(k.toLowerCase())) {
            outHeaders[k] = v;
          }
        }
        res.writeHead(proxyRes.statusCode || 502, outHeaders);
        if (typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      console.error('Firestore proxy upstream error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Upstream Firestore connection error.' });
      } else if (!res.writableEnded) {
        res.end();
      }
    });

    res.on('close', () => {
      if (!res.writableEnded) {
        proxyReq.destroy();
      }
    });

    req.pipe(proxyReq);
  };

  app.use('/google.firestore.v1.Firestore', firestoreProxyMiddleware);
  app.use('/v1', firestoreProxyMiddleware);

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'factoryflow-erp',
      aiConfigured: Boolean(getConfiguredGeminiKey()),
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/demo/session
   * Issues an HMAC-signed Demonstration Mode role portal session token.
   */
  app.post('/api/demo/session', (req: Request, res: Response) => {
    const { role } = (req.body || {}) as {
      role?: string;
    };

    if (role !== undefined && (typeof role !== 'string' || !VALID_ERP_ROLES.has(role))) {
      res.status(400).json({ error: 'Invalid organizational role requested.' });
      return;
    }

    const safeRole = role ?? 'owner';
    const exp = Date.now() + 12 * 60 * 60 * 1000; // 12 hours

    const token = signDemoToken({
      portal: 'workspace',
      role: safeRole,
      exp,
    });

    res.json({
      token,
      portal: 'workspace',
      role: safeRole,
      expiresAt: new Date(exp).toISOString(),
    });
  });

  /**
   * POST /api/finance/calculate-order
   * Deterministic server-side integer-paisa calculation for Sales Orders.
   */
  app.post('/api/finance/calculate-order', resolvePortalAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { companyStateCode, customerStateCode, items } = req.body as {
        companyStateCode?: string;
        customerStateCode?: string;
        items?: OrderItemCalcInput[];
      };

      const result = calculateOrderTotals(
        String(companyStateCode || ''),
        String(customerStateCode || ''),
        items || []
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Calculation failed.' });
    }
  });

  /**
   * POST /api/production/calculate-variance
   * Deterministic server-side BOM standard vs actual production cost & variance engine.
   */
  app.post(
    '/api/production/calculate-variance',
    resolvePortalAuth,
    requireDemoRoles(['owner', 'admin', 'production_supervisor']),
    (req: AuthenticatedRequest, res: Response) => {
      try {
        const {
          plannedQty,
          actualOutputQty,
          wastageQty,
          bomBatchYieldQty,
          standardLaborCostPaisa,
          standardOverheadPaisa,
          standardMaterialPerBatchPaisa,
          actualMaterialCostPaisa,
        } = req.body as Record<string, unknown>;

        const result = calculateProductionVariance({
          plannedQty: assertPositiveNumber(plannedQty, 'plannedQty'),
          actualOutputQty: typeof actualOutputQty === 'number' && actualOutputQty >= 0 ? actualOutputQty : 0,
          wastageQty: typeof wastageQty === 'number' && wastageQty >= 0 ? wastageQty : 0,
          bomBatchYieldQty: assertPositiveNumber(bomBatchYieldQty, 'bomBatchYieldQty'),
          standardLaborCostPaisa: assertPositiveInt(standardLaborCostPaisa, 'standardLaborCostPaisa'),
          standardOverheadPaisa: assertPositiveInt(standardOverheadPaisa, 'standardOverheadPaisa'),
          standardMaterialPerBatchPaisa: assertPositiveInt(
            standardMaterialPerBatchPaisa,
            'standardMaterialPerBatchPaisa'
          ),
          actualMaterialCostPaisa: assertPositiveInt(actualMaterialCostPaisa, 'actualMaterialCostPaisa'),
        });

        res.json(result);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Variance calculation failed.' });
      }
    }
  );

  /**
   * POST /api/ai/insights
   * Merchant-only: computes deterministic operational intelligence and enriches with Gemini API when configured.
   */
  app.post(
    '/api/ai/insights',
    resolvePortalAuth,
    requireDemoRoles(['owner', 'admin', 'production_supervisor', 'accountant']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = (req.body || {}) as {
          todayIso?: string;
          products?: Array<{
            id: string;
            sku: string;
            name: string;
            unit: string;
            currentStock: number;
            reorderLevel: number;
            standardCostPaisa: number;
          }>;
          rawMaterials?: Array<{
            id: string;
            code: string;
            name: string;
            unit: string;
            currentStock: number;
            reorderLevel: number;
            costPerUnitPaisa: number;
          }>;
          packagingMaterials?: Array<{
            id: string;
            code: string;
            name: string;
            unit: string;
            currentStock: number;
            reorderLevel: number;
            costPerUnitPaisa: number;
          }>;
          orders?: Array<{
            id: string;
            orderNumber: string;
            customerName: string;
            totalAmountPaisa: number;
            status: string;
            items: Array<{ productId: string; quantity: number }>;
          }>;
          productionRuns?: Array<{
            id: string;
            batchNumber: string;
            productName: string;
            plannedQty: number;
            actualOutputQty: number;
            wastageQty: number;
            standardCostPaisa: number;
            actualTotalCostPaisa: number;
            variancePaisa: number;
            status: string;
          }>;
          batches?: Array<{
            id: string;
            batchNumber: string;
            itemName: string;
            itemType: string;
            remainingQty: number;
            unit: string;
            expiryDate: string;
          }>;
        };

        const deterministic = computeDeterministicAiInsights({
          todayIso: body.todayIso || new Date().toISOString().slice(0, 10),
          products: Array.isArray(body.products) ? body.products : [],
          rawMaterials: Array.isArray(body.rawMaterials) ? body.rawMaterials : [],
          packagingMaterials: Array.isArray(body.packagingMaterials) ? body.packagingMaterials : [],
          orders: Array.isArray(body.orders) ? body.orders : [],
          productionRuns: Array.isArray(body.productionRuns) ? body.productionRuns : [],
          batches: Array.isArray(body.batches) ? body.batches : [],
        });

        const apiKey = getConfiguredGeminiKey();
        if (!apiKey) {
          res.json({
            aiPowered: false,
            modelUsed: 'deterministic-statistical-engine',
            statusNotice:
              'GEMINI_API_KEY is not configured in server secrets. Showing verified deterministic statistical forecasts, FEFO expiry scans, and anomaly checks.',
            deterministic,
            executiveBrief: null,
          });
          return;
        }

        try {
          const ai = createGeminiClient(apiKey);
          const aiResponse = await Promise.race([
            ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: `Analyze this South Indian food manufacturing ERP analytics snapshot and provide a concise executive summary plus 3 prioritized operational actions.\n${JSON.stringify(
                deterministic
              )}`,
              config: {
                systemInstruction:
                  'You are an operations analyst for FactoryFlow ERP (South Indian packaged food manufacturing). Only reference facts present in the JSON payload. Keep outputs concise, numeric, and actionable.',
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    headline: { type: Type.STRING },
                    riskSummary: { type: Type.STRING },
                    prioritizedActions: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                },
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Gemini API request timed out after 10s')), 10000)
            ),
          ]);

          const parsed = JSON.parse((aiResponse.text || '{}').trim()) as {
            headline?: string;
            riskSummary?: string;
            prioritizedActions?: string[];
          };

          res.json({
            aiPowered: true,
            modelUsed: 'gemini-4-hydrogen',
            statusNotice: 'Live Gemini narrative analysis combined with deterministic integer-paisa metrics.',
            deterministic,
            executiveBrief: parsed,
          });
        } catch (aiErr) {
          res.json({
            aiPowered: false,
            modelUsed: 'deterministic-statistical-engine',
            statusNotice: `Gemini API call failed (${aiErr instanceof Error ? aiErr.message : 'upstream error'}). Showing verified deterministic analytics.`,
            deterministic,
            executiveBrief: null,
          });
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'AI insights calculation failed.' });
      }
    }
  );

  /**
   * POST /api/ai/assistant
   * Merchant-only conversational ERP query grounded in live workspace state.
   */
  app.post(
    '/api/ai/assistant',
    resolvePortalAuth,
    requireDemoRoles(['owner', 'admin', 'production_supervisor', 'accountant']),
    async (req: AuthenticatedRequest, res: Response) => {
      const { question, contextSummary } = (req.body || {}) as {
        question?: string;
        contextSummary?: Record<string, unknown>;
      };

      if (!question || typeof question !== 'string' || !question.trim()) {
        res.status(400).json({ error: 'Question is required.' });
        return;
      }

      const apiKey = getConfiguredGeminiKey();
      if (!apiKey) {
        res.json({
          aiPowered: false,
          modelUsed: 'deterministic-fallback',
          answer:
            'Live Gemini LLM responses require GEMINI_API_KEY in server Secrets. Based on your live workspace snapshot, review the Demand Forecasts, Smart Reorder Recommendations, Near-Expiry FEFO Queue, and Anomaly Log tabs for exact integer-paisa numbers.',
        });
        return;
      }

      try {
        const ai = createGeminiClient(apiKey);
        const response = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: `Workspace Snapshot:\n${JSON.stringify(contextSummary || {})}\n\nMerchant Question: ${question.trim()}`,
            config: {
              systemInstruction:
                'You are the FactoryFlow ERP Operations Analyst for Kaveri Heritage Foods (South Indian packaged foods). Answer strictly using figures in the supplied Workspace Snapshot. Use INR (₹) formatting and concise bullet points.',
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Gemini API request timed out after 10s')), 10000)
          ),
        ]);

        res.json({
          aiPowered: true,
          modelUsed: 'gemini-4-hydrogen',
          answer: response.text || 'No response generated.',
        });
      } catch (err) {
        const rmLow = Array.isArray(contextSummary?.rawMaterials)
          ? (contextSummary.rawMaterials as Array<{ name?: string; stock?: number; reorderLevel?: number; unit?: string }>).filter(
              (r) => Number(r.stock ?? 0) <= Number(r.reorderLevel ?? 0)
            )
          : [];
        const batchesList = Array.isArray(contextSummary?.activeBatches)
          ? (contextSummary.activeBatches as Array<{ batchNumber?: string; itemName?: string; expiryDate?: string }>)
          : [];
        res.json({
          aiPowered: false,
          modelUsed: 'deterministic-fallback',
          answer: `Gemini API is temporarily experiencing high load (${err instanceof Error ? err.message : 'unavailable'}). Grounded deterministic summary for "${question.trim()}": ${rmLow.length} raw material(s) at/below reorder level${rmLow.length > 0 ? ` (${rmLow.map((r) => `${r.name}: ${r.stock} ${r.unit}`).join(', ')})` : ''}; ${batchesList.length} active batch lot(s) tracked for FEFO.${batchesList.length > 0 ? ` Earliest lot: ${batchesList[0].batchNumber} (${batchesList[0].itemName}, exp ${batchesList[0].expiryDate}).` : ''}`,
        });
      }
    }
  );

  const httpServer = http.createServer(app);

  // Frontend serving: Vite middleware in dev, static dist/ in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`FactoryFlow ERP server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
